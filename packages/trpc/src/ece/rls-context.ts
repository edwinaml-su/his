/**
 * withEceContext — aplica el contexto de identidad ECE dentro de una transacción.
 *
 * Llama a `SELECT ece.set_ece_context($1, $2)` (función definida en el schema ECE
 * de Supabase) que setea:
 *   app.ece_personal_id     → UUID del personal que ejecuta la acción
 *   app.establecimiento_id  → UUID del establecimiento activo
 *
 * IMPORTANTE: `SET LOCAL` es no-op fuera de transacción. Este helper garantiza
 * que la función se invoca siempre dentro de un `prisma.$transaction`.
 */
import type { PrismaClient } from "@prisma/client";

export interface EceRlsOptions {
  /** Default true: demota el rol a `authenticated` para que RLS aplique. */
  demoteRole?: boolean;
}

export async function withEceContext<T>(
  prisma: PrismaClient,
  personalId: string,
  establecimientoId: string,
  fn: (tx: PrismaClient) => Promise<T>,
  options: EceRlsOptions = {},
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // Escapar para SQL literal (mitigación injection; son UUIDs validados por Zod).
    const pId = String(personalId).replace(/'/g, "''");
    const eId = String(establecimientoId).replace(/'/g, "''");

    await (tx as unknown as PrismaClient).$executeRawUnsafe(
      `SELECT ece.set_ece_context('${pId}'::uuid, '${eId}'::uuid);`,
    );

    if (options.demoteRole !== false) {
      await (tx as unknown as PrismaClient).$executeRawUnsafe(
        `SET LOCAL ROLE authenticated`,
      );
    }

    return fn(tx as unknown as PrismaClient);
  });
}
