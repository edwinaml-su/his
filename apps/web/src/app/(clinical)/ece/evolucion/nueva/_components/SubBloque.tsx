"use client";

/**
 * §6/§10 — sub-bloque de sección (Signos vitales, Registro de objetivo,
 * Antecedentes, Plan de manejo, Misceláneos): título en teal + píldora de
 * obligatoriedad + acción a la derecha, sobre un cuerpo libre.
 */

import * as React from "react";
import { SUBTITULO_TEAL } from "../_lib/avante-palette";

/** §3 — píldora "Obligatorio" (rojo soft). */
function ReqPill() {
  return (
    <span className="inline-flex items-center rounded-md border border-[#fecaca] bg-[#fee2e2] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#dc2626] dark:border-[#5a2326] dark:bg-[#2a1314] dark:text-[#f87171]">
      Obligatorio
    </span>
  );
}

/** §3 — etiqueta "Opcional" (atenuada). */
function OptTag() {
  return (
    <span className="inline-flex items-center rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
      Opcional
    </span>
  );
}

interface Props {
  /** Título del sub-bloque (teal, mayúsculas vía clase). */
  titulo: string;
  /** Píldora de obligatoriedad (§6/§10). */
  pill?: "obligatorio" | "opcional";
  /** Acción a la derecha del encabezado (p. ej. botón Editar). */
  accion?: React.ReactNode;
  children: React.ReactNode;
}

export function SubBloque({ titulo, pill, accion, children }: Props) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className={SUBTITULO_TEAL}>{titulo}</h3>
          {pill === "obligatorio" && <ReqPill />}
          {pill === "opcional" && <OptTag />}
        </div>
        {accion}
      </div>
      {children}
    </section>
  );
}
