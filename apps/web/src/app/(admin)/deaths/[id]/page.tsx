"use client";

/**
 * Vista detalle de certificado de defunción ECE.
 * Consume trpc.eceCertDef.get + acciones firmar/validar/certificar/anular.
 *
 * Layout:
 *   - Columna principal: datos clínicos (cadena causal CIE-10, manera, lugar, autopsia).
 *   - Sidebar: WorkflowTimeline (MC firma → MC valida → DIR certifica) + botones
 *     contextuales según rol y estado actual.
 *
 * Roles y acciones:
 *   MC / PHYSICIAN: borrador → firmar (PIN) | firmado → validar
 *   DIR:            validado → certificar (PIN) | borrador/firmado/validado → anular
 */

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Lock } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { Separator } from "@his/ui/components/separator";
import {
  WorkflowTimeline,
  type WorkflowTimelineStep,
  type WorkflowStepStatus,
} from "@/components/workflow-timeline";
import { trpc } from "@/lib/trpc/react";

// Shape raw de ece.certificado_defuncion (espeja CertDefRow del router ECE).
// Definido localmente para evitar importar tipos internos de @his/trpc.
interface CertDefRow {
  id: string;
  episodio_id: string;
  paciente_id: string | null;
  fecha_hora_defuncion: Date;
  lugar_defuncion: string;
  causa_principal_cie10: string;
  causas_intermedias_cie10: string[];
  causa_basica_cie10: string;
  manera: string;
  autopsia_realizada: boolean;
  observaciones: string | null;
  estado_workflow: string;
  medico_firmante_id: string | null;
  firmado_en: Date | null;
  validado_en: Date | null;
  certificado_en: Date | null;
  anulado_en: Date | null;
  motivo_anulacion: string | null;
  payload_hash: string | null;
  registrado_en: Date;
  establecimiento_id: string;
}

// ---------------------------------------------------------------------------
// Helpers de estado
// ---------------------------------------------------------------------------

type EstadoWorkflow = "borrador" | "firmado" | "validado" | "certificado" | "anulado";

const ESTADO_LABEL: Record<EstadoWorkflow, string> = {
  borrador: "Borrador",
  firmado: "Firmado MC",
  validado: "Validado MC",
  certificado: "Certificado DIR",
  anulado: "Anulado",
};

const ESTADO_VARIANT: Record<EstadoWorkflow, "default" | "secondary" | "outline" | "destructive" | "success"> = {
  borrador: "outline",
  firmado: "secondary",
  validado: "secondary",
  certificado: "success",
  anulado: "destructive",
};

function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-SV");
}

/**
 * Construye los pasos del timeline para el workflow MC→MC→DIR del cert def.
 * Difiere del buildEpicrisisSteps porque aquí MC valida (no ESP).
 */
function buildCertDefSteps(estado: EstadoWorkflow, cert: CertDefRow): WorkflowTimelineStep[] {
  const ORDER: EstadoWorkflow[] = ["borrador", "firmado", "validado", "certificado"];
  const currentIndex = ORDER.indexOf(estado);

  function stepStatus(target: EstadoWorkflow): WorkflowStepStatus {
    const targetIdx = ORDER.indexOf(target);
    if (estado === "anulado") return "blocked";
    if (targetIdx < currentIndex) return "done";
    if (targetIdx === currentIndex) return "current";
    return "pending";
  }

  return [
    {
      id: "firma-mc",
      label: "Firma MC",
      sublabel: "Médico certifica y firma con PIN",
      rol: "MC",
      status: stepStatus("firmado"),
      completedAt: cert.firmado_en ?? undefined,
    },
    {
      id: "validacion-mc",
      label: "Validación MC",
      sublabel: "Revisión y validación del médico",
      rol: "MC",
      status: stepStatus("validado"),
      completedAt: cert.validado_en ?? undefined,
    },
    {
      id: "certificacion-dir",
      label: "Certificación DIR",
      sublabel: "Director Médico certifica — Art. 21 NTEC",
      rol: "DIR",
      status: stepStatus("certificado"),
      completedAt: cert.certificado_en ?? undefined,
    },
  ];
}

// ---------------------------------------------------------------------------
// Modales PIN inline (patrón epicrisis)
// ---------------------------------------------------------------------------

