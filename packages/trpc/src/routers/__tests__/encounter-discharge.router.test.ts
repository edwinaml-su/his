/**
 * Tests del encounterDischarge router (US-5.5).
 *
 * Cubre:
 *  - dischargeEncounter rechaza dischargeType=DEATH (redirige al flujo de defunción).
 *  - exige primaryDiagnosisCode (Zod) — input vacío rechaza.
 *  - cierre exitoso pasa por update encounter + persistencia epicrisis en AuditLog.
 *  - epicrisis() retorna NOT_FOUND para encounter de otra org (tenant isolation).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { encounterDischargeRouter } from "../encounter-discharge.router";
import { makeCtx } from "../../__tests__/helpers/caller";

function fn<T>(returnValue: T) {
  return vi.fn().mockResolvedValue(returnValue);
}

describe("encounterDischargeRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    // $transaction(callback) corre el callback con el propio mock.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as unknown as { mockImplementation: (fn: any) => void })
      .mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) =>
        fn(prisma),
      );
  });

  describe("dischargeEncounter", () => {
    it("rechaza dischargeType=DEATH con CONFLICT (redirige a US-5.6)", async () => {
      const caller = encounterDischargeRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.dischargeEncounter({
          encounterId: "00000000-0000-0000-0000-000000000010",
          dischargeType: "DEATH",
          primaryDiagnosisCode: "I46.9",
          primaryDiagnosisDesc: "Paro cardíaco",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("rechaza si primaryDiagnosisCode está vacío (Zod min(1))", async () => {
      const caller = encounterDischargeRouter.createCaller(makeCtx({ prisma }));
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        caller.dischargeEncounter({
          encounterId: "00000000-0000-0000-0000-000000000010",
          dischargeType: "MEDICAL",
          primaryDiagnosisCode: "",
          primaryDiagnosisDesc: "x",
        } as any),
      ).rejects.toThrow();
    });

    it("update encounter dischargedAt + dischargeType y crea audit log de epicrisis", async () => {
      prisma.encounter.findFirst.mockResolvedValue({
        id: "e1",
        organizationId: "org",
        dischargedAt: null,
        bedAssignments: [],
      } as never);
      prisma.clinicalConcept.findFirst.mockResolvedValue({
        id: "concept-1",
        display: "Insuficiencia cardíaca",
      } as never);
      prisma.encounter.update.mockResolvedValue({ id: "e1" } as never);
      prisma.auditLog.create.mockResolvedValue({ id: "a1" } as never);

      const caller = encounterDischargeRouter.createCaller(makeCtx({ prisma }));
      await caller.dischargeEncounter({
        encounterId: "00000000-0000-0000-0000-000000000010",
        dischargeType: "MEDICAL",
        primaryDiagnosisCode: "I50.9",
        primaryDiagnosisDesc: "Insuficiencia cardíaca",
        summary: "Paciente egresado estable.",
      });

      const updateArgs = prisma.encounter.update.mock.calls[0]![0];
      expect(updateArgs.data.dischargeType).toBe("MEDICAL");
      expect(updateArgs.data.dischargedAt).toBeInstanceOf(Date);
      expect(updateArgs.data.primaryDiagnosisId).toBe("concept-1");

      const auditArgs = prisma.auditLog.create.mock.calls[0]![0];
      expect(auditArgs.data.entity).toBe("Encounter.epicrisis");
      expect(auditArgs.data.action).toBe("SIGN");
    });

    it("retorna NOT_FOUND si el encuentro no existe en el tenant", async () => {
      prisma.encounter.findFirst.mockResolvedValue(null as never);

      const caller = encounterDischargeRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.dischargeEncounter({
          encounterId: "00000000-0000-0000-0000-000000000010",
          dischargeType: "MEDICAL",
          primaryDiagnosisCode: "I50.9",
          primaryDiagnosisDesc: "ICC",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("epicrisis", () => {
    it("retorna NOT_FOUND si el encounter no pertenece al tenant", async () => {
      prisma.encounter.findFirst = fn(null) as never;

      const caller = encounterDischargeRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.epicrisis({
          encounterId: "00000000-0000-0000-0000-000000000099",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});
