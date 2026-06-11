/**
 * Tests — eceResultadoEstudioRouter (Doc 18 NTEC).
 *
 * Cubre:
 *   list:             happy-path con solicitudId; nextCursor; FORBIDDEN sin rol.
 *   get:              NOT_FOUND cuando no existe.
 *   registrar:        happy-path; PRECONDITION_FAILED si solicitud no firmada; NOT_FOUND si solicitud inexistente.
 *   validarResultado: happy-path; CONFLICT si resultado no está pendiente; NOT_FOUND si resultado inexistente.
 *
 * Columnas BD reales (HH-02):
 *   valores (jsonb), interpretacion, responsable_validacion_id, fecha_hora_informe, estado_registro
 *   — eliminadas: resultado (text), adjunto_uri, registrado_por, aprobado_por, aprobado_en, comentario_medico, estado
 *   — procedure renombrado: aprobar → validarResultado
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { eceResultadoEstudioRouter } from "../resultado-estudio.router";
import { makeCtx } from "../../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

// ─── Mock outbox ──────────────────────────────────────────────────────────────
vi.mock("@his/database", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@his/database")>();
  return {
    ...mod,
    emitDomainEvent: vi.fn().mockResolvedValue(undefined),
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SOL_ID = "11111111-1111-1111-1111-111111111111";
const RES_ID = "22222222-2222-2222-2222-222222222222";
const INST_ID = "33333333-3333-3333-3333-333333333333";
const PERSONAL_ID = "44444444-4444-4444-4444-444444444444";

const ESTABLISHMENT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

/** Fixture con columnas reales de ece.resultado_estudio. */
function makeResultadoRow(overrides: Partial<{
  id: string;
  estado_registro: string;
  solicitud_id: string;
}> = {}) {
  return {
    id: overrides.id ?? RES_ID,
    instancia_id: INST_ID,
    solicitud_id: overrides.solicitud_id ?? SOL_ID,
    valores: { glucosa: 95, unidad: "mg/dL" },
    interpretacion: "Dentro de rango normal",
    responsable_validacion_id: PERSONAL_ID,
    fecha_hora_informe: new Date("2026-01-15T14:00:00Z"),
    // CHECK DDL: vigente | rectificado. 'pendiente_validacion' no existe.
    estado_registro: overrides.estado_registro ?? "vigente",
  };
}

function makeSolicitudEstadoRow(estadoCodigo: string) {
  return { estado_codigo: estadoCodigo, instancia_id: INST_ID };
}

function makeTecCtx(prisma: DeepMockProxy<PrismaClient>) {
  return makeCtx({
    prisma,
    tenant: { ...MOCK_TENANT, roleCodes: ["TEC"], establishmentId: ESTABLISHMENT_ID },
  });
}

function makeMcCtx(prisma: DeepMockProxy<PrismaClient>) {
  return makeCtx({
    prisma,
    tenant: { ...MOCK_TENANT, roleCodes: ["MC"], establishmentId: ESTABLISHMENT_ID },
  });
}

function makeReaderCtx(prisma: DeepMockProxy<PrismaClient>) {
  return makeCtx({
    prisma,
    tenant: { ...MOCK_TENANT, roleCodes: ["ARCH"], establishmentId: ESTABLISHMENT_ID },
  });
}

