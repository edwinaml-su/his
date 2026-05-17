/**
 * ECE RLS context helper.
 *
 * Invoca la función SQL `ece.set_ece_context(personal_id, establecimiento_id)`
 * que setea los GUC del schema ECE antes de cualquier query en el schema ece.*
 *
 * Debe llamarse dentro de una transacción Prisma (SET LOCAL es scoped a la tx).
 * `withEceContext` es el wrapper de conveniencia; análogo a `withTenantContext`.
 *
 * @see packages/database/sql/ — función ece.set_ece_context definida en DDL ECE.
 * @see packages/trpc/src/workflow/context.ts — contexto de workflow (GUCs app.*)
 */
import type { PrismaClient } from "@prisma/client";
import type { EceContext } from "../workflow/context";

/**
 * Aplica los GUC ECE dentro de la transacción activa via ece.set_ece_context.
 * También demota el rol a `authenticated` para que RLS ECE aplique.
 */
export async function applyEceContext(
  tx: Pick<PrismaClient, "$executeRawUnsafe">,
  ctx: EceContext,
  opts: { demoteRole?: boolean } = {},
): Promise<void> {
  // Escapar para evitar injection; cast a ::uuid aborta si no son UUIDs válidos.
  const personalId = String(ctx.personalId).replace(/'/g, "''");
  const establecimientoId = String(ctx.establecimientoId).replace(/'/g, "''");

  await tx.$executeRawUnsafe(
    `SELECT ece.set_ece_context('${personalId}'::uuid, '${establecimientoId}'::uuid);`,
  );

  if (opts.demoteRole !== false) {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE authenticated`);
  }
}

/**
 * Ejecuta `fn` dentro de un `prisma.$transaction` con el contexto ECE aplicado.
 *
 * Ejemplo:
 *   const hc = await withEceContext(prisma, eceCtx, async (tx) => {
 *     return tx.$queryRaw`SELECT * FROM ece.historia_clinica WHERE ...`;
 *   });
 */
export async function withEceContext<T>(
  prisma: PrismaClient,
  ctx: EceContext,
  fn: (tx: PrismaClient) => Promise<T>,
  opts: { demoteRole?: boolean } = {},
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await applyEceContext(tx as unknown as PrismaClient, ctx, opts);
    return fn(tx as unknown as PrismaClient);
  });
}
