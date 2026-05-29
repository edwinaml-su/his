/**
 * Router tRPC: GS1 Dashboard de integridad — US.F2.6.5.
 *
 * Devuelve en una sola query consolidada:
 *   - Conteos por entidad (GSRN activos, GLN registrados, GTIN con lotes).
 *   - Vencimientos próximos en N días (por defecto 30).
 *   - GSRN profesionales pendientes de renovación.
 *
 * Seguridad: tenantProcedure + withTenantContext.
 * HI-02: sin withTenantContext el rol Postgres permanece como postgres.<ref>
 * que tiene BYPASSRLS — RLS nunca aplica. Aunque las tablas ece.* no tienen
 * RLS por fila de org, la consistencia de contrato obliga a demotar el rol.
 *
 * Trade-off: usamos $queryRawUnsafe para las CTEs porque Prisma no tiene
 * modelos para ece.*. Alternativa ORM requeriría modelos custom — out-of-scope.
 */

import { z } from "zod";
import { router, tenantProcedure } from "../trpc";
import { withTenantContext } from "../rls-context";

// ---------------------------------------------------------------------------
// Tipos de resultado
// ---------------------------------------------------------------------------

interface CountRow {
  gsrn_activos: string;
  gln_registrados: string;
  gtin_con_lotes: string;
}

interface VencimientoRow {
  id: string;
  codigo: string;
  descripcion: string;
  lote_vencimiento: Date;
  recall_status: string | null;
}

interface GsrnRenovacionRow {
  id: string;
  codigo: string;
  tipo: string;
  referencia_id: string;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const gs1DashboardRouter = router({
  /**
   * summary — agrega conteos + listas de alertas en un solo round-trip.
   */
  summary: tenantProcedure
    .input(
      z.object({
        vencimientosDias: z.number().int().min(1).max(365).default(30),
      }),
    )
    .query(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
      // Conteos globales de las 3 entidades principales.
      const countsRows = await tx.$queryRawUnsafe<CountRow[]>(
        `SELECT
           (SELECT COUNT(*)::text FROM ece.gs1_gsrn WHERE activo = true)  AS gsrn_activos,
           (SELECT COUNT(*)::text FROM ece.gs1_gln  WHERE activo = true)  AS gln_registrados,
           (SELECT COUNT(*)::text FROM ece.gs1_gtin
             WHERE lote_vencimiento IS NOT NULL AND activo = true)         AS gtin_con_lotes`,
      );

      const counts = countsRows[0] ?? {
        gsrn_activos: "0",
        gln_registrados: "0",
        gtin_con_lotes: "0",
      };

      // GTINs con vencimiento próximo (rojo si ≤ vencimientosDias desde hoy).
      const vencimientos = await tx.$queryRawUnsafe<VencimientoRow[]>(
        `SELECT id, codigo, descripcion, lote_vencimiento,
                COALESCE(recall_status, 'NONE') AS recall_status
           FROM ece.gs1_gtin
          WHERE lote_vencimiento IS NOT NULL
            AND activo = true
            AND lote_vencimiento <= (now() + ($1 || ' days')::interval)
          ORDER BY lote_vencimiento ASC
          LIMIT 100`,
        input.vencimientosDias,
      );

      // GSRN profesionales sin renovación reciente (más de 1 año sin movimiento).
      // "Pendiente renovación" = activo pero sin actualizado_en en los últimos 365 días.
      const gsrnRenovacion = await tx.$queryRawUnsafe<GsrnRenovacionRow[]>(
        `SELECT id, codigo, tipo, referencia_id
           FROM ece.gs1_gsrn
          WHERE tipo = 'profesional'
            AND activo = true
            AND COALESCE(actualizado_en, creado_en) < (now() - INTERVAL '365 days')
          ORDER BY COALESCE(actualizado_en, creado_en) ASC
          LIMIT 50`,
      );

      return {
        counts: {
          gsrnActivos:    parseInt(counts.gsrn_activos,    10),
          glnRegistrados: parseInt(counts.gln_registrados, 10),
          gtinConLotes:   parseInt(counts.gtin_con_lotes,  10),
        },
        vencimientosPróximos: vencimientos.map((r) => ({
          id: r.id,
          codigo: r.codigo,
          descripcion: r.descripcion,
          loteVencimiento: r.lote_vencimiento,
          recallStatus: r.recall_status ?? "NONE",
        })),
        gsrnPendientesRenovacion: gsrnRenovacion.map((r) => ({
          id: r.id,
          codigo: r.codigo,
          tipo: r.tipo,
          referenciaId: r.referencia_id,
        })),
        generadoEn: new Date(),
      };
      }); // end withTenantContext
    }),
});
