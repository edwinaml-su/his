/**
 * Tests del gs1ProcesoBRouter — Transferencias GS1 Proceso B.
 *
 * Cubre:
 *  1. enviarTransferencia — crea transferencia y emite evento
 *  2. enviarTransferencia — rechaza si productos vacío
 *  3. enviarTransferencia — rechaza GLN con longitud incorrecta
 *  4. recibirTransferencia — happy path recibido
 *  5. recibirTransferencia — happy path rechazado
 *  6. recibirTransferencia — falla si estado != en_transito
 *  7. recibirTransferencia — falla si rechazar=true sin motivoRechazo
 *  8. listPendientes — retorna filas correctas
 *  9. listEnTransito — retorna filas correctas
 * 10. get — NOT_FOUND si no existe
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { gs1ProcesoBRouter } from "../gs1-proceso-b.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

// ─── Mock outbox ──────────────────────────────────────────────────────────────

vi.mock("@his/database", async (importOriginal) => {
  const original = await importOriginal<typeof import("@his/database")>();
  return {
    ...original,
    emitDomainEvent: vi.fn().mockResolvedValue({ id: "evt-mock" }),
  };
});

import { emitDomainEvent } from "@his/database";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ORG_ID        = MOCK_TENANT.organizationId;
const TRANSFER_ID   = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_ID       = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
// HI-15 (PR #337): productoTransferenciaSchema ahora valida check digit GS1.
// GLNs originales tenían check digit incorrecto. Estos pasan gs1CheckDigitValid.
const ORIGEN_GLN    = "7501234567893";  // 13 dígitos válidos (check 3)
const DESTINO_GLN   = "7509876543213";  // 13 dígitos válidos (check 3)

const PRODUCTO_MOCK = {
  gtin: "07501234567894",
  lote: "LOT-2024-001",
  fechaVencimiento: "2026-12-31",
  cantidad: 10,
  uom: "EA",
};

const ROW_EN_TRANSITO = {
  id: TRANSFER_ID,
  origen_gln: ORIGEN_GLN,
  destino_gln: DESTINO_GLN,
  sscc_pallet: null,
  productos: [PRODUCTO_MOCK],
  fecha_envio: new Date("2026-05-17T10:00:00Z"),
  fecha_recepcion: null,
  estado: "en_transito",
  registrado_por: USER_ID,
  verificado_por: null,
  motivo_rechazo: null,
  created_at: new Date(),
  updated_at: new Date(),
};

// ─── Setup ────────────────────────────────────────────────────────────────────

let prisma: DeepMockProxy<PrismaClient>;

beforeEach(() => {
  prisma = mockDeep<PrismaClient>();
  vi.clearAllMocks();
});

function makeCaller() {
  return gs1ProcesoBRouter.createCaller(
    makeCtx({
      prisma,
      user: { id: USER_ID, email: "inv@test.com" } as never,
      tenant: { ...MOCK_TENANT, roleCodes: ["INVENTORY_MANAGER"] },
    }),
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("gs1ProcesoBRouter", () => {
  describe("enviarTransferencia", () => {
    it("crea transferencia y emite gs1.transfer.enviada", async () => {
      // $queryRaw retorna el nuevo id
      prisma.$queryRaw.mockResolvedValueOnce([{ id: TRANSFER_ID }]);
      (emitDomainEvent as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: "evt-1" });

      const caller = makeCaller();
      const result = await caller.enviarTransferencia({
        origenGln: ORIGEN_GLN,
        destinoGln: DESTINO_GLN,
        productos: [PRODUCTO_MOCK],
      });

      expect(result.id).toBe(TRANSFER_ID);
      expect(emitDomainEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          eventType: "gs1.transfer.enviada",
          aggregateId: TRANSFER_ID,
          organizationId: ORG_ID,
        }),
      );
    });

    it("rechaza si productos es array vacío", async () => {
      const caller = makeCaller();
      await expect(
        caller.enviarTransferencia({
          origenGln: ORIGEN_GLN,
          destinoGln: DESTINO_GLN,
          productos: [],
        }),
      ).rejects.toThrow();
    });

    it("rechaza GLN con longitud distinta de 13", async () => {
      const caller = makeCaller();
      await expect(
        caller.enviarTransferencia({
          origenGln: "123",  // inválido
          destinoGln: DESTINO_GLN,
          productos: [PRODUCTO_MOCK],
        }),
      ).rejects.toThrow();
    });
  });

  describe("recibirTransferencia", () => {
    it("marca como recibido y emite gs1.transfer.recibida", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([ROW_EN_TRANSITO]);
      prisma.$executeRaw.mockResolvedValueOnce(1);
      (emitDomainEvent as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: "evt-2" });

      const caller = makeCaller();
      const result = await caller.recibirTransferencia({ id: TRANSFER_ID, rechazar: false });

      expect(result.ok).toBe(true);
      expect(result.estado).toBe("recibido");
      expect(emitDomainEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ eventType: "gs1.transfer.recibida" }),
      );
    });

    it("marca como rechazado y emite gs1.transfer.rechazada", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([ROW_EN_TRANSITO]);
      prisma.$executeRaw.mockResolvedValueOnce(1);
      (emitDomainEvent as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: "evt-3" });

      const caller = makeCaller();
      const result = await caller.recibirTransferencia({
        id: TRANSFER_ID,
        rechazar: true,
        motivoRechazo: "Pallet dañado en transporte",
      });

      expect(result.estado).toBe("rechazado");
      expect(emitDomainEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ eventType: "gs1.transfer.rechazada" }),
      );
    });

    it("falla BAD_REQUEST si estado != en_transito", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ ...ROW_EN_TRANSITO, estado: "recibido" }]);

      const caller = makeCaller();
      await expect(
        caller.recibirTransferencia({ id: TRANSFER_ID, rechazar: false }),
      ).rejects.toThrow("en_transito");
    });

    it("falla BAD_REQUEST al rechazar sin motivoRechazo", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([ROW_EN_TRANSITO]);

      const caller = makeCaller();
      await expect(
        caller.recibirTransferencia({ id: TRANSFER_ID, rechazar: true }),
      ).rejects.toThrow("motivo");
    });
  });

  describe("listPendientes", () => {
    it("retorna filas con estado programado", async () => {
      const row = { ...ROW_EN_TRANSITO, estado: "programado" };
      prisma.$queryRaw.mockResolvedValueOnce([row]);

      const caller = makeCaller();
      const result = await caller.listPendientes({});

      expect(result).toHaveLength(1);
      expect(result[0]!.estado).toBe("programado");
    });
  });

  describe("listEnTransito", () => {
    it("retorna filas con estado en_transito", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([ROW_EN_TRANSITO]);

      const caller = makeCaller();
      const result = await caller.listEnTransito({});

      expect(result).toHaveLength(1);
      expect(result[0]!.estado).toBe("en_transito");
    });
  });

  describe("get", () => {
    it("lanza NOT_FOUND si no existe la transferencia", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const caller = makeCaller();
      await expect(caller.get({ id: TRANSFER_ID })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});
