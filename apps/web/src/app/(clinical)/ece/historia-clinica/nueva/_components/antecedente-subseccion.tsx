"use client";

/**
 * AntecedenteSubseccion — RF-05.
 * Toggle "TIENE" / negativo + grid de ítems cuando estado=TIENE.
 * G-05: sin duplicados.
 */

import * as React from "react";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { toUpper } from "./utils";

export type EstadoAnt = "TIENE" | "NINGUNO" | "NO_APLICA";

export interface SubseccionState {
  estado: EstadoAnt;
  items: string[];
}

interface AntecedenteSubseccionProps {
  titulo: string;
  estadoNegativo: "NINGUNO" | "NO_APLICA";
  labelNegativo: string;
  value: SubseccionState;
  onChange: (v: SubseccionState) => void;
  disabled?: boolean;
  invalid?: boolean;
}

export function AntecedenteSubseccion({
  titulo,
  estadoNegativo,
  labelNegativo,
  value,
  onChange,
  disabled,
  invalid,
}: AntecedenteSubseccionProps) {
  const [draft, setDraft] = React.useState("");
  const [draftError, setDraftError] = React.useState("");

  function setEstado(e: EstadoAnt) {
    onChange({ ...value, estado: e, items: e !== "TIENE" ? [] : value.items });
  }

  function agregar() {
    const item = toUpper(draft.trim());
    if (!item) return;
    // G-05: sin duplicados
    if (value.items.includes(item)) {
      setDraftError("Este ítem ya está en la lista.");
      return;
    }
    setDraftError("");
    onChange({ ...value, items: [...value.items, item] });
    setDraft("");
  }

  function eliminar(i: number) {
    onChange({ ...value, items: value.items.filter((_, j) => j !== i) });
  }

  return (
    <div className="mb-4 last:mb-0">
      {/* Cabecera: título + toggle */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span
          className={[
            "text-sm font-semibold",
            invalid ? "text-destructive" : "text-foreground",
          ].join(" ")}
        >
          {titulo}
        </span>
        {/* Toggle Tiene / Negativo — styled con border-radius pill */}
        <div className="inline-flex overflow-hidden rounded-full border border-input text-xs font-semibold">
          <button
            type="button"
            onClick={() => setEstado("TIENE")}
            disabled={disabled}
            className={[
              "border-r border-input px-3 py-1 transition-colors",
              value.estado === "TIENE"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted",
            ].join(" ")}
          >
            Tiene
          </button>
          <button
            type="button"
            onClick={() => setEstado(estadoNegativo)}
            disabled={disabled}
            className={[
              "px-3 py-1 transition-colors",
              value.estado === estadoNegativo
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted",
            ].join(" ")}
          >
            {labelNegativo}
          </button>
        </div>
      </div>

      {/* Cuerpo — visible solo cuando TIENE */}
      {value.estado === "TIENE" && (
        <div className={invalid ? "rounded-md ring-2 ring-destructive/30" : ""}>
          {/* Formulario de alta */}
          <div className="mb-2 flex gap-2">
            <Input
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value.toUpperCase());
                setDraftError("");
              }}
              placeholder={`Agregar ${titulo.toLowerCase()}…`}
              disabled={disabled}
              className="flex-1 uppercase placeholder:normal-case"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  agregar();
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={agregar}
              disabled={disabled || !draft.trim()}
            >
              Agregar
            </Button>
          </div>
          {draftError && (
            <p className="mb-1 text-xs text-destructive">{draftError}</p>
          )}
          {/* Grid de ítems */}
          {value.items.length > 0 && (
            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-sm">
                <tbody>
                  {value.items.map((item, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="px-3 py-1.5 uppercase">{item}</td>
                      <td className="w-10 px-2 py-1.5 text-right">
                        <button
                          type="button"
                          onClick={() => eliminar(i)}
                          disabled={disabled}
                          aria-label={`Eliminar ${item}`}
                          className="text-destructive hover:text-destructive/70"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                            className="h-3.5 w-3.5"
                          >
                            <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
