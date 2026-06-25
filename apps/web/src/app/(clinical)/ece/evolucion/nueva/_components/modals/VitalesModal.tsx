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
import { useEvolucionDraft } from "../../_hooks/useEvolucionDraft";
import { SignosVitalesCapture } from "../SignosVitalesCapture";
import type { SignosState } from "../../_lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function VitalesModal({ open, onClose }: Props) {
  const { draft, dispatch } = useEvolucionDraft();
  const [buffer, setBuffer] = React.useState<SignosState>(draft.signos);

  React.useEffect(() => {
    if (open) setBuffer(draft.signos);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleGuardar() {
    dispatch({ type: "SET_SIGNOS", signos: buffer });
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Signos vitales</DialogTitle>
          <DialogDescription>
            Registre los signos tomados en esta evaluación.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <SignosVitalesCapture
            idPrefix="vitales-modal"
            value={buffer}
            onChange={setBuffer}
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleGuardar}>
            Guardar signos
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
