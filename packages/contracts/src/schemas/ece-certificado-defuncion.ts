/**
 * Schemas Zod — ECE Certificado de Defunción (NTEC / Art. 21, MINSAL Acuerdo 1616-2024).
 *
 * Formato MINSAL: causa directa + causas intermedias + causa básica + manera + autopsia.
 * Workflow: borrador → firmado (MC) → validado (MC) → certificado (DIR) → anulado (DIR, pre-certificado).
 * Inmutable post-firma.
 */
import { z } from "zod";

// ──────────────────────────────────────────────────────────────────────────────
// Primitivos compartidos
// ──────────────────────────────────────────────────────────────────────────────

export const cie10Schema = z
  .string()
  .trim()
  .min(3)
  .max(10)
  .regex(/^[A-Z][0-9]{2}(\.[0-9A-Z]{0,4})?$/, "Formato CIE-10 inválido (ej. J18.9)");

export const pinSchema = z
  .string()
  .trim()
  .regex(/^\d{6,8}$/, "El PIN debe tener 6–8 dígitos numéricos");

// ──────────────────────────────────────────────────────────────────────────────
// Enums MINSAL
// ──────────────────────────────────────────────────────────────────────────────

export const lugarDefuncionSchema = z.enum([
  "intrahospitalaria",
  "extrahospitalaria",
]);

export const maneraDefuncionSchema = z.enum([
  "natural",
  "violenta",
  "accidental",
  "suicidio",
  "homicidio",
  "indeterminada",
]);

export const estadoWorkflowSchema = z.enum([
  "borrador",
  "firmado",
  "validado",
  "certificado",
  "anulado",
]);

// ──────────────────────────────────────────────────────────────────────────────
// Input schemas por procedure
// ──────────────────────────────────────────────────────────────────────────────

export const listCertDefInput = z.object({
  fechaDesde: z.coerce.date().optional(),
  fechaHasta: z.coerce.date().optional(),
  medicoId: z.string().uuid().optional(),
  causaPrincipalCie10: cie10Schema.optional(),
  estado: estadoWorkflowSchema.optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(50).default(20),
});

export const getCertDefInput = z.object({
  id: z.string().uuid(),
});

export const createCertDefInput = z.object({
  episodioId: z.string().uuid(),
  fechaHoraDefuncion: z.coerce.date(),
  lugarDefuncion: lugarDefuncionSchema,
  /** Causa directa de muerte (CIE-10, línea A del certificado MINSAL). */
  causaPrincipalCie10: cie10Schema,
  /** Causas intermedias / líneas B-C del certificado (orden: más reciente primero). */
  causasIntermediasCie10: z.array(cie10Schema).max(3).default([]),
  /** Causa básica / subyacente (línea D del certificado MINSAL). */
  causaBasicaCie10: cie10Schema,
  manera: maneraDefuncionSchema,
  autopsiaRealizada: z.boolean(),
  observaciones: z.string().trim().max(2_000).optional(),
});

export const firmarCertDefInput = z.object({
  id: z.string().uuid(),
  /** PIN de firma electrónica del MC. */
  pin: pinSchema,
});

export const validarCertDefInput = z.object({
  id: z.string().uuid(),
  observacion: z.string().trim().max(1_000).optional(),
});

export const certificarCertDefInput = z.object({
  id: z.string().uuid(),
  /** PIN de firma electrónica del DIR (segunda firma). */
  pin: pinSchema,
});

export const anularCertDefInput = z.object({
  id: z.string().uuid(),
  motivoAnulacion: z.string().trim().min(10).max(1_000),
});

// ──────────────────────────────────────────────────────────────────────────────
// Tipo inferido (para UI y router)
// ──────────────────────────────────────────────────────────────────────────────

export type CreateCertDefInput = z.infer<typeof createCertDefInput>;
export type ListCertDefInput = z.infer<typeof listCertDefInput>;
export type EstadoWorkflow = z.infer<typeof estadoWorkflowSchema>;
export type ManeraDefuncion = z.infer<typeof maneraDefuncionSchema>;
export type LugarDefuncion = z.infer<typeof lugarDefuncionSchema>;
