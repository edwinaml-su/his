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
  /** Si se pasa, es edición; si no, es nueva indicación. */
  indicacionId?: string;
}

export function PlanItemModal({ open, onClose, indicacionId }: Props) {
  const { draft, dispatch } = useEvolucionDraft();
  const indicacion = indicacionId ? draft.plan.find((it) => it.id === indicacionId) : undefined;

  const [texto, setTexto] = React.useState("");
  const [err, setErr] = React.useState(false);
  const taRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (open) {
      setTexto(indicacion?.texto ?? "");
      setErr(false);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleGuardar() {
    const trimado = texto.trim();
    if (!trimado) {
      setErr(true);
      taRef.current?.focus();
      return;
    }
    if (indicacionId) {
      dispatch({ type: "EDIT_PLAN", id: indicacionId, texto: trimado });
    } else {
      dispatch({ type: "ADD_PLAN", texto: trimado });
    }
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{indicacionId ? "Editar indicación" : "Agregar al plan"}</DialogTitle>
          <DialogDescription>
            Conducta terapéutica, indicación, seguimiento o interconsulta.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2 space-y-1.5">
          <Label htmlFor="modal-plan-texto">Indicación / acción</Label>
          <MedicalTextarea
            id="modal-plan-texto"
            ref={taRef}
            rows={4}
            value={texto}
            onChange={(v) => { setTexto(v); setErr(false); }}
            placeholder="Describa la indicación…"
            invalid={err}
            describedBy={err ? "modal-plan-err" : undefined}
          />
          {err && (
            <p id="modal-plan-err" role="alert" className="text-xs text-destructive">
              Escriba la indicación antes de guardar.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleGuardar}>
            {indicacionId ? "Guardar cambios" : "Agregar al plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
