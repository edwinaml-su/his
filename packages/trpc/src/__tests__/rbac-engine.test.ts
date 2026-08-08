/**
 * CC-0017 — tests end-to-end de `requireRole` / `requirePermission`
 * (packages/trpc/src/trpc.ts) a través de un router mínimo, ejercitando el
 * middleware completo (no sólo las funciones puras de effective-roles.ts).
 *
 * Objetivo central: probar la identidad de comportamiento en el caso base
 * ("sin herencia/alias configurados, requireRole se comporta EXACTAMENTE
 * igual que antes de CC-0017") y que la herencia realmente parametriza el
 * acceso sin tocar el literal `requireRole([...])`.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { router, requireRole, requirePermission } from "../trpc";
import { makeCtx } from "./helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

const testRouter = router({
  physicianOnly: requireRole(["PHYSICIAN"])
    .input(z.object({}).default({}))
    .query(() => "ok" as const),
  postAccounting: requirePermission("accounting.post")
    .input(z.object({}).default({}))
    .mutation(() => "posted" as const),
});

describe("requireRole — caso base (fail-safe, identidad con comportamiento pre-CC-0017)", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  it("ALLOW: usuario con el rol directo pasa (prisma.role.findMany sin mockear)", async () => {
    const tenant = { ...MOCK_TENANT, roleCodes: ["PHYSICIAN"] };
    const caller = testRouter.createCaller(makeCtx({ prisma, tenant }));
    await expect(caller.physicianOnly({})).resolves.toBe("ok");
  });

  it("DENY: usuario sin el rol requerido sigue rechazado (mismo resultado que antes)", async () => {
    const tenant = { ...MOCK_TENANT, roleCodes: ["NURSE"] };
    const caller = testRouter.createCaller(makeCtx({ prisma, tenant }));
    await expect(caller.physicianOnly({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("DENY: Role.findMany devuelve [] (tablas nuevas sin seed) — mismo resultado que sin CC-0017", async () => {
    prisma.role.findMany.mockResolvedValue([] as never);
    const tenant = { ...MOCK_TENANT, roleCodes: ["NURSE"] };
    const caller = testRouter.createCaller(makeCtx({ prisma, tenant }));
    await expect(caller.physicianOnly({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("requireRole — herencia parametriza el acceso sin tocar el literal", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  it("un rol NUEVO que hereda de PHYSICIAN pasa requireRole([\"PHYSICIAN\"]) sin estar en el array literal", async () => {
    prisma.role.findMany
      .mockResolvedValueOnce([
        { id: "child", code: "MEDICO_RESIDENTE_JR", inheritsFromRoleId: "parent" },
      ] as never)
      .mockResolvedValueOnce([
        { id: "parent", code: "PHYSICIAN", inheritsFromRoleId: null },
      ] as never);
    prisma.roleCodeAlias.findMany.mockResolvedValue([] as never);

    const tenant = { ...MOCK_TENANT, roleCodes: ["MEDICO_RESIDENTE_JR"] };
    const caller = testRouter.createCaller(makeCtx({ prisma, tenant }));
    await expect(caller.physicianOnly({})).resolves.toBe("ok");
  });

  it("un alias resuelto (MEDICO -> PHYSICIAN) pasa requireRole([\"PHYSICIAN\"])", async () => {
    prisma.role.findMany.mockResolvedValueOnce([
      { id: "r1", code: "MEDICO", inheritsFromRoleId: null },
    ] as never);
    prisma.roleCodeAlias.findMany.mockResolvedValue([
      { canonicalCode: "PHYSICIAN" },
    ] as never);

    const tenant = { ...MOCK_TENANT, roleCodes: ["MEDICO"] };
    const caller = testRouter.createCaller(makeCtx({ prisma, tenant }));
    await expect(caller.physicianOnly({})).resolves.toBe("ok");
  });
});

describe("requirePermission — nuevo gate opt-in", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  it("ALLOW cuando el seed otorga el permiso al rol efectivo", async () => {
    prisma.role.findMany.mockResolvedValue([
      { id: "r1", code: "ADMIN", inheritsFromRoleId: null },
    ] as never);
    prisma.roleCodeAlias.findMany.mockResolvedValue([] as never);
    prisma.rolePermission.findMany.mockResolvedValue([
      { effect: "ALLOW", permission: { code: "accounting.post" } },
    ] as never);

    const tenant = { ...MOCK_TENANT, roleCodes: ["ADMIN"] };
    const caller = testRouter.createCaller(makeCtx({ prisma, tenant }));
    await expect(caller.postAccounting({})).resolves.toBe("posted");
  });

  it("DENY por defecto sin seed aplicado (RolePermission vacío)", async () => {
    const tenant = { ...MOCK_TENANT, roleCodes: ["ADMIN"] };
    const caller = testRouter.createCaller(makeCtx({ prisma, tenant }));
    await expect(caller.postAccounting({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("DENY cuando el permiso está explícitamente denegado (DENY gana sobre ALLOW)", async () => {
    prisma.role.findMany.mockResolvedValue([
      { id: "r1", code: "ADMIN", inheritsFromRoleId: null },
      { id: "r2", code: "SUSPENDED_ADMIN", inheritsFromRoleId: null },
    ] as never);
    prisma.roleCodeAlias.findMany.mockResolvedValue([] as never);
    prisma.rolePermission.findMany.mockResolvedValue([
      { effect: "ALLOW", permission: { code: "accounting.post" } },
      { effect: "DENY", permission: { code: "accounting.post" } },
    ] as never);

    const tenant = { ...MOCK_TENANT, roleCodes: ["ADMIN", "SUSPENDED_ADMIN"] };
    const caller = testRouter.createCaller(makeCtx({ prisma, tenant }));
    await expect(caller.postAccounting({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
