"use client";

/**
 * Timeline visual de timestamps intra-operatorios de un SurgeryCase.
 * Muestra los hitos clave: signIn, timeOut, inicio real, signOut, fin real.
 */
import * as React from "react";

// cn inline para evitar dependencia de @his/ui/lib/utils en contexto de tests Vitest
function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

const timeFmt = new Intl.DateTimeFormat("es-SV", {
  timeStyle: "short",
  dateStyle: "short",
});

export interface IntraOpTimelineProps {
  signInAt: Date | string | null | undefined;
  timeOutAt: Date | string | null | undefined;
  actualStart: Date | string | null | undefined;
  signOutAt: Date | string | null | undefined;
  actualEnd: Date | string | null | undefined;
}

interface MilestoneConfig {
  key: keyof IntraOpTimelineProps;
  label: string;
  description: string;
}

const MILESTONES: MilestoneConfig[] = [
  { key: "signInAt",    label: "Sign In",    description: "Verificación inicial OMS" },
  { key: "timeOutAt",   label: "Time-Out",   description: "Verificación pre-incisión OMS" },
  { key: "actualStart", label: "Inicio",     description: "Inicio real de la cirugía" },
  { key: "signOutAt",   label: "Sign Out",   description: "Verificación post-cirugía OMS" },
  { key: "actualEnd",   label: "Fin",        description: "Fin real de la cirugía" },
];

export function formatMilestoneTime(ts: Date | string | null | undefined): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : timeFmt.format(d);
}

export function IntraOpTimeline(props: IntraOpTimelineProps) {
  const anyDone = MILESTONES.some((m) => props[m.key] != null);

  return (
    <div aria-label="Línea de tiempo intra-operatoria" role="list">
      {!anyDone && (
        <p className="text-sm text-muted-foreground">
          Sin eventos intra-operatorios registrados.
        </p>
      )}
      <ol className="relative ml-3 space-y-0 border-l border-muted">
        {MILESTONES.map((m, idx) => {
          const ts = props[m.key];
          const formatted = formatMilestoneTime(ts);
          const done = formatted !== null;
          const isLast = idx === MILESTONES.length - 1;

          return (
            <li
              key={m.key}
              role="listitem"
              className={cn("ml-4 pb-4", isLast && "pb-0")}
            >
              <div
                aria-hidden
                className={cn(
                  "absolute -left-1.5 mt-0.5 h-3 w-3 rounded-full border",
                  done
                    ? "border-primary bg-primary"
                    : "border-muted-foreground bg-background",
                )}
              />
              <div>
                <span className={cn("text-sm font-semibold", !done && "text-muted-foreground")}>
                  {m.label}
                </span>
                <span className="ml-2 text-xs text-muted-foreground">{m.description}</span>
                {formatted ? (
                  <p
                    className="text-sm tabular-nums"
                    data-testid={`timeline-${m.key}`}
                    aria-label={`${m.label}: ${formatted}`}
                  >
                    {formatted}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground italic" data-testid={`timeline-${m.key}`}>
                    Pendiente
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
