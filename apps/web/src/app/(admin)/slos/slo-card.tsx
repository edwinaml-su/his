/**
 * SloCard — visualización de un SLO en formato tarjeta.
 *
 * Diseño: compatible con Design System (`@his/ui` Card primitives).
 * Estados: healthy (verde), warning (amarillo), breached (rojo).
 * Muestra: target, valor actual, % error budget consumido, ventana, fuente.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { type SloMeasurement, formatSloValue } from "@/lib/observability/slo-checks";

const STATUS_STYLES: Record<
  SloMeasurement["status"],
  { dot: string; bar: string; text: string; label: string }
> = {
  healthy: {
    dot: "bg-emerald-500",
    bar: "bg-emerald-500",
    text: "text-emerald-700 dark:text-emerald-400",
    label: "Saludable",
  },
  warning: {
    dot: "bg-amber-500",
    bar: "bg-amber-500",
    text: "text-amber-700 dark:text-amber-400",
    label: "En riesgo",
  },
  breached: {
    dot: "bg-red-500",
    bar: "bg-red-500",
    text: "text-red-700 dark:text-red-400",
    label: "Incumplido",
  },
};

const SOURCE_LABEL: Record<SloMeasurement["source"], string> = {
  mock: "MOCK (MVP)",
  vercel: "Vercel Analytics",
  sentry: "Sentry API",
  supabase: "Supabase metrics",
  composite: "Compuesto",
};

function formatTarget(m: SloMeasurement): string {
  const op = m.direction === "higher_better" ? "≥" : "≤";
  return `${op} ${formatSloValue({ value: m.target, unit: m.unit })}`;
}

export function SloCard({ measurement }: { measurement: SloMeasurement }) {
  const styles = STATUS_STYLES[measurement.status];
  const budgetClamped = Math.min(100, Math.max(0, measurement.errorBudgetConsumedPct));

  return (
    <Card data-slo-id={measurement.id} className="flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base leading-tight">{measurement.name}</CardTitle>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs font-medium ${styles.text}`}
            aria-label={`Estado: ${styles.label}`}
          >
            <span
              className={`inline-block h-2 w-2 rounded-full ${styles.dot}`}
              aria-hidden="true"
            />
            {styles.label}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{measurement.sliDefinition}</p>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-between gap-3 pt-0 text-sm">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-2xl font-semibold tabular-nums">
            {formatSloValue(measurement)}
          </span>
          <span className="text-xs text-muted-foreground">
            objetivo {formatTarget(measurement)}
          </span>
        </div>

        <div>
          <div className="mb-1 flex justify-between text-xs text-muted-foreground">
            <span>Error budget consumido</span>
            <span className="tabular-nums">
              {measurement.errorBudgetConsumedPct.toFixed(1)}%
            </span>
          </div>
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={Math.round(budgetClamped)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={`h-full ${styles.bar} transition-all`}
              style={{ width: `${budgetClamped}%` }}
            />
          </div>
        </div>

        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Ventana: {measurement.windowDays}d</span>
          <span>
            Alerta {measurement.direction === "higher_better" ? "≤" : "≥"}{" "}
            {formatSloValue({ value: measurement.alertThreshold, unit: measurement.unit })}
          </span>
        </div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Fuente: {SOURCE_LABEL[measurement.source]}
        </div>
      </CardContent>
    </Card>
  );
}
