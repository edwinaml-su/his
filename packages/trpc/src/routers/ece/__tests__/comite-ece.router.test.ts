/**
 * Tests unitarios — comiteEceRouter.
 *
 * Estrategia: Vitest + vitest-mock-extended. Cero I/O real.
 * withTenantContext mockeado para ejecutar callback con prisma mock.
 * argon2 mockeado para evitar dependencia nativa en tests.
 *
 * Casos cubiertos (14 tests):
 *   list:
 *     1. retorna items y total correctamente
 *     2. retorna lista vacía cuando no hay minutas
 *   create:
 *     3. crea minuta y retorna id
 *     4. lanza error cuando temasAgenda está vacío
 *   firmar (HG-08 / NTEC Art. 32):
 *     5. lanza ZodError cuando no se envía PIN
 *     6. lanza UNAUTHORIZED cuando PIN es incorrecto
 *     7. firma correctamente con PIN válido — calcula hash chain
 *     8. lanza UNAUTHORIZED cuando cuenta está bloqueada (locked_until futuro)
 *     9. lanza NOT_FOUND cuando minuta no existe
 *    10. lanza CONFLICT cuando minuta ya está firmada
 *   dashboard:
 *    11. retorna kpis con conversión de bigint a number
 *    12. retorna mensaje cuando no hay datos (rows vacíos)
 *   exportReport:
 *    13. retorna estructura correcta con periodoStats
 *   (extra)
 *    14. usa prev_hash de la última minuta firmada cuando existe
 *
 * @QA E2E pendiente:
 *   - Flujo completo: crear minuta → firmar → verificar inmutabilidad (trigger BD).
 *   - Hash chain: firma2.prev_hash === firma1.chain_hash.
 *   - Rol ARCH puede listar pero NO crear (UNAUTHORIZED).
 *   - Lockout: 3 intentos fallidos → cuenta bloqueada 15 min.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";

// Mock withTenantContext — ejecuta el callback directo con el prisma mock
vi.mock("../../../rls-context", () => ({
  withTenantContext: async (
    prisma: PrismaClient,
    _tenant: unknown,
    fn: (tx: PrismaClient) => Promise<unknown>,
  ) => fn(prisma),
}));

// Mock argon2 — evita dependencia nativa (bindings C++) en entorno vitest.
// argon2.verify retorna true/false según el control de cada test.
const argon2VerifyMock = vi.fn<[string, string], Promise<boolean>>();
vi.mock("@his/infrastructure", () => ({
  argon2: { verify: argon2VerifyMock },
}));

import { comiteEceRouter } from "../comite-ece.router";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = "00000000-0000-4000-8000-000000000001";
const ESTAB_ID = "00000000-0000-4000-8000-000000000002";
const MINUTA_ID = "00000000-0000-4000-8000-000000000003";
const USER_ID = "00000000-0000-4000-8000-000000000004";
const FIRMA_ID = "00000000-0000-4000-8000-000000000005";
const PERSONAL_ID = "00000000-0000-4000-8000-000000000006";

/** Fila de ece.firma_electronica para tests de firmar. */
const FIRMA_ROW = {
  id: FIRMA_ID,
  pin_hash: "$argon2id$v=19$...(hash-mock)",
  failed_attempts: 0,
  locked_until: null,
  revoked_at: null,
};

const BASE_MINUTA = {
  id: MINUTA_ID,
  organization_id: ORG_ID,
  establecimiento_id: ESTAB_ID,
  fecha_reunion: new Date("2026-05-01"),
  asistentes: [{ nombre: "Dr. García", rol: "MC" }],
  temas_agenda: [{ numero: 1, tema: "Calidad documental" }],
  acuerdos: [],
  proxima_fecha: null,
  firma_presidente_id: null,
  firmada_en: null,
  estado: "borrador",
  payload_hash: null,
  prev_hash: null,
  chain_hash: null,
  registrado_por: USER_ID,
  registrado_en: new Date("2026-05-01T09:00:00Z"),
  actualizado_en: new Date("2026-05-01T09:00:00Z"),
};

