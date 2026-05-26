"use client";

/**
 * Portal — Mis Citas (US.B20.2.1).
 * Tabs: Próximas / Pasadas.
 * WCAG AA: roles, aria-labels, contraste Tailwind.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc/react";

type Tab = "proximas" | "pasadas";

function formatDate(d: Date | string) {
  return new Date(d).toLocaleString("es-SV", {
    timeZone: "America/El_Salvador",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_LABEL: Record<string, string> = {
  SCHEDULED: "Programada",
  CONFIRMED: "Confirmada",
  CHECKED_IN: "En sala",
  COMPLETED: "Completada",
  NO_SHOW: "No asistió",
  CANCELLED: "Cancelada",
};

function statusBadgeClass(status: string) {
  if (status === "CANCELLED" || status === "NO_SHOW") return "bg-red-100 text-red-700";
  if (status === "COMPLETED") return "bg-green-100 text-green-700";
  return "bg-blue-100 text-blue-700";
}

export default function CitasPage() {
  const [tab, setTab] = useState<Tab>("proximas");

  const upcoming = trpc.portal.hce.appointments.upcoming.useQuery({});
  const past = trpc.portal.hce.appointments.list.useQuery(
    { upcoming: false },
    { enabled: tab === "pasadas" },
  );

  const current = tab === "proximas" ? upcoming : past;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-800">Mis citas</h1>

      {/* Tabs */}
      <div role="tablist" aria-label="Filtro de citas" className="flex gap-2 border-b">
        {(["proximas", "pasadas"] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t === "proximas" ? "Próximas" : "Pasadas"}
          </button>
        ))}
      </div>

      {/* Contenido */}
      <div role="tabpanel" aria-live="polite">
        {current.isLoading && (
          <p className="text-sm text-slate-500" aria-busy="true">
            Cargando citas...
          </p>
        )}
        {current.isError && (
          <p role="alert" className="text-sm text-red-600">
            Error al cargar citas. Intente de nuevo.
          </p>
        )}
        {current.data && current.data.length === 0 && (
          <p className="text-sm text-slate-500">
            {tab === "proximas"
              ? "No tiene citas próximas programadas."
              : "No se encontraron citas pasadas."}
          </p>
        )}
        {current.data && current.data.length > 0 && (
          <ul className="space-y-3" aria-label="Lista de citas">
            {current.data.map((appt) => (
              <li
                key={appt.id}
                className="rounded-xl border bg-white p-4 space-y-1 shadow-sm"
              >
                <p className="font-medium text-slate-800">
                  {formatDate(appt.scheduledAt)}
                </p>
                {appt.provider && (
                  <p className="text-sm text-slate-600">
                    Médico:{" "}
                    <span className="font-medium">{appt.provider.fullName}</span>
                  </p>
                )}
                {appt.reason && (
                  <p className="text-sm text-slate-500">Motivo: {appt.reason}</p>
                )}
                <p className="text-xs">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 font-medium ${statusBadgeClass(appt.status)}`}
                  >
                    {STATUS_LABEL[appt.status] ?? appt.status}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
