/**
 * Router: Reportes Financieros y Regulatorios MINSAL (TDR §23, spec §8).
 *
 * Todas las queries usan $queryRawUnsafe porque Invoice/InvoiceItem/InvoicePayment
 * y los campos extendidos de CostCenter tienen drift con schema.prisma.
 *
 * Procedures:
 *   estadoResultadosPorCentro — reporte 1: ingresos/costos/margen por centro
 *   distribucionProrrateo     — reporte 2: reglas de asignación (apoyo→intermedio/productivo)
 *   costoPorPaciente          — reporte 3: costo por egresado + días de estancia
 *   costoPorProcedimiento     — reporte 4: costo por procedimiento quirúrgico/estudio
 *   consumoInsumosPorCentro   — reporte 5: insumos/medicamentos por centro (heurística)
 *   planillaPorCentro         — reporte 6: placeholder (sin módulo nómina formal)
 *   consolidadoMinsal         — reporte 7: consolidado regulatorio por tipo de centro
 *
 * Decisión post-prorrateo: estadoResultadosPorCentro calcula costoIndirecto ad-hoc
 * leyendo CostCenterAllocationRule si la tabla existe. NO requiere correr runProration
 * primero — es un preview in-query. Si la tabla no existe, costoIndirecto = 0.
 */
import { z } from "zod";
import { router, tenantProcedure } from "../trpc";
import { withTenantContext } from "../rls-context";

// ---------------------------------------------------------------------------
// Schemas de input compartidos
// ---------------------------------------------------------------------------

const dateRangeInput = z.object({
  fechaDesde: z.string().date("Formato YYYY-MM-DD"),
  fechaHasta: z.string().date("Formato YYYY-MM-DD"),
  organizationId: z.string().uuid().optional(),
});

// ---------------------------------------------------------------------------
// Tipos de fila raw
// ---------------------------------------------------------------------------

interface EstadoResultadosRow {
  centro_id: string;
  code: string;
  name: string;
  tipo: string | null;
  ingresos: string;
  costo_directo: string;
}

interface AllocationRuleRow {
  rule_id: string;
  rule_name: string;
  periodicidad: string;
  source_id: string;
  source_code: string;
  source_name: string;
  target_id: string;
  target_code: string;
  target_name: string;
  porcentaje: string;
  base_distribucion: string | null;
}

interface CostoPacienteRow {
  encounter_id: string;
  patient_id: string;
  mrn: string | null;
  admission_type: string | null;
  admitted_at: Date | null;
  discharged_at: Date | null;
  dias_estancia: string;
  total_costo: string;
}

interface CostoProcedimientoRow {
  service_unit_id: string | null;
  service_unit_name: string | null;
  qty: string;
  costo_promedio: string;
  costo_total: string;
}

interface ConsumoInsumosRow {
  centro_id: string;
  code: string;
  name: string;
  tipo: string | null;
  total_items: string;
  total_costo: string;
}

interface ConsolidadoRow {
  tipo: string;
  num_centros: string;
  ingresos_total: string;
  costos_directos_total: string;
  num_facturas: string;
}

// ---------------------------------------------------------------------------
// Helper: resuelve orgId efectivo (usa tenant si no se provee override)
// ---------------------------------------------------------------------------

function resolveOrg(tenantOrgId: string, inputOrgId?: string): string {
  return inputOrgId ?? tenantOrgId;
}

// ---------------------------------------------------------------------------
// Alias para brevedad (todos son read-only, usa tenantProcedure)
// ---------------------------------------------------------------------------

