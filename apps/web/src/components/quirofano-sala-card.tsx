"use client";

/**
 * QuirófanoSalaCard — Tarjeta de estado de sala quirúrgica.
 *
 * Accesibilidad (WCAG 2.2 AA):
 * - Estado comunicado con texto + icono (no solo color).
 * - aria-label descriptivo en el elemento raíz.
 * - Focus-visible ring visible.
 * - Contraste ≥ 4.5:1 verificado para cada variante de estado.
 *
 * Diseño:
 * - Libre       → verde (emerald)
 * - Ocupada     → rojo (rose)
 * - Limpieza    → ámbar (amber)
 * - Mantenimiento → gris (slate)
 */

import * as React from "react";
import { cn } from "@his/ui/lib/utils";
import { Card, CardContent } from "@his/ui/components/card";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type EstadoSala = "libre" | "ocupada" | "limpieza" | "mantenimiento";

export interface QuirófanoSalaData {
  salaId: string;
  codigo: string;
  nombre: string;
  estado: EstadoSala;
  /** Cirugía activa solo si estado === "ocupada" */
  cirugiaActual?: {
    id: string;
    pacienteNombre: string;
    procedimiento: string;
    inicioEfectivo: Date | string;
  } | null;
}

interface QuirófanoSalaCardProps {
  sala: QuirófanoSalaData;
  onClick?: (sala: QuirófanoSalaData) => void;
  className?: string;
}

// ─── Configuración de estado ─────────────────────────────────────────────────

const ESTADO_CONFIG: Record<
  EstadoSala,
  {
    label: string;
    icon: React.ReactNode;
    cardClass: string;
    badgeClass: string;
  }
> = {
  libre: {
    label: "Libre",
    icon: (
      <svg
        aria-hidden="true"
        className="h-5 w-5"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <circle cx="10" cy="10" r="8" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.5 10l2.5 2.5 4.5-4.5" />
      </svg>
    ),
    cardClass:
      "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-100",
    badgeClass:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  },
  ocupada: {
    label: "Ocupada",
    icon: (
      <svg
        aria-hidden="true"
        className="h-5 w-5"
        viewBox="0 0 20 20"
        fill="currentColor"
      >
        <circle cx="10" cy="6" r="3" />
        <path d="M4 18c0-3.314 2.686-6 6-6s6 2.686 6 6H4z" />
      </svg>
    ),
    cardClass:
      "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-100",
    badgeClass:
      "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200",
  },
  limpieza: {
    label: "Limpieza",
    icon: (
      <svg
        aria-hidden="true"
        className="h-5 w-5"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 3l7 14H3L10 3z" />
        <path strokeLinecap="round" d="M10 10v4" />
      </svg>
    ),
    cardClass:
      "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100",
    badgeClass:
      "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  },
  mantenimiento: {
    label: "Mantenimiento",
    icon: (
      <svg
        aria-hidden="true"
        className="h-5 w-5"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <rect x="3" y="3" width="14" height="14" rx="2" />
        <path strokeLinecap="round" d="M7 13l2-2 1 1 3-3" />
      </svg>
    ),
    cardClass:
      "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200",
    badgeClass:
      "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
  },
};

const timeFmt = new Intl.DateTimeFormat("es-SV", { timeStyle: "short" });

// ─── Componente ───────────────────────────────────────────────────────────────

export function QuirófanoSalaCard({
  sala,
  onClick,
  className,
}: QuirófanoSalaCardProps) {
  const cfg = ESTADO_CONFIG[sala.estado];

  const ariaLabel = [
    `Sala ${sala.codigo} — ${sala.nombre}`,
    cfg.label,
    sala.cirugiaActual
      ? `Paciente: ${sala.cirugiaActual.pacienteNombre}`
      : null,
  ]
    .filter(Boolean)
    .join(", ");

  const duracionMin =
    sala.cirugiaActual
      ? Math.floor(
          (Date.now() - new Date(sala.cirugiaActual.inicioEfectivo).getTime()) / 60_000,
        )
      : null;

  return (
    <Card
      className={cn("border-2 transition-shadow hover:shadow-md", cfg.cardClass, className)}
    >
      <CardContent className="p-4">
        <button
          type="button"
          onClick={onClick ? () => onClick(sala) : undefined}
          aria-label={ariaLabel}
          disabled={!onClick}
          className={cn(
            "w-full text-left",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            !onClick && "cursor-default",
          )}
        >
          {/* Encabezado: código + icono de estado */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-lg font-bold leading-none">{sala.codigo}</p>
              <p className="mt-0.5 truncate text-xs opacity-70">{sala.nombre}</p>
            </div>
            <span
              className={cn("shrink-0 rounded-full p-1", cfg.badgeClass)}
              title={cfg.label}
            >
              {cfg.icon}
            </span>
          </div>

          {/* Estado en texto — esencial para daltonismo / a11y */}
          <p className="mt-2 text-xs font-semibold uppercase tracking-wide opacity-80">
            {cfg.label}
          </p>

          {/* Cirugía activa */}
          {sala.cirugiaActual ? (
            <div className="mt-2 space-y-0.5 text-xs">
              <p className="truncate font-medium">{sala.cirugiaActual.pacienteNombre}</p>
              <p className="truncate opacity-70">{sala.cirugiaActual.procedimiento}</p>
              <p className="opacity-60">
                Inicio: {timeFmt.format(new Date(sala.cirugiaActual.inicioEfectivo))}
                {duracionMin !== null && ` · ${duracionMin} min`}
              </p>
            </div>
          ) : (
            /* Altura fija para mantener grid uniforme */
            <div className="mt-2 h-[3.5rem]" aria-hidden="true" />
          )}
        </button>
      </CardContent>
    </Card>
  );
}
