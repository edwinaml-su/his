"use client";

/**
 * LotTraceTimeline — Timeline visual GS1 de trazabilidad de lote/batch.
 * Cubre los 6 hitos: recepción → almacenamiento → preparación unidosis →
 * dispensación → administración → paciente final.
 *
 * WCAG 2.2 AA: contraste tokens semánticos, role="list", aria-label en
 * cada hito, indicador de estado visible + icónico.
 */
import * as React from "react";

// cn inline — sin dependencia de @his/ui/lib/utils en contexto de tests.
function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

const dtFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "short",
  timeStyle: "short",
});

function fmt(ts: Date | string | null | undefined): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : dtFmt.format(d);
}

// ─── Tipos públicos ────────────────────────────────────────────────────────

export interface LotTraceStep {
  /** Identificador único del hito — usado como key y data-testid. */
  id:
    | "recepcion"
    | "almacenamiento"
    | "unidosis"
    | "dispensacion"
    | "administracion"
    | "paciente";
  /** Label mostrado al usuario. */
  label: string;
  /** Descripción corta del hito. */
  description: string;
  /** Timestamp del evento. null = pendiente. */
  occurredAt: Date | string | null | undefined;
  /** Referencia contextual (nro factura, ubicación bodega, orden, etc.) */
  reference?: string | null;
}

export interface LotTraceTimelineProps {
  steps: LotTraceStep[];
}

// ─── Configuración de hitos en orden GS1 ──────────────────────────────────

export const GS1_STEPS: Pick<LotTraceStep, "id" | "label" | "description">[] = [
  {
    id: "recepcion",
    label: "Recepción",
    description: "Ingreso físico al almacén (GS1 SSCC)",
  },
  {
    id: "almacenamiento",
    label: "Almacenamiento",
    description: "Ubicación en bodega FEFO",
  },
  {
    id: "unidosis",
    label: "Preparación unidosis",
    description: "Re-etiquetado / dispensación unitaria",
  },
  {
    id: "dispensacion",
    label: "Dispensación",
    description: "Entrega a servicio clínico",
  },
  {
    id: "administracion",
    label: "Administración",
    description: "BCMA — triple-scan enfermería",
  },
  {
    id: "paciente",
    label: "Paciente final",
    description: "Confirmación de administración exitosa",
  },
];

// ─── Componente ────────────────────────────────────────────────────────────

export function LotTraceTimeline({ steps }: LotTraceTimelineProps) {
  if (steps.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Sin eventos de trazabilidad registrados.
      </p>
    );
  }

  return (
    <ol
      aria-label="Línea de tiempo de trazabilidad GS1"
      className="relative ml-3 space-y-0 border-l border-border"
      role="list"
    >
      {steps.map((step, idx) => {
        const formattedAt = fmt(step.occurredAt);
        const done = formattedAt !== null;
        const isLast = idx === steps.length - 1;

        return (
          <li
            key={step.id}
            role="listitem"
            className={cn("ml-4 pb-5", isLast && "pb-0")}
            data-testid={`lot-step-${step.id}`}
          >
            {/* Indicador de estado — aria-hidden porque el estado se enuncia en el texto */}
            <div
              aria-hidden="true"
              className={cn(
                "absolute -left-1.5 mt-1 h-3 w-3 rounded-full border-2",
                done
                  ? "border-primary bg-primary"
                  : "border-muted-foreground bg-background",
              )}
            />

            <div className="space-y-0.5">
              {/* Hito + estado accesible */}
              <p
                className={cn(
                  "text-sm font-semibold leading-tight",
                  !done && "text-muted-foreground",
                )}
                aria-label={`${step.label}: ${done ? formattedAt : "pendiente"}`}
              >
                {step.label}
                {done ? (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {formattedAt}
                  </span>
                ) : (
                  <span className="ml-2 text-xs font-normal italic text-muted-foreground">
                    Pendiente
                  </span>
                )}
              </p>

              <p className="text-xs text-muted-foreground">{step.description}</p>

              {step.reference && (
                <p
                  className="font-mono text-xs text-foreground/70"
                  data-testid={`lot-step-${step.id}-ref`}
                >
                  Ref: {step.reference}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
