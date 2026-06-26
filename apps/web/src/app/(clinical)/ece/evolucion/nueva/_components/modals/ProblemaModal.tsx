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
import { MedicalTextarea } from "../MedicalTextarea";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Si se pasa, es edición; si no, es nuevo problema raíz. */
  problemaId?: string;
}

export function ProblemaModal({ open, onClose, problemaId }: Props) {
  const { draft, dispatch } = useEvolucionDraft();
  const problema = problemaId ? draft.problemas.find((p) => p.id === problemaId) : undefined;

  const [texto, setTexto] = React.useState("");
  const [err, setErr] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  // Sincronizar buffer al abrir
  React.useEffect(() => {
    if (open) {
      setTexto(problema?.texto ?? "");
      setErr(false);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleGuardar() {
    const trimado = texto.trim();
    if (!trimado) {
      setErr(true);
      textareaRef.current?.focus();
      return;
    }
    if (problemaId) {
      dispatch({ type: "EDIT_PROBLEMA", id: problemaId, texto: trimado });
    } else {
      dispatch({ type: "ADD_PROBLEMA", texto: trimado });
    }
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{problemaId ? "Editar problema" : "Agregar problema"}</DialogTitle>
          <DialogDescription>
            Diagnóstico, hallazgo o motivo del problema.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2 space-y-1.5">
          <Label htmlFor="modal-problema-texto">Problema</Label>
          <MedicalTextarea
            id="modal-problema-texto"
            ref={textareaRef}
            rows={4}
            value={texto}
            onChange={(v) => { setTexto(v); setErr(false); }}
            placeholder="Describa el problema (p. ej. Cefalea tensional)…"
            invalid={err}
            describedBy={err ? "modal-problema-err" : undefined}
          />
          {err && (
            <p id="modal-problema-err" role="alert" className="text-xs text-destructive">
              Escriba el problema antes de guardar.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleGuardar}>
            {problemaId ? "Guardar cambios" : "Agregar a la lista"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
