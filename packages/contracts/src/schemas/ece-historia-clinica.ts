/**
 * ECE Historia Clínica — Schemas Zod compartidos.
 *
 * Alineados con DDL de ece.historia_clinica (Doc 2 NTEC).
 * Estados workflow HIST_CLIN: borrador → en_revision → firmado → validado → anulado.
 */
import { z } from "zod";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const HISTORIA_CLINICA_ESTADO = [
  "borrador",
  "en_revision",
  "firmado",
  "validado",
  "anulado",
] as const;

export const historiaClinicaEstadoEnum = z.enum(HISTORIA_CLINICA_ESTADO);
export type HistoriaClinicaEstado = z.infer<typeof historiaClinicaEstadoEnum>;

// ─── Input schemas ────────────────────────────────────────────────────────────

export const historiaClinicaListInput = z.object({
  pacienteId: z.string().uuid().optional(),
  episodioId: z.string().uuid().optional(),
  /** Cursor para paginación (id de la última historia recibida). */
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});
export type HistoriaClinicaListInput = z.infer<typeof historiaClinicaListInput>;

export const historiaClinicaGetInput = z.object({
  id: z.string().uuid(),
});
export type HistoriaClinicaGetInput = z.infer<typeof historiaClinicaGetInput>;

export const historiaClinicaCreateInput = z.object({
  pacienteId: z.string().uuid(),
  episodioId: z.string().uuid().optional(),
  /** Resumen o motivo de consulta que inicia la HC. */
  motivoConsulta: z.string().min(1).max(2000),
  /** Antecedentes relevantes en texto libre (SOAP u otro formato local). */
  antecedentes: z.string().max(5000).optional(),
  /** Plan inicial o diagnóstico diferencial inicial. */
  planInicial: z.string().max(5000).optional(),
});
export type HistoriaClinicaCreateInput = z.infer<typeof historiaClinicaCreateInput>;

export const historiaClinicaUpdateInput = z.object({
  id: z.string().uuid(),
  motivoConsulta: z.string().min(1).max(2000).optional(),
  antecedentes: z.string().max(5000).optional(),
  planInicial: z.string().max(5000).optional(),
});
export type HistoriaClinicaUpdateInput = z.infer<typeof historiaClinicaUpdateInput>;

export const historiaClinicaTransitionInput = z.object({
  id: z.string().uuid(),
  /** UUID de ece.firma_electronica; obligatorio en firmar/validar. */
  firmaId: z.string().uuid().optional(),
  observacion: z.string().max(1000).optional(),
});
export type HistoriaClinicaTransitionInput = z.infer<typeof historiaClinicaTransitionInput>;
