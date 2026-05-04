"use client";

/**
 * US-6.6 — Card individual de triage en el whiteboard.
 *
 * Equipo Sierra. Cada card recibe un `TriageQueueItem` y renderiza:
 *  - Banner color del nivel Manchester.
 *  - Identificación: nombre + MRN + edad + flag NN.
 *  - Cronómetro prominente (TriageTimer).
 *  - Acciones: Re-triage, Discriminadores, Ver paciente.
 *  - Sugerencia visible cuando severity === CRITICAL.
 *
 * El detector de re-triage automático vive en el cliente (acuerdo Sprint 6):
 * cuando el TriageTimer cruza a CRITICAL, este card invoca `onCritical()`
 * (lo recibe del padre) para que el QueueList pueda pulsar el beep
 * compartido — así el sonido NO suena 3 veces si hay 3 críticos
 * simultáneos en pantalla.
 */
import * as React from "react";
import Link from "next/link";
import { TriageTimer, type TriageTimerSeverity } from "@/components/triage-timer";

// Tipo aliviado para no acoplarnos a `@his/contracts/...` (Sierra no toca el
// barrel). Refleja lo que devuelve `triageDashboard.queueWithTimers`.
export interface TriageCardItem {
  id: string;
  patient: {
    id: string;
    firstName: string;
    lastName: string;
    mrn: string;
    ageYears: number | null;
    isUnknown: boolean;
  };
  encounterId: string | null;
  serviceUnit: { id: string; name: string } | null;
  assignedLevel: {
    id: string;
    color: "RED" | "ORANGE" | "YELLOW" | "GREEN" | "BLUE";
    name: string;
    priority: number;
    maxWaitMinutes: number;
    uiColorHex: string | null;
  };
  status: string;
  startedAt: Date | string;
  reTriageCount: number;
  elapsedMinutes: number;
  remainingMinutes: number;
  isOverdue: boolean;
  severity: TriageTimerSeverity;
}

const COLOR_CLASS: Record<TriageCardItem["assignedLevel"]["color"], string> = {
  RED: "bg-red-600 text-white",
  ORANGE: "bg-orange-500 text-white",
  YELLOW: "bg-yellow-400 text-black",
  GREEN: "bg-green-500 text-white",
  BLUE: "bg-blue-500 text-white",
};

interface TriageCardProps {
  item: TriageCardItem;
  serverNow?: Date | string | null;
  /** Disparado por el timer cuando entra a CRITICAL en el cliente. */
  onCritical?: (id: string) => void;
}

export function TriageCard({ item, serverNow, onCritical }: TriageCardProps) {
  const handleSeverity = React.useCallback(
    (s: TriageTimerSeverity) => {
      if (s === "CRITICAL") onCritical?.(item.id);
    },
    [item.id, onCritical],
  );

  const fullName = `${item.patient.firstName} ${item.patient.lastName}`.trim();
  const ageLabel =
    item.patient.ageYears != null ? `${item.patient.ageYears}a` : "edad ?";

  return (
    <article
      className="flex h-full flex-col overflow-hidden rounded-lg border bg-card shadow-sm"
      aria-labelledby={`triage-card-${item.id}-name`}
    >
      <header
        className={[
          "flex items-center justify-between px-3 py-2 text-sm font-semibold uppercase tracking-wide",
          COLOR_CLASS[item.assignedLevel.color],
        ].join(" ")}
      >
        <span>{item.assignedLevel.name}</span>
        <span className="text-xs opacity-90">P{item.assignedLevel.priority}</span>
      </header>

      <div className="flex flex-1 flex-col gap-3 p-3">
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <h3
              id={`triage-card-${item.id}-name`}
              className="truncate text-base font-semibold"
            >
              {fullName}
            </h3>
            <span className="text-xs text-muted-foreground">{ageLabel}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{item.patient.mrn}</span>
            {item.patient.isUnknown && (
              <span
                className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                title="Paciente no identificado"
              >
                NN
              </span>
            )}
            {item.reTriageCount > 0 && (
              <span
                className="rounded bg-purple-100 px-1.5 py-0.5 text-purple-900 dark:bg-purple-950 dark:text-purple-200"
                title="Re-triages encadenados"
              >
                Re-triage x{item.reTriageCount}
              </span>
            )}
          </div>
          {item.serviceUnit && (
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {item.serviceUnit.name}
            </p>
          )}
        </div>

        <div className="flex items-center justify-center">
          <TriageTimer
            startedAt={item.startedAt}
            maxWaitMinutes={item.assignedLevel.maxWaitMinutes}
            serverNow={serverNow}
            onSeverityChange={handleSeverity}
            className="min-w-[7rem]"
          />
        </div>

        {item.severity === "CRITICAL" && (
          <p
            role="alert"
            className="rounded border border-red-300 bg-red-50 px-2 py-1 text-center text-xs font-medium text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
          >
            Re-triage requerido — tiempo Manchester excedido.
          </p>
        )}

        <nav
          className="mt-auto grid grid-cols-3 gap-1.5 text-xs"
          aria-label={`Acciones para ${fullName}`}
        >
          <Link
            href={`/triage/${item.id}/vitals`}
            className="rounded border border-input px-2 py-1.5 text-center hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            Re-triage
          </Link>
          <Link
            href={`/triage/${item.id}/discriminators`}
            className="rounded border border-input px-2 py-1.5 text-center hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            Discrim.
          </Link>
          <Link
            href={`/patients/${item.patient.id}`}
            className="rounded border border-input px-2 py-1.5 text-center hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            Paciente
          </Link>
        </nav>
      </div>
    </article>
  );
}
