"use server";

/**
 * Server action — calcula los 3 KPIs reales de Seguridad y Cumplimiento.
 *
 * KPIs:
 *   - seg_incidentes             Proxy: usuarios distintos que activaron BREAK_GLASS en periodo.
 *   - seg_accesos_no_autorizados Proxy: total eventos BREAK_GLASS en periodo (fuerza de acceso
 *                                restringido). No existe enum "unauthorized_access" en AuditAction.
 *   - seg_mfa                   (usuarios activos con mfaEnabled / total activos) × 100.
 *
 * Proxies documentados porque AuditAction no tiene UNAUTHORIZED_ACCESS/FORBIDDEN —
 * el modelo de datos registra BREAK_GLASS como el único evento de acceso forzado
 * a registros restringidos (TDR §6.3). Un sprint dedicado puede añadir
 * AuditAction.UNAUTHORIZED si se integra SIEM/WAF.
 */
import { prisma } from "@his/database";
import type { KpiValue } from "../_components/kpi-card";
import { fmtUnidad, semaforoMayor, semaforoMenor } from "../_lib/mock-values";

export interface ComputeRequest {
  organizationIds: string[];
  fechaDesde: string; // ISO yyyy-mm-dd
  fechaHasta: string;
}

export type KpiValuesMap = Record<string, KpiValue | null>;

export async function computeSeguridad(req: ComputeRequest): Promise<KpiValuesMap> {
  const result: KpiValuesMap = {};
  const desde = new Date(req.fechaDesde);
  const hasta = new Date(req.fechaHasta);

  const orgFilter =
    req.organizationIds.length > 0
      ? { organizationId: { in: req.organizationIds } }
      : {};

  // -- seg_incidentes -------------------------------------------------------
  // Usuarios distintos que activaron BREAK_GLASS en el periodo.
  // Proxy más conservador: cada usuario único = un "incidente" tratable.
  try {
    const grupos = await prisma.auditLog.groupBy({
      by: ["userId"],
      where: {
        action: "BREAK_GLASS",
        occurredAt: { gte: desde, lte: hasta },
        userId: { not: null },
        ...orgFilter,
      },
    });
    const v = grupos.length;
    result.seg_incidentes = {
      display: `${v}`,
      semaforo: semaforoMenor(v, 0, 3),
      delta: `${v} usuarios con acceso forzado`,
    };
  } catch {
    result.seg_incidentes = null;
  }

  // -- seg_accesos_no_autorizados -------------------------------------------
  // Total de eventos BREAK_GLASS en el periodo (cada acceso forzado = 1 evento).
  // Un mismo usuario puede activar varios, aquí contamos cada uno.
  try {
    const v = await prisma.auditLog.count({
      where: {
        action: "BREAK_GLASS",
        occurredAt: { gte: desde, lte: hasta },
        ...orgFilter,
      },
    });
    result.seg_accesos_no_autorizados = {
      display: `${v}`,
      // Todo evento requiere investigación; cualquier número > 0 es ambar; >5 es rojo.
      semaforo: v === 0 ? "verde" : v <= 5 ? "ambar" : "rojo",
      delta: `${v} eventos BREAK_GLASS auditados`,
    };
  } catch {
    result.seg_accesos_no_autorizados = null;
  }

  // -- seg_mfa --------------------------------------------------------------
  // (usuarios activos con mfaEnabled / total activos en las orgs) × 100.
  // Si organizationIds no está vacío, filtramos usuarios vía UserOrganizationRole.
  try {
    let totalActivos: number;
    let conMfa: number;

    if (req.organizationIds.length > 0) {
      // Usuarios que tienen rol activo en alguna de las orgs seleccionadas.
      const userIdsEnOrg = await prisma.userOrganizationRole.findMany({
        where: {
          organizationId: { in: req.organizationIds },
          OR: [{ validTo: null }, { validTo: { gt: new Date() } }],
        },
        select: { userId: true },
        distinct: ["userId"],
      });
      const ids = userIdsEnOrg.map((r) => r.userId);
      [totalActivos, conMfa] = await Promise.all([
        prisma.user.count({ where: { id: { in: ids }, active: true } }),
        prisma.user.count({ where: { id: { in: ids }, active: true, mfaEnabled: true } }),
      ]);
    } else {
      [totalActivos, conMfa] = await Promise.all([
        prisma.user.count({ where: { active: true } }),
        prisma.user.count({ where: { active: true, mfaEnabled: true } }),
      ]);
    }

    const v = totalActivos > 0 ? (conMfa / totalActivos) * 100 : 0;
    result.seg_mfa = {
      display: fmtUnidad(v, "%"),
      semaforo: semaforoMayor(v, 95, 80),
      delta: `${conMfa}/${totalActivos} usuarios`,
    };
  } catch {
    result.seg_mfa = null;
  }

  return result;
}
