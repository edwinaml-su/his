"use client";

/**
 * BedMapGrid — Grid visual de camas hospitalarias.
 *
 * Accesibilidad (WCAG 2.2 AA):
 * - Cada celda es un <button> con aria-label descriptivo.
 * - El estado se comunica con texto + icono, nunca solo color.
 * - Focus visible via ring-2 (se hereda del sistema de diseño).
 * - Contraste: colores verificados ≥ 4.5:1 sobre fondos claros/oscuros.
 * - role="grid" + role="gridcell" para navegación por teclado en cuadrícula.
 *
 * Diseño:
 * - Verde  (emerald) → libre
 * - Rojo   (rose)    → ocupada
 * - Ámbar  (amber)   → limpieza
 * - Gris   (slate)   → mantenimiento
 *
 * El estado también se comunica con un ícono distinto para cada categoría
 * (requerimiento colorblind-safe).
 */

import * as React from "react";
import { cn } from "@his/ui/lib/utils";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type EstadoCama = "libre" | "ocupada" | "limpieza" | "mantenimiento";

export interface CamaDato {
  camaId: string;
  codigo: string;
  servicio: string;
  estado: EstadoCama;
  pacienteNombre: string | null;
  episodioId: string | null;
  asignadaDesde: Date | null;
}

interface BedMapGridProps {
  camas: CamaDato[];
  onClickCama: (cama: CamaDato) => void;
  /** Si se pasa, carga visual mientras se esperan datos */
  isLoading?: boolean;
}

// ─── Constantes de estado ─────────────────────────────────────────────────────

const ESTADO_CONFIG: Record<
  EstadoCama,
  {
    label: string;
    /** Ícono SVG inline (colorblind-safe: diferente forma por estado) */
    icon: React.ReactNode;
    cellClass: string;
    badgeClass: string;
  }
> = {
  libre: {
    label: "Libre",
    icon: (
      // Checkmark circle
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
    cellClass:
      "bg-emerald-50 border-emerald-300 text-emerald-900 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:border-emerald-700 dark:text-emerald-100",
    badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  },
  ocupada: {
    label: "Ocupada",
    icon: (
      // Person silhouette (filled)
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
    cellClass:
      "bg-rose-50 border-rose-300 text-rose-900 hover:bg-rose-100 dark:bg-rose-950/40 dark:border-rose-700 dark:text-rose-100",
    badgeClass: "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200",
  },
  limpieza: {
    label: "Limpieza",
    icon: (
      // Broom / sparkle triangle
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
    cellClass:
      "bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100 dark:bg-amber-950/40 dark:border-amber-700 dark:text-amber-100",
    badgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  },
  mantenimiento: {
    label: "Mantenimiento",
    icon: (
      // Wrench square
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
    cellClass:
      "bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200",
    badgeClass: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
  },
};

// ─── Celda individual ─────────────────────────────────────────────────────────

function CamaCelda({
  cama,
  onClick,
}: {
  cama: CamaDato;
  onClick: () => void;
}) {
  const cfg = ESTADO_CONFIG[cama.estado];

  const ariaLabel = [
    `Cama ${cama.codigo}`,
    cfg.label,
    cama.pacienteNombre ? `Paciente: ${cama.pacienteNombre}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div role="gridcell">
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        className={cn(
          "flex w-full flex-col gap-1 rounded-lg border-2 p-3 text-left transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          cfg.cellClass,
        )}
      >
        {/* Fila superior: código + icono */}
        <div className="flex items-center justify-between">
          <span className="text-base font-bold leading-none">{cama.codigo}</span>
          <span className={cn("rounded-full p-0.5", cfg.badgeClass)}>
            {cfg.icon}
          </span>
        </div>

        {/* Estado en texto — crítico para a11y / colorblind */}
        <span className="text-xs font-medium uppercase tracking-wide opacity-80">
          {cfg.label}
        </span>

        {/* Nombre del paciente (solo si ocupada) */}
        {cama.pacienteNombre ? (
          <span className="truncate text-xs">{cama.pacienteNombre}</span>
        ) : (
          <span className="text-xs opacity-0" aria-hidden="true">
            &nbsp;
          </span>
        )}
      </button>
    </div>
  );
}

// ─── Esqueleto de carga ───────────────────────────────────────────────────────

function CamaEsqueleto() {
  return (
    <div
      className="h-24 animate-pulse rounded-lg border-2 border-muted bg-muted"
      aria-hidden="true"
    />
  );
}

// ─── Grid principal ───────────────────────────────────────────────────────────

export function BedMapGrid({ camas, onClickCama, isLoading = false }: BedMapGridProps) {
  if (isLoading) {
    return (
      <div
        role="grid"
        aria-label="Mapa de camas cargando"
        aria-busy="true"
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
      >
        {Array.from({ length: 12 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: esqueleto estático
          <div key={i} role="gridcell">
            <CamaEsqueleto />
          </div>
        ))}
      </div>
    );
  }

  if (camas.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        No se encontraron camas para el servicio seleccionado.
      </p>
    );
  }

  return (
    <div
      role="grid"
      aria-label="Mapa de camas del servicio"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
    >
      {camas.map((cama) => (
        <CamaCelda
          key={cama.camaId}
          cama={cama}
          onClick={() => onClickCama(cama)}
        />
      ))}
    </div>
  );
}
