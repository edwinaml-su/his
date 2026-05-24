"use client";

/**
 * ECE — Detalle epicrisis + workflow MC → ESP → DIR.
 *
 * Layout 2 columnas:
 *   - Izquierda: contenido clínico (secciones plegables) + PDF preview
 *   - Derecha (sidebar): WorkflowTimeline + botones contextuales por rol/estado
 *
 * Estados del workflow:
 *   borrador        → MC puede firmar (PIN requerido)
 *   firmado         → ESP puede validar (PIN requerido)
 *   validado        → DIR puede certificar (confirmación)
 *   certificado_dir → inmutable, solo lectura
 *
 * Inmutabilidad post-firma: banner permanente con icono Lock (Art. 40).
 */

import * as React from "react";
import { use } from "react";
import { Lock, ChevronDown, ChevronRight, FileText, ClipboardList } from "lucide-react";
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
import { Skeleton } from "@his/ui/components/skeleton";
import { PinConfirmModal } from "@/components/firma/pin-confirm-modal";
import {
  WorkflowTimeline,
  buildEpicrisisSteps,
  type EpicrisisEstado,
} from "@/components/workflow-timeline";
import { EpicrisisPdfPreview, type EpicrisisPdfData } from "@/components/epicrisis-pdf-preview";
import { trpc } from "@/lib/trpc/react";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

type WorkflowEstado = EpicrisisEstado;

// ---------------------------------------------------------------------------
// Sección plegable
// ---------------------------------------------------------------------------

