/**
 * Re-exporta los schemas de RRI desde @his/contracts.
 *
 * Adaptador local para el worktree (sin symlink @his/contracts).
 * En main el router importa directamente desde @his/contracts.
 *
 * Fuente canónica: packages/contracts/src/schemas/ece-rri.ts
 *
 * HD-25 (S1): eliminados campos sin columna en BD:
 *   - urgenciaRriSchema / urgencia → no existe en ece.rri
 *   - diagnostico / plan en eceRriResponderSchema → no existen en ece.rri
 *
 * Decisión: urgencia, diagnostico_ic, plan_ic se incorporan en texto libre de
 *   motivo / resumen_clinico / respuesta_interconsultante. Issue #@AE pendiente
 *   para decidir si se agregan columnas separadas en la BD.
 */
import { z } from "zod";

export const tipoRriSchema = z.enum(["referencia", "retorno", "interconsulta"]);
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
  /** HD-25: era destinoServicioId → columna DB es establecimiento_destino_id */
  establecimientoDestinoId: z.string().uuid(),
  motivo: z.string().trim().min(1).max(2000),
  /** HD-25: era datosClinicosRelevantes → columna DB es resumen_clinico */
  resumenClinico: z.string().trim().min(1).max(4000),
});

export const eceRriFirmarSchema = z.object({
  rriId: z.string().uuid(),
  pin: z.string().trim().regex(/^\d{6,8}$/, "PIN debe ser 6-8 dígitos"),
});

export const eceRriResponderSchema = z.object({
  rriId: z.string().uuid(),
  /** HD-25: era respuesta → columna DB es respuesta_interconsultante */
  respuestaInterconsultante: z.string().trim().min(1).max(4000),
  pin: z.string().trim().regex(/^\d{6,8}$/, "PIN debe ser 6-8 dígitos"),
});

export const eceRriAnularSchema = z.object({
  rriId: z.string().uuid(),
  motivo: z.string().trim().min(1).max(1000),
});
