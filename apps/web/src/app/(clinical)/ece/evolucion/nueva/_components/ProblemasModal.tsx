"use client";

/**
 * Modal "Problemas" — contiene Subjetivo (S) + Objetivo (O) + SignosVitalesCapture.
 *
 * Controlled: el padre mantiene el estado; el modal sólo lee/escribe a través
 * de props. Al cancelar se descarta el buffer local sin afectar el estado externo.
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
import { Label } from "@his/ui/components/label";
import {
  SignosVitalesCapture,
  SIGNOS_INITIAL,
  type SignosState,
} from "./SignosVitalesCapture";

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface ProblemasValue {
  subjetivo: string;
  objetivo: string;
  signos: SignosState;
}

export const PROBLEMAS_INITIAL: ProblemasValue = {
  subjetivo: "",
  objetivo: "",
  signos: SIGNOS_INITIAL,
};

interface ProblemasModalProps {
  open: boolean;
  onClose: () => void;
  value: ProblemasValue;
  onChange: (next: ProblemasValue) => void;
}

// ─── Componente ──────────────────────────────────────────────────────────────

export function ProblemasModal({ open, onClose, value, onChange }: ProblemasModalProps) {
  // Buffer local — descartado en Cancelar, persistido en Guardar
  const [buffer, setBuffer] = React.useState<ProblemasValue>(value);

  // Al abrir el modal sincronizamos el buffer con el valor externo
  React.useEffect(() => {
    if (open) setBuffer(value);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  // Nota: la dependencia de `value` se omite deliberadamente — queremos sincronizar
  // solo al abrir para no pisar ediciones en curso del buffer.

  function handleGuardar() {
    onChange(buffer);
    onClose();
  }

  function handleCancelar() {
    // Descarta buffer — no llama onChange
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleCancelar(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Problemas</DialogTitle>
          <DialogDescription>
            Registre la perspectiva subjetiva del paciente y los hallazgos objetivos del examen.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Subjetivo (S) */}
          <div className="space-y-1.5">
            <Label htmlFor="problemas-subjetivo">Subjetivo (S)</Label>
            <p className="text-xs text-muted-foreground">
              Relato del paciente: motivo de consulta, síntomas, evolución.
            </p>
            <textarea
              id="problemas-subjetivo"
              rows={4}
              value={buffer.subjetivo}
              onChange={(e) => setBuffer((prev) => ({ ...prev, subjetivo: e.target.value }))}
              placeholder="Redactar subjetivo…"
              className="flex w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </div>

          {/* Objetivo (O) */}
          <div className="space-y-1.5">
            <Label htmlFor="problemas-objetivo">Objetivo (O)</Label>
            <p className="text-xs text-muted-foreground">
              Hallazgos al examen físico, resultados recientes.
            </p>
            <textarea
              id="problemas-objetivo"
              rows={4}
              value={buffer.objetivo}
              onChange={(e) => setBuffer((prev) => ({ ...prev, objetivo: e.target.value }))}
              placeholder="Redactar objetivo…"
              className="flex w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </div>

          {/* Signos vitales */}
          <div className="space-y-1.5">
            <p className="text-sm font-semibold text-foreground">Signos vitales</p>
            <p className="text-xs text-muted-foreground">Opcional — registre si tomó signos en esta evaluación.</p>
            <SignosVitalesCapture
              idPrefix="modal-sv"
              value={buffer.signos}
              onChange={(signos) => setBuffer((prev) => ({ ...prev, signos }))}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleCancelar}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleGuardar}>
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
