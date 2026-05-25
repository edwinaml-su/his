/**
 * Tests del allocation-rule router.
 *
 * Dado que todas las queries usan $queryRawUnsafe (schema drift intencional),
 * los tests mockean esa función y verifican:
 *   - Validación de suma 100% en create/update (Zod refine + server check).
 *   - Rechazo cuando source no es "apoyo".
 *   - Rechazo cuando target no es productivo/intermedio.
 *   - list/get devuelven [] en entorno sin tabla (catch silencioso).
 *   - deactivate emite la query correcta.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import { allocationRuleRouter } from "../allocation-rule.router";
import { makeCtx } from "../../__tests__/helpers/caller";

const ORG_ID = "00000000-0000-0000-0000-0000000000aa";
const SOURCE_ID = "00000000-0000-0000-0000-000000000010";
const TARGET_A = "00000000-0000-0000-0000-000000000020";
const TARGET_B = "00000000-0000-0000-0000-000000000021";
const RULE_ID = "00000000-0000-0000-0000-000000000030";

function makePrisma(queryResults: unknown[][] = [], executeOk = true) {
  let queryCallIdx = 0;
  return {
    $queryRawUnsafe: vi.fn().mockImplementation(() => {
      const res = queryResults[queryCallIdx] ?? [];
      queryCallIdx++;
      return Promise.resolve(res);
    }),
    $executeRawUnsafe: vi.fn().mockResolvedValue(executeOk ? 1 : 0),
    $transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      // En tx, usamos el mismo mock para que los INSERTs funcionen
      const tx = {
        $queryRawUnsafe: vi.fn().mockResolvedValue([{ id: RULE_ID }]),
        $executeRawUnsafe: vi.fn().mockResolvedValue(1),
      };
      return fn(tx);
    }),
  };
}

describe("allocationRuleRouter", () => {
  // ------------------------------------------------------------------ list
  describe("list", () => {
    it("devuelve [] cuando la tabla no existe (catch silencioso)", async () => {
      const prisma = {
        $queryRawUnsafe: vi.fn().mockRejectedValue(new Error("relation does not exist")),
      };
      const caller = allocationRuleRouter.createCaller(makeCtx({ prisma: prisma as never }));
      const result = await caller.list({});
      expect(result).toEqual([]);
    });

    it("retorna reglas con targets cuando la tabla existe", async () => {
      const ruleRow = {
        id: RULE_ID,
        organizationId: ORG_ID,
        name: "Regla Lavandería",
        sourceCostCenterId: SOURCE_ID,
        sourceCode: "3-LAV-GEN",
        sourceName: "Lavandería",
        base: "kilos_lavados",
        periodicity: "monthly",
        active: true,
      };
      const targetRow = {
        id: "t1",
        ruleId: RULE_ID,
        targetCostCenterId: TARGET_A,
        targetCode: "1-CEX-GEN",
        targetName: "Consulta Externa",
        percentage: "100.00",
      };
      // Primera llamada → rules, segunda → targets
      const prisma = makePrisma([[ruleRow], [targetRow]]);
      const caller = allocationRuleRouter.createCaller(makeCtx({ prisma: prisma as never }));
      const result = await caller.list({});
      expect(result).toHaveLength(1);
      expect(result[0]?.targets[0]?.percentage).toBe(100);
    });
  });

  // ------------------------------------------------------------------ get
  describe("get", () => {
    it("lanza NOT_FOUND si la regla no existe", async () => {
      const prisma = makePrisma([[]]);
      const caller = allocationRuleRouter.createCaller(makeCtx({ prisma: prisma as never }));
      await expect(caller.get({ id: RULE_ID })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // ------------------------------------------------------------------ create (validaciones)
  describe("create", () => {
    it("lanza BAD_REQUEST cuando suma de porcentajes != 100", async () => {
      // El Zod refine rechaza antes de llegar al servidor
      const prisma = makePrisma();
      const caller = allocationRuleRouter.createCaller(makeCtx({ prisma: prisma as never }));
      await expect(
        caller.create({
          name: "Regla inválida",
          sourceCostCenterId: SOURCE_ID,
          base: "kilos_lavados",
          periodicity: "monthly",
          targets: [
            { targetCostCenterId: TARGET_A, percentage: 60 },
            { targetCostCenterId: TARGET_B, percentage: 30 }, // suma = 90
          ],
        }),
      ).rejects.toThrow(); // ZodError por refine
    });

    it("lanza BAD_REQUEST cuando source no es apoyo", async () => {
      // Primera query (assertSourceIsApoyo): retorna tipo != apoyo
      const prisma = makePrisma([[{ tipo: "productivo" }]]);
      const caller = allocationRuleRouter.createCaller(makeCtx({ prisma: prisma as never }));
      await expect(
        caller.create({
          name: "Regla test",
          sourceCostCenterId: SOURCE_ID,
          base: "porcentaje_manual",
          periodicity: "monthly",
          targets: [{ targetCostCenterId: TARGET_A, percentage: 100 }],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("lanza BAD_REQUEST cuando target no es productivo o intermedio", async () => {
      // Primera query (assertSourceIsApoyo): apoyo OK
      // Segunda query (assertTargetsAreValid): target es "apoyo"
      const prisma = makePrisma([
        [{ tipo: "apoyo" }],
        [{ id: TARGET_A, tipo: "apoyo" }], // inválido como target
      ]);
      const caller = allocationRuleRouter.createCaller(makeCtx({ prisma: prisma as never }));
      await expect(
        caller.create({
          name: "Regla test",
          sourceCostCenterId: SOURCE_ID,
          base: "porcentaje_manual",
          periodicity: "monthly",
          targets: [{ targetCostCenterId: TARGET_A, percentage: 100 }],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("crea regla cuando validaciones pasan", async () => {
      const prisma = makePrisma([
        [{ tipo: "apoyo" }],         // assertSourceIsApoyo
        [{ id: TARGET_A, tipo: "productivo" }], // assertTargetsAreValid
      ]);
      // $transaction mock ya retorna { id: RULE_ID }
      const caller = allocationRuleRouter.createCaller(makeCtx({ prisma: prisma as never }));
      const result = await caller.create({
        name: "Regla Lavandería",
        sourceCostCenterId: SOURCE_ID,
        base: "kilos_lavados",
        periodicity: "monthly",
        targets: [{ targetCostCenterId: TARGET_A, percentage: 100 }],
      });
      expect(result).toMatchObject({ id: RULE_ID });
    });
  });

  // ------------------------------------------------------------------ deactivate
  describe("deactivate", () => {
    it("emite UPDATE con active=false", async () => {
      const prisma = makePrisma();
      const caller = allocationRuleRouter.createCaller(makeCtx({ prisma: prisma as never }));
      const result = await caller.deactivate({ id: RULE_ID });
      expect(result).toMatchObject({ id: RULE_ID });
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining("active = false"),
        RULE_ID,
      );
    });
  });

  // ------------------------------------------------------------------ runProration
  describe("runProration", () => {
    it("devuelve [] cuando no hay reglas activas", async () => {
      const prisma = makePrisma([[]]); // query reglas → []
      const caller = allocationRuleRouter.createCaller(makeCtx({ prisma: prisma as never }));
      const result = await caller.runProration({
        periodStart: "2026-05-01T00:00:00.000Z",
        periodEnd: "2026-05-31T23:59:59.999Z",
        organizationId: ORG_ID,
      });
      expect(result).toEqual([]);
    });
  });
});
