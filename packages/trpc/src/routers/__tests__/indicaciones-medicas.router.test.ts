/**
 * Tests del indicacionesMedicasRouter (ECE IND_MED).
 *
 * Estrategia: mock de PrismaClient (mockDeep) + mock de emitDomainEvent
 * y withWorkflowContext para aislar la lógica del router de la BD.
 *
 * Cubre (≥8 casos):
 *   1. create — encabezado + ítems happy path
 *   2. create — item duplicado (mismo medicamentoCodigo, la BD lanza CONFLICT)
 *   3. list — retorna items + nextCursor
 *   4. get — NOT_FOUND cuando no existe
 *   7. firmar — rol MC → OK + emite evento
 *   8. firmar — estado ya firmado → CONFLICT
 *   9. suspender — ACTIVA → SUSPENDIDA
 *  10. cancelar — CANCELADA → CONFLICT
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { indicacionesMedicasRouter } from "../ece/indicaciones-medicas.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@his/database", async (importOriginal) => {
  const original = await importOriginal<typeof import("@his/database")>();
  return {
    ...original,
    emitDomainEvent: vi.fn().mockResolvedValue({ id: "evt-id" }),
  };
});

// Mock withEceContext para ejecutar callback directamente con prisma mock
vi.mock("../../ece/rls-context", () => ({
  withEceContext: vi.fn(async (
    prisma: PrismaClient,
    _personalId: string,
    _establecimientoId: string,
    fn: (tx: PrismaClient) => Promise<unknown>,
  ) => fn(prisma)),
}));

import { emitDomainEvent } from "@his/database";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const IND_ID       = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const EPISODIO_ID  = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ITEM_ID      = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const MEDICO_ID    = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const ENF_ID       = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

const MC_TENANT = {
  ...MOCK_TENANT,
  establishmentId: "00000000-0000-0000-0000-0000000000cc",
  roleCodes: ["PHYSICIAN", "MC"],
};

const ENF_TENANT = {
  ...MOCK_TENANT,
  establishmentId: "00000000-0000-0000-0000-0000000000cc",
  roleCodes: ["NURSE", "ENF"],
};

function baseIndicacion(overrides: Record<string, unknown> = {}) {
  return {
    id: IND_ID,
    instancia_id: null,
    episodio_id: EPISODIO_ID,
    fecha_hora: new Date("2026-05-19T10:00:00Z"),
    version: 1,
    vigencia: overrides.vigencia ?? "ACTIVA",
    medico_prescriptor: MEDICO_ID,
    transcripcion_enf: null,
    registrado_en: new Date("2026-05-19T10:00:00Z"),
    estado_registro: overrides.estado_registro ?? "borrador",
    digitado_retroactivamente: false,
    ...overrides,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePrisma(): DeepMockProxy<PrismaClient> {
  const prisma = mockDeep<PrismaClient>();
  prisma.$transaction.mockImplementation(async (cb: unknown) => {
    if (typeof cb === "function") {
      return (cb as (tx: unknown) => Promise<unknown>)(prisma);
    }
    return cb;
  });
  (prisma.$executeRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue(0);
  prisma.$executeRaw.mockResolvedValue(1 as never);
  return prisma;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("indicacionesMedicasRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = makePrisma();
    vi.clearAllMocks();
  });

  // ─── create ───────────────────────────────────────────────────────────────

  describe("create", () => {
    it("1. crea encabezado + ítems y retorna id con estadoRegistro borrador", async () => {
      (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ id: IND_ID }]);
      prisma.$executeRaw.mockResolvedValue(1 as never);

      const caller = indicacionesMedicasRouter.createCaller(
        makeCtx({ prisma, tenant: MC_TENANT }),
      );
      const result = await caller.create({
        episodioId: EPISODIO_ID,
        medicoPrescriptor: MEDICO_ID,
        items: [{ tipo: "MEDICAMENTO", descripcion: "Paracetamol", dosis: "500mg", via: "ORAL", frecuencia: "QID" }],
      });

      expect(result.id).toBe(IND_ID);
      expect(result.estadoRegistro).toBe("borrador");
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it("2. propaga error de BD cuando hay conflicto de ítem duplicado", async () => {
      (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ id: IND_ID }]);
      prisma.$executeRaw.mockRejectedValueOnce(
        Object.assign(new Error("unique constraint violation"), { code: "23505" }),
      );

      const caller = indicacionesMedicasRouter.createCaller(
        makeCtx({ prisma, tenant: MC_TENANT }),
      );
      await expect(
        caller.create({
          episodioId: EPISODIO_ID,
          medicoPrescriptor: MEDICO_ID,
          items: [{ tipo: "MEDICAMENTO", descripcion: "Paracetamol" }],
        }),
      ).rejects.toThrow();
    });
  });

  // ─── list ─────────────────────────────────────────────────────────────────

  describe("list", () => {
    it("3. retorna items y nextCursor cuando hay más resultados", async () => {
      (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        baseIndicacion(),
        baseIndicacion({ id: "ffffffff-ffff-ffff-ffff-ffffffffffff" }),
      ]);

      const caller = indicacionesMedicasRouter.createCaller(
        makeCtx({ prisma, tenant: MC_TENANT }),
      );
      const result = await caller.list({ episodioId: EPISODIO_ID, limit: 1 });

      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).toBe(IND_ID);
    });
  });

  // ─── get ──────────────────────────────────────────────────────────────────

  describe("get", () => {
    it("4. lanza NOT_FOUND cuando la indicación no existe", async () => {
      (prisma.$queryRaw as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([]) // encabezado vacío
        .mockResolvedValueOnce([]); // ítems vacíos

      const caller = indicacionesMedicasRouter.createCaller(
        makeCtx({ prisma, tenant: MC_TENANT }),
      );
      await expect(caller.get({ id: IND_ID })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  // ─── firmar ───────────────────────────────────────────────────────────────

  describe("firmar", () => {
    it("7. MC firma correctamente y emite evento ece.indicaciones.firmadas", async () => {
      (prisma.$queryRaw as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([baseIndicacion({ estado_registro: "borrador" })])
        // itemTexts para IPSG.2 forbidden-abbreviations check
        .mockResolvedValueOnce([{ descripcion: "Paracetamol 500mg VO cada 8h", notas: null }])
        // countRows
        .mockResolvedValueOnce([{ cnt: 1 }]);
      prisma.$executeRaw.mockResolvedValue(1 as never);
      vi.mocked(emitDomainEvent).mockResolvedValueOnce({ id: "evt-1" } as never);

      const caller = indicacionesMedicasRouter.createCaller(
        makeCtx({ prisma, tenant: MC_TENANT }),
      );
      const result = await caller.firmar({ id: IND_ID });

      expect(result.estadoRegistro).toBe("firmado");
      expect(emitDomainEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          eventType: "ece.indicaciones.firmadas",
          aggregateId: IND_ID,
        }),
      );
    });

    it("8. lanza CONFLICT si la indicación ya está firmada", async () => {
      (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        baseIndicacion({ estado_registro: "firmado" }),
      ]);

      const caller = indicacionesMedicasRouter.createCaller(
        makeCtx({ prisma, tenant: MC_TENANT }),
      );
      await expect(caller.firmar({ id: IND_ID })).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });
  });

  // ─── suspender ────────────────────────────────────────────────────────────

  describe("suspender", () => {
    it("9. ACTIVA → SUSPENDIDA retorna nuevo estado", async () => {
      (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        baseIndicacion({ vigencia: "ACTIVA" }),
      ]);
      prisma.$executeRaw.mockResolvedValue(1 as never);

      const caller = indicacionesMedicasRouter.createCaller(
        makeCtx({ prisma, tenant: ENF_TENANT }),
      );
      const result = await caller.suspender({
        id: IND_ID,
        motivo: "Paciente presentó reacción adversa",
      });

      expect(result.vigencia).toBe("SUSPENDIDA");
    });
  });

  // ─── cancelar ─────────────────────────────────────────────────────────────

  describe("cancelar", () => {
    it("10. lanza CONFLICT si la vigencia ya es CANCELADA", async () => {
      (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        baseIndicacion({ vigencia: "CANCELADA" }),
      ]);

      const caller = indicacionesMedicasRouter.createCaller(
        makeCtx({ prisma, tenant: MC_TENANT }),
      );
      await expect(
        caller.cancelar({ id: IND_ID, motivo: "Error de prescripción" }),
      ).rejects.toThrow(TRPCError);
    });
  });
});
