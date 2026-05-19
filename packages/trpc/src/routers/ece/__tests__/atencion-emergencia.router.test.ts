/**
 * Tests unitarios — atencionEmergenciaRouter (ECE ATN_EMERG).
 *
 * HF-31: Tests actualizados con fixtures de columnas reales de ece.atencion_emergencia
 *        verificadas via MCP Supabase (2026-05-19).
 *
 * Columnas reales:
 *   id, instancia_id (NOT NULL), episodio_id, circunstancia_llegada,
 *   motivo_consulta, examen_fisico, disposicion, diagnosticos (jsonb),
 *   manejo_realizado (jsonb), registrado_por, registrado_en, estado_registro
 *
 * Estado de workflow en documento_instancia.estado_actual_id (JOIN con flujo_estado).
 *
 * Casos cubiertos (10 tests):
 *   1. Zod create — episodioId requerido (uuid)
 *   2. Zod create — motivoConsulta mínimo 5 chars
 *   3. Zod create — diagnosticos requiere objeto {texto}
 *   4. create — happy path, retorna id e instanciaId
 *   5. create — PRECONDITION_FAILED si no hay personal_salud activo
 *   6. create — PRECONDITION_FAILED si ATN_EMERG no está en tipo_documento
 *   7. update — CONFLICT si estado_documento no es borrador|en_revision
 *   8. firmar — NOT_FOUND cuando el doc no existe
 *   9. firmar — CONFLICT si documento ya está firmado
 *   10. anular — FORBIDDEN si rol no incluye DIR ni ADMIN
 *
 * @QA E2E pendiente:
 *   - Flujo completo create → firmar con PIN válido → verificar outbox.
 *   - firmar rechaza PIN incorrecto con UNAUTHORIZED y incrementa intentos_fallidos.
 *   - anular en estado validado devuelve CONFLICT.
 *   - MT no puede anular (FORBIDDEN).
 */
import { describe, it, expect, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

// ─── Schemas inline (espejo del router, evitan symlink en worktree) ───────────

const jsonbTextField = z.object({ texto: z.string().min(5).max(5_000) });

const schema = {
  create: z.object({
    episodioId:           z.string().uuid(),
    pacienteId:           z.string().uuid(),
    motivoConsulta:       z.string().min(5).max(2_000),
    circunstanciaLlegada: z.string().max(1_000).optional(),
    examenFisico:         z.string().min(5).max(5_000),
    disposicion:          z.string().max(1_000).optional(),
    diagnosticos:         jsonbTextField,
    manejoRealizado:      jsonbTextField,
  }),
};

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@his/database", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@his/database")>();
  return {
    ...mod,
    emitDomainEvent: vi.fn().mockResolvedValue(undefined),
  };
});

// withWorkflowContext ejecuta el callback directamente con el mismo prisma
vi.mock("../../workflow/context", () => ({
  withWorkflowContext: async (
    prisma: PrismaClient,
    _ctx: unknown,
    fn: (tx: PrismaClient) => Promise<unknown>,
  ) => fn(prisma),
}));

// argon2 mockeado — siempre válido por defecto
vi.mock("@his/infrastructure", () => ({
  argon2: {
    verify: vi.fn().mockResolvedValue(true),
  },
}));

// Importar router DESPUÉS de los mocks
import { atencionEmergenciaRouter } from "../atencion-emergencia.router";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const uuid  = () => "00000000-0000-4000-8000-000000000001";
const uuid2 = () => "00000000-0000-4000-8000-000000000002";
const uuid3 = () => "00000000-0000-4000-8000-000000000003";
const uuid4 = () => "00000000-0000-4000-8000-000000000004";

/** Fixture de AtencionEmergenciaRow con columnas reales (HF-27). */
const makeAtnRow = (estadoDoc = "borrador") => ({
  id: uuid(),
  instancia_id: uuid2(),
  episodio_id: uuid3(),
  circunstancia_llegada: "Llegó por sus propios medios",
  motivo_consulta: "Dolor torácico agudo",
  examen_fisico: "PA 140/90, FC 98, buen estado general",
  disposicion: "Admisión a sala de observación",
  diagnosticos: { texto: "Síndrome coronario agudo. I20.0" },
  manejo_realizado: { texto: "Aspirina 300 mg VO stat." },
  registrado_por: uuid4(),
  registrado_en: new Date("2026-05-19T08:00:00Z"),
  estado_registro: "vigente",
  estado_documento: estadoDoc,
});

