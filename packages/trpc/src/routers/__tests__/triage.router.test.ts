/**
 * Tests del triage router.
 * Cubre: listLevels (orden por priority), listPending (orden por admittedAt
 * asc), createEvaluation con vitalSigns + discriminatorHits anidados.
 *
 * Limitación: la "alerta visual de nivel rojo" es un efecto de UI; el
 * router solo retorna el assignedLevel embebido. La presencia visual de
 * la alerta se valida en el E2E `triage-manchester.spec.ts`.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { triageRouter } from "../triage.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT_NO_ESTABLISHMENT } from "@his/test-utils";

describe("triageRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  describe("listLevels", () => {
    it("retorna niveles activos ordenados por priority asc", async () => {
      prisma.triageLevel.findMany.mockResolvedValue([] as never);

      const caller = triageRouter.createCaller(makeCtx({ prisma }));
      await caller.listLevels();

      const args = prisma.triageLevel.findMany.mock.calls[0]![0];
      expect(args.where).toMatchObject({ active: true });
      expect(args.orderBy).toEqual({ priority: "asc" });
    });
  });

  describe("listPending", () => {
    it("filtra encuentros sin alta y sin triage COMPLETED", async () => {
      prisma.encounter.findMany.mockResolvedValue([] as never);

      const caller = triageRouter.createCaller(makeCtx({ prisma }));
      await caller.listPending();

      const args = prisma.encounter.findMany.mock.calls[0]![0];
      expect(args.where).toMatchObject({
        dischargedAt: null,
        triages: { none: { status: "COMPLETED" } },
      });
      expect(args.orderBy).toEqual({ admittedAt: "asc" });
    });
  });

  describe("createEvaluation", () => {
    it("falla si no hay establecimiento seleccionado", async () => {
      const caller = triageRouter.createCaller(
        makeCtx({ prisma, tenant: MOCK_TENANT_NO_ESTABLISHMENT }),
      );

      await expect(
        caller.createEvaluation({
          patientId: "00000000-0000-0000-0000-000000000010",
          flowchartId: "00000000-0000-0000-0000-000000000020",
          assignedLevelId: "00000000-0000-0000-0000-000000000030",
        } as never),
      ).rejects.toThrow(/establecimiento/i);
    });

    it("crea evaluación con signos y discriminadores anidados (status=COMPLETED)", async () => {
      prisma.triageEvaluation.create.mockResolvedValue({ id: "tev1" } as never);

      const caller = triageRouter.createCaller(makeCtx({ prisma }));
      await caller.createEvaluation({
        patientId: "00000000-0000-0000-0000-000000000010",
        flowchartId: "00000000-0000-0000-0000-000000000020",
        assignedLevelId: "00000000-0000-0000-0000-000000000030",
        vitalSigns: [
          { vitalCode: "BP_SYS", valueNumeric: 90 },
          { vitalCode: "HR", valueNumeric: 130 },
        ],
        discriminatorHits: [
          { discriminatorId: "00000000-0000-0000-0000-000000000040", positive: true },
        ],
      } as never);

      const args = prisma.triageEvaluation.create.mock.calls[0]![0];
      expect(args.data.status).toBe("COMPLETED");
      expect(args.data.completedAt).toBeInstanceOf(Date);
      expect(args.data.vitalSigns).toEqual({
        create: expect.arrayContaining([
          expect.objectContaining({ vitalCode: "BP_SYS" }),
        ]),
      });
      expect(args.data.discriminatorHits).toEqual({
        create: expect.arrayContaining([
          expect.objectContaining({ positive: true }),
        ]),
      });
    });

    it("acepta override con justificación", async () => {
      prisma.triageEvaluation.create.mockResolvedValue({ id: "tev2" } as never);
      const caller = triageRouter.createCaller(makeCtx({ prisma }));
      await caller.createEvaluation({
        patientId: "00000000-0000-0000-0000-000000000010",
        flowchartId: "00000000-0000-0000-0000-000000000020",
        assignedLevelId: "00000000-0000-0000-0000-000000000030",
        systemSuggestedLevelId: "00000000-0000-0000-0000-000000000031",
        overrideJustification: "Triagista observa signos compensatorios.",
      } as never);

      const args = prisma.triageEvaluation.create.mock.calls[0]![0];
      expect(args.data.overrideJustification).toMatch(/compensatorios/);
    });
  });

  describe("setAssignedLevel", () => {
    const EVAL_ID  = "00000000-0000-0000-0000-0000000000a1";
    const LEVEL_ID = "00000000-0000-0000-0000-0000000000b1";
    const DISC_ID  = "00000000-0000-0000-0000-0000000000c1";

    function setupTx() {
      // withTenantContext usa prisma.$transaction(callback). Pasamos prisma
      // como tx para que los delegados (.findFirst/.update/.createMany) sigan
      // siendo los mocks de mockDeep dentro de la transacción.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma.$transaction as unknown as { mockImplementation: (fn: any) => void }).mockImplementation(
        async (fn: (tx: PrismaClient) => Promise<unknown>) => fn(prisma),
      );
      // applyTenantContext hace SET LOCAL via $executeRawUnsafe — mockear.
      prisma.$executeRawUnsafe.mockResolvedValue(0 as never);
    }

    it("happy path: actualiza nivel + persiste hits + completa evaluation", async () => {
      setupTx();
      prisma.triageEvaluation.findFirst.mockResolvedValueOnce({
        id: EVAL_ID,
        status: "IN_PROGRESS",
      } as never);
      prisma.triageDiscriminatorHit.createMany.mockResolvedValueOnce({ count: 1 } as never);
      prisma.triageEvaluation.update.mockResolvedValueOnce({
        id: EVAL_ID,
        assignedLevelId: LEVEL_ID,
        status: "COMPLETED",
      } as never);

      const caller = triageRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.setAssignedLevel({
        triageEvaluationId: EVAL_ID,
        assignedLevelId: LEVEL_ID,
        overrideJustification: "Triagista decide subir de YELLOW a ORANGE por dolor torácico.",
        discriminatorHits: [
          { discriminatorId: DISC_ID, positive: true, notes: "Dolor irradiado" },
        ],
      });

      expect(result).toMatchObject({ status: "COMPLETED", assignedLevelId: LEVEL_ID });

      const createManyArgs = prisma.triageDiscriminatorHit.createMany.mock.calls[0]![0];
      expect(createManyArgs.skipDuplicates).toBe(true);
      expect(createManyArgs.data).toEqual([
        expect.objectContaining({
          triageEvaluationId: EVAL_ID,
          discriminatorId: DISC_ID,
          positive: true,
          notes: "Dolor irradiado",
        }),
      ]);

      const updateArgs = prisma.triageEvaluation.update.mock.calls[0]![0];
      expect(updateArgs.where).toEqual({ id: EVAL_ID });
      expect(updateArgs.data.status).toBe("COMPLETED");
      expect(updateArgs.data.completedAt).toBeInstanceOf(Date);
      expect(updateArgs.data.assignedLevelId).toBe(LEVEL_ID);
    });

    it("sin discriminatorHits no llama createMany", async () => {
      setupTx();
      prisma.triageEvaluation.findFirst.mockResolvedValueOnce({
        id: EVAL_ID,
        status: "IN_PROGRESS",
      } as never);
      prisma.triageEvaluation.update.mockResolvedValueOnce({ id: EVAL_ID } as never);

      const caller = triageRouter.createCaller(makeCtx({ prisma }));
      await caller.setAssignedLevel({
        triageEvaluationId: EVAL_ID,
        assignedLevelId: LEVEL_ID,
        discriminatorHits: [],
      });

      expect(prisma.triageDiscriminatorHit.createMany).not.toHaveBeenCalled();
    });

    it("NOT_FOUND si la evaluación no existe (o es de otro tenant)", async () => {
      setupTx();
      prisma.triageEvaluation.findFirst.mockResolvedValueOnce(null as never);

      const caller = triageRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.setAssignedLevel({
          triageEvaluationId: EVAL_ID,
          assignedLevelId: LEVEL_ID,
          discriminatorHits: [],
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      expect(prisma.triageEvaluation.update).not.toHaveBeenCalled();
    });

    it("CONFLICT si la evaluación ya está COMPLETED (irreversible)", async () => {
      setupTx();
      prisma.triageEvaluation.findFirst.mockResolvedValueOnce({
        id: EVAL_ID,
        status: "COMPLETED",
      } as never);

      const caller = triageRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.setAssignedLevel({
          triageEvaluationId: EVAL_ID,
          assignedLevelId: LEVEL_ID,
          discriminatorHits: [],
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });

      expect(prisma.triageEvaluation.update).not.toHaveBeenCalled();
    });
  });
});
