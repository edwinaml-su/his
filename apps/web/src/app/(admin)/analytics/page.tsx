/**
 * Analytics Overview — Grid con los 5 KPIs en tarjetas resumidas.
 *
 * Cada tarjeta muestra: ID del KPI, nombre, descripcion corta y
 * enlace al detalle. No embebe iframes aqui (rendimiento: solo se
 * cargan en la pagina de detalle /analytics/[kpi]).
 */

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";

const KPI_CARDS = [
  {
    id: "K-CLI-01",
    name: "Censo de camas",
    description:
      "Porcentaje de ocupacion de camas INPATIENT activas por servicio. Refresh: 1 h.",
    category: "Clinico",
    href: "/analytics/K-CLI-01",
  },
  {
    id: "K-CLI-02",
    name: "Length of Stay (LOS)",
    description:
      "Promedio y mediana de dias de estancia por tipo de admision en los ultimos 30 dias.",
    category: "Clinico",
    href: "/analytics/K-CLI-02",
  },
  {
    id: "K-CLI-03",
    name: "Triage SLA",
    description:
      "Porcentaje de pacientes P1 (<10 min) y P2 (<30 min) atendidos dentro del tiempo objetivo.",
    category: "Clinico",
    href: "/analytics/K-CLI-03",
  },
  {
    id: "K-FIN-01",
    name: "Revenue mensual",
    description:
      "Revenue neto por libro contable (FISCAL_SV / MANAGEMENT) y tipo de documento. Refresh: 4 h.",
    category: "Financiero",
    href: "/analytics/K-FIN-01",
  },
  {
    id: "K-OPS-01",
    name: "Reacciones transfusionales",
    description:
      "Tasa de transfusiones con reaccion adversa. Umbral MINSAL: > 0.5 % requiere notificacion.",
    category: "Operacional",
    href: "/analytics/K-OPS-01",
  },
] as const;

const CATEGORY_BADGE: Record<string, string> = {
  Clinico: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  Financiero: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  Operacional: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
};

export default function AnalyticsOverviewPage() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Selecciona un KPI para ver el dashboard detallado. Los datos provienen de la capa
        semantica Cube.dev sobre el schema analytics de Supabase.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {KPI_CARDS.map((kpi) => (
          <Link key={kpi.id} href={kpi.href} className="block focus:outline-none focus:ring-2 focus:ring-ring rounded-lg">
            <Card className="h-full transition-shadow hover:shadow-md">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{kpi.name}</CardTitle>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${CATEGORY_BADGE[kpi.category] ?? ""}`}
                  >
                    {kpi.category}
                  </span>
                </div>
                <p className="font-mono text-xs text-muted-foreground">{kpi.id}</p>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {kpi.description}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
