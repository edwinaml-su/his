"use client";

/**
 * Badge de estado para citas ambulatorias (§10 Outpatient).
 *
 * Mapea `AppointmentStatus` (Prisma enum) a clases Tailwind. Evita usar
 * `Badge` de shadcn aquí para tener control fino sobre line-through en
 * CANCELLED y mantener el componente trivial sin dependencias UI.
 */

export type AppointmentStatus =
  | "SCHEDULED"
  | "CONFIRMED"
  | "CHECKED_IN"
  | "NO_SHOW"
  | "COMPLETED"
  | "CANCELLED";

const STATUS_STYLES: Record<AppointmentStatus, string> = {
  SCHEDULED: "bg-slate-100 text-slate-700",
  CONFIRMED: "bg-blue-100 text-blue-700",
  CHECKED_IN: "bg-yellow-100 text-yellow-700",
  NO_SHOW: "bg-red-100 text-red-700",
  COMPLETED: "bg-green-100 text-green-700",
  CANCELLED: "bg-gray-100 text-gray-500 line-through",
};

const STATUS_LABELS: Record<AppointmentStatus, string> = {
  SCHEDULED: "Programada",
  CONFIRMED: "Confirmada",
  CHECKED_IN: "Recibido",
  NO_SHOW: "No se presentó",
  COMPLETED: "Completada",
  CANCELLED: "Cancelada",
};

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
      aria-label={`Estado: ${STATUS_LABELS[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
