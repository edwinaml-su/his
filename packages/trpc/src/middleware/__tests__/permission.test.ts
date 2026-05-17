/**
 * Tests del permission middleware (US-2.3 — RBAC enforcement en tRPC).
 *
 * Estrategia: se construye un mini-router de prueba que usa cada middleware
 * (`requirePermission`, `requirePermissions`, `requireAnyPermission`) sobre
 * una `tenantProcedure` real de tRPC, luego se invoca el caller con distintos
 * contextos mockeados.
 *
 * Comportamientos cubiertos:
 *  - ALLOW cuando el código de permiso está en el set del usuario.
 *  - FORBIDDEN cuando el código no está.
 *  - Bypass para roles ADMIN_GLOBAL y ADMIN.
 *  - DENY overrides ALLOW cuando el mismo código tiene ambos effects.
 *  - requirePermissions exige TODOS los códigos.
 *  - requireAnyPermission basta con UNO.
 *  - UNAUTHORIZED cuando no hay user o no hay tenant.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import { initTRPC, TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";
import type { TRPCContext } from "../../context";
import { requirePermission, requirePermissions, requireAnyPermission } from "../permission";
import { MOCK_USER_ADMIN, MOCK_TENANT } from "@his/test-utils";

// ---------------------------------------------------------------------------
// Mini-router de prueba
// ---------------------------------------------------------------------------
// Creamos un `t` de prueba para poder adjuntar los middlewares sin mezclar
// con el `t` del módulo (que ya fue inicializado).

const t = initTRPC.context<TRPCContext>().create();
const baseProcedure = t.procedure;

const testRouter = t.router({
  singlePermission: baseProcedure
    .use(requirePermission("patient:read"))
    .query(() => "ok"),

  allPermissions: baseProcedure
    .use(requirePermissions(["patient:read", "encounter:write"]))
    .query(() => "ok"),

  anyPermission: baseProcedure
    .use(requireAnyPermission(["patient:read", "audit:view"]))
    .query(() => "ok"),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUOR(
  code: string,
  permCodes: Array<{ code: string; effect: "ALLOW" | "DENY" }>,
) {
  return {
    role: {
      code,
      permissions: permCodes.map((p) => ({
        effect: p.effect,
        permission: { code: p.code },
      })),
    },
  };
}

function buildCtx(
  prisma: DeepMockProxy<PrismaClient>,
  opts: {
    user?: TRPCContext["user"] | null;
    tenant?: TRPCContext["tenant"] | null;
  } = {},
): TRPCContext {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma: prisma as any,
    user: opts.user === undefined ? MOCK_USER_ADMIN : opts.user,
    tenant: opts.tenant === undefined ? MOCK_TENANT : opts.tenant,
    portalAccount: null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("requirePermission", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  it("ALLOW cuando el usuario tiene el permiso", async () => {
    prisma.userOrganizationRole.findMany.mockResolvedValue([
      makeUOR("medico", [{ code: "patient:read", effect: "ALLOW" }]),
    ] as never);

    const caller = testRouter.createCaller(buildCtx(prisma));
    const result = await caller.singlePermission();
    expect(result).toBe("ok");
  });

  it("FORBIDDEN cuando el usuario NO tiene el permiso", async () => {
    prisma.userOrganizationRole.findMany.mockResolvedValue([
      makeUOR("lectura", [{ code: "patient:list", effect: "ALLOW" }]),
    ] as never);

    const caller = testRouter.createCaller(buildCtx(prisma));
    await expect(caller.singlePermission()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("ALLOW bypass para rol ADMIN_GLOBAL aunque no tenga el permiso explícito", async () => {
    prisma.userOrganizationRole.findMany.mockResolvedValue([
      makeUOR("ADMIN_GLOBAL", []), // sin permisos explícitos
    ] as never);

    const caller = testRouter.createCaller(buildCtx(prisma));
    const result = await caller.singlePermission();
    expect(result).toBe("ok");
  });

  it("ALLOW bypass para rol ADMIN", async () => {
    prisma.userOrganizationRole.findMany.mockResolvedValue([
      makeUOR("ADMIN", []),
    ] as never);

    const caller = testRouter.createCaller(buildCtx(prisma));
    const result = await caller.singlePermission();
    expect(result).toBe("ok");
  });

  it("DENY override: código con DENY elimina el ALLOW del mismo código", async () => {
    // Dos roles: uno ALLOW patient:read, otro DENY patient:read → DENY gana
    prisma.userOrganizationRole.findMany.mockResolvedValue([
      makeUOR("medico", [{ code: "patient:read", effect: "ALLOW" }]),
      makeUOR("restriccion", [{ code: "patient:read", effect: "DENY" }]),
    ] as never);

    const caller = testRouter.createCaller(buildCtx(prisma));
    await expect(caller.singlePermission()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("UNAUTHORIZED si no hay user", async () => {
    const caller = testRouter.createCaller(buildCtx(prisma, { user: null }));
    await expect(caller.singlePermission()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("UNAUTHORIZED si no hay tenant", async () => {
    const caller = testRouter.createCaller(buildCtx(prisma, { tenant: null }));
    await expect(caller.singlePermission()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("usuario sin roles → FORBIDDEN", async () => {
    prisma.userOrganizationRole.findMany.mockResolvedValue([] as never);

    const caller = testRouter.createCaller(buildCtx(prisma));
    await expect(caller.singlePermission()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("múltiples roles: ALLOW si al menos uno tiene el permiso (sin DENY)", async () => {
    prisma.userOrganizationRole.findMany.mockResolvedValue([
      makeUOR("triador", [{ code: "encounter:read", effect: "ALLOW" }]),
      makeUOR("medico", [{ code: "patient:read", effect: "ALLOW" }]),
    ] as never);

    const caller = testRouter.createCaller(buildCtx(prisma));
    const result = await caller.singlePermission();
    expect(result).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// requirePermissions (todos los códigos requeridos)
// ---------------------------------------------------------------------------

describe("requirePermissions", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  it("ALLOW cuando el usuario tiene TODOS los permisos", async () => {
    prisma.userOrganizationRole.findMany.mockResolvedValue([
      makeUOR("medico", [
        { code: "patient:read", effect: "ALLOW" },
        { code: "encounter:write", effect: "ALLOW" },
      ]),
    ] as never);

    const caller = testRouter.createCaller(buildCtx(prisma));
    const result = await caller.allPermissions();
    expect(result).toBe("ok");
  });

  it("FORBIDDEN cuando falta uno de los permisos", async () => {
    prisma.userOrganizationRole.findMany.mockResolvedValue([
      makeUOR("medico", [
        { code: "patient:read", effect: "ALLOW" },
        // falta encounter:write
      ]),
    ] as never);

    const caller = testRouter.createCaller(buildCtx(prisma));
    await expect(caller.allPermissions()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("FORBIDDEN cuando faltan todos los permisos", async () => {
    prisma.userOrganizationRole.findMany.mockResolvedValue([
      makeUOR("lectura", [{ code: "catalog:read", effect: "ALLOW" }]),
    ] as never);

    const caller = testRouter.createCaller(buildCtx(prisma));
    await expect(caller.allPermissions()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("bypass ADMIN_GLOBAL aunque no tenga ningún permiso explícito", async () => {
    prisma.userOrganizationRole.findMany.mockResolvedValue([
      makeUOR("ADMIN_GLOBAL", []),
    ] as never);

    const caller = testRouter.createCaller(buildCtx(prisma));
    const result = await caller.allPermissions();
    expect(result).toBe("ok");
  });

  it("UNAUTHORIZED si no hay tenant", async () => {
    const caller = testRouter.createCaller(buildCtx(prisma, { tenant: null }));
    await expect(caller.allPermissions()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

// ---------------------------------------------------------------------------
// requireAnyPermission (basta con uno)
// ---------------------------------------------------------------------------

describe("requireAnyPermission", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  it("ALLOW cuando el usuario tiene el primer código", async () => {
    prisma.userOrganizationRole.findMany.mockResolvedValue([
      makeUOR("medico", [{ code: "patient:read", effect: "ALLOW" }]),
    ] as never);

    const caller = testRouter.createCaller(buildCtx(prisma));
    const result = await caller.anyPermission();
    expect(result).toBe("ok");
  });

  it("ALLOW cuando el usuario tiene el segundo código", async () => {
    prisma.userOrganizationRole.findMany.mockResolvedValue([
      makeUOR("auditor", [{ code: "audit:view", effect: "ALLOW" }]),
    ] as never);

    const caller = testRouter.createCaller(buildCtx(prisma));
    const result = await caller.anyPermission();
    expect(result).toBe("ok");
  });

  it("FORBIDDEN cuando el usuario no tiene ninguno de los códigos", async () => {
    prisma.userOrganizationRole.findMany.mockResolvedValue([
      makeUOR("lectura", [{ code: "catalog:read", effect: "ALLOW" }]),
    ] as never);

    const caller = testRouter.createCaller(buildCtx(prisma));
    await expect(caller.anyPermission()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("bypass ADMIN_GLOBAL", async () => {
    prisma.userOrganizationRole.findMany.mockResolvedValue([
      makeUOR("ADMIN_GLOBAL", []),
    ] as never);

    const caller = testRouter.createCaller(buildCtx(prisma));
    const result = await caller.anyPermission();
    expect(result).toBe("ok");
  });

  it("FORBIDDEN si ambos códigos están con DENY", async () => {
    prisma.userOrganizationRole.findMany.mockResolvedValue([
      makeUOR("medico", [
        { code: "patient:read", effect: "ALLOW" },
        { code: "patient:read", effect: "DENY" }, // DENY elimina el ALLOW
      ]),
    ] as never);

    const caller = testRouter.createCaller(buildCtx(prisma));
    await expect(caller.anyPermission()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("UNAUTHORIZED si no hay user ni tenant", async () => {
    const caller = testRouter.createCaller(buildCtx(prisma, { user: null, tenant: null }));
    await expect(caller.anyPermission()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
