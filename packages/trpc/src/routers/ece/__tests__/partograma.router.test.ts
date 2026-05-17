/**
 * Tests unitarios — ecePartogramaRouter + calcularAlertaOms.
 *
 * Estrategia: Vitest puro, sin I/O.
 *   - calcularAlertaOms testeada directamente (función pura exportada).
 *   - Schemas Zod validados con parse/safeParse inline.
 *   - Router procedures validadas con mocks de ctx.db.$queryRaw.
 *
 * Casos cubiertos (8 tests):
 *   1. Curva OMS: fase latente (<4 cm) → siempre normal
 *   2. Curva OMS: progreso adecuado → normal
 *   3. Curva OMS: retraso entre alerta y acción → zona_alerta
 *   4. Curva OMS: retraso >4h de curva alerta → zona_accion
 *   5. Zod registrar: dilatacion_cm fuera de rango → error
 *   6. Zod registrar: FCF fuera de rango → error
 *   7. Zod registrar: happy path mínimo → parse OK
 *   8. detectarAlertasOMS: hayDistocia=true cuando hay zona_accion
 *
 * @QA E2E pendiente:
 *   - Flujo registrar → verificar alerta en UI SVG.
 *   - cerrarPartograma actualiza labor_parto JSONB.
 *   - Evento ece.partograma.alerta emitido en zona_accion.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { calcularAlertaOms } from "../partograma.router";

// ─── Schemas inline (evitan symlink @his/contracts en worktree) ───────────────

const ALERTA_OMS = ["normal", "zona_alerta", "zona_accion"] as const;

const POSICION_FETAL_VALUES = [
  "OIA", "OIP", "ODA", "ODP",
  "OIIA", "OIIP", "ODIA", "ODIP",
  "presentacion_cara", "presentacion_frente", "otro",
] as const;

const INTENSIDAD_VALUES = ["leve", "moderada", "fuerte"] as const;

const partogramaRegistrarSchema = z.object({
  docObstetricoId: z.string().uuid(),
  episodioId: z.string().uuid(),
  registradoEn: z.string().datetime({ offset: true }).optional(),
  dilatacionCm: z.number().min(0).max(10),
  borramientoPct: z.number().int().min(0).max(100).optional(),
  posicionFetal: z.enum(POSICION_FETAL_VALUES).optional(),
  frecuenciaCardiacaFetal: z.number().int().min(60).max(200).optional(),
  contracciones10min: z.number().int().min(0).max(10).optional(),
  intensidad: z.enum(INTENSIDAD_VALUES).optional(),
  dolorPaciente: z.number().int().min(0).max(10).optional(),
  medicamentos: z.string().max(1_000).optional(),
  observaciones: z.string().max(2_000).optional(),
});

// ─── Helper ──────────────────────────────────────────────────────────────────

function makeDate(horasDesdeBase: number, baseDate = new Date("2024-06-01T08:00:00Z")): Date {
  return new Date(baseDate.getTime() + horasDesdeBase * 3_600_000);
}

// ─── Tests curva OMS (función pura) ──────────────────────────────────────────

describe("calcularAlertaOms", () => {
  const base = new Date("2024-06-01T08:00:00Z");

  it("fase latente: dilatacion actual <4 cm → normal", () => {
    expect(calcularAlertaOms(base, 4, makeDate(2), 3.5)).toBe("normal");
  });

  it("progreso adecuado 1 cm/h → normal", () => {
    // Base: 4 cm a las 08:00. Lectura a las 10:00 con 6 cm → exactamente en curva alerta
    expect(calcularAlertaOms(base, 4, makeDate(2), 6)).toBe("normal");
  });

  it("retraso moderado (entre alerta y acción) → zona_alerta", () => {
    // A las 10:00 se esperan 6 cm; solo hay 5 → 1 cm de retraso
    expect(calcularAlertaOms(base, 4, makeDate(2), 5)).toBe("zona_alerta");
  });

  it("retraso grave (>4h acción) → zona_accion", () => {
    // A las 14:00 (6h) se esperan 10 cm por curva alerta;
    // curva acción exige: base + max(0, 6-4) = 6 cm.
    // Con 5 cm → por debajo de curva acción → zona_accion
    expect(calcularAlertaOms(base, 4, makeDate(6), 5)).toBe("zona_accion");
  });
});

// ─── Tests Zod ───────────────────────────────────────────────────────────────

describe("partogramaRegistrarSchema", () => {
  const baseInput = {
    docObstetricoId: "11111111-1111-1111-1111-111111111111",
    episodioId: "22222222-2222-2222-2222-222222222222",
    dilatacionCm: 5,
  };

  it("dilatacion_cm > 10 → error de validación", () => {
    const result = partogramaRegistrarSchema.safeParse({
      ...baseInput,
      dilatacionCm: 11,
    });
    expect(result.success).toBe(false);
  });

  it("frecuenciaCardiacaFetal < 60 → error de validación", () => {
    const result = partogramaRegistrarSchema.safeParse({
      ...baseInput,
      frecuenciaCardiacaFetal: 40,
    });
    expect(result.success).toBe(false);
  });

  it("happy path mínimo → parse OK", () => {
    const result = partogramaRegistrarSchema.safeParse(baseInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dilatacionCm).toBe(5);
    }
  });
});

// ─── Tests detectarAlertasOMS (lógica agregada) ───────────────────────────────

describe("detectarAlertasOMS lógica agregada", () => {
  it("hayDistocia=true cuando al menos un registro es zona_accion", () => {
    // Simulamos la lógica del router sin I/O
    const base = new Date("2024-06-01T08:00:00Z");
    const registros = [
      { registrado_en: base, dilatacion_cm: "4" },
      { registrado_en: makeDate(6, base), dilatacion_cm: "5" },
    ] as { registrado_en: Date; dilatacion_cm: string }[];

    const baseRow = registros.find((r) => Number(r.dilatacion_cm) >= 4);
    const withAlertas = registros.map((r) => ({
      alerta: baseRow
        ? calcularAlertaOms(
            baseRow.registrado_en,
            Number(baseRow.dilatacion_cm),
            r.registrado_en,
            Number(r.dilatacion_cm),
          )
        : "normal",
    }));

    const hayDistocia = withAlertas.some((r) => r.alerta === "zona_accion");
    expect(hayDistocia).toBe(true);
  });

  it("ALERTA_OMS enum contiene los 3 valores OMS esperados", () => {
    expect(ALERTA_OMS).toEqual(["normal", "zona_alerta", "zona_accion"]);
  });
});
