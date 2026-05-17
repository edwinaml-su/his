/**
 * Analytics Layout — Wrapper con tabs de navegacion por KPI.
 *
 * Estructura:
 * - Header con titulo y descripcion de la seccion.
 * - Tabs de navegacion: K-CLI-01, K-CLI-02, K-CLI-03, K-FIN-01, K-OPS-01.
 * - Outlet ({children}) para el contenido del KPI activo.
 *
 * A11y: tabs con role="tablist" implicito via nav + aria-current.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, getTenantContext } from "@/lib/auth/session";

const KPI_TABS = [
  { id: "K-CLI-01", label: "Censo camas", href: "/analytics/K-CLI-01" },
  { id: "K-CLI-02", label: "Estancia (LOS)", href: "/analytics/K-CLI-02" },
  { id: "K-CLI-03", label: "Triage SLA", href: "/analytics/K-CLI-03" },
  { id: "K-FIN-01", label: "Revenue", href: "/analytics/K-FIN-01" },
  { id: "K-OPS-01", label: "Transfusiones", href: "/analytics/K-OPS-01" },
] as const;

export default async function AnalyticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const tenant = await getTenantContext();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Analítica</h1>
        <p className="text-sm text-muted-foreground">
          KPIs operacionales y financieros. Datos actualizados cada 1-4 horas.
          {!tenant && (
            <span className="ml-2 font-medium text-amber-600">
              — Sin organización asignada; algunos dashboards pueden estar restringidos.
            </span>
          )}
        </p>
      </div>

      <nav
        aria-label="KPIs disponibles"
        className="flex gap-1 overflow-x-auto border-b pb-0"
      >
        {KPI_TABS.map((tab) => (
          <Link
            key={tab.id}
            href={tab.href}
            className="whitespace-nowrap rounded-t-md border border-b-0 px-4 py-2 text-sm font-medium transition-colors hover:bg-muted aria-[current=page]:bg-background aria-[current=page]:text-foreground"
          >
            <span className="mr-1.5 font-mono text-xs text-muted-foreground">{tab.id}</span>
            {tab.label}
          </Link>
        ))}
      </nav>

      <div>{children}</div>
    </div>
  );
}
