"use client";

/**
 * BedsideQueueClient — cola de indicaciones pendientes del turno activo.
 *
 * Usa bedside.shiftQueue.pending (restaurado en F2-S7 Wave 2).
 * Refresca automáticamente cada minuto para mantener la ventana terapéutica.
 * F2-S14-D: integra WindowAlertBadge + filtro "Solo próximas a vencer".
 */

import { useState, useCallback } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/react";
import { cn } from "@his/ui/lib/utils";
import { WindowAlertBadge } from "./window-alert-badge";

type QueueItem = {
  indicationId: string;
  patientId: string;
  patientGsrn: string | null;
  gtinMedicamento: string | null;
  horaProgramada: Date | null;
  status: "PENDING" | "DONE" | "OVERDUE";
};

const WINDOW_ALERT_THRESHOLD_MIN = 15;

export function BedsideQueueClient() {
  const [soloProximas, setSoloProximas] = useState(false);

  const handleFilterChange = useCallback((active: boolean) => {
    setSoloProximas(active);
  }, []);

  const { data, isLoading, error, refetch } = trpc.bedside.shiftQueue.pending.useQuery(
    {},
    { refetchInterval: 60_000 },
  );

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-100" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Error al cargar la cola: {error.message}
        <button
          onClick={() => void refetch()}
          className="ml-3 underline hover:no-underline"
        >
          Reintentar
        </button>
      </div>
    );
  }

  const allItems = (data?.items ?? []) as QueueItem[];
  const now = Date.now();

  // Filtro "Solo próximas a vencer": muestra solo indicaciones con < 15 min o vencidas
  const items = soloProximas
    ? allItems.filter((item) => {
        if (!item.horaProgramada) return false;
        const minutos = Math.round(
          (new Date(item.horaProgramada).getTime() - now) / 60_000,
        );
        return minutos < WINDOW_ALERT_THRESHOLD_MIN || item.status === "OVERDUE";
      })
    : allItems;

  return (
    <div className="flex flex-col gap-3">
      {/* Badge de alertas de ventana terapéutica — F2-S14-D */}
      <div className="flex items-center gap-2">
        <WindowAlertBadge onFilterChange={handleFilterChange} />
        {soloProximas && (
          <span className="text-xs text-gray-500">
            Filtrando: solo próximas a vencer
          </span>
        )}
      </div>

      {items.length === 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
          <p className="text-lg font-medium text-gray-700">
            {soloProximas ? "Sin indicaciones próximas a vencer" : "Sin indicaciones pendientes"}
          </p>
          <p className="mt-1 text-sm text-gray-500">
            {soloProximas
              ? "Todas las ventanas terapéuticas están dentro del margen."
              : "Todos los medicamentos del turno han sido administrados."}
          </p>
        </div>
      )}

      {items.map((item) => (
        <IndicationCard key={item.indicationId} item={item} />
      ))}
    </div>
  );
}

function IndicationCard({ item }: { item: QueueItem }) {
  const scheduledLabel = item.horaProgramada
    ? new Date(item.horaProgramada).toLocaleTimeString("es-SV", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  const now = Date.now();
  const minutesUntilDeadline = item.horaProgramada
    ? Math.round((new Date(item.horaProgramada).getTime() - now) / 60_000)
    : null;

  return (
    <div
      className={cn(
        "rounded-xl border-2 bg-white p-5 shadow-sm transition-all",
        item.status === "PENDING" && "border-green-200",
        item.status === "DONE" && "border-gray-200",
        item.status === "OVERDUE" && "border-red-400",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <StatusDot status={item.status} />
            <span className="truncate text-base font-semibold text-gray-900">
              {item.patientGsrn ? `GSRN: ${item.patientGsrn}` : item.patientId.slice(0, 8)}
            </span>
          </div>
          {item.gtinMedicamento && (
            <p className="mt-1 truncate text-sm text-gray-600">
              <span className="font-medium">GTIN:</span> {item.gtinMedicamento}
            </p>
          )}
          {scheduledLabel && (
            <p className="mt-0.5 text-xs text-gray-500">
              Hora programada: <span className="font-medium">{scheduledLabel}</span>
              {minutesUntilDeadline !== null && (
                <span
                  className={cn(
                    "ml-2 font-semibold",
                    item.status === "OVERDUE" && "text-red-600",
                    item.status === "PENDING" && minutesUntilDeadline < 30 && "text-amber-600",
                    item.status === "PENDING" && minutesUntilDeadline >= 30 && "text-green-600",
                  )}
                >
                  {item.status === "OVERDUE"
                    ? `(${Math.abs(minutesUntilDeadline)} min vencida)`
                    : `(${minutesUntilDeadline} min restantes)`}
                </span>
              )}
            </p>
          )}
        </div>

        <Link
          href={`/bedside/${item.patientId}/${item.indicationId}`}
          className={cn(
            "shrink-0 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2",
            item.status === "OVERDUE"
              ? "bg-red-600 hover:bg-red-700 focus:ring-red-500"
              : item.status === "DONE"
                ? "bg-gray-400 hover:bg-gray-500 focus:ring-gray-400"
                : "bg-blue-600 hover:bg-blue-700 focus:ring-blue-500",
          )}
          aria-label={`Iniciar administración para paciente ${item.patientId.slice(0, 8)}`}
        >
          Iniciar
        </Link>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: "PENDING" | "DONE" | "OVERDUE" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block h-2.5 w-2.5 shrink-0 rounded-full",
        status === "PENDING" && "bg-green-500",
        status === "DONE" && "bg-gray-400",
        status === "OVERDUE" && "bg-red-500",
      )}
    />
  );
}
