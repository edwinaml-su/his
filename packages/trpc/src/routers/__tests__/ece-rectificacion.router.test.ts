/**
 * Tests — eceRectificacionRouter (NTEC Art. 41 + Art. 42).
 *
 * Cubre:
 *   list:     devuelve filas filtradas por documentoInstanciaId.
 *   solicitar: crea rectificación en doc FIRMADO; rechaza doc no-FIRMADO y no-encontrado.
 *   aprobar:  HG-16 — sin PIN → ZodError; PIN incorrecto → UNAUTHORIZED;
 *             PIN correcto → aprueba PENDIENTE; CONFLICT si ya procesada; NOT_FOUND.
 *   rechazar: HG-16 — sin PIN → ZodError; PIN correcto → rechaza PENDIENTE;
 *             CONFLICT si ya procesada.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { eceRectificacionRouter } from "../ece-rectificacion.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";
import { argon2 } from "@his/infrastructure";

// Mock argon2 para tests rápidos (sin cómputo real).
vi.mock("@his/infrastructure", () => ({
  argon2: {
    argon2id: 2,
    hash: vi.fn().mockResolvedValue("$argon2id$test$hash"),
    verify: vi.fn().mockResolvedValue(true),
  },
}));

type EstadoRectificacion = "PENDIENTE" | "APROBADA" | "RECHAZADA";

// Tenant con rol DIR para procedures aprobar/rechazar.
const TENANT_DIR = { ...MOCK_TENANT, roleCodes: ["DIR"] };

const DOC_ID   = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const RECT_ID  = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const USER_ID  = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const PERS_ID  = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const FIRMA_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const VALID_PIN = "123456";

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

function makeFirmaRow(overrides: Partial<{
  pin_hash: string;
  failed_attempts: number;
  locked_until: Date | null;
  revoked_at: Date | null;
}> = {}) {
  return {
    id: FIRMA_ID,
    pin_hash: "$argon2id$test$hash",
    failed_attempts: 0,
    locked_until: null,
    revoked_at: null,
    ...overrides,
  };
}

describe("eceRectificacionRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    vi.clearAllMocks();
    // Restaurar verify a true tras clearAllMocks.
    vi.mocked(argon2.verify).mockResolvedValue(true);
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
        .mockResolvedValueOnce([{ id: DOC_ID, estado: "FIRMADO" }])
        .mockResolvedValueOnce([{ id: RECT_ID }]);
      prisma.$executeRaw.mockResolvedValueOnce(1);

      const caller = eceRectificacionRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.solicitar(validInput);
      expect(result.id).toBe(RECT_ID);
    });

    it("NOT_FOUND si el documento no existe", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);

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
  // aprobar — HG-16 (NTEC Art. 42)
  // ---------------------------------------------------------------------------
  describe("aprobar", () => {
    it("ZodError si se omite PIN (input inválido)", async () => {
      const caller = eceRectificacionRouter.createCaller(
        makeCtx({ prisma, tenant: TENANT_DIR }),
      );
      // @ts-expect-error — probando input inválido intencionalmente.
      await expect(caller.aprobar({ rectificacionId: RECT_ID }))
        .rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("ZodError si PIN no tiene formato válido (menos de 6 dígitos)", async () => {
      const caller = eceRectificacionRouter.createCaller(
        makeCtx({ prisma, tenant: TENANT_DIR }),
      );
      await expect(
        caller.aprobar({ rectificacionId: RECT_ID, pin: "123" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("UNAUTHORIZED si PIN es incorrecto (HG-16)", async () => {
      // personal_salud → firma
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: PERS_ID }])
        .mockResolvedValueOnce([makeFirmaRow()]);
      // argon2.verify retorna false para este test.
      vi.mocked(argon2.verify).mockResolvedValueOnce(false);

      const caller = eceRectificacionRouter.createCaller(
        makeCtx({ prisma, tenant: TENANT_DIR }),
      );
      await expect(
        caller.aprobar({ rectificacionId: RECT_ID, pin: VALID_PIN }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("happy-path: aprueba rectificación PENDIENTE con PIN correcto", async () => {
      // personal_salud → firma → rectificacion
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: PERS_ID }])
        .mockResolvedValueOnce([makeFirmaRow()])
        .mockResolvedValueOnce([makeRectRow("PENDIENTE")]);
      prisma.$executeRaw
        .mockResolvedValueOnce(1)  // UPDATE estado = APROBADA
        .mockResolvedValueOnce(1); // outbox

      const caller = eceRectificacionRouter.createCaller(
        makeCtx({ prisma, tenant: TENANT_DIR }),
      );
      const result = await caller.aprobar({ rectificacionId: RECT_ID, pin: VALID_PIN });
      expect(result.ok).toBe(true);
    });

    it("NOT_FOUND si la rectificación no existe (post-PIN ok)", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: PERS_ID }])
        .mockResolvedValueOnce([makeFirmaRow()])
        .mockResolvedValueOnce([]); // rectificacion no encontrada

      const caller = eceRectificacionRouter.createCaller(
        makeCtx({ prisma, tenant: TENANT_DIR }),
      );
      await expect(
        caller.aprobar({ rectificacionId: RECT_ID, pin: VALID_PIN }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("CONFLICT si ya fue aprobada (post-PIN ok)", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: PERS_ID }])
        .mockResolvedValueOnce([makeFirmaRow()])
        .mockResolvedValueOnce([makeRectRow("APROBADA")]);

      const caller = eceRectificacionRouter.createCaller(
        makeCtx({ prisma, tenant: TENANT_DIR }),
      );
      await expect(
        caller.aprobar({ rectificacionId: RECT_ID, pin: VALID_PIN }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  // ---------------------------------------------------------------------------
  // rechazar — HG-16 (NTEC Art. 42)
  // ---------------------------------------------------------------------------
  describe("rechazar", () => {
    const MOTIVO = "El campo indicado no corresponde a un error de captura.";

    it("ZodError si se omite PIN (input inválido)", async () => {
      const caller = eceRectificacionRouter.createCaller(
        makeCtx({ prisma, tenant: TENANT_DIR }),
      );
      // @ts-expect-error — probando input inválido intencionalmente.
      await expect(caller.rechazar({ rectificacionId: RECT_ID, motivoRechazo: MOTIVO }))
        .rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("UNAUTHORIZED si PIN es incorrecto (HG-16)", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: PERS_ID }])
        .mockResolvedValueOnce([makeFirmaRow()]);
      vi.mocked(argon2.verify).mockResolvedValueOnce(false);

      const caller = eceRectificacionRouter.createCaller(
        makeCtx({ prisma, tenant: TENANT_DIR }),
      );
      await expect(
        caller.rechazar({ rectificacionId: RECT_ID, motivoRechazo: MOTIVO, pin: VALID_PIN }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("happy-path: rechaza rectificación PENDIENTE con motivo y PIN correcto", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: PERS_ID }])
        .mockResolvedValueOnce([makeFirmaRow()])
        .mockResolvedValueOnce([makeRectRow("PENDIENTE")]);
      prisma.$executeRaw
        .mockResolvedValueOnce(1)  // UPDATE
        .mockResolvedValueOnce(1); // outbox

      const caller = eceRectificacionRouter.createCaller(
        makeCtx({ prisma, tenant: TENANT_DIR }),
      );
      const result = await caller.rechazar({
        rectificacionId: RECT_ID,
        motivoRechazo: MOTIVO,
        pin: VALID_PIN,
      });
      expect(result.ok).toBe(true);
    });

    it("CONFLICT si ya fue rechazada (post-PIN ok)", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: PERS_ID }])
        .mockResolvedValueOnce([makeFirmaRow()])
        .mockResolvedValueOnce([makeRectRow("RECHAZADA")]);

      const caller = eceRectificacionRouter.createCaller(
        makeCtx({ prisma, tenant: TENANT_DIR }),
      );
      await expect(
        caller.rechazar({
          rectificacionId: RECT_ID,
          motivoRechazo: "Motivo de prueba suficientemente largo.",
          pin: VALID_PIN,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });
});
