"use client";

/**
 * Diálogo de generación de liquidación — CC-0036 Ola 5 (REQ-HIS-AFIL-001
 * US.AFIL.1.7 AC1-AC3). Regenerar sobre el mismo período reemplaza el
 * BORRADOR existente (el server lo hace transparente).
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

export function LiquidacionDialog({ open, onOpenChange, onSaved }: Props) {
  const [medicoAfiliadoId, setMedicoAfiliadoId] = React.useState("");
  const [periodoDesde, setPeriodoDesde] = React.useState("");
  const [periodoHasta, setPeriodoHasta] = React.useState("");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const afiliados = trpcAny.medicoAfiliado.list.useQuery(undefined, { enabled: open });

  React.useEffect(() => {
    if (!open) return;
    setMedicoAfiliadoId("");
    setPeriodoDesde("");
    setPeriodoHasta("");
    setErrorMsg(null);
  }, [open]);

  const generarMutation = trpcAny.honorario.liquidacion.generar.useMutation({
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
    onError: (err: { message: string }) => setErrorMsg(err.message),
  });

  const isPending = generarMutation.isPending;
  const canSubmit = medicoAfiliadoId.length > 0 && periodoDesde.length > 0 && periodoHasta.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Generar liquidación</DialogTitle>
          <DialogDescription>
            Agrupa la producción PENDIENTE del período (REQ-HIS-AFIL-001 US.AFIL.1.7). Si ya existe
            un BORRADOR para ese mismo período, se reemplaza.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="liq-afiliado">Médico afiliado</Label>
            <Select value={medicoAfiliadoId} onValueChange={setMedicoAfiliadoId} disabled={isPending}>
              <SelectTrigger id="liq-afiliado">
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
              <Label htmlFor="liq-desde">Período desde</Label>
              <Input
                id="liq-desde"
                type="date"
                value={periodoDesde}
                onChange={(e) => setPeriodoDesde(e.target.value)}
                disabled={isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="liq-hasta">Período hasta</Label>
              <Input
                id="liq-hasta"
                type="date"
                value={periodoHasta}
                onChange={(e) => setPeriodoHasta(e.target.value)}
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
          <Button
            type="button"
            onClick={() => generarMutation.mutate({ medicoAfiliadoId, periodoDesde, periodoHasta })}
            disabled={isPending || !canSubmit}
          >
            {isPending ? "Generando…" : "Generar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
