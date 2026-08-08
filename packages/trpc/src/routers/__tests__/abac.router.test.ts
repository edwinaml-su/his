/**
 * CC-0017 F2 — tests del abacRouter (CRUD de AbacRule).
 *
 * Patrón: tenantProcedure/requireRole → makeCtx con MOCK_TENANT (roleCodes
 * incluye ADMIN). withTenantContext → prisma.$transaction delegado al mismo
 * mock (igual que pharmacy-dispensation.router.test.ts).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { abacRouter } from "../abac.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

const orgId = MOCK_TENANT.organizationId;
const ruleId = "00000000-0000-0000-0000-0000000000f1";

function fakeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ruleId,
    organizationId: orgId,
    recurso: "patient",
    accion: "access",
    effect: "ALLOW",
    prioridad: 100,
    descripcion: "Regla de prueba.",
    condiciones: [{ atributo: "rol", operador: "EN", valor: ["medico"] }],
    active: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    createdBy: null,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    updatedBy: null,
    ...overrides,
  };
}

describe("abacRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    prisma.$transaction.mockImplementation(async (cb: unknown) => {
      if (typeof cb === "function") {
        return (cb as (tx: unknown) => Promise<unknown>)(prisma);
      }
      return cb;
    });
    prisma.$executeRawUnsafe.mockResolvedValue(0 as never);
  });

  describe("list", () => {
    it("filtra por organización activa", async () => {
      prisma.abacRule.findMany.mockResolvedValue([fakeRow()] as never);
      const caller = abacRouter.createCaller(makeCtx({ prisma }));
      const rows = await caller.list({});
      expect(rows).toHaveLength(1);
      expect(prisma.abacRule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ organizationId: orgId }) }),
      );
    });

    it("aplica filtro recurso/accion/activeOnly cuando se provee", async () => {
      prisma.abacRule.findMany.mockResolvedValue([] as never);
      const caller = abacRouter.createCaller(makeCtx({ prisma }));
      await caller.list({ recurso: "prescription", accion: "prescribe", activeOnly: true });
      expect(prisma.abacRule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            recurso: "prescription",
            accion: "prescribe",
            active: true,
          }),
        }),
      );
    });

    it("parsea condiciones a la forma tipada", async () => {
      prisma.abacRule.findMany.mockResolvedValue([fakeRow()] as never);
      const caller = abacRouter.createCaller(makeCtx({ prisma }));
      const [row] = await caller.list({});
      expect(row!.condiciones).toEqual([{ atributo: "rol", operador: "EN", valor: ["medico"] }]);
    });
  });

  describe("get", () => {
    it("NOT_FOUND si no existe en la org", async () => {
      prisma.abacRule.findFirst.mockResolvedValue(null as never);
      const caller = abacRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.get({ id: ruleId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("devuelve la regla cuando existe", async () => {
      prisma.abacRule.findFirst.mockResolvedValue(fakeRow() as never);
      const caller = abacRouter.createCaller(makeCtx({ prisma }));
      const row = await caller.get({ id: ruleId });
      expect(row.id).toBe(ruleId);
    });
  });

  describe("create", () => {
    it("crea la regla con organizationId del tenant", async () => {
      prisma.abacRule.create.mockResolvedValue(fakeRow() as never);
      const caller = abacRouter.createCaller(makeCtx({ prisma }));
      await caller.create({
        recurso: "prescription",
        accion: "prescribe",
        effect: "DENY",
        prioridad: 500,
        descripcion: "DENY de prueba.",
        condiciones: [],
      });
      expect(prisma.abacRule.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ organizationId: orgId, recurso: "prescription", effect: "DENY" }),
        }),
      );
    });

    it("requiere rol ADMIN/DIR — FORBIDDEN sin rol adecuado", async () => {
      const caller = abacRouter.createCaller(
        makeCtx({ prisma, tenant: { ...MOCK_TENANT, roleCodes: ["NURSE"] } }),
      );
      await expect(
        caller.create({ recurso: "patient", accion: "access", condiciones: [] }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("update", () => {
    it("NOT_FOUND si la regla no pertenece al tenant", async () => {
      prisma.abacRule.findFirst.mockResolvedValue(null as never);
      const caller = abacRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.update({ id: ruleId, prioridad: 10 })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("actualiza solo los campos enviados", async () => {
      prisma.abacRule.findFirst.mockResolvedValue({ id: ruleId } as never);
      prisma.abacRule.update.mockResolvedValue(fakeRow({ prioridad: 250 }) as never);
      const caller = abacRouter.createCaller(makeCtx({ prisma }));
      const row = await caller.update({ id: ruleId, prioridad: 250 });
      expect(row.prioridad).toBe(250);
      expect(prisma.abacRule.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ prioridad: 250 }) }),
      );
    });
  });

  describe("setActive", () => {
    it("NOT_FOUND si no pertenece al tenant", async () => {
      prisma.abacRule.findFirst.mockResolvedValue(null as never);
      const caller = abacRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.setActive({ id: ruleId, active: false })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("desactiva la regla", async () => {
      prisma.abacRule.findFirst.mockResolvedValue({ id: ruleId } as never);
      prisma.abacRule.update.mockResolvedValue(fakeRow({ active: false }) as never);
      const caller = abacRouter.createCaller(makeCtx({ prisma }));
      const row = await caller.setActive({ id: ruleId, active: false });
      expect(row.active).toBe(false);
    });
  });

  describe("delete", () => {
    it("NOT_FOUND si no pertenece al tenant", async () => {
      prisma.abacRule.findFirst.mockResolvedValue(null as never);
      const caller = abacRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.delete({ id: ruleId })).rejects.toBeInstanceOf(TRPCError);
    });

    it("elimina la regla existente", async () => {
      prisma.abacRule.findFirst.mockResolvedValue({ id: ruleId } as never);
      prisma.abacRule.delete.mockResolvedValue(fakeRow() as never);
      const caller = abacRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.delete({ id: ruleId });
      expect(result).toEqual({ ok: true, id: ruleId });
    });
  });
});
