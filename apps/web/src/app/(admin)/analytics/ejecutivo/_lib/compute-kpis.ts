/**
 * Compute KPI sync (mocks/pending) — server actions cubren los "real".
 *
 * Wave 0: todos los KPIs se calculaban en cliente con mock.
 * Wave 1: los 15 KPIs "real" se computan vía server actions (queries Prisma);
 *         este archivo cubre los "mock" y "pending" (placeholders demo).
 */
import type { KpiDefinition } from "./kpi-catalog";
import type { KpiValue } from "../_components/kpi-card";
import { mockValor } from "./mock-values";

export interface ComputeContext {
  organizationIds: string[];
  fechaDesde: Date;
  fechaHasta: Date;
}

export function computeKpiValue(kpi: KpiDefinition, ctx: ComputeContext): KpiValue | null {
  void ctx;
  switch (kpi.dataSource) {
    case "real":
      // Los "real" se sobreescriben con valores async de los server actions;
      // si nadie los sobreescribe, fallback a mock (defensa).
      return mockValor(kpi);
    case "mock":
    case "pending":
      return mockValor(kpi);
    default:
      return null;
  }
}
