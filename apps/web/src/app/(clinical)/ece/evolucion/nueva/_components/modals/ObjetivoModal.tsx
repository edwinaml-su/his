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
}

export function ObjetivoModal({ open, onClose }: Props) {
  const { draft, dispatch } = useEvolucionDraft();
  const [texto, setTexto] = React.useState("");
  const taRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (open) setTexto(draft.objetivo);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleGuardar() {
    dispatch({ type: "SET_OBJETIVO", texto: texto.trim() });
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Objetivo (O)</DialogTitle>
          <DialogDescription>
            Hallazgos al examen físico, resultados recientes.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="modal-objetivo-texto">Objetivo</Label>
            <textarea
              id="modal-objetivo-texto"
              ref={taRef}
              rows={7}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Redactar objetivo…"
              className="flex w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleGuardar}>
            Guardar objetivo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
