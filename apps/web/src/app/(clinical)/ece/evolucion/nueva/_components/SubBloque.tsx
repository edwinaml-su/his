"use client";

/**
 * §6/§10 — sub-bloque de sección (Signos vitales, Registro de objetivo,
 * Antecedentes, Plan de manejo, Misceláneos): título en teal + píldora de
 * obligatoriedad + acción a la derecha, sobre un cuerpo libre.
 */

import * as React from "react";
import { SUBTITULO_TEAL } from "../_lib/avante-palette";

/** §3 — píldora "Obligatorio" (rojo soft, .req-pill: 10px/700, radio 20px). */
export function ReqPill() {
  return (
    <span className="inline-flex items-center rounded-full border border-[#fecaca] bg-[#fee2e2] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#dc2626] dark:border-[#5a2326] dark:bg-[#2a1314] dark:text-[#f87171]">
      Obligatorio
    </span>
  );
}

/** §3 — etiqueta "Opcional" (atenuada, .opt-tag: radio 999px). */
export function OptTag() {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
      Opcional
    </span>
  );
}

interface Props {
  /** Título del sub-bloque (teal, mayúsculas vía clase). */
  titulo: string;
  /** Ícono teal a la izquierda del título (.subblock__title svg: 16px). */
  icon?: React.ReactNode;
  /** Contador (count-chip) entre el título y la píldora (§11.1 Plan de manejo). */
  count?: React.ReactNode;
  /** Píldora de obligatoriedad (§6/§10). */
  pill?: "obligatorio" | "opcional";
  /** Acción a la derecha del encabezado (p. ej. botón Editar). */
  accion?: React.ReactNode;
  children: React.ReactNode;
}

export function SubBloque({ titulo, icon, count, pill, accion, children }: Props) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className={`inline-flex items-center gap-2 ${SUBTITULO_TEAL}`}>
            {icon}
            {titulo}
          </h3>
          {count}
          {pill === "obligatorio" && <ReqPill />}
          {pill === "opcional" && <OptTag />}
        </div>
        {accion}
      </div>
      {children}
    </section>
  );
}
