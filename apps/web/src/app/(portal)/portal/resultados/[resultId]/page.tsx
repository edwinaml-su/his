"use client";

/**
 * Portal — Detalle de Resultado de Lab (US.B20.2.2).
 * Muestra valor + rango referencia + flag (NORMAL/HIGH/LOW/CRITICAL).
 * WCAG AA.
 */
import { useParams, useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/react";

const FLAG_LABEL: Record<string, string> = {
  NORMAL: "Normal",
  LOW: "Bajo",
  HIGH: "Alto",
  CRITICAL_LOW: "Crítico bajo",
  CRITICAL_HIGH: "Crítico alto",
  ABNORMAL: "Anormal",
};

const FLAG_CLASS: Record<string, string> = {
  NORMAL: "bg-green-100 text-green-800",
  LOW: "bg-yellow-100 text-yellow-800",
  HIGH: "bg-yellow-100 text-yellow-800",
  CRITICAL_LOW: "bg-red-100 text-red-800 font-bold",
  CRITICAL_HIGH: "bg-red-100 text-red-800 font-bold",
  ABNORMAL: "bg-orange-100 text-orange-800",
};

function isCritical(flag: string) {
  return flag === "CRITICAL_LOW" || flag === "CRITICAL_HIGH";
}

export default function DetalleResultadoPage() {
  const { resultId } = useParams<{ resultId: string }>();
  const router = useRouter();

  const { data, isLoading, isError } = trpc.portal.hce.labResults.get.useQuery({ resultId });

  if (isLoading) {
    return (
      <p className="text-sm text-slate-500" aria-busy="true">
        Cargando resultado...
      </p>
    );
  }

  if (isError || !data) {
    return (
      <div className="space-y-4">
        <p role="alert" className="text-sm text-red-600">
          Resultado no encontrado o sin acceso.
        </p>
        <button
          onClick={() => router.back()}
          className="text-sm text-blue-600 hover:underline"
        >
          Volver
        </button>
      </div>
    );
  }

  const test = data.orderItem.test;
  const valueDisplay =
    data.valueNumeric != null
      ? `${Number(data.valueNumeric).toFixed(2)} ${test.unit ?? ""}`
      : (data.valueText ?? "—");

  return (
    <article className="space-y-6" aria-labelledby="resultado-titulo">
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.back()}
          aria-label="Volver a resultados"
          className="text-slate-400 hover:text-slate-600"
        >
          &#8592;
        </button>
        <h1 id="resultado-titulo" className="text-xl font-semibold text-slate-800">
          {test.name}
        </h1>
      </div>

      {isCritical(data.flag) && (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700"
        >
          Este resultado tiene un valor crítico. Consulte con su médico a la brevedad.
        </div>
      )}

      <div className="rounded-xl border bg-white p-6 space-y-4">
        {/* Valor principal */}
        <div>
          <p className="text-xs text-slate-500 mb-1">Resultado</p>
          <p className="text-3xl font-bold text-slate-800">{valueDisplay}</p>
        </div>

        {/* Flag */}
        <div>
          <span
            className={`inline-block rounded-full px-3 py-1 text-sm ${FLAG_CLASS[data.flag] ?? "bg-slate-100 text-slate-600"}`}
          >
            {FLAG_LABEL[data.flag] ?? data.flag}
          </span>
        </div>

        {/* Rango de referencia */}
        {(test.refRangeLow != null || test.refRangeHigh != null) && (
          <div className="text-sm text-slate-600">
            <p className="text-xs text-slate-400 mb-0.5">Rango de referencia</p>
            {test.refRangeLow != null && test.refRangeHigh != null
              ? `${test.refRangeLow} – ${test.refRangeHigh} ${test.unit ?? ""}`
              : test.refRangeHigh != null
              ? `< ${test.refRangeHigh} ${test.unit ?? ""}`
              : `> ${test.refRangeLow} ${test.unit ?? ""}`}
          </div>
        )}

        {/* Notas */}
        {data.notes && (
          <div className="text-sm text-slate-600">
            <p className="text-xs text-slate-400 mb-0.5">Observaciones</p>
            <p>{data.notes}</p>
          </div>
        )}

        {/* Fechas */}
        <div className="text-xs text-slate-400 space-y-0.5">
          <p>
            Validado:{" "}
            {data.validatedAt
              ? new Date(data.validatedAt).toLocaleString("es-SV")
              : "—"}
          </p>
          <p>
            Resultó:{" "}
            {new Date(data.resultedAt).toLocaleString("es-SV")}
          </p>
        </div>
      </div>

      <p className="text-xs text-slate-400 text-center">
        Estos resultados son informativos. Consulte con su médico para su interpretación.
      </p>
    </article>
  );
}
