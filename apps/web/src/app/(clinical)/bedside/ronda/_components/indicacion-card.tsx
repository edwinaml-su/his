"use client";

/**
 * IndicacionCard — tarjeta de indicación pendiente en la ronda.
 * Muestra paciente, GTIN, hora programada y el botón "Siguiente Paciente".
 */

import { cn } from "@his/ui/lib/utils";

interface IndicacionRonda {
  indicacionId: string;
  patientId: string;
  patientGsrn: string | null;
  cama: string | null;
  servicio: string | null;
  horaProgramada: Date | null;
  gtin: string | null;
  completada: boolean;
}

interface Props {
  indicacion: IndicacionRonda;
  isNext: boolean;
  loading: boolean;
  onNext: (indicacionId: string) => void;
}

export function IndicacionCard({ indicacion, isNext, loading, onNext }: Props) {
  const horaLabel = indicacion.horaProgramada
    ? new Date(indicacion.horaProgramada).toLocaleTimeString("es-SV", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  const nowMs = Date.now();
  const minutosRestantes = indicacion.horaProgramada
    ? Math.round((new Date(indicacion.horaProgramada).getTime() - nowMs) / 60_000)
    : null;

  const urgente = minutosRestantes !== null && minutosRestantes < 15 && minutosRestantes >= -30;
  const vencida = minutosRestantes !== null && minutosRestantes < -30;

  return (
    <div
      className={cn(
        "rounded-xl border-2 bg-white p-4 shadow-sm",
        isNext && !indicacion.completada && "border-blue-400 ring-2 ring-blue-200",
        indicacion.completada && "border-gray-200 opacity-60",
        vencida && !indicacion.completada && "border-red-400",
        urgente && !indicacion.completada && "border-amber-400",
        !isNext && !indicacion.completada && !vencida && !urgente && "border-gray-200",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-block h-2.5 w-2.5 rounded-full",
                indicacion.completada ? "bg-gray-400" : vencida ? "bg-red-500" : urgente ? "bg-amber-400" : "bg-green-500",
              )}
              aria-hidden="true"
            />
            <span className="truncate text-sm font-semibold text-gray-900">
              {indicacion.patientGsrn
                ? `GSRN: ${indicacion.patientGsrn}`
                : indicacion.patientId.slice(0, 8)}
            </span>
            {indicacion.cama && (
              <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                Cama {indicacion.cama}
              </span>
            )}
          </div>
          {indicacion.gtin && (
            <p className="mt-1 text-xs text-gray-500">
              GTIN: <span className="font-mono">{indicacion.gtin}</span>
            </p>
          )}
          {horaLabel && (
            <p className="mt-0.5 text-xs text-gray-500">
              Hora:{" "}
              <span
                className={cn(
                  "font-semibold",
                  vencida && "text-red-600",
                  urgente && "text-amber-600",
                  !vencida && !urgente && "text-green-700",
                )}
              >
                {horaLabel}
                {minutosRestantes !== null && (
                  <span className="ml-1 font-normal">
                    {vencida
                      ? `(${Math.abs(minutosRestantes)} min vencida)`
                      : urgente
                        ? `(${minutosRestantes} min)`
                        : ""}
                  </span>
                )}
              </span>
            </p>
          )}
        </div>

        {!indicacion.completada && isNext && (
          <button
            onClick={() => onNext(indicacion.indicacionId)}
            disabled={loading}
            className="shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Siguiente
          </button>
        )}
        {indicacion.completada && (
          <span className="shrink-0 text-sm text-gray-400">Completado</span>
        )}
      </div>
    </div>
  );
}
