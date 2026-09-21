"use client";

/**
 * CC-0016 — Tab «📋 Solicitudes del paciente» (mockup view-listado) +
 * modal de detalle (reutilizado por el deep-link del workflow-inbox).
 */
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { Badge, type BadgeProps } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { trpc } from "@/lib/trpc/react";
import { formatDate } from "@/lib/i18n/org-locale";
import type { ImagingSolicitudEstado } from "@his/contracts";
import { PRIO_SEGMENT, PRIO_VALUE_TO_LABEL } from "./field-rule-meta";

const ESTADO_LABEL: Record<ImagingSolicitudEstado, string> = {
  pend: "Pendiente",
  prog: "Programado",
  real: "Realizado",
  inf: "Informado",
  anulado: "Anulado",
};

const ESTADO_VARIANT: Record<ImagingSolicitudEstado, BadgeProps["variant"]> = {
  pend: "warning",
  prog: "info",
  real: "secondary",
  inf: "success",
  anulado: "destructive",
};

const DATE_FMT_OPTIONS: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric" };

/** CC-0041 RF-04 — pill de prioridad con el patrón de colores obligatorio. */
function PrioPill({ prioridad }: { prioridad: string }) {
  const label = (PRIO_VALUE_TO_LABEL[prioridad] ?? prioridad) as "Rutina" | "Urgente" | "STAT";
  const seg = PRIO_SEGMENT[label] ?? PRIO_SEGMENT.Rutina;
  return (
    <span
      data-testid="img-prio-pill"
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold"
      style={{ backgroundColor: seg.onBg, color: seg.onColor }}
    >
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: seg.dot }} />
      {label}
    </span>
  );
}

export function SolicitudesListado({
  cuentaId,
  openRequestId,
  onOpenRequestIdChange,
}: {
  cuentaId: string;
  openRequestId: string | null;
  onOpenRequestIdChange: (id: string | null) => void;
}) {
  const listQ = trpc.imagingRequest.listarPorCuenta.useQuery({ cuentaId });
  const rows = listQ.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Solicitudes de radiología e imágenes del paciente</CardTitle>
      </CardHeader>
      <CardContent>
        {listQ.isLoading ? <p className="text-sm text-muted-foreground">Cargando…</p> : null}
        {rows.length === 0 && !listQ.isLoading ? (
          <p className="text-sm text-muted-foreground">Sin solicitudes registradas.</p>
        ) : null}
        {rows.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Folio</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Categoría(s)</TableHead>
                <TableHead>Prestaciones</TableHead>
                <TableHead>Prioridad</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.folio}</TableCell>
                  <TableCell>{formatDate(r.fecha, DATE_FMT_OPTIONS)}</TableCell>
                  <TableCell>{r.categorias}</TableCell>
                  <TableCell>{r.nPrestaciones}</TableCell>
                  <TableCell>
                    <PrioPill prioridad={r.prioridad} />
                  </TableCell>
                  <TableCell>
                    <Badge variant={ESTADO_VARIANT[r.estado]}>{ESTADO_LABEL[r.estado]}</Badge>
                  </TableCell>
                  <TableCell>
                    <Button type="button" variant="ghost" size="sm" onClick={() => onOpenRequestIdChange(r.id)}>
                      Ver
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>

      <DetalleSolicitudDialog id={openRequestId} onOpenChange={(o) => !o && onOpenRequestIdChange(null)} />
    </Card>
  );
}

function DetalleSolicitudDialog({
  id,
  onOpenChange,
}: {
  id: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const detalleQ = trpc.imagingRequest.detalle.useQuery({ id: id ?? "" }, { enabled: Boolean(id) });
  const d = detalleQ.data;

  return (
    <Dialog open={Boolean(id)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{d ? `Solicitud ${d.folio}` : "Solicitud"}</DialogTitle>
        </DialogHeader>
        {detalleQ.isLoading ? <p className="text-sm text-muted-foreground">Cargando…</p> : null}
        {d ? (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={ESTADO_VARIANT[d.estado]}>{ESTADO_LABEL[d.estado]}</Badge>
              <PrioPill prioridad={d.prioridad} />
            </div>
            {d.dx ? (
              <p>
                <span className="font-medium">Diagnóstico: </span>
                {d.dx}
              </p>
            ) : null}
            {d.justificacion ? (
              <p>
                <span className="font-medium">Justificación: </span>
                {d.justificacion}
              </p>
            ) : null}
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Estudio</TableHead>
                    <TableHead>Modalidad</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.orders.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell>{o.studyDescription}</TableCell>
                      <TableCell>{o.modalityType}</TableCell>
                      <TableCell>{o.status}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
