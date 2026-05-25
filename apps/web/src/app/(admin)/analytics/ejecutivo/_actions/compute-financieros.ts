"use server";

/**
 * Server action — KPIs Financieros (6 KPIs).
 *
 * Wave 3: módulo Finance MVP en BD (Invoice/InvoiceItem/InvoicePayment/
 * InsuranceClaim) habilita 5/6 KPIs con queries reales. fin_costo_his
 * sigue mock por requerir registro de costos del HIS (otro sprint).
 *
 * Las tablas no están en Prisma client todavía (schema drift conocido del
 * proyecto), se accede vía $queryRaw — mismo patrón que ece.fall_event.
 */
import { prisma } from "@his/database";
import type { KpiValue } from "../_components/kpi-card";
import { fmtUnidad, semaforoMayor, semaforoMenor } from "../_lib/mock-values";

export interface ComputeRequest {
  organizationIds: string[];
  fechaDesde: string;
  fechaHasta: string;
}

export type KpiValuesMap = Record<string, KpiValue | null>;

type CountRow = { count: bigint };
type NumRow = { value: number | null };
type DecRow = { value: string | null };

function toNumber(v: number | string | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "string" ? parseFloat(v) : v;
}

export async function computeFinancieros(req: ComputeRequest): Promise<KpiValuesMap> {
  const result: KpiValuesMap = {};
  const desde = new Date(req.fechaDesde);
  const hasta = new Date(req.fechaHasta);
  const hasOrgs = req.organizationIds.length > 0;

  // -- fin_costo_egreso -----------------------------------------------------
  // Suma de InvoiceItem.totalPrice de invoices vinculadas a encounters
  // egresados en el periodo, dividido entre el nº de encounters egresados.
  try {
    const sumRows = hasOrgs
      ? await prisma.$queryRaw<DecRow[]>`
          SELECT COALESCE(SUM(ii."totalPrice"), 0)::text AS value
          FROM "InvoiceItem" ii
          JOIN "Invoice" i ON i.id = ii."invoiceId"
          JOIN "Encounter" e ON e.id = i."encounterId"
          WHERE e."organizationId" = ANY(${req.organizationIds}::uuid[])
            AND e."dischargedAt" BETWEEN ${desde} AND ${hasta}
        `
      : await prisma.$queryRaw<DecRow[]>`
          SELECT COALESCE(SUM(ii."totalPrice"), 0)::text AS value
          FROM "InvoiceItem" ii
          JOIN "Invoice" i ON i.id = ii."invoiceId"
          JOIN "Encounter" e ON e.id = i."encounterId"
          WHERE e."dischargedAt" BETWEEN ${desde} AND ${hasta}
        `;
    const egresosRows = hasOrgs
      ? await prisma.$queryRaw<CountRow[]>`
          SELECT COUNT(*)::bigint AS count
          FROM "Encounter" e
          WHERE e."organizationId" = ANY(${req.organizationIds}::uuid[])
            AND e."dischargedAt" BETWEEN ${desde} AND ${hasta}
        `
      : await prisma.$queryRaw<CountRow[]>`
          SELECT COUNT(*)::bigint AS count
          FROM "Encounter"
          WHERE "dischargedAt" BETWEEN ${desde} AND ${hasta}
        `;
    const total = toNumber(sumRows[0]?.value ?? null);
    const egresos = Number(egresosRows[0]?.count ?? 0);
    if (egresos === 0) {
      result.fin_costo_egreso = null;
    } else {
      const costo = total / egresos;
      result.fin_costo_egreso = {
        display: `$ ${costo.toLocaleString("es-SV", { maximumFractionDigits: 2 })}`,
        semaforo: "neutro",
        delta: `${egresos} egresos · $ ${total.toLocaleString("es-SV")} total`,
      };
    }
  } catch {
    result.fin_costo_egreso = null;
  }

  // -- fin_dso (Days Sales Outstanding) -------------------------------------
  // (Cuentas por cobrar / ingresos del periodo) × días del periodo
  try {
    const cxcRows = hasOrgs
      ? await prisma.$queryRaw<DecRow[]>`
          SELECT COALESCE(SUM("totalAmount" - "paidAmount"), 0)::text AS value
          FROM "Invoice"
          WHERE "organizationId" = ANY(${req.organizationIds}::uuid[])
            AND status IN ('ISSUED', 'PARTIALLY_PAID')
        `
      : await prisma.$queryRaw<DecRow[]>`
          SELECT COALESCE(SUM("totalAmount" - "paidAmount"), 0)::text AS value
          FROM "Invoice"
          WHERE status IN ('ISSUED', 'PARTIALLY_PAID')
        `;
    const revRows = hasOrgs
      ? await prisma.$queryRaw<DecRow[]>`
          SELECT COALESCE(SUM("totalAmount"), 0)::text AS value
          FROM "Invoice"
          WHERE "organizationId" = ANY(${req.organizationIds}::uuid[])
            AND "issuedAt" BETWEEN ${desde} AND ${hasta}
            AND status != 'VOIDED'
        `
      : await prisma.$queryRaw<DecRow[]>`
          SELECT COALESCE(SUM("totalAmount"), 0)::text AS value
          FROM "Invoice"
          WHERE "issuedAt" BETWEEN ${desde} AND ${hasta}
            AND status != 'VOIDED'
        `;
    const cxc = toNumber(cxcRows[0]?.value ?? null);
    const revenue = toNumber(revRows[0]?.value ?? null);
    if (revenue === 0) {
      result.fin_dso = null;
    } else {
      const dias = Math.max(1, Math.ceil((hasta.getTime() - desde.getTime()) / 86_400_000));
      const dso = (cxc / revenue) * dias;
      result.fin_dso = {
        display: fmtUnidad(dso, "días", 1),
        semaforo: semaforoMenor(dso, 45, 60),
        delta: `CxC $${cxc.toLocaleString("es-SV")} / ingresos $${revenue.toLocaleString("es-SV")}`,
      };
    }
  } catch {
    result.fin_dso = null;
  }

  // -- fin_rechazo_reclamaciones --------------------------------------------
  try {
    const totalRows = hasOrgs
      ? await prisma.$queryRaw<CountRow[]>`
          SELECT COUNT(*)::bigint AS count
          FROM "InsuranceClaim" ic
          JOIN "Invoice" i ON i.id = ic."invoiceId"
          WHERE i."organizationId" = ANY(${req.organizationIds}::uuid[])
            AND ic."submittedAt" BETWEEN ${desde} AND ${hasta}
        `
      : await prisma.$queryRaw<CountRow[]>`
          SELECT COUNT(*)::bigint AS count
          FROM "InsuranceClaim"
          WHERE "submittedAt" BETWEEN ${desde} AND ${hasta}
        `;
    const rejRows = hasOrgs
      ? await prisma.$queryRaw<CountRow[]>`
          SELECT COUNT(*)::bigint AS count
          FROM "InsuranceClaim" ic
          JOIN "Invoice" i ON i.id = ic."invoiceId"
          WHERE i."organizationId" = ANY(${req.organizationIds}::uuid[])
            AND ic."submittedAt" BETWEEN ${desde} AND ${hasta}
            AND ic.status IN ('REJECTED', 'PARTIALLY_APPROVED')
        `
      : await prisma.$queryRaw<CountRow[]>`
          SELECT COUNT(*)::bigint AS count
          FROM "InsuranceClaim"
          WHERE "submittedAt" BETWEEN ${desde} AND ${hasta}
            AND status IN ('REJECTED', 'PARTIALLY_APPROVED')
        `;
    const total = Number(totalRows[0]?.count ?? 0);
    const rechazadas = Number(rejRows[0]?.count ?? 0);
    if (total === 0) {
      result.fin_rechazo_reclamaciones = null;
    } else {
      const v = (rechazadas / total) * 100;
      result.fin_rechazo_reclamaciones = {
        display: fmtUnidad(v, "%"),
        semaforo: semaforoMenor(v, 5, 10),
        delta: `${rechazadas}/${total} reclamaciones`,
      };
    }
  } catch {
    result.fin_rechazo_reclamaciones = null;
  }

  // -- fin_factura_electronica ----------------------------------------------
  try {
    const totalRows = hasOrgs
      ? await prisma.$queryRaw<CountRow[]>`
          SELECT COUNT(*)::bigint AS count
          FROM "Invoice"
          WHERE "organizationId" = ANY(${req.organizationIds}::uuid[])
            AND "issuedAt" BETWEEN ${desde} AND ${hasta}
            AND "electronicInvoiceStatus" != 'NOT_APPLICABLE'
        `
      : await prisma.$queryRaw<CountRow[]>`
          SELECT COUNT(*)::bigint AS count
          FROM "Invoice"
          WHERE "issuedAt" BETWEEN ${desde} AND ${hasta}
            AND "electronicInvoiceStatus" != 'NOT_APPLICABLE'
        `;
    const okRows = hasOrgs
      ? await prisma.$queryRaw<CountRow[]>`
          SELECT COUNT(*)::bigint AS count
          FROM "Invoice"
          WHERE "organizationId" = ANY(${req.organizationIds}::uuid[])
            AND "issuedAt" BETWEEN ${desde} AND ${hasta}
            AND "electronicInvoiceStatus" = 'ACCEPTED'
        `
      : await prisma.$queryRaw<CountRow[]>`
          SELECT COUNT(*)::bigint AS count
          FROM "Invoice"
          WHERE "issuedAt" BETWEEN ${desde} AND ${hasta}
            AND "electronicInvoiceStatus" = 'ACCEPTED'
        `;
    const total = Number(totalRows[0]?.count ?? 0);
    const aceptadas = Number(okRows[0]?.count ?? 0);
    if (total === 0) {
      result.fin_factura_electronica = null;
    } else {
      const v = (aceptadas / total) * 100;
      result.fin_factura_electronica = {
        display: fmtUnidad(v, "%"),
        semaforo: semaforoMayor(v, 98, 90),
        delta: `${aceptadas}/${total} aceptadas en 1ª transmisión`,
      };
    }
  } catch {
    result.fin_factura_electronica = null;
  }

  // -- fin_margen -----------------------------------------------------------
  // Margen = (ingresos − costos estimados) / ingresos × 100
  // estimatedCost por línea (proxy: 60% del total si no se especifica).
  //
  // NOTA presupuestaria: InvoiceItem.costCenterId es NOT NULL (#128), por lo
  // que el margen se puede agrupar por centro de costo añadiendo
  // `GROUP BY ii."costCenterId"` y serializar como heatmap servicio × org en
  // Capa 2. Wave 4 (visualización drill-down) implementa esa vista detallada.
  try {
    const rows = hasOrgs
      ? await prisma.$queryRaw<{ ingresos: string | null; costos: string | null }[]>`
          SELECT
            COALESCE(SUM(ii."totalPrice"), 0)::text AS ingresos,
            COALESCE(SUM(COALESCE(ii."estimatedCost", ii."totalPrice" * 0.6)), 0)::text AS costos
          FROM "InvoiceItem" ii
          JOIN "Invoice" i ON i.id = ii."invoiceId"
          WHERE i."organizationId" = ANY(${req.organizationIds}::uuid[])
            AND i."issuedAt" BETWEEN ${desde} AND ${hasta}
            AND i.status != 'VOIDED'
        `
      : await prisma.$queryRaw<{ ingresos: string | null; costos: string | null }[]>`
          SELECT
            COALESCE(SUM(ii."totalPrice"), 0)::text AS ingresos,
            COALESCE(SUM(COALESCE(ii."estimatedCost", ii."totalPrice" * 0.6)), 0)::text AS costos
          FROM "InvoiceItem" ii
          JOIN "Invoice" i ON i.id = ii."invoiceId"
          WHERE i."issuedAt" BETWEEN ${desde} AND ${hasta}
            AND i.status != 'VOIDED'
        `;
    const ingresos = toNumber(rows[0]?.ingresos ?? null);
    const costos = toNumber(rows[0]?.costos ?? null);
    if (ingresos === 0) {
      result.fin_margen = null;
    } else {
      const v = ((ingresos - costos) / ingresos) * 100;
      result.fin_margen = {
        display: fmtUnidad(v, "%"),
        semaforo: semaforoMayor(v, 30, 15),
        delta: `Ingresos $${ingresos.toLocaleString("es-SV")} − Costos $${costos.toLocaleString("es-SV")}`,
      };
    }
  } catch {
    result.fin_margen = null;
  }

  // -- fin_costo_his --------------------------------------------------------
  // Wave 6: tabla HisOperatingCost prorrateada por días de overlap con el
  // rango del filtro. Divide entre nº de usuarios distintos con actividad
  // en el mismo periodo (proxy de "usuarios activos del HIS").
  //
  // Costos con organizationId NULL (compartidos) se cuentan completos para
  // cualquier vista; costos asignados a una org específica solo si esa org
  // está en la selección activa.
  try {
    type SumRow = { value: string | null };
    const desdeISO = req.fechaDesde;
    const hastaISO = req.fechaHasta;

    // Prorrateo: amount × (días de overlap / días del periodo del costo).
    const sumRows = hasOrgs
      ? await prisma.$queryRaw<SumRow[]>`
          SELECT COALESCE(SUM(
            amount * GREATEST(0,
              LEAST("periodEnd"::date, ${hastaISO}::date)
              - GREATEST("periodStart"::date, ${desdeISO}::date)
              + 1
            )::numeric / GREATEST(1, ("periodEnd"::date - "periodStart"::date + 1))
          ), 0)::text AS value
          FROM "HisOperatingCost"
          WHERE "periodEnd" >= ${desdeISO}::date
            AND "periodStart" <= ${hastaISO}::date
            AND ("organizationId" IS NULL
                 OR "organizationId" = ANY(${req.organizationIds}::uuid[]))
        `
      : await prisma.$queryRaw<SumRow[]>`
          SELECT COALESCE(SUM(
            amount * GREATEST(0,
              LEAST("periodEnd"::date, ${hastaISO}::date)
              - GREATEST("periodStart"::date, ${desdeISO}::date)
              + 1
            )::numeric / GREATEST(1, ("periodEnd"::date - "periodStart"::date + 1))
          ), 0)::text AS value
          FROM "HisOperatingCost"
          WHERE "periodEnd" >= ${desdeISO}::date
            AND "periodStart" <= ${hastaISO}::date
        `;
    const costoTotal = toNumber(sumRows[0]?.value ?? null);

    // Usuarios activos del periodo
    const usuariosRows = hasOrgs
      ? await prisma.$queryRaw<CountRow[]>`
          SELECT COUNT(DISTINCT "userId")::bigint AS count
          FROM audit."AuditLog"
          WHERE "occurredAt" BETWEEN ${desde} AND ${hasta}
            AND "userId" IS NOT NULL
            AND "organizationId" = ANY(${req.organizationIds}::uuid[])
        `
      : await prisma.$queryRaw<CountRow[]>`
          SELECT COUNT(DISTINCT "userId")::bigint AS count
          FROM audit."AuditLog"
          WHERE "occurredAt" BETWEEN ${desde} AND ${hasta}
            AND "userId" IS NOT NULL
        `;
    const usuariosActivos = Number(usuariosRows[0]?.count ?? 0);

    if (usuariosActivos === 0 || costoTotal === 0) {
      result.fin_costo_his = null;
    } else {
      const costoPorUsuario = costoTotal / usuariosActivos;
      result.fin_costo_his = {
        display: `$ ${costoPorUsuario.toLocaleString("es-SV", { maximumFractionDigits: 2 })}`,
        semaforo: "neutro", // sin meta absoluta; el catálogo pide tendencia descendente
        delta: `$ ${costoTotal.toLocaleString("es-SV")} total · ${usuariosActivos} usuarios activos`,
      };
    }
  } catch {
    result.fin_costo_his = null;
  }

  return result;
}
