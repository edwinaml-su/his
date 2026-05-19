"use client";

/**
 * StatEventsDashboardClient — Tabla y agregados de eventos STAT (US.F2.6.47).
 *
 * Requiere rol DIR. Los datos vienen de bedside-stat.monthlyReport.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc/react";

const MOTIVO_LABELS: Record<string, string> = {
  PARO_CARDIORRESPIRATORIO: "Paro cardiorrespiratorio",
  HIPOGLUCEMIA_SEVERA:      "Hipoglucemia severa",
  ANAFILAXIA:               "Anafilaxia",
  OTRO_URGENTE:             "Otro urgente",
};

interface StatEventsDashboardClientProps {
  orgId: string;
}

export function StatEventsDashboardClient({ orgId }: StatEventsDashboardClientProps) {
  const now = new Date();
  const [mes, setMes]   = useState(now.getMonth() + 1);
  const [anio, setAnio] = useState(now.getFullYear());

  const { data, isLoading, error } = trpc.bedsideStat.monthlyReport.useQuery(
    { organizationId: orgId, mes, anio },
    { enabled: !!orgId },
  );

  const handleMesChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setMes(Number(e.target.value));
  };
  const handleAnioChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseInt(e.target.value, 10);
    if (v >= 2020 && v <= 2100) setAnio(v);
  };

  if (!orgId) {
    return (
      <p className="text-sm text-gray-500">
        No se detectó la organización en la sesión. Vuelva a iniciar sesión.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
        <div>
          <label htmlFor="stat-mes" className="block text-xs font-semibold text-gray-600">
            Mes
          </label>
          <select
            id="stat-mes"
            value={mes}
            onChange={handleMesChange}
            className="mt-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {new Date(2024, m - 1).toLocaleString("es-SV", { month: "long" })}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="stat-anio" className="block text-xs font-semibold text-gray-600">
            Año
          </label>
          <input
            id="stat-anio"
            type="number"
            min={2020}
            max={2100}
            value={anio}
            onChange={handleAnioChange}
            className="mt-1 w-24 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
          />
        </div>
      </div>

      {isLoading && (
        <p className="text-sm text-gray-500" role="status" aria-live="polite">
          Cargando...
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error.message}
        </p>
      )}

      {data && (
        <>
          {/* Resumen por motivo */}
          <section aria-labelledby="stat-summary-heading">
            <h2 id="stat-summary-heading" className="mb-3 text-base font-semibold text-gray-800">
              Resumen — {data.total} eventos
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {data.porMotivo.map((item) => (
                <div
                  key={item.motivo}
                  className="rounded-xl border border-red-100 bg-red-50 p-4"
                >
                  <p className="text-xs font-medium text-red-600">
                    {MOTIVO_LABELS[item.motivo] ?? item.motivo}
                  </p>
                  <p className="mt-1 text-2xl font-extrabold text-red-800">{item.total}</p>
                  {item.conBypass > 0 && (
                    <p className="text-xs text-red-500">{item.conBypass} con bypass</p>
                  )}
                </div>
              ))}
              {data.porMotivo.length === 0 && (
                <p className="col-span-4 text-sm text-gray-500">
                  Sin eventos STAT en este período.
                </p>
              )}
            </div>
          </section>

          {/* Drill-down */}
          {data.eventos.length > 0 && (
            <section aria-labelledby="stat-detail-heading">
              <h2 id="stat-detail-heading" className="mb-3 text-base font-semibold text-gray-800">
                Detalle
              </h2>
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-gray-600">Fecha</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-600">Motivo</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-600">Bypasses</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-600">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {data.eventos.map((ev) => (
                      <tr key={ev.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-mono text-xs">
                          {new Date(ev.activadoEn).toLocaleString("es-SV")}
                        </td>
                        <td className="px-3 py-2">
                          {MOTIVO_LABELS[ev.motivo] ?? ev.motivo}
                          {ev.motivoLibre && (
                            <span className="ml-1 text-xs text-gray-500">
                              ({ev.motivoLibre.slice(0, 40)})
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {Array.isArray(ev.hardStopsBypassed) && ev.hardStopsBypassed.length > 0
                            ? (ev.hardStopsBypassed as string[]).join(", ")
                            : <span className="text-gray-400">Ninguno</span>
                          }
                        </td>
                        <td className="px-3 py-2">
                          {ev.completado ? (
                            <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                              Completado
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
                              Abierto
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