function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const id = React.useId();
  const contentId = `section-content-${id}`;

  return (
    <div className="border-b last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {title}
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
      </button>
      <div id={contentId} hidden={!open}>
        <div className="px-4 pb-4 pt-1 text-sm">{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal confirmación certificación DIR
// ---------------------------------------------------------------------------

function CertificarDialog({
  open,
  onClose,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  /** Llamado con el PIN ingresado por el DIR. */
  onConfirm: (pin: string) => void;
  isPending: boolean;
}) {
  const [pin, setPin] = React.useState("");
  const [pinError, setPinError] = React.useState<string | null>(null);
  const [ack, setAck] = React.useState(false);

  // Resetear al cerrar
  React.useEffect(() => {
    if (!open) {
      setPin("");
      setPinError(null);
      setAck(false);
    }
  }, [open]);

  function handleConfirm() {
    if (!/^\d{6,8}$/.test(pin)) {
      setPinError("El PIN debe tener entre 6 y 8 dígitos numéricos.");
      return;
    }
    setPinError(null);
    onConfirm(pin);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Certificar epicrisis — Art. 21 NTEC</DialogTitle>
          <DialogDescription>
            La certificación DIR es la acción final del workflow. El documento quedará
            <strong> inmutable</strong> e integrado en el expediente clínico electrónico.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pin-cert-dir">PIN de firma DIR</Label>
            <Input
              id="pin-cert-dir"
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
              aria-describedby={pinError ? "pin-cert-error" : undefined}
              aria-invalid={pinError ? true : undefined}
              disabled={isPending}
              autoComplete="current-password"
              autoFocus
            />
            {pinError && (
              <p id="pin-cert-error" role="alert" className="text-xs text-destructive">
                {pinError}
              </p>
            )}
          </div>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
              className="mt-0.5"
              aria-label="Confirmo que esta acción es irreversible"
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
            onClick={handleConfirm}
            disabled={!ack || pin.length < 6 || isPending}
            className="bg-[#1a3c6e] hover:bg-[#15305a] text-white"
            aria-busy={isPending}
          >
            {isPending ? "Certificando…" : "Certificar como DIR"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------

export default function EpicrisisDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const query = trpc.eceEpicrisis.get.useQuery({ id });

  const firmar = trpc.eceEpicrisis.firmar.useMutation({
    onSuccess: () => query.refetch(),
  });
  const validar = trpc.eceEpicrisis.validar.useMutation({
    onSuccess: () => query.refetch(),
  });
  const certificar = trpc.eceEpicrisis.certificar.useMutation({
    onSuccess: () => query.refetch(),
  });

  const [showPinModal, setShowPinModal] = React.useState(false);
  const [pinAccion, setPinAccion] = React.useState<"firmar" | "validar">("firmar");
  const [showCertDialog, setShowCertDialog] = React.useState(false);
  const [showPdfPreview, setShowPdfPreview] = React.useState(false);

  const epicrisis = query.data;
  const estado = (epicrisis?.estado_workflow ?? "borrador") as WorkflowEstado;
  const isCertificado = estado === "certificado";
  const isAnulado = estado === "anulado";

  function handleFirmar() {
    setPinAccion("firmar");
    setShowPinModal(true);
  }

  function handleValidar() {
    setPinAccion("validar");
    setShowPinModal(true);
  }

  function handleCertificarClick() {
    setShowCertDialog(true);
  }

  function onPinConfirmed(firmaId: string) {
    if (pinAccion === "firmar") {
      firmar.mutate({ id, firmaId });
    } else {
      validar.mutate({ id });
    }
    setShowPinModal(false);
  }

  function onCertificarConfirm(pin: string) {
    // A-03: invocar la mutación efectivamente.
    // El PIN actúa como lookup key para obtener el firmaId del servidor.
    // Mientras `trpc.firma.confirm` no esté disponible, usamos el PIN
    // como firmaId provisional — el servidor retornará error tipado si no
    // es UUID válido, que se muestra en el banner de error del sidebar.
    // Cuando firma.confirm se implemente, reemplazar esta línea por:
    //   const { firmaId } = await firmaConfirm.mutateAsync({ pin, resource: `epicrisis/${id}` });
    //   certificar.mutate({ id, firmaId });
    setShowCertDialog(false);
    certificar.mutate({ id, firmaId: pin });
  }

  const isMutating =
    firmar.isPending || validar.isPending || certificar.isPending;

  const mutationError =
    firmar.error?.message ??
    validar.error?.message ??
    certificar.error?.message ??
    null;

  // Construir steps del timeline
  const timelineSteps = buildEpicrisisSteps(estado, {
    firmadoEn: epicrisis?.firmado_en,
    validadoEn: epicrisis?.validado_en,
    certificadoEn: epicrisis?.certificado_en,
  });

  // Construir datos del PDF (con defaults para campos opcionales del router)
  const pdfData: EpicrisisPdfData | null = epicrisis
    ? {
        id: epicrisis.id,
        episodioId: epicrisis.episodio_id,
        pacienteNombre: "Paciente",
        fechaEgreso: new Date(epicrisis.fecha_hora_egreso),
        motivoEgreso: epicrisis.circunstancia_alta,
        establecimientoNombre: "Complejo Hospitalario Avante",
        diagnosticosEgreso: Array.isArray(epicrisis.diagnosticos_egreso)
          ? (epicrisis.diagnosticos_egreso as EpicrisisPdfData["diagnosticosEgreso"])
          : [],
        resumenIngreso: epicrisis.resumen_ingreso ?? "",
        evolucionHospitalaria: epicrisis.evolucion_hospitalaria ?? "",
        tratamientoEgreso: epicrisis.tratamiento_egreso ?? "",
        indicacionesEgreso: epicrisis.indicaciones_egreso ?? "",
        notas: epicrisis.notas,
        firmadoEn: epicrisis.firmado_en,
        validadoEn: epicrisis.validado_en,
        certificadoEn: epicrisis.certificado_en,
        estado: estado as EpicrisisPdfData["estado"],
      }
    : null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Epicrisis de Egreso</h1>
          <p className="font-mono text-xs text-muted-foreground">{id}</p>
        </div>
        <div className="flex items-center gap-2">
          {epicrisis && !isAnulado && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowPdfPreview((v) => !v)}
              aria-label={showPdfPreview ? "Ocultar vista PDF" : "Ver vista para imprimir"}
            >
              <FileText className="mr-1.5 h-4 w-4" aria-hidden />
              {showPdfPreview ? "Ocultar PDF" : "Ver PDF"}
            </Button>
          )}
          {estado === "borrador" && (
            <Badge variant="secondary" aria-label="Estado: Borrador">Borrador</Badge>
          )}
          {isAnulado && (
            <Badge variant="destructive" aria-label="Estado: Anulado">Anulado</Badge>
          )}
        </div>
      </div>

      {/* Banner inmutabilidad — permanente */}
      {isCertificado ? (
        <div
          role="note"
          aria-label="Documento certificado e inmutable"
          className="flex items-center gap-2 rounded-md border border-green-500/40 bg-green-50 px-4 py-2.5 text-sm text-green-800 dark:bg-green-950/30 dark:text-green-300"
        >
          <Lock className="h-4 w-4 shrink-0" aria-hidden />
          <span>
            <strong>Epicrisis certificada DIR.</strong> Documento inmutable — ninguna
            modificación es posible (Art. 40 Reglamento ECE).
          </span>
        </div>
      ) : (
        <div
          role="note"
          aria-label="Advertencia: documento inmutable post-firma"
          className="flex items-center gap-2 rounded-md border border-amber-400/50 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-300"
        >
          <Lock className="h-4 w-4 shrink-0" aria-hidden />
          <span>
            <strong>Documento inmutable post-firma.</strong> El contenido clínico no puede
            modificarse una vez firmado por MC (Art. 40 Reglamento ECE).
          </span>
        </div>
      )}

      {/* Carga / error de query */}
      {query.isLoading && (
        <div className="space-y-3" aria-busy="true" aria-label="Cargando epicrisis">
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      )}

      {query.error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {query.error.message}
        </div>
      )}

      {/* Layout 2 columnas */}
      {epicrisis && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
          {/* ── Columna izquierda: contenido clínico ── */}
          <div className="space-y-4">
            {/* Secciones plegables */}
            <Card>
              <CardHeader className="pb-0">
                <CardTitle className="flex items-center gap-2">
                  <ClipboardList className="h-4 w-4 text-muted-foreground" aria-hidden />
                  Contenido clínico
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-3">
                <div className="divide-y rounded-md border">
                  <CollapsibleSection title="Resumen de ingreso" defaultOpen>
                    <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
                      {epicrisis.resumen_ingreso || (
                        <span className="italic">Sin contenido.</span>
                      )}
                    </p>
                  </CollapsibleSection>

                  <CollapsibleSection title="Evolución hospitalaria" defaultOpen>
                    <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
                      {epicrisis.evolucion_hospitalaria || (
                        <span className="italic">Sin contenido.</span>
                      )}
                    </p>
                  </CollapsibleSection>

                  <CollapsibleSection title="Diagnóstico de egreso CIE-10" defaultOpen>
                    {Array.isArray(epicrisis.diagnosticos_egreso) &&
                    epicrisis.diagnosticos_egreso.length > 0 ? (
                      <ul className="space-y-1.5">
                        {(epicrisis.diagnosticos_egreso as Array<{
                          cie10: string;
                          descripcion: string;
                          tipo: string;
                        }>).map((dx, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="shrink-0 rounded border border-[#1a3c6e] px-1.5 py-0.5 font-mono text-xs font-bold text-[#1a3c6e]">
                              {dx.cie10}
                            </span>
                            <span>
                              {dx.descripcion}
                              {dx.tipo === "principal" && (
                                <span className="ml-1.5 text-xs text-muted-foreground">
                                  (principal)
                                </span>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="italic text-muted-foreground">Sin diagnósticos registrados.</p>
                    )}
                  </CollapsibleSection>

                  <CollapsibleSection title="Tratamiento al egreso" defaultOpen={false}>
                    <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
                      {epicrisis.tratamiento_egreso || (
                        <span className="italic">Sin contenido.</span>
                      )}
                    </p>
                  </CollapsibleSection>

                  <CollapsibleSection title="Indicaciones post-alta y próximos controles" defaultOpen={false}>
                    <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
                      {epicrisis.indicaciones_egreso || (
                        <span className="italic">Sin contenido.</span>
                      )}
                    </p>
                  </CollapsibleSection>

                  {epicrisis.notas && (
                    <CollapsibleSection title="Notas adicionales" defaultOpen={false}>
                      <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
                        {epicrisis.notas}
                      </p>
                    </CollapsibleSection>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Preview PDF */}
            {showPdfPreview && pdfData && (
              <EpicrisisPdfPreview data={pdfData} showPrintButton />
            )}
          </div>

          {/* ── Columna derecha: sidebar workflow ── */}
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Workflow</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <WorkflowTimeline steps={timelineSteps} />

                {/* Error de mutación */}
                {mutationError && (
                  <p role="alert" className="text-xs text-destructive">
                    {mutationError}
                  </p>
                )}

                {/* Botones contextuales según estado */}
                {!isCertificado && !isAnulado && (
                  <div className="space-y-2 border-t pt-3">
                    {estado === "borrador" && (
                      <Button
                        className="w-full bg-[#1a3c6e] hover:bg-[#15305a] text-white"
                        onClick={handleFirmar}
                        disabled={isMutating}
                        aria-label="Firmar epicrisis como Médico Cirujano"
                      >
                        {firmar.isPending ? "Firmando…" : "Firmar como MC"}
                      </Button>
                    )}
                    {estado === "firmado" && (
                      <Button
                        className="w-full bg-[#1a3c6e] hover:bg-[#15305a] text-white"
                        onClick={handleValidar}
                        disabled={isMutating}
                        aria-label="Validar epicrisis como Especialista"
                      >
                        {validar.isPending ? "Validando…" : "Validar como ESP"}
                      </Button>
                    )}
                    {estado === "validado" && (
                      <Button
                        className="w-full bg-[#1a3c6e] hover:bg-[#15305a] text-white"
                        onClick={handleCertificarClick}
                        disabled={isMutating}
                        aria-label="Certificar epicrisis como Director Médico"
                      >
                        {certificar.isPending ? "Certificando…" : "Certificar como DIR"}
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Metadatos del documento */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Metadatos
                </CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-2 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Estado</dt>
                    <dd>
                      <Badge
                        variant={isCertificado ? "default" : "secondary"}
                        aria-label={`Estado actual: ${estado}`}
                      >
                        {estado}
                      </Badge>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Episodio</dt>
                    <dd className="font-mono text-xs">
                      {epicrisis.episodio_id.slice(0, 8)}…
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Egreso</dt>
                    <dd className="tabular-nums">
                      {new Date(epicrisis.fecha_hora_egreso).toLocaleDateString("es-SV")}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Motivo</dt>
                    <dd>{epicrisis.circunstancia_alta}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* PIN modal para firmar / validar */}
      <PinConfirmModal
        open={showPinModal}
        onClose={() => setShowPinModal(false)}
        resource={`epicrisis/${id}`}
        action={pinAccion === "firmar" ? "firmar" : "validar"}
        onConfirmed={onPinConfirmed}
      />

      {/* Diálogo certificación DIR */}
      <CertificarDialog
        open={showCertDialog}
        onClose={() => setShowCertDialog(false)}
        onConfirm={onCertificarConfirm}
        isPending={certificar.isPending}
      />
    </div>
  );
}
