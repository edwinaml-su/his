/**
 * Contratos Zod — Bridge ECE ↔ HIS Triage (Fase 2, Stream 18-ext).
 *
 * Mapeo canónico Manchester 1-5 → nivelPrioridad ECE:
 *   1 (RED)    → "I"   Inmediata
 *   2 (ORANGE) → "II"  Muy urgente
 *   3 (YELLOW) → "III" Urgente
 *   4 (GREEN)  → "IV"  Menos urgente
 *   5 (BLUE)   → "V"   No urgente
 *
 * El nivel se persiste como VARCHAR(30) en ece.triaje.nivel_prioridad
 * (per schema.prisma EceTriaje.nivelPrioridad).
 */
import { z } from "zod";

// Nivel Manchester 1-5 (int) mapeado a etiqueta ECE.
export const MANCHESTER_TO_ECE_NIVEL: Record<number, string> = {
  1: "I",
  2: "II",
  3: "III",
  4: "IV",
  5: "V",
} as const;

export const manchesterLevelSchema = z.number().int().min(1).max(5);

// ---------------------------------------------------------------------------
// linkTriage
// ---------------------------------------------------------------------------

export const linkTriageInput = z.object({
  /** UUID de TriageEvaluation HIS (public."TriageEvaluation"). */
  triageId: z.string().uuid(),
  /** UUID de EceTriaje (ece.triaje). */
  eceTriajeId: z.string().uuid(),
});
export type LinkTriageInput = z.infer<typeof linkTriageInput>;

// ---------------------------------------------------------------------------
// unlinkTriage
// ---------------------------------------------------------------------------

export const unlinkTriageInput = z.object({
  triageId: z.string().uuid(),
});
export type UnlinkTriageInput = z.infer<typeof unlinkTriageInput>;

// ---------------------------------------------------------------------------
// createEceFromTriage
// ---------------------------------------------------------------------------

export const createEceFromTriageInput = z.object({
  /** TriageEvaluation HIS completada o en progreso. */
  triageId: z.string().uuid(),
  /** UUID de EceEpisodioAtencion al que pertenece el triaje ECE. */
  episodioId: z.string().uuid(),
  /** UUID de EcePersonalSalud que registra el triaje ECE. */
  registradoPorId: z.string().uuid(),
  /**
   * Si true y el usuario tiene rol ENF, la Hoja ECE pasa a estado "firmado"
   * inmediatamente usando la firma electrónica del usuario en sesión.
   * Default false → estado "borrador".
   */
  firmarInmediatamente: z.boolean().default(false),
  /** UUID del signosVitales ECE a asociar, si ya existe. */
  signosVitalesId: z.string().uuid().optional(),
  /** Destino asignado descriptivo (ej. "Box 4 — Urgencias"). */
  destinoAsignado: z.string().max(100).optional(),
});
export type CreateEceFromTriageInput = z.infer<typeof createEceFromTriageInput>;

// ---------------------------------------------------------------------------
// syncCompletedTriages
// ---------------------------------------------------------------------------

export const syncCompletedTriagesInput = z.object({
  /** Limitar cuántos triages procesar por ejecución (protección de rate). */
  limit: z.number().int().min(1).max(100).default(20),
  /** UUID del EcePersonalSalud que se usará como registradoPor en los ECE creados. */
  registradoPorId: z.string().uuid(),
  /** UUID del EceEpisodioAtencion por defecto — se ignora si ya existe el episodio. */
  defaultEpisodioId: z.string().uuid().optional(),
});
export type SyncCompletedTriagesInput = z.infer<typeof syncCompletedTriagesInput>;

// ---------------------------------------------------------------------------
// Output shapes
// ---------------------------------------------------------------------------

export const linkTriageOutput = z.object({
  ok: z.literal(true),
  eceTriajeId: z.string().uuid(),
  hisTriageId: z.string().uuid(),
});

export const createEceFromTriageOutput = z.object({
  ok: z.literal(true),
  eceTriajeId: z.string().uuid(),
  hisTriageId: z.string().uuid(),
  /** Estado resultante de la Hoja ECE. */
  estadoRegistro: z.enum(["borrador", "firmado"]),
  nivelPrioridad: z.string(),
});

export const syncCompletedTriagesOutput = z.object({
  processed: z.number().int(),
  errors: z.number().int(),
  details: z.array(
    z.object({
      triageId: z.string().uuid(),
      status: z.enum(["created", "skipped", "error"]),
      eceTriajeId: z.string().uuid().optional(),
      reason: z.string().optional(),
    }),
  ),
});
