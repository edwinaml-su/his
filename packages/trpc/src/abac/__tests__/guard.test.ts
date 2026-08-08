/**
 * CC-0017 F2 — tests de `abacGuard` cableado en un router de prueba.
 *
 * No se testea contra un router real (evita acoplar el test a
 * indicaciones-medicas/pharmacy-dispensation) — se arma un router mínimo con
 * `router({ ping: tenantProcedure.input(...).use(abacGuard(...)).query(...) })`
 * y se verifica ALLOW/DENY/fail-safe a través del `createCaller`.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure, protectedProcedure } from "../../trpc";
import { abacGuard } from "../guard";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

const testRouter = router({
  ping: tenantProcedure
    .input(z.object({ pacienteConTriaje: z.boolean().optional() }).default({}))
    .use(
      abacGuard<{ pacienteConTriaje?: boolean }>("patient", "access", (_ctx, input) => ({
        pacienteConTriaje: input.pacienteConTriaje,
      })),
    )
    .query(() => ({ ok: true as const })),

  pingSinTenant: protectedProcedure
    .input(z.object({}).default({}))
    .use(abacGuard("signature", "sign"))
    .query(() => ({ ok: true as const })),
});

describe("abacGuard", () => {
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

  it("ALLOW cuando no hay reglas (fail-safe)", async () => {
    prisma.abacRule.findMany.mockResolvedValue([] as never);
    const caller = testRouter.createCaller(makeCtx({ prisma }));
    await expect(caller.ping({})).resolves.toEqual({ ok: true });
  });

  it("DENY lanza FORBIDDEN", async () => {
    prisma.abacRule.findMany.mockResolvedValue([
      {
        id: "deny-1",
        organizationId: MOCK_TENANT.organizationId,
        recurso: "patient",
        accion: "access",
        effect: "DENY",
        prioridad: 100,
        descripcion: "Bloqueado en test.",
        condiciones: [],
        active: true,
        createdAt: new Date(),
        createdBy: null,
        updatedAt: new Date(),
        updatedBy: null,
      },
    ] as never);

    const caller = testRouter.createCaller(makeCtx({ prisma }));
    await expect(caller.ping({})).rejects.toThrow(TRPCError);
    await expect(caller.ping({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("extractAtributos enriquece los atributos evaluados (condición sobre input)", async () => {
    prisma.abacRule.findMany.mockResolvedValue([
      {
        id: "deny-triage",
        organizationId: MOCK_TENANT.organizationId,
        recurso: "patient",
        accion: "access",
        effect: "DENY",
        prioridad: 100,
        descripcion: "Sin triage activo, denegado.",
        condiciones: [{ atributo: "pacienteConTriaje", operador: "ES_FALSO", valor: true }],
        active: true,
        createdAt: new Date(),
        createdBy: null,
        updatedAt: new Date(),
        updatedBy: null,
      },
    ] as never);

    const caller = testRouter.createCaller(makeCtx({ prisma }));
    // pacienteConTriaje=false → matchea el DENY.
    await expect(caller.ping({ pacienteConTriaje: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // pacienteConTriaje=true → NO matchea el DENY (ES_FALSO es false) → fail-safe ALLOW.
    await expect(caller.ping({ pacienteConTriaje: true })).resolves.toEqual({ ok: true });
  });

  it("sin ctx.tenant (protectedProcedure) se salta la evaluación — fail-safe ALLOW", async () => {
    const caller = testRouter.createCaller(makeCtx({ prisma, tenant: null }));
    await expect(caller.pingSinTenant({})).resolves.toEqual({ ok: true });
    // Ni siquiera se consultó AbacRule.
    expect(prisma.abacRule.findMany).not.toHaveBeenCalled();
  });
});
