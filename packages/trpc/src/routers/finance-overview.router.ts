/**
 * Router: Finance Overview — KPIs ejecutivos del módulo Finance (Wave 11).
 *
 * Tres procedures de solo lectura usados en la landing /finance.
 * Siguen el mismo patrón $queryRawUnsafe que finance-reports.router.ts
 * (Invoice/InvoiceItem tienen drift con schema.prisma — tablas existen en BD).
 *
 * Procedures:
 *   summary          — KPIs del periodo: ingresos, cobrado, CxC, margen, costos,
 *                      claims pendientes, facturas draft/vencidas.
 *   topCostCenters   — top N centros por ingresos en el periodo.
 *   revenueByMonth   — totales de ingresos por mes (últimos N meses).
 */
import { z } from "zod";
import { router, tenantProcedure } from "../trpc";
import { withTenantContext } from "../rls-context";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

const periodInput = z.object({
  periodStart: z.string().date("Formato YYYY-MM-DD"),
  periodEnd: z.string().date("Formato YYYY-MM-DD"),
});

// ---------------------------------------------------------------------------
// Tipos raw de fila
// ---------------------------------------------------------------------------

interface SummaryRow {
  revenue_total: string;
  cobrado: string;
  cxc: string;
  margen_items: string;
  costo_items: string;
}

interface ClaimsCountRow {
  pending_count: string;
}

interface DraftCountRow {
  draft_count: string;
}

interface OverdueCountRow {
  overdue_count: string;
}

interface OperatingCostRow {
  total: string;
}

interface TopCenterRow {
  centro_id: string;
  code: string;
  name: string;
  tipo: string | null;
  ingresos: string;
  costo_items: string;
}

