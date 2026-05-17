/**
 * withWorkflowContext — stub para compilación mientras Stream 11 no está integrado.
 *
 * Stream 11 (ece-context) es el propietario real de este módulo.
 * Esta implementación mínima ejecuta el callback dentro de una transacción
 * Prisma y aplica el GUC del establecimiento (análogo a withTenantContext).
 *
 * NOTA: El consolidador debe reemplazar este archivo con la implementación
 * completa de Stream 11, que incluirá SET LOCAL de app.establecimiento_id
 * y la demote de rol a `authenticated`.
 *
 * @see docs/backlog/fase2/02_as_arquitectura.md §9.1 withEceContext
 */
import type { PrismaClient } from "@his/database";

export async function withWorkflowContext<T>(
  prisma: PrismaClient,
  _establecimientoId: string | undefined,
  fn: (tx: PrismaClient) => Promise<T>,
): Promise<T> {
  // TODO(Stream 11): aplicar SET LOCAL app.establecimiento_id y demote de rol.
  return prisma.$transaction(async (tx) => fn(tx as unknown as PrismaClient));
}
