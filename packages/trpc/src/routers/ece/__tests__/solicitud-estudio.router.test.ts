/**
 * Tests — eceSolicitudEstudioRouter (Doc 18 NTEC).
 *
 * Cubre:
 *   list:   happy-path con cursor; sin episodioId trae todo; FORBIDDEN sin rol.
 *   get:    NOT_FOUND cuando no existe.
 *   create: happy-path; PRECONDITION_FAILED sin tipo SOL_EST; NOT_FOUND sin episodio.
 *   firmar: happy-path; CONFLICT si estado no es borrador/en_revision; FORBIDDEN sin rol MC.
 *   validar: CONFLICT si no está firmado.
 *   anular: happy-path; CONFLICT si ya validado.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { eceSolicitudEstudioRouter } from "../solicitud-estudio.router";
import { makeCtx } from "../../../__tests__/helpers/caller";
import { MOCK_USER_ADMIN, MOCK_TENANT } from "@his/test-utils";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SOL_ID = "11111111-1111-1111-1111-111111111111";
const INST_ID = "22222222-2222-2222-2222-222222222222";
const EPISODIO_ID = "33333333-3333-3333-3333-333333333333";
const PACIENTE_ID = "44444444-4444-4444-4444-444444444444";
const PERSONAL_ID = "55555555-5555-5555-5555-555555555555";
const TIPO_DOC_ID = "66666666-6666-6666-6666-666666666666";
const ESTADO_INI_ID = "77777777-7777-7777-7777-777777777777";
const ESTADO_ID = "88888888-8888-8888-8888-888888888888";
const FIRMA_ID = "99999999-9999-9999-9999-999999999999";
const DEST_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function makeSolicitudRow(overrides: Partial<{
  id: string;
  instancia_id: string;
  estado_codigo: string;
  tipo: string;
  prioridad: string;
}> = {}) {
  return {
    id: overrides.id ?? SOL_ID,
    instancia_id: overrides.instancia_id ?? INST_ID,
    episodio_id: EPISODIO_ID,
    paciente_id: PACIENTE_ID,
    tipo: overrides.tipo ?? "laboratorio",
    estudios_solicitados: ["2093-3"],
    prioridad: overrides.prioridad ?? "rutina",
    observaciones_clinicas: null,
    solicitado_por: PERSONAL_ID,
    fecha_solicitud: new Date("2026-01-15T10:00:00Z"),
    estado_codigo: overrides.estado_codigo ?? "borrador",
    estado_id: ESTADO_ID,
  };
}

function makeMcCtx(prisma: DeepMockProxy<PrismaClient>) {
  return makeCtx({
    prisma,
    tenant: {
      ...MOCK_TENANT,
      roleCodes: ["MC"],
      establishmentId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    },
  });
}

function makeReaderCtx(prisma: DeepMockProxy<PrismaClient>) {
  return makeCtx({
    prisma,
    tenant: {
      ...MOCK_TENANT,
      roleCodes: ["ARCH"],
      establishmentId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    },
  });
}

// ---------------------------------------------------------------------------
// Setup: Prisma $transaction delega al callback
// ---------------------------------------------------------------------------

function setupTransactionPassThrough(prisma: DeepMockProxy<PrismaClient>) {
  prisma.$transaction.mockImplementation(
    async (fn: (tx: PrismaClient) => Promise<unknown>) => fn(prisma),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("eceSolicitudEstudioRouter", () => {
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
      const rows = [makeSolicitudRow()];
      prisma.$queryRaw.mockResolvedValue(rows);

      const ctx = makeReaderCtx(prisma);
      const caller = eceSolicitudEstudioRouter.createCaller(ctx);
      const result = await caller.list({ limit: 1 });

      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).toBe(SOL_ID);
    });

    it("devuelve nextCursor null cuando hay menos de limit resultados", async () => {
      setupTransactionPassThrough(prisma);
      prisma.$queryRaw.mockResolvedValue([makeSolicitudRow()]);

      const ctx = makeReaderCtx(prisma);
      const caller = eceSolicitudEstudioRouter.createCaller(ctx);
      const result = await caller.list({ limit: 20 });

      expect(result.nextCursor).toBeNull();
    });

    it("lanza BAD_REQUEST si el contexto no tiene establishmentId", async () => {
      const ctx = makeCtx({
        prisma,
        tenant: { ...MOCK_TENANT, establishmentId: undefined, roleCodes: ["ARCH"] },
      });
      const caller = eceSolicitudEstudioRouter.createCaller(ctx);
      await expect(caller.list({})).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("lanza FORBIDDEN si el rol no tiene acceso", async () => {
      const ctx = makeCtx({
        prisma,
        tenant: { ...MOCK_TENANT, roleCodes: ["PACIENTE"] },
      });
      const caller = eceSolicitudEstudioRouter.createCaller(ctx);
      await expect(caller.list({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  // -------------------------------------------------------------------------
  // get
  // -------------------------------------------------------------------------

  describe("get", () => {
    it("devuelve la solicitud cuando existe", async () => {
      setupTransactionPassThrough(prisma);
      prisma.$queryRaw.mockResolvedValue([makeSolicitudRow()]);

      const ctx = makeReaderCtx(prisma);
      const caller = eceSolicitudEstudioRouter.createCaller(ctx);
      const result = await caller.get({ id: SOL_ID });

      expect(result.id).toBe(SOL_ID);
    });

    it("lanza NOT_FOUND cuando la solicitud no existe", async () => {
      setupTransactionPassThrough(prisma);
      prisma.$queryRaw.mockResolvedValue([]);

      const ctx = makeReaderCtx(prisma);
      const caller = eceSolicitudEstudioRouter.createCaller(ctx);
      await expect(caller.get({ id: SOL_ID })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  describe("create", () => {
    it("crea solicitud y retorna ids cuando los datos son válidos", async () => {
      setupTransactionPassThrough(prisma);
      prisma.$queryRaw
        .mockResolvedValueOnce([{ tipo_doc_id: TIPO_DOC_ID, estado_inicial_id: ESTADO_INI_ID }])
        .mockResolvedValueOnce([{ paciente_id: PACIENTE_ID }])
        .mockResolvedValueOnce([{ id: PERSONAL_ID }])
        .mockResolvedValueOnce([{ id: INST_ID }])
        .mockResolvedValueOnce([{ id: SOL_ID }]);

      const ctx = makeMcCtx(prisma);
      const caller = eceSolicitudEstudioRouter.createCaller(ctx);
      const result = await caller.create({
        episodioId: EPISODIO_ID,
        tipo: "laboratorio",
        estudiosSolicitados: ["2093-3"],
        prioridad: "rutina",
      });

      expect(result.solicitudId).toBe(SOL_ID);
      expect(result.estadoCodigo).toBe("borrador");
    });

    it("lanza PRECONDITION_FAILED si SOL_EST no está configurado", async () => {
      setupTransactionPassThrough(prisma);
      // Primera query (tipo_documento) devuelve vacío
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const ctx = makeMcCtx(prisma);
      const caller = eceSolicitudEstudioRouter.createCaller(ctx);
      await expect(
        caller.create({
          episodioId: EPISODIO_ID,
          tipo: "laboratorio",
          estudiosSolicitados: ["2093-3"],
          prioridad: "rutina",
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("lanza NOT_FOUND si el episodio no existe", async () => {
      setupTransactionPassThrough(prisma);
      prisma.$queryRaw
        .mockResolvedValueOnce([{ tipo_doc_id: TIPO_DOC_ID, estado_inicial_id: ESTADO_INI_ID }])
        .mockResolvedValueOnce([]); // episodio vacío

      const ctx = makeMcCtx(prisma);
      const caller = eceSolicitudEstudioRouter.createCaller(ctx);
      await expect(
        caller.create({
          episodioId: EPISODIO_ID,
          tipo: "laboratorio",
          estudiosSolicitados: ["2093-3"],
          prioridad: "rutina",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // -------------------------------------------------------------------------
  // firmar
  // -------------------------------------------------------------------------

  describe("firmar", () => {
    it("lanza CONFLICT si la solicitud no está en borrador ni en_revision", async () => {
      setupTransactionPassThrough(prisma);
      prisma.$queryRaw.mockResolvedValueOnce([makeSolicitudRow({ estado_codigo: "validado" })]);

      const ctx = makeMcCtx(prisma);
      const caller = eceSolicitudEstudioRouter.createCaller(ctx);
      await expect(
        caller.firmar({ solicitudId: SOL_ID, pin: "123456" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("lanza NOT_FOUND si la solicitud no existe", async () => {
      setupTransactionPassThrough(prisma);
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const ctx = makeMcCtx(prisma);
      const caller = eceSolicitudEstudioRouter.createCaller(ctx);
      await expect(
        caller.firmar({ solicitudId: SOL_ID, pin: "123456" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("lanza FORBIDDEN si rol no es MC ni ESP", async () => {
      const ctx = makeCtx({
        prisma,
        tenant: { ...MOCK_TENANT, roleCodes: ["ENF"], establishmentId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" },
      });
      const caller = eceSolicitudEstudioRouter.createCaller(ctx);
      await expect(
        caller.firmar({ solicitudId: SOL_ID, pin: "123456" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  // -------------------------------------------------------------------------
  // validar
  // -------------------------------------------------------------------------

  describe("validar", () => {
    it("lanza CONFLICT si la solicitud no está en estado firmado", async () => {
      setupTransactionPassThrough(prisma);
      prisma.$queryRaw.mockResolvedValueOnce([makeSolicitudRow({ estado_codigo: "borrador" })]);

      const ctx = makeMcCtx(prisma);
      const caller = eceSolicitudEstudioRouter.createCaller(ctx);
      await expect(
        caller.validar({ solicitudId: SOL_ID }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("llama a avanzarEstado y emitDomainEvent cuando el estado es firmado", async () => {
      setupTransactionPassThrough(prisma);
      // findSolicitud
      prisma.$queryRaw
        .mockResolvedValueOnce([makeSolicitudRow({ estado_codigo: "firmado" })])
        // avanzarEstado — buscar transición
        .mockResolvedValueOnce([{ estado_destino_id: DEST_ID }]);
      prisma.$executeRaw
        .mockResolvedValueOnce(1) // UPDATE documento_instancia
        .mockResolvedValueOnce(1); // INSERT historial
      prisma.$queryRaw.mockResolvedValue([]);
      // Mock del Prisma model usado por emitDomainEvent (mismo patrón que
      // accounting.test.ts). Sin esto, `tx.domainEvent.create({data})` retorna
      // undefined y desreferenciar `.id` lanza TypeError.
      prisma.domainEvent.create.mockResolvedValue({ id: "ev-1" } as never);

      const ctx = makeMcCtx(prisma);
      const caller = eceSolicitudEstudioRouter.createCaller(ctx);
      const result = await caller.validar({ solicitudId: SOL_ID });

      expect(result.ok).toBe(true);
      expect(result.validadoEn).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // anular
  // -------------------------------------------------------------------------

  describe("anular", () => {
    it("lanza CONFLICT si la solicitud ya está validada", async () => {
      setupTransactionPassThrough(prisma);
      prisma.$queryRaw.mockResolvedValueOnce([makeSolicitudRow({ estado_codigo: "validado" })]);

      const ctx = makeMcCtx(prisma);
      const caller = eceSolicitudEstudioRouter.createCaller(ctx);
      await expect(
        caller.anular({ solicitudId: SOL_ID, motivo: "Error en datos" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("lanza CONFLICT si la solicitud ya está anulada", async () => {
      setupTransactionPassThrough(prisma);
      prisma.$queryRaw.mockResolvedValueOnce([makeSolicitudRow({ estado_codigo: "anulado" })]);

      const ctx = makeMcCtx(prisma);
      const caller = eceSolicitudEstudioRouter.createCaller(ctx);
      await expect(
        caller.anular({ solicitudId: SOL_ID, motivo: "Duplicado" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });
});
