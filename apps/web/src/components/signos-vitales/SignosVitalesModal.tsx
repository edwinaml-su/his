"use client";

/**
 * Modal de Signos Vitales — módulo transversal (CC-0012, mockup avante7).
 * Wrapper controlado sobre `SignosVitalesCapture`. El guardado (validación +
 * llamada tRPC) vive en `useSignosVitales` — este componente solo presenta.
 */

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { Button } from "@his/ui/components/button";
import { SignosVitalesCapture } from "./SignosVitalesCapture";
import type { VitalesFormState } from "./types";

export interface SignosVitalesModalProps {
  open: boolean;
  onClose: () => void;
  value: VitalesFormState;
  onChange: (next: VitalesFormState) => void;
  onGuardar: () => void;
  /** true si `onGuardar` fue invocado y hay errores de validación pendientes. */
  bloqueado: boolean;
  showErrors: boolean;
  mensajeError?: string | null;
  sexo?: string | null;
  edad?: number | null;
  guardando?: boolean;
}

export function SignosVitalesModal({
  open,
  onClose,
  value,
  onChange,
  onGuardar,
  bloqueado,
  showErrors,
  mensajeError,
  sexo,
  edad,
  guardando = false,
}: SignosVitalesModalProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Signos vitales</DialogTitle>
          <DialogDescription>
            Presión arterial y signos cardiorrespiratorios son obligatorios. El resto es opcional.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <SignosVitalesCapture
            idPrefix="signos-vitales-modal"
            value={value}
            onChange={onChange}
            sexo={sexo}
            edad={edad}
            showErrors={showErrors}
          />
        </div>

        <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
          {showErrors && bloqueado && mensajeError && (
            <p role="alert" className="mr-auto text-sm text-destructive">
              {mensajeError}
            </p>
          )}
          <Button type="button" variant="outline" onClick={onClose} disabled={guardando}>
            Cancelar
          </Button>
          <Button type="button" onClick={onGuardar} aria-disabled={bloqueado} disabled={guardando}>
            {guardando ? "Guardando…" : "Guardar signos"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
