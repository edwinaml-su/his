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

export function SubjetivoModal({ open, onClose }: Props) {
  const { draft, dispatch } = useEvolucionDraft();
  const [texto, setTexto] = React.useState("");
  const taRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (open) setTexto(draft.subjetivo);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleGuardar() {
    dispatch({ type: "SET_SUBJETIVO", texto: texto.trim() });
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Subjetivo (S)</DialogTitle>
          <DialogDescription>
            Relato del paciente: motivo de consulta, síntomas, evolución.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2 space-y-1.5">
          <Label htmlFor="modal-subjetivo-texto">Subjetivo</Label>
          <textarea
            id="modal-subjetivo-texto"
            ref={taRef}
            rows={7}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Redactar subjetivo…"
            className="flex w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleGuardar}>
            Guardar subjetivo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
