"use client";

/**
 * AldreteBadge — indicador visual del puntaje Aldrete.
 *
 * Semáforo clínico:
 *   ≥9  → verde  (listo para alta)
 *   5-8 → ámbar  (observación)
 *   ≤4  → rojo   (traslado UCI)
 */

import { cn } from "@his/ui/lib/utils";

interface AldreteBadgeProps {
  score: number;
  showLabel?: boolean;
  className?: string;
}

export function AldreteBadge({ score, showLabel = true, className }: AldreteBadgeProps) {
  const { color, label, ring } = getAldreteStyle(score);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-semibold",
        color,
        ring,
        className,
      )}
      title={`Aldrete ${score}/10 — ${label}`}
    >
      <span
        className="h-2 w-2 rounded-full bg-current opacity-80"
        aria-hidden="true"
      />
      <span className="tabular-nums">{score}/10</span>
      {showLabel && <span className="text-xs font-normal opacity-90">{label}</span>}
    </span>
  );
}

export function getAldreteStyle(score: number): {
  color: string;
  ring: string;
  label: string;
  severity: "green" | "amber" | "red";
} {
  if (score >= 9) {
    return {
      color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
      ring: "ring-1 ring-green-300 dark:ring-green-700",
      label: "Listo para alta",
      severity: "green",
    };
  }
  if (score >= 5) {
    return {
      color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
      ring: "ring-1 ring-amber-300 dark:ring-amber-700",
      label: "Observación",
      severity: "amber",
    };
  }
  return {
    color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    ring: "ring-1 ring-red-300 dark:ring-red-700",
    label: "Traslado UCI",
    severity: "red",
  };
}
