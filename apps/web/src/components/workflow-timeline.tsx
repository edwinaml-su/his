"use client";

/**
 * WorkflowTimeline — timeline visual del workflow de documentos ECE.
 *
 * Muestra los pasos del flujo MC firma → ESP valida → DIR certifica con
 * iconografía de estado: completado (verde), en curso (ámbar), bloqueado (gris).
 *
 * Accesibilidad: lista ordenada con role="list", cada paso tiene aria-label.
 * Navegable por teclado vía tabindex en pasos interactivos.
 */

import * as React from "react";
import { CheckCircle2, Clock, Circle, Lock } from "lucide-react";
import { cn } from "@his/ui/lib/utils";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type WorkflowStepStatus = "done" | "current" | "pending" | "blocked";

export interface WorkflowTimelineStep {
  id: string;
  label: string;
  sublabel?: string;
  /** Rol responsable de este paso (ej. "MC", "ESP", "DIR"). */
  rol: string;
  status: WorkflowStepStatus;
  /** Fecha en que se completó el paso, si aplica. */
  completedAt?: Date;
}

interface WorkflowTimelineProps {
  steps: WorkflowTimelineStep[];
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_ICON: Record<WorkflowStepStatus, React.ReactNode> = {
  done: (
    <CheckCircle2
      className="h-5 w-5 text-green-600 dark:text-green-400"
      aria-hidden
    />
  ),
  current: (
    <Clock
      className="h-5 w-5 text-amber-500 dark:text-amber-400"
      aria-hidden
    />
  ),
  pending: (
    <Circle
      className="h-5 w-5 text-muted-foreground/40"
      aria-hidden
    />
  ),
  blocked: (
    <Lock
      className="h-5 w-5 text-muted-foreground/30"
      aria-hidden
    />
  ),
};

const STATUS_LABEL: Record<WorkflowStepStatus, string> = {
  done: "completado",
  current: "en curso",
  pending: "pendiente",
  blocked: "bloqueado",
};

const DATE_FMT = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "medium",
  timeStyle: "short",
});

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function WorkflowTimeline({ steps, className }: WorkflowTimelineProps) {
  return (
    <ol
      role="list"
      aria-label="Pasos del workflow"
      className={cn("space-y-0", className)}
    >
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;
        const ariaLabel = `Paso ${index + 1}: ${step.label} — ${STATUS_LABEL[step.status]}`;

        return (
          <li
            key={step.id}
            aria-label={ariaLabel}
            className="relative flex gap-3"
          >
            {/* Línea vertical conectora */}
            {!isLast && (
              <div
                aria-hidden
                className={cn(
                  "absolute left-[9px] top-5 h-full w-0.5",
                  step.status === "done"
                    ? "bg-green-200 dark:bg-green-800"
                    : "bg-border",
                )}
              />
            )}

            {/* Icono de estado */}
            <div className="relative z-10 flex h-5 w-5 shrink-0 items-center justify-center">
              {STATUS_ICON[step.status]}
            </div>

            {/* Contenido del paso */}
            <div className={cn("pb-5", isLast && "pb-0")}>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "text-sm font-medium leading-none",
                    step.status === "done" && "text-foreground",
                    step.status === "current" && "text-amber-700 dark:text-amber-400",
                    (step.status === "pending" || step.status === "blocked") &&
                      "text-muted-foreground",
                  )}
                >
                  {step.label}
                </span>
                <span
                  className="rounded-full border px-1.5 py-0.5 text-xs text-muted-foreground"
                  aria-hidden
                >
                  {step.rol}
                </span>
              </div>

              {step.sublabel && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {step.sublabel}
                </p>
              )}

              {step.completedAt && (
                <p className="mt-0.5 tabular-nums text-xs text-muted-foreground">
                  {DATE_FMT.format(step.completedAt)}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Helper para construir steps desde estado_workflow ECE
// ---------------------------------------------------------------------------

export type EpicrisisEstado =
  | "borrador"
  | "firmado"
  | "validado"
  | "certificado"
  | "anulado";

interface EpicrisisWorkflowDates {
  firmadoEn?: Date | null;
  validadoEn?: Date | null;
  certificadoEn?: Date | null;
}

export function buildEpicrisisSteps(
  estado: EpicrisisEstado,
  dates: EpicrisisWorkflowDates = {},
): WorkflowTimelineStep[] {
  const ORDER: EpicrisisEstado[] = ["borrador", "firmado", "validado", "certificado"];
  const currentIndex = ORDER.indexOf(estado);

  function stepStatus(stepEstado: EpicrisisEstado): WorkflowStepStatus {
    const stepIndex = ORDER.indexOf(stepEstado);
    if (estado === "anulado") return "blocked";
    if (stepIndex < currentIndex) return "done";
    if (stepIndex === currentIndex) return "current";
    return "pending";
  }

  return [
    {
      id: "firma-mc",
      label: "Firma MC",
      sublabel: "Médico tratante firma el documento",
      rol: "MC",
      status: stepStatus("firmado"),
      completedAt: dates.firmadoEn ?? undefined,
    },
    {
      id: "validacion-esp",
      label: "Validación ESP",
      sublabel: "Especialista / Jefe de Servicio valida",
      rol: "ESP",
      status: stepStatus("validado"),
      completedAt: dates.validadoEn ?? undefined,
    },
    {
      id: "certificacion-dir",
      label: "Certificación DIR",
      sublabel: "Director Médico certifica — Art. 21 NTEC",
      rol: "DIR",
      status: stepStatus("certificado"),
      completedAt: dates.certificadoEn ?? undefined,
    },
  ];
}
