"use client";

/**
 * CC-0006 §10.3.1 — confirmación antes de habilitar la edición de antecedentes.
 *
 * Reafirma al médico que va a tocar datos clínicos del paciente. Los cambios
 * confirmados quedan en el snapshot de antecedentes de esta evolución (que es
 * inmutable tras la firma), no en un write-back a la HC canónica CC-0007.
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

const ANTECEDENTES = ["Alergias", "Personales", "Familiares", "Ocupación", "Hábitos"] as const;

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function ModificarAntecedentesModal({ open, onClose, onConfirm }: Props) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Modificar antecedentes</DialogTitle>
          <DialogDescription>
            Confirme que desea modificar los antecedentes del paciente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <p className="text-sm text-foreground">Se habilitará la edición de cada antecedente:</p>
          <ul className="space-y-1.5">
            {ANTECEDENTES.map((a) => (
              <li key={a} className="flex items-center gap-2 text-sm text-foreground">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#0d9488"
                  strokeWidth={2.4}
                  className="h-4 w-4 shrink-0"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M8.5 12.5 11 15l4.5-5" />
                </svg>
                {a}
              </li>
            ))}
          </ul>
          <div className="flex items-start gap-2 rounded-md border border-[#fde68a] bg-[#fffbeb] px-3 py-2 text-xs text-[#92400e] dark:border-[#4a3a13] dark:bg-[#241c08] dark:text-[#fbbf24]">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="mt-0.5 h-4 w-4 shrink-0"
            >
              <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
            </svg>
            <span>Los cambios actualizan la historia clínica del paciente.</span>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            className="bg-[#0d9488] text-white hover:bg-[#0f766e]"
          >
            Sí, modificar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