interface RevenueMonthRow {
  mes: string;
  revenue: string;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const financeOverviewRouter = router({
  /**
   * KPIs del periodo para la landing /finance.
   *
   * revenueTotal       — Σ Invoice.totalAmount (status ≠ VOIDED) en periodo
   * cobrado            — Σ Invoice.paidAmount (status ≠ VOIDED) en periodo
   * cxc                — Σ (totalAmount - paidAmount) WHERE status IN (ISSUED, PARTIALLY_PAID)
   * margenPct          — (Σ InvoiceItem.totalPrice - Σ InvoiceItem.estimatedCost) / Σ totalPrice
   * operatingCostsTotal — Σ HisOperatingCost prorateado (por overlapping de periodos)
   * claimsPendingCount — count InsuranceClaim WHERE status IN (SUBMITTED, IN_REVIEW)
   * invoicesDraftCount — count Invoice WHERE status = DRAFT
   * invoicesOverdueCount — count Invoice WHERE dueAt < today AND status IN (ISSUED, PARTIALLY_PAID)
   */
  summary: tenantProcedure
    .input(periodInput)
    .query(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      const orgId = tenant.organizationId;
      const since = input.periodStart + "T00:00:00";
      const until = input.periodEnd + "T23:59:59";

      return withTenantContext(prisma, tenant, async (tx) => {
        // Ingresos, cobrado, CxC y márgenes de InvoiceItem
        const [summaryRows] = await tx.$queryRawUnsafe<SummaryRow[]>(
          `SELECT
             COALESCE(SUM(i."totalAmount") FILTER (WHERE i.status <> 'VOIDED'), 0)::text          AS revenue_total,
             COALESCE(SUM(i."paidAmount")  FILTER (WHERE i.status <> 'VOIDED'), 0)::text          AS cobrado,
             COALESCE(SUM(i."totalAmount" - i."paidAmount")
               FILTER (WHERE i.status IN ('ISSUED','PARTIALLY_PAID')), 0)::text                  AS cxc,
             COALESCE(SUM(ii."totalPrice"), 0)::text                                              AS margen_items,
             COALESCE(SUM(COALESCE(ii."estimatedCost", 0)), 0)::text                              AS costo_items
           FROM "Invoice" i
           LEFT JOIN "InvoiceItem" ii ON ii."invoiceId" = i.id
           WHERE i."organizationId" = $1
             AND i."issuedAt" BETWEEN $2 AND $3`,
          orgId,
          since,
          until,
        );

        // Claims pendientes
        const [claimsRow] = await tx.$queryRawUnsafe<ClaimsCountRow[]>(
          `SELECT COUNT(*)::text AS pending_count
             FROM "InsuranceClaim"
            WHERE "organizationId" = $1
              AND status IN ('SUBMITTED','IN_REVIEW')`,
          orgId,
        );

        // Facturas draft
        const [draftRow] = await tx.$queryRawUnsafe<DraftCountRow[]>(
          `SELECT COUNT(*)::text AS draft_count
             FROM "Invoice"
            WHERE "organizationId" = $1
              AND status = 'DRAFT'`,
          orgId,
        );

        // Facturas vencidas (dueAt < hoy, no pagadas)
        // dueAt puede no existir en schema drift — capturamos el error silenciosamente
        let overdueCount = 0;
        try {
          const [overdueRow] = await tx.$queryRawUnsafe<OverdueCountRow[]>(
            `SELECT COUNT(*)::text AS overdue_count
               FROM "Invoice"
              WHERE "organizationId" = $1
                AND status IN ('ISSUED','PARTIALLY_PAID')
                AND "dueAt" < NOW()`,
            orgId,
          );
          overdueCount = Number(overdueRow?.overdue_count ?? 0);
        } catch {
          // Columna dueAt no existe aún — no es bloqueante
          overdueCount = 0;
        }

        // Costos operativos prorrateados al periodo
        // Usa días de overlap entre (periodStart, periodEnd) y (periodStart_op, periodEnd_op)
        let operatingCostsTotal = 0;
        try {
          const [opCostRow] = await tx.$queryRawUnsafe<OperatingCostRow[]>(
            `SELECT COALESCE(SUM(
               amount *
               GREATEST(
                 EXTRACT(DAY FROM (
                   LEAST("periodEnd"::timestamp, $3::timestamp) -
                   GREATEST("periodStart"::timestamp, $2::timestamp)
                 )) + 1, 0
               ) /
               NULLIF(
                 EXTRACT(DAY FROM ("periodEnd"::timestamp - "periodStart"::timestamp)) + 1,
                 0
               )
             ), 0)::text AS total
             FROM "HisOperatingCost"
             WHERE "organizationId" = $1
               AND "periodStart" <= $3::timestamp
               AND "periodEnd"   >= $2::timestamp`,
            orgId,
            since,
            until,
          );
          operatingCostsTotal = Number(opCostRow?.total ?? 0);
        } catch {
          operatingCostsTotal = 0;
        }

        const revenueTotal = Number(summaryRows?.revenue_total ?? 0);
        const cobrado = Number(summaryRows?.cobrado ?? 0);
        const cxc = Number(summaryRows?.cxc ?? 0);
        const margenItems = Number(summaryRows?.margen_items ?? 0);
        const costoItems = Number(summaryRows?.costo_items ?? 0);

        const margenBruto = margenItems - costoItems;
        const margenPct =
          margenItems > 0
            ? parseFloat(((margenBruto / margenItems) * 100).toFixed(2))
            : 0;

        const cobradoPct =
          revenueTotal > 0
            ? parseFloat(((cobrado / revenueTotal) * 100).toFixed(1))
            : 0;

        return {
          revenueTotal,
          cobrado,
          cobradoPct,
          cxc,
          margenPct,
          operatingCostsTotal,
          claimsPendingCount: Number(claimsRow?.pending_count ?? 0),
          invoicesDraftCount: Number(draftRow?.draft_count ?? 0),
          invoicesOverdueCount: overdueCount,
        };
      });
    }),

  /**
   * Top N centros de costo por ingresos en el periodo.
   * Incluye margen bruto estimado (totalPrice - estimatedCost de InvoiceItem).
   */
  topCostCenters: tenantProcedure
    .input(
      periodInput.extend({
        limit: z.number().int().min(1).max(20).default(5),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      const orgId = tenant.organizationId;
      const since = input.periodStart + "T00:00:00";
      const until = input.periodEnd + "T23:59:59";

      return withTenantContext(prisma, tenant, async (tx) => {
        const rows = await tx.$queryRawUnsafe<TopCenterRow[]>(
          `SELECT
             cc.id                                                  AS centro_id,
             cc.code,
             cc.name,
             cc.tipo,
             COALESCE(SUM(ii."totalPrice"), 0)::text                AS ingresos,
             COALESCE(SUM(COALESCE(ii."estimatedCost", 0)), 0)::text AS costo_items
           FROM "CostCenter" cc
           LEFT JOIN "InvoiceItem" ii ON ii."costCenterId" = cc.id
           LEFT JOIN "Invoice" i
             ON i.id = ii."invoiceId"
            AND i."issuedAt" BETWEEN $2 AND $3
            AND i.status <> 'VOIDED'
           WHERE cc."organizationId" = $1
             AND cc.active = true
           GROUP BY cc.id, cc.code, cc.name, cc.tipo
           HAVING COALESCE(SUM(ii."totalPrice"), 0) > 0
           ORDER BY SUM(ii."totalPrice") DESC NULLS LAST
           LIMIT $4`,
          orgId,
          since,
          until,
          input.limit,
        );

        return rows.map((r) => {
          const ingresos = Number(r.ingresos);
          const costoItems = Number(r.costo_items);
          const margen = ingresos - costoItems;
          const margenPct =
            ingresos > 0
              ? parseFloat(((margen / ingresos) * 100).toFixed(1))
              : 0;
          return {
            centroId: r.centro_id,
            code: r.code,
            name: r.name,
            tipo: r.tipo ?? "productivo",
            ingresos,
            margenPct,
          };
        });
      });
    }),

  /**
   * Ingresos por mes para gráfico de tendencia.
   * Retorna los últimos `months` meses completos (más el mes actual parcial).
   */
  revenueByMonth: tenantProcedure
    .input(
      z.object({
        months: z.number().int().min(1).max(24).default(6),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      const orgId = tenant.organizationId;

      return withTenantContext(prisma, tenant, async (tx) => {
        const rows = await tx.$queryRawUnsafe<RevenueMonthRow[]>(
          `SELECT
             TO_CHAR(DATE_TRUNC('month', i."issuedAt"), 'YYYY-MM') AS mes,
             COALESCE(SUM(i."totalAmount"), 0)::text                AS revenue
           FROM "Invoice" i
           WHERE i."organizationId" = $1
             AND i.status <> 'VOIDED'
             AND i."issuedAt" >= DATE_TRUNC('month', NOW()) - ($2 - 1) * INTERVAL '1 month'
           GROUP BY DATE_TRUNC('month', i."issuedAt")
           ORDER BY 1 ASC`,
          orgId,
          input.months,
        );

        return rows.map((r) => ({
          mes: r.mes,
          revenue: Number(r.revenue),
        }));
      });
    }),
});
