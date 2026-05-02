/**
 * @his/contracts/schemas/audit-integrity — schemas Zod para la US-2.8
 * (verificación de la cadena hash de audit.AuditLog).
 *
 * NOTA: la barrel `schemas/index.ts` está congelada en este sprint; estos
 * schemas se importan por ruta relativa desde el router y la UI
 * (`../../../contracts/src/schemas/audit-integrity`).
 *
 * El schema Prisma de AuditLog NO se modifica aquí (los campos prevHash y
 * signatureHash ya fueron agregados por @Orq).
 */
import { z } from "zod";

// -----------------------------------------------------------------------------
// Inputs
// -----------------------------------------------------------------------------

/**
 * Verificar la cadena desde un id específico (default 0 = toda la tabla).
 * Útil para chequeos incrementales si la tabla crece mucho.
 */
export const verifyChainInputSchema = z.object({
  fromId: z.number().int().min(0).default(0),
});
export type VerifyChainInput = z.infer<typeof verifyChainInputSchema>;

// -----------------------------------------------------------------------------
// Outputs
// -----------------------------------------------------------------------------

/** Ruptura individual: una fila cuyo hash no coincide con el recalculado. */
export const chainBreakSchema = z.object({
  id: z.string(), // BigInt serializado.
  expectedHash: z.string(),
  actualHash: z.string().nullable(),
});
export type ChainBreak = z.infer<typeof chainBreakSchema>;

/** Resultado completo de una verificación. */
export const verifyChainResultSchema = z.object({
  ok: z.boolean(),
  totalRows: z.number().int().nonnegative(),
  fromId: z.number().int().min(0),
  breaks: z.array(chainBreakSchema),
  lastVerifiedAt: z.date(),
});
export type VerifyChainResult = z.infer<typeof verifyChainResultSchema>;

/** Estadísticas básicas de la cadena. */
export const chainStatsSchema = z.object({
  totalRows: z.number().int().nonnegative(),
  lastId: z.string().nullable(), // BigInt serializado.
  lastHash: z.string().nullable(),
});
export type ChainStats = z.infer<typeof chainStatsSchema>;
