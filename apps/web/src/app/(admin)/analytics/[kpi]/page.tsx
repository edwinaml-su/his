/**
 * Analytics KPI Detail — Pagina de detalle con iframe Metabase por KPI.
 *
 * Ruta: /analytics/[kpi] donde kpi es uno de K-CLI-01, K-CLI-02, etc.
 * Valida el kpi en el servidor antes de renderizar el componente cliente.
 */

import { notFound } from "next/navigation";
import { MetabaseEmbed } from "../_components/MetabaseEmbed";
import type { KpiId } from "../_actions/metabase-jwt";

// Metadata descriptiva por KPI.
const KPI_META: Record<
  KpiId,
  { title: string; description: string; embedTitle: string }
> = {
  "K-CLI-01": {
    title: "Censo de camas en tiempo real",
    description:
      "Ocupacion actual de camas INPATIENT por servicio. Fuente: fact_encounter. Refresh: 1 hora.",
    embedTitle: "Dashboard K-CLI-01 — Censo de camas",
  },
  "K-CLI-02": {
    title: "Length of Stay (LOS) — Estancia promedio",
    description:
      "Promedio y mediana de dias de estancia por tipo de admision en los ultimos 30 dias. " +
      "Requerido por reporte MINSAL RNSS.",
    embedTitle: "Dashboard K-CLI-02 — LOS por servicio",
  },
  "K-CLI-03": {
    title: "Triage P1/P2 — Cumplimiento SLA",
    description:
      "Porcentaje de pacientes triaje rojo (P1, <10 min) y naranja (P2, <30 min) " +
      "atendidos en tiempo. Estandar Manchester.",
    embedTitle: "Dashboard K-CLI-03 — Triage SLA",
  },
  "K-FIN-01": {
    title: "Revenue mensual por libro contable",
    description:
      "Revenue neto por ledger_kind (FISCAL_SV / MANAGEMENT) y tipo de documento. " +
      "Refresh: 4 horas. Acceso restringido a roles financieros.",
    embedTitle: "Dashboard K-FIN-01 — Revenue mensual",
  },
  "K-OPS-01": {
    title: "Tasa de reacciones transfusionales",
    description:
      "Porcentaje de unidades transfundidas con reaccion adversa registrada. " +
      "Umbral MINSAL/PAHO: > 0.5 % requiere notificacion a hemovigilancia.",
    embedTitle: "Dashboard K-OPS-01 — Hemovigilancia",
  },
};

const VALID_KPI_IDS = new Set<KpiId>([
  "K-CLI-01",
  "K-CLI-02",
  "K-CLI-03",
  "K-FIN-01",
  "K-OPS-01",
]);

function isValidKpiId(value: string): value is KpiId {
  return VALID_KPI_IDS.has(value as KpiId);
}

interface KpiPageProps {
  params: { kpi: string };
}

export default function KpiDetailPage({ params }: KpiPageProps) {
  const { kpi } = params;

  if (!isValidKpiId(kpi)) {
    notFound();
  }

  const meta = KPI_META[kpi];

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-baseline gap-2">
          <h2 className="text-lg font-semibold">{meta.title}</h2>
          <span className="font-mono text-xs text-muted-foreground">{kpi}</span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{meta.description}</p>
      </div>

      <MetabaseEmbed kpiId={kpi} title={meta.embedTitle} height={620} />
    </div>
  );
}

// Genera los parametros estaticos para los 5 KPIs conocidos.
// Permite pre-rendering en build (SSG) si los datos no son dinamicos.
export function generateStaticParams() {
  return (Array.from(VALID_KPI_IDS) as KpiId[]).map((kpi) => ({ kpi }));
}
