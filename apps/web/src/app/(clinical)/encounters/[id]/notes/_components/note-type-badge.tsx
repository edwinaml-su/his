/**
 * §14 EHR Clinical Notes — pill que pinta el tipo de nota.
 *
 * Convención cromática (acordada equipo Lima · Sprint 4):
 *   PROGRESS           — neutro (slate)
 *   ADMISSION          — azul (primer contacto)
 *   DISCHARGE_SUMMARY  — púrpura (cierre administrativo)
 *   CONSULTATION       — cyan (interconsulta)
 *   NURSING            — rosado (rol enfermería)
 *   EMERGENCY          — rojo, bold (atención urgente)
 *
 * Variantes intencionalmente fuera del Badge variants() para no contaminar
 * el design system con tokens clínicos específicos.
 */
import * as React from "react";

const NOTE_TYPES = [
  "PROGRESS",
  "ADMISSION",
  "DISCHARGE_SUMMARY",
  "CONSULTATION",
  "NURSING",
  "EMERGENCY",
] as const;

export type NoteType = (typeof NOTE_TYPES)[number];

const TONES: Record<NoteType, string> = {
  PROGRESS: "bg-slate-100 text-slate-700",
  ADMISSION: "bg-blue-100 text-blue-700",
  DISCHARGE_SUMMARY: "bg-purple-100 text-purple-700",
  CONSULTATION: "bg-cyan-100 text-cyan-700",
  NURSING: "bg-pink-100 text-pink-700",
  EMERGENCY: "bg-red-100 text-red-700 font-bold",
};

const LABELS: Record<NoteType, string> = {
  PROGRESS: "Evolución",
  ADMISSION: "Ingreso",
  DISCHARGE_SUMMARY: "Resumen de alta",
  CONSULTATION: "Interconsulta",
  NURSING: "Enfermería",
  EMERGENCY: "Emergencia",
};

export interface NoteTypeBadgeProps {
  noteType: NoteType;
  className?: string;
}

export function NoteTypeBadge({ noteType, className }: NoteTypeBadgeProps) {
  const tone = TONES[noteType];
  return (
    <span
      className={[
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs",
        tone,
        className ?? "",
      ].join(" ")}
      aria-label={`Tipo de nota: ${LABELS[noteType]}`}
    >
      {LABELS[noteType]}
    </span>
  );
}

export const NOTE_TYPE_OPTIONS: ReadonlyArray<{ value: NoteType; label: string }> =
  NOTE_TYPES.map((v) => ({ value: v, label: LABELS[v] }));
