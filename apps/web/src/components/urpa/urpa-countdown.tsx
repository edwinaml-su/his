"use client";

/**
 * UrpaCountdown — muestra tiempo transcurrido desde ingreso URPA.
 *
 * Se actualiza cada minuto. Colorea cuando supera umbrales clínicos:
 *   <60 min  → normal (gris)
 *   60-120   → ámbar (vigilancia)
 *   >120 min → rojo  (atención)
 */

import * as React from "react";
import { cn } from "@his/ui/lib/utils";

interface UrpaCountdownProps {
  ingresoTs: Date | string;
  className?: string;
}

export function UrpaCountdown({ ingresoTs, className }: UrpaCountdownProps) {
  const ingreso = React.useMemo(
    () => (ingresoTs instanceof Date ? ingresoTs : new Date(ingresoTs)),
    [ingresoTs],
  );

  const [elapsed, setElapsed] = React.useState(() => getElapsedMinutes(ingreso));

  React.useEffect(() => {
    const id = setInterval(() => setElapsed(getElapsedMinutes(ingreso)), 60_000);
    return () => clearInterval(id);
  }, [ingreso]);

  const { label, colorClass } = formatElapsed(elapsed);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono text-sm font-medium tabular-nums",
        colorClass,
        className,
      )}
      title={`Tiempo en URPA: ${label}`}
      aria-live="polite"
    >
      {label}
    </span>
  );
}

function getElapsedMinutes(since: Date): number {
  return Math.floor((Date.now() - since.getTime()) / 60_000);
}

function formatElapsed(minutes: number): { label: string; colorClass: string } {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const label = h > 0 ? `${h}h ${m.toString().padStart(2, "0")}m` : `${m}m`;

  if (minutes < 60) {
    return { label, colorClass: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" };
  }
  if (minutes < 120) {
    return {
      label,
      colorClass: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    };
  }
  return {
    label,
    colorClass: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  };
}
