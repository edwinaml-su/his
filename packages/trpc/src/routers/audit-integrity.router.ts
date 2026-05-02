/**
 * US-2.8 — Router de verificación de integridad del audit log.
 *
 * Endpoints:
 *   - verifyChain(fromId?) : ejecuta audit.fn_verify_chain($1) en Postgres.
 *                            Devuelve {ok, totalRows, breaks[]}.
 *   - chainStats()         : count + last id + last hash, vía audit.fn_chain_stats().
 *
 * Notas:
 *  - Sólo super_admin / admin_clinico tienen sentido como invocadores; en MVP
 *    se valida con `requireRole`. La función SQL es STABLE y no toca otras
 *    tablas, por lo que es seguro ejecutar incluso con tablas grandes (filtra
 *    por id).
 *  - Los hashes se devuelven en hex (output de pgcrypto.digest + encode).
 *  - El id de AuditLog es BigInt → lo serializamos como string en la DTO.
 *
 * Importa los schemas via ruta relativa porque `contracts/schemas/index.ts`
 * está congelado en este sprint.
 */
import { z } from "zod";
import {
  verifyChainInputSchema,
  type VerifyChainResult,
  type ChainBreak,
  type ChainStats,
} from "@his/contracts";
import { router, requireRole } from "../trpc";

// Roles autorizados a auditar la cadena (sólo super_admin / admin_clinico).
const INTEGRITY_ROLES = ["super_admin", "admin_clinico"];

interface VerifyChainRow {
  broken_id: bigint | number;
  expected_hash: string | null;
  actual_hash: string | null;
}

interface ChainStatsRow {
  total_rows: bigint | number;
  last_id: bigint | number | null;
  last_hash: string | null;
}

export const auditIntegrityRouter = router({
  /**
   * Verifica la cadena hash a partir de `fromId` (default 0 = toda la tabla).
   * Devuelve filas con hash inválido (vacío si la cadena está íntegra).
   */
  verifyChain: requireRole(INTEGRITY_ROLES)
    .input(verifyChainInputSchema)
    .query(async ({ ctx, input }): Promise<VerifyChainResult> => {
      const startedAt = new Date();

      // Llamada parametrizada — evita SQL injection.
      const breaksRaw = await ctx.prisma.$queryRaw<VerifyChainRow[]>`
        SELECT broken_id, expected_hash, actual_hash
          FROM audit.fn_verify_chain(${input.fromId}::bigint);
      `;

      // Conteo total para el reporte (cheap COUNT(*) en MVP).
      const countRaw = await ctx.prisma.$queryRaw<{ total: bigint | number }[]>`
        SELECT count(*)::bigint AS total FROM audit."AuditLog";
      `;
      const totalRows = Number(countRaw[0]?.total ?? 0);

      const breaks: ChainBreak[] = breaksRaw.map((r) => ({
        id: r.broken_id.toString(),
        expectedHash: r.expected_hash ?? "",
        actualHash: r.actual_hash,
      }));

      return {
        ok: breaks.length === 0,
        totalRows,
        fromId: input.fromId,
        breaks,
        lastVerifiedAt: startedAt,
      };
    }),

  /**
   * Estadísticas ligeras: usado por la UI para mostrar "última fila X" y el
   * hash de cabeza de cadena sin escanear todo.
   */
  chainStats: requireRole(INTEGRITY_ROLES)
    .input(z.void())
    .query(async ({ ctx }): Promise<ChainStats> => {
      const rows = await ctx.prisma.$queryRaw<ChainStatsRow[]>`
        SELECT total_rows, last_id, last_hash FROM audit.fn_chain_stats();
      `;
      const r = rows[0];
      return {
        totalRows: Number(r?.total_rows ?? 0),
        lastId: r?.last_id != null ? r.last_id.toString() : null,
        lastHash: r?.last_hash ?? null,
      };
    }),
});
