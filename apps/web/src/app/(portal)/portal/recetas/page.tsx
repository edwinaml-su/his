"use client";

/**
 * Portal — Recetas Activas (US.B20.2.5).
 * Muestra prescripciones SIGNED y PARTIALLY_DISPENSED con ítems y dispensaciones.
 * WCAG AA.
 */
import { trpc } from "@/lib/trpc/react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@his/trpc";

type Prescription =
  inferRouterOutputs<AppRouter>["portal"]["hce"]["prescriptions"]["list"][number];
type PrescriptionItem = Prescription["items"][number];

const STATUS_LABEL: Record<string, string> = {
  SIGNED: "Vigente",
  PARTIALLY_DISPENSED: "Dispensada parcialmente",
};

const STATUS_CLASS: Record<string, string> = {
  SIGNED: "bg-blue-100 text-blue-700",
  PARTIALLY_DISPENSED: "bg-yellow-100 text-yellow-700",
};

function RxItem({ item }: { item: PrescriptionItem }) {
  return (
    <tr className="border-b last:border-0">
      <td className="py-2 font-medium text-slate-800">
        {item.drug.genericName}
        {item.drug.brandName && (
          <span className="text-xs text-slate-400 ml-1">({item.drug.brandName})</span>
        )}
      </td>
      <td className="py-2 text-slate-600">
        {item.dosage} — {item.frequency}
      </td>
      <td className="py-2 text-slate-600">
        {item.durationDays != null ? `${item.durationDays} días` : "—"}
      </td>
    </tr>
  );
}

export default function RecetasPage() {
  const { data, isLoading, isError } = trpc.portal.hce.prescriptions.list.useQuery({});

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-800">Mis recetas</h1>
      <p className="text-sm text-slate-500">Recetas activas y parcialmente dispensadas.</p>

      {isLoading && (
        <p className="text-sm text-slate-500" aria-busy="true">
          Cargando recetas...
        </p>
      )}
      {isError && (
        <p role="alert" className="text-sm text-red-600">
          Error al cargar recetas. Intente de nuevo.
        </p>
      )}
      {data && data.length === 0 && (
        <p className="text-sm text-slate-500">No tiene recetas activas registradas.</p>
      )}
      {data && data.length > 0 && (
        <ul className="space-y-4" aria-label="Lista de recetas" aria-live="polite">
          {data.map((rx) => (
            <li key={rx.id} className="rounded-xl border bg-white p-5 space-y-3 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-500">
                  Fecha:{" "}
                  <span className="font-medium text-slate-700">
                    {new Date(rx.prescribedAt).toLocaleDateString("es-SV")}
                  </span>
                </p>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[rx.status] ?? "bg-slate-100 text-slate-600"}`}
                >
                  {STATUS_LABEL[rx.status] ?? rx.status}
                </span>
              </div>

              {rx.items.length > 0 && (
                <table
                  className="w-full text-sm border-collapse"
                  aria-label="Medicamentos de la receta"
                >
                  <thead>
                    <tr className="border-b text-left text-xs text-slate-400">
                      <th className="pb-1 font-medium">Medicamento</th>
                      <th className="pb-1 font-medium">Dosis</th>
                      <th className="pb-1 font-medium">Duración</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rx.items.map((item) => (
                      <RxItem key={item.id} item={item} />
                    ))}
                  </tbody>
                </table>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
