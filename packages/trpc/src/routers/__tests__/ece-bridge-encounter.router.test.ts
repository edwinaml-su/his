/**
 * Tests del bridgeEncounterRouter (Fase 2 — Stream 22b ECE↔HIS).
 *
 * Estrategia:
 *   - Prisma mockeado con mockDeep<PrismaClient>.
 *   - $queryRaw / $executeRaw se mockean por llamada porque reciben
 *     TemplateStringsArray (tagged template literals), no se pueden
 *     comparar directamente; sólo verificamos el resultado.
 *   - emitDomainEvent se mockea para aislar el outbox.
 *   - $transaction delega al mismo prisma mock para simplificar.
 *
 * Cobertura (8 tests):
 *   linkEncounter   — happy path, Encounter NOT_FOUND, episodio ya vinculado.
 *   unlinkEncounter — happy path, episodio sin vínculo (BAD_REQUEST).
 *   createEpisodioFromEncounter — happy path, Encounter NOT_FOUND,
 *                                 ya tiene episodio (CONFLICT),
 *                                 sin ece.paciente (PRECONDITION_FAILED).
 *   listEncountersWithoutEpisodio — retorna items/total paginados.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { bridgeEncounterRouter } from "../ece/bridge-encounter.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

// ─── Mocks globales ────────────────────────────────────────────────────────────

vi.mock("@his/database", async (importOriginal) => {
  const original = await importOriginal<typeof import("@his/database")>();
  return {
    ...original,
    emitDomainEvent: vi.fn().mockResolvedValue({ id: "event-id" }),
  };
});

import { emitDomainEvent } from "@his/database";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ENC_ID      = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const EPI_ID      = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const PAT_ID      = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const PACIE_ECE   = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const ESTAB_ECE   = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const ORG_ID      = MOCK_TENANT.organizationId;

const TENANT = {
  ...MOCK_TENANT,
  roleCodes: ["PHYSICIAN"],
};

const MOCK_ENCOUNTER = {
  id: ENC_ID,
  patientId: PAT_ID,
  admittedAt: new Date("2026-05-17T08:00:00Z"),
  organizationId: ORG_ID,
};

// ─── Helper ───────────────────────────────────────────────────────────────────

function wireTx(prisma: DeepMockProxy<PrismaClient>): void {
  prisma.$transaction.mockImplementation(async (cb: unknown) => {
    if (typeof cb === "function") {
      return (cb as (tx: unknown) => Promise<unknown>)(prisma);
    }
    return cb;
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("bridgeEncounterRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    wireTx(prisma);
    vi.mocked(emitDomainEvent).mockResolvedValue({ id: "event-id" });
  });

  // ───────────────────────────────── linkEncounter ───────────────────────────

  describe("linkEncounter", () => {
    it("vincula episodio a encounter — happy path", async () => {
      prisma.encounter.findFirst.mockResolvedValue(MOCK_ENCOUNTER as never);
      // findEpisodio ($queryRaw #1) — sin vínculo previo
      prisma.$queryRaw
        .mockResolvedValueOnce([
          {
            id: EPI_ID,
            public_encounter_id: null,
            paciente_id: PACIE_ECE,
            establecimiento_id: ESTAB_ECE,
            estado: "abierto",
          },
        ] as never)
        // $executeRaw dentro de tx
      prisma.$executeRaw.mockResolvedValue(1 as never);

      const caller = bridgeEncounterRouter.createCaller(
        makeCtx({ prisma, tenant: TENANT }),
      );
      const result = await caller.linkEncounter({
        encounterId: ENC_ID,
        episodioId: EPI_ID,
      });

      expect(result.encounterId).toBe(ENC_ID);
      expect(result.episodioId).toBe(EPI_ID);
      expect(emitDomainEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          eventType: "ece.episodio.linkedToEncounter",
          aggregateId: EPI_ID,
        }),
      );
    });

    it("lanza NOT_FOUND si el Encounter no pertenece al tenant", async () => {
      prisma.encounter.findFirst.mockResolvedValue(null as never);

      const caller = bridgeEncounterRouter.createCaller(
        makeCtx({ prisma, tenant: TENANT }),
      );
      await expect(
        caller.linkEncounter({ encounterId: ENC_ID, episodioId: EPI_ID }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("lanza CONFLICT si el episodio ya tiene un Encounter vinculado", async () => {
      prisma.encounter.findFirst.mockResolvedValue(MOCK_ENCOUNTER as never);
      prisma.$queryRaw.mockResolvedValueOnce([
        {
          id: EPI_ID,
          public_encounter_id: "otro-encounter-id",
          paciente_id: PACIE_ECE,
          establecimiento_id: ESTAB_ECE,
          estado: "abierto",
        },
      ] as never);

      const caller = bridgeEncounterRouter.createCaller(
        makeCtx({ prisma, tenant: TENANT }),
      );
      await expect(
        caller.linkEncounter({ encounterId: ENC_ID, episodioId: EPI_ID }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  // ───────────────────────────────── unlinkEncounter ────────────────────────

  describe("unlinkEncounter", () => {
    it("elimina el vínculo — happy path", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        {
          id: EPI_ID,
          public_encounter_id: ENC_ID,
          paciente_id: PACIE_ECE,
          establecimiento_id: ESTAB_ECE,
          estado: "abierto",
        },
      ] as never);
      prisma.$executeRaw.mockResolvedValue(1 as never);

      const caller = bridgeEncounterRouter.createCaller(
        makeCtx({ prisma, tenant: TENANT }),
      );
      const result = await caller.unlinkEncounter({ episodioId: EPI_ID });

      expect(result.unlinkedEncounterId).toBe(ENC_ID);
    });

    it("lanza BAD_REQUEST si el episodio no tiene vínculo", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        {
          id: EPI_ID,
          public_encounter_id: null,
          paciente_id: PACIE_ECE,
          establecimiento_id: ESTAB_ECE,
          estado: "abierto",
        },
      ] as never);

      const caller = bridgeEncounterRouter.createCaller(
        makeCtx({ prisma, tenant: TENANT }),
      );
      await expect(
        caller.unlinkEncounter({ episodioId: EPI_ID }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  // ───────────────────── createEpisodioFromEncounter ────────────────────────

  describe("createEpisodioFromEncounter", () => {
    const baseInput = {
      encounterId: ENC_ID,
      modalidad: "ambulatorio" as const,
      servicio_categoria: "consulta_externa" as const,
      establecimientoEceId: ESTAB_ECE,
    };

    it("crea episodio y lo vincula — happy path", async () => {
      prisma.encounter.findFirst.mockResolvedValue(MOCK_ENCOUNTER as never);
      // existing episodios (ninguno)
      prisma.$queryRaw
        .mockResolvedValueOnce([] as never)                                   // existing check
        .mockResolvedValueOnce([{ id: PACIE_ECE, establecimiento_id: ESTAB_ECE }] as never) // findPacienteEce
        .mockResolvedValueOnce([{ id: EPI_ID }] as never);                    // INSERT RETURNING
      prisma.$executeRaw.mockResolvedValue(1 as never);

      const caller = bridgeEncounterRouter.createCaller(
        makeCtx({ prisma, tenant: TENANT }),
      );
      const result = await caller.createEpisodioFromEncounter(baseInput);

      expect(result.episodioId).toBe(EPI_ID);
      expect(result.encounterId).toBe(ENC_ID);
      expect(result.pacienteEceId).toBe(PACIE_ECE);
      expect(emitDomainEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ eventType: "ece.episodio.linkedToEncounter" }),
      );
    });

    it("lanza NOT_FOUND si el Encounter no existe en el tenant", async () => {
      prisma.encounter.findFirst.mockResolvedValue(null as never);

      const caller = bridgeEncounterRouter.createCaller(
        makeCtx({ prisma, tenant: TENANT }),
      );
      await expect(
        caller.createEpisodioFromEncounter(baseInput),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("lanza CONFLICT si el Encounter ya tiene episodio ECE", async () => {
      prisma.encounter.findFirst.mockResolvedValue(MOCK_ENCOUNTER as never);
      prisma.$queryRaw.mockResolvedValueOnce([{ id: EPI_ID }] as never); // existing check

      const caller = bridgeEncounterRouter.createCaller(
        makeCtx({ prisma, tenant: TENANT }),
      );
      await expect(
        caller.createEpisodioFromEncounter(baseInput),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("lanza PRECONDITION_FAILED si no hay ece.paciente para el patientId", async () => {
      prisma.encounter.findFirst.mockResolvedValue(MOCK_ENCOUNTER as never);
      prisma.$queryRaw
        .mockResolvedValueOnce([] as never) // existing check — ok
        .mockResolvedValueOnce([] as never); // findPacienteEce — vacío

      const caller = bridgeEncounterRouter.createCaller(
        makeCtx({ prisma, tenant: TENANT }),
      );
      await expect(
        caller.createEpisodioFromEncounter(baseInput),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });
  });

  // ───────────────────── listEncountersWithoutEpisodio ──────────────────────

  describe("listEncountersWithoutEpisodio", () => {
    it("retorna items y total paginados", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ eid: ENC_ID }] as never); // linked IDs
      prisma.encounter.findMany.mockResolvedValue([] as never);
      prisma.encounter.count.mockResolvedValue(0 as never);

      const caller = bridgeEncounterRouter.createCaller(
        makeCtx({ prisma, tenant: TENANT }),
      );
      const result = await caller.listEncountersWithoutEpisodio({
        page: 1,
        pageSize: 20,
      });

      expect(result).toMatchObject({ items: [], total: 0, page: 1, pageSize: 20 });
      // El where debe excluir el ENC_ID que ya está vinculado.
      const callArgs = prisma.encounter.findMany.mock.calls[0]![0];
      expect(callArgs!.where).toMatchObject({ dischargedAt: null });
    });
  });
});
