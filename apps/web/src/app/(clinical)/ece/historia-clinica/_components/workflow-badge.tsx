"use client";

/**
 * Badge de estado de workflow para Historia Clínica Electrónica (§ECE).
 *
 * Estados BD (lowercase): borrador → firmado → validado → anulado.
 * Acepta tanto lowercase como uppercase para compatibilidad.
 */

const ESTADO_STYLES: Record<string, string> = {
  borrador: "bg-yellow-100 text-yellow-800 border-yellow-200",
  firmado: "bg-blue-100 text-blue-800 border-blue-200",
  validado: "bg-green-100 text-green-800 border-green-200",
  anulado: "bg-red-100 text-red-800 border-red-200",
};

const ESTADO_LABELS: Record<string, string> = {
  borrador: "Borrador",
  firmado: "Firmado",
  validado: "Validado",
  anulado: "Anulado",
};

export function WorkflowBadge({ estado }: { estado: string }) {
  const key = estado.toLowerCase();
  const style = ESTADO_STYLES[key] ?? "bg-gray-100 text-gray-800 border-gray-200";
  const label = ESTADO_LABELS[key] ?? estado;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${style}`}
      aria-label={`Estado: ${label}`}
    >
      {label}
    </span>
  );
}
