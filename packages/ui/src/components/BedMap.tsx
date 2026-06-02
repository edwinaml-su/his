"use client";

import * as React from "react";
import {
  BedDouble,
  User,
  Sparkles,
  Wrench,
  Ban,
  CalendarClock,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";
import { cn } from "../lib/utils";

export type BedStatus = "FREE" | "OCCUPIED" | "DIRTY" | "BLOCKED" | "MAINTENANCE" | "RESERVED";

export interface BedCell {
  id: string;
  code: string;
  status: BedStatus;
  patientName?: string | null;
  /** MRN del paciente (solo iniciales + MRN se muestran en tooltip) */
  patientMrn?: string | null;
  /** ISO string de última actualización de estado */
  updatedAt?: string | null;
  /** Episodio de atención activo en la cama — permite navegar al detalle de la admisión. */
  episodioId?: string | null;
}

export interface BedMapServiceGroup {
  serviceUnitId: string;
  serviceUnitName: string;
  beds: BedCell[];
}

interface BedMapProps {
  groups: BedMapServiceGroup[];
  onBedClick?: (bed: BedCell) => void;
  className?: string;
  /**
   * Indica la fuente de datos del mapa. No afecta el render — es informativo
   * para herramientas de testing y future-proofing de consumers no migrados.
   * Default: "ece" (fuente canónica tras PR refactor /beds).
   */
  dataSource?: "legacy" | "ece";
}

const STATUS_STYLES: Record<BedStatus, string> = {
  FREE: "bg-success/10 border-success/40 text-success",
  OCCUPIED: "bg-info/10 border-info/40 text-info",
  DIRTY: "bg-warning/10 border-warning/40 text-warning",
  BLOCKED: "bg-destructive/10 border-destructive/40 text-destructive",
  MAINTENANCE: "bg-muted border-border text-muted-foreground",
  RESERVED: "bg-accent border-border text-accent-foreground",
};

/** Borde grueso para estado crítico (BLOCKED) — sin animación de pulso */
const STATUS_CRITICAL_BORDER: Partial<Record<BedStatus, string>> = {
  BLOCKED: "border-4",
};

const STATUS_LABEL: Record<BedStatus, string> = {
  FREE: "Libre",
  OCCUPIED: "Ocupada",
  DIRTY: "Limpieza",
  BLOCKED: "Bloqueada",
  MAINTENANCE: "Mantenimiento",
  RESERVED: "Reservada",
};

const STATUS_ICON: Record<BedStatus, React.ElementType> = {
  FREE: BedDouble,
  OCCUPIED: User,
  DIRTY: Sparkles,
  BLOCKED: Ban,
  MAINTENANCE: Wrench,
  RESERVED: CalendarClock,
};

/** Obtiene iniciales de nombre (máx 2 caracteres) */
function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/** Formatea fecha ISO a hora local legible */
function formatUpdatedAt(iso: string): string {
  try {
    return new Intl.DateTimeFormat("es-SV", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** Leyenda colapsable de estados de cama. */
function BedMapLegend() {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          // Touch target ≥ 44px
          "inline-flex min-h-[44px] min-w-[44px] items-center gap-1.5 rounded-md border border-border",
          "bg-background px-3 py-2 text-xs text-muted-foreground",
          "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
        aria-expanded={open}
        aria-label="Leyenda de estados de cama"
      >
        <BedDouble className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Leyenda</span>
        {open ? (
          <ChevronUp className="h-3 w-3" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-3 w-3" aria-hidden="true" />
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Leyenda de estados de cama"
          className={cn(
            "absolute left-0 top-full z-50 mt-1 min-w-[200px]",
            "rounded-md border border-border bg-popover p-2 shadow-md",
          )}
        >
          <ul className="space-y-1">
            {(Object.keys(STATUS_LABEL) as BedStatus[]).map((status) => {
              const Icon = STATUS_ICON[status];
              return (
                <li key={status} className="flex items-center gap-2 py-0.5">
                  {/* Muestra de color */}
                  <span
                    className={cn(
                      "h-4 w-4 shrink-0 rounded-sm border",
                      STATUS_STYLES[status],
                    )}
                    aria-hidden="true"
                  />
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="text-xs text-popover-foreground">
                    {STATUS_LABEL[status]}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Mapa visual de camas por servicio (TDR §8.6).
 * Grid responsivo; cada celda es un botón si onBedClick está provisto.
 * Mejoras v2.0: ícono + leyenda colapsable + tooltip detallado.
 * Sin animaciones de pulso (prefers-reduced-motion respetado).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function BedMap({ groups, onBedClick, className, dataSource: _dataSource = "ece" }: BedMapProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <div className={cn("space-y-4", className)}>
        {/* Header con leyenda */}
        <div className="flex items-center justify-end">
          <BedMapLegend />
        </div>

        {groups.map((group) => (
          <section key={group.serviceUnitId}>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {group.serviceUnitName}
            </h3>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
              {group.beds.map((bed) => {
                const Cmp = onBedClick ? "button" : "div";
                const Icon = STATUS_ICON[bed.status];

                const tooltipContent = (
                  <div className="space-y-0.5 text-xs">
                    <p className="font-semibold">
                      Cama {bed.code}
                    </p>
                    <p className="flex items-center gap-1">
                      <Icon className="h-3 w-3" aria-hidden="true" />
                      {STATUS_LABEL[bed.status]}
                    </p>
                    {bed.status === "OCCUPIED" && bed.patientName && (
                      <p className="text-muted-foreground">
                        {getInitials(bed.patientName)}
                        {bed.patientMrn ? ` · MRN ${bed.patientMrn}` : ""}
                      </p>
                    )}
                    {bed.updatedAt && (
                      <p className="text-muted-foreground">
                        Actualizado: {formatUpdatedAt(bed.updatedAt)}
                      </p>
                    )}
                  </div>
                );

                return (
                  <li key={bed.id}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Cmp
                          type={onBedClick ? "button" : undefined}
                          onClick={onBedClick ? () => onBedClick(bed) : undefined}
                          className={cn(
                            "flex h-20 w-full flex-col items-center justify-center rounded-md border-2 p-1 text-center transition-colors",
                            STATUS_STYLES[bed.status],
                            STATUS_CRITICAL_BORDER[bed.status],
                            onBedClick && "hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          )}
                          aria-label={`Cama ${bed.code} — ${STATUS_LABEL[bed.status]}${
                            bed.patientName ? ` — ${bed.patientName}` : ""
                          }`}
                        >
                          <Icon className="mb-0.5 h-4 w-4" aria-hidden="true" />
                          <span className="text-sm font-bold tabular-nums">{bed.code}</span>
                          <span className="text-[10px] uppercase">{STATUS_LABEL[bed.status]}</span>
                          {bed.status === "OCCUPIED" && bed.patientName ? (
                            <span className="mt-0.5 line-clamp-1 text-[10px]">
                              {getInitials(bed.patientName)}
                            </span>
                          ) : null}
                        </Cmp>
                      </TooltipTrigger>
                      <TooltipContent side="top">{tooltipContent}</TooltipContent>
                    </Tooltip>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {groups.length === 0 && (
          <p className="text-sm text-muted-foreground">No hay camas configuradas.</p>
        )}
      </div>
    </TooltipProvider>
  );
}
