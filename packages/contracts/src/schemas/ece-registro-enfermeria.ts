/**
 * Schemas Zod — ECE Registro de Enfermería.
 *
 * Cubre la cabecera del registro de jornada (`ece.registro_enfermeria`) y el
 * detalle de administración de medicamento (`ece.administracion_medicamento`).
 *
 * Norma técnica: TDR §7 NTEC / Doc 7 MAR-Kardex.
 */
import { z } from "zod";

export const turnoEnum = z.enum(["matutino", "vespertino", "nocturno"]);
export type Turno = z.infer<typeof turnoEnum>;

/** Crea la cabecera del registro de jornada de enfermería. */
export const eceRegistroCreateSchema = z.object({
  episodioId: z.string().uuid(),
  fecha: z.coerce.date(),
  turno: turnoEnum,
  observaciones: z.string().trim().max(2000).optional(),
});

export type EceRegistroCreateInput = z.infer<typeof eceRegistroCreateSchema>;

/** Agrega una administración de medicamento al registro de jornada. */
export const eceAdministracionSchema = z.object({
  registroId: z.string().uuid(),
  indicacionItemId: z.string().uuid(),
  horaAdministrada: z.coerce.date(),
  dosisAdministrada: z.string().trim().min(1).max(100),
  viaUsada: z.string().trim().min(1).max(80),
  observaciones: z.string().trim().max(2000).optional(),
});

export type EceAdministracionInput = z.infer<typeof eceAdministracionSchema>;

/** Filtros para listar registros. */
export const eceRegistroListSchema = z.object({
  episodioId: z.string().uuid().optional(),
  fecha: z.coerce.date().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

export type EceRegistroListInput = z.infer<typeof eceRegistroListSchema>;

/** Obtiene un registro por id. */
export const eceRegistroGetSchema = z.object({
  id: z.string().uuid(),
});

export type EceRegistroGetInput = z.infer<typeof eceRegistroGetSchema>;

/** Input de firma y validación: sólo el id del registro. */
export const eceRegistroIdSchema = z.object({
  id: z.string().uuid(),
});
