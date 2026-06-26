"use client";

/**
 * ProcedimientosGrid — RF-09 (opcional).
 * Autocompletado CPT vía trpc.eceCatalogoCpt.buscar + grid con complemento por fila.
 */

import * as React from "react";
import { trpc } from "@/lib/trpc/react";
import type { ProcedimientoCpt } from "@his/contracts";
import { toUpper } from "./utils";

interface ProcedimientosGridProps {
  value: ProcedimientoCpt[];
  onChange: (v: ProcedimientoCpt[]) => void;
  disabled?: boolean;
}

export function ProcedimientosGrid({
  value,
  onChange,
  disabled,
}: ProcedimientosGridProps) {
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [hl, setHl] = React.useState(-1);
  const [duplicateError, setDuplicateError] = React.useState("");

  const buscarQ = trpc.eceCatalogoCpt.buscar.useQuery(
    { q },
    { enabled: q.trim().length >= 2 },
  );
  const results = buscarQ.data ?? [];

  function pick(r: { codigo: string; descripcion: string }) {
    if (value.some((x) => x.codigo === r.codigo)) {
      setDuplicateError(`${r.codigo} ya está agregado.`);
      setQ("");
      setOpen(false);
      return;
    }
    setDuplicateError("");
    onChange([...value, { codigo: r.codigo, descripcion: r.descripcion, complemento: "" }]);
    setQ("");
    setOpen(false);
    setHl(-1);
  }

  function updateComplemento(i: number, c: string) {
    onChange(value.map((p, j) => (j === i ? { ...p, complemento: toUpper(c) } : p)));
  }

  function eliminar(i: number) {
    onChange(value.filter((_, j) => j !== i));
  }

  React.useEffect(() => {
    if (q.trim().length >= 2 && results.length > 0) setOpen(true);
    else setOpen(false);
    setHl(-1);
  }, [q, results.length]);

  return (
    <div className="space-y-3">
      <div>
        <div className="relative">
          <input
            type="text"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder="Código o nombre — p. ej. '93000' o 'electrocardiograma'"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            disabled={disabled}
            onKeyDown={(e) => {
              if (!open) return;
              if (e.key === "ArrowDown") { e.preventDefault(); setHl((h) => Math.min(h + 1, results.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setHl((h) => Math.max(h - 1, 0)); }
              else if (e.key === "Enter") { e.preventDefault(); if (hl >= 0) pick(results[hl]!); }
              else if (e.key === "Escape") setOpen(false);
            }}
          />
          {open && results.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-md border border-border bg-card shadow-lg">
              {results.map((r, i) => (
                <div
                  key={r.codigo}
                  className={["flex cursor-pointer gap-2 border-b border-border px-3 py-2 text-sm last:border-0", i === hl ? "bg-accent text-accent-foreground" : "hover:bg-accent hover:text-accent-foreground"].join(" ")}
                  onMouseDown={(e) => { e.preventDefault(); pick(r); }}
                >
                  <code className="min-w-[60px] font-mono text-xs text-primary">{r.codigo}</code>
                  <span>{r.descripcion}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {duplicateError && (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{duplicateError}</p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          Seleccione un resultado para agregarlo.
        </p>
      </div>

      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-xs text-muted-foreground">
              <th className="px-3 py-2 text-left font-semibold uppercase tracking-wide" style={{ width: 90 }}>Código</th>
              <th className="px-3 py-2 text-left font-semibold uppercase tracking-wide">Procedimiento</th>
              <th className="px-3 py-2 text-left font-semibold uppercase tracking-wide" style={{ width: 260 }}>Complemento</th>
              <th className="px-3 py-2" style={{ width: 50 }} />
            </tr>
          </thead>
          <tbody>
            {value.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-3 text-center text-xs text-muted-foreground">
                  Sin procedimientos agregados.
                </td>
              </tr>
            ) : (
              value.map((p, i) => (
                <tr key={`${p.codigo}-${i}`} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">
                    <code className="font-mono text-xs text-muted-foreground">{p.codigo}</code>
                  </td>
                  <td className="px-3 py-2">{p.descripcion}</td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      className="w-full rounded border border-input bg-background px-2 py-1 text-xs uppercase placeholder:normal-case"
                      value={p.complemento ?? ""}
                      placeholder="Complemento del procedimiento…"
                      onChange={(e) => updateComplemento(i, e.target.value)}
                      disabled={disabled}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => eliminar(i)}
                      disabled={disabled}
                      aria-label={`Eliminar procedimiento ${p.codigo}`}
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
    </div>
  );
}
