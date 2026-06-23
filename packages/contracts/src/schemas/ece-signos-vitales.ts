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
 *
 * Columnas DB (ece.signos_vitales) — alineado post HD-16:
 *   presion_sistolica / presion_diastolica / escala_dolor /
 *   fecha_hora_toma / registrado_por
 *   peso_kg / talla_cm / imc / glucometria_mgdl  (HD-18)
 *
 * Campos eliminados del contrato (no existen en BD):
 *   establecimiento_id — RLS aplica vía episodio.establecimiento_id
 *
 * CC-0001 RF-04: `observaciones` se reintrodujo (col. añadida en SQL 175).
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
  // CC-0001 RF-04: la toma se ancla al episodio (no a la HC ni al paciente).
  // El INSERT no persiste pacienteId; se acepta opcional por compat legacy.
  pacienteId: z.string().uuid().optional(),
  episodioId: z.string().uuid().optional(),

  // Campos clínicos — todos opcionales (no siempre se toman todos en una toma)
  presionSistolica: numRange(60, 260, "TA sistólica").optional(),
  presionDiastolica: numRange(40, 160, "TA diastólica").optional(),
  frecuenciaCardiaca: numRange(30, 220, "FC").optional(),
  frecuenciaRespiratoria: numRange(4, 60, "FR").optional(),
  temperatura: numRange(30, 43, "Temperatura").optional(),
  saturacionO2: numRange(50, 100, "SpO2").optional(),
  escalaDolor: numRange(0, 10, "Dolor EVA").optional(),

  /** Datos antropométricos (HD-18 — NTEC Art. 28 monitoreo integral) */
  pesoKg: numRange(0.5, 300, "Peso").optional(),
  tallaCm: numRange(30, 250, "Talla").optional(),
  glucometriaMgdl: numRange(20, 600, "Glucometría").optional(),

  /** RF-04 CC-0001 — nota opcional por toma. */
  observaciones: z.string().max(2000).optional(),

  /** Fecha-hora de la toma. Si no se envía, la BD usa now(). */
  fechaHoraToma: z.string().datetime({ offset: true }).optional(),
});

export type EceSignosVitalesCreateInput = z.infer<typeof eceSignosVitalesCreateSchema>;

// ─── Schema de actualización (solo campos clínicos, no IDs) ─────────────────

export const eceSignosVitalesUpdateSchema = eceSignosVitalesCreateSchema
  .pick({
    presionSistolica: true,
    presionDiastolica: true,
    frecuenciaCardiaca: true,
    frecuenciaRespiratoria: true,
    temperatura: true,
    saturacionO2: true,
    escalaDolor: true,
    pesoKg: true,
    tallaCm: true,
    glucometriaMgdl: true,
    observaciones: true,
    fechaHoraToma: true,
  })
  .partial();

export type EceSignosVitalesUpdateInput = z.infer<typeof eceSignosVitalesUpdateSchema>;
