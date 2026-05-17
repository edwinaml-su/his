/**
 * Schemas Zod — ECE Atención de Emergencia (NTEC Doc 5, código ATN_EMERG).
 *
 * Workflow: borrador → en_revision → firmado → validado → anulado.
 * Rol MT (médico de turno) realiza firma y validación.
 * Rol DIR puede anular.
 */
import { z } from "zod";

export const eceAtencionEmergenciaWorkflowEstadoSchema = z.enum([
  "borrador",
  "en_revision",
  "firmado",
  "validado",
  "anulado",
]);

export type EceAtencionEmergenciaWorkflowEstado = z.infer<
  typeof eceAtencionEmergenciaWorkflowEstadoSchema
>;

export const eceAtencionEmergenciaCreateSchema = z.object({
  episodioId: z.string().uuid(),
  motivoConsulta: z.string().min(5).max(2_000),
  exploracion: z.string().min(5).max(5_000),
  diagnostico: z.string().min(5).max(2_000),
  planTerapeutico: z.string().min(5).max(5_000),
});

export const eceAtencionEmergenciaUpdateSchema = z.object({
  id: z.string().uuid(),
  motivoConsulta: z.string().min(5).max(2_000).optional(),
  exploracion: z.string().min(5).max(5_000).optional(),
  diagnostico: z.string().min(5).max(2_000).optional(),
  planTerapeutico: z.string().min(5).max(5_000).optional(),
});

export const eceAtencionEmergenciaGetSchema = z.object({
  id: z.string().uuid(),
});

export const eceAtencionEmergenciaListSchema = z.object({
  pacienteId: z.string().uuid().optional(),
  episodioId: z.string().uuid().optional(),
  fechaDesde: z.coerce.date().optional(),
  fechaHasta: z.coerce.date().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export const eceAtencionEmergenciaFirmarSchema = z.object({
  id: z.string().uuid(),
  firmaId: z.string().uuid(),
});

export const eceAtencionEmergenciaValidarSchema = z.object({
  id: z.string().uuid(),
  observacion: z.string().max(1_000).optional(),
});

export const eceAtencionEmergenciaAnularSchema = z.object({
  id: z.string().uuid(),
  motivoAnulacion: z.string().min(10).max(1_000),
});

export type EceAtencionEmergenciaCreateInput = z.infer<
  typeof eceAtencionEmergenciaCreateSchema
>;
export type EceAtencionEmergenciaUpdateInput = z.infer<
  typeof eceAtencionEmergenciaUpdateSchema
>;
export type EceAtencionEmergenciaListInput = z.infer<
  typeof eceAtencionEmergenciaListSchema
>;
export type EceAtencionEmergenciaFirmarInput = z.infer<
  typeof eceAtencionEmergenciaFirmarSchema
>;
