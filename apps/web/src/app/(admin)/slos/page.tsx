/**
 * Dashboard SLOs — `/slos`
 *
 * Vista admin que muestra los Service Level Objectives del HIS:
 *  - Disponibilidad, latencias, error rate (técnicos)
 *  - Override triage, tiempo admisión (clínicos)
 *  - RPO/RTO (continuidad)
 *
 * MVP: valores mock desde slo-checks.ts.
 * Sprint 6: integración real con Vercel Analytics + Sentry API.
 *
 * Documentación de cada SLO: docs/13_slos_kpis.md
 */
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import {
  getAllSloMeasurements,
  type SloMeasurement,
} from "@/lib/observability/slo-checks";
import { SloCard } from "./slo-card";

export const dynamic = "force-dynamic";

function summarize(measurements: SloMeasurement[]) {
  return {
    total: measurements.length,
    healthy: measurements.filter((m) => m.status === "healthy").length,
    warning: measurements.filter((m) => m.status === "warning").length,
    breached: measurements.filter((m) => m.status === "breached").length,
  };
}

export default function SlosPage() {
  const measurements = getAllSloMeasurements();
  const summary = summarize(measurements);
  const technical = measurements.filter((m) => m.category === "technical");
  const clinical = measurements.filter((m) => m.category === "clinical");

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">SLOs del sistema</h1>
            <p className="text-sm text-muted-foreground">
              Service Level Objectives operacionales y clínicos. Ventana 28d. Datos en MVP
              son MOCK; ver{" "}
              <code className="rounded bg-muted px-1 text-xs">docs/13_slos_kpis.md</code>.
            </p>
          </div>
          <div className="flex gap-2 text-xs">
            <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-emerald-700 dark:text-emerald-400">
              {summary.healthy} saludables
            </span>
            <span className="rounded-full bg-amber-500/10 px-3 py-1 text-amber-700 dark:text-amber-400">
              {summary.warning} en riesgo
            </span>
            <span className="rounded-full bg-red-500/10 px-3 py-1 text-red-700 dark:text-red-400">
              {summary.breached} incumplidos
            </span>
          </div>
        </div>
      </header>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">SLOs técnicos</h2>
          <span className="text-xs text-muted-foreground">
            Infraestructura, performance y continuidad
          </span>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {technical.map((m) => (
            <SloCard key={m.id} measurement={m} />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">SLOs clínicos (KPIs)</h2>
          <span className="text-xs text-muted-foreground">
            Procesos médicos críticos para la operación
          </span>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {clinical.map((m) => (
            <SloCard key={m.id} measurement={m} />
          ))}
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notas operativas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            <strong className="text-foreground">Disponibilidad MVP en 99.5%</strong> — push-back
            declarado al TDR §29.2 (que pedía 99.9%) hasta tener observabilidad madura,
            runbooks probados y al menos un postmortem real (Fase 7, ver `docs/08_devops.md`).
          </p>
          <p>
            <strong className="text-foreground">Endpoint Prometheus:</strong>{" "}
            <code className="rounded bg-muted px-1">/api/metrics</code> expone uptime y
            latencias en formato text/plain (stub MVP).
          </p>
          <p>
            <strong className="text-foreground">TODO Sprint 6:</strong> reemplazar mocks con
            integración real Vercel Analytics + Sentry + Supabase metrics. Ver
            `slo-checks.ts`.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
