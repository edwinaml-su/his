"use server";

/**
 * Server action — calcula los 4 KPIs reales de Adopción y Uso.
 *
 * KPIs en esta categoría:
 *   - adp_usuarios_activos          (% usuarios licenciados con ≥1 tx en periodo)
 *   - adp_tx_por_usuario            (transacciones totales / usuarios activos)
 *   - adp_modulos_clave             (% módulos clave usados / disponibles)
 *   - adp_procesos_digitalizados    (% procesos en HIS / total procesos)
 *
 * Cada KPI se computa contra Prisma. Si el query falla individualmente,
 * retornamos null para ese KPI y los demás siguen.
 */
import { prisma } from "@his/database";
import type { KpiValue } from "../_components/kpi-card";
import { fmtUnidad, semaforoMayor } from "../_lib/mock-values";

export interface ComputeRequest {
  organizationIds: string[];
  fechaDesde: string; // ISO yyyy-mm-dd
  fechaHasta: string;
}

export type KpiValuesMap = Record<string, KpiValue | null>;


export async function computeAdopcion(req: ComputeRequest): Promise<KpiValuesMap> {
  const result: KpiValuesMap = {};
  const desde = new Date(req.fechaDesde);
  const hasta = new Date(req.fechaHasta);
  const orgFilter =
    req.organizationIds.length > 0
      ? { organizationId: { in: req.organizationIds } }
      : {};

  // -- adp_usuarios_activos -------------------------------------------------
  // Usuarios con ≥1 entrada en audit_log en el periodo / total activos licenciados.
  try {
    const [totalActivos, usuariosConAudit] = await Promise.all([
      prisma.user.count({ where: { active: true } }),
      prisma.auditLog.groupBy({
        by: ["userId"],
        where: {
          occurredAt: { gte: desde, lte: hasta },
          userId: { not: null },
          ...(req.organizationIds.length > 0
            ? { organizationId: { in: req.organizationIds } }
            : {}),
        },
      }),
    ]);

    const activos = usuariosConAudit.length;
    const pct = totalActivos > 0 ? (activos / totalActivos) * 100 : 0;

    result.adp_usuarios_activos = {
      display: fmtUnidad(pct, "%"),
      semaforo: semaforoMayor(pct, 85, 75),
      delta: `${activos} de ${totalActivos} usuarios`,
    };
  } catch {
    result.adp_usuarios_activos = null;
  }

  // -- adp_tx_por_usuario ---------------------------------------------------
  // Total filas audit_log en periodo / nº usuarios distintos con actividad.
  try {
    const [totalTx, usuariosConAudit] = await Promise.all([
      prisma.auditLog.count({
        where: {
          occurredAt: { gte: desde, lte: hasta },
          ...(req.organizationIds.length > 0
            ? { organizationId: { in: req.organizationIds } }
            : {}),
        },
      }),
      prisma.auditLog.groupBy({
        by: ["userId"],
        where: {
          occurredAt: { gte: desde, lte: hasta },
          userId: { not: null },
          ...(req.organizationIds.length > 0
            ? { organizationId: { in: req.organizationIds } }
            : {}),
        },
      }),
    ]);

    const numUsuarios = usuariosConAudit.length;
    const ratio = numUsuarios > 0 ? totalTx / numUsuarios : 0;

    result.adp_tx_por_usuario = {
      display: fmtUnidad(ratio, "tx/usuario"),
      // Sin meta fija — semáforo neutro; valores bajos (< 5) son ambar.
      semaforo: ratio >= 20 ? "verde" : ratio >= 5 ? "ambar" : "rojo",
      delta: `${totalTx.toLocaleString("es-SV")} tx totales`,
    };
  } catch {
    result.adp_tx_por_usuario = null;
  }

  // -- adp_modulos_clave ----------------------------------------------------
  // Por cada módulo clave, ¿hubo ≥1 registro en el periodo?
  // (activos / total) × 100.
  // findFirst es más barato que count cuando solo necesitamos saber si existe ≥1.
  try {
    const orgWhere =
      req.organizationIds.length > 0
        ? { organizationId: { in: req.organizationIds } }
        : {};
    const dateRange = { gte: desde, lte: hasta };

    const [rx, med, lab, img, triage] = await Promise.all([
      prisma.prescription.findFirst({
        where: { prescribedAt: dateRange, ...orgWhere },
        select: { id: true },
      }),
      prisma.medicationAdministration.findFirst({
        where: { administeredAt: dateRange, ...orgWhere },
        select: { id: true },
      }),
      prisma.labOrder.findFirst({
        where: { orderedAt: dateRange, ...orgWhere },
        select: { id: true },
      }),
      prisma.imagingOrder.findFirst({
        where: { orderedAt: dateRange, ...orgWhere },
        select: { id: true },
      }),
      prisma.triageEvaluation.findFirst({
        where: { startedAt: dateRange, ...orgWhere },
        select: { id: true },
      }),
    ]);

    const activos = [rx, med, lab, img, triage].filter((r) => r !== null).length;
    const total = 5;
    const pct = (activos / total) * 100;

    result.adp_modulos_clave = {
      display: fmtUnidad(pct, "%"),
      semaforo: semaforoMayor(pct, 90, 80),
      delta: `${activos}/${total} módulos con actividad`,
    };
  } catch {
    result.adp_modulos_clave = null;
  }

  // -- adp_procesos_digitalizados -------------------------------------------
  // Count de documentos ECE creados en periodo (firmados/validados/certificados
  // o cualquier estado es_final=true). No existe tabla "papel" — el sistema
  // es 100% digital por diseño; usamos como numerador los documentos en estado
  // final y como denominador el total creado. Si no hay instancias, devolvemos
  // null para que el UI caiga al mock.
  try {
    const [total, finalizados] = await Promise.all([
      prisma.eceDocumentoInstancia.count({
        where: {
          creadoEn: { gte: desde, lte: hasta },
        },
      }),
      prisma.eceDocumentoInstancia.count({
        where: {
          creadoEn: { gte: desde, lte: hasta },
          estadoActual: { esFinal: true },
        },
      }),
    ]);

    if (total === 0) {
      result.adp_procesos_digitalizados = null;
    } else {
      const pct = (finalizados / total) * 100;
      result.adp_procesos_digitalizados = {
        display: fmtUnidad(pct, "%"),
        semaforo: semaforoMayor(pct, 95, 85),
        delta: `${finalizados} de ${total} documentos finalizados`,
      };
    }
  } catch {
    result.adp_procesos_digitalizados = null;
  }

  return result;
}
