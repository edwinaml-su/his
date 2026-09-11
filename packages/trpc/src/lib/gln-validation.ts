/**
 * gln-validation.ts — valida que un GLN a asignar (Room.glnCodigo,
 * Bed.glnCodigo) exista y esté activo en el catálogo `ece.gs1_gln`.
 *
 * Corre sobre `ctx.prisma` directo (fuera de `withTenantContext`/
 * `withEceContext`), mismo patrón que `establishment.router.ts` `list()`:
 * es una lectura admin-only (los callers ya están gateados por
 * `requireRole(["ADMIN","DIR"])`) de un catálogo cuya RLS (SQL 200/230) solo
 * deja ver un establecimiento a la vez vía GUC ECE — inadecuada para validar
 * un código puntual desde un router que vive en el espacio de tenant.
 */
import { TRPCError } from "@trpc/server";

type PrismaLike = {
  $queryRawUnsafe: <T>(query: string, ...params: unknown[]) => Promise<T>;
};

type GlnRow = { tipo: string; activo: boolean };

/**
 * Lanza PRECONDITION_FAILED si `codigo` no existe en `ece.gs1_gln`, no está
 * activo, o su `tipo` no está en `tiposPermitidos`.
 */
export async function assertGlnAsignable(
  prisma: PrismaLike,
  codigo: string,
  tiposPermitidos: string[],
): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<GlnRow[]>(
    `SELECT tipo, activo FROM ece.gs1_gln WHERE codigo = $1`,
    codigo,
  );
  const row = rows[0];
  if (!row) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `El GLN ${codigo} no existe en el catálogo ece.gs1_gln.`,
    });
  }
  if (!row.activo) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `El GLN ${codigo} está inactivo.`,
    });
  }
  if (!tiposPermitidos.includes(row.tipo)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `El GLN ${codigo} es de tipo '${row.tipo}', se esperaba ${tiposPermitidos.join(" o ")}.`,
    });
  }
}
