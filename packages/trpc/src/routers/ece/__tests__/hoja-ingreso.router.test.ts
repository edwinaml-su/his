/**
 * Tests del eceHojaIngresoRouter (Doc 12 NTEC §3.12).
 *
 * Cubre:
 *   create:  happy-path; NOT_FOUND si orden inexistente; CONFLICT si duplicado; sin establecimiento → BAD_REQUEST
 *   list:    happy-path con filtros; paginación
 *   get:     happy-path; NOT_FOUND
 *   update:  happy-path; CONFLICT si no borrador
 *   firmar:  happy-path; CONFLICT si estado inválido; FORBIDDEN por transición
 *   validar: happy-path; CONFLICT si no firmado
 *   anular:  happy-path; CONFLICT si ya validado
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { eceHojaIngresoRouter } from "../hoja-ingreso.router";
import { makeCtx } from "../../../__tests__/helpers/caller";
import { MOCK_USER_ADMIN, MOCK_TENANT } from "@his/test-utils";

// ─── UUIDs de fixture ─────────────────────────────────────────────────────────

const HOJA_ID       = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const INSTANCIA_ID  = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const PACIENTE_ID   = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ORDEN_ID      = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const SERVICIO_ID   = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const PERSONAL_ID   = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const FIRMA_ID      = "11111111-1111-1111-1111-111111111111";
const TIPO_DOC_ID   = "22222222-2222-2222-2222-222222222222";
const ESTADO_INIT   = "33333333-3333-3333-3333-333333333333";
const ESTADO_FIRM   = "44444444-4444-4444-4444-444444444444";

// argon2.verify se mockea globalmente para no ejecutar hash real en tests.
// Uso de implementación in-line (no mockResolvedValue) por compatibilidad
// con el orden de hoist de vi.mock + import default (patrón de cert-defuncion).
vi.mock("@his/infrastructure", () => ({
  argon2: {
    verify: vi.fn(async () => true),
    },
}));

// emitDomainEvent mockeado para no depender de @his/database real
vi.mock("@his/database", () => ({
  emitDomainEvent: vi.fn().mockResolvedValue(undefined),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeHojaRow(
  overrides: Partial<{
    id: string;
    estado_codigo: string;
    instancia_id: string;
    paciente_id: string;
    orden_ingreso_id: string;
    servicio_ingreso_id: string;
    modalidad: string;
    procedencia: string;
    cama_asignada_id: string | null;
    diagnostico_ingreso: string | null;
    motivo_consulta: string | null;
    notas_adicionales: string | null;
    admisionista_id: string;
    episodio_hospitalario_id: string | null;
    estado_id: string;
    creado_en: Date;
    fecha_hora_ingreso: Date;
  }> = {},
) {
  return {
    id: overrides.id ?? HOJA_ID,
    instancia_id: overrides.instancia_id ?? INSTANCIA_ID,
    paciente_id: overrides.paciente_id ?? PACIENTE_ID,
    episodio_hospitalario_id: overrides.episodio_hospitalario_id ?? null,
    orden_ingreso_id: overrides.orden_ingreso_id ?? ORDEN_ID,
    fecha_hora_ingreso: overrides.fecha_hora_ingreso ?? new Date("2026-05-17T10:00:00Z"),
    servicio_ingreso_id: overrides.servicio_ingreso_id ?? SERVICIO_ID,
    cama_asignada_id: overrides.cama_asignada_id ?? null,
    modalidad: overrides.modalidad ?? "urgente",
    procedencia: overrides.procedencia ?? "Urgencias",
    diagnostico_ingreso: overrides.diagnostico_ingreso ?? null,
    motivo_consulta: overrides.motivo_consulta ?? null,
    notas_adicionales: overrides.notas_adicionales ?? null,
    admisionista_id: overrides.admisionista_id ?? PERSONAL_ID,
    estado_codigo: overrides.estado_codigo ?? "borrador",
    estado_id: overrides.estado_id ?? ESTADO_INIT,
    creado_en: overrides.creado_en ?? new Date("2026-05-17T10:00:00Z"),
  };
}

/** Contexto con rol ADM (para create/update/firmar). */
function makeAdmCtx(prisma: DeepMockProxy<PrismaClient>) {
  return makeCtx({ prisma, tenant: { ...MOCK_TENANT, roleCodes: ["ADM"] } });
}