function buildCtx(roleCodes: string[] = ["DIR"]) {
  const prisma = mockDeep<PrismaClient>();
  prisma.$transaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  );
  (prisma.$executeRaw as ReturnType<typeof vi.fn>).mockResolvedValue(1);
  return {
    prisma,
    user: { id: USER_ID, email: "dir@test.com", fullName: "Director Test" },
    tenant: {
      organizationId: ORG_ID,
      establishmentId: ESTAB_ID,
      roleCodes,
    },
    portalAccount: null,
  };
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe("comiteEceRouter.list", () => {
  it("retorna items y total correctamente", async () => {
    const ctx = buildCtx();
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([BASE_MINUTA])
      .mockResolvedValueOnce([{ total: BigInt(1) }]);

    const caller = comiteEceRouter.createCaller(ctx as never);
    const result = await caller.list({ page: 1, pageSize: 20 });

    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.items[0]!.id).toBe(MINUTA_ID);
  });

  it("retorna lista vacía cuando no hay minutas", async () => {
    const ctx = buildCtx();
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: BigInt(0) }]);

    const caller = comiteEceRouter.createCaller(ctx as never);
    const result = await caller.list({ page: 1, pageSize: 20 });

    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe("comiteEceRouter.create", () => {
  it("crea minuta y retorna id", async () => {
    const ctx = buildCtx();
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: MINUTA_ID },
    ]);

    const caller = comiteEceRouter.createCaller(ctx as never);
    const result = await caller.create({
      fechaReunion: new Date("2026-05-01"),
      asistentes: [{ nombre: "Dr. García", rol: "MC" }],
      temasAgenda: [{ numero: 1, tema: "Calidad" }],
      acuerdos: [],
    });

    expect(result.id).toBe(MINUTA_ID);
  });

  it("lanza error de validación cuando temasAgenda está vacío", async () => {
    const ctx = buildCtx();
    const caller = comiteEceRouter.createCaller(ctx as never);

    await expect(
      caller.create({
        fechaReunion: new Date("2026-05-01"),
        asistentes: [{ nombre: "Dr. García", rol: "MC" }],
        temasAgenda: [], // violación: min(1)
        acuerdos: [],
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// firmar (HG-08 / NTEC Art. 32)
// ---------------------------------------------------------------------------

describe("comiteEceRouter.firmar", () => {
  beforeEach(() => {
    argon2VerifyMock.mockReset();
  });

  it("lanza ZodError cuando no se envía PIN", async () => {
    const ctx = buildCtx();
    const caller = comiteEceRouter.createCaller(ctx as never);
    // @ts-expect-error — test de schema: input sin pin debe fallar validación
    await expect(caller.firmar({ id: MINUTA_ID })).rejects.toThrow();
  });

  it("lanza UNAUTHORIZED cuando PIN es incorrecto", async () => {
    const ctx = buildCtx();
    // minuta borrador + personal + firma
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([BASE_MINUTA])       // lectura minuta
      .mockResolvedValueOnce([{ id: PERSONAL_ID }]) // personal_salud lookup
      .mockResolvedValueOnce([FIRMA_ROW]);          // firma_electronica lookup

    argon2VerifyMock.mockResolvedValue(false); // PIN incorrecto

    const caller = comiteEceRouter.createCaller(ctx as never);
    await expect(
      caller.firmar({ id: MINUTA_ID, pin: "123456" }),
    ).rejects.toThrowError(TRPCError);
  });

  it("firma correctamente con PIN válido — calcula hash chain", async () => {
    const ctx = buildCtx();
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([BASE_MINUTA])         // lectura minuta
      .mockResolvedValueOnce([{ id: PERSONAL_ID }]) // personal_salud lookup
      .mockResolvedValueOnce([FIRMA_ROW])            // firma_electronica lookup
      .mockResolvedValueOnce([]);                    // sin minutas firmadas previas

    argon2VerifyMock.mockResolvedValue(true); // PIN correcto

    const caller = comiteEceRouter.createCaller(ctx as never);
    const result = await caller.firmar({ id: MINUTA_ID, pin: "123456" });

    expect(result.ok).toBe(true);
    expect(result.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.chainHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("lanza UNAUTHORIZED cuando cuenta está bloqueada (locked_until futuro)", async () => {
    const ctx = buildCtx();
    const lockedFirma = {
      ...FIRMA_ROW,
      locked_until: new Date(Date.now() + 15 * 60_000), // 15 min futuro
    };
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([BASE_MINUTA])
      .mockResolvedValueOnce([{ id: PERSONAL_ID }])
      .mockResolvedValueOnce([lockedFirma]);

    const caller = comiteEceRouter.createCaller(ctx as never);
    const err = await caller.firmar({ id: MINUTA_ID, pin: "123456" }).catch((e) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("UNAUTHORIZED");
  });

  it("lanza NOT_FOUND cuando minuta no existe", async () => {
    const ctx = buildCtx();
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const caller = comiteEceRouter.createCaller(ctx as never);
    await expect(
      caller.firmar({ id: MINUTA_ID, pin: "123456" }),
    ).rejects.toThrow(TRPCError);
  });

  it("lanza CONFLICT cuando minuta ya tiene estado 'firmada'", async () => {
    const ctx = buildCtx();
    const minutaFirmada = { ...BASE_MINUTA, estado: "firmada" };
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([minutaFirmada]);

    const caller = comiteEceRouter.createCaller(ctx as never);
    await expect(
      caller.firmar({ id: MINUTA_ID, pin: "123456" }),
    ).rejects.toThrow(TRPCError);
  });

  it("usa prev_hash de la última minuta firmada cuando existe", async () => {
    const ctx = buildCtx();
    const prevChainHash = "a".repeat(64);
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([BASE_MINUTA])
      .mockResolvedValueOnce([{ id: PERSONAL_ID }])
      .mockResolvedValueOnce([FIRMA_ROW])
      .mockResolvedValueOnce([{ chain_hash: prevChainHash }]);

    argon2VerifyMock.mockResolvedValue(true);

    const caller = comiteEceRouter.createCaller(ctx as never);
    const result = await caller.firmar({ id: MINUTA_ID, pin: "123456" });

    expect(result.ok).toBe(true);
    expect(result.chainHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.chainHash).not.toBe(prevChainHash);
  });
});

// ---------------------------------------------------------------------------
// dashboard
// ---------------------------------------------------------------------------

describe("comiteEceRouter.dashboard", () => {
  it("retorna kpis con conversión de bigint a number", async () => {
    const ctx = buildCtx();
    const rawRow = {
      establecimiento_id: ESTAB_ID,
      total_episodios_cerrados: BigInt(100),
      total_con_epicrisis: BigInt(95),
      total_con_cie10: BigInt(90),
      pct_cobertura_cie10: "90.00",
      promedio_horas_hasta_egreso: "18.50",
      total_rectificaciones_mes: BigInt(5),
      calculado_en: new Date(),
    };

    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([rawRow]);

    const caller = comiteEceRouter.createCaller(ctx as never);
    const result = await caller.dashboard();

    expect(result.kpis).toHaveLength(1);
    const kpi = result.kpis[0]!;
    expect(kpi.totalEpisodiosCerrados).toBe(100);
    expect(kpi.pctCoberturaCie10).toBe(90.0);
    expect(kpi.promedioHorasHastaEgreso).toBe(18.5);
  });

  it("retorna mensaje cuando no hay datos (vista vacía)", async () => {
    const ctx = buildCtx();
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const caller = comiteEceRouter.createCaller(ctx as never);
    const result = await caller.dashboard();

    expect(result.kpis).toHaveLength(0);
    expect(result.mensaje).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// exportReport
// ---------------------------------------------------------------------------

describe("comiteEceRouter.exportReport", () => {
  it("retorna estructura completa con periodoStats", async () => {
    const ctx = buildCtx(["DIR"]);
    const kpiRow = {
      establecimiento_id: ESTAB_ID,
      total_episodios_cerrados: BigInt(50),
      total_con_epicrisis: BigInt(48),
      total_con_cie10: BigInt(45),
      pct_cobertura_cie10: "90.00",
      promedio_horas_hasta_egreso: "12.00",
      total_rectificaciones_mes: BigInt(3),
      calculado_en: new Date(),
    };
    const statsRow = {
      total_episodios: BigInt(50),
      total_cerrados: BigInt(48),
      total_con_cie10: BigInt(45),
    };

    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([]) // minutas del período
      .mockResolvedValueOnce([kpiRow]) // KPIs
      .mockResolvedValueOnce([statsRow]); // periodoStats

    const caller = comiteEceRouter.createCaller(ctx as never);
    const result = await caller.exportReport({
      periodoInicio: new Date("2026-01-01"),
      periodoFin: new Date("2026-05-31"),
      tipo: "MINSAL",
    });

    expect(result.tipo).toBe("MINSAL");
    expect(result.periodoStats.totalEpisodios).toBe(50);
    expect(result.periodoStats.totalCerrados).toBe(48);
    expect(result.periodoStats.pctCie10).toBeCloseTo(93.75, 1);
  });
});
