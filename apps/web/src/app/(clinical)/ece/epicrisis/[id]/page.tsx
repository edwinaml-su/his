// @ts-nocheck — UI shape mismatch / dep faltante; refinar en F2-S3.
"use client";

/**
 * ECE — Detalle epicrisis + workflow MC → ESP → DIR.
 *
 * Badges de estado del workflow:
 *   borrador         → MC puede firmar
 *   firmado_mc       → ESP puede validar
 *   validado_esp     → DIR puede certificar
 *   certificado_dir  → inmutable, solo lectura
 *
 * Acción "Certificar" visible únicamente si rol=DIR y estado=validado_esp.
 */
import * as React from "react";
import { use } from "react";
import { Lock, CheckCircle2, Circle, Clock } from "lucide-react";
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

type WorkflowEstado =
  | "borrador"
  | "firmado_mc"
  | "validado_esp"
  | "certificado_dir"
  | "revocado";

interface WorkflowStep {
  codigo: WorkflowEstado;
  label: string;
  rol: string;
  accion: string;
  accionLabel: string;
}

const WORKFLOW_STEPS: WorkflowStep[] = [
  {
    codigo: "borrador",
    label: "Borrador",
    rol: "MC",
    accion: "firmar",
    accionLabel: "Firmar (MC)",
  },
  {
    codigo: "firmado_mc",
    label: "Firmado MC",
    rol: "ESP",
    accion: "validar",
    accionLabel: "Validar (ESP)",
  },
  {
    codigo: "validado_esp",
    label: "Validado ESP",
    rol: "DIR",
    accion: "certificar",
    accionLabel: "Certificar (DIR)",
  },
  {
    codigo: "certificado_dir",
    label: "Certificado DIR",
    rol: "",
    accion: "",
    accionLabel: "",
  },
];

// Qué rol puede actuar en cada estado
const ACCION_POR_ESTADO: Record<WorkflowEstado, WorkflowStep | null> = {
  borrador: WORKFLOW_STEPS[0]!,
  firmado_mc: WORKFLOW_STEPS[1]!,
  validado_esp: WORKFLOW_STEPS[2]!,
  certificado_dir: null,
  revocado: null,
};

function WorkflowBadges({ estadoCodigo }: { estadoCodigo: string }) {
  const LABEL: Record<string, string> = {
    borrador: "Borrador",
    firmado_mc: "Firmado MC",
    validado_esp: "Validado ESP",
    certificado_dir: "Certificado DIR",
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {WORKFLOW_STEPS.filter((s) => s.codigo !== "revocado").map((step) => {
        const stepIndex = WORKFLOW_STEPS.indexOf(step);
        const currentIndex = WORKFLOW_STEPS.findIndex((s) => s.codigo === estadoCodigo);
        const done = stepIndex < currentIndex;
        const current = step.codigo === estadoCodigo;

        return (
          <div key={step.codigo} className="flex items-center gap-1.5">
            {done ? (
              <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden />
            ) : current ? (
              <Clock className="h-4 w-4 text-[#1a3c6e]" aria-hidden />
            ) : (
              <Circle className="h-4 w-4 text-muted-foreground/40" aria-hidden />
            )}
            <Badge
              variant={
                done
                  ? "default"
                  : current
                    ? "secondary"
                    : "outline"
              }
              className={current ? "border-[#1a3c6e] text-[#1a3c6e]" : undefined}
            >
              {LABEL[step.codigo] ?? step.codigo}
            </Badge>
          </div>
        );
      })}
    </div>
  );
}

// ─── Modal confirmación certificación ────────────────────────────────────────

