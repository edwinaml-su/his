/**
 * Re-exporta los schemas de RRI desde @his/contracts.
 *
 * Adaptador local para el worktree (sin symlink @his/contracts).
 * En main el router importa directamente desde @his/contracts.
 *
 * Fuente canónica: packages/contracts/src/schemas/ece-rri.ts
 */
import { z } from "zod";

export const tipoRriSchema = z.enum(["referencia", "retorno", "interconsulta"]);
export const urgenciaRriSchema = z.enum(["rutinaria", "prioritaria", "urgente"]);
export const estadoRriSchema = z.enum(["borrador", "en_revision", "firmado", "validado", "anulado"]);

export const eceRriListSchema = z.object({
  pacienteId: z.string().uuid().optional(),
  episodioId: z.string().uuid().optional(),
  tipo: tipoRriSchema.optional(),
  estado: estadoRriSchema.optional(),
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

export const eceRriGetSchema = z.object({ id: z.string().uuid() });

export const eceRriCreateSchema = z.object({
  episodioId: z.string().uuid(),
  tipo: tipoRriSchema,
  destinoServicioId: z.string().uuid(),
  motivo: z.string().trim().min(1).max(2000),
  datosClinicosRelevantes: z.string().trim().min(1).max(4000),
  urgencia: urgenciaRriSchema,
});

export const eceRriFirmarSchema = z.object({
  rriId: z.string().uuid(),
  pin: z.string().trim().regex(/^\d{6,8}$/, "PIN debe ser 6-8 dígitos"),
});

export const eceRriResponderSchema = z.object({
  rriId: z.string().uuid(),
  respuesta: z.string().trim().min(1).max(4000),
  diagnostico: z.string().trim().min(1).max(2000),
  plan: z.string().trim().min(1).max(4000),
  pin: z.string().trim().regex(/^\d{6,8}$/, "PIN debe ser 6-8 dígitos"),
});

export const eceRriAnularSchema = z.object({
  rriId: z.string().uuid(),
  motivo: z.string().trim().min(1).max(1000),
});
