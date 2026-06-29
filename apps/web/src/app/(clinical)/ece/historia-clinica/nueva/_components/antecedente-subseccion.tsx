"use client";

/**
 * AntecedenteSubseccion — RF-05.
 * Toggle "TIENE" / negativo + grid de ítems cuando estado=TIENE.
 * G-05: sin duplicados.
 */

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@his/ui/components/dialog";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { ahoraTS, toUpper } from "./utils";

export type EstadoAnt = "TIENE" | "NINGUNO" | "NO_APLICA";

/** G-09: sello de auditoría al confirmar un antecedente negativo. */
export interface SubseccionAuditoria {
  registradoPor: string;
  registradoEn: string;
}

export interface SubseccionState {
  estado: EstadoAnt;
  items: string[];
  auditoria?: SubseccionAuditoria | null;
}

interface AntecedenteSubseccionProps {
  titulo: string;
  estadoNegativo: "NINGUNO" | "NO_APLICA";
  labelNegativo: string;
  value: SubseccionState;
  onChange: (v: SubseccionState) => void;
  /** Usuario autenticado, para el sello de auditoría G-09. */
  usuarioActual: string;
  disabled?: boolean;
  invalid?: boolean;
}

export function AntecedenteSubseccion({
  titulo,
  estadoNegativo,
  labelNegativo,
  value,
  onChange,
  usuarioActual,
  disabled,
  invalid,
}: AntecedenteSubseccionProps) {
  const [draft, setDraft] = React.useState("");
  const [draftError, setDraftError] = React.useState("");
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  function seleccionarTiene() {
    onChange({ ...value, estado: "TIENE", auditoria: null });
  }

  /** Pide confirmación antes de marcar negativo (G-09). */
  function pedirNegativo() {
    setConfirmOpen(true);
  }

  function confirmarNegativo() {
    onChange({
      estado: estadoNegativo,
      items: [],
      auditoria: { registradoPor: usuarioActual, registradoEn: ahoraTS() },
    });
    setConfirmOpen(false);
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
            onClick={seleccionarTiene}
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
            onClick={pedirNegativo}
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

      {/* G-09: sello de auditoría cuando se confirmó un negativo */}
      {value.estado !== "TIENE" && value.auditoria && (
        <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-1.5 text-xs text-muted-foreground">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="h-3.5 w-3.5 shrink-0"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          <span>
            <b>{labelNegativo.toUpperCase()}</b> · registrado por{" "}
            <b>{value.auditoria.registradoPor}</b> el{" "}
            <b>{value.auditoria.registradoEn}</b>
          </span>
        </div>
      )}

      {/* G-09: confirmación antes de marcar negativo */}
      <Dialog open={confirmOpen} onOpenChange={(o) => !o && setConfirmOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Confirmar «{labelNegativo}» — {titulo}
            </DialogTitle>
            <DialogDescription>
              ¿Confirma que en {titulo.toLowerCase()} corresponde «{labelNegativo}
              »?
              {value.items.length > 0 &&
                ` Hay ${value.items.length} registro(s) capturado(s) que quedarán sin efecto.`}{" "}
              Se registrará la acción con su usuario y la fecha/hora.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              onClick={() => setConfirmOpen(false)}
            >
              Cancelar
            </Button>
            <Button type="button" onClick={confirmarNegativo}>
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
