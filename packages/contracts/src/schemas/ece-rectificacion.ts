/**
 * Schemas Zod — ECE Rectificación (NTEC Art. 41).
 *
 * Las rectificaciones son append-only: nunca modifican el documento original.
 * Estado: PENDIENTE → APROBADA | RECHAZADA.
 */
import { z } from "zod";

export const estadoRectificacionSchema = z.enum([
  "PENDIENTE",
  "APROBADA",
  "RECHAZADA",
]);
export type EstadoRectificacion = z.infer<typeof estadoRectificacionSchema>;

// ---------------------------------------------------------------------------
// Inputs de procedures
// ---------------------------------------------------------------------------

export const rectificacionListInputSchema = z.object({
  documentoInstanciaId: z.string().uuid(),
  estado: estadoRectificacionSchema.optional(),
});

export const rectificacionSolicitarInputSchema = z.object({
  documentoInstanciaId: z.string().uuid(),
  campo: z.string().min(1).max(200),
  valorAnterior: z.string().min(1).max(2000),
  valorPropuesto: z.string().min(1).max(2000),
  motivo: z.string().min(10).max(1000),
});

export const rectificacionAprobarInputSchema = z.object({
  rectificacionId: z.string().uuid(),
});

export const rectificacionRechazarInputSchema = z.object({
  rectificacionId: z.string().uuid(),
  motivoRechazo: z.string().min(10).max(500),
});

// ---------------------------------------------------------------------------
// Tipos de respuesta (filas raw SQL)
// ---------------------------------------------------------------------------

export const rectificacionRowSchema = z.object({
  id: z.string().uuid(),
  documento_instancia_id: z.string().uuid(),
  campo: z.string(),
  valor_anterior: z.string(),
  valor_propuesto: z.string(),
  motivo: z.string(),
  estado: estadoRectificacionSchema,
  solicitante_id: z.string().uuid(),
  solicitante_nombre: z.string().nullable(),
  aprobador_id: z.string().uuid().nullable(),
  fecha_aprobacion: z.string().nullable(),
  motivo_rechazo: z.string().nullable(),
  created_at: z.string(),
});

export type RectificacionRow = z.infer<typeof rectificacionRowSchema>;
