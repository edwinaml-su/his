// @ts-nocheck — UI shape mismatch con router F2-S2; refinar en F2-S3.
"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Textarea } from "@his/ui/components/textarea";
import { Label } from "@his/ui/components/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { Badge } from "@his/ui/components/badge";
import { trpc } from "@/lib/trpc/react";

// Tipo local para evitar dependencia de @his/contracts que no resuelve en worktrees.
type RectificacionRow = {
  id: string;
  documento_instancia_id: string;
  campo: string;
  valor_anterior: string;
  valor_propuesto: string;
  motivo: string;
  estado: "PENDIENTE" | "APROBADA" | "RECHAZADA";
  solicitante_id: string;
  solicitante_nombre: string | null;
  aprobador_id: string | null;
  fecha_aprobacion: string | null;
  motivo_rechazo: string | null;
  created_at: string;
};

/**
 * Admin ECE — Cola de rectificaciones pendientes para DIR.
 * Requiere documentoInstanciaId por query param.
 *
 * @QA: E2E debe cubrir flujo aprobar y rechazar con rol DIR.
 */

const dateFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "medium",
  timeStyle: "short",
});

function AccionRow({ rect, onDone }: { rect: RectificacionRow; onDone: () => void }) {
  const [motivoRechazo, setMotivoRechazo] = React.useState("");
  const [showRechazo, setShowRechazo] = React.useState(false);

  const aprobar = trpc.eceRectificacion.aprobar.useMutation({ onSuccess: onDone });
  const rechazar = trpc.eceRectificacion.rechazar.useMutation({ onSuccess: onDone });

  if (rect.estado !== "PENDIENTE") {
    return (
      <Badge
        variant={rect.estado === "APROBADA" ? "default" : "destructive"}
      >
        {rect.estado === "APROBADA" ? "Aprobada" : "Rechazada"}
      </Badge>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => aprobar.mutate({ rectificacionId: rect.id })}
          disabled={aprobar.isPending || rechazar.isPending}
          aria-label="Aprobar rectificación"
        >
          Aprobar
        </Button>
        <Button
          size="sm"
          variant="destructive"
          onClick={() => setShowRechazo((v) => !v)}
          disabled={aprobar.isPending || rechazar.isPending}
          aria-expanded={showRechazo}
          aria-label="Rechazar rectificación"
        >
          Rechazar
        </Button>
      </div>
      {showRechazo && (
        <div className="space-y-1.5">
          <Label htmlFor={`motivo-${rect.id}`}>Motivo del rechazo</Label>
          <Textarea
            id={`motivo-${rect.id}`}
            rows={2}
            value={motivoRechazo}
            onChange={(e) => setMotivoRechazo(e.target.value)}
            placeholder="Mínimo 10 caracteres."
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              rechazar.mutate({
                rectificacionId: rect.id,
                motivoRechazo,
              })
            }
            disabled={motivoRechazo.length < 10 || rechazar.isPending}
          >
            Confirmar rechazo
          </Button>
          {rechazar.error && (
            <p role="alert" className="text-xs text-destructive">
              {rechazar.error.message}
            </p>
          )}
        </div>
      )}
      {aprobar.error && (
        <p role="alert" className="text-xs text-destructive">
          {aprobar.error.message}
        </p>
      )}
    </div>
  );
}

export default function ColaRectificacionesPage() {
  const searchParams = useSearchParams();
  const docId = searchParams.get("documentoInstanciaId") ?? "";

  const query = trpc.eceRectificacion.list.useQuery(
    { documentoInstanciaId: docId, estado: "PENDIENTE" },
    { enabled: docId.length > 0 },
  );

  if (!docId) {
    return (
      <p className="text-sm text-muted-foreground">
        Accede desde un documento firmado para revisar su cola de rectificaciones.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Cola de rectificaciones ECE</h1>
        <p className="text-sm text-muted-foreground">
          Solicitudes pendientes de aprobación (rol DIR). NTEC Art. 41.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pendientes de revisión</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading && (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          )}
          {query.error && (
            <p role="alert" className="text-sm text-destructive">
              {query.error.message}
            </p>
          )}
          {query.data && query.data.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No hay rectificaciones pendientes para este documento.
            </p>
          )}
          {query.data && query.data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campo</TableHead>
                  <TableHead>Valor anterior</TableHead>
                  <TableHead>Valor propuesto</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead>Solicitante</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.campo}</TableCell>
                    <TableCell className="max-w-[10rem] truncate text-sm">
                      {r.valor_anterior}
                    </TableCell>
                    <TableCell className="max-w-[10rem] truncate text-sm">
                      {r.valor_propuesto}
                    </TableCell>
                    <TableCell className="max-w-[14rem] truncate text-sm">
                      {r.motivo}
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.solicitante_nombre ?? "—"}
                    </TableCell>
                    <TableCell className="tabular-nums text-sm">
                      {r.created_at
                        ? dateFmt.format(new Date(r.created_at))
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <AccionRow
                        rect={r}
                        onDone={() => query.refetch()}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
