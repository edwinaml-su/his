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
import { PinInputModal } from "@/components/firma/pin-input-modal";

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
 * HG-16 (NTEC Art. 42): aprobar y rechazar requieren PIN argon2id del DIR.
 * El flujo: usuario clickea Aprobar/Rechazar → PinInputModal → PIN enviado
 * inline en el mutation eceRectificacion.aprobar/.rechazar.
 *
 * @QA: E2E debe cubrir:
 *   - aprobar sin PIN → modal se abre, botón Confirmar disabled
 *   - aprobar con PIN incorrecto → alert UNAUTHORIZED en el modal
 *   - aprobar con PIN correcto → fila desaparece de la cola
 *   - rechazar con PIN correcto + motivo → fila desaparece
 */

const dateFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "medium",
  timeStyle: "short",
});

// ---------------------------------------------------------------------------
// AccionRow — maneja los botones Aprobar/Rechazar con PIN modal.
// ---------------------------------------------------------------------------

type PinPendingAction =
  | { kind: "aprobar"; rectId: string }
  | { kind: "rechazar"; rectId: string; motivo: string };

function AccionRow({ rect, onDone }: { rect: RectificacionRow; onDone: () => void }) {
  const [motivoRechazo, setMotivoRechazo] = React.useState("");
  const [showRechazo, setShowRechazo] = React.useState(false);
  const [pendingAction, setPendingAction] = React.useState<PinPendingAction | null>(null);

  const aprobar = trpc.eceRectificacion.aprobar.useMutation({
    onSuccess: () => {
      setPendingAction(null);
      onDone();
    },
  });
  const rechazar = trpc.eceRectificacion.rechazar.useMutation({
    onSuccess: () => {
      setPendingAction(null);
      setShowRechazo(false);
      setMotivoRechazo("");
      onDone();
    },
  });

  const handlePinSubmit = React.useCallback(
    (pin: string) => {
      if (!pendingAction) return;
      if (pendingAction.kind === "aprobar") {
        aprobar.mutate({ rectificacionId: pendingAction.rectId, pin });
      } else {
        rechazar.mutate({
          rectificacionId: pendingAction.rectId,
          motivoRechazo: pendingAction.motivo,
          pin,
        });
      }
    },
    [pendingAction, aprobar, rechazar],
  );

  if (rect.estado !== "PENDIENTE") {
    return (
      <Badge
        variant={rect.estado === "APROBADA" ? "default" : "destructive"}
      >
        {rect.estado === "APROBADA" ? "Aprobada" : "Rechazada"}
      </Badge>
    );
  }

  const isBusy = aprobar.isPending || rechazar.isPending;
  const serverError = aprobar.error?.message ?? rechazar.error?.message;

  return (
    <>
      {/* HG-16: modal PIN abre antes de ejecutar aprobar/rechazar */}
      {pendingAction && (
        <PinInputModal
          open
          onClose={() => {
            setPendingAction(null);
            aprobar.reset();
            rechazar.reset();
          }}
          action={
            pendingAction.kind === "aprobar"
              ? "aprobar rectificación"
              : "rechazar rectificación"
          }
          resource={`Rectificación/${rect.id.slice(0, 8)}`}
          onSubmit={handlePinSubmit}
          errorMessage={serverError}
          isPending={isBusy}
        />
      )}

      <div className="space-y-2">
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() =>
              setPendingAction({ kind: "aprobar", rectId: rect.id })
            }
            disabled={isBusy}
            aria-label="Aprobar rectificación"
          >
            Aprobar
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setShowRechazo((v) => !v)}
            disabled={isBusy}
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
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setMotivoRechazo(e.target.value)}
              placeholder="Mínimo 10 caracteres."
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setPendingAction({
                  kind: "rechazar",
                  rectId: rect.id,
                  motivo: motivoRechazo,
                })
              }
              disabled={motivoRechazo.length < 10 || isBusy}
            >
              Confirmar rechazo
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------

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
          Solicitudes pendientes de aprobación (rol DIR). NTEC Art. 41 / Art. 42.
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
                {query.data.map((r: RectificacionRow) => (
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
