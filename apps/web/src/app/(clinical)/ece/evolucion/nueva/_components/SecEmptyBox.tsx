"use client";

/**
 * §9 — estado vacío de los campos SOAP de texto (Subjetivo, Registro de objetivo
 * y Evaluación / Análisis): cuadro punteado de 7 líneas (min-height 168px),
 * clickeable, que abre el modal de registro. Placeholder "Sin registrar" arriba
 * a la izquierda y cue "+ Registrar {sección}" abajo a la derecha en el color de
 * la sección. (Signos vitales NO usa este patrón; conserva su botón propio.)
 */

import * as React from "react";

interface Props {
  /** Sustantivo de la sección (p. ej. "subjetivo" → "+ Registrar subjetivo"). */
  cue: string;
  /** Color de acento de la sección (hex) para el cue. */
  color: string;
  onClick: () => void;
}

export function SecEmptyBox({ cue, color, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[168px] w-full flex-col justify-between rounded-[10px] border border-dashed border-border bg-surface-1 p-3.5 text-left transition-colors hover:border-[#0d9488] hover:bg-surface-2"
    >
      <span className="text-sm text-muted-foreground">Sin registrar</span>
      <span className="self-end text-sm font-semibold" style={{ color }}>
        + Registrar {cue}
      </span>
    </button>
  );
}
