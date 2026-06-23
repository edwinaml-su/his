/**
 * Schemas locales para ECE Signos Vitales — worktree copy.
 *
 * Este archivo es una copia local para evitar la dependencia del symlink
 * @his/contracts que en worktrees apunta al main branch. Post-merge, los
 * schemas se consolidan en packages/contracts/src/schemas/ece-signos-vitales.ts.
 *
 * Alineado con ece.signos_vitales post-HD-16 (nombres reales de columnas).
 */
import { z } from "zod";

function numRange(min: number, max: number, label: string) {
  return z
    .number({ required_error: `${label} es requerido.` })
    .min(min, `${label} mínimo ${min}.`)
    .max(max, `${label} máximo ${max}.`);
}

export const eceSignosVitalesCreateSchema = z.object({
  pacienteId: z.string().uuid().optional(),
  episodioId: z.string().uuid().optional(),

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

  fechaHoraToma: z.string().datetime({ offset: true }).optional(),
});

export type EceSignosVitalesCreateInput = z.infer<typeof eceSignosVitalesCreateSchema>;

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
