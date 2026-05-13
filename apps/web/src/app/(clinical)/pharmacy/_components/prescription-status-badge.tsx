"use client";

/**
 * §15 Pharmacy — Badge de estado de receta.
 *
 * Mapea el enum `PrescriptionStatus` a colores Tailwind. Se inlinean las
 * clases en lugar de extender el componente `Badge` del design system
 * para no contaminar la paleta global con tokens específicos del dominio
 * farmacia (slate/blue/green/yellow/gray/red).
 */
import * as React from "react";

export type PrescriptionStatus =
  | "DRAFT"
  | "SIGNED"
  | "DISPENSED"
  | "PARTIALLY_DISPENSED"
  | "CANCELLED"
  | "EXPIRED";

const STATUS_STYLES: Record<PrescriptionStatus, { label: string; className: string }> = {
  DRAFT: { label: "Borrador", className: "bg-slate-100 text-slate-700" },
  SIGNED: { label: "Firmada", className: "bg-blue-100 text-blue-700" },
  DISPENSED: { label: "Despachada", className: "bg-green-100 text-green-700" },
  PARTIALLY_DISPENSED: { label: "Parcial", className: "bg-yellow-100 text-yellow-800" },
  CANCELLED: { label: "Anulada", className: "bg-gray-100 text-gray-500" },
  EXPIRED: { label: "Vencida", className: "bg-red-100 text-red-700" },
};

interface PrescriptionStatusBadgeProps {
  status: PrescriptionStatus;
  className?: string;
}

export function PrescriptionStatusBadge({
  status,
  className,
}: PrescriptionStatusBadgeProps): React.ReactElement {
  const cfg = STATUS_STYLES[status];
  return (
    <span
      className={[
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
        cfg.className,
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={`Estado de receta: ${cfg.label}`}
    >
      {cfg.label}
    </span>
  );
}
