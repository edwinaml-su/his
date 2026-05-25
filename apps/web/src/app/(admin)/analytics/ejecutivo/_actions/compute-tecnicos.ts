"use server";

/**
 * Server action — KPIs Técnicos y Operativos (5 KPIs pending Wave 0).
 *
 * Estrategia honesta:
 *   - Uptime y MTBF se calculan vía `audit_log` action=SYSTEM_ERROR como
 *     proxy de fallas (no hay APM externo todavía).
 *   - Response time queda null hasta integrar Vercel Speed Insights.
 *   - SLA y capacidad quedan null hasta ITSM + monitoring infra externo.
 *
 * Cuando se integre Datadog/New Relic/Vercel APM, reemplazar los nulls
 * por las queries respectivas — la firma del componente KpiCard no cambia.
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

export async function computeTecnicos(req: ComputeRequest): Promise<KpiValuesMap> {
  const result: KpiValuesMap = {};
  const desde = new Date(req.fechaDesde);
  const hasta = new Date(req.fechaHasta);

  // -- tec_uptime ----------------------------------------------------------
  // Proxy: % de horas en el periodo SIN errores SYSTEM_ERROR registrados.
  // Suposición conservadora: si hay ≥1 error en una hora, esa hora "no estuvo
  // disponible" (worst-case). Sin APM externo es lo más honesto.
  try {
    type ErrHora = { hora: Date };
    const errores = await prisma.$queryRaw<ErrHora[]>`
      SELECT DISTINCT date_trunc('hour', "occurredAt") AS hora
      FROM audit."AuditLog"
      WHERE action = 'SYSTEM_ERROR'
        AND "occurredAt" BETWEEN ${desde} AND ${hasta}
    `;
    const horasTotales = Math.max(
      1,
      Math.ceil((hasta.getTime() - desde.getTime()) / 3_600_000),
    );
    const horasCaidas = errores.length;
    const pct = ((horasTotales - horasCaidas) / horasTotales) * 100;
    result.tec_uptime = {
      display: fmtUnidad(pct, "%", 2),
      semaforo: semaforoMayor(pct, 99.5, 98),
      delta: `${horasCaidas} horas con incidentes / ${horasTotales} totales`,
    };
  } catch {
    result.tec_uptime = null;
  }

  // -- tec_response_time ---------------------------------------------------
  // Requiere Vercel Speed Insights / APM externo. No hay datos en BD.
  result.tec_response_time = null;

  // -- tec_mtbf_mttr -------------------------------------------------------
  // Proxy MTBF: tiempo promedio entre eventos SYSTEM_ERROR.
  try {
    const errores = await prisma.$queryRaw<{ ts: Date }[]>`
      SELECT "occurredAt" AS ts
      FROM audit."AuditLog"
      WHERE action = 'SYSTEM_ERROR'
        AND "occurredAt" BETWEEN ${desde} AND ${hasta}
      ORDER BY "occurredAt" ASC
    `;
    if (errores.length < 2) {
      // Sin suficientes eventos para calcular MTBF; reportamos uptime perfecto.
      const horasTotales = Math.ceil((hasta.getTime() - desde.getTime()) / 3_600_000);
      result.tec_mtbf_mttr = {
        display: `MTBF: ${horasTotales}h`,
        semaforo: "verde",
        delta: errores.length === 0 ? "Sin incidentes en periodo" : "1 incidente",
      };
    } else {
      let sumaIntervalos = 0;
      for (let i = 1; i < errores.length; i++) {
        sumaIntervalos += errores[i]!.ts.getTime() - errores[i - 1]!.ts.getTime();
      }
      const mtbfHoras = sumaIntervalos / (errores.length - 1) / 3_600_000;
      result.tec_mtbf_mttr = {
        display: `MTBF: ${mtbfHoras.toFixed(1)}h`,
        semaforo: semaforoMayor(mtbfHoras, 720, 168),
        delta: `${errores.length} eventos SYSTEM_ERROR`,
      };
    }
  } catch {
    result.tec_mtbf_mttr = null;
  }

  // -- tec_sla_compliance --------------------------------------------------
  // Requiere ITSM con clasificación SLA. No existe. Null hasta integración.
  result.tec_sla_compliance = null;

  // -- tec_capacity_usage --------------------------------------------------
  // Proxy: % de transacciones procesadas vs umbral conservador (10k/día).
  // No es uso de CPU/RAM real (eso requiere monitoring infra externo).
  try {
    const totalTx = await prisma.auditLog.count({
      where: { occurredAt: { gte: desde, lte: hasta } },
    });
    const dias = Math.max(1, Math.ceil((hasta.getTime() - desde.getTime()) / 86_400_000));
    const txDia = totalTx / dias;
    const umbralDiario = 10_000;
    const pct = (txDia / umbralDiario) * 100;
    result.tec_capacity_usage = {
      display: fmtUnidad(pct, "%"),
      semaforo: semaforoMenor(pct, 75, 85),
      delta: `${txDia.toFixed(0)} tx/día (umbral ${umbralDiario})`,
    };
  } catch {
    result.tec_capacity_usage = null;
  }

  return result;
}
