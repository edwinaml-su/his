/**
 * Schemas Zod — RRI: Referencia / Retorno / Interconsulta (NTEC Doc 10).
 *
 * Workflow RRI:
 *   borrador → en_revision  (crear, solo MC)
 *   en_revision → firmado   (firmar, rol MC — emite ece.rri.firmada)
 *   firmado → validado      (responder, rol IC — emite ece.rri.respondida)
 *   cualquiera → anulado    (anular, rol DIR)
 */
import { z } from "zod";

export const tipoRriSchema = z.enum(["referencia", "retorno", "interconsulta"]);
export type TipoRri = z.infer<typeof tipoRriSchema>;

export const urgenciaRriSchema = z.enum(["rutinaria", "prioritaria", "urgente"]);
export type UrgenciaRri = z.infer<typeof urgenciaRriSchema>;

export const estadoRriSchema = z.enum(["borrador", "en_revision", "firmado", "validado", "anulado"]);
export type EstadoRri = z.infer<typeof estadoRriSchema>;

// ─── Inputs de procedimientos ─────────────────────────────────────────────────

export const eceRriListSchema = z.object({
  pacienteId: z.string().uuid().optional(),
  episodioId: z.string().uuid().optional(),
  tipo: tipoRriSchema.optional(),
  estado: estadoRriSchema.optional(),
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});
export type EceRriListInput = z.infer<typeof eceRriListSchema>;

export const eceRriGetSchema = z.object({ id: z.string().uuid() });
export type EceRriGetInput = z.infer<typeof eceRriGetSchema>;

export const eceRriCreateSchema = z.object({
  episodioId: z.string().uuid(),
  tipo: tipoRriSchema,
  destinoServicioId: z.string().uuid(),
  motivo: z.string().trim().min(1).max(2000),
  datosClinicosRelevantes: z.string().trim().min(1).max(4000),
  urgencia: urgenciaRriSchema,
});
export type EceRriCreateInput = z.infer<typeof eceRriCreateSchema>;

export const eceRriFirmarSchema = z.object({
  rriId: z.string().uuid(),
  pin: z.string().trim().regex(/^\d{6,8}$/, "PIN debe ser 6-8 dígitos"),
});
export type EceRriFirmarInput = z.infer<typeof eceRriFirmarSchema>;

export const eceRriResponderSchema = z.object({
  rriId: z.string().uuid(),
  respuesta: z.string().trim().min(1).max(4000),
  diagnostico: z.string().trim().min(1).max(2000),
  plan: z.string().trim().min(1).max(4000),
  pin: z.string().trim().regex(/^\d{6,8}$/, "PIN debe ser 6-8 dígitos"),
});
export type EceRriResponderInput = z.infer<typeof eceRriResponderSchema>;

export const eceRriAnularSchema = z.object({
  rriId: z.string().uuid(),
  motivo: z.string().trim().min(1).max(1000),
});
export type EceRriAnularInput = z.infer<typeof eceRriAnularSchema>;
