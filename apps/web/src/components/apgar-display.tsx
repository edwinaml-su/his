/**
 * ApgarDisplay — presentación read-only de un puntaje Apgar guardado.
 *
 * No hace fetch; el padre le pasa los scores ya cargados.
 * Reusable en epicrisis, resumen RN, historial de atenciones.
 */
import * as React from "react";
import {
  APGAR_CATEGORIES,
  computeApgarTotal,
  classifySeverity,
  type ApgarScores,
  type ApgarSeverity,
} from "./apgar-score-input";

// Clases completas para Tailwind (no interpoladas en runtime)
const BADGE_CLASSES: Record<ApgarSeverity, string> = {
  normal: "bg-green-100 text-green-800 border-green-300",
  moderate: "bg-amber-100 text-amber-800 border-amber-300",
  severe: "bg-red-100 text-red-800 border-red-300",
};

const SEVERITY_LABEL: Record<ApgarSeverity, string> = {
  normal: "Normal",
  moderate: "Depresión moderada",
  severe: "Depresión severa",
};

export interface ApgarDisplayProps {
  scores: ApgarScores;
  /** Etiqueta de momento (ej. "1 min", "5 min"). */
  minuteLabel?: string;
  /** Clases extra para el contenedor raíz. */
  className?: string;
}

export function ApgarDisplay({ scores, minuteLabel, className }: ApgarDisplayProps) {
  const total = computeApgarTotal(scores);
  const severity = classifySeverity(total);

  return (
    <div
      className={`space-y-3 rounded-md border border-border p-4 ${className ?? ""}`}
      data-testid="apgar-display"
    >
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">
          Apgar{minuteLabel ? ` ${minuteLabel}` : ""}
        </h4>
        <span
          className={`rounded border px-2 py-0.5 text-sm font-bold ${BADGE_CLASSES[severity]}`}
          aria-label={`Puntaje Apgar total: ${total} de 10 — ${SEVERITY_LABEL[severity]}`}
          data-testid="apgar-display-total"
        >
          {total}/10 — {SEVERITY_LABEL[severity]}
        </span>
      </div>

      <dl className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
        {APGAR_CATEGORIES.map((cat) => {
          const value = scores[cat.key];
          return (
            <div key={cat.key} className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{cat.label}</dt>
              <dd className="font-medium" aria-label={`${cat.label}: ${value} — ${cat.descriptions[value]}`}>
                {value} <span className="text-xs text-muted-foreground">({cat.descriptions[value]})</span>
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

export default ApgarDisplay;
