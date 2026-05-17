import { z } from "zod";

/**
 * Schemas Zod para el router ECE Triaje (NTEC §3.4 Hoja de Triaje).
 *
 * Complementa al triage.router.ts (schema public, Manchester HIS).
 * Este módulo gestiona el documento formal NTEC `ece.hoja_triaje`.
 */

// Nivel Manchester 1–5 (I=rojo crítico, V=azul no urgente).
const manchesterNivelSchema = z.number().int().min(1).max(5);

// ─── Inputs de query ─────────────────────────────────────────────────────────

export const listTriajeEceInput = z.object({
  episodioId: z.string().uuid().optional(),
  pacienteId: z.string().uuid().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

export const getTriajeEceInput = z.object({
  id: z.string().uuid(),
});

// ─── Input de creación ───────────────────────────────────────────────────────

export const createTriajeEceInput = z.object({
  /** instancia_id del documento_instancia ECE ya creado para TRIAJE. */
  instanciaId: z.string().uuid(),
  episodioId: z.string().uuid(),
  manchesterNivel: manchesterNivelSchema,
  motivoConsulta: z.string().min(1).max(2000),
  tiempoEsperaMin: z.number().int().min(0).max(1440),
  /** FK opcional al TriageEvaluation HIS (schema public). */
  triageId: z.string().uuid().optional(),
  /** signos_vitales_id de ece.signos_vitales (ya registrados). */
  signosVitalesId: z.string().uuid().optional(),
  /** Destino asignado (sala, box, obs, etc.). */
  destinoAsignado: z.string().max(200).optional(),
});

export type CreateTriajeEceInput = z.infer<typeof createTriajeEceInput>;

// ─── Firma / validación ──────────────────────────────────────────────────────

export const firmarTriajeEceInput = z.object({
  id: z.string().uuid(),
  /** firmaId de ece.firma_electronica del ENF firmante. */
  firmaId: z.string().uuid(),
});

export const validarTriajeEceInput = z.object({
  id: z.string().uuid(),
  /** Observación del MT validador (opcional). */
  observacion: z.string().max(1000).optional(),
});

// ─── Link a triage HIS ───────────────────────────────────────────────────────

export const linkToHisTriageInput = z.object({
  id: z.string().uuid(),
  triageId: z.string().uuid(),
});
