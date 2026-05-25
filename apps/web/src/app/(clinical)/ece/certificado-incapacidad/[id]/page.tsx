"use client";

/**
 * ECE — Detalle del Certificado de Incapacidad ISSS (CERT_INC).
 *
 * Workflow: borrador → firmado → (anulado desde firmado).
 * - MC/PHYSICIAN puede firmar (borrador → firmado) con PIN electrónico.
 * - MC/PHYSICIAN puede anular (firmado → anulado) con motivo.
 */
import * as React from "react";
import { use } from "react";
import { FileText, CheckCircle2, Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
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
import { trpc } from "@/lib/trpc/react";
import { type FormEvent, useState } from "react";

const ESTADO_LABEL: Record<string, string> = {
  borrador: "Borrador",
  firmado:  "Firmado",
  anulado:  "Anulado",
};

const TIPO_LABEL: Record<string, string> = {
  enfermedad_comun:   "Enfermedad común",
  accidente_comun:    "Accidente común",
  riesgo_profesional: "Riesgo profesional",
  maternidad:         "Maternidad",
  paternidad:         "Paternidad",
  accidente_trabajo:  "Accidente de trabajo",
};

const dateFmt = new Intl.DateTimeFormat("es-SV", { dateStyle: "medium" });

// ---------------------------------------------------------------------------
// Anular dialog
// ---------------------------------------------------------------------------

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
          <DialogTitle>Anular certificado de incapacidad</DialogTitle>
          <DialogDescription>
            La anulación es <strong>irreversible</strong>. Solo válida en estado firmado.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="motivo-anulacion">Motivo (mínimo 10 caracteres)</Label>
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
            <span>Entiendo que esta acción es <strong>irreversible</strong>.</span>
          </label>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancelar</Button>
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

// ---------------------------------------------------------------------------
// PinDialog inline — mismo patrón que fall-event/nuevo/page.tsx
// ---------------------------------------------------------------------------

interface PinDialogProps {
  titulo: string;
  onConfirm: (pin: string) => Promise<void>;
  onCancel: () => void;
}

function PinDialog({ titulo, onConfirm, onCancel }: PinDialogProps) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!pin.trim()) { setError("El PIN es requerido."); return; }
    setError(null);
    setLoading(true);
    try {
      await onConfirm(pin.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al confirmar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg border bg-background p-6 shadow-lg"
      >
        <h2 className="text-lg font-semibold">{titulo}</h2>
        <div className="space-y-1.5">
          <Label htmlFor="pin-input">PIN de firma electrónica</Label>
          <Input
            id="pin-input"
            type="password"
            inputMode="numeric"
            maxLength={8}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="4–8 dígitos"
            autoFocus
            required
          />
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>Cancelar</Button>
          <Button type="submit" disabled={loading}>
            {loading ? "Verificando…" : "Confirmar firma"}
          </Button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------

export default function CertificadoIncapacidadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const query = trpc.eceCertificadoIncapacidad.get.useQuery({ id });
  const firmar = trpc.eceCertificadoIncapacidad.firmar.useMutation({
    onSuccess: () => query.refetch(),
  });
  const anular = trpc.eceCertificadoIncapacidad.anular.useMutation({
    onSuccess: () => query.refetch(),
  });

  const [showPinModal, setShowPinModal] = React.useState(false);
  const [showAnularDialog, setShowAnularDialog] = React.useState(false);

  const doc = query.data;
  const estado = doc?.estado_documento ?? doc?.estado_registro ?? "borrador";

  const canFirmar = estado === "borrador";
  const canAnular = estado === "firmado";

  async function onPinConfirmed(pin: string) {
    await firmar.mutateAsync({ id, firmaPin: pin });
    setShowPinModal(false);
  }

  function onAnularConfirm(motivo: string) {
    anular.mutate({ id, motivoAnulacion: motivo });
    setShowAnularDialog(false);
  }

  const anyPending = firmar.isPending || anular.isPending;
  const mutationError = firmar.error?.message ?? anular.error?.message ?? null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <FileText className="h-6 w-6" aria-hidden />
            Certificado de Incapacidad ISSS
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
              {firmar.isPending ? "Firmando…" : "Firmar certificado"}
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

      {/* Banners de estado terminal */}
      {estado === "firmado" && (
        <div
          role="note"
          className="flex items-center gap-2 rounded-md border border-green-500/40 bg-green-50 px-4 py-2.5 text-sm text-green-800"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
          <span><strong>Certificado firmado.</strong> Puede anularse si es necesario.</span>
        </div>
      )}
      {estado === "anulado" && (
        <div
          role="note"
          className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive"
        >
          <Lock className="h-4 w-4 shrink-0" aria-hidden />
          <span><strong>Certificado anulado.</strong></span>
        </div>
      )}

      {/* Error de mutación */}
      {mutationError && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {mutationError}
        </p>
      )}

      {/* Estado */}
      <Card>
        <CardHeader><CardTitle>Estado del documento</CardTitle></CardHeader>
        <CardContent>
          {query.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {query.error && <p role="alert" className="text-sm text-destructive">{query.error.message}</p>}
          {doc && (
            <Badge variant={estado === "firmado" ? "default" : estado === "anulado" ? "destructive" : "outline"}>
              {ESTADO_LABEL[estado] ?? estado}
            </Badge>
          )}
        </CardContent>
      </Card>

      {/* Contenido clínico */}
      {doc && (
        <Card>
          <CardHeader><CardTitle>Datos del certificado</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm md:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Tipo de incapacidad</dt>
                <dd>{TIPO_LABEL[doc.tipo_incapacidad] ?? doc.tipo_incapacidad}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Período</dt>
                <dd className="tabular-nums">
                  {dateFmt.format(new Date(doc.fecha_inicio))} – {dateFmt.format(new Date(doc.fecha_fin))}
                  {" "}({doc.dias_otorgados} días)
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Diagnóstico CIE-10</dt>
                <dd className="font-mono">{doc.diagnostico_cie10}</dd>
              </div>
              <div className="md:col-span-2">
                <dt className="text-muted-foreground">Descripción del diagnóstico</dt>
                <dd className="whitespace-pre-wrap">{doc.diagnostico_descripcion}</dd>
              </div>
              {doc.numero_afiliacion_isss && (
                <div>
                  <dt className="text-muted-foreground">N.° afiliación ISSS</dt>
                  <dd className="font-mono">{doc.numero_afiliacion_isss}</dd>
                </div>
              )}
              {doc.patrono_nit && (
                <div>
                  <dt className="text-muted-foreground">NIT empleador</dt>
                  <dd className="font-mono">{doc.patrono_nit}</dd>
                </div>
              )}
              {doc.observaciones && (
                <div className="md:col-span-2">
                  <dt className="text-muted-foreground">Observaciones</dt>
                  <dd className="whitespace-pre-wrap">{doc.observaciones}</dd>
                </div>
              )}
              {doc.motivo_anulacion && (
                <div className="md:col-span-2">
                  <dt className="font-semibold text-destructive">Motivo de anulación</dt>
                  <dd className="whitespace-pre-wrap">{doc.motivo_anulacion}</dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>
      )}

      {/* Firma PIN */}
      {showPinModal && (
        <PinDialog
          titulo="Firmar Certificado de Incapacidad ISSS"
          onConfirm={onPinConfirmed}
          onCancel={() => setShowPinModal(false)}
        />
      )}

      {/* Anular dialog */}
      <AnularDialog
        open={showAnularDialog}
        onClose={() => setShowAnularDialog(false)}
        onConfirm={onAnularConfirm}
        isPending={anular.isPending}
      />
    </div>
  );
}
