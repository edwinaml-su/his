/**
 * Tests del evolucionMedicaRouter (ECE §3.8 Evolución Médica).
 *
 * Cubre:
 *   - create: happy-path SOAP completo; falla si falta campo SOAP (Zod); falla si episodio no existe.
 *   - update: CONFLICT si estado != borrador; NOT_FOUND; happy-path borrador.
 *   - firmar: happy-path emite outbox; CONFLICT si ya firmado; NOT_FOUND.
 *   - validar: happy-path desde firmado; CONFLICT si estado != firmado.
 *   - list: retorna filas (smoke test de filtros opcionales).
 *   - get: NOT_FOUND si no existe; happy-path.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";

vi.mock("@his/database", async (importOriginal) => {
  const original = await importOriginal<typeof import("@his/database")>();
  return {
    ...original,
    emitDomainEvent: vi.fn().mockResolvedValue({ id: "event-id" }),
  };
});

import { emitDomainEvent } from "@his/database";
import { evolucionMedicaRouter } from "../evolucion-medica.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_USER_ADMIN, MOCK_TENANT } from "@his/test-utils";

const PERSONAL_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const EVOLUCION_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const INSTANCIA_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const EPISODIO_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const TIPO_DOC_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const ESTADO_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const ESTADO_FIRMADO_ID = "11111111-1111-1111-1111-111111111111";

const VALID_SOAP = {
  soapSubjetivo: "Paciente refiere dolor abdominal.",
  soapObjetivo: "Abdomen blando, sin rigidez.",
  soapAnalisis: "Compatible con gastroenteritis.",
  soapPlan: "Hidratación oral, antiespasmódico.",
};

function makeEvolucionRow(estadoCodigo = "borrador") {
  return {
    id: EVOLUCION_ID,
    instancia_id: INSTANCIA_ID,
    episodio_id: EPISODIO_ID,
    fecha_hora: new Date(),
    subjetivo: VALID_SOAP.soapSubjetivo,
    objetivo: VALID_SOAP.soapObjetivo,
    analisis: VALID_SOAP.soapAnalisis,
    plan: VALID_SOAP.soapPlan,
    registrado_por: PERSONAL_ID,
    registrado_en: new Date(),
    estado_registro: "vigente",
    estado_codigo: estadoCodigo,
  };
}

// El router usa prisma.$transaction internamente (via withWorkflowContext).
// Simulamos que la transacción ejecuta el callback con el mismo mock de prisma.
function setupTransactionMock(prisma: DeepMockProxy<PrismaClient>) {
  prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    return fn(prisma);
  });
}

describe("evolucionMedicaRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    setupTransactionMock(prisma);
    vi.clearAllMocks();
    // Re-instalar transaction mock después de clearAllMocks
    setupTransactionMock(prisma);
  });

  // ─── create ──────────────────────────────────────────────────────────────

  describe("create", () => {
    it("happy-path: crea evolución con los 4 campos SOAP", async () => {
      prisma.$executeRawUnsafe.mockResolvedValue(0); // GUC SET LOCAL
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: PERSONAL_ID }]) // personal_salud
        .mockResolvedValueOnce([{ id: TIPO_DOC_ID }]) // tipo_documento EVOL_MED
        .mockResolvedValueOnce([{ id: ESTADO_ID }]) // flujo_estado inicial
        .mockResolvedValueOnce([{ id: INSTANCIA_ID }]) // INSERT instancia
        .mockResolvedValueOnce([{ id: EVOLUCION_ID }]); // INSERT evolucion

      const caller = evolucionMedicaRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.create({
        episodioId: EPISODIO_ID,
        fecha: new Date("2026-05-17"),
        ...VALID_SOAP,
      });

      expect(result.id).toBe(EVOLUCION_ID);
      expect(result.instanciaId).toBe(INSTANCIA_ID);
    });

    it("rechaza si un campo SOAP está vacío (validación Zod)", async () => {
      const caller = evolucionMedicaRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.create({
          episodioId: EPISODIO_ID,
          fecha: new Date(),
          soapSubjetivo: "", // vacío — min(1)
          soapObjetivo: VALID_SOAP.soapObjetivo,
          soapAnalisis: VALID_SOAP.soapAnalisis,
          soapPlan: VALID_SOAP.soapPlan,
        }),
      ).rejects.toThrow();
    });

    it("retorna NOT_FOUND si el episodio no existe (INSERT instancia devuelve vacío)", async () => {
      prisma.$executeRawUnsafe.mockResolvedValue(0);
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: PERSONAL_ID }])
        .mockResolvedValueOnce([{ id: TIPO_DOC_ID }])
        .mockResolvedValueOnce([{ id: ESTADO_ID }])
        .mockResolvedValueOnce([]); // episodio no encontrado en SELECT INTO instancia

      const caller = evolucionMedicaRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.create({ episodioId: EPISODIO_ID, fecha: new Date(), ...VALID_SOAP }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("retorna PRECONDITION_FAILED si el usuario no tiene personal ECE", async () => {
      prisma.$executeRawUnsafe.mockResolvedValue(0);
      prisma.$queryRaw.mockResolvedValueOnce([]); // personal_salud no encontrado

      const caller = evolucionMedicaRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.create({ episodioId: EPISODIO_ID, fecha: new Date(), ...VALID_SOAP }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });
  });

  // ─── update ──────────────────────────────────────────────────────────────

  describe("update", () => {
    it("happy-path: actualiza campos SOAP en borrador", async () => {
      prisma.$executeRawUnsafe.mockResolvedValue(0);
      prisma.$queryRaw
        .mockResolvedValueOnce([
          { instancia_id: INSTANCIA_ID, registrado_por: PERSONAL_ID, estado_codigo: "borrador" },
        ])
        .mockResolvedValueOnce([{ id: PERSONAL_ID }]); // personal match
      prisma.$executeRaw.mockResolvedValue(1);

      const caller = evolucionMedicaRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.update({
        id: EVOLUCION_ID,
        soapPlan: "Reposo 48 h.",
      });
      expect(result.ok).toBe(true);
    });

    it("CONFLICT si estado es 'firmado'", async () => {
      prisma.$executeRawUnsafe.mockResolvedValue(0);
      prisma.$queryRaw.mockResolvedValueOnce([
        { instancia_id: INSTANCIA_ID, registrado_por: PERSONAL_ID, estado_codigo: "firmado" },
      ]);

      const caller = evolucionMedicaRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.update({ id: EVOLUCION_ID, soapPlan: "Nuevo plan." }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("NOT_FOUND si la evolución no existe", async () => {
      prisma.$executeRawUnsafe.mockResolvedValue(0);
      prisma.$queryRaw.mockResolvedValueOnce([]); // row vacía

      const caller = evolucionMedicaRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.update({ id: EVOLUCION_ID, soapPlan: "x" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // ─── firmar ──────────────────────────────────────────────────────────────

  describe("firmar", () => {
    it("happy-path: firma evolución en borrador y emite outbox", async () => {
      prisma.$executeRawUnsafe.mockResolvedValue(0);
      prisma.$queryRaw
        .mockResolvedValueOnce([
          {
            instancia_id: INSTANCIA_ID,
            episodio_id: EPISODIO_ID,
            registrado_por: PERSONAL_ID,
            estado_codigo: "borrador",
            ...VALID_SOAP,
          },
        ])
        .mockResolvedValueOnce([{ id: PERSONAL_ID }]) // personal firmante
        .mockResolvedValueOnce([{ estado_actual_id: ESTADO_ID }]) // avanzarEstado: estado actual
        .mockResolvedValueOnce([{ id: ESTADO_FIRMADO_ID }]); // avanzarEstado: estado destino
      prisma.$executeRaw.mockResolvedValue(1);

      const caller = evolucionMedicaRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.firmar({ id: EVOLUCION_ID });

      expect(result.ok).toBe(true);
      expect(result.contentHash).toHaveLength(64); // SHA-256 hex
      expect(emitDomainEvent).toHaveBeenCalledOnce();
    });

    it("CONFLICT si la evolución ya está firmada", async () => {
      prisma.$executeRawUnsafe.mockResolvedValue(0);
      prisma.$queryRaw.mockResolvedValueOnce([
        {
          instancia_id: INSTANCIA_ID,
          episodio_id: EPISODIO_ID,
          registrado_por: PERSONAL_ID,
          estado_codigo: "firmado",
          ...VALID_SOAP,
        },
      ]);

      const caller = evolucionMedicaRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.firmar({ id: EVOLUCION_ID })).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });

    it("NOT_FOUND si la evolución no existe", async () => {
      prisma.$executeRawUnsafe.mockResolvedValue(0);
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const caller = evolucionMedicaRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.firmar({ id: EVOLUCION_ID })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("happy-path: MC puede firmar una evolución en en_revision", async () => {
      prisma.$executeRawUnsafe.mockResolvedValue(0);
      prisma.$queryRaw
        .mockResolvedValueOnce([
          {
            instancia_id: INSTANCIA_ID,
            episodio_id: EPISODIO_ID,
            registrado_por: PERSONAL_ID,
            estado_codigo: "en_revision",
            ...VALID_SOAP,
          },
        ])
        .mockResolvedValueOnce([{ id: PERSONAL_ID }])
        .mockResolvedValueOnce([{ estado_actual_id: ESTADO_ID }])
        .mockResolvedValueOnce([{ id: ESTADO_FIRMADO_ID }]);
      prisma.$executeRaw.mockResolvedValue(1);

      const caller = evolucionMedicaRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.firmar({ id: EVOLUCION_ID });
      expect(result.ok).toBe(true);
    });
  });

  // ─── validar ─────────────────────────────────────────────────────────────

  describe("validar", () => {
    it("happy-path: valida evolución en estado firmado", async () => {
      prisma.$executeRawUnsafe.mockResolvedValue(0);
      prisma.$queryRaw
        .mockResolvedValueOnce([{ instancia_id: INSTANCIA_ID, estado_codigo: "firmado" }])
        .mockResolvedValueOnce([{ id: PERSONAL_ID }])
        .mockResolvedValueOnce([{ estado_actual_id: ESTADO_FIRMADO_ID }])
        .mockResolvedValueOnce([{ id: "validado-estado-id" }]);
      prisma.$executeRaw.mockResolvedValue(1);

      const caller = evolucionMedicaRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.validar({ id: EVOLUCION_ID });
      expect(result.ok).toBe(true);
    });

    it("CONFLICT si estado no es firmado", async () => {
      prisma.$executeRawUnsafe.mockResolvedValue(0);
      prisma.$queryRaw.mockResolvedValueOnce([
        { instancia_id: INSTANCIA_ID, estado_codigo: "borrador" },
      ]);

      const caller = evolucionMedicaRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.validar({ id: EVOLUCION_ID })).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });
  });

  // ─── list ─────────────────────────────────────────────────────────────────

  describe("list", () => {
    it("retorna lista filtrada por episodioId", async () => {
      prisma.$executeRawUnsafe.mockResolvedValue(0);
      prisma.$queryRaw.mockResolvedValueOnce([makeEvolucionRow()]);

      const caller = evolucionMedicaRouter.createCaller(makeCtx({ prisma }));
      const rows = await caller.list({ episodioId: EPISODIO_ID });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toBe(EVOLUCION_ID);
    });
  });

  // ─── get ──────────────────────────────────────────────────────────────────

  describe("get", () => {
    it("NOT_FOUND si la evolución no existe", async () => {
      prisma.$executeRawUnsafe.mockResolvedValue(0);
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const caller = evolucionMedicaRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.get({ id: EVOLUCION_ID })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("happy-path: retorna fila con estado_codigo", async () => {
      prisma.$executeRawUnsafe.mockResolvedValue(0);
      prisma.$queryRaw.mockResolvedValueOnce([makeEvolucionRow("firmado")]);

      const caller = evolucionMedicaRouter.createCaller(makeCtx({ prisma }));
      const row = await caller.get({ id: EVOLUCION_ID });
      expect(row.estado_codigo).toBe("firmado");
    });
  });
});
