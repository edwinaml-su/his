/**
 * Tests — eceRectificacionRouter (NTEC Art. 41).
 *
 * Cubre:
 *   list:     devuelve filas filtradas por documentoInstanciaId.
 *   solicitar: crea rectificación en doc FIRMADO; rechaza doc no-FIRMADO y no-encontrado.
 *   aprobar:  aprueba PENDIENTE; rechaza si ya procesada (CONFLICT); NOT_FOUND.
 *   rechazar: rechaza PENDIENTE con motivo; CONFLICT si ya procesada.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { eceRectificacionRouter } from "../ece-rectificacion.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

type EstadoRectificacion = "PENDIENTE" | "APROBADA" | "RECHAZADA";

// Tenant con rol DIR para procedures aprobar/rechazar.
const TENANT_DIR = { ...MOCK_TENANT, roleCodes: ["DIR"] };

const DOC_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const RECT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const USER_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

function makeRectRow(estado: EstadoRectificacion = "PENDIENTE") {
  return {
    id: RECT_ID,
    documento_instancia_id: DOC_ID,
    campo: "diagnostico",
    valor_anterior: "Hipertensión",
    valor_propuesto: "Hipertensión arterial esencial",
    motivo: "Precisión diagnóstica requerida por protocolo",
    estado,
    solicitante_id: USER_ID,
    solicitante_nombre: "Dr. Pérez",
    aprobador_id: null,
    fecha_aprobacion: null,
    motivo_rechazo: null,
    created_at: new Date().toISOString(),
  };
}

describe("eceRectificacionRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // list
  // ---------------------------------------------------------------------------
  describe("list", () => {
    it("devuelve filas del documento", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([makeRectRow()]);

      const caller = eceRectificacionRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.list({ documentoInstanciaId: DOC_ID });
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe(RECT_ID);
    });

    it("devuelve lista vacía si no hay rectificaciones", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const caller = eceRectificacionRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.list({ documentoInstanciaId: DOC_ID });
      expect(result).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // solicitar
  // ---------------------------------------------------------------------------
  describe("solicitar", () => {
    const validInput = {
      documentoInstanciaId: DOC_ID,
      campo: "diagnostico",
      valorAnterior: "Hipertensión",
      valorPropuesto: "Hipertensión arterial esencial",
      motivo: "Precisión diagnóstica requerida por protocolo clínico",
    };

    it("happy-path: crea rectificación y emite outbox", async () => {
      prisma.$queryRaw
        // doc encontrado y FIRMADO
        .mockResolvedValueOnce([{ id: DOC_ID, estado: "FIRMADO" }])
        // INSERT RETURNING id
        .mockResolvedValueOnce([{ id: RECT_ID }]);
      // outbox insert
      prisma.$executeRaw.mockResolvedValueOnce(1);

      const caller = eceRectificacionRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.solicitar(validInput);
      expect(result.id).toBe(RECT_ID);
    });

    it("NOT_FOUND si el documento no existe", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]); // doc no encontrado

      const caller = eceRectificacionRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.solicitar(validInput)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("PRECONDITION_FAILED si el documento no está FIRMADO", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ id: DOC_ID, estado: "BORRADOR" }]);

      const caller = eceRectificacionRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.solicitar(validInput)).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
    });
  });

  // ---------------------------------------------------------------------------
  // aprobar
  // ---------------------------------------------------------------------------
  describe("aprobar", () => {
    it("happy-path: aprueba rectificación PENDIENTE", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([makeRectRow("PENDIENTE")]);
      prisma.$executeRaw
        // UPDATE estado = APROBADA
        .mockResolvedValueOnce(1)
        // outbox
        .mockResolvedValueOnce(1);

      const caller = eceRectificacionRouter.createCaller(
        makeCtx({ prisma, tenant: TENANT_DIR }),
      );
      const result = await caller.aprobar({ rectificacionId: RECT_ID });
      expect(result.ok).toBe(true);
    });

    it("NOT_FOUND si la rectificación no existe", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const caller = eceRectificacionRouter.createCaller(
        makeCtx({ prisma, tenant: TENANT_DIR }),
      );
      await expect(
        caller.aprobar({ rectificacionId: RECT_ID }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("CONFLICT si ya fue aprobada", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([makeRectRow("APROBADA")]);

      const caller = eceRectificacionRouter.createCaller(
        makeCtx({ prisma, tenant: TENANT_DIR }),
      );
      await expect(
        caller.aprobar({ rectificacionId: RECT_ID }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  // ---------------------------------------------------------------------------
  // rechazar
  // ---------------------------------------------------------------------------
  describe("rechazar", () => {
    it("happy-path: rechaza rectificación PENDIENTE con motivo", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([makeRectRow("PENDIENTE")]);
      prisma.$executeRaw
        .mockResolvedValueOnce(1) // UPDATE
        .mockResolvedValueOnce(1); // outbox

      const caller = eceRectificacionRouter.createCaller(
        makeCtx({ prisma, tenant: TENANT_DIR }),
      );
      const result = await caller.rechazar({
        rectificacionId: RECT_ID,
        motivoRechazo: "El campo indicado no corresponde a un error de captura.",
      });
      expect(result.ok).toBe(true);
    });

    it("CONFLICT si ya fue rechazada", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([makeRectRow("RECHAZADA")]);

      const caller = eceRectificacionRouter.createCaller(
        makeCtx({ prisma, tenant: TENANT_DIR }),
      );
      await expect(
        caller.rechazar({
          rectificacionId: RECT_ID,
          motivoRechazo: "Motivo de prueba suficientemente largo.",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });
});
