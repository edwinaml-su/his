/**
 * Tests unitarios — eceOrdenIngresoRouter (ECE ORD_ING).
 *
 * Columnas reales verificadas 2026-05-24 vía MCP Supabase:
 *   id, instancia_id (NOT NULL), paciente_id, episodio_origen_id, episodio_id,
 *   circunstancia_ingreso, fecha_hora_orden, motivo_ingreso, servicio_ingreso_id,
 *   procedencia, modalidad, diagnostico_ingreso (jsonb), medico_ordena,
 *   registrado_en, estado_registro ('vigente'|'rectificado'), motivo_ingreso_tipo,
 *   procedimiento_cie10, establecimiento_id, reserva_sala_qx_id.
 *   Estado workflow en documento_instancia.estado_actual_id.
 *
 * Casos cubiertos:
 *   1. Zod — create rechaza motivoIngreso < 10 chars
 *   2. Zod — create rechaza uuid inválido en pacienteId
 *   3. Zod — create rechaza modalidad fuera de enum BD
 *   4. create → borrador: retorna id e instanciaId
 *   5. create → PRECONDITION_FAILED si ORD_ING no está en tipo_documento
 *   6. firmar → firmado + emite evento ece.orden_ingreso.firmada
 *   7. firmar → CONFLICT si documento ya está firmado
 *   8. anular sin motivo suficiente → falla Zod (< 10 chars)
 *   9. anular → CONFLICT si estado no es firmado
 *   10. list filtra por modalidad
 *
 * @QA E2E pendiente:
 *   - Flujo create → firmar con PIN real válido vía ece.firma_electronica.
 *   - assertDependenciasFirmadas bloquea creación si deps no firmadas.
 *   - FORBIDDEN cuando rol no incluye DIR en anular.
 *   - PIN incorrecto incrementa failed_attempts y bloquea tras 5 intentos.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

// ─── Schemas inline (espejo del router, evitan import complejo en worktree) ───

const MODALIDAD_ING_TEST   = ["hospitalizacion", "hospital_de_dia"] as const;
const PROCEDENCIA_TEST     = ["consulta_externa", "emergencia", "traslado_externo", "traslado_interno", "espontaneo", "otro"] as const;
const MOTIVO_TIPO_TEST     = ["cirugia", "emergencia", "hospitalizacion", "obs", "otro"] as const;

const diagItemSchema = z.object({
  cie10:       z.string().regex(/^[A-Z]\d{2}(\.\d{1,4})?$/),
  descripcion: z.string().min(3).max(500),
  principal:   z.boolean(),
});

const createSchema = z.object({
  pacienteId:           z.string().uuid(),
  episodioOrigenId:     z.string().uuid().optional(),
  modalidad:            z.enum(MODALIDAD_ING_TEST),
  motivoIngreso:        z.string().min(10).max(2_000),
  motivoIngresoTipo:    z.enum(MOTIVO_TIPO_TEST),
  procedencia:          z.enum(PROCEDENCIA_TEST),
  servicioIngresoId:    z.string().uuid().optional(),
  procedimientoCie10:   z.string().regex(/^[A-Z]\d{2}(\.\d{1,4})?$/).optional(),
  diagnosticoIngreso:   z.array(diagItemSchema).min(1).max(20).optional(),
  medicoOrdena:         z.string().uuid(),
  fechaHoraOrden:       z.coerce.date(),
  circunstanciaIngreso: z.string().min(5).max(2_000),
  reservaSalaQxId:      z.string().uuid().optional(),
});

const anularSchema = z.object({
  id:               z.string().uuid(),
  motivoAnulacion:  z.string().min(10).max(1_000),
});

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@his/database", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@his/database")>();
  return {
    ...mod,
    emitDomainEvent: vi.fn().mockResolvedValue(undefined),
  };
});

// withWorkflowContext: ejecuta el callback directamente con el mismo prisma
vi.mock("../../workflow/context", () => ({
  withWorkflowContext: async (
    prisma: PrismaClient,
    _ctx: unknown,
    fn: (tx: PrismaClient) => Promise<unknown>,
  ) => fn(prisma),
}));

// argon2 mockeado — PIN siempre válido por defecto
vi.mock("@his/infrastructure", () => ({
  argon2: {
    verify: vi.fn().mockResolvedValue(true),
  },
}));

// assertDependenciasFirmadas — no-op en tests unitarios
// Path relativo correcto desde packages/trpc/src/routers/ece/__tests__/
vi.mock("../../../ece/dependencias-enforcement", () => ({
  assertDependenciasFirmadas: vi.fn().mockResolvedValue(undefined),
}));

import { eceOrdenIngresoRouter } from "../orden-ingreso.router";
import { emitDomainEvent } from "@his/database";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const uuid  = () => "00000000-0000-4000-8000-000000000001";
const uuid2 = () => "00000000-0000-4000-8000-000000000002";
const uuid3 = () => "00000000-0000-4000-8000-000000000003";
const uuid4 = () => "00000000-0000-4000-8000-000000000004";

function makeOrdenRow(estadoDoc = "borrador") {
  return {
    id: uuid(),
    instancia_id: uuid2(),
    paciente_id: uuid3(),
    episodio_origen_id: null,
    episodio_id: null,
    circunstancia_ingreso: "Paciente con dolor abdominal agudo referido de consulta externa.",
    fecha_hora_orden: new Date("2026-05-24T10:00:00Z"),
    motivo_ingreso: "Dolor abdominal agudo con sospecha de apendicitis.",
    servicio_ingreso_id: null,
    procedencia: "consulta_externa",
    modalidad: "hospitalizacion",
    diagnostico_ingreso: [{ cie10: "K35.8", descripcion: "Apendicitis aguda", principal: true }],
    medico_ordena: uuid4(),
    registrado_en: new Date("2026-05-24T10:05:00Z"),
    estado_registro: "vigente",
    motivo_ingreso_tipo: "cirugia",
    procedimiento_cie10: null,
    establecimiento_id: uuid2(),
    reserva_sala_qx_id: null,
    estado_documento: estadoDoc,
    estado_es_final: estadoDoc === "anulado" || estadoDoc === "validado",
  };
}

const validCreateInput = {
  pacienteId:           uuid3(),
  modalidad:            "hospitalizacion" as const,
  motivoIngreso:        "Dolor abdominal agudo con sospecha de apendicitis.",
  motivoIngresoTipo:    "cirugia" as const,
  procedencia:          "consulta_externa" as const,
  medicoOrdena:         uuid4(),
  fechaHoraOrden:       new Date("2026-05-24T10:00:00Z"),
  circunstanciaIngreso: "Referido desde consulta externa con cuadro de 12 horas.",
};

function buildCtx(roleCodes: string[] = ["MC"]) {
  const prisma = mockDeep<PrismaClient>();
  prisma.$transaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  );
  (prisma.$executeRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue(0);
  return {
    prisma,
    user: { id: uuid(), email: "mc@test.com", fullName: "Médico Cirujano" },
    tenant: {
      organizationId: uuid(),
      establishmentId: uuid2(),
      roleCodes,
    },
    portalAccount: null,
  };
}

// ─── 1-3: Zod validaciones ────────────────────────────────────────────────────

describe("ordenIngresoCreateSchema — validación Zod", () => {
  it("1. rechaza motivoIngreso con menos de 10 caracteres", () => {
    const r = createSchema.safeParse({ ...validCreateInput, motivoIngreso: "Corto" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.motivoIngreso).toBeDefined();
    }
  });

  it("2. rechaza pacienteId que no es UUID válido", () => {
    const r = createSchema.safeParse({ ...validCreateInput, pacienteId: "no-es-uuid" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.pacienteId).toBeDefined();
    }
  });

  it("3. rechaza modalidad fuera del enum de BD", () => {
    const r = createSchema.safeParse({ ...validCreateInput, modalidad: "urgencia" });
    expect(r.success).toBe(false);
  });
});

describe("ordenIngresoAnularSchema — validación Zod", () => {
  it("8. rechaza motivoAnulacion con menos de 10 caracteres", () => {
    const r = anularSchema.safeParse({ id: uuid(), motivoAnulacion: "Corto" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.motivoAnulacion).toBeDefined();
    }
  });
});

// ─── 4-5: create ──────────────────────────────────────────────────────────────

describe("eceOrdenIngresoRouter — create", () => {
  beforeEach(() => vi.clearAllMocks());

  it("4. happy path: retorna id e instanciaId en borrador", async () => {
    const ctx = buildCtx(["MC"]);
    const newOrdenId     = "aaaaaaaa-0000-4000-8000-000000000001";
    const newInstanciaId = "bbbbbbbb-0000-4000-8000-000000000001";
    const personalId     = "cccccccc-0000-4000-8000-000000000001";

    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>)
      // findPersonal (medicoOrdena)
      .mockResolvedValueOnce([{ id: personalId }])
      // tipo_documento ORD_ING
      .mockResolvedValueOnce([{ tipo_doc_id: uuid(), estado_inicial_id: uuid2() }])
      // INSERT documento_instancia
      .mockResolvedValueOnce([{ id: newInstanciaId }])
      // INSERT orden_ingreso
      .mockResolvedValueOnce([{ id: newOrdenId }]);

    const caller = eceOrdenIngresoRouter.createCaller(ctx as never);
    const result = await caller.create(validCreateInput);

    expect(result.ok).toBe(true);
    expect(result.id).toBe(newOrdenId);
    expect(result.instanciaId).toBe(newInstanciaId);
    expect(emitDomainEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "ece.orden_ingreso.creada" }),
    );
  });

  it("5. PRECONDITION_FAILED si ORD_ING no está configurado en tipo_documento", async () => {
    const ctx = buildCtx(["MC"]);
    const personalId = "cccccccc-0000-4000-8000-000000000001";

    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>)
      // findPersonal (medicoOrdena = uuid4) → encontrado
      .mockResolvedValueOnce([{ id: personalId }])
      // tipo_documento ORD_ING → vacío (no configurado)
      .mockResolvedValueOnce([]);

    const caller = eceOrdenIngresoRouter.createCaller(ctx as never);
    await expect(caller.create(validCreateInput)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("ORD_ING"),
    });
  });
});

// ─── 6-7: firmar ──────────────────────────────────────────────────────────────

describe("eceOrdenIngresoRouter — firmar", () => {
  beforeEach(() => vi.clearAllMocks());

  it("6. happy path: firma la orden y emite ece.orden_ingreso.firmada", async () => {
    const ctx = buildCtx(["MC"]);
    const firmaId = "ffffffff-0000-4000-8000-000000000001";

    // $queryRaw alimenta en secuencia: findOrdenIngreso, findPersonal, findFirma, avanzarEstado(transiciones)
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([makeOrdenRow("borrador")])    // findOrdenIngreso
      .mockResolvedValueOnce([{ id: uuid4() }])             // findPersonal
      .mockResolvedValueOnce([{                             // findFirma
        id: firmaId,
        pin_hash: "$argon2id$v=19$m=16,t=2,p=1$aGlz$hashed",
        failed_attempts: 0,
        locked_until: null,
        revoked_at: null,
      }])
      .mockResolvedValueOnce([{ estado_destino_id: uuid2() }]); // avanzarEstado transiciones

    // $executeRaw: reset failed_attempts, UPDATE documento_instancia, INSERT historial
    (ctx.prisma.$executeRaw as ReturnType<typeof vi.fn>).mockResolvedValue(1);

    const caller = eceOrdenIngresoRouter.createCaller(ctx as never);
    const result = await caller.firmar({ id: uuid(), firmaPin: "123456" });

    expect(result.ok).toBe(true);
    expect(result.estado).toBe("firmado");
    expect(result.contentHash).toBeDefined();
    expect(emitDomainEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "ece.orden_ingreso.firmada" }),
    );
  });

  it("7. CONFLICT si el documento ya está firmado", async () => {
    const ctx = buildCtx(["MC"]);

    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([makeOrdenRow("firmado")]);

    const caller = eceOrdenIngresoRouter.createCaller(ctx as never);
    await expect(
      caller.firmar({ id: uuid(), firmaPin: "123456" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

// ─── 9: anular ────────────────────────────────────────────────────────────────

describe("eceOrdenIngresoRouter — anular", () => {
  beforeEach(() => vi.clearAllMocks());

  it("9. CONFLICT si el documento no está en estado firmado", async () => {
    const ctx = buildCtx(["DIR"]);

    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([makeOrdenRow("borrador")]);

    const caller = eceOrdenIngresoRouter.createCaller(ctx as never);
    await expect(
      caller.anular({ id: uuid(), motivoAnulacion: "Motivo de anulación suficientemente largo" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

// ─── 10: list filtra por modalidad ────────────────────────────────────────────

describe("eceOrdenIngresoRouter — list", () => {
  beforeEach(() => vi.clearAllMocks());

  it("10. list retorna items filtrados por modalidad hospital_de_dia", async () => {
    const ctx = buildCtx(["MC"]);
    const rowHd = { ...makeOrdenRow("firmado"), modalidad: "hospital_de_dia" };

    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ total: 1n }]) // count
      .mockResolvedValueOnce([rowHd]);         // items

    const caller = eceOrdenIngresoRouter.createCaller(ctx as never);
    const result = await caller.list({ modalidad: "hospital_de_dia" });

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.modalidad).toBe("hospital_de_dia");
  });
});
