"use client";

/**
 * Diálogo crear/editar PlantillaTurno (CC-0036, US.AFIL.1.9). `plantilla ===
 * null` -> alta; con datos -> edición (código no editable, es identidad
 * dentro de la sede). `cruzaMedianoche` NUNCA se envía — es columna
 * GENERATED en BD (sql/243), la UI solo la muestra como badge informativo
 * tras guardar (ver `turnos-shell.tsx`).
 */
import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Alert, AlertDescription } from "@his/ui/components/alert";
import { trpc } from "@/lib/trpc/react";
import type { TurnoTipo } from "./turnos-shell";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trpcAny = trpc as any;

export interface PlantillaData {
  id: string;
  codigo: string;
  nombre: string;
  horaInicio: string;
  horaFin: string;
  dotacionRequerida: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plantilla: PlantillaData | null;
  establishmentId: string;
  tipo: TurnoTipo;
  onSaved: () => void;
}

export function PlantillaDialog({ open, onOpenChange, plantilla, establishmentId, tipo, onSaved }: Props) {
  const isEdit = plantilla !== null;
  const [codigo, setCodigo] = React.useState("");
  const [nombre, setNombre] = React.useState("");
  const [horaInicio, setHoraInicio] = React.useState("07:00");
  const [horaFin, setHoraFin] = React.useState("19:00");
  const [dotacionRequerida, setDotacionRequerida] = React.useState(1);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setError(null);
    if (plantilla) {
      setCodigo(plantilla.codigo);
      setNombre(plantilla.nombre);
      setHoraInicio(plantilla.horaInicio.slice(0, 5));
      setHoraFin(plantilla.horaFin.slice(0, 5));
      setDotacionRequerida(plantilla.dotacionRequerida);
    } else {
      setCodigo("");
      setNombre("");
      setHoraInicio("07:00");
      setHoraFin("19:00");
      setDotacionRequerida(1);
    }
  }, [open, plantilla]);

  const create = trpcAny.turno.plantilla.create.useMutation({
    onSuccess: () => {
      onOpenChange(false);
      onSaved();
    },
    onError: (err: { message: string }) => setError(err.message),
  });
  const update = trpcAny.turno.plantilla.update.useMutation({
    onSuccess: () => {
      onOpenChange(false);
      onSaved();
    },
    onError: (err: { message: string }) => setError(err.message),
  });

  function handleSave() {
    setError(null);
    if (isEdit) {
      update.mutate({ id: plantilla!.id, nombre, horaInicio, horaFin, dotacionRequerida });
    } else {
      create.mutate({ establishmentId, tipo, codigo, nombre, horaInicio, horaFin, dotacionRequerida });
    }
  }

  const isPending = create.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar plantilla de turno" : "Nueva plantilla de turno"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-1">
            <Label htmlFor="codigo">Código</Label>
            <Input
              id="codigo"
              value={codigo}
              disabled={isEdit}
              maxLength={40}
              onChange={(e) => setCodigo(e.target.value)}
              placeholder="p.ej. TA, TN, ENF-D"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="nombre">Nombre</Label>
            <Input
              id="nombre"
              value={nombre}
              maxLength={120}
              onChange={(e) => setNombre(e.target.value)}
              placeholder='p.ej. "Turno A — 07:00 a 19:00"'
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="horaInicio">Hora inicio</Label>
              <Input id="horaInicio" type="time" value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="horaFin">Hora fin</Label>
              <Input id="horaFin" type="time" value={horaFin} onChange={(e) => setHoraFin(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Si la hora de fin es menor o igual a la de inicio, el sistema marca
            el turno como &quot;cruza medianoche&quot; automáticamente.
          </p>
          <div className="space-y-1">
            <Label htmlFor="dotacion">Dotación requerida</Label>
            <Input
              id="dotacion"
              type="number"
              min={1}
              value={dotacionRequerida}
              onChange={(e) => setDotacionRequerida(Math.max(1, Number(e.target.value) || 1))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={!codigo || !nombre || isPending} onClick={handleSave}>
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
