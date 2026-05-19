"use client";

/**
 * WindowAlertBadge — badge naranja que indica indicaciones próximas a cerrar ventana.
 *
 * Hace poll cada 2 min (alineado con el cron de emitWindowClosingAlerts).
 * Click → activa filtro "Solo próximas a vencer" en la lista de indicaciones.
 *
 * US.F2.6.52
 */

import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc/react";
import { cn } from "@his/ui/lib/utils";

interface WindowAlertBadgeProps {
  /** Callback invocado al hacer click. Recibe el estado del filtro activo. */
  onFilterChange?: (soloProximas: boolean) => void;
  className?: string;
}

export function WindowAlertBadge({ onFilterChange, className }: WindowAlertBadgeProps) {
  const [filterActive, setFilterActive] = useState(false);

  const { data, isLoading } = trpc.medicationWindow.getProximasACerrar.useQuery(
    undefined,
    { refetchInterval: 2 * 60_000 }, // poll cada 2 min
  );

  const pendientes = data?.alertasPendientes?.length ?? 0;
  const proximas   = data?.indicaciones?.length ?? 0;
  const total      = Math.max(pendientes, proximas);

  const handleClick = useCallback(() => {
    const next = !filterActive;
    setFilterActive(next);
    onFilterChange?.(next);
  }, [filterActive, onFilterChange]);

  if (isLoading || total === 0) return null;

  return (
    <button
      onClick={handleClick}
      aria-label={`${total} indicaciones próximas a vencer. Click para filtrar.`}
      aria-pressed={filterActive}
      className={cn(
        "relative inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-all",
        "focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-1",
        filterActive
          ? "bg-orange-500 text-white shadow-md"
          : "bg-orange-100 text-orange-800 hover:bg-orange-200",
        className,
      )}
    >
      {/* Pulsating dot para llamar la atención */}
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-orange-500" />
      </span>
      {total} {total === 1 ? "ventana cerrando" : "ventanas cerrando"}
    </button>
  );
}