/** Contexto con rol ARCH (para validar). */
function makeArchCtx(prisma: DeepMockProxy<PrismaClient>) {
  return makeCtx({ prisma, tenant: { ...MOCK_TENANT, roleCodes: ["ARCH"] } });
}

/** Contexto con rol DIR (para anular). */
function makeDirCtx(prisma: DeepMockProxy<PrismaClient>) {
  return makeCtx({ prisma, tenant: { ...MOCK_TENANT, roleCodes: ["DIR"] } });
}

/** Contexto sin establecimiento (debe lanzar BAD_REQUEST). */
function makeCtxNoEstab(prisma: DeepMockProxy<PrismaClient>) {
  return makeCtx({
    prisma,
    tenant: { ...MOCK_TENANT, establishmentId: undefined, roleCodes: ["ADM"] },
  });
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("eceHojaIngresoRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    vi.clearAllMocks();
  });

  // ── create ─────────────────────────────────────────────────────────────────

  describe("create", () => {
    it("happy-path: crea hoja en borrador y retorna id + instanciaId", async () => {
      // $transaction callback — prisma.$transaction ejecuta el fn inline
      prisma.$transaction.mockImplementation(async (fn) => fn(prisma));

      // Secuencia de $queryRaw:
      // 1. SET LOCAL GUC (applyWorkflowContext) — ignorados porque son $executeRawUnsafe
      // 2. resolveTipoDoc → tipo_doc + estado_inicial
      // 3. findOrdenIngreso → orden row
      // 4. duplicado → vacío
      // 5. findPersonal → personal row
      // 6. INSERT instancia → id
      // 7. INSERT hoja → id
      prisma.$executeRawUnsafe.mockResolvedValue(0);
      prisma.$queryRaw
        .mockResolvedValueOnce([{ tipo_doc_id: TIPO_DOC_ID, estado_inicial_id: ESTADO_INIT }])
        .mockResolvedValueOnce([{ id: ORDEN_ID, paciente_id: PACIENTE_ID, episodio_hospitalario_id: null }])
        .mockResolvedValueOnce([])             // sin duplicado
        .mockResolvedValueOnce([{ id: PERSONAL_ID }])
        .mockResolvedValueOnce([{ id: INSTANCIA_ID }])
        .mockResolvedValueOnce([{ id: HOJA_ID }]);

      const caller = eceHojaIngresoRouter.createCaller(makeAdmCtx(prisma));
      const result = await caller.create({
        ordenIngresoId: ORDEN_ID,
        fechaHoraIngreso: new Date("2026-05-17T10:00:00Z"),
        servicioIngresoId: SERVICIO_ID,
        modalidad: "urgente",
        procedencia: "Urgencias",
      });

      expect(result.id).toBe(HOJA_ID);
      expect(result.instanciaId).toBe(INSTANCIA_ID);
      expect(result.estadoCodigo).toBe("borrador");
    });

    it("lanza NOT_FOUND si la orden de ingreso no existe", async () => {
      prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
      prisma.$executeRawUnsafe.mockResolvedValue(0);
      prisma.$queryRaw
        .mockResolvedValueOnce([{ tipo_doc_id: TIPO_DOC_ID, estado_inicial_id: ESTADO_INIT }])
        .mockResolvedValueOnce([]); // orden no encontrada

      const caller = eceHojaIngresoRouter.createCaller(makeAdmCtx(prisma));

      await expect(
        caller.create({
          ordenIngresoId: ORDEN_ID,
          fechaHoraIngreso: new Date(),
          servicioIngresoId: SERVICIO_ID,
          modalidad: "programado",
          procedencia: "Consulta externa",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("lanza CONFLICT si ya existe una hoja activa para la misma orden", async () => {
      prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
      prisma.$executeRawUnsafe.mockResolvedValue(0);
      prisma.$queryRaw
        .mockResolvedValueOnce([{ tipo_doc_id: TIPO_DOC_ID, estado_inicial_id: ESTADO_INIT }])
        .mockResolvedValueOnce([{ id: ORDEN_ID, paciente_id: PACIENTE_ID, episodio_hospitalario_id: null }])
        .mockResolvedValueOnce([{ id: HOJA_ID, estado: "borrador" }]); // duplicado

      const caller = eceHojaIngresoRouter.createCaller(makeAdmCtx(prisma));

      await expect(
        caller.create({
          ordenIngresoId: ORDEN_ID,
          fechaHoraIngreso: new Date(),
          servicioIngresoId: SERVICIO_ID,
          modalidad: "urgente",
          procedencia: "Urgencias",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("lanza BAD_REQUEST si no hay establecimiento activo", async () => {
      const caller = eceHojaIngresoRouter.createCaller(makeCtxNoEstab(prisma));

      await expect(
        caller.create({
          ordenIngresoId: ORDEN_ID,
          fechaHoraIngreso: new Date(),
          servicioIngresoId: SERVICIO_ID,
          modalidad: "urgente",
          procedencia: "Urgencias",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  // ── get ────────────────────────────────────────────────────────────────────

  describe("get", () => {
    it("happy-path: retorna la hoja de ingreso", async () => {
      prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
      prisma.$executeRawUnsafe.mockResolvedValue(0);
      prisma.$queryRaw.mockResolvedValueOnce([makeHojaRow()]);

      const caller = eceHojaIngresoRouter.createCaller(makeAdmCtx(prisma));
      const result = await caller.get({ id: HOJA_ID });

      expect(result.id).toBe(HOJA_ID);
      expect(result.estado_codigo).toBe("borrador");
    });

    it("lanza NOT_FOUND si la hoja no existe", async () => {
      prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
      prisma.$executeRawUnsafe.mockResolvedValue(0);
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const caller = eceHojaIngresoRouter.createCaller(makeAdmCtx(prisma));

      await expect(caller.get({ id: HOJA_ID })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  // ── list ───────────────────────────────────────────────────────────────────

  describe("list", () => {
    it("happy-path: retorna items paginados y total", async () => {
      prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
      prisma.$executeRawUnsafe.mockResolvedValue(0);
      prisma.$queryRaw
        .mockResolvedValueOnce([{ total: BigInt(2) }])
        .mockResolvedValueOnce([makeHojaRow(), makeHojaRow({ id: "bbbbbbbb-bbbb-bbbb-bbbb-000000000001" })]);

      const caller = eceHojaIngresoRouter.createCaller(makeAdmCtx(prisma));
      const result = await caller.list({ page: 1, pageSize: 20 });

      expect(result.total).toBe(2);
      expect(result.items).toHaveLength(2);
    });
  });

  // ── update ─────────────────────────────────────────────────────────────────

  describe("update", () => {
    it("happy-path: actualiza procedencia en estado borrador", async () => {
      prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
      prisma.$executeRawUnsafe.mockResolvedValue(0);
      prisma.$queryRaw.mockResolvedValueOnce([makeHojaRow()]);
      prisma.$executeRaw.mockResolvedValue(1);

      const caller = eceHojaIngresoRouter.createCaller(makeAdmCtx(prisma));
      const result = await caller.update({ id: HOJA_ID, procedencia: "Traslado" });

      expect(result.ok).toBe(true);
    });

    it("lanza CONFLICT si el estado no es borrador", async () => {
      prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
      prisma.$executeRawUnsafe.mockResolvedValue(0);
      prisma.$queryRaw.mockResolvedValueOnce([makeHojaRow({ estado_codigo: "firmado" })]);

      const caller = eceHojaIngresoRouter.createCaller(makeAdmCtx(prisma));

      await expect(
        caller.update({ id: HOJA_ID, procedencia: "Traslado" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  // ── firmar ─────────────────────────────────────────────────────────────────

  describe("firmar", () => {
    it("happy-path: avanza a firmado y retorna payloadHash", async () => {
      prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
      prisma.$executeRawUnsafe.mockResolvedValue(0);
      // findHojaIngreso
      prisma.$queryRaw
        .mockResolvedValueOnce([makeHojaRow({ estado_codigo: "borrador" })])
        // verifyPinOrThrow → findPersonal
        .mockResolvedValueOnce([{ id: PERSONAL_ID }])
        // verifyPinOrThrow → findFirmaByPersonal
        .mockResolvedValueOnce([{
          id: FIRMA_ID,
          pin_hash: "hash",
          failed_attempts: 0,
          locked_until: null,
          revoked_at: null,
        }])
        // avanzarEstado → transiciones
        .mockResolvedValueOnce([{ estado_destino_id: ESTADO_FIRM }]);

      prisma.$executeRaw.mockResolvedValue(1);

      const caller = eceHojaIngresoRouter.createCaller(makeAdmCtx(prisma));
      const result = await caller.firmar({ id: HOJA_ID, pin: "123456" });

      expect(result.ok).toBe(true);
      expect(result.payloadHash).toBeTypeOf("string");
      expect(result.payloadHash).toHaveLength(64); // SHA-256 hex
    });

    it("lanza CONFLICT si el estado no permite firma", async () => {
      prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
      prisma.$executeRawUnsafe.mockResolvedValue(0);
      prisma.$queryRaw.mockResolvedValueOnce([makeHojaRow({ estado_codigo: "validado" })]);

      const caller = eceHojaIngresoRouter.createCaller(makeAdmCtx(prisma));

      await expect(
        caller.firmar({ id: HOJA_ID, pin: "123456" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("lanza FORBIDDEN si no existe transición válida (rol no autorizado)", async () => {
      prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
      prisma.$executeRawUnsafe.mockResolvedValue(0);
      prisma.$queryRaw
        .mockResolvedValueOnce([makeHojaRow()])
        .mockResolvedValueOnce([{ id: PERSONAL_ID }])
        .mockResolvedValueOnce([{
          id: FIRMA_ID,
          pin_hash: "hash",
          failed_attempts: 0,
          locked_until: null,
          revoked_at: null,
        }])
        .mockResolvedValueOnce([]); // sin transición → FORBIDDEN

      prisma.$executeRaw.mockResolvedValue(0);

      const caller = eceHojaIngresoRouter.createCaller(makeAdmCtx(prisma));

      await expect(
        caller.firmar({ id: HOJA_ID, pin: "123456" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  // ── validar ────────────────────────────────────────────────────────────────

  describe("validar", () => {
    it("happy-path: avanza de firmado a validado", async () => {
      prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
      prisma.$executeRawUnsafe.mockResolvedValue(0);
      prisma.$queryRaw
        .mockResolvedValueOnce([makeHojaRow({ estado_codigo: "firmado" })])
        .mockResolvedValueOnce([{ estado_destino_id: "55555555-5555-5555-5555-555555555555" }]);

      prisma.$executeRaw.mockResolvedValue(1);

      const caller = eceHojaIngresoRouter.createCaller(makeArchCtx(prisma));
      const result = await caller.validar({ id: HOJA_ID });

      expect(result.ok).toBe(true);
    });

    it("lanza CONFLICT si no está en estado firmado", async () => {
      prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
      prisma.$executeRawUnsafe.mockResolvedValue(0);
      prisma.$queryRaw.mockResolvedValueOnce([makeHojaRow({ estado_codigo: "borrador" })]);

      const caller = eceHojaIngresoRouter.createCaller(makeArchCtx(prisma));

      await expect(caller.validar({ id: HOJA_ID })).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });
  });

  // ── anular ─────────────────────────────────────────────────────────────────

  describe("anular", () => {
    it("happy-path: anula una hoja en estado borrador", async () => {
      prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
      prisma.$executeRawUnsafe.mockResolvedValue(0);
      prisma.$queryRaw
        .mockResolvedValueOnce([makeHojaRow()])
        .mockResolvedValueOnce([{ estado_destino_id: "66666666-6666-6666-6666-666666666666" }]);

      prisma.$executeRaw.mockResolvedValue(1);

      const caller = eceHojaIngresoRouter.createCaller(makeDirCtx(prisma));
      const result = await caller.anular({
        id: HOJA_ID,
        motivoAnulacion: "Error en la orden de ingreso.",
      });

      expect(result.ok).toBe(true);
    });

    it("lanza CONFLICT si el estado es validado", async () => {
      prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
      prisma.$executeRawUnsafe.mockResolvedValue(0);
      prisma.$queryRaw.mockResolvedValueOnce([makeHojaRow({ estado_codigo: "validado" })]);

      const caller = eceHojaIngresoRouter.createCaller(makeDirCtx(prisma));

      await expect(
        caller.anular({ id: HOJA_ID, motivoAnulacion: "Motivo de prueba largo." }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });
});
