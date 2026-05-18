"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc/react";
import { cn } from "@his/ui/lib/utils";

/** Muestra la cola de pacientes pendientes del turno activo. */
export function BedsideQueueClient() {
  const { data, isLoading, error, refetch } = trpc.bedside.shiftQueue.pending.useQuery(
    {},
    { refetchInterval: 60_000 }, // refresca cada minuto para mantener la ventana actualizada
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

  if (!data || data.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
        <p className="text-lg font-medium text-gray-700">Sin indicaciones pendientes</p>
        <p className="mt-1 text-sm text-gray-500">
          Todos los medicamentos del turno han sido administrados.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {(data as QueueItem[]).map((item) => (
        <PatientCard key={item.indicationId} item={item} />
      ))}
    </div>
  );
}

type QueueItem = {
  indicationId: string;
  patientId: string;
  patientName: string;
  bed: string;
  gtin: string | null;
  medicationName: string;
  scheduledAt: string | null;
  minutesUntilDeadline: number | null;
  status: "ok" | "warning" | "overdue";
};

function PatientCard({ item }: { item: QueueItem }) {
  const scheduledLabel = item.scheduledAt
    ? new Date(item.scheduledAt).toLocaleTimeString("es-SV", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div
      className={cn(
        "rounded-xl border-2 bg-white p-5 shadow-sm transition-all",
        item.status === "ok" && "border-green-200",
        item.status === "warning" && "border-amber-300",
        item.status === "overdue" && "border-red-400",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        {/* Info paciente */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <StatusDot status={item.status} />
            <span className="text-base font-semibold text-gray-900 truncate">
              {item.patientName}
            </span>
            <span className="shrink-0 rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
              Cama {item.bed}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-600 truncate">
            <span className="font-medium">Medicamento:</span> {item.medicationName}
          </p>
          {scheduledLabel && (
            <p className="mt-0.5 text-xs text-gray-500">
              Hora programada: <span className="font-medium">{scheduledLabel}</span>
              {item.minutesUntilDeadline !== null && (
                <span
                  className={cn(
                    "ml-2 font-semibold",
                    item.status === "overdue" && "text-red-600",
                    item.status === "warning" && "text-amber-600",
                    item.status === "ok" && "text-green-600",
                  )}
                >
                  {item.status === "overdue"
                    ? `(${Math.abs(item.minutesUntilDeadline)} min vencida)`
                    : `(${item.minutesUntilDeadline} min restantes)`}
                </span>
              )}
            </p>
          )}
        </div>

        {/* Botón Iniciar Administración */}
        <Link
          href={`/bedside/${item.patientId}/${item.indicationId}`}
          className={cn(
            "shrink-0 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2",
            item.status === "overdue"
              ? "bg-red-600 hover:bg-red-700 focus:ring-red-500"
              : item.status === "warning"
                ? "bg-amber-500 hover:bg-amber-600 focus:ring-amber-400"
                : "bg-blue-600 hover:bg-blue-700 focus:ring-blue-500",
          )}
          aria-label={`Iniciar administración para ${item.patientName}`}
        >
          Iniciar
        </Link>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: "ok" | "warning" | "overdue" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block h-2.5 w-2.5 rounded-full shrink-0",
        status === "ok" && "bg-green-500",
        status === "warning" && "bg-amber-400",
        status === "overdue" && "bg-red-500",
      )}
    />
  );
}
