/**
 * GS1 Proceso C — Preparación Unidosis (re-empaque por paciente).
 *
 * Schemas Zod para el router gs1ProcesoC y la UI de farmacia.
 */
import { z } from "zod";

// ─── Prepare ─────────────────────────────────────────────────────────────────

export const prepararUnidosisInputSchema = z.object({
  pacienteId: z.string().uuid(),
  indicacionId: z.string().uuid(),
  gtinOrigenId: z.string().uuid(),
  loteOrigen: z.string().trim().min(1).max(50),
  cantidadPreparada: z.number().int().min(1).max(9999),
  fechaPreparacion: z.string().datetime().optional(),
  expiryUnidosis: z.string().datetime(),
  preparadoPor: z.string().uuid(),
});

export type PrepararUnidosisInput = z.infer<typeof prepararUnidosisInputSchema>;

// ─── Verify ──────────────────────────────────────────────────────────────────

export const verificarUnidosisInputSchema = z.object({
  codigoUnidosis: z.string().trim().min(1).max(50),
});

export type VerificarUnidosisInput = z.infer<typeof verificarUnidosisInputSchema>;

// ─── List ─────────────────────────────────────────────────────────────────────

export const listUnidosisInputSchema = z.object({
  pacienteId: z.string().uuid().optional(),
  indicacionId: z.string().uuid().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

export type ListUnidosisInput = z.infer<typeof listUnidosisInputSchema>;

// ─── Row output ──────────────────────────────────────────────────────────────

export const unidosisRowSchema = z.object({
  id: z.string().uuid(),
  codigoUnidosis: z.string(),
  etiquetaQrGenerada: z.string().nullable(),
  pacienteId: z.string().uuid(),
  indicacionId: z.string().uuid(),
  gtinOrigenId: z.string().uuid(),
  loteOrigen: z.string(),
  cantidadPreparada: z.number(),
  fechaPreparacion: z.coerce.date(),
  expiryUnidosis: z.coerce.date(),
  preparadoPor: z.string().uuid(),
  creadoEn: z.coerce.date(),
});

export type UnidosisRow = z.infer<typeof unidosisRowSchema>;
