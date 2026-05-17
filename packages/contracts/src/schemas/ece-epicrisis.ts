/**
 * Schemas Zod — ECE §3.15 Epicrisis de Egreso (NTEC / Art. 40).
 *
 * El documento es HISTÓRICO — inmutable post-firma (Art. 40).
 * Workflow: borrador → firmado → validado → certificado → (anulado).
 * Roles: MC firma, ESP valida, DIR certifica/anula.
 */
import { z } from "zod";

/** CIE-10: código de 3-7 chars alfanumérico (A00.0 … Z99.99). */
const cie10CodeSchema = z
  .string()
  .trim()
  .min(3)
  .max(10)
  .regex(/^[A-Z][0-9]{2}(\.[0-9A-Z]{0,4})?$/, "Formato CIE-10 inválido");

/** Un diagnóstico de egreso individual. */
const diagnosticoEgresoItemSchema = z.object({
  cie10: cie10CodeSchema,
  descripcion: z.string().min(1).max(500),
  tipo: z.enum(["principal", "secundario", "comorbilidad"]).default("secundario"),
});

export const eceEpicrisisCreateSchema = z.object({
  episodioHospitalarioId: z.string().uuid(),
  fechaEgreso: z.coerce.date(),
  motivoEgreso: z.enum(["alta_voluntaria", "alta_medica", "traslado", "fallecido", "otro"]),
  /** Al menos un diagnóstico de egreso obligatorio (NTEC). */
  diagnosticoEgresoCie10: z
    .array(diagnosticoEgresoItemSchema)
    .min(1, "Se requiere al menos un diagnóstico de egreso (NTEC)"),
  resumenIngreso: z.string().min(10).max(10_000),
  evolucionHospitalaria: z.string().min(10).max(10_000),
  tratamientoEgreso: z.string().min(5).max(5_000),
  indicacionesEgreso: z.string().min(5).max(5_000),
  /** Observaciones libres opcionales. */
  notas: z.string().max(2_000).optional(),
});

export const eceEpicrisisGetSchema = z.object({
  id: z.string().uuid(),
});

export const eceEpicrisisListSchema = z.object({
  episodioId: z.string().uuid().optional(),
  pacienteId: z.string().uuid().optional(),
  estado: z
    .enum(["borrador", "firmado", "validado", "certificado", "anulado"])
    .optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(50).default(20),
});

export const eceEpicrisisFirmarSchema = z.object({
  id: z.string().uuid(),
  /** firmaId emitido por firma.confirm. */
  firmaId: z.string().uuid(),
});

export const eceEpicrisisValidarSchema = z.object({
  id: z.string().uuid(),
  observacion: z.string().max(1_000).optional(),
});

export const eceEpicrisisCertificarSchema = z.object({
  id: z.string().uuid(),
  firmaId: z.string().uuid(),
});

export const eceEpicrisisAnularSchema = z.object({
  id: z.string().uuid(),
  motivoAnulacion: z.string().min(10).max(1_000),
});

export type EceEpicrisisCreateInput = z.infer<typeof eceEpicrisisCreateSchema>;
export type EceEpicrisisListInput = z.infer<typeof eceEpicrisisListSchema>;
export type EceEpicresisFirmarInput = z.infer<typeof eceEpicrisisFirmarSchema>;
