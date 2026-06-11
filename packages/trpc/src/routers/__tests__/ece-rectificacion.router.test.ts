/**
 * Tests — eceRectificacionRouter (NTEC Art. 41 + Art. 42).
 *
 * Modelo real: solicitud_arco (workflow state) + ece.rectificacion (registro inmutable).
 * Ver sql/166_solicitud_arco_rectificacion_campos.sql.
 *
 * Cubre:
 *   list:     devuelve filas filtradas por documentoInstanciaId.
 *   solicitar: crea solicitud en doc firmado; rechaza doc no-firmado y no-encontrado.
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

// emitDomainEvent escribe a DomainEvent vía Prisma — el mock prisma cubre esto.
vi.mock("@his/database", () => ({
  emitDomainEvent: vi.fn().mockResolvedValue({ id: "evt-mock-id" }),
}));

type EstadoSolicitud = "PENDIENTE" | "APROBADA" | "RECHAZADA" | "EJECUTADA";

// Tenant con rol DIR para procedures aprobar/rechazar.
const TENANT_DIR = { ...MOCK_TENANT, roleCodes: ["DIR"] };

const DOC_ID    = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const RECT_ID   = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const USER_ID   = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const PERS_ID   = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const FIRMA_ID  = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const PAC_ID    = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const VALID_PIN = "123456";

/** Fila de solicitud_arco mapeada al shape que devuelve `list`. */
function makeRectRow(estado: EstadoSolicitud = "PENDIENTE") {
  return {
    id: RECT_ID,
    documento_instancia_id: DOC_ID,
    campo: "diagnostico",
    valor_anterior: "Hipertensión",
    valor_propuesto: "Hipertensión arterial esencial",
    motivo: "Precisión diagnóstica requerida por protocolo",
    // list mapea EJECUTADA→FIRMADA; los tests de list reciben el shape ya mapeado.
    estado: estado === "EJECUTADA" ? ("FIRMADA" as const) : estado,
    solicitante_id: USER_ID,
    solicitante_nombre: "Dr. Pérez",
    aprobador_id: null,
    fecha_aprobacion: null,
    motivo_rechazo: null,
    created_at: new Date().toISOString(),
  };
}

/** Fila interna de solicitud_arco que usa findSolicitud (estado BD real). */
function makeSolicitudRaw(estado: EstadoSolicitud = "PENDIENTE") {
  return {
    id: RECT_ID,
    estado,
    documento_instancia_id: DOC_ID,
    solicitante_id: USER_ID,
    campo: "diagnostico",
    valor_anterior: "Hipertensión",
    valor_propuesto: "Hipertensión arterial esencial",
    motivo: "Precisión diagnóstica requerida por protocolo",
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

    it("devuelve lista vacía si no hay solicitudes", async () => {
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

    it("happy-path: crea solicitud en doc firmado", async () => {
      // 1ª query: documento_instancia + flujo_estado
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: DOC_ID, paciente_public_id: PAC_ID, estado_codigo: "firmado" }])
        // 2ª query: INSERT solicitud_arco RETURNING id
        .mockResolvedValueOnce([{ id: RECT_ID }]);

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

    it("PRECONDITION_FAILED si el documento no está firmado", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ id: DOC_ID, paciente_public_id: PAC_ID, estado_codigo: "borrador" }]);

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
      vi.mocked(argon2.verify).mockResolvedValueOnce(false);

      const caller = eceRectificacionRouter.createCaller(
        makeCtx({ prisma, tenant: TENANT_DIR }),
      );
      await expect(
        caller.aprobar({ rectificacionId: RECT_ID, pin: VALID_PIN }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("happy-path: aprueba solicitud PENDIENTE con PIN correcto", async () => {
      // loadFirmaDir: personal_salud → firma
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: PERS_ID }])
        .mockResolvedValueOnce([makeFirmaRow()])
        // findSolicitud
        .mockResolvedValueOnce([makeSolicitudRaw("PENDIENTE")])
        // resolver personal_salud del aprobador para ece.rectificacion insert
        .mockResolvedValueOnce([{ id: PERS_ID }]);
      // UPDATE solicitud_arco
      prisma.$executeRaw.mockResolvedValueOnce(1);
      // INSERT ece.rectificacion
      prisma.$executeRaw.mockResolvedValueOnce(1);

      const caller = eceRectificacionRouter.createCaller(
        makeCtx({ prisma, tenant: TENANT_DIR }),
      );
      const result = await caller.aprobar({ rectificacionId: RECT_ID, pin: VALID_PIN });
      expect(result.ok).toBe(true);
    });

    it("NOT_FOUND si la solicitud no existe (post-PIN ok)", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: PERS_ID }])
        .mockResolvedValueOnce([makeFirmaRow()])
        .mockResolvedValueOnce([]); // solicitud no encontrada

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
        .mockResolvedValueOnce([makeSolicitudRaw("APROBADA")]);

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

    it("happy-path: rechaza solicitud PENDIENTE con motivo y PIN correcto", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: PERS_ID }])
        .mockResolvedValueOnce([makeFirmaRow()])
        .mockResolvedValueOnce([makeSolicitudRaw("PENDIENTE")]);
      prisma.$executeRaw.mockResolvedValueOnce(1); // UPDATE

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
        .mockResolvedValueOnce([makeSolicitudRaw("RECHAZADA")]);

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
