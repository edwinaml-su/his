"use client";

/**
 * Badge de estado de workflow para Historia Clínica Electrónica (§ECE).
 *
 * Estados: BORRADOR → FIRMADO → VALIDADO.
 * Colores alineados con el sistema de diseño Avante (tokens Tailwind).
 */

export type HcEstado = "BORRADOR" | "FIRMADO" | "VALIDADO";

const ESTADO_STYLES: Record<HcEstado, string> = {
  BORRADOR: "bg-yellow-100 text-yellow-800 border-yellow-200",
  FIRMADO: "bg-blue-100 text-blue-800 border-blue-200",
  VALIDADO: "bg-green-100 text-green-800 border-green-200",
};

const ESTADO_LABELS: Record<HcEstado, string> = {
  BORRADOR: "Borrador",
  FIRMADO: "Firmado",
  VALIDADO: "Validado",
};

export function WorkflowBadge({ estado }: { estado: HcEstado }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${ESTADO_STYLES[estado]}`}
      aria-label={`Estado: ${ESTADO_LABELS[estado]}`}
    >
      {ESTADO_LABELS[estado]}
    </span>
  );
}