/** Input válido para create (con nuevas columnas reales). */
const validCreateInput = {
  episodioId:      uuid3(),
  pacienteId:      uuid2(),
  motivoConsulta:  "Dolor torácico agudo",
  examenFisico:    "PA 140/90, FC 98, buen estado general",
  diagnosticos:    { texto: "Síndrome coronario agudo. I20.0" },
  manejoRealizado: { texto: "Aspirina 300 mg VO stat. Monitoreo continuo." },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildCtx(roleCodes: string[] = ["MT"]) {
  const prisma = mockDeep<PrismaClient>();

  prisma.$transaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  );
  (prisma.$executeRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue(0);

  return {
    prisma,
    user: { id: uuid(), email: "mt@test.com", fullName: "Médico Turno" },
    tenant: {
      organizationId: uuid(),
      establishmentId: uuid2(),
      roleCodes,
    },
    portalAccount: null,
  };
}

// ─── Zod validaciones ────────────────────────────────────────────────────────

describe("eceAtencionEmergenciaCreateSchema — validación Zod (HF-31)", () => {
  it("1. rechaza episodioId vacío o no-uuid", () => {
    const r1 = schema.create.safeParse({ ...validCreateInput, episodioId: "" });
    const r2 = schema.create.safeParse({ ...validCreateInput, episodioId: "no-uuid" });
    expect(r1.success).toBe(false);
    expect(r2.success).toBe(false);
  });

  it("2. rechaza motivoConsulta con menos de 5 chars", () => {
    const r = schema.create.safeParse({ ...validCreateInput, motivoConsulta: "abc" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.motivoConsulta).toBeDefined();
    }
  });

  it("3. rechaza diagnosticos que no sea {texto: string min 5}", () => {
    const r1 = schema.create.safeParse({ ...validCreateInput, diagnosticos: "texto plano" });
    const r2 = schema.create.safeParse({ ...validCreateInput, diagnosticos: { texto: "ab" } }); // < 5 chars
    expect(r1.success).toBe(false);
    expect(r2.success).toBe(false);
  });
});

// ─── create (HF-27 + HF-28) ──────────────────────────────────────────────────

describe("atencionEmergenciaRouter — create (HF-27 + HF-28)", () => {
  it("4. happy path: crea documento_instancia + atencion_emergencia, retorna id e instanciaId", async () => {
    const ctx = buildCtx(["MT"]);
    const newAtnId = "aaaaaaaa-0000-4000-8000-000000000001";
    const newInstanciaId = "bbbbbbbb-0000-4000-8000-000000000001";

    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ id: uuid4() }])                                      // 1. personal_salud
      .mockResolvedValueOnce([{ tipo_doc_id: uuid(), estado_inicial_id: uuid2() }])  // 2. tipo_documento ATN_EMERG
      .mockResolvedValueOnce([{ id: newInstanciaId }])                               // 3. INSERT documento_instancia
      .mockResolvedValueOnce([{ id: newAtnId }]);                                    // 4. INSERT atencion_emergencia

    const caller = atencionEmergenciaRouter.createCaller(ctx as never);
    const result = await caller.create(validCreateInput);

    expect(result.id).toBe(newAtnId);
    expect(result.instanciaId).toBe(newInstanciaId);
    expect(result.ok).toBe(true);
  });

  it("5. PRECONDITION_FAILED si no hay personal_salud activo para el usuario", async () => {
    const ctx = buildCtx(["MT"]);

    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]); // personal_salud vacío

    const caller = atencionEmergenciaRouter.createCaller(ctx as never);

    await expect(caller.create(validCreateInput)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("personal de salud"),
    });
  });

  it("6. PRECONDITION_FAILED si ATN_EMERG no está configurado en tipo_documento", async () => {
    const ctx = buildCtx(["MT"]);

    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ id: uuid4() }])  // personal_salud OK
      .mockResolvedValueOnce([]);                 // tipo_documento vacío

    const caller = atencionEmergenciaRouter.createCaller(ctx as never);

    await expect(caller.create(validCreateInput)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("ATN_EMERG"),
    });
  });
});

// ─── update (HF-27) ──────────────────────────────────────────────────────────

describe("atencionEmergenciaRouter — update (HF-27)", () => {
  it("7. CONFLICT si el documento está en estado firmado (campo estado_codigo del JOIN real)", async () => {
    const ctx = buildCtx(["MT"]);

    // HF-31: fixture con columnas reales (no estado_workflow sino estado_codigo del JOIN)
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { estado_codigo: "firmado", instancia_id: uuid2() },
    ]);

    const caller = atencionEmergenciaRouter.createCaller(ctx as never);

    await expect(
      caller.update({ id: uuid(), motivoConsulta: "Nuevo motivo actualizado válido" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

// ─── firmar (HF-28 + HF-29) ──────────────────────────────────────────────────

describe("atencionEmergenciaRouter — firmar (HF-28 + HF-29)", () => {
  it("8. NOT_FOUND cuando el documento no existe", async () => {
    const ctx = buildCtx(["MT"]);

    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]); // doc no encontrado

    const caller = atencionEmergenciaRouter.createCaller(ctx as never);

    await expect(
      caller.firmar({ id: uuid(), pin: "123456" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("9. CONFLICT si el documento ya está en estado firmado", async () => {
    const ctx = buildCtx(["MT"]);

    // HF-31: fixture con columnas reales — examen_fisico en lugar de exploracion
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      makeAtnRow("firmado"),
    ]);

    const caller = atencionEmergenciaRouter.createCaller(ctx as never);

    await expect(
      caller.firmar({ id: uuid(), pin: "123456" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

// ─── autorización ────────────────────────────────────────────────────────────

describe("atencionEmergenciaRouter — autorización", () => {
  it("10. FORBIDDEN al anular si el rol es solo MT (sin DIR/ADMIN)", async () => {
    const ctx = buildCtx(["MT"]);
    const caller = atencionEmergenciaRouter.createCaller(ctx as never);

    await expect(
      caller.anular({ id: uuid(), motivoAnulacion: "Motivo de anulación suficientemente largo" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
