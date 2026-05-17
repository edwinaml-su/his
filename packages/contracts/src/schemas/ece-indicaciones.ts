/**
 * §ECE — Indicaciones Médicas: schemas Zod.
 *
 * Norma técnica NTEC (Doc 6): órdenes de medicamentos emitidas por MC
 * y transcritas/validadas por ENF.
 *
 * Estados workflow IND_MED:
 *   borrador → en_revision → firmado → validado → anulado
 */
import { z } from "zod";

// ─── Item ─────────────────────────────────────────────────────────────────────

export const eceIndicacionItemSchema = z.object({
  medicamentoCodigo: z.string().trim().min(1).max(50),
  dosis: z.string().trim().min(1).max(100),
  via: z.string().trim().min(1).max(50),
  frecuencia: z.string().trim().min(1).max(100),
  duracionDias: z.number().int().min(1).max(365),
  observaciones: z.string().trim().max(500).optional(),
});

export type EceIndicacionItem = z.infer<typeof eceIndicacionItemSchema>;

// ─── Create ───────────────────────────────────────────────────────────────────

export const eceIndicacionesCreateSchema = z.object({
  episodioId: z.string().uuid(),
  observaciones: z.string().trim().max(1000).optional(),
  items: z.array(eceIndicacionItemSchema).min(1).max(50),
});

export type EceIndicacionesCreate = z.infer<typeof eceIndicacionesCreateSchema>;

// ─── Add item ─────────────────────────────────────────────────────────────────

export const eceAddItemSchema = z.object({
  indicacionId: z.string().uuid(),
  item: eceIndicacionItemSchema,
});

// ─── Remove item ──────────────────────────────────────────────────────────────

export const eceRemoveItemSchema = z.object({
  indicacionId: z.string().uuid(),
  itemId: z.string().uuid(),
});

// ─── Firmar / validar / anular ────────────────────────────────────────────────

export const eceIndicacionIdSchema = z.object({
  id: z.string().uuid(),
});

export const eceAnularSchema = z.object({
  id: z.string().uuid(),
  motivo: z.string().trim().min(1).max(500),
});

// ─── List ─────────────────────────────────────────────────────────────────────

export const eceIndicacionesListSchema = z.object({
  episodioId: z.string().uuid(),
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});
