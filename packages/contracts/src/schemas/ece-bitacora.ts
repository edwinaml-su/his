/**
 * ECE Bitácora de Acceso — Schemas Zod compartidos.
 *
 * Norma: NTEC Arts. 45-52 — registro de acceso a expediente clínico electrónico.
 * Tabla raw SQL: ece.bitacora_acceso (fuera de Prisma schema).
 */
import { z } from "zod";

// Acciones reconocidas por la norma (Art. 46).
export const accionEnum = z.enum([
  "verify",
  "confirm",
  "view",
  "create",
  "update",
  "delete",
  "export",
  "print",
  "share",
]);
export type AccionBitacora = z.infer<typeof accionEnum>;

// ---- Inputs ---------------------------------------------------------------

export const bitacoraListInput = z.object({
  pacienteId: z.string().uuid().optional(),
  personalId: z.string().uuid().optional(),
  desde:      z.string().datetime().optional(),
  hasta:      z.string().datetime().optional(),
  accion:     accionEnum.optional(),
  limit:      z.number().int().min(1).max(200).default(50),
  offset:     z.number().int().min(0).default(0),
});
export type BitacoraListInput = z.infer<typeof bitacoraListInput>;

export const bitacoraExportInput = z.object({
  pacienteId: z.string().uuid().optional(),
  personalId: z.string().uuid().optional(),
  desde:      z.string().datetime().optional(),
  hasta:      z.string().datetime().optional(),
  accion:     accionEnum.optional(),
});
export type BitacoraExportInput = z.infer<typeof bitacoraExportInput>;

export const bitacoraRegisterInput = z.object({
  firmaId:    z.string().uuid().optional(),
  userId:     z.string().uuid(),
  pacienteId: z.string().uuid().optional(),
  accion:     accionEnum,
  exito:      z.boolean().default(true),
  contexto:   z.string().max(500).optional(),
  ip:         z.string().max(45).optional(),
});
export type BitacoraRegisterInput = z.infer<typeof bitacoraRegisterInput>;

// ---- Outputs --------------------------------------------------------------

export const bitacoraRow = z.object({
  id:            z.string().uuid(),
  firmaId:       z.string().uuid().nullable(),
  userId:        z.string().uuid(),
  pacienteId:    z.string().uuid().nullable(),
  accion:        z.string(),
  exito:         z.boolean(),
  contexto:      z.string().nullable(),
  ip:            z.string().nullable(),
  registradoEn:  z.string(),
});
export type BitacoraRow = z.infer<typeof bitacoraRow>;

export const bitacoraListOutput = z.object({
  items: z.array(bitacoraRow),
  total: z.number().int(),
});
export type BitacoraListOutput = z.infer<typeof bitacoraListOutput>;
