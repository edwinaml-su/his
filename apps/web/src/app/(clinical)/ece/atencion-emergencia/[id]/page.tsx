"use client";

/**
 * ECE — Detalle de atención de emergencia + workflow MT.
 *
 * Estados: borrador → en_revision → firmado → validado → anulado.
 * MT puede firmar (borrador|en_revision → firmado) y validar (firmado → validado).
 * DIR puede anular vía modal de confirmación.
 *
 * Botón "Firmar" abre PinConfirmModal (firma electrónica MT).
 * Botón "Validar" y "Anular" son acciones directas con confirmación inline.
 */
import * as React from "react";
import { use } from "react";
import { CheckCircle2, Circle, Clock, Lock, Siren } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { PinConfirmModal } from "@/components/firma/pin-confirm-modal";
import { trpc } from "@/lib/trpc/react";

// ─── Workflow ─────────────────────────────────────────────────────────────────

type WorkflowEstado = "borrador" | "en_revision" | "firmado" | "validado" | "anulado";

const WORKFLOW_ORDERED: WorkflowEstado[] = [
  "borrador",
  "en_revision",
  "firmado",
  "validado",
];

const ESTADO_LABEL: Record<WorkflowEstado, string> = {
  borrador: "Borrador",
  en_revision: "En revisión",
  firmado: "Firmado MT",
  validado: "Validado",
  anulado: "Anulado",
};

function WorkflowBadges({ estadoCodigo }: { estadoCodigo: string }) {
  const currentIndex = WORKFLOW_ORDERED.indexOf(estadoCodigo as WorkflowEstado);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {WORKFLOW_ORDERED.map((estado, idx) => {
        const done = idx < currentIndex;
        const current = estado === estadoCodigo;
        return (
          <div key={estado} className="flex items-center gap-1.5">
            {done ? (
              <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden />
            ) : current ? (
              <Clock className="h-4 w-4 text-[#1a3c6e]" aria-hidden />
            ) : (
              <Circle className="h-4 w-4 text-muted-foreground/40" aria-hidden />
            )}
            <Badge
              variant={done ? "default" : current ? "secondary" : "outline"}
              className={current ? "border-[#1a3c6e] text-[#1a3c6e]" : undefined}
            >
              {ESTADO_LABEL[estado]}
            </Badge>
          </div>
        );
      })}
    </div>
  );
}

// ─── Modal anulación ──────────────────────────────────────────────────────────

