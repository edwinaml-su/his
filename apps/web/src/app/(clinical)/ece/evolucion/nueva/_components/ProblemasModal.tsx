"use client";

/**
 * Modal "Agregar/Editar problema" — captura descripción + Subjetivo (S) + Objetivo (O)
 * para un problema individual (POMR, CC-0004).
 *
 * Los signos vitales pasaron a nivel de página (un solo registro por evolución, D-B).
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
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface ProblemaItem {
  id: string;
  descripcion: string;
  subjetivo: string;
  objetivo: string;
}

interface BufferState {
  descripcion: string;
  subjetivo: string;
  objetivo: string;
}

const BUFFER_EMPTY: BufferState = { descripcion: "", subjetivo: "", objetivo: "" };

interface ProblemasModalProps {
  open: boolean;
  onClose: () => void;
  /** null = modo Agregar; ProblemaItem presente = modo Editar */
  value: ProblemaItem | null;
  onSave: (data: { descripcion: string; subjetivo: string; objetivo: string }) => void;
}

// ─── Componente ──────────────────────────────────────────────────────────────

export function ProblemasModal({ open, onClose, value, onSave }: ProblemasModalProps) {
  const [buffer, setBuffer] = React.useState<BufferState>(BUFFER_EMPTY);

  // Al abrir, sincronizar buffer desde value (edit) o limpiar (add)
  React.useEffect(() => {
    if (open) {
      setBuffer(
        value
          ? { descripcion: value.descripcion, subjetivo: value.subjetivo, objetivo: value.objetivo }
          : BUFFER_EMPTY,
      );
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  // Nota: `value` se omite de dependencias para no pisar ediciones en curso.

  const titulo = value ? "Editar problema" : "Agregar problema";
  const canSave = buffer.descripcion.trim() !== "";

  function handleGuardar() {
    onSave({ descripcion: buffer.descripcion.trim(), subjetivo: buffer.subjetivo, objetivo: buffer.objetivo });
    onClose();
  }

  function handleCancelar() {
    // Descarta el buffer sin llamar onSave
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleCancelar(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>
            Ingrese el nombre del problema clínico y la perspectiva subjetiva/objetiva correspondiente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Descripción del problema */}
          <div className="space-y-1.5">
            <Label htmlFor="problema-descripcion">Problema</Label>
            <Input
              id="problema-descripcion"
              value={buffer.descripcion}
              onChange={(e) => setBuffer((prev) => ({ ...prev, descripcion: e.target.value }))}
              placeholder="Ej. Cefalea tensional"
              aria-required="true"
            />
          </div>

          {/* Subjetivo (S) */}
          <div className="space-y-1.5">
            <Label htmlFor="problema-subjetivo">Subjetivo (S)</Label>
            <p className="text-xs text-muted-foreground">
              Relato del paciente: síntomas, evolución, motivo relacionado con este problema.
            </p>
            <textarea
              id="problema-subjetivo"
              rows={4}
              value={buffer.subjetivo}
              onChange={(e) => setBuffer((prev) => ({ ...prev, subjetivo: e.target.value }))}
              placeholder="Redactar subjetivo…"
              className="flex w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </div>

          {/* Objetivo (O) */}
          <div className="space-y-1.5">
            <Label htmlFor="problema-objetivo">Objetivo (O)</Label>
            <p className="text-xs text-muted-foreground">
              Hallazgos al examen físico, resultados relacionados con este problema.
            </p>
            <textarea
              id="problema-objetivo"
              rows={4}
              value={buffer.objetivo}
              onChange={(e) => setBuffer((prev) => ({ ...prev, objetivo: e.target.value }))}
              placeholder="Redactar objetivo…"
              className="flex w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleCancelar}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleGuardar} disabled={!canSave}>
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
