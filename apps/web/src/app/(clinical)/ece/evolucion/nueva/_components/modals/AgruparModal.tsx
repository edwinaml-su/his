"use client";

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
import { useEvolucionDraft } from "../../_hooks/useEvolucionDraft";

interface Props {
  open: boolean;
  onClose: () => void;
  /** IDs de los problemas seleccionados para agrupar. */
  selectedIds: string[];
  onDone: () => void;
}

export function AgruparModal({ open, onClose, selectedIds, onDone }: Props) {
  const { dispatch } = useEvolucionDraft();
  const [nombre, setNombre] = React.useState("");
  const [err, setErr] = React.useState(false);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (open) {
      setNombre("");
      setErr(false);
    }
  }, [open]);

  function handleConfirmar() {
    const trimado = nombre.trim();
    if (!trimado) {
      setErr(true);
      inputRef.current?.focus();
      return;
    }
    if (selectedIds.length < 2) return;
    dispatch({ type: "GROUP_PROBLEMAS", ids: selectedIds, nombrePadre: trimado });
    onDone();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nuevo problema sindrómico</DialogTitle>
          <DialogDescription>
            Agrupará {selectedIds.length} problema{selectedIds.length > 1 ? "s" : ""} seleccionado{selectedIds.length > 1 ? "s" : ""} bajo un problema sindrómico.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2 space-y-1.5">
          <Label htmlFor="modal-agrupar-nombre">Nombre del problema sindrómico</Label>
          <textarea
            id="modal-agrupar-nombre"
            ref={inputRef}
            rows={3}
            value={nombre}
            onChange={(e) => { setNombre(e.target.value); setErr(false); }}
            placeholder="Nombre del agrupador (p. ej. Síndrome metabólico)…"
            className={`flex w-full resize-y rounded-md border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${err ? "border-destructive focus-visible:ring-destructive" : "border-input"}`}
            aria-invalid={err}
            aria-describedby={err ? "modal-agrupar-err" : undefined}
          />
          {err && (
            <p id="modal-agrupar-err" role="alert" className="text-xs text-destructive">
              Escriba el nombre del problema sindrómico.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleConfirmar}>
            Crear grupo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