const readerProc = tenantProcedure;

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const financeReportsRouter = router({
  /**
   * Reporte 1 — Estado de resultados por centro de costo.
   *
   * Calcula ingresos (sum InvoiceItem.totalPrice por centro) y costo directo
   * (sum HisOperatingCost si la tabla existe, fallback = 0).
   *
   * costoIndirecto (preview post-prorrateo): si existe CostCenterAllocationRule,
   * calcula la porción que cada centro productivo/intermedio recibe de los centros
   * de apoyo, proporcional a sus porcentajes. Es un preview ad-hoc — no requiere
   * ejecutar runProration previamente.
   */
  estadoResultadosPorCentro: readerProc
    .input(dateRangeInput)
    .query(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      const orgId = resolveOrg(tenant.organizationId, input.organizationId);
      const desde = input.fechaDesde + "T00:00:00";
      const hasta = input.fechaHasta + "T23:59:59";

      return withTenantContext(prisma, tenant, async (tx) => {
        // Ingresos por centro (InvoiceItem → Invoice)
        const rows = await tx.$queryRawUnsafe<EstadoResultadosRow[]>(
          `SELECT
             cc.id               AS centro_id,
             cc.code,
             cc.name,
             cc.tipo,
             COALESCE(SUM(ii."totalPrice"), 0)::text AS ingresos,
             '0'                                     AS costo_directo
           FROM "CostCenter" cc
           LEFT JOIN "InvoiceItem" ii ON ii."costCenterId" = cc.id
           LEFT JOIN "Invoice" i
             ON i.id = ii."invoiceId"
            AND i."issuedAt" BETWEEN $2 AND $3
            AND i.status <> 'VOIDED'
           WHERE cc."organizationId" = $1
             AND cc.active = true
           GROUP BY cc.id, cc.code, cc.name, cc.tipo
           ORDER BY cc.code`,
          orgId,
          desde,
          hasta,
        );

        // Preview costoIndirecto: leer reglas de prorrateo si la tabla existe
        let allocationMap: Record<string, number> = {};
        try {
          type RulePreviewRow = {
            source_id: string;
            target_id: string;
            porcentaje: string;
          };
          const rules = await tx.$queryRawUnsafe<RulePreviewRow[]>(
            `SELECT r."costCenterId" AS source_id,
                    t."destinoCostCenterId" AS target_id,
                    t.porcentaje::text
               FROM "CostCenterAllocationRule" r
               JOIN "CostCenterAllocationTarget" t ON t."allocationRuleId" = r.id
              WHERE r."costCenterId" IN (
                SELECT id FROM "CostCenter"
                WHERE "organizationId" = $1 AND tipo = 'apoyo' AND active = true
              )`,
            orgId,
          );

          // Calcular monto a distribuir por centro fuente (sus ingresos como proxy de costo)
          const ingresosPorCentro: Record<string, number> = {};
          for (const r of rows) {
            ingresosPorCentro[r.centro_id] = Number(r.ingresos);
          }

          for (const rule of rules) {
            const costoFuente = ingresosPorCentro[rule.source_id] ?? 0;
            const porcion = (costoFuente * Number(rule.porcentaje)) / 100;
            allocationMap[rule.target_id] = (allocationMap[rule.target_id] ?? 0) + porcion;
          }
        } catch {
          // Tabla no migrada — costoIndirecto = 0 para todos
          allocationMap = {};
        }

        return rows.map((r) => {
          const ingresos = Number(r.ingresos);
          const costoDirecto = Number(r.costo_directo);
          const costoIndirecto = allocationMap[r.centro_id] ?? 0;
          const margen = ingresos - costoDirecto - costoIndirecto;
          const margenPct = ingresos > 0 ? (margen / ingresos) * 100 : 0;
          return {
            code: r.code,
            name: r.name,
            tipo: r.tipo ?? "productivo",
            ingresos,
            costoDirecto,
            costoIndirecto,
            margen,
            margenPct: parseFloat(margenPct.toFixed(2)),
          };
        });
      });
    }),

  /**
   * Reporte 2 — Distribución de centros de apoyo hacia intermedios y productivos.
   *
   * Lee CostCenterAllocationRule + CostCenterAllocationTarget.
   * Si la tabla no existe, retorna array vacío.
   */
  distribucionProrrateo: readerProc
    .input(z.object({ organizationId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      const orgId = resolveOrg(tenant.organizationId, input.organizationId);

      return withTenantContext(prisma, tenant, async (tx) => {
        try {
          const rows = await tx.$queryRawUnsafe<AllocationRuleRow[]>(
            `SELECT
               r.id                            AS rule_id,
               r.name                          AS rule_name,
               r.periodicidad,
               src.id                          AS source_id,
               src.code                        AS source_code,
               src.name                        AS source_name,
               dst.id                          AS target_id,
               dst.code                        AS target_code,
               dst.name                        AS target_name,
               t.porcentaje::text,
               src.base_distribucion
             FROM "CostCenterAllocationRule" r
             JOIN "CostCenter" src ON src.id = r."costCenterId"
             JOIN "CostCenterAllocationTarget" t ON t."allocationRuleId" = r.id
             JOIN "CostCenter" dst ON dst.id = t."destinoCostCenterId"
             WHERE src."organizationId" = $1
             ORDER BY r.name, dst.code`,
            orgId,
          );

          // Agrupar por regla
          const byRule = new Map<
            string,
            {
              ruleId: string;
              ruleName: string;
              periodicidad: string;
              sourceCode: string;
              sourceName: string;
              baseDistribucion: string | null;
              targets: Array<{ code: string; name: string; porcentaje: number }>;
            }
          >();

          for (const r of rows) {
            if (!byRule.has(r.rule_id)) {
              byRule.set(r.rule_id, {
                ruleId: r.rule_id,
                ruleName: r.rule_name,
                periodicidad: r.periodicidad,
                sourceCode: r.source_code,
                sourceName: r.source_name,
                baseDistribucion: r.base_distribucion,
                targets: [],
              });
            }
            byRule.get(r.rule_id)!.targets.push({
              code: r.target_code,
              name: r.target_name,
              porcentaje: Number(r.porcentaje),
            });
          }

          return Array.from(byRule.values());
        } catch {
          return [];
        }
      });
    }),

  /**
   * Reporte 3 — Costo por paciente egresado.
   *
   * JOIN InvoiceItem → Invoice → Encounter con dischargedAt en el periodo.
   * Paginado (limit/offset).
   */
  costoPorPaciente: readerProc
    .input(
      dateRangeInput.extend({
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      const orgId = resolveOrg(tenant.organizationId, input.organizationId);
      const desde = input.fechaDesde + "T00:00:00";
      const hasta = input.fechaHasta + "T23:59:59";

      return withTenantContext(prisma, tenant, async (tx) => {
        const rows = await tx.$queryRawUnsafe<CostoPacienteRow[]>(
          `SELECT
             e.id                                         AS encounter_id,
             e."patientId"                                AS patient_id,
             p.mrn,
             e."admissionType"                            AS admission_type,
             e."admittedAt"                               AS admitted_at,
             e."dischargedAt"                             AS discharged_at,
             COALESCE(
               EXTRACT(DAY FROM (e."dischargedAt" - e."admittedAt")),
               0
             )::text                                      AS dias_estancia,
             COALESCE(SUM(ii."totalPrice"), 0)::text      AS total_costo
           FROM "Encounter" e
           JOIN "Patient" p ON p.id = e."patientId"
           LEFT JOIN "Invoice" i
             ON i."encounterId" = e.id
            AND i."organizationId" = $1
            AND i.status <> 'VOIDED'
           LEFT JOIN "InvoiceItem" ii ON ii."invoiceId" = i.id
           WHERE e."organizationId" = $1
             AND e."dischargedAt" BETWEEN $2 AND $3
           GROUP BY e.id, e."patientId", p.mrn, e."admissionType",
                    e."admittedAt", e."dischargedAt"
           ORDER BY e."dischargedAt" DESC
           LIMIT $4 OFFSET $5`,
          orgId,
          desde,
          hasta,
          input.limit,
          input.offset,
        );

        return rows.map((r) => ({
          encounterId: r.encounter_id,
          patientId: r.patient_id,
          mrn: r.mrn,
          admissionType: r.admission_type,
          admittedAt: r.admitted_at,
          dischargedAt: r.discharged_at,
          diasEstancia: Number(r.dias_estancia),
          totalCosto: Number(r.total_costo),
        }));
      });
    }),

  /**
   * Reporte 4 — Costo por procedimiento quirúrgico y por estudio diagnóstico.
   *
   * Agrupado por ServiceUnit. Si serviceUnitId es NULL se agrupa como "Sin unidad".
   */
  costoPorProcedimiento: readerProc
    .input(dateRangeInput)
    .query(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      const orgId = resolveOrg(tenant.organizationId, input.organizationId);
      const desde = input.fechaDesde + "T00:00:00";
      const hasta = input.fechaHasta + "T23:59:59";

      return withTenantContext(prisma, tenant, async (tx) => {
        const rows = await tx.$queryRawUnsafe<CostoProcedimientoRow[]>(
          `SELECT
             ii."serviceUnitId"                               AS service_unit_id,
             su.name                                          AS service_unit_name,
             COUNT(ii.id)::text                               AS qty,
             AVG(ii."totalPrice")::text                       AS costo_promedio,
             SUM(ii."totalPrice")::text                       AS costo_total
           FROM "InvoiceItem" ii
           JOIN "Invoice" i ON i.id = ii."invoiceId"
           LEFT JOIN "ServiceUnit" su ON su.id = ii."serviceUnitId"
           WHERE i."organizationId" = $1
             AND i."issuedAt" BETWEEN $2 AND $3
             AND i.status <> 'VOIDED'
           GROUP BY ii."serviceUnitId", su.name
           ORDER BY SUM(ii."totalPrice") DESC`,
          orgId,
          desde,
          hasta,
        );

        return rows.map((r) => ({
          serviceUnitId: r.service_unit_id,
          serviceUnitName: r.service_unit_name ?? "Sin unidad de servicio",
          qty: Number(r.qty),
          costoPromedio: Number(r.costo_promedio),
          costoTotal: Number(r.costo_total),
        }));
      });
    }),

  /**
   * Reporte 5 — Consumo de insumos y medicamentos por centro de costo.
   *
   * Heurística: InvoiceItem donde description ILIKE '%medicament%' OR '%insumo%'
   * OR '%fármaco%' OR '%material%'. Sin módulo Pharmacy formal en scope MVP.
   */
  consumoInsumosPorCentro: readerProc
    .input(dateRangeInput)
    .query(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      const orgId = resolveOrg(tenant.organizationId, input.organizationId);
      const desde = input.fechaDesde + "T00:00:00";
      const hasta = input.fechaHasta + "T23:59:59";

      return withTenantContext(prisma, tenant, async (tx) => {
        const rows = await tx.$queryRawUnsafe<ConsumoInsumosRow[]>(
          `SELECT
             cc.id                              AS centro_id,
             cc.code,
             cc.name,
             cc.tipo,
             COUNT(ii.id)::text                 AS total_items,
             COALESCE(SUM(ii."totalPrice"), 0)::text AS total_costo
           FROM "CostCenter" cc
           LEFT JOIN "InvoiceItem" ii ON ii."costCenterId" = cc.id
             AND (
               ii.description ILIKE '%medicament%'
               OR ii.description ILIKE '%insumo%'
               OR ii.description ILIKE '%fármaco%'
               OR ii.description ILIKE '%farma%'
               OR ii.description ILIKE '%material%'
             )
           LEFT JOIN "Invoice" i ON i.id = ii."invoiceId"
             AND i."issuedAt" BETWEEN $2 AND $3
             AND i.status <> 'VOIDED'
           WHERE cc."organizationId" = $1
             AND cc.active = true
           GROUP BY cc.id, cc.code, cc.name, cc.tipo
           ORDER BY SUM(ii."totalPrice") DESC NULLS LAST`,
          orgId,
          desde,
          hasta,
        );

        return rows.map((r) => ({
          centroId: r.centro_id,
          code: r.code,
          name: r.name,
          tipo: r.tipo ?? "productivo",
          totalItems: Number(r.total_items),
          totalCosto: Number(r.total_costo),
        }));
      });
    }),

  /**
   * Reporte 6 — Planilla devengada por centro de costo.
   *
   * No existe módulo nómina formal en esta fase. Retorna placeholder.
   * TODO: integrar con módulo RRHH cuando esté disponible.
   */
  planillaPorCentro: readerProc.query(() => {
    return {
      mensaje: "Requiere integración con módulo de nómina (pendiente de implementación).",
      pendienteIntegracion: true,
      datos: [] as Array<{ centroId: string; code: string; name: string; montoDevengado: number }>,
    };
  }),

  /**
   * Reporte 7 — Consolidado MINSAL por tipo de centro.
   *
   * Agrupado por tipo (productivo/intermedio/apoyo).
   * Métricas: ingresos totales, costos directos, número de facturas, número de egresos.
   */
  consolidadoMinsal: readerProc
    .input(dateRangeInput)
    .query(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      const orgId = resolveOrg(tenant.organizationId, input.organizationId);
      const desde = input.fechaDesde + "T00:00:00";
      const hasta = input.fechaHasta + "T23:59:59";

      return withTenantContext(prisma, tenant, async (tx) => {
        const rows = await tx.$queryRawUnsafe<ConsolidadoRow[]>(
          `SELECT
             COALESCE(cc.tipo, 'productivo')     AS tipo,
             COUNT(DISTINCT cc.id)::text         AS num_centros,
             COALESCE(SUM(i."totalAmount"), 0)::text   AS ingresos_total,
             COALESCE(SUM(ii."totalPrice"), 0)::text   AS costos_directos_total,
             COUNT(DISTINCT i.id)::text          AS num_facturas
           FROM "CostCenter" cc
           LEFT JOIN "InvoiceItem" ii ON ii."costCenterId" = cc.id
           LEFT JOIN "Invoice" i ON i.id = ii."invoiceId"
             AND i."issuedAt" BETWEEN $2 AND $3
             AND i.status <> 'VOIDED'
           WHERE cc."organizationId" = $1
             AND cc.active = true
           GROUP BY cc.tipo
           ORDER BY cc.tipo`,
          orgId,
          desde,
          hasta,
        );

        // Egresos en el periodo (Encounter con dischargedAt)
        type EgresosRow = { tipo: string | null; num_egresos: string };
        let egresos: EgresosRow[] = [];
        try {
          egresos = await tx.$queryRawUnsafe<EgresosRow[]>(
            `SELECT
               COALESCE(cc.tipo, 'productivo') AS tipo,
               COUNT(DISTINCT e.id)::text      AS num_egresos
             FROM "Encounter" e
             JOIN "Invoice" i ON i."encounterId" = e.id
               AND i."organizationId" = $1
               AND i.status <> 'VOIDED'
             JOIN "InvoiceItem" ii ON ii."invoiceId" = i.id
             JOIN "CostCenter" cc ON cc.id = ii."costCenterId"
             WHERE e."dischargedAt" BETWEEN $2 AND $3
             GROUP BY cc.tipo`,
            orgId,
            desde,
            hasta,
          );
        } catch {
          // Si falla (ej. columna tipo no existe), egresos queda vacío
        }

        const egresosByTipo = new Map<string, number>();
        for (const e of egresos) {
          egresosByTipo.set(e.tipo ?? "productivo", Number(e.num_egresos));
        }

        return rows.map((r) => ({
          tipo: r.tipo,
          numCentros: Number(r.num_centros),
          ingresosTotal: Number(r.ingresos_total),
          costosDirectosTotal: Number(r.costos_directos_total,),
          numFacturas: Number(r.num_facturas),
          numEgresos: egresosByTipo.get(r.tipo) ?? 0,
        }));
      });
    }),
});
