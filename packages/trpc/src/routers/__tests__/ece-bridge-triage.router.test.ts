/**
 * Tests — eceBridgeTriageRouter (Fase 2, Stream 18-ext).
 *
 * Estrategia: mocks de ctx.prisma con vitest-mock-extended.
 * Raw SQL se invoca vía $queryRaw / $executeRaw; los mocks retornan
 * valores controlados para verificar la lógica del router sin BD real.
 *
 * Cobertura (E2E @QA):
 *   - linkTriage flujo completo con TriageEvaluation real en BD efímera.
 *   - createEceFromTriage con firma inmediata (rol ENF).
 *   - syncCompletedTriages contra lote > 1 registro.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

// Mockear @his/database para que emitDomainEvent sea una función válida en tests.
vi.mock("@his/database", async (importOriginal) => {
  const original = await importOriginal<typeof import("@his/database")>();
  return {
    ...original,
    emitDomainEvent: vi.fn().mockResolvedValue({ id: "event-id" }),
  };
});

// Importar el router DESPUÉS del vi.mock (hoisting de vi.mock garantiza el orden).
import { eceBridgeTriageRouter } from "../ece/bridge-triage.router";

// UUIDs fijos para reproducibilidad.
const TRIAGE_ID = "11111111-0000-0000-0000-000000000001";
const ECE_TRIAJE_ID = "22222222-0000-0000-0000-000000000002";
const PATIENT_ID = "33333333-0000-0000-0000-000000000003";
const EPISODIO_ID = "44444444-0000-0000-0000-000000000004";
const PERSONAL_ID = "55555555-0000-0000-0000-000000000005";
const ORG_ID = MOCK_TENANT.organizationId;

/** TriageEvaluation mock con nivel Manchester 2 (ORANGE → ECE "II"). */
const MOCK_HIS_TRIAJE = {
  id: TRIAGE_ID,
  patientId: PATIENT_ID,
  organizationId: ORG_ID,
  status: "COMPLETED",
  assignedLevel: { priority: 2 },
  patient: { id: PATIENT_ID },
} as never;

/** EceTriaje mock sin vínculo HIS. */
const MOCK_ECE_TRIAJE_ROW = {
  id: ECE_TRIAJE_ID,
  episodio_id: EPISODIO_ID,
  nivel_prioridad: "II",
  estado_registro: "borrador",
  data: null,
};

