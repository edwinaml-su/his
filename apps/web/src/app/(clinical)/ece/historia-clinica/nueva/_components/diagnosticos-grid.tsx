"use client";

/**
 * DiagnosticosGrid — RF-08.
 * BuscadorCie11 + grid con tipo por fila + complemento por fila.
 * G-05: sin duplicados. RN-03: ≥1 COMPLEMENTARIO al firmar.
 */

import * as React from "react";
import {
  TIPO_DIAGNOSTICO,
  TIPO_DIAGNOSTICO_LABELS,
  type Cie11Diagnostico,
  type TipoDiagnostico,
} from "@his/contracts";
import { BuscadorCie11 } from "@/components/cie11/BuscadorCie11";
import { toUpper } from "./utils";

interface DiagnosticosGridProps {
  value: Cie11Diagnostico[];
  onChange: (v: Cie11Diagnostico[]) => void;
  disabled?: boolean;
  invalid?: boolean;
}

export function DiagnosticosGrid({
  value,
  onChange,
  disabled,
  invalid,
}: DiagnosticosGridProps) {
  const [duplicateError, setDuplicateError] = React.useState("");

  function handleSelect(d: { codigo: string; titulo: string }) {
    if (value.some((x) => x.codigo === d.codigo)) {
      setDuplicateError(`${d.codigo} ya está agregado.`);
      return;
    }
    setDuplicateError("");
    onChange([...value, { codigo: d.codigo, descripcion: d.titulo, tipo: "PRESUNTIVO", complemento: "" }]);
  }

  function updateTipo(i: number, tipo: TipoDiagnostico) {
    onChange(value.map((d, j) => (j === i ? { ...d, tipo } : d)));
  }

  function updateComplemento(i: number, complemento: string) {
    onChange(value.map((d, j) => (j === i ? { ...d, complemento: toUpper(complemento) } : d)));
  }

  function eliminar(i: number) {
    onChange(value.filter((_, j) => j !== i));
  }

  return (
    <div className="space-y-3">
      <div>
        <BuscadorCie11 disabled={disabled} onSelect={handleSelect} />
        {duplicateError && (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
            {duplicateError}
          </p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          Seleccione un resultado para agregarlo. Puede registrar varios diagnósticos.
        </p>
      </div>

      <div
        className={[
          "overflow-hidden rounded-md border",
          invalid ? "border-destructive ring-2 ring-destructive/20" : "border-border",
        ].join(" ")}
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-xs text-muted-foreground">
              <th className="px-3 py-2 text-left font-semibold uppercase tracking-wide" style={{ width: 90 }}>Código</th>
              <th className="px-3 py-2 text-left font-semibold uppercase tracking-wide">Descripción</th>
              <th className="px-3 py-2 text-left font-semibold uppercase tracking-wide" style={{ width: 140 }}>Tipo</th>
              <th className="px-3 py-2 text-left font-semibold uppercase tracking-wide" style={{ width: 230 }}>Complemento</th>
              <th className="px-3 py-2" style={{ width: 50 }} />
            </tr>
          </thead>
          <tbody>
            {value.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-3 text-center text-xs text-muted-foreground">
                  Sin diagnósticos agregados.
                </td>
              </tr>
            ) : (
              value.map((dx, i) => (
                <tr key={`${dx.codigo}-${i}`} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">
                    <code className="font-mono text-xs text-muted-foreground">{dx.codigo}</code>
                  </td>
                  <td className="px-3 py-2">{dx.descripcion}</td>
                  <td className="px-3 py-2">
                    <select
                      className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                      value={dx.tipo}
                      onChange={(e) => updateTipo(i, e.target.value as TipoDiagnostico)}
                      disabled={disabled}
                    >
                      {TIPO_DIAGNOSTICO.map((t) => (
                        <option key={t} value={t}>
                          {TIPO_DIAGNOSTICO_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      className="w-full rounded border border-input bg-background px-2 py-1 text-xs uppercase placeholder:normal-case"
                      value={dx.complemento ?? ""}
                      placeholder="Complemento del diagnóstico…"
                      onChange={(e) => updateComplemento(i, e.target.value)}
                      disabled={disabled}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => eliminar(i)}
                      disabled={disabled}
                      aria-label={`Eliminar diagnóstico ${dx.codigo}`}
                      className="text-destructive hover:text-destructive/70"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
                        <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        El complemento se asocia a cada diagnóstico. RN-03: se requiere ≥1 de tipo{" "}
        <strong>Complementario</strong> para firmar.
      </p>
    </div>
  );
}
