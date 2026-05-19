"use client";

/**
 * RondaProgress — barra de progreso + tiempo transcurrido de la ronda.
 * Muestra N/total completados y el tiempo desde inicio.
 */

import { cn } from "@his/ui/lib/utils";

interface Props {
  completados: number;
  total: number;
  iniciadoEn: Date;
  pausadoEn: Date | null;
}

export function RondaProgress({ completados, total, iniciadoEn, pausadoEn }: Props) {
  const pct = total === 0 ? 0 : Math.round((completados / total) * 100);
  const elapsed = pausadoEn
    ? pausadoEn.getTime() - iniciadoEn.getTime()
    : Date.now() - iniciadoEn.getTime();
  const mins = Math.floor(elapsed / 60_000);
  const secs = Math.floor((elapsed % 60_000) / 1_000);
  const tiempoLabel = `${mins}m ${secs.toString().padStart(2, "0")}s`;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold text-gray-700">
          {completados} / {total} pacientes completados
        </span>
        <span className="text-gray-500">Tiempo: {tiempoLabel}</span>
      </div>
      <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${pct}% completado`}
          className={cn(
            "h-3 rounded-full transition-all duration-500",
            pct === 100 ? "bg-green-500" : "bg-blue-500",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1 text-right text-xs text-gray-400">{pct}%</p>
    </div>
  );
}