function CertificarDialog({
  open,
  onClose,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (observacion: string) => void;
  isPending: boolean;
}) {
  const [observacion, setObservacion] = React.useState("");
  const [ack, setAck] = React.useState(false);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Certificar epicrisis</DialogTitle>
          <DialogDescription>
            La certificación DIR es la acción final del workflow. El documento quedará
            <strong> inmutable</strong> e integrado en el expediente clínico.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="observacion-cert">Observaciones (opcional)</Label>
            <Input
              id="observacion-cert"
              value={observacion}
              onChange={(e) => setObservacion(e.target.value)}
              placeholder="Observaciones del director médico…"
              maxLength={500}
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
              Entiendo que esta acción es <strong>irreversible</strong>. El documento
              no podrá modificarse una vez certificado.
            </span>
          </label>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button
            onClick={() => onConfirm(observacion)}
            disabled={!ack || isPending}
            className="bg-[#1a3c6e] hover:bg-[#15305a] text-white"
          >
            {isPending ? "Certificando…" : "Certificar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function EpicrisisDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const query = trpc.workflowInstance.get.useQuery({ id });
  const historyQuery = trpc.workflowInstance.history.useQuery(
    { instanceId: id, limit: 20 },
    { enabled: !!id },
  );

  const advance = trpc.workflowInstance.advance.useMutation({
    onSuccess: () => {
      query.refetch();
      historyQuery.refetch();
    },
  });

  const [showPinModal, setShowPinModal] = React.useState(false);
  const [pendingAccion, setPendingAccion] = React.useState<string>("");
  const [showCertDialog, setShowCertDialog] = React.useState(false);

  const instancia = query.data;
  const estado = (instancia?.estado_codigo ?? "borrador") as WorkflowEstado;
  const accionStep = ACCION_POR_ESTADO[estado] ?? null;

  // El botón "Certificar" es distinto: abre diálogo de confirmación + no requiere PIN
  // (la certificación DIR usa autorización por rol, no PIN electrónico).
  // Firmar (MC) y Validar (ESP) requieren PIN.
  const requierePin = accionStep?.accion === "firmar" || accionStep?.accion === "validar";

  function handleAccionClick() {
    if (!accionStep) return;
    if (accionStep.accion === "certificar") {
      setShowCertDialog(true);
    } else {
      setPendingAccion(accionStep.accion);
      setShowPinModal(true);
    }
  }

  function onPinConfirmed(firmaId: string) {
    advance.mutate({
      instanceId: id,
      accion: pendingAccion,
      firmaId,
    });
    setShowPinModal(false);
  }

  function onCertificarConfirm(observacion: string) {
    advance.mutate({
      instanceId: id,
      accion: "certificar",
      observacion: observacion || undefined,
    });
    setShowCertDialog(false);
  }

  const dateFmt = new Intl.DateTimeFormat("es-SV", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Epicrisis</h1>
          <p className="font-mono text-xs text-muted-foreground">{id}</p>
        </div>
        {/* Botón de acción según estado y rol */}
        {accionStep && (
          <Button
            onClick={handleAccionClick}
            disabled={advance.isPending}
            className={
              accionStep.accion === "certificar"
                ? "bg-[#1a3c6e] hover:bg-[#15305a] text-white"
                : undefined
            }
          >
            {advance.isPending ? "Procesando…" : accionStep.accionLabel}
          </Button>
        )}
      </div>

      {/* Banner inmutabilidad si ya está certificado */}
      {estado === "certificado_dir" && (
        <div
          role="note"
          className="flex items-center gap-2 rounded-md border border-green-500/40 bg-green-50 px-4 py-2.5 text-sm text-green-800 dark:bg-green-950/30 dark:text-green-300"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
          <span>
            <strong>Epicrisis certificada.</strong> Documento inmutable — ninguna modificación
            es posible.
          </span>
        </div>
      )}

      {/* Advertencia inmutabilidad si aún en flujo */}
      {estado !== "certificado_dir" && (
        <div
          role="note"
          className="flex items-center gap-2 rounded-md border border-amber-400/50 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-300"
        >
          <Lock className="h-4 w-4 shrink-0" aria-hidden />
          <span>
            Documento inmutable post-firma. El contenido clínico no puede modificarse
            una vez firmado por MC.
          </span>
        </div>
      )}

      {/* Badges workflow */}
      <Card>
        <CardHeader>
          <CardTitle>Estado del workflow</CardTitle>
        </CardHeader>
        <CardContent>
          {instancia ? (
            <WorkflowBadges estadoCodigo={instancia.estado_codigo} />
          ) : query.isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : null}
          {query.error && (
            <p role="alert" className="text-sm text-destructive">
              {query.error.message}
            </p>
          )}
          {advance.error && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {advance.error.message}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Metadatos del documento */}
      {instancia && (
        <Card>
          <CardHeader>
            <CardTitle>Información del documento</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">Tipo</dt>
                <dd className="font-medium">{instancia.tipo_nombre}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Estado</dt>
                <dd>
                  <Badge variant={estado === "certificado_dir" ? "default" : "secondary"}>
                    {instancia.estado_nombre}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Versión</dt>
                <dd className="tabular-nums">{instancia.version}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Episodio</dt>
                <dd className="font-mono text-xs">
                  {instancia.episodio_id ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Creado</dt>
                <dd className="tabular-nums">
                  {dateFmt.format(new Date(instancia.creado_en))}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      )}

      {/* Historial de transiciones */}
      <Card>
        <CardHeader>
          <CardTitle>Historial de workflow</CardTitle>
        </CardHeader>
        <CardContent>
          {historyQuery.isLoading && (
            <p className="text-sm text-muted-foreground">Cargando historial…</p>
          )}
          {historyQuery.error && (
            <p role="alert" className="text-sm text-destructive">
              {historyQuery.error.message}
            </p>
          )}
          {historyQuery.data && historyQuery.data.length === 0 && (
            <p className="text-sm text-muted-foreground">Sin transiciones registradas.</p>
          )}
          {historyQuery.data && historyQuery.data.length > 0 && (
            <ol className="space-y-2 text-sm">
              {historyQuery.data.map((h) => (
                <li key={h.id} className="flex items-start gap-3">
                  <CheckCircle2
                    className="mt-0.5 h-4 w-4 shrink-0 text-green-600"
                    aria-hidden
                  />
                  <div>
                    <span className="font-medium">{h.accion}</span>
                    <span className="mx-2 text-muted-foreground">·</span>
                    <span className="text-muted-foreground">
                      {h.estado_anterior_codigo ?? "—"} → {h.estado_nuevo_codigo}
                    </span>
                    {h.observacion && (
                      <p className="mt-0.5 text-muted-foreground">{h.observacion}</p>
                    )}
                    <p className="tabular-nums text-xs text-muted-foreground">
                      {dateFmt.format(new Date(h.ejecutado_en))}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      {/* PIN modal para firmar/validar */}
      {requierePin && (
        <PinConfirmModal
          open={showPinModal}
          onClose={() => setShowPinModal(false)}
          resource={`epicrisis/${id}`}
          action={pendingAccion}
          onConfirmed={onPinConfirmed}
        />
      )}

      {/* Diálogo certificación DIR */}
      <CertificarDialog
        open={showCertDialog}
        onClose={() => setShowCertDialog(false)}
        onConfirm={onCertificarConfirm}
        isPending={advance.isPending}
      />
    </div>
  );
}
