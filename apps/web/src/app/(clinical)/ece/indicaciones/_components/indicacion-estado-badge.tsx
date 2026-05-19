/**
 * Badge visual para el estado del workflow de indicaciones médicas ECE.
 *
 * Refleja el estado_registro de ece.indicaciones_medicas:
 *   borrador  — creada, pendiente de firma MC
 *   firmado   — firmada electrónicamente por médico
 *   validado  — transcripción verificada por enfermería
 *
 * Más vigencia:
 *   ACTIVA | SUSPENDIDA | CANCELADA
 *
 * Nielsen #1 — visibilidad del estado: color + etiqueta por cada estado
 * para que el rol clínico pueda tomar acción inmediata.
 */
import * as React from "react";
import { cn } from "@his/ui/lib/utils";

export type EstadoRegistro = "borrador" | "firmado" | "validado";
export type Vigencia = "ACTIVA" | "SUSPENDIDA" | "CANCELADA";

const ESTADO_CONFIG: Record<
  EstadoRegistro,
  { label: string; className: string; ariaLabel: string }
> = {
  borrador: {
    label: "Borrador",
    className:
      "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    ariaLabel: "Pendiente de firma médica",
  },
  firmado: {
    label: "Firmado MC",
    className:
      "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    ariaLabel: "Firmado por médico, pendiente de validación de enfermería",
  },
  validado: {
    label: "Validado ENF",
    className:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
    ariaLabel: "Validado por enfermería",
  },
};

const VIGENCIA_CONFIG: Record<
  Vigencia,
  { label: string; className: string }
> = {
  ACTIVA: {
    label: "Activa",
    className:
      "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  },
  SUSPENDIDA: {
    label: "Suspendida",
    className:
      "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  },
  CANCELADA: {
    label: "Cancelada",
    className:
      "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  },
};

interface IndicacionEstadoBadgeProps {
  estadoRegistro: EstadoRegistro;
  vigencia?: Vigencia;
  className?: string;
}

export function IndicacionEstadoBadge({
  estadoRegistro,
  vigencia,
  className,
}: IndicacionEstadoBadgeProps): React.ReactElement {
  const estadoCfg = ESTADO_CONFIG[estadoRegistro] ?? ESTADO_CONFIG.borrador;
  const vigenciaCfg = vigencia ? VIGENCIA_CONFIG[vigencia] : null;

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn(
          "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
          estadoCfg.className,
          className,
        )}
        aria-label={estadoCfg.ariaLabel}
      >
        {estadoCfg.label}
      </span>
      {vigenciaCfg ? (
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 text-xs",
            vigenciaCfg.className,
          )}
        >
          {vigenciaCfg.label}
        </span>
      ) : null}
    </span>
  );
}
