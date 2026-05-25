"use server";

/**
 * Server action — KPIs Gobierno y Soporte (4 KPIs).
 *
 * Wave 4: 2/4 KPIs cableados con proxies sobre BD (sin integraciones externas).
 *   - gob_tickets_resolucion : tiempo promedio occurredAt → publishedAt en
 *     DomainEvent (proxy: el outbox actúa como "sistema de tickets" interno;
 *     cada evento sin publicar es un "ticket abierto").
 *   - gob_backlog            : migrations aplicadas en periodo como proxy de
 *     "entregas cumplidas" del backlog técnico.
 *
 * Quedan null:
 *   - gob_satisfaccion (NPS/CSAT): requiere plataforma de encuestas.
 *   - gob_cambios_estandar: requiere GitHub API (commit conventional tags)
 *     que el server runtime no tiene cableado todavía.
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
type AvgRow = { avg_seconds: number | string | null };

export async function computeGobierno(req: ComputeRequest): Promise<KpiValuesMap> {
  const result: KpiValuesMap = {};
  const desde = new Date(req.fechaDesde);
  const hasta = new Date(req.fechaHasta);
  const hasOrgs = req.organizationIds.length > 0;

  // -- gob_tickets_resolucion ----------------------------------------------
  // Proxy: tiempo medio entre occurredAt y publishedAt para DomainEvents
  // exitosamente despachados en el periodo. El outbox actúa como sistema
  // de soporte interno — más rápido se publica, mejor "SLA de resolución".
  try {
    const rows = hasOrgs
      ? await prisma.$queryRaw<AvgRow[]>`
          SELECT EXTRACT(EPOCH FROM AVG("publishedAt" - "occurredAt"))::float AS avg_seconds
          FROM public."DomainEvent"
          WHERE "organizationId" = ANY(${req.organizationIds}::uuid[])
            AND "occurredAt" BETWEEN ${desde} AND ${hasta}
            AND "publishedAt" IS NOT NULL
        `
      : await prisma.$queryRaw<AvgRow[]>`
          SELECT EXTRACT(EPOCH FROM AVG("publishedAt" - "occurredAt"))::float AS avg_seconds
          FROM public."DomainEvent"
          WHERE "occurredAt" BETWEEN ${desde} AND ${hasta}
            AND "publishedAt" IS NOT NULL
        `;
    const avgSeconds = rows[0]?.avg_seconds == null
      ? null
      : Number(rows[0].avg_seconds);
    if (avgSeconds == null) {
      result.gob_tickets_resolucion = null;
    } else {
      const horas = avgSeconds / 3600;
      // Meta del catálogo: S1 ≤ 4h, S2 ≤ 12h, S3 ≤ 48h.
      // Como mezclamos todas las severidades en el proxy, usamos S2 ≤ 12h.
      result.gob_tickets_resolucion = {
        display: fmtUnidad(horas, "horas", 2),
        semaforo: semaforoMenor(horas, 12, 48),
        delta: "Proxy: DomainEvent publish latency",
      };
    }
  } catch {
    result.gob_tickets_resolucion = null;
  }

  // -- gob_backlog ---------------------------------------------------------
  // Proxy: migrations aplicadas en el periodo. Cada migration aplicada
  // exitosamente = 1 entrega cumplida del backlog técnico. Comparamos
  // contra un baseline esperado (10 mensual ≈ 0.33 diario para sprint sano).
  try {
    const rows = await prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::bigint AS count
      FROM public._prisma_migrations
      WHERE finished_at BETWEEN ${desde} AND ${hasta}
    `;
    const entregadas = Number(rows[0]?.count ?? 0);
    const dias = Math.max(1, Math.ceil((hasta.getTime() - desde.getTime()) / 86_400_000));
    const ritmoMensual = (entregadas / dias) * 30;
    // Meta: ≥ 10 entregas/mes; crítico < 3/mes.
    result.gob_backlog = {
      display: `${entregadas} entregas`,
      semaforo: semaforoMayor(ritmoMensual, 10, 3),
      delta: `~${ritmoMensual.toFixed(1)} entregas/mes proyectado`,
    };
  } catch {
    result.gob_backlog = null;
  }

  // -- gob_satisfaccion (NPS / CSAT) ---------------------------------------
  // Requiere plataforma de encuestas integrada al HIS. No hay tabla.
  result.gob_satisfaccion = null;

  // -- gob_cambios_estandar ------------------------------------------------
  // Requiere análisis de commits (conventional commit tags feat vs chore).
  // Vercel serverless no tiene .git accesible. Sprint dedicado integra
  // GitHub API con token para clasificar PRs cerrados.
  result.gob_cambios_estandar = null;

  return result;
}
