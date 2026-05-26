"use client";

/**
 * Portal — Resultados de Laboratorio (US.B20.2.2).
 * Agrupa por fecha del resultado. Solo VALIDATED (validatedAt != null).
 * WCAG AA: semántica + aria.
 *
 * Gap §5.2: showInPortal / confidential no implementado —
 * se muestran todos los resultados validados.
 */
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc/react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@his/trpc";

type LabResultItem =
  inferRouterOutputs<AppRouter>["portal"]["hce"]["labResults"]["list"][number];

const FLAG_LABEL: Record<string, string> = {
  NORMAL: "Normal",
  LOW: "Bajo",
  HIGH: "Alto",
  CRITICAL_LOW: "Crítico bajo",
  CRITICAL_HIGH: "Crítico alto",
  ABNORMAL: "Anormal",
};

const FLAG_CLASS: Record<string, string> = {
  NORMAL: "bg-green-100 text-green-700",
  LOW: "bg-yellow-100 text-yellow-700",
  HIGH: "bg-yellow-100 text-yellow-700",
  CRITICAL_LOW: "bg-red-100 text-red-700 font-bold",
  CRITICAL_HIGH: "bg-red-100 text-red-700 font-bold",
  ABNORMAL: "bg-orange-100 text-orange-700",
};

function groupByDate(results: LabResultItem[]) {
  const groups: Record<string, LabResultItem[]> = {};
  for (const r of results) {
    const key = new Date(r.resultedAt).toLocaleDateString("es-SV", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    (groups[key] ??= []).push(r);
  }
  return Object.entries(groups);
}

export default function ResultadosPage() {
  const searchParams = useSearchParams();
  const wardPatientId = searchParams.get("wardPatientId") ?? undefined;

  const { data, isLoading, isError } = trpc.portal.hce.labResults.list.useQuery(
    wardPatientId ? { wardPatientId } : {},
  );

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-800">Resultados de laboratorio</h1>
      <p className="text-sm text-slate-500">
        Solo se muestran resultados validados por el laboratorio.
      </p>

      {isLoading && (
        <p className="text-sm text-slate-500" aria-busy="true">
          Cargando resultados...
        </p>
      )}
      {isError && (
        <p role="alert" className="text-sm text-red-600">
          Error al cargar resultados. Intente de nuevo.
        </p>
      )}
      {data && data.length === 0 && (
        <p className="text-sm text-slate-500">
          No tiene resultados de laboratorio disponibles.
        </p>
      )}
      {data && data.length > 0 && (
        <div className="space-y-6" aria-live="polite">
          {groupByDate(data).map(([date, items]) => (
            <section key={date} aria-labelledby={`date-${date}`}>
              <h2
                id={`date-${date}`}
                className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2"
              >
                {date}
              </h2>
              <ul className="space-y-2">
                {items.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/portal/resultados/${r.id}${wardPatientId ? `?wardPatientId=${wardPatientId}` : ""}`}
                      className="flex items-center justify-between rounded-xl border bg-white p-4 hover:shadow-sm transition-shadow"
                      aria-label={`Ver detalle: ${r.orderItem.test.name}`}
                    >
                      <span className="font-medium text-slate-800">
                        {r.orderItem.test.name}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${FLAG_CLASS[r.flag] ?? "bg-slate-100 text-slate-600"}`}
                      >
                        {FLAG_LABEL[r.flag] ?? r.flag}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
