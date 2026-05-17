"use client";

/**
 * NrpTimeline — timeline visual de pasos NRP completados.
 * Cada paso muestra su timestamp relativo a apertura_en.
 * Pasos sin timestamp aparecen en gris (sin registrar).
 */
import * as React from "react";
import { CheckCircle2, Circle } from "lucide-react";
import { Badge } from "@his/ui/components/badge";
import type { ReanimacionNeonatalRow } from "@his/trpc/src/routers/ece/reanimacion-neonatal.router";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface TimelineStep {
  key: string;
  label: string;
  ts: Date | null | undefined;
  detail?: string | null;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface NrpTimelineProps {
  record: ReanimacionNeonatalRow;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const timeFmt = new Intl.DateTimeFormat("es-SV", { timeStyle: "medium" });

function diffMin(start: Date, end: Date): string {
  const diff = Math.round((end.getTime() - start.getTime()) / 60000);
  if (diff < 1) return "<1 min";
  return `+${diff} min`;
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function NrpTimeline({ record }: NrpTimelineProps) {
  const inicio = new Date(record.apertura_en);

  const steps: TimelineStep[] = [
    {
      key: "estimulacion_tactil",
      label: "Estimulación táctil",
      ts: record.estimulacion_tactil_en ? new Date(record.estimulacion_tactil_en) : null,
      detail: record.estimulacion_tactil_nota,
    },
    {
      key: "vpp",
      label: "VPP iniciada",
      ts: record.vpp_iniciada_en ? new Date(record.vpp_iniciada_en) : null,
      detail: [
        record.vpp_presion_cmh2o ? `${record.vpp_presion_cmh2o} cmH₂O` : null,
        record.vpp_frecuencia_rpm ? `${record.vpp_frecuencia_rpm} rpm` : null,
        record.vpp_fi_o2_pct ? `FiO₂ ${record.vpp_fi_o2_pct}%` : null,
      ]
        .filter(Boolean)
        .join(" · ") || null,
    },
    {
      key: "intubacion",
      label: "Intubación",
      ts: record.intubacion_en ? new Date(record.intubacion_en) : null,
      detail: record.tubo_size_mm ? `Tubo ${record.tubo_size_mm} mm` : record.intubacion_nota,
    },
    {
      key: "mce",
      label: "MCE iniciado",
      ts: record.mce_iniciado_en ? new Date(record.mce_iniciado_en) : null,
      detail: record.mce_ratio ? `Relación ${record.mce_ratio}` : null,
    },
    {
      key: "adrenalina",
      label: "Adrenalina",
      ts: record.adrenalina_en ? new Date(record.adrenalina_en) : null,
      detail: record.adrenalina_dosis_ml
        ? `${record.adrenalina_dosis_ml} ml${record.adrenalina_via ? ` · ${record.adrenalina_via}` : ""}`
        : null,
    },
    {
      key: "volumen_expansor",
      label: "Volumen expansor",
      ts: record.volumen_expansor_en ? new Date(record.volumen_expansor_en) : null,
      detail: record.volumen_expansor_ml
        ? `${record.volumen_expansor_ml} ml${record.volumen_expansor_tipo ? ` · ${record.volumen_expansor_tipo}` : ""}`
        : null,
    },
  ];

  const RESULTADO_LABEL: Record<string, string> = {
    estable: "Estable",
    cuidados_intermedios: "Cuidados intermedios",
    ucin: "UCIN",
    defuncion: "Defunción",
  };
  const RESULTADO_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    estable: "default",
    cuidados_intermedios: "secondary",
    ucin: "outline",
    defuncion: "destructive",
  };

  return (
    <div className="space-y-4">
      {/* Datos iniciales */}
      <div className="flex flex-wrap gap-4 text-sm">
        {record.fc_inicial != null && (
          <span><span className="font-semibold">FC inicial:</span> {record.fc_inicial} lpm</span>
        )}
        {record.respiracion_inicial && (
          <span><span className="font-semibold">Respiración:</span> {record.respiracion_inicial}</span>
        )}
        {record.fc_post_intervencion != null && (
          <span><span className="font-semibold">FC post:</span> {record.fc_post_intervencion} lpm</span>
        )}
      </div>

      {/* Timeline */}
      <ol className="relative ml-3 border-l border-muted">
        {steps.map((step) => {
          const ejecutado = step.ts != null;
          return (
            <li key={step.key} className="mb-4 ml-4">
              <span className="absolute -left-3 flex h-6 w-6 items-center justify-center">
                {ejecutado ? (
                  <CheckCircle2 className="h-5 w-5 text-green-500" aria-label="Completado" />
                ) : (
                  <Circle className="h-5 w-5 text-muted-foreground" aria-label="Sin registrar" />
                )}
              </span>
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium leading-none">{step.label}</p>
                {step.detail && (
                  <Badge variant="outline" className="text-xs">
                    {step.detail}
                  </Badge>
                )}
              </div>
              {step.ts ? (
                <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                  {timeFmt.format(step.ts)} · {diffMin(inicio, step.ts)}
                </p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">Sin registrar</p>
              )}
            </li>
          );
        })}
      </ol>

      {/* Resultado */}
      {record.resultado && (
        <div className="flex items-center gap-2 rounded-md border p-3">
          <span className="text-sm font-semibold">Resultado:</span>
          <Badge variant={RESULTADO_VARIANT[record.resultado] ?? "outline"}>
            {RESULTADO_LABEL[record.resultado] ?? record.resultado}
          </Badge>
          {record.cerrado_en && (
            <span className="text-xs text-muted-foreground tabular-nums">
              · {timeFmt.format(new Date(record.cerrado_en))}
            </span>
          )}
          {record.notas_cierre && (
            <span className="text-xs text-muted-foreground">· {record.notas_cierre}</span>
          )}
        </div>
      )}
    </div>
  );
}
