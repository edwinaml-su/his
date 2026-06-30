"use client";

/**
 * Modal "Editar contacto de emergencia" (CC-0006 §5.3).
 *
 * Tres campos editables (Nombre / Parentesco / Teléfono). Al guardar, devuelve el
 * contacto al encabezado vía `onSave`; el encabezado actualiza su vista (override
 * local, igual que el mockup, que solo reconstruye `#pxEmerg`). La persistencia a
 * la ficha del paciente es dominio del registro de pacientes, no de la evolución.
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
import type { ContactoEmergencia } from "../../_hooks/useEvolucionDraft";

interface Props {
  open: boolean;
  onClose: () => void;
  value: ContactoEmergencia | null;
  onSave: (next: ContactoEmergencia) => void;
}

export function EmergenciaModal({ open, onClose, value, onSave }: Props) {
  const [nombre, setNombre] = React.useState("");
  const [parentesco, setParentesco] = React.useState("");
  const [telefono, setTelefono] = React.useState("");
  const nombreRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) {
      setNombre(value?.nombre ?? "");
      setParentesco(value?.parentesco ?? "");
      setTelefono(value?.telefono ?? "");
    }
  }, [open, value]);

  function handleGuardar() {
    const n = nombre.trim();
    if (!n) {
      nombreRef.current?.focus();
      return;
    }
    onSave({ nombre: n, parentesco: parentesco.trim(), telefono: telefono.trim() || null });
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>En caso de emergencia llamar a</DialogTitle>
          <DialogDescription>
            Contacto de emergencia del paciente. Editable por el médico.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3.5 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="em-nombre">Nombre del contacto</Label>
            <Input
              id="em-nombre"
              ref={nombreRef}
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Nombre completo"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="em-parent">Parentesco</Label>
            <Input
              id="em-parent"
              value={parentesco}
              onChange={(e) => setParentesco(e.target.value)}
              placeholder="Madre, hijo, cónyuge…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="em-tel">Teléfono</Label>
            <Input
              id="em-tel"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              placeholder="0000-0000"
              inputMode="tel"
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
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
