"use server";

/**
 * Server action — KPIs Financieros y Ciclo de Ingresos (6 KPIs pending).
 *
 * Status honesto: el HIS actual NO tiene módulo Finance implementado.
 * Tablas como `Invoice`, `Claim`, `Receivable` no existen en el schema.
 * Por tanto, los 6 KPIs financieros caen a null aquí y el componente UI
 * muestra fallback con badge "Pendiente integración".
 *
 * Plan de implementación (sprint dedicado Wave 3+):
 *   - Crear módulo `@his/finance` con tablas Invoice, Claim, Payment, etc.
 *   - Integración con autoridad fiscal SLV (MH e-factura) para
 *     `fin_factura_electronica`.
 *   - Integración con aseguradoras para `fin_dso` y `fin_rechazo_reclamaciones`.
 *   - Módulo de costos (cost center, allocation) para `fin_costo_egreso`
 *     y `fin_margen`.
 *
 * Esta función queda definida con interface compatible para que cuando se
 * implemente el módulo Finance, solo haya que reemplazar los nulls con
 * queries Prisma — sin cambios en página ni componentes.
 */
import type { KpiValue } from "../_components/kpi-card";

export interface ComputeRequest {
  organizationIds: string[];
  fechaDesde: string;
  fechaHasta: string;
}

export type KpiValuesMap = Record<string, KpiValue | null>;

export async function computeFinancieros(req: ComputeRequest): Promise<KpiValuesMap> {
  void req;
  // Los 6 KPIs requieren módulo Finance no implementado. UI muestra fallback.
  return {
    fin_costo_egreso:         null,
    fin_dso:                  null,
    fin_rechazo_reclamaciones:null,
    fin_factura_electronica:  null,
    fin_margen:               null,
    fin_costo_his:            null,
  };
}