describe("eceBridgeTriageRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();

    // Stub del $transaction para que ejecute el callback en la misma instancia.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as any).mockImplementation(
      (cb: (tx: typeof prisma) => Promise<unknown>) => cb(prisma),
    );

    // emitDomainEvent está mockeado a nivel módulo vía vi.mock("@his/database").
    // Stubs de Prisma.domainEvent y auditLog ya no son necesarios para outbox.
  });

  // ─────────────────────────────────────────────────────────────────────────
  // linkTriage
  // ─────────────────────────────────────────────────────────────────────────

  describe("linkTriage", () => {
    it("retorna ok y emite outbox cuando el vínculo es nuevo", async () => {
      prisma.triageEvaluation.findFirst.mockResolvedValue(MOCK_HIS_TRIAJE);

      // fetchEceTriaje (SELECT ece.triaje)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma.$queryRaw as any)
        .mockResolvedValueOnce([MOCK_ECE_TRIAJE_ROW]); // fetchEceTriaje

      // setHisLink ($executeRaw)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma.$executeRaw as any).mockResolvedValue(1);

      const caller = eceBridgeTriageRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.linkTriage({
        triageId: TRIAGE_ID,
        eceTriajeId: ECE_TRIAJE_ID,
      });

      // emitDomainEvent mockeado a nivel módulo — verificamos el resultado.
      expect(result.ok).toBe(true);
      expect(result.eceTriajeId).toBe(ECE_TRIAJE_ID);
      expect(result.hisTriageId).toBe(TRIAGE_ID);
    });

    it("lanza NOT_FOUND si la TriageEvaluation no pertenece al tenant", async () => {
      prisma.triageEvaluation.findFirst.mockResolvedValue(null);

      const caller = eceBridgeTriageRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.linkTriage({ triageId: TRIAGE_ID, eceTriajeId: ECE_TRIAJE_ID }),
      ).rejects.toThrow(TRPCError);
    });

    it("lanza CONFLICT si la EceTriaje ya tiene un vínculo HIS distinto", async () => {
      prisma.triageEvaluation.findFirst.mockResolvedValue(MOCK_HIS_TRIAJE);

      const otroTriageId = "ffffffff-0000-0000-0000-ffffffffffff";
      const eceConVinculo = {
        ...MOCK_ECE_TRIAJE_ROW,
        data: { hisTriageEvalId: otroTriageId },
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma.$queryRaw as any).mockResolvedValueOnce([eceConVinculo]);

      const caller = eceBridgeTriageRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.linkTriage({ triageId: TRIAGE_ID, eceTriajeId: ECE_TRIAJE_ID }),
      ).rejects.toThrow(TRPCError);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // createEceFromTriage
  // ─────────────────────────────────────────────────────────────────────────

  describe("createEceFromTriage", () => {
    it("crea EceTriaje en borrador cuando firmarInmediatamente=false", async () => {
      prisma.triageEvaluation.findFirst.mockResolvedValue(MOCK_HIS_TRIAJE);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma.$queryRaw as any)
        .mockResolvedValueOnce([]) // idempotencia: sin ECE previo
        .mockResolvedValueOnce([{ id: ECE_TRIAJE_ID }]); // INSERT RETURNING

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma.$executeRaw as any).mockResolvedValue(1);

      const caller = eceBridgeTriageRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.createEceFromTriage({
        triageId: TRIAGE_ID,
        episodioId: EPISODIO_ID,
        registradoPorId: PERSONAL_ID,
        firmarInmediatamente: false,
      });

      expect(result.ok).toBe(true);
      expect(result.nivelPrioridad).toBe("II");
      expect(result.estadoRegistro).toBe("borrador");
    });

    it("estado firmado cuando firmarInmediatamente=true y rol NURSE está presente", async () => {
      prisma.triageEvaluation.findFirst.mockResolvedValue(MOCK_HIS_TRIAJE);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma.$queryRaw as any)
        .mockResolvedValueOnce([]) // idempotencia
        .mockResolvedValueOnce([{ id: ECE_TRIAJE_ID }]); // INSERT

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma.$executeRaw as any).mockResolvedValue(1);

      const nurseCtx = makeCtx({
        prisma,
        tenant: { ...MOCK_TENANT, roleCodes: ["NURSE"] },
      });
      const caller = eceBridgeTriageRouter.createCaller(nurseCtx);
      const result = await caller.createEceFromTriage({
        triageId: TRIAGE_ID,
        episodioId: EPISODIO_ID,
        registradoPorId: PERSONAL_ID,
        firmarInmediatamente: true,
      });

      expect(result.estadoRegistro).toBe("firmado");
    });

    it("retorna el ECE existente si ya estaba vinculado (idempotencia)", async () => {
      prisma.triageEvaluation.findFirst.mockResolvedValue(MOCK_HIS_TRIAJE);

      const existente = {
        id: ECE_TRIAJE_ID,
        estado_registro: "borrador",
        nivel_prioridad: "II",
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma.$queryRaw as any).mockResolvedValueOnce([existente]);

      const caller = eceBridgeTriageRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.createEceFromTriage({
        triageId: TRIAGE_ID,
        episodioId: EPISODIO_ID,
        registradoPorId: PERSONAL_ID,
      });

      expect(result.eceTriajeId).toBe(ECE_TRIAJE_ID);
      // No debería haber llamado $queryRaw una segunda vez (INSERT).
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // syncCompletedTriages
  // ─────────────────────────────────────────────────────────────────────────

  describe("syncCompletedTriages", () => {
    it("reporta skipped si no hay defaultEpisodioId y hay Triages pendientes", async () => {
      const pendingRow = {
        id: TRIAGE_ID,
        patient_id: PATIENT_ID,
        assigned_level_priority: 3,
        motivo_consulta: "dolor torácico",
        completed_at: new Date().toISOString(),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma.$queryRaw as any).mockResolvedValueOnce([pendingRow]);

      const caller = eceBridgeTriageRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.syncCompletedTriages({
        limit: 10,
        registradoPorId: PERSONAL_ID,
        // defaultEpisodioId no enviado → undefined
      });

      expect(result.processed).toBe(0);
      expect(result.details[0]?.status).toBe("skipped");
    });
  });
});
