"use client";

/**
 * PlanGrid — RF-12.
 * Grid de indicaciones de plan de manejo. Cada ítem se agrega por modal (G-04).
 * G-05: sin duplicados.
 */

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@his/ui/components/dialog";
import { Button } from "@his/ui/components/button";
import { Textarea } from "@his/ui/components/textarea";
import type { PlanItem } from "@his/contracts";
import { toUpper } from "./utils";

interface PlanGridProps {
  value: PlanItem[];
  onChange: (v: PlanItem[]) => void;
  disabled?: boolean;
  invalid?: boolean;
}

export function PlanGrid({ value, onChange, disabled, invalid }: PlanGridProps) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [draftError, setDraftError] = React.useState("");

  function handleAdd() {
    const texto = toUpper(draft.trim());
    if (!texto) return;
    // G-05: sin duplicados
    if (value.some((p) => p.texto === texto)) {
      setDraftError("Esta indicación ya está en el plan.");
      return;
    }
    setDraftError("");
    onChange([...value, { orden: value.length + 1, texto }]);
    setDraft("");
    setOpen(false);
  }

  function eliminar(i: number) {
    const next = value.filter((_, j) => j !== i).map((p, j) => ({ ...p, orden: j + 1 }));
    onChange(next);
  }

  return (
    <div className="space-y-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => { setDraft(""); setDraftError(""); setOpen(true); }}
        disabled={disabled}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="mr-1.5 h-3.5 w-3.5">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Agregar indicación al plan
      </Button>

      <div
        className={[
          "overflow-hidden rounded-md border",
          invalid ? "border-destructive ring-2 ring-destructive/20" : "border-border",
        ].join(" ")}
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-xs text-muted-foreground">
              <th className="px-3 py-2 text-left font-semibold uppercase tracking-wide">
                Indicación del plan de manejo
              </th>
              <th className="px-3 py-2" style={{ width: 50 }} />
            </tr>
          </thead>
          <tbody>
            {value.length === 0 ? (
              <tr>
                <td colSpan={2} className="px-3 py-3 text-center text-xs text-muted-foreground">
                  Sin indicaciones agregadas.
                </td>
              </tr>
            ) : (
              value.map((p, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 uppercase">{p.texto}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => eliminar(i)}
                      disabled={disabled}
                      aria-label={`Eliminar indicación ${i + 1}`}
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

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Agregar indicación al plan</DialogTitle>
          </DialogHeader>
          <Textarea
            rows={4}
            value={draft}
            onChange={(e) => { setDraft(e.target.value.toUpperCase()); setDraftError(""); }}
            placeholder="Indicación de manejo…"
            autoFocus
            className="uppercase placeholder:normal-case"
          />
          {draftError && (
            <p className="text-xs text-destructive">{draftError}</p>
          )}
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={handleAdd} disabled={!draft.trim()}>
              Agregar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
