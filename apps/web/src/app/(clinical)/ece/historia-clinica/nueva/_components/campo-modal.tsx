"use client";

/**
 * CampoModal — G-04: campos narrativos se editan en modal.
 * Muestra el texto capturado con botón "Editar". Al abrir el Dialog,
 * expone un Textarea y aplica G-01 (MAYÚSCULAS) al guardar.
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
import { toUpper } from "./utils";

interface CampoModalProps {
  titulo: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  /** Contenido adicional renderizado encima del textarea dentro del modal (ej. PlantillasBar) */
  modalHeader?: React.ReactNode;
  /** Clases extra para el botón/display exterior */
  className?: string;
  required?: boolean;
  invalid?: boolean;
  /** G-08: muestra el valor entre comillas angulares «…». El valor se almacena sin comillas. */
  wrapQuotes?: boolean;
}

export function CampoModal({
  titulo,
  placeholder = "Haga clic para editar…",
  value,
  onChange,
  disabled,
  modalHeader,
  className,
  invalid,
  wrapQuotes,
}: CampoModalProps) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState("");

  function handleOpen() {
    setDraft(value);
    setOpen(true);
  }

  function handleSave() {
    onChange(toUpper(draft.trim()));
    setOpen(false);
  }

  return (
    <>
      {/* Campo display */}
      <button
        type="button"
        onClick={handleOpen}
        disabled={disabled}
        aria-label={`Editar ${titulo}`}
        className={[
          "w-full rounded-md border bg-background px-3 py-2.5 text-left text-sm transition-colors",
          "min-h-[46px] flex items-start gap-2",
          invalid
            ? "border-destructive ring-2 ring-destructive/20"
            : "border-input hover:border-ring",
          disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
          className ?? "",
        ].join(" ")}
      >
        <span className="flex-1 whitespace-pre-wrap text-sm uppercase leading-snug">
          {value ? (
            wrapQuotes ? `«${value}»` : value
          ) : (
            <span className="normal-case text-muted-foreground">
              {placeholder}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-accent-foreground">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="h-3.5 w-3.5"
          >
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
          </svg>
          Editar
        </span>
      </button>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{titulo}</DialogTitle>
          </DialogHeader>
          {modalHeader}
          <Textarea
            rows={8}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            autoFocus
            className="uppercase placeholder:normal-case"
          />
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={handleSave}>
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
