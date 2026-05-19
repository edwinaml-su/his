/**
 * /audit/stat-events — Dashboard mensual eventos STAT para DIR (US.F2.6.47)
 *
 * Permite filtrar por mes/año y ver agregados por motivo + drill-down de eventos.
 * El orgId se resuelve server-side (cookie his.org) y se pasa al client.
 */

import type { Metadata } from "next";
import { getTenantContext } from "@/lib/auth/session";
import { StatEventsDashboardClient } from "./_components/stat-events-dashboard-client";

export const metadata: Metadata = {
  title: "Eventos STAT | Auditoría — HIS Avante",
};

export default async function StatEventsPage() {
  const tenant = await getTenantContext();
  const orgId = tenant?.organizationId ?? "";

  return (
    <main className="container mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Eventos STAT</h1>
        <p className="mt-1 text-sm text-gray-500">
          Reporte mensual de administraciones de emergencia con bypass justificado.
          Solo visible para Director Médico (DIR).
        </p>
      </div>
      <StatEventsDashboardClient orgId={orgId} />
    </main>
  );
}
