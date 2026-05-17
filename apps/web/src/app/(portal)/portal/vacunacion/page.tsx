"use client";

/**
 * Portal — Esquema de Vacunación (US.B20.2.4).
 * Historial de vacunas aplicadas en el establecimiento.
 * WCAG AA.
 */
import { trpc } from "@/lib/trpc/react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@his/trpc";

type Vaccination =
  inferRouterOutputs<AppRouter>["portal"]["hce"]["vaccinations"]["list"][number];

function VaccineCard({ v }: { v: Vaccination }) {
  return (
    <li className="rounded-xl border bg-white p-4 space-y-1 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="font-medium text-slate-800">{v.vaccine.name}</p>
        <span className="rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 text-xs font-medium">
          Dosis {v.doseNumber}
        </span>
      </div>
      <p className="text-sm text-slate-600">
        Aplicada:{" "}
        <span className="font-medium">
          {new Date(v.administeredAt).toLocaleDateString("es-SV", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </span>
      </p>
      {v.lotNumber && (
        <p className="text-xs text-slate-400">Lote: {v.lotNumber}</p>
      )}
      {v.anatomicalSite && (
        <p className="text-xs text-slate-400">Sitio: {v.anatomicalSite}</p>
      )}
      {v.vaccine.scheduleNote && (
        <p className="text-xs text-slate-400 italic">{v.vaccine.scheduleNote}</p>
      )}
    </li>
  );
}

export default function VacunacionPage() {
  const { data, isLoading, isError } = trpc.portal.hce.vaccinations.list.useQuery({});

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-800">Mi esquema de vacunación</h1>
      <p className="text-sm text-slate-500">
        Vacunas registradas en este establecimiento.
      </p>

      {isLoading && (
        <p className="text-sm text-slate-500" aria-busy="true">
          Cargando vacunación...
        </p>
      )}
      {isError && (
        <p role="alert" className="text-sm text-red-600">
          Error al cargar vacunación. Intente de nuevo.
        </p>
      )}
      {data && data.length === 0 && (
        <p className="text-sm text-slate-500">
          No tienes vacunas registradas en este establecimiento. Si las recibiste en otro
          lugar, consulta con tu médico para registrarlas.
        </p>
      )}
      {data && data.length > 0 && (
        <ul className="space-y-3" aria-label="Historial de vacunación" aria-live="polite">
          {data.map((v) => (
            <VaccineCard key={v.id} v={v} />
          ))}
        </ul>
      )}

      <p className="text-xs text-center text-slate-400">
        Consulta con tu pediatra o médico para programar vacunas pendientes según el
        calendario PAI El Salvador.
      </p>
    </div>
  );
}