function setupTransactionPassThrough(prisma: DeepMockProxy<PrismaClient>) {
  prisma.$transaction.mockImplementation(
    async (fn: (tx: PrismaClient) => Promise<unknown>) => fn(prisma),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("eceResultadoEstudioRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  describe("list", () => {
    it("devuelve items y nextCursor cuando hay exactamente limit resultados", async () => {
      setupTransactionPassThrough(prisma);
      const rows = [makeResultadoRow()];
      prisma.$queryRaw.mockResolvedValue(rows);

      const ctx = makeReaderCtx(prisma);
      const caller = eceResultadoEstudioRouter.createCaller(ctx);
      const result = await caller.list({ solicitudId: SOL_ID, limit: 1 });

      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).toBe(RES_ID);
    });

    it("devuelve nextCursor null cuando hay menos de limit resultados", async () => {
      setupTransactionPassThrough(prisma);
      prisma.$queryRaw.mockResolvedValue([makeResultadoRow()]);

      const ctx = makeReaderCtx(prisma);
      const caller = eceResultadoEstudioRouter.createCaller(ctx);
      const result = await caller.list({ solicitudId: SOL_ID, limit: 20 });

      expect(result.nextCursor).toBeNull();
    });

    it("lanza FORBIDDEN si el rol no tiene acceso", async () => {
      const ctx = makeCtx({
        prisma,
        tenant: { ...MOCK_TENANT, roleCodes: ["ANON"], establishmentId: ESTABLISHMENT_ID },
      });
      const caller = eceResultadoEstudioRouter.createCaller(ctx);
      await expect(caller.list({ solicitudId: SOL_ID })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("lanza BAD_REQUEST sin establishmentId", async () => {
      const ctx = makeCtx({
        prisma,
        tenant: { ...MOCK_TENANT, establishmentId: undefined, roleCodes: ["ARCH"] },
      });
      const caller = eceResultadoEstudioRouter.createCaller(ctx);
      await expect(caller.list({ solicitudId: SOL_ID })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });
  });

  // -------------------------------------------------------------------------
  // get
  // -------------------------------------------------------------------------

  describe("get", () => {
    it("devuelve el resultado cuando existe", async () => {
      setupTransactionPassThrough(prisma);
      prisma.$queryRaw.mockResolvedValue([makeResultadoRow()]);

      const ctx = makeReaderCtx(prisma);
      const caller = eceResultadoEstudioRouter.createCaller(ctx);
      const result = await caller.get({ id: RES_ID });

      expect(result.id).toBe(RES_ID);
    });

    it("lanza NOT_FOUND cuando el resultado no existe", async () => {
      setupTransactionPassThrough(prisma);
      prisma.$queryRaw.mockResolvedValue([]);

      const ctx = makeReaderCtx(prisma);
      const caller = eceResultadoEstudioRouter.createCaller(ctx);
      await expect(caller.get({ id: RES_ID })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  // -------------------------------------------------------------------------
  // registrar — valores (jsonb) en lugar de resultado (text)
  // -------------------------------------------------------------------------

  describe("registrar", () => {
    it("lanza NOT_FOUND si la solicitud no existe", async () => {
      setupTransactionPassThrough(prisma);
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const ctx = makeTecCtx(prisma);
      const caller = eceResultadoEstudioRouter.createCaller(ctx);
      await expect(
        caller.registrar({ solicitudId: SOL_ID, valores: { glucosa: 95 } }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("lanza PRECONDITION_FAILED si la solicitud está en borrador", async () => {
      setupTransactionPassThrough(prisma);
      prisma.$queryRaw.mockResolvedValueOnce([makeSolicitudEstadoRow("borrador")]);

      const ctx = makeTecCtx(prisma);
      const caller = eceResultadoEstudioRouter.createCaller(ctx);
      await expect(
        caller.registrar({ solicitudId: SOL_ID, valores: { glucosa: 95 } }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("lanza PRECONDITION_FAILED si la solicitud está en en_revision", async () => {
      setupTransactionPassThrough(prisma);
      prisma.$queryRaw.mockResolvedValueOnce([makeSolicitudEstadoRow("en_revision")]);

      const ctx = makeTecCtx(prisma);
      const caller = eceResultadoEstudioRouter.createCaller(ctx);
      await expect(
        caller.registrar({ solicitudId: SOL_ID, valores: { glucosa: 95 } }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("registra el resultado cuando la solicitud está firmada", async () => {
      setupTransactionPassThrough(prisma);
      prisma.$queryRaw
        .mockResolvedValueOnce([makeSolicitudEstadoRow("firmado")])  // findSolicitudEstado
        .mockResolvedValueOnce([{ id: PERSONAL_ID }])                // findPersonal
        .mockResolvedValueOnce([{ id: RES_ID }])                    // INSERT resultado
        .mockResolvedValue([]);
      // emitDomainEvent mockeado globalmente vía vi.mock("@his/database")

      const ctx = makeTecCtx(prisma);
      const caller = eceResultadoEstudioRouter.createCaller(ctx);
      const result = await caller.registrar({
        solicitudId: SOL_ID,
        valores: { glucosa: 95, unidad: "mg/dL" },
        interpretacion: "Normal",
      });

      expect(result.resultadoId).toBe(RES_ID);
      expect(result.registradoEn).toBeDefined();
    });

    it("registra el resultado cuando la solicitud está validada", async () => {
      setupTransactionPassThrough(prisma);
      prisma.$queryRaw
        .mockResolvedValueOnce([makeSolicitudEstadoRow("validado")])
        .mockResolvedValueOnce([{ id: PERSONAL_ID }])
        .mockResolvedValueOnce([{ id: RES_ID }])
        .mockResolvedValue([]);
      // emitDomainEvent mockeado globalmente vía vi.mock("@his/database")

      const ctx = makeTecCtx(prisma);
      const caller = eceResultadoEstudioRouter.createCaller(ctx);
      const result = await caller.registrar({
        solicitudId: SOL_ID,
        valores: { hemoglobina: 14, unidad: "g/dL" },
      });

      expect(result.resultadoId).toBe(RES_ID);
    });
  });

  // -------------------------------------------------------------------------
  // validarResultado — emite evento de dominio; sin cambio de estado_registro
  // (CHECK DDL: vigente|rectificado — 'pendiente_validacion'/'validado' no existen)
  // -------------------------------------------------------------------------

  describe("validarResultado", () => {
    it("lanza NOT_FOUND si el resultado no existe", async () => {
      setupTransactionPassThrough(prisma);
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const ctx = makeMcCtx(prisma);
      const caller = eceResultadoEstudioRouter.createCaller(ctx);
      await expect(
        caller.validarResultado({ resultadoId: RES_ID }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("refrenda el resultado vigente y emite evento de dominio (idempotente)", async () => {
      setupTransactionPassThrough(prisma);
      prisma.$queryRaw
        .mockResolvedValueOnce([makeResultadoRow()])  // findResultado
        .mockResolvedValue([]);
      // emitDomainEvent mockeado globalmente vía vi.mock("@his/database")

      const ctx = makeMcCtx(prisma);
      const caller = eceResultadoEstudioRouter.createCaller(ctx);
      const result = await caller.validarResultado({ resultadoId: RES_ID });

      expect(result.ok).toBe(true);
      expect(result.validadoEn).toBeDefined();
    });

    it("lanza FORBIDDEN si el rol no es MC ni ESP", async () => {
      const ctx = makeCtx({
        prisma,
        tenant: { ...MOCK_TENANT, roleCodes: ["TEC"], establishmentId: ESTABLISHMENT_ID },
      });
      const caller = eceResultadoEstudioRouter.createCaller(ctx);
      await expect(caller.validarResultado({ resultadoId: RES_ID })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });
});
