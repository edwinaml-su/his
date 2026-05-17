/**
 * Schemas Zod para ECE Signos Vitales.
 *
 * Rangos plausibles basados en la norma técnica NTEC / criterio clínico:
 *   TA sistólica : 60–260 mmHg
 *   TA diastólica: 40–160 mmHg
 *   FC           : 30–220 lpm
 *   FR           : 4–60 rpm
 *   Temperatura  : 30–43 °C
 *   SpO2         : 50–100 %
 *   Dolor (EVA)  : 0–10
 */
import { z } from "zod";

// ─── Helpers de rango ────────────────────────────────────────────────────────

function numRange(min: number, max: number, label: string) {
  return z
    .number({ required_error: `${label} es requerido.` })
    .min(min, `${label} mínimo ${min}.`)
    .max(max, `${label} máximo ${max}.`);
}

// ─── Schema de creación ──────────────────────────────────────────────────────

export const eceSignosVitalesCreateSchema = z.object({
  pacienteId: z.string().uuid(),
  episodioId: z.string().uuid().optional(),
  personalId: z.string().uuid(),
  establecimientoId: z.string().uuid(),

  // Campos clínicos — todos opcionales (no siempre se toman todos en una toma)
  taSistolica: numRange(60, 260, "TA sistólica").optional(),
  taDiastolica: numRange(40, 160, "TA diastólica").optional(),
  frecuenciaCardiaca: numRange(30, 220, "FC").optional(),
  frecuenciaRespiratoria: numRange(4, 60, "FR").optional(),
  temperatura: numRange(30, 43, "Temperatura").optional(),
  saturacionO2: numRange(50, 100, "SpO2").optional(),
  dolorEva: numRange(0, 10, "Dolor EVA").optional(),

  /** Notas libres del enfermero/a. */
  observaciones: z.string().max(2000).optional(),

  /** Fecha-hora de la toma. Si no se envía, la BD usa now(). */
  tomadoEn: z.string().datetime({ offset: true }).optional(),
});

export type EceSignosVitalesCreateInput = z.infer<typeof eceSignosVitalesCreateSchema>;

// ─── Schema de actualización (solo campos clínicos, no IDs) ─────────────────

export const eceSignosVitalesUpdateSchema = eceSignosVitalesCreateSchema
  .pick({
    taSistolica: true,
    taDiastolica: true,
    frecuenciaCardiaca: true,
    frecuenciaRespiratoria: true,
    temperatura: true,
    saturacionO2: true,
    dolorEva: true,
    observaciones: true,
    tomadoEn: true,
  })
  .partial();

export type EceSignosVitalesUpdateInput = z.infer<typeof eceSignosVitalesUpdateSchema>;
