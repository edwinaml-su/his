/**
 * Badge visual para el estado del workflow de indicaciones médicas ECE.
 *
 * Estados del workflow:
 *  BORRADOR        — creada, pendiente de firma MC
 *  FIRMADA_MC      — firmada electrónicamente por médico
 *  VALIDADA_ENF    — transcripción verificada por enfermería
 *  ANULADA         — cancelada
 *
 * Nielsen #1 — visibilidad del estado del sistema: color + etiqueta
 * por cada estado para que el rol pueda tomar acción inmediata.
 */
import * as React from "react";
import { cn } from "@his/ui/lib/utils";

export type IndicacionEstado =
  | "BORRADOR"
  | "FIRMADA_MC"
  | "VALIDADA_ENF"
  | "ANULADA";

const CONFIG: Record<
  IndicacionEstado,
  { label: string; className: string; ariaLabel: string }
> = {
  BORRADOR: {
    label: "Borrador",
    className:
      "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    ariaLabel: "Pendiente de firma médica",
  },
  FIRMADA_MC: {
    label: "Firmada MC",
    className:
      "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    ariaLabel: "Firmada por médico, pendiente de validación de enfermería",
  },
  VALIDADA_ENF: {
    label: "Validada ENF",
    className:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
    ariaLabel: "Validada por enfermería",
  },
  ANULADA: {
    label: "Anulada",
    className:
      "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    ariaLabel: "Anulada",
  },
};

interface IndicacionEstadoBadgeProps {
  estado: IndicacionEstado;
  className?: string;
}

export function IndicacionEstadoBadge({
  estado,
  className,
}: IndicacionEstadoBadgeProps): React.ReactElement {
  const cfg = CONFIG[estado] ?? CONFIG.BORRADOR;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        cfg.className,
        className,
      )}
      aria-label={cfg.ariaLabel}
    >
      {cfg.label}
    </span>
  );
}
