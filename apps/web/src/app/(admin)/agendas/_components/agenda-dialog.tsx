"use client";

/**
 * Diálogo de alta de agenda — CC-0036 Ola 3 (REQ-HIS-AFIL-001 US.AGE.2.1
 * AC1). El servidor exige contrato VIGENTE del médico sobre el consultorio
 * (mensaje es-SV si no existe) y deriva `establishmentId` del consultorio —
 * el formulario no lo pide.
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { Alert, AlertDescription, AlertTitle } from "@his/ui/components/alert";
import { trpc } from "@/lib/trpc/react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trpcAny = trpc as any;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

export function AgendaDialog({ open, onOpenChange, onSaved }: Props) {
  const [medicoAfiliadoId, setMedicoAfiliadoId] = React.useState("");
  const [consultorioId, setConsultorioId] = React.useState("");
  const [vigenciaDesde, setVigenciaDesde] = React.useState("");
  const [duracionSlotMin, setDuracionSlotMin] = React.useState("20");
  const [capacidadPorSlot, setCapacidadPorSlot] = React.useState("1");
  const [anticipacionMinimaHoras, setAnticipacionMinimaHoras] = React.useState("0");
  const [horizonteMaximoDias, setHorizonteMaximoDias] = React.useState("90");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const afiliados = trpcAny.medicoAfiliado.list.useQuery({ estado: "ACTIVO" }, { enabled: open });
  const consultorios = trpcAny.consultorio.list.useQuery({ activeOnly: true }, { enabled: open });

  React.useEffect(() => {
    if (!open) return;
    setMedicoAfiliadoId("");
    setConsultorioId("");
    setVigenciaDesde("");
    setDuracionSlotMin("20");
    setCapacidadPorSlot("1");
    setAnticipacionMinimaHoras("0");
    setHorizonteMaximoDias("90");
    setErrorMsg(null);
  }, [open]);

  const createMutation = trpcAny.agenda.create.useMutation({
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
    onError: (err: { message: string }) => setErrorMsg(err.message),
  });

  const isPending = createMutation.isPending;
  const canSubmit =
    medicoAfiliadoId.length > 0 &&
    consultorioId.length > 0 &&
    vigenciaDesde.length > 0 &&
    Number(duracionSlotMin) > 0 &&
    Number(capacidadPorSlot) > 0;

  function handleSubmit() {
    if (!canSubmit) return;
    setErrorMsg(null);
    createMutation.mutate({
      medicoAfiliadoId,
      consultorioId,
      vigenciaDesde,
      duracionSlotMin: Number(duracionSlotMin),
      capacidadPorSlot: Number(capacidadPorSlot),
      anticipacionMinimaHoras: Number(anticipacionMinimaHoras),
      horizonteMaximoDias: Number(horizonteMaximoDias),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nueva agenda</DialogTitle>
          <DialogDescription>
            Queda en BORRADOR — requiere contrato VIGENTE del médico sobre el consultorio
            (REQ-HIS-AFIL-001 US.AGE.2.1). Se publica por separado tras registrar el horario.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="agenda-afiliado">Médico afiliado (ACTIVO)</Label>
              <Select value={medicoAfiliadoId} onValueChange={setMedicoAfiliadoId} disabled={isPending}>
                <SelectTrigger id="agenda-afiliado">
                  <SelectValue placeholder="Selecciona…" />
                </SelectTrigger>
                <SelectContent>
                  {(afiliados.data ?? []).map((a: { id: string; nombreCompleto: string }) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.nombreCompleto}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agenda-consultorio">Consultorio</Label>
              <Select value={consultorioId} onValueChange={setConsultorioId} disabled={isPending}>
                <SelectTrigger id="agenda-consultorio">
                  <SelectValue placeholder="Selecciona…" />
                </SelectTrigger>
                <SelectContent>
                  {(consultorios.data ?? []).map((c: { id: string; codigo: string; nombre: string }) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.codigo} — {c.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="agenda-vigencia">Vigente desde</Label>
            <Input
              id="agenda-vigencia"
              type="date"
              value={vigenciaDesde}
              onChange={(e) => setVigenciaDesde(e.target.value)}
              disabled={isPending}
            />
          </div>

          <div className="grid grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="agenda-slot">Duración de slot (min)</Label>
              <Input
                id="agenda-slot"
                type="number"
                min={1}
                max={480}
                value={duracionSlotMin}
                onChange={(e) => setDuracionSlotMin(e.target.value)}
                disabled={isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agenda-capacidad">Capacidad/slot</Label>
              <Input
                id="agenda-capacidad"
                type="number"
                min={1}
                value={capacidadPorSlot}
                onChange={(e) => setCapacidadPorSlot(e.target.value)}
                disabled={isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agenda-anticipacion">Anticipación mín. (h)</Label>
              <Input
                id="agenda-anticipacion"
                type="number"
                min={0}
                value={anticipacionMinimaHoras}
                onChange={(e) => setAnticipacionMinimaHoras(e.target.value)}
                disabled={isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agenda-horizonte">Horizonte (días)</Label>
              <Input
                id="agenda-horizonte"
                type="number"
                min={1}
                value={horizonteMaximoDias}
                onChange={(e) => setHorizonteMaximoDias(e.target.value)}
                disabled={isPending}
              />
            </div>
          </div>

          {errorMsg && (
            <Alert variant="destructive">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{errorMsg}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={isPending || !canSubmit}>
            {isPending ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
