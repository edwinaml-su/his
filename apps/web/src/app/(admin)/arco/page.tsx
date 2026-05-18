"use client";

/**
 * US.F2.7.44-45 — Cola ARCO para DIR/ADM.
 *
 * Lista solicitudes de rectificación y supresión del paciente en estado PENDIENTE.
 * El director aprueba o rechaza con motivo legal.
 * URL: /arco (admin)
 */

import * as React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import { Label } from "@his/ui/components/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { trpc } from "@/lib/trpc/react";

function ResponderDialog({
  solicitudId,
  tipo,
  motivo,
  patientName,
  onClose,
}: {
  solicitudId: string;
  tipo: string;
  motivo: string;
  patientName: string;
  onClose: () => void;
}) {
  const [decision, setDecision] = React.useState<"APROBADA" | "RECHAZADA">("APROBADA");
  const [motivoRespuesta, setMotivoRespuesta] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const utils = trpc.useUtils();

  const responder = trpc.portalArco.responder.useMutation({
    onSuccess: () => {
      void utils.portalArco.listParaRevisar.invalidate();
      onClose();
    },
    onError: (err) => setError(err.message),
  });

  const canSubmit = motivoRespuesta.trim().length >= 10 && !responder.isPending;

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>Responder solicitud ARCO — {tipo}</DialogTitle>
        <DialogDescription>
          Paciente: <strong>{patientName}</strong>
        </DialogDescription>
      </DialogHeader>

      <div className="rounded-md border bg-muted/40 p-3 text-sm">
        <p className="font-medium">Motivo del paciente:</p>
        <p className="mt-1 text-muted-foreground">{motivo}</p>
      </div>

      <div className="space-y-3">
        <div className="flex gap-3">
          <Button
            variant={decision === "APROBADA" ? "default" : "outline"}
            size="sm"
            onClick={() => setDecision("APROBADA")}
          >
            Aprobar
          </Button>
          <Button
            variant={decision === "RECHAZADA" ? "destructive" : "outline"}
            size="sm"
            onClick={() => setDecision("RECHAZADA")}
          >
            Rechazar
          </Button>
        </div>

        <div className="space-y-1">
          <Label htmlFor="motivo-resp">
            {decision === "RECHAZADA"
              ? "Motivo legal del rechazo (≥10 caracteres)"
              : "Instrucciones / resolución (≥10 caracteres)"}
          </Label>
          <textarea
            id="motivo-resp"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            rows={4}
            placeholder={
              decision === "RECHAZADA"
                ? "Ej.: Los diagnósticos clínicos no pueden suprimirse por Art. 34-35 NTEC…"
                : "Ej.: Dato corregido. Se procederá con el flujo de rectificación Art. 42 NTEC."
            }
            value={motivoRespuesta}
            onChange={(e) => setMotivoRespuesta(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {motivoRespuesta.trim().length}/10 caracteres mínimos.
          </p>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={responder.isPending}>
          Cancelar
        </Button>
        <Button
          variant={decision === "RECHAZADA" ? "destructive" : "default"}
          disabled={!canSubmit}
          onClick={() =>
            responder.mutate({ solicitudId, decision, motivoRespuesta: motivoRespuesta.trim() })
          }
        >
          {responder.isPending ? "Guardando…" : `Confirmar: ${decision}`}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function tipoBadge(tipo: string) {
  if (tipo === "SUPRESION") {
    return (
      <Badge className="bg-rose-600 text-white hover:bg-rose-700">Supresión</Badge>
    );
  }
  return (
    <Badge className="bg-amber-500 text-white hover:bg-amber-600">Rectificación</Badge>
  );
}

export default function ArcoQueuePage() {
  const [selected, setSelected] = React.useState<{
    id: string;
    tipo: string;
    motivo: string;
    patientName: string;
  } | null>(null);

  const solicitudes = trpc.portalArco.listParaRevisar.useQuery();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Cola ARCO — Solicitudes del paciente</h1>
        <p className="text-sm text-muted-foreground">
          US.F2.7.44-45 — Rectificaciones y supresiones pendientes de autorización DIR.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pendientes de revisión</CardTitle>
          <CardDescription>
            Derechos ARCO: Acceso, Rectificación, Cancelación/Supresión, Oposición — Ley de
            Protección de Datos Personales Arts. 9, 18.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {solicitudes.isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : solicitudes.error ? (
            <p className="text-sm text-destructive">{solicitudes.error.message}</p>
          ) : !solicitudes.data || solicitudes.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin solicitudes ARCO pendientes.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Paciente</TableHead>
                  <TableHead>Documento afectado</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-right">Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {solicitudes.data.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{tipoBadge(s.tipo)}</TableCell>
                    <TableCell>
                      <span className="font-medium">
                        {s.paciente.lastName}, {s.paciente.firstName}
                      </span>
                      <span className="block font-mono text-xs text-muted-foreground">
                        MRN {s.paciente.mrn}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate text-sm">
                      {s.documentoTarget ?? "—"}
                    </TableCell>
                    <TableCell className="max-w-[240px] truncate text-sm text-muted-foreground">
                      {s.motivo}
                    </TableCell>
                    <TableCell className="tabular-nums text-sm">
                      {new Date(s.creadoEn).toLocaleDateString("es-SV")}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        onClick={() =>
                          setSelected({
                            id: s.id,
                            tipo: s.tipo,
                            motivo: s.motivo,
                            patientName: `${s.paciente.lastName}, ${s.paciente.firstName}`,
                          })
                        }
                      >
                        Responder
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(selected)} onOpenChange={(o) => !o && setSelected(null)}>
        {selected ? (
          <ResponderDialog
            solicitudId={selected.id}
            tipo={selected.tipo}
            motivo={selected.motivo}
            patientName={selected.patientName}
            onClose={() => setSelected(null)}
          />
        ) : null}
      </Dialog>
    </div>
  );
}
