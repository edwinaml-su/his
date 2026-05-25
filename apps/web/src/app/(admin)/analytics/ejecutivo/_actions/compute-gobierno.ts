"use server";

/**
 * Server action — KPIs de Gobierno y Soporte (4 KPIs pending).
 *
 * Estrategia:
 *   - gob_tickets_resolucion : requiere ITSM (Jira, Linear, etc.) — null
 *   - gob_satisfaccion (NPS) : requiere plataforma de encuestas — null
 *   - gob_backlog            : podemos aproximar vía PRs cerrados en GitHub
 *                              (requiere token + integración) — null por ahora
 *   - gob_cambios_estandar   : podemos aproximar vía análisis de commits
 *                              tags (feat/* vs custom/*) — null por ahora
 *
 * Plan Wave 3+:
 *   - Integrar GitHub API para gob_backlog y gob_cambios_estandar.
 *   - Integrar Linear/Jira para tickets.
 *   - Implementar módulo encuestas para NPS/CSAT.
 *
 * UI muestra badge "Pendiente integración" gracias a dataSource del catálogo.
 */
import type { KpiValue } from "../_components/kpi-card";

export interface ComputeRequest {
  organizationIds: string[];
  fechaDesde: string;
  fechaHasta: string;
}

export type KpiValuesMap = Record<string, KpiValue | null>;

export async function computeGobierno(req: ComputeRequest): Promise<KpiValuesMap> {
  void req;
  return {
    gob_tickets_resolucion: null,
    gob_satisfaccion:       null,
    gob_backlog:            null,
    gob_cambios_estandar:   null,
  };
}
