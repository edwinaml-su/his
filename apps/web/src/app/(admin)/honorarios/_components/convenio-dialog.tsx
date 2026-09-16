"use client";

/**
 * Diálogo de alta de convenio de honorarios — CC-0036 Ola 5
 * (REQ-HIS-AFIL-001 US.AFIL.1.5 AC1). Queda en BORRADOR; las reglas se
 * agregan desde el detalle (`convenio-detail-dialog.tsx`) antes de activar.
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@his/ui/components/select";
import { Alert, AlertDescription, AlertTitle } from "@his/ui/components/alert";
import { trpc } from "@/lib/trpc/react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trpcAny = trpc as any;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

export function ConvenioDialog({ open, onOpenChange, onSaved }: Props) {
  const [medicoAfiliadoId, setMedicoAfiliadoId] = React.useState("");
  const [vigenciaDesde, setVigenciaDesde] = React.useState("");
  const [vigenciaHasta, setVigenciaHasta] = React.useState("");
  const [retencionRentaPct, setRetencionRentaPct] = React.useState("10");
  const [periodicidad, setPeriodicidad] = React.useState<"QUINCENAL" | "MENSUAL">("MENSUAL");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const afiliados = trpcAny.medicoAfiliado.list.useQuery(undefined, { enabled: open });

  React.useEffect(() => {
    if (!open) return;
    setMedicoAfiliadoId("");
    setVigenciaDesde("");
    setVigenciaHasta("");
    setRetencionRentaPct("10");
    setPeriodicidad("MENSUAL");
    setErrorMsg(null);
  }, [open]);

  const createMutation = trpcAny.honorario.convenio.create.useMutation({
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
    onError: (err: { message: string }) => setErrorMsg(err.message),
  });

  const isPending = createMutation.isPending;
  const canSubmit = medicoAfiliadoId.length > 0 && vigenciaDesde.length > 0;

  function handleSubmit() {
    if (!canSubmit) return;
    setErrorMsg(null);
    createMutation.mutate({
      medicoAfiliadoId,
      vigenciaDesde,
      vigenciaHasta: vigenciaHasta === "" ? undefined : vigenciaHasta,
      // Porcentaje visible como 0-100 en la UI; la API/BD lo guardan como fracción (0-1, numeric(7,4)).
      retencionRentaPct: Number(retencionRentaPct) / 100,
      periodicidadLiquidacion: periodicidad,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nuevo convenio de honorarios</DialogTitle>
          <DialogDescription>
            Queda en BORRADOR (REQ-HIS-AFIL-001 US.AFIL.1.5). Agrega al menos una regla desde el
            detalle antes de activarlo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="convenio-afiliado">Médico afiliado</Label>
            <Select value={medicoAfiliadoId} onValueChange={setMedicoAfiliadoId} disabled={isPending}>
              <SelectTrigger id="convenio-afiliado">
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="convenio-desde">Vigencia desde</Label>
              <Input
                id="convenio-desde"
                type="date"
                value={vigenciaDesde}
                onChange={(e) => setVigenciaDesde(e.target.value)}
                disabled={isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="convenio-hasta">Vigencia hasta (opcional)</Label>
              <Input
                id="convenio-hasta"
                type="date"
                value={vigenciaHasta}
                onChange={(e) => setVigenciaHasta(e.target.value)}
                disabled={isPending}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="convenio-retencion">Retención de renta (%)</Label>
              <Input
                id="convenio-retencion"
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={retencionRentaPct}
                onChange={(e) => setRetencionRentaPct(e.target.value)}
                disabled={isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="convenio-periodicidad">Periodicidad de liquidación</Label>
              <Select
                value={periodicidad}
                onValueChange={(v) => setPeriodicidad(v as "QUINCENAL" | "MENSUAL")}
                disabled={isPending}
              >
                <SelectTrigger id="convenio-periodicidad">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MENSUAL">Mensual</SelectItem>
                  <SelectItem value="QUINCENAL">Quincenal</SelectItem>
                </SelectContent>
              </Select>
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
