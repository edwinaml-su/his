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
 *   5. addItem — estado validado → CONFLICT
 *   6. addItem — estado borrador → OK
 *   7. firmar — rol MC → OK + emite evento
 *   8. firmar — estado ya firmado → CONFLICT
 *   9. validar — rol ENF OK
 *  10. validar — estado borrador → CONFLICT (ENF no puede validar sin firma)
 *  11. anular — estado validado → CONFLICT
 *  12. removeItem — NOT_FOUND
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

import { emitDomainEvent } from "@his/database";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const IND_ID       = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const EPISODIO_ID  = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ITEM_ID      = "cccccccc-cccc-cccc-cccc-cccccccccccc";

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

const BASE_ITEM = {
  medicamentoCodigo: "MED-001",
  dosis: "500mg",
  via: "oral",
  frecuencia: "c/8h",
  duracionDias: 5,
};

const IND_ROW_BORRADOR = {
  id: IND_ID,
  episodio_id: EPISODIO_ID,
  estado: "borrador",
  observaciones: null,
  creado_por: MOCK_TENANT.userId,
  creado_en: new Date(),
  firmado_por: null,
  firmado_en: null,
  validado_por: null,
  validado_en: null,
};

const IND_ROW_FIRMADO = { ...IND_ROW_BORRADOR, estado: "firmado" };
const IND_ROW_VALIDADO = { ...IND_ROW_BORRADOR, estado: "validado" };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePrisma(): DeepMockProxy<PrismaClient> {
  const prisma = mockDeep<PrismaClient>();
  prisma.$transaction.mockImplementation(async (cb: unknown) => {
    if (typeof cb === "function") {
      return (cb as (tx: unknown) => Promise<unknown>)(prisma);
    }
    return cb;
  });
  prisma.$executeRawUnsafe.mockResolvedValue(0 as never);
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
    it("1. crea encabezado + ítems y retorna id con estado borrador", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ id: IND_ID }] as never);
      prisma.$executeRaw.mockResolvedValue(1 as never);

      const caller = indicacionesMedicasRouter.createCaller(
        makeCtx({ prisma, tenant: MC_TENANT }),
      );
      const result = await caller.create({
        episodioId: EPISODIO_ID,
        items: [BASE_ITEM],
      });

      expect(result.id).toBe(IND_ID);
      expect(result.estado).toBe("borrador");
      // Verifica que se insertó 1 ítem vía $executeRaw
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it("2. propaga error de BD cuando hay conflicto de ítem duplicado", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ id: IND_ID }] as never);
      prisma.$executeRaw.mockRejectedValueOnce(
        Object.assign(new Error("unique constraint violation"), { code: "23505" }),
      );

      const caller = indicacionesMedicasRouter.createCaller(
        makeCtx({ prisma, tenant: MC_TENANT }),
      );
      await expect(
        caller.create({ episodioId: EPISODIO_ID, items: [BASE_ITEM] }),
      ).rejects.toThrow();
    });
  });

  // ─── list ─────────────────────────────────────────────────────────────────

  describe("list", () => {
    it("3. retorna items y nextCursor cuando hay más resultados", async () => {
      // Devuelve limit+1 filas para simular hasMore
      prisma.$queryRaw.mockResolvedValueOnce(
        [IND_ROW_BORRADOR, IND_ROW_FIRMADO] as never,
      );

      const caller = indicacionesMedicasRouter.createCaller(
        makeCtx({ prisma, tenant: MC_TENANT }),
      );
      const result = await caller.list({ episodioId: EPISODIO_ID, limit: 1 });

      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).toBe(IND_ROW_BORRADOR.id);
    });
  });

  // ─── get ──────────────────────────────────────────────────────────────────

  describe("get", () => {
    it("4. lanza NOT_FOUND cuando la indicación no existe", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([] as never) // encabezado vacío
        .mockResolvedValueOnce([] as never); // ítems vacíos

      const caller = indicacionesMedicasRouter.createCaller(
        makeCtx({ prisma, tenant: MC_TENANT }),
      );
      await expect(caller.get({ id: IND_ID })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  // ─── addItem ──────────────────────────────────────────────────────────────

  describe("addItem", () => {
    it("5. lanza CONFLICT cuando el estado es validado", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([IND_ROW_VALIDADO] as never);

      const caller = indicacionesMedicasRouter.createCaller(
        makeCtx({ prisma, tenant: MC_TENANT }),
      );
      await expect(
        caller.addItem({ indicacionId: IND_ID, item: BASE_ITEM }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("6. agrega ítem exitosamente cuando el estado es borrador", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([IND_ROW_BORRADOR] as never) // getIndicacionOrThrow
        .mockResolvedValueOnce([{ id: ITEM_ID }] as never); // RETURNING id

      const caller = indicacionesMedicasRouter.createCaller(
        makeCtx({ prisma, tenant: MC_TENANT }),
      );
      const result = await caller.addItem({
        indicacionId: IND_ID,
        item: BASE_ITEM,
      });

      expect(result.id).toBe(ITEM_ID);
    });
  });

  // ─── firmar ───────────────────────────────────────────────────────────────

  describe("firmar", () => {
    it("7. MC firma correctamente y emite evento ece.indicaciones.firmadas", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([IND_ROW_BORRADOR] as never);
      prisma.$executeRaw.mockResolvedValue(1 as never);
      vi.mocked(emitDomainEvent).mockResolvedValueOnce({ id: "evt-1" } as never);

      const caller = indicacionesMedicasRouter.createCaller(
        makeCtx({ prisma, tenant: MC_TENANT }),
      );
      const result = await caller.firmar({ id: IND_ID });

      expect(result.estado).toBe("firmado");
      expect(emitDomainEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          eventType: "ece.indicaciones.firmadas",
          aggregateId: IND_ID,
        }),
      );
    });

    it("8. lanza CONFLICT si la indicación ya está firmada", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([IND_ROW_FIRMADO] as never);

      const caller = indicacionesMedicasRouter.createCaller(
        makeCtx({ prisma, tenant: MC_TENANT }),
      );
      await expect(caller.firmar({ id: IND_ID })).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });

    it("8b. lanza FORBIDDEN si el rol no es MC/PHYSICIAN", async () => {
      const caller = indicacionesMedicasRouter.createCaller(
        makeCtx({ prisma, tenant: ENF_TENANT }),
      );
      await expect(caller.firmar({ id: IND_ID })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });

  // ─── validar ──────────────────────────────────────────────────────────────

  describe("validar", () => {
    it("9. ENF valida indicación firmada correctamente", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([IND_ROW_FIRMADO] as never);
      prisma.$executeRaw.mockResolvedValue(1 as never);

      const caller = indicacionesMedicasRouter.createCaller(
        makeCtx({ prisma, tenant: ENF_TENANT }),
      );
      const result = await caller.validar({ id: IND_ID });

      expect(result.estado).toBe("validado");
    });

    it("10. lanza CONFLICT si la indicación está en borrador (aún no firmada)", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([IND_ROW_BORRADOR] as never);

      const caller = indicacionesMedicasRouter.createCaller(
        makeCtx({ prisma, tenant: ENF_TENANT }),
      );
      await expect(caller.validar({ id: IND_ID })).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });
  });

  // ─── anular ───────────────────────────────────────────────────────────────

  describe("anular", () => {
    it("11. lanza CONFLICT si la indicación está en estado validado", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([IND_ROW_VALIDADO] as never);

      const caller = indicacionesMedicasRouter.createCaller(
        makeCtx({ prisma, tenant: MC_TENANT }),
      );
      await expect(
        caller.anular({ id: IND_ID, motivo: "Error de prescripción" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  // ─── removeItem ───────────────────────────────────────────────────────────

  describe("removeItem", () => {
    it("12. lanza NOT_FOUND si el ítem no existe en la indicación", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([IND_ROW_BORRADOR] as never);
      // DELETE devuelve 0 filas afectadas
      prisma.$executeRaw.mockResolvedValue(0 as never);

      const caller = indicacionesMedicasRouter.createCaller(
        makeCtx({ prisma, tenant: MC_TENANT }),
      );
      await expect(
        caller.removeItem({ indicacionId: IND_ID, itemId: ITEM_ID }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});
