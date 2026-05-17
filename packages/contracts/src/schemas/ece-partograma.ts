/**
 * Schemas Zod — ECE Partograma OMS (NTEC Doc 14).
 *
 * Curvas OMS:
 *   Curva alerta  : dilatación esperada a 1 cm/hora desde fase activa (4 cm).
 *   Curva acción  : 4 horas a la derecha de la curva alerta.
 *   Si la dilatación real cae a la derecha de la curva acción → zona_accion.
 *   Si cae entre alerta y acción → zona_alerta.
 *   Fase latente   : 0-3.9 cm (no se aplican curvas).
 *   Fase activa    : ≥4 cm.
 */
import { z } from "zod";

// ─── Enums ───────────────────────────────────────────────────────────────────

export const POSICION_FETAL = [
  "OIA", "OIP", "ODA", "ODP",
  "OIIA", "OIIP", "ODIA", "ODIP",
  "presentacion_cara", "presentacion_frente", "otro",
] as const;

export const INTENSIDAD_CONTRACCION = ["leve", "moderada", "fuerte"] as const;
export const ALERTA_OMS = ["normal", "zona_alerta", "zona_accion"] as const;

// ─── Schema de registro (un punto en la serie temporal) ──────────────────────

export const partogramaRegistrarSchema = z.object({
  docObstetricoId: z.string().uuid(),
  episodioId: z.string().uuid(),
  /** Timestamp clínico de la lectura (default: now en BD) */
  registradoEn: z.string().datetime({ offset: true }).optional(),
  dilatacionCm: z
    .number()
    .min(0, "Dilatación mínima 0 cm.")
    .max(10, "Dilatación máxima 10 cm."),
  borramientoPct: z.number().int().min(0).max(100).optional(),
  posicionFetal: z.enum(POSICION_FETAL).optional(),
  frecuenciaCardiacaFetal: z
    .number()
    .int()
    .min(60, "FCF mínima 60 lpm.")
    .max(200, "FCF máxima 200 lpm.")
    .optional(),
  contracciones10min: z.number().int().min(0).max(10).optional(),
  intensidad: z.enum(INTENSIDAD_CONTRACCION).optional(),
  dolorPaciente: z.number().int().min(0).max(10).optional(),
  medicamentos: z.string().max(1_000).optional(),
  observaciones: z.string().max(2_000).optional(),
});

export type PartogramaRegistrarInput = z.infer<typeof partogramaRegistrarSchema>;

// ─── Schema list ─────────────────────────────────────────────────────────────

export const partogramaListSchema = z.object({
  docObstetricoId: z.string().uuid(),
});

export type PartogramaListInput = z.infer<typeof partogramaListSchema>;

// ─── Schema get ──────────────────────────────────────────────────────────────

export const partogramaGetSchema = z.object({ id: z.string().uuid() });
export type PartogramaGetInput = z.infer<typeof partogramaGetSchema>;

// ─── Schema cerrar ───────────────────────────────────────────────────────────

export const partogramaCerrarSchema = z.object({
  docObstetricoId: z.string().uuid(),
  motivoCierre: z
    .enum(["parto_vaginal", "cesarea", "traslado", "alta", "otro"])
    .default("parto_vaginal"),
  observacionCierre: z.string().max(1_000).optional(),
});

export type PartogramaCerrarInput = z.infer<typeof partogramaCerrarSchema>;

// ─── Tipo de fila raw SQL ─────────────────────────────────────────────────────

export interface PartogramaRegistroRow {
  id: string;
  doc_obstetrico_id: string;
  episodio_id: string;
  registrado_en: Date;
  dilatacion_cm: string;
  borramiento_pct: number | null;
  posicion_fetal: string | null;
  frecuencia_cardiaca_fetal: number | null;
  contracciones_10min: number | null;
  intensidad: string | null;
  dolor_paciente: number | null;
  medicamentos: string | null;
  observaciones: string | null;
  alerta_oms: "normal" | "zona_alerta" | "zona_accion";
  registrado_por: string;
  created_at: Date;
}