function PinDialog({
  open,
  title,
  description,
  submitLabel,
  onClose,
  onConfirm,
  isPending,
  withAck,
}: {
  open: boolean;
  title: string;
  description: React.ReactNode;
  submitLabel: string;
  onClose: () => void;
  onConfirm: (pin: string) => void;
  isPending: boolean;
  withAck?: boolean;
}) {
  const [pin, setPin] = React.useState("");
  const [pinError, setPinError] = React.useState<string | null>(null);
  const [ack, setAck] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setPin("");
      setPinError(null);
      setAck(false);
    }
  }, [open]);

  function handleConfirm() {
    if (!/^\d{6,8}$/.test(pin)) {
      setPinError("PIN debe tener 6-8 dígitos.");
      return;
    }
    setPinError(null);
    onConfirm(pin);
  }

  const canSubmit = pin.length >= 6 && !isPending && (!withAck || ack);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div>{description}</div>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pin-cert-def">PIN de firma</Label>
            <Input
              id="pin-cert-def"
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={pin}
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, ""));
                setPinError(null);
              }}
              onKeyDown={(e) => { if (e.key === "Enter") handleConfirm(); }}
              placeholder="6-8 dígitos"
              disabled={isPending}
              autoComplete="current-password"
              autoFocus
              aria-invalid={Boolean(pinError)}
              aria-describedby={pinError ? "pin-err" : undefined}
            />
            {pinError && (
              <p id="pin-err" role="alert" className="text-xs text-destructive">
                {pinError}
              </p>
            )}
          </div>
          {withAck && (
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
                className="mt-0.5"
                aria-label="Confirmo que esta acción es irreversible"
              />
              <span>
                Entiendo que esta acción es <strong>irreversible</strong>.
              </span>
            </label>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!canSubmit}
            className="bg-[#1a3c6e] text-white hover:bg-[#15305a]"
          >
            {isPending ? "Procesando…" : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------

export default function DeathCertificateDetailPage() {
  const params = useParams<{ id: string }>();
  const utils = trpc.useUtils();

  const [showFirmarModal, setShowFirmarModal] = React.useState(false);
  const [showCertificarModal, setShowCertificarModal] = React.useState(false);

  const { data: cert, isLoading, error } = trpc.eceCertDef.get.useQuery({
    id: params.id,
  });

  function invalidate() {
    utils.eceCertDef.get.invalidate({ id: params.id });
    utils.eceCertDef.list.invalidate();
  }

  const firmar = trpc.eceCertDef.firmar.useMutation({ onSuccess: invalidate });
  const validar = trpc.eceCertDef.validar.useMutation({ onSuccess: invalidate });
  const certificar = trpc.eceCertDef.certificar.useMutation({ onSuccess: invalidate });
  const anular = trpc.eceCertDef.anular.useMutation({ onSuccess: invalidate });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando…</p>;
  }
  if (error) {
    return <p className="text-sm text-destructive">{error.message}</p>;
  }
  if (!cert) {
    return <p className="text-sm text-destructive">Certificado no encontrado.</p>;
  }

  const estado = cert.estado_workflow as EstadoWorkflow;
  const steps = buildCertDefSteps(estado, cert);
  const isInmutable = estado === "certificado";

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Certificado de defunción</h1>
          <p className="text-sm text-muted-foreground font-mono">
            {cert.id}
          </p>
        </div>
        <Link href="/deaths" className="text-sm text-primary underline">
          Volver al listado
        </Link>
      </div>

      {/* Banner inmutabilidad */}
      {isInmutable && (
        <div className="flex items-center gap-2 rounded-md border border-green-300 bg-green-50 px-4 py-2 text-sm text-green-800">
          <Lock className="h-4 w-4 shrink-0" aria-hidden />
          <span>
            Documento certificado e inmutable — Art. 21 NTEC. Certificado el{" "}
            {fmtDateTime(cert.certificado_en)}.
          </span>
        </div>
      )}
      {estado === "anulado" && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          Certificado anulado
          {cert.motivo_anulacion ? `: ${cert.motivo_anulacion}` : ""}.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Columna principal: datos clínicos */}
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center justify-between">
                <span>Datos del fallecimiento</span>
                <Badge variant={ESTADO_VARIANT[estado]}>{ESTADO_LABEL[estado]}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 pt-5">
              <section>
                <h2 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                  Evento
                </h2>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <dt className="text-muted-foreground">Fecha y hora</dt>
                    <dd className="font-medium tabular-nums">
                      {fmtDateTime(cert.fecha_hora_defuncion)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Lugar</dt>
                    <dd className="capitalize">{cert.lugar_defuncion}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Manera</dt>
                    <dd className="capitalize">{cert.manera}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Autopsia</dt>
                    <dd>{cert.autopsia_realizada ? "Sí" : "No"}</dd>
                  </div>
                </dl>
              </section>

              <Separator />

              <section>
                <h2 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                  Cadena causal (CIE-10)
                </h2>
                <dl className="space-y-1 text-sm">
                  <div className="flex gap-2">
                    <dt className="w-40 shrink-0 text-muted-foreground">Causa principal</dt>
                    <dd className="font-mono">{cert.causa_principal_cie10}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-40 shrink-0 text-muted-foreground">Causa básica</dt>
                    <dd className="font-mono">{cert.causa_basica_cie10}</dd>
                  </div>
                  {Array.isArray(cert.causas_intermedias_cie10) &&
                    cert.causas_intermedias_cie10.length > 0 && (
                      <div className="flex gap-2">
                        <dt className="w-40 shrink-0 text-muted-foreground">Causas intermedias</dt>
                        <dd className="font-mono">
                          {cert.causas_intermedias_cie10.join(", ")}
                        </dd>
                      </div>
                    )}
                </dl>
              </section>

              {cert.observaciones && (
                <>
                  <Separator />
                  <section>
                    <h2 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                      Observaciones
                    </h2>
                    <p className="whitespace-pre-wrap text-sm">{cert.observaciones}</p>
                  </section>
                </>
              )}

              {/* Datos técnicos del registro */}
              <Separator />
              <section>
                <h2 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                  Registro
                </h2>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <dt className="text-muted-foreground">Episodio</dt>
                    <dd className="font-mono text-xs">{cert.episodio_id}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Registrado</dt>
                    <dd className="tabular-nums">{fmtDateTime(cert.registrado_en)}</dd>
                  </div>
                  {cert.payload_hash && (
                    <div className="col-span-2">
                      <dt className="text-muted-foreground">Hash de integridad</dt>
                      <dd className="break-all font-mono text-xs text-muted-foreground">
                        {cert.payload_hash}
                      </dd>
                    </div>
                  )}
                </dl>
              </section>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar: workflow + acciones */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Workflow ECE</CardTitle>
            </CardHeader>
            <CardContent>
              <WorkflowTimeline steps={steps} />
            </CardContent>
          </Card>

          {/* Acciones contextuales */}
          {!isInmutable && estado !== "anulado" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Acciones disponibles</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {/* MC: firma */}
                {estado === "borrador" && (
                  <Button
                    type="button"
                    className="w-full bg-[#1a3c6e] text-white hover:bg-[#15305a]"
                    onClick={() => setShowFirmarModal(true)}
                    disabled={firmar.isPending}
                  >
                    Firmar (MC)
                  </Button>
                )}

                {/* MC: valida */}
                {estado === "firmado" && (
                  <Button
                    type="button"
                    className="w-full"
                    onClick={() => validar.mutate({ id: cert.id })}
                    disabled={validar.isPending}
                  >
                    {validar.isPending ? "Validando…" : "Validar (MC)"}
                  </Button>
                )}

                {/* DIR: certifica */}
                {estado === "validado" && (
                  <Button
                    type="button"
                    className="w-full bg-[#1a3c6e] text-white hover:bg-[#15305a]"
                    onClick={() => setShowCertificarModal(true)}
                    disabled={certificar.isPending}
                  >
                    Certificar (DIR)
                  </Button>
                )}

                {/* DIR: anular (solo si no certificado) */}
                <Button
                  type="button"
                  variant="destructive"
                  className="w-full"
                  onClick={() => {
                    const motivo = window.prompt(
                      "Motivo de anulación (mínimo 10 caracteres):",
                    );
                    if (!motivo || motivo.trim().length < 10) return;
                    anular.mutate({ id: cert.id, motivoAnulacion: motivo.trim() });
                  }}
                  disabled={anular.isPending}
                >
                  {anular.isPending ? "Anulando…" : "Anular"}
                </Button>

                {/* Errores de mutaciones */}
                {(firmar.error || validar.error || certificar.error || anular.error) && (
                  <p className="text-xs text-destructive" role="alert">
                    {(firmar.error ?? validar.error ?? certificar.error ?? anular.error)?.message}
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Modal firmar MC */}
      <PinDialog
        open={showFirmarModal}
        title="Firmar certificado — MC"
        description={
          <span>
            Al firmar, el documento quedará <strong>inmutable</strong> y pasará al estado
            de validación. Esta acción requiere su PIN de firma electrónica.
          </span>
        }
        submitLabel="Firmar"
        onClose={() => setShowFirmarModal(false)}
        onConfirm={(pin) => {
          firmar.mutate(
            { id: cert.id, pin },
            { onSuccess: () => setShowFirmarModal(false) },
          );
        }}
        isPending={firmar.isPending}
      />

      {/* Modal certificar DIR */}
      <PinDialog
        open={showCertificarModal}
        title="Certificar — DIR (Art. 21 NTEC)"
        description={
          <span>
            La certificación DIR es <strong>irreversible</strong>. El documento quedará
            integrado en el ECE y no podrá modificarse.
          </span>
        }
        submitLabel="Certificar como DIR"
        withAck
        onClose={() => setShowCertificarModal(false)}
        onConfirm={(pin) => {
          certificar.mutate(
            { id: cert.id, pin },
            { onSuccess: () => setShowCertificarModal(false) },
          );
        }}
        isPending={certificar.isPending}
      />
    </div>
  );
}
