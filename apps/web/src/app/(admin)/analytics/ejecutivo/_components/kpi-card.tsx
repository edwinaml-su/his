"use client";

/**
 * KpiCard — render de un KPI individual con descripción, valor, meta, semáforo,
 * fuente y badge de estado de datos (real/mock/pending).
 */
import * as React from "react";
import { Info, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { Card, CardContent } from "@his/ui/components/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@his/ui/components/tooltip";
import { cn } from "@his/ui/lib/utils";
import type { KpiDefinition, DataSource } from "../_lib/kpi-catalog";

export type SemaforoColor = "verde" | "ambar" | "rojo" | "neutro";

export interface KpiValue {
  /** Valor principal a mostrar (ya formateado con unidad si aplica). */
  display: string;
  /** Color del semáforo según meta del KPI. */
  semaforo: SemaforoColor;
  /** Texto secundario (e.g. "vs mes anterior +2.3pp"). */
  delta?: string;
  /** Si true, el delta sube; si false baja; si undefined sin tendencia. */
  deltaPositive?: boolean;
}

const SEMAFORO_CLASS: Record<SemaforoColor, string> = {
  verde:  "bg-emerald-500 text-white",
  ambar:  "bg-amber-500 text-white",
  rojo:   "bg-red-600 text-white",
  neutro: "bg-muted text-muted-foreground",
};

const DATA_SOURCE_BADGE: Record<DataSource, { label: string; cls: string; icon: React.ComponentType<{ className?: string }> }> = {
  real:    { label: "Datos reales",  cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300", icon: CheckCircle2 },
  mock:    { label: "Datos demo",    cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",         icon: AlertTriangle },
  pending: { label: "Pendiente integración", cls: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",   icon: Clock },
};

export function KpiCard({ kpi, value }: { kpi: KpiDefinition; value: KpiValue | null }) {
  const semaforo = value?.semaforo ?? "neutro";
  const ds = DATA_SOURCE_BADGE[kpi.dataSource];
  const DsIcon = ds.icon;

  return (
    <Card className="break-inside-avoid">
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold leading-tight">{kpi.titulo}</h3>
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger className="text-muted-foreground hover:text-foreground">
                <Info className="h-4 w-4" aria-label="Detalle del indicador" />
              </TooltipTrigger>
              <TooltipContent side="left" align="start" className="max-w-xs space-y-1.5 text-xs">
                <p className="font-medium">{kpi.descripcion}</p>
                <p className="border-t pt-1 text-muted-foreground">
                  <span className="font-medium text-foreground">Fórmula:</span> {kpi.formula}
                </p>
                <p className="text-muted-foreground">
                  <span className="font-medium text-foreground">Meta:</span> {kpi.meta}
                </p>
                {kpi.umbralCritico && (
                  <p className="text-muted-foreground">
                    <span className="font-medium text-foreground">Umbral crítico:</span> {kpi.umbralCritico}
                  </p>
                )}
                <p className="text-muted-foreground">
                  <span className="font-medium text-foreground">Fuente:</span> {kpi.fuente}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Valor + Semáforo */}
        <div className="mt-2 flex items-baseline gap-3">
          <span className={cn("inline-flex h-3 w-3 shrink-0 rounded-full", SEMAFORO_CLASS[semaforo])} aria-hidden />
          <span className="text-2xl font-bold tabular-nums leading-none">
            {value?.display ?? "—"}
          </span>
        </div>

        {/* Delta */}
        {value?.delta && (
          <p className={cn(
            "mt-1 text-xs tabular-nums",
            value.deltaPositive === true && "text-emerald-600 dark:text-emerald-400",
            value.deltaPositive === false && "text-red-600 dark:text-red-400",
            value.deltaPositive === undefined && "text-muted-foreground",
          )}>
            {value.delta}
          </p>
        )}

        {/* Meta + fuente */}
        <div className="mt-3 space-y-0.5 border-t pt-2 text-[11px] leading-tight text-muted-foreground">
          <p><span className="font-medium text-foreground">Meta:</span> {kpi.meta}</p>
          <p><span className="font-medium text-foreground">Fórmula:</span> {kpi.formula}</p>
        </div>

        {/* Badge data source */}
        <div className="mt-3 flex items-center justify-between">
          <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium", ds.cls)}>
            <DsIcon className="h-3 w-3" aria-hidden />
            {ds.label}
          </span>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {kpi.frecuencia.replace("_", " ")}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