function AnularDialog({
  open,
  onClose,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (motivo: string) => void;
  isPending: boolean;
}) {
  const [motivo, setMotivo] = React.useState("");
  const [ack, setAck] = React.useState(false);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Anular atención de emergencia</DialogTitle>
          <DialogDescription>
            La anulación es <strong>irreversible</strong>. Documente el motivo de forma clara.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="motivo-anulacion">Motivo de anulación (mínimo 10 caracteres)</Label>
            <Input
              id="motivo-anulacion"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Registro duplicado / error de ingreso…"
              maxLength={1000}
            />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Entiendo que esta acción es <strong>irreversible</strong>.
            </span>
          </label>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={() => onConfirm(motivo)}
            disabled={!ack || motivo.trim().length < 10 || isPending}
          >
            {isPending ? "Anulando…" : "Confirmar anulación"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function AtencionEmergenciaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const query = trpc.eceAtencionEmergencia.get.useQuery({ id });
  const firmar = trpc.eceAtencionEmergencia.firmar.useMutation({
    onSuccess: () => query.refetch(),
  });
  const validar = trpc.eceAtencionEmergencia.validar.useMutation({
    onSuccess: () => query.refetch(),
  });
  const anular = trpc.eceAtencionEmergencia.anular.useMutation({
    onSuccess: () => query.refetch(),
  });

  const [showPinModal, setShowPinModal] = React.useState(false);
  const [showAnularDialog, setShowAnularDialog] = React.useState(false);

  const doc = query.data;
  const estado = (doc?.estado_workflow ?? "borrador") as WorkflowEstado;

  const canFirmar = estado === "borrador" || estado === "en_revision";
  const canValidar = estado === "firmado";
  const canAnular = estado !== "validado" && estado !== "anulado";

  function onPinConfirmed(firmaId: string) {
    firmar.mutate({ id, firmaId });
    setShowPinModal(false);
  }

  function onAnularConfirm(motivo: string) {
    anular.mutate({ id, motivoAnulacion: motivo });
    setShowAnularDialog(false);
  }

  const anyPending = firmar.isPending || validar.isPending || anular.isPending;
  const mutationError =
    firmar.error?.message ?? validar.error?.message ?? anular.error?.message ?? null;

  const dateFmt = new Intl.DateTimeFormat("es-SV", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Siren className="h-6 w-6" aria-hidden />
            Atención de Emergencia
          </h1>
          <p className="font-mono text-xs text-muted-foreground">{id}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canFirmar && (
            <Button
              onClick={() => setShowPinModal(true)}
              disabled={anyPending}
              className="bg-[#1a3c6e] hover:bg-[#15305a] text-white"
            >
              {firmar.isPending ? "Firmando…" : "Firmar (MT)"}
            </Button>
          )}
          {canValidar && (
            <Button
              onClick={() => validar.mutate({ id })}
              disabled={anyPending}
              variant="outline"
            >
              {validar.isPending ? "Validando…" : "Validar (MT)"}
            </Button>
          )}
          {canAnular && (
            <Button
              onClick={() => setShowAnularDialog(true)}
              disabled={anyPending}
              variant="destructive"
            >
              Anular
            </Button>
          )}
        </div>
      </div>

      {/* Banner estado */}
      {estado === "validado" && (
        <div
          role="note"
          className="flex items-center gap-2 rounded-md border border-green-500/40 bg-green-50 px-4 py-2.5 text-sm text-green-800 dark:bg-green-950/30 dark:text-green-300"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
          <span>
            <strong>Atención validada.</strong> El documento ha completado el workflow MT.
          </span>
        </div>
      )}
      {estado === "anulado" && (
        <div
          role="note"
          className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive"
        >
          <Lock className="h-4 w-4 shrink-0" aria-hidden />
          <span>
            <strong>Atención anulada.</strong>{" "}
            {doc?.motivo_anulacion ? `Motivo: ${doc.motivo_anulacion}` : ""}
          </span>
        </div>
      )}

      {/* Error de mutación */}
      {mutationError && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {mutationError}
        </p>
      )}

      {/* Estado del workflow */}
      <Card>
        <CardHeader>
          <CardTitle>Estado del workflow</CardTitle>
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
          {doc && <WorkflowBadges estadoCodigo={estado} />}
        </CardContent>
      </Card>

      {/* Contenido clínico */}
      {doc && (
        <Card>
          <CardHeader>
            <CardTitle>Contenido clínico</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6 text-sm">
            <section aria-labelledby="section-motivo">
              <h2 id="section-motivo" className="mb-1 font-semibold text-[#1a3c6e]">
                Motivo de consulta
              </h2>
              <p className="whitespace-pre-wrap">{doc.motivo_consulta}</p>
            </section>
            <section aria-labelledby="section-exploracion">
              <h2 id="section-exploracion" className="mb-1 font-semibold text-[#1a3c6e]">
                Exploración física
              </h2>
              <p className="whitespace-pre-wrap">{doc.exploracion}</p>
            </section>
            <section aria-labelledby="section-diagnostico">
              <h2 id="section-diagnostico" className="mb-1 font-semibold text-[#1a3c6e]">
                Diagnóstico
              </h2>
              <p className="whitespace-pre-wrap">{doc.diagnostico}</p>
            </section>
            <section aria-labelledby="section-plan">
              <h2 id="section-plan" className="mb-1 font-semibold text-[#1a3c6e]">
                Plan terapéutico
              </h2>
              <p className="whitespace-pre-wrap">{doc.plan_terapeutico}</p>
            </section>
          </CardContent>
        </Card>
      )}

      {/* Metadatos */}
      {doc && (
        <Card>
          <CardHeader>
            <CardTitle>Metadatos</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">Estado</dt>
                <dd>
                  <Badge variant={estado === "validado" ? "default" : estado === "anulado" ? "destructive" : "secondary"}>
                    {ESTADO_LABEL[estado] ?? estado}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Episodio</dt>
                <dd className="font-mono text-xs">{doc.episodio_id}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Registrado</dt>
                <dd className="tabular-nums">
                  {dateFmt.format(new Date(doc.registrado_en))}
                </dd>
              </div>
              {doc.firmado_en && (
                <div>
                  <dt className="text-muted-foreground">Firmado</dt>
                  <dd className="tabular-nums">
                    {dateFmt.format(new Date(doc.firmado_en))}
                  </dd>
                </div>
              )}
              {doc.validado_en && (
                <div>
                  <dt className="text-muted-foreground">Validado</dt>
                  <dd className="tabular-nums">
                    {dateFmt.format(new Date(doc.validado_en))}
                  </dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>
      )}

      {/* PIN modal firma MT */}
      <PinConfirmModal
        open={showPinModal}
        onClose={() => setShowPinModal(false)}
        resource={`atencion-emergencia/${id}`}
        action="firmar"
        onConfirmed={onPinConfirmed}
      />

      {/* Dialog anulación */}
      <AnularDialog
        open={showAnularDialog}
        onClose={() => setShowAnularDialog(false)}
        onConfirm={onAnularConfirm}
        isPending={anular.isPending}
      />
    </div>
  );
}
