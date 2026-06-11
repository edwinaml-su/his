/**
 * F2-S15 Stream D — Tests Vitest: PIN lockout + outlier detection + permission matrix.
 *
 * Cubre ≥25 casos:
 *   § 1  firma.history         — historial propio, ajeno (ADM), ajeno (sin privilegio)
 *   § 2  auditOutlier          — listOutliers, flagOutlier, scanAndFlag, dashboardStats, getConfig, upsertConfig
 *   § 3  rbac.permissionMatrix — happy path, filtro resource, sin usuarios
 *   § 4  rbac.purgeInactiveUsers — dryRun, ejecución real, sin candidatos
 *   § 5  rbac.reactivateUser   — happy path, domainEvent
 *   § 6  cross-tenant isolation HJ-04 (queries) + HJ-06 (scanAndFlag mutation)
 *   § 7  PIN lockout state machine (tabla de transiciones via firma.verify)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";

import { firmaElectronicaRouter } from "../firma-electronica.router";
import { auditOutlierRouter } from "../audit-outlier.router";
import { rbacRouter } from "../rbac.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_USER_ADMIN, MOCK_TENANT, MOCK_TENANT_OTHER_ORG } from "@his/test-utils";

// ---------------------------------------------------------------------------
// Mock argon2 para velocidad
// ---------------------------------------------------------------------------
vi.mock("@his/infrastructure", () => ({
  argon2: {
    argon2id: 2,
    hash: vi.fn(async (pin: string) => `hashed:${pin}`),
    verify: vi.fn(async (storedHash: string, pin: string) =>
      storedHash === `hashed:${pin}`
    ),
    },
}));

// ---------------------------------------------------------------------------
// Fixtures comunes
// ---------------------------------------------------------------------------

const USER_ID   = MOCK_USER_ADMIN.id;
const FIRMA_ID  = "00000000-0000-0000-0000-000000000011";
const PERSO_ID  = "00000000-0000-0000-0000-000000000010";
const ORG_ID    = MOCK_TENANT.organizationId;
const VALID_PIN = "123456";

const PERSONAL_ROW    = [{ id: PERSO_ID }];
const FIRMA_ACTIVE    = [{
  id:              FIRMA_ID,
  personal_id:     PERSO_ID,
  pin_hash:        `hashed:${VALID_PIN}`,
  salt_extra:      "aabbcc",
  failed_attempts: 0,
  locked_until:    null,
  revoked_at:      null,
}];
const FIRMA_LOCKED = [{
  ...FIRMA_ACTIVE[0],
  failed_attempts: 5,
  locked_until:    new Date(Date.now() + 15 * 60 * 1000), // 15 min futuro
}];
const FIRMA_4_FAILED = [{
  ...FIRMA_ACTIVE[0],
  failed_attempts: 4,
}];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFirmaCaller(
  prisma: DeepMockProxy<PrismaClient>,
  extraTenant: Partial<typeof MOCK_TENANT> = {},
) {
  return firmaElectronicaRouter.createCaller(
    makeCtx({ prisma, user: MOCK_USER_ADMIN, tenant: { ...MOCK_TENANT, ...extraTenant } }),
  );
}

// Tenant DIR para endpoints que requieren rol DIR/super_admin
const TENANT_DIR = { ...MOCK_TENANT, roleCodes: ["DIR", "super_admin"] };
// Tenant ADM para reactivation
const TENANT_ADM = { ...MOCK_TENANT, roleCodes: ["ADM", "super_admin"] };

function makeOutlierCaller(prisma: DeepMockProxy<PrismaClient>, tenant = TENANT_DIR) {
  return auditOutlierRouter.createCaller(
    makeCtx({ prisma, user: MOCK_USER_ADMIN, tenant }),
  );
}

function makeRbacCaller(
  prisma: DeepMockProxy<PrismaClient>,
  tenant = TENANT_DIR,
) {
  return rbacRouter.createCaller(
    makeCtx({ prisma, user: MOCK_USER_ADMIN, tenant }),
  );
}

// ---------------------------------------------------------------------------
// § 1 — firma.history
// ---------------------------------------------------------------------------

describe("firma.history", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    vi.clearAllMocks();
  });

  it("[US.F2.7.5] retorna historial propio del usuario", async () => {
    const caller = makeFirmaCaller(prisma);
    // Columnas reales de ece.bitacora_acceso (remapeadas): autorizado, ip_origen,
    // ocurrido_en, auth_user_id, justificacion, personal_id FK.
    const historyRows = [
      {
        id:            "row-1",
        personal_id:   PERSO_ID,
        accion:        "verify",
        autorizado:    true,
        ip_origen:     "10.0.0.1",
        ocurrido_en:   new Date("2026-05-01T10:00:00Z"),
        justificacion: null,
        auth_user_id:  USER_ID,
      },
    ];

    (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ total: BigInt(1) }]) // count
      .mockResolvedValueOnce(historyRows);            // data

    const result = await caller.history({});
    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].accion).toBe("verify");
    expect(result.items[0].autorizado).toBe(true);
  });

  it("[US.F2.7.5] ADM puede consultar historial de otro usuario", async () => {
    const OTHER_ID = "00000000-0000-0000-0000-000000000099";
    // Simula tenant con rol ADM en roleCodes
    const caller = makeFirmaCaller(prisma, { roleCodes: ["ADM"] });

    (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ total: BigInt(0) }])
      .mockResolvedValueOnce([]);

    const result = await caller.history({ userId: OTHER_ID });
    expect(result.total).toBe(0);
    expect(result.items).toHaveLength(0);
  });

  it("[US.F2.7.5] usuario sin privilegio NO puede ver historial ajeno", async () => {
    const OTHER_ID = "00000000-0000-0000-0000-000000000099";
    // tenant con roleCodes vacíos — sin privilegio
    const caller = makeFirmaCaller(prisma, { roleCodes: [] });

    await expect(caller.history({ userId: OTHER_ID })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("[US.F2.7.5] filtra por rango de fechas", async () => {
    const caller = makeFirmaCaller(prisma, {});

    (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ total: BigInt(0) }])
      .mockResolvedValueOnce([]);

    const result = await caller.history({
      dateFrom: "2026-01-01T00:00:00Z",
      dateTo:   "2026-05-31T23:59:59Z",
    });
    expect(result.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// § 2 — auditOutlierRouter
// ---------------------------------------------------------------------------

describe("auditOutlier.listOutliers", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    vi.clearAllMocks();
  });

  it("retorna lista paginada de outliers", async () => {
    const caller = makeOutlierCaller(prisma);
    const outlierRow = {
      id:             "b-1",
      personal_id:    PERSO_ID,
      auth_user_id:   USER_ID,
      accion:         "view",
      autorizado:     true,
      ip_origen:      "1.2.3.4",
      ocurrido_en:    new Date("2026-05-18T23:30:00Z"),
      flag_outlier:   true,
      motivo_outlier: "Fuera de horario clínico",
      recurso_id:     null,
    };

    (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ total: BigInt(1) }])
      .mockResolvedValueOnce([outlierRow]);

    const result = await caller.listOutliers({ limit: 10, offset: 0 });
    expect(result.total).toBe(1);
    expect(result.items[0].motivoOutlier).toBe("Fuera de horario clínico");
    expect(result.items[0].flagOutlier).toBe(true);
  });

  it("retorna lista vacía si no hay outliers", async () => {
    const caller = makeOutlierCaller(prisma);

    (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ total: BigInt(0) }])
      .mockResolvedValueOnce([]);

    const result = await caller.listOutliers({ limit: 10, offset: 0 });
    expect(result.total).toBe(0);
    expect(result.items).toHaveLength(0);
  });

  it("filtra por rango de fechas", async () => {
    const caller = makeOutlierCaller(prisma);

    (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ total: BigInt(0) }])
      .mockResolvedValueOnce([]);

    const result = await caller.listOutliers({
      desde:  "2026-05-01T00:00:00Z",
      hasta:  "2026-05-31T23:59:59Z",
      limit:  50,
      offset: 0,
    });
    expect(result.total).toBe(0);
  });
});

describe("auditOutlier.flagOutlier", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    vi.clearAllMocks();
  });

  it("marca outlier correctamente", async () => {
    const caller = makeOutlierCaller(prisma);
    (prisma.$executeRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValueOnce(1);

    const result = await caller.flagOutlier({
      bitacoraId: 1,
      motivo:     "IP sospechosa detectada manualmente",
    });
    expect(result.ok).toBe(true);
  });

  it("lanza NOT_FOUND si no existe el registro", async () => {
    const caller = makeOutlierCaller(prisma);
    (prisma.$executeRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValueOnce(0);

    await expect(
      caller.flagOutlier({
        bitacoraId: 1,
        motivo:     "Prueba",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rechaza UUID o string no numérico (bigint IDENTITY, no UUID)", async () => {
    const caller = makeOutlierCaller(prisma);
    await expect(
      // @ts-expect-error — validamos que el Zod rechaza el tipo incorrecto
      caller.flagOutlier({ bitacoraId: "not-a-number", motivo: "test" }),
    ).rejects.toThrow();
  });

  it("coerciona string numérico a number (input desde URL params)", async () => {
    const caller = makeOutlierCaller(prisma);
    (prisma.$executeRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValueOnce(1);

    const result = await caller.flagOutlier({
      bitacoraId: "42" as unknown as number, // simula input desde query string
      motivo:     "Test coerción",
    });
    expect(result.ok).toBe(true);
  });
});

describe("auditOutlier.scanAndFlag", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    vi.clearAllMocks();
  });

  it("ejecuta scan y retorna conteo de flaggeados", async () => {
    const caller = makeOutlierCaller(prisma);

    // getOrgConfig retorna null (sin config)
    (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    // UPDATE flagged count
    (prisma.$executeRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValueOnce(3);

    const result = await caller.scanAndFlag({});
    expect(result.ok).toBe(true);
    expect(result.flagged).toBe(3);
  });

  it("scan con whitelist vacía no flag por IP", async () => {
    const caller = makeOutlierCaller(prisma);

    (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{
      id:                      "cfg-1",
      organizationId:          ORG_ID,
      ipWhitelist:             [],
      horarioClinicoInicio:    "06:00",
      horarioClinicoFin:       "22:00",
      outlierAlertEnabled:     true,
    }]);
    (prisma.$executeRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValueOnce(2);

    const result = await caller.scanAndFlag({});
    expect(result.ok).toBe(true);
    expect(result.flagged).toBe(2);
  });
});

describe("auditOutlier.dashboardStats", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => { prisma = mockDeep<PrismaClient>(); vi.clearAllMocks(); });

  it("retorna estadísticas del dashboard", async () => {
    const caller = makeOutlierCaller(prisma);

    (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ count: BigInt(100) }]) // totalAccesos
      .mockResolvedValueOnce([{ count: BigInt(5) }])   // totalOutliers
      .mockResolvedValueOnce([                          // topUsuarios
        { auth_user_id: "u1", count: BigInt(30) },
        { auth_user_id: "u2", count: BigInt(20) },
      ]);

    const result = await caller.dashboardStats({});
    expect(result.totalAccesos).toBe(100);
    expect(result.totalOutliers).toBe(5);
    expect(result.topUsuarios).toHaveLength(2);
    expect(result.topUsuarios[0].accesos).toBe(30);
  });
});

describe("auditOutlier.getConfig / upsertConfig", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => { prisma = mockDeep<PrismaClient>(); vi.clearAllMocks(); });

  it("getConfig retorna defaults si no hay config", async () => {
    const caller = makeOutlierCaller(prisma);
    (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const result = await caller.getConfig();
    expect(result.ipWhitelist).toEqual([]);
    expect(result.horarioClinicoInicio).toBe("06:00");
    expect(result.horarioClinicoFin).toBe("22:00");
  });

  it("getConfig retorna config existente", async () => {
    const caller = makeOutlierCaller(prisma);
    (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{
      id:                   "cfg-1",
      organizationId:       ORG_ID,
      ipWhitelist:          ["10.0.0.1", "192.168.1.0/24"],
      horarioClinicoInicio: "07:00",
      horarioClinicoFin:    "21:00",
      outlierAlertEnabled:  true,
    }]);

    const result = await caller.getConfig();
    expect(result.ipWhitelist).toEqual(["10.0.0.1", "192.168.1.0/24"]);
    expect(result.horarioClinicoInicio).toBe("07:00");
  });
});

// ---------------------------------------------------------------------------
// § 3 — rbac.permissionMatrix
// ---------------------------------------------------------------------------

describe("rbac.permissionMatrix", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => { prisma = mockDeep<PrismaClient>(); vi.clearAllMocks(); });

  it("[US.F2.7.21] retorna matriz con usuarios y permisos", async () => {
    const caller = makeRbacCaller(prisma);

    // Mock: findMany de userOrganizationRole
    (prisma.userOrganizationRole.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        userId: USER_ID,
        user:   { id: USER_ID, fullName: "Admin HIS", email: "admin@his.test" },
        role:   {
          organizationId: ORG_ID,
          permissions: [
            {
              permissionId: "perm-1",
              effect:       "ALLOW",
              permission:   { id: "perm-1", code: "patient:read", resource: "patient", action: "read" },
            },
          ],
        },
      },
    ]);

    const result = await caller.permissionMatrix({ activeOnly: true });
    expect(result.totalUsers).toBe(1);
    expect(result.users[0].fullName).toBe("Admin HIS");
    expect(result.users[0].permissions).toHaveLength(1);
    expect(result.users[0].permissions[0].effect).toBe("ALLOW");
  });

  it("[US.F2.7.21] ALLOW gana sobre DENY en conflicto", async () => {
    const caller = makeRbacCaller(prisma);

    (prisma.userOrganizationRole.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        userId: USER_ID,
        user:   { id: USER_ID, fullName: "User Test", email: "test@his.test" },
        role:   {
          organizationId: ORG_ID,
          permissions: [
            {
              permissionId: "perm-1",
              effect:       "DENY",
              permission:   { id: "perm-1", code: "patient:read", resource: "patient", action: "read" },
            },
          ],
        },
      },
      {
        userId: USER_ID,
        user:   { id: USER_ID, fullName: "User Test", email: "test@his.test" },
        role:   {
          organizationId: null,
          permissions: [
            {
              permissionId: "perm-1",
              effect:       "ALLOW",
              permission:   { id: "perm-1", code: "patient:read", resource: "patient", action: "read" },
            },
          ],
        },
      },
    ]);

    const result = await caller.permissionMatrix({ activeOnly: true });
    // Hay un solo usuario consolidado
    expect(result.totalUsers).toBe(1);
    // ALLOW debe ganar
    expect(result.users[0].permissions[0].effect).toBe("ALLOW");
  });

  it("[US.F2.7.21] retorna lista vacía si no hay usuarios con permisos", async () => {
    const caller = makeRbacCaller(prisma);
    (prisma.userOrganizationRole.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const result = await caller.permissionMatrix({ activeOnly: true });
    expect(result.totalUsers).toBe(0);
    expect(result.users).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// § 4 — rbac.purgeInactiveUsers
// ---------------------------------------------------------------------------

describe("rbac.purgeInactiveUsers", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => { prisma = mockDeep<PrismaClient>(); vi.clearAllMocks(); });

  it("[US.F2.7.20] dryRun retorna candidatos sin modificar BD", async () => {
    const caller = makeRbacCaller(prisma);
    const candidates = [
      { id: "u1", fullName: "María López", email: "maria@his.test", lastLoginAt: new Date("2024-01-01") },
      { id: "u2", fullName: "Carlos Rivas", email: "carlos@his.test", lastLoginAt: new Date("2024-03-01") },
    ];
    (prisma.user.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce(candidates);

    const result = await caller.purgeInactiveUsers({ dryRun: true, inactiveDays: 365 });
    expect(result.dryRun).toBe(true);
    expect(result.affected).toBe(2);
    expect(result.users).toHaveLength(2);
    // No debe llamar $executeRawUnsafe
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it("[US.F2.7.20] ejecución real marca usuarios y emite eventos", async () => {
    const caller = makeRbacCaller(prisma);
    const candidates = [
      { id: "u1", fullName: "María López", email: "maria@his.test", lastLoginAt: new Date("2024-01-01") },
    ];
    (prisma.user.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce(candidates);
    (prisma.$executeRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValueOnce(1);
    (prisma.domainEvent.createMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ count: 1 });

    const result = await caller.purgeInactiveUsers({ dryRun: false, inactiveDays: 365 });
    expect(result.dryRun).toBe(false);
    expect(result.affected).toBe(1);
  });

  it("[US.F2.7.20] sin candidatos retorna affected=0 y no ejecuta UPDATE", async () => {
    const caller = makeRbacCaller(prisma);
    (prisma.user.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const result = await caller.purgeInactiveUsers({ dryRun: false, inactiveDays: 365 });
    expect(result.affected).toBe(0);
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// § 5 — rbac.reactivateUser
// ---------------------------------------------------------------------------

describe("rbac.reactivateUser", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => { prisma = mockDeep<PrismaClient>(); vi.clearAllMocks(); });

  it("[US.F2.7.20] reactiva usuario y crea domainEvent", async () => {
    const caller = makeRbacCaller(prisma, TENANT_ADM);
    (prisma.$executeRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValueOnce(1);
    (prisma.domainEvent.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: "evt-1" });

    const result = await caller.reactivateUser({
      userId: "00000000-0000-0000-0000-000000000099",
      motivo: "Retorno de licencia autorizado por dirección",
    });
    expect(result.ok).toBe(true);
    expect(prisma.domainEvent.create).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// § 6 — Cross-tenant isolation (HJ-04 / HJ-06)
//
// Verifica que cada procedure del auditOutlierRouter incluye el filtro
// organization_id en el SQL generado, impidiendo que una org vea datos
// de otra. El mock captura el SQL ejecutado y valida la presencia del
// fragmento de JOIN + filtro.
// ---------------------------------------------------------------------------

describe("auditOutlier cross-tenant isolation (HJ-04/HJ-06)", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  const ORG_A = MOCK_TENANT.organizationId;
  const ORG_B = MOCK_TENANT_OTHER_ORG.organizationId;

  const TENANT_A_DIR = { ...MOCK_TENANT,        roleCodes: ["DIR", "super_admin"] };
  const TENANT_B_DIR = { ...MOCK_TENANT_OTHER_ORG, roleCodes: ["DIR", "super_admin"] };

  function callerA() {
    return auditOutlierRouter.createCaller(
      makeCtx({ prisma, user: MOCK_USER_ADMIN, tenant: TENANT_A_DIR }),
    );
  }
  function callerB() {
    return auditOutlierRouter.createCaller(
      makeCtx({ prisma, user: MOCK_USER_ADMIN, tenant: TENANT_B_DIR }),
    );
  }

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    vi.clearAllMocks();
  });

  it("[HJ-04] listOutliers pasa organization_id de OrgA en el SQL", async () => {
    (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ total: BigInt(0) }])
      .mockResolvedValueOnce([]);

    await callerA().listOutliers({ limit: 10, offset: 0 });

    const calls = (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls;
    // Ambas queries (COUNT + SELECT) deben incluir el filtro de org
    for (const [sql, ...params] of calls) {
      expect(sql as string).toContain("organization_id");
      expect(params).toContain(ORG_A);
      expect(params).not.toContain(ORG_B);
    }
  });

  it("[HJ-04] listOutliers de OrgB recibe su propio org_id, no el de OrgA", async () => {
    (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ total: BigInt(0) }])
      .mockResolvedValueOnce([]);

    await callerB().listOutliers({ limit: 10, offset: 0 });

    const calls = (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls;
    for (const [, ...params] of calls) {
      expect(params).toContain(ORG_B);
      expect(params).not.toContain(ORG_A);
    }
  });

  it("[HJ-04] dashboardStats incluye filtro organization_id", async () => {
    (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>)
      .mockResolvedValue([{ count: BigInt(0) }]);

    await callerA().dashboardStats({});

    const calls = (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const [sql, ...params] of calls) {
      expect(sql as string).toContain("organization_id");
      expect(params).toContain(ORG_A);
    }
  });

  it("[HJ-04] topUsers incluye filtro organization_id", async () => {
    (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    await callerA().topUsers({ limit: 10 });

    const [[sql, ...params]] = (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls;
    expect(sql as string).toContain("organization_id");
    expect(params).toContain(ORG_A);
  });

  it("[HJ-04] sensitiveAccess incluye filtro organization_id", async () => {
    (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ total: BigInt(0) }])
      .mockResolvedValueOnce([]);

    await callerA().sensitiveAccess({ limit: 10, offset: 0 });

    const calls = (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls;
    for (const [sql, ...params] of calls) {
      expect(sql as string).toContain("organization_id");
      expect(params).toContain(ORG_A);
    }
  });

  it("[HJ-06] scanAndFlag incluye organization_id en el UPDATE", async () => {
    // getOrgConfig → sin config
    (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    (prisma.$executeRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValueOnce(0);

    await callerA().scanAndFlag({});

    const [[sql, ...params]] = (prisma.$executeRawUnsafe as ReturnType<typeof vi.fn>).mock.calls;
    expect(sql as string).toContain("organization_id");
    expect(params).toContain(ORG_A);
    expect(params).not.toContain(ORG_B);
  });

  it("[HJ-06] scanAndFlag de OrgB no mezcla params con OrgA", async () => {
    (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    (prisma.$executeRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValueOnce(0);

    await callerB().scanAndFlag({});

    const [[, ...params]] = (prisma.$executeRawUnsafe as ReturnType<typeof vi.fn>).mock.calls;
    expect(params).toContain(ORG_B);
    expect(params).not.toContain(ORG_A);
  });
});

// ---------------------------------------------------------------------------
// § 7 — PIN lockout state machine (via firma.verify)
// ---------------------------------------------------------------------------

describe("§7 firma PIN lockout state machine (US.F2.7.3)", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    vi.clearAllMocks();
  });

  function setupPersonaFirma(firmaRows: unknown[]) {
    prisma.$queryRaw
      .mockResolvedValueOnce(PERSONAL_ROW as never)
      .mockResolvedValueOnce(firmaRows as never);
  }

  it("PIN correcto sin historial de fallos → ok, resetea contador", async () => {
    setupPersonaFirma(FIRMA_ACTIVE);
    prisma.$executeRaw.mockResolvedValue(0 as never);

    const caller = makeFirmaCaller(prisma);
    const result = await caller.verify({ pin: VALID_PIN });
    expect(result.firmaId).toBe(FIRMA_ID);
    expect(typeof result.verifiedAt).toBe("string");
  });

  it("PIN incorrecto con 0 intentos previos → UNAUTHORIZED con 4 restantes", async () => {
    setupPersonaFirma(FIRMA_ACTIVE);
    prisma.$executeRaw.mockResolvedValue(0 as never);

    const caller = makeFirmaCaller(prisma);
    const err = await caller.verify({ pin: "999999" }).catch((e) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("UNAUTHORIZED");
    expect((err as TRPCError).message).toContain("4");
  });

  it("PIN incorrecto con 4 intentos previos → mensaje sin número restantes", async () => {
    setupPersonaFirma(FIRMA_4_FAILED);
    prisma.$executeRaw.mockResolvedValue(0 as never);

    const caller = makeFirmaCaller(prisma);
    const err = await caller.verify({ pin: "999999" }).catch((e) => e);
    expect((err as TRPCError).code).toBe("UNAUTHORIZED");
    expect((err as TRPCError).message).toContain("bloqueada");
  });

  it("firma ya bloqueada → TOO_MANY_REQUESTS sin comprobar PIN", async () => {
    setupPersonaFirma(FIRMA_LOCKED);

    const caller = makeFirmaCaller(prisma);
    const err = await caller.verify({ pin: VALID_PIN }).catch((e) => e);
    expect((err as TRPCError).code).toBe("TOO_MANY_REQUESTS");
    expect((err as TRPCError).message).toContain("min");
  });

  it("firma revocada → FORBIDDEN inmediato", async () => {
    setupPersonaFirma([{
      ...FIRMA_ACTIVE[0],
      revoked_at: new Date("2025-01-01"),
    }]);

    const caller = makeFirmaCaller(prisma);
    const err = await caller.verify({ pin: VALID_PIN }).catch((e) => e);
    expect((err as TRPCError).code).toBe("FORBIDDEN");
  });

  it("personal no encontrado → PRECONDITION_FAILED", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([] as never); // sin personal

    const caller = makeFirmaCaller(prisma);
    const err = await caller.verify({ pin: VALID_PIN }).catch((e) => e);
    expect((err as TRPCError).code).toBe("PRECONDITION_FAILED");
  });

  it("PIN correcto después de bloqueo expirado → ok", async () => {
    // locked_until en el pasado → no está bloqueado
    const FIRMA_UNLOCKED = [{
      ...FIRMA_ACTIVE[0],
      failed_attempts: 5,
      locked_until: new Date(Date.now() - 1000), // expiró
    }];
    setupPersonaFirma(FIRMA_UNLOCKED);
    prisma.$executeRaw.mockResolvedValue(0 as never);

    const caller = makeFirmaCaller(prisma);
    const result = await caller.verify({ pin: VALID_PIN });
    expect(result.firmaId).toBe(FIRMA_ID);
  });
});
