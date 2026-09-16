"use client";

/**
 * Detalle de liquidación — CC-0036 Ola 5 (REQ-HIS-AFIL-001 US.AFIL.1.7).
 * Aprobar (segregación generador≠aprobador validada por el server) / anular
 * con motivo, y el detalle de producción incluida (AC7, v1 tabla en pantalla
 * — export PDF/XLSX queda TODO).
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
import { Label } from "@his/ui/components/label";
import { Badge } from "@his/ui/components/badge";
import { Textarea } from "@his/ui/components/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@his/ui/components/table";
import { Alert, AlertDescription, AlertTitle } from "@his/ui/components/alert";
import { trpc } from "@/lib/trpc/react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trpcAny = trpc as any;

const ESTADO_BADGE: Record<string, "outline" | "success" | "warning" | "destructive"> = {
  BORRADOR: "outline",
  APROBADA: "success",
  ENVIADA_ODOO: "success",
  PAGADA: "success",
  ANULADA: "destructive",
};

type Props = {
  liquidacionId: string | null;
  onOpenChange: (open: boolean) => void;
  canAprobar: boolean;
  canAnular: boolean;
  onChanged: () => void;
};

export function LiquidacionDetailDialog({ liquidacionId, onOpenChange, canAprobar, canAnular, onChanged }: Props) {
  const open = liquidacionId !== null;
  const [confirmandoAnular, setConfirmandoAnular] = React.useState(false);
  const [motivo, setMotivo] = React.useState("");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setConfirmandoAnular(false);
      setMotivo("");
      setErrorMsg(null);
    }
  }, [open]);

  const query = trpcAny.honorario.liquidacion.get.useQuery({ id: liquidacionId }, { enabled: open });
  const liquidacion = query.data as
    | {
        id: string;
        folio: string;
        estado: string;
        medicoAfiliado: { nombreCompleto: string };
        periodoDesde: string;
        periodoHasta: string;
        totalBruto: string | number;
        totalRetenciones: string | number;
        totalCompensaciones: string | number;
        totalNeto: string | number;
        producciones: Array<{
          id: string;
          rolMedico: string;
          fecha: string;
          montoFacturado: string | number;
          honorarioCalculado: string | number;
        }>;
      }
    | undefined;

  function refetchAll() {
    query.refetch();
    onChanged();
  }

  const aprobarMutation = trpcAny.honorario.liquidacion.aprobar.useMutation({
    onSuccess: refetchAll,
    onError: (err: { message: string }) => setErrorMsg(err.message),
  });

  const anularMutation = trpcAny.honorario.liquidacion.anular.useMutation({
    onSuccess: () => {
      setConfirmandoAnular(false);
      setMotivo("");
      refetchAll();
    },
    onError: (err: { message: string }) => setErrorMsg(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Liquidación {liquidacion?.folio ?? ""}</DialogTitle>
          <DialogDescription>
            {liquidacion ? `${liquidacion.medicoAfiliado.nombreCompleto} — ${liquidacion.periodoDesde} a ${liquidacion.periodoHasta}` : ""}
          </DialogDescription>
        </DialogHeader>

        {query.isLoading ? <p className="text-sm text-muted-foreground">Cargando…</p> : null}

        {liquidacion ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant={ESTADO_BADGE[liquidacion.estado] ?? "outline"}>{liquidacion.estado}</Badge>
              <span className="text-sm">
                Bruto ${Number(liquidacion.totalBruto).toFixed(2)} · Retenciones $
                {Number(liquidacion.totalRetenciones).toFixed(2)} · Compensaciones $
                {Number(liquidacion.totalCompensaciones).toFixed(2)} ·{" "}
                <strong>Neto ${Number(liquidacion.totalNeto).toFixed(2)}</strong>
              </span>
            </div>

            {liquidacion.estado === "BORRADOR" && canAprobar ? (
              <Button size="sm" onClick={() => aprobarMutation.mutate({ id: liquidacion.id })} disabled={aprobarMutation.isPending}>
                {aprobarMutation.isPending ? "Aprobando…" : "Aprobar"}
              </Button>
            ) : null}

            {liquidacion.estado === "APROBADA" && canAnular ? (
              confirmandoAnular ? (
                <div className="space-y-2 rounded-md border border-destructive/40 p-3">
                  <Label htmlFor="liq-motivo-anular">Motivo de anulación</Label>
                  <Textarea
                    id="liq-motivo-anular"
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    placeholder="Explica por qué se anula esta liquidación…"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setConfirmandoAnular(false)}>
                      Cancelar
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={motivo.trim().length === 0 || anularMutation.isPending}
                      onClick={() => anularMutation.mutate({ id: liquidacion.id, motivo })}
                    >
                      {anularMutation.isPending ? "Anulando…" : "Confirmar anulación"}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button size="sm" variant="destructive" onClick={() => setConfirmandoAnular(true)}>
                  Anular
                </Button>
              )
            ) : null}

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Rol</TableHead>
                    <TableHead className="text-right">Facturado</TableHead>
                    <TableHead className="text-right">Honorario</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {liquidacion.producciones.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                        Sin producción incluida todavía (se enlaza al aprobar).
                      </TableCell>
                    </TableRow>
                  ) : null}
                  {liquidacion.producciones.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{String(p.fecha).slice(0, 10)}</TableCell>
                      <TableCell>{p.rolMedico}</TableCell>
                      <TableCell className="text-right">${Number(p.montoFacturado).toFixed(2)}</TableCell>
                      <TableCell className="text-right">${Number(p.honorarioCalculado).toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {errorMsg && (
              <Alert variant="destructive">
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{errorMsg}</AlertDescription>
              </Alert>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
