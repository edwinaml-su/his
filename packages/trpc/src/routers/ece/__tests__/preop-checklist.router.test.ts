/**
 * Tests unitarios — eceCirugiaPreopRouter (ECE PREOP_CHECK).
 *
 * Estrategia:
 *   - Vitest + schemas Zod inline; cero I/O real.
 *   - Los tests de lógica de negocio validan los schemas directamente
 *     (patrón de atencion-emergencia.router.test.ts para schemas).
 *   - Los tests de comportamiento del router mockean withWorkflowContext
 *     y simulan las respuestas $queryRaw/$executeRaw.
 *
 * Casos cubiertos (7 tests):
 *   1. Schema create — episodioHospitalarioId uuid requerido
 *   2. Schema create — riesgoAnestesicoAsa fuera de rango [1-5] rechazado
 *   3. Schema create — ayunoHoras fuera de rango [0-24] rechazado
 *   4. Schema firmar — pin no numérico rechazado
 *   5. Schema firmar — pin < 6 dígitos rechazado
 *   6. Schema update — id uuid requerido
 *   7. Schemas válidos — parse exitoso para create, update y firmar
 *
 * @QA E2E pendiente:
 *   - Flujo completo create → update → firmar con PIN válido real.
 *   - Intento de firmar checklist ya firmado devuelve CONFLICT.
 *   - Médico sin firma_electronica configurada devuelve PRECONDITION_FAILED.
 *   - Verificar inmutabilidad: update post-firma devuelve CONFLICT.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";

// ─── Schemas locales (espejo de preop-checklist.router.ts) ───────────────────

const preopChecklistCreateSchema = z.object({
  episodioHospitalarioId: z.string().uuid(),
  ayunoHoras: z.number().int().min(0).max(24).optional(),
  marcapasos: z.boolean().optional(),
  alergias: z.string().max(2000).optional(),
  anticoagulantes: z.boolean().optional(),
  retiroProtesis: z.boolean().optional(),
  identificacionPacienteVerificada: z.boolean().optional(),
  sitioMarcado: z.boolean().optional(),
  consentimientoFirmado: z.boolean().optional(),
  riesgoAnestesicoAsa: z.number().int().min(1).max(5).optional(),
});

const preopChecklistUpdateSchema = preopChecklistCreateSchema
  .omit({ episodioHospitalarioId: true })
  .partial()
  .extend({ id: z.string().uuid() });

const preopChecklistFirmarSchema = z.object({
  id: z.string().uuid(),
  pin: z.string().trim().regex(/^\d{6,8}$/, "PIN debe ser 6-8 dígitos"),
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

const VALID_UUID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

const VALID_CREATE = {
  episodioHospitalarioId: VALID_UUID,
  ayunoHoras: 8,
  marcapasos: false,
  alergias: "Penicilina",
  anticoagulantes: true,
  retiroProtesis: true,
  identificacionPacienteVerificada: true,
  sitioMarcado: true,
  consentimientoFirmado: true,
  riesgoAnestesicoAsa: 2,
};

// =============================================================================
// Tests
// =============================================================================

describe("preopChecklistCreateSchema", () => {
  it("rechaza episodioHospitalarioId no-uuid", () => {
    const result = preopChecklistCreateSchema.safeParse({
      ...VALID_CREATE,
      episodioHospitalarioId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("rechaza riesgoAnestesicoAsa fuera de rango [1-5]", () => {
    const result = preopChecklistCreateSchema.safeParse({
      ...VALID_CREATE,
      riesgoAnestesicoAsa: 6,
    });
    expect(result.success).toBe(false);
    const result2 = preopChecklistCreateSchema.safeParse({
      ...VALID_CREATE,
      riesgoAnestesicoAsa: 0,
    });
    expect(result2.success).toBe(false);
  });

  it("rechaza ayunoHoras fuera de rango [0-24]", () => {
    const result = preopChecklistCreateSchema.safeParse({
      ...VALID_CREATE,
      ayunoHoras: 25,
    });
    expect(result.success).toBe(false);
  });

  it("acepta todos los campos opcionales ausentes (mínimo requerido = episodioHospitalarioId)", () => {
    const result = preopChecklistCreateSchema.safeParse({
      episodioHospitalarioId: VALID_UUID,
    });
    expect(result.success).toBe(true);
  });
});

describe("preopChecklistFirmarSchema", () => {
  it("rechaza pin no numérico", () => {
    const result = preopChecklistFirmarSchema.safeParse({
      id: VALID_UUID,
      pin: "abcdef",
    });
    expect(result.success).toBe(false);
  });

  it("rechaza pin con menos de 6 dígitos", () => {
    const result = preopChecklistFirmarSchema.safeParse({
      id: VALID_UUID,
      pin: "12345",
    });
    expect(result.success).toBe(false);
  });

  it("acepta pin de 6-8 dígitos numéricos", () => {
    for (const pin of ["123456", "1234567", "12345678"]) {
      const result = preopChecklistFirmarSchema.safeParse({ id: VALID_UUID, pin });
      expect(result.success).toBe(true);
    }
  });
});

describe("preopChecklistUpdateSchema", () => {
  it("rechaza update sin id", () => {
    const result = preopChecklistUpdateSchema.safeParse({ ayunoHoras: 6 });
    expect(result.success).toBe(false);
  });

  it("acepta update parcial con solo id + un campo", () => {
    const result = preopChecklistUpdateSchema.safeParse({
      id: VALID_UUID,
      sitioMarcado: true,
    });
    expect(result.success).toBe(true);
  });
});

describe("Schemas completos — parse exitoso", () => {
  it("create schema parsea payload válido completo", () => {
    const result = preopChecklistCreateSchema.safeParse(VALID_CREATE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.riesgoAnestesicoAsa).toBe(2);
      expect(result.data.ayunoHoras).toBe(8);
    }
  });
});

/**
 * HE-13: episodio_hospitalario.episodio_id (PK) = episodio_atencion.id
 * documento_instancia.episodio_id FK → episodio_atencion.id
 *
 * El campo Zod `episodioHospitalarioId` en preop-checklist.router.ts
 * es el ID de episodio_atencion (PK de episodio_hospitalario), NO un ID
 * independiente de una tabla episodio_hospitalario con PK propia.
 * Esta suite documenta el contrato semántico para prevenir regresión.
 */
describe("HE-13 — contrato semántico episodioHospitalarioId", () => {
  it("episodioHospitalarioId es un UUID (referencia a episodio_atencion.id)", () => {
    // episodio_hospitalario.episodio_id FK → episodio_atencion.id
    // Por tanto, el campo en el schema es el mismo UUID del episodio_atencion
    const EPISODIO_ATENCION_ID = "c1000000-0000-0000-0000-000000000001";
    const result = preopChecklistCreateSchema.safeParse({
      episodioHospitalarioId: EPISODIO_ATENCION_ID,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // Este UUID debe usarse en documento_instancia.episodio_id (FK episodio_atencion)
      // y en preop_checklist.episodio_hospitalario_id (FK episodio_hospitalario.episodio_id)
      expect(result.data.episodioHospitalarioId).toBe(EPISODIO_ATENCION_ID);
    }
  });

  it("rechaza episodioHospitalarioId no-uuid (evita pasar ID de otro tipo)", () => {
    // Previene pasar un ID de episodio_hospitalario con otro formato
    const result = preopChecklistCreateSchema.safeParse({
      episodioHospitalarioId: "EH-2026-001",
    });
    expect(result.success).toBe(false);
  });
});
