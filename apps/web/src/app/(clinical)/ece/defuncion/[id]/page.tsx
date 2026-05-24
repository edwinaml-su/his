"use client";

/**
 * ECE — Detalle del Certificado de Defunción.
 * Vista read-only con badges de workflow y botones contextuales por rol:
 *   - MC: "Firmar" (borrador) | "Validar" (firmado)
 *   - DIR: "Certificar" (validado) | "Anular" (pre-certificado)
 *
 * DOCUMENTO INMUTABLE POST-FIRMA.
 */
import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { Lock, CheckCircle, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { trpc } from "@/lib/trpc/react";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers visuales
// ──────────────────────────────────────────────────────────────────────────────

const ESTADO_LABEL: Record<string, string> = {
  borrador: "Borrador",
  firmado: "Firmado MC",
  validado: "Validado MC",
  certificado: "Certificado DIR",
  anulado: "Anulado",
};

const ESTADO_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  borrador: "outline",
  firmado: "secondary",
  validado: "secondary",
  certificado: "default",
  anulado: "destructive",
};

const dateFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "long",
  timeStyle: "medium",
});

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <span className="w-48 shrink-0 text-sm font-medium text-muted-foreground">{label}</span>
      <span className="text-sm">{value ?? "—"}</span>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Componente PIN modal simplificado (inline)
// ──────────────────────────────────────────────────────────────────────────────

interface PinDialogProps {
  titulo: string;
  onConfirm: (pin: string) => Promise<void>;
  onCancel: () => void;
}

function PinDialog({ titulo, onConfirm, onCancel }: PinDialogProps) {
  const [pin, setPin] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
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
            placeholder="6–8 dígitos"
            autoFocus
            required
          />
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2 justify-end">
          <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
            Cancelar
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? "Verificando…" : "Confirmar"}
          </Button>
        </div>
      </form>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Página principal
// ──────────────────────────────────────────────────────────────────────────────

type PendingAction = "firmar" | "validar" | "certificar" | null;

export default function CertDefDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params.id === "string" ? params.id : params.id?.[0] ?? "";

  const [pendingAction, setPendingAction] = React.useState<PendingAction>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [anularMode, setAnularMode] = React.useState(false);
  const [motivoAnulacion, setMotivoAnulacion] = React.useState("");

  const utils = trpc.useUtils();

  const query = trpc.eceCertDef.get.useQuery({ id }, { enabled: !!id });
  const firmarMutation = trpc.eceCertDef.firmar.useMutation();
  const validarMutation = trpc.eceCertDef.validar.useMutation();
  const certificarMutation = trpc.eceCertDef.certificar.useMutation();
  const anularMutation = trpc.eceCertDef.anular.useMutation();

  async function handleAnular() {
    if (!motivoAnulacion.trim() || motivoAnulacion.trim().length < 10) {
      setActionError("El motivo debe tener al menos 10 caracteres.");
      return;
    }
    setActionError(null);
    try {
      await anularMutation.mutateAsync({ id, motivoAnulacion: motivoAnulacion.trim() });
      await utils.eceCertDef.get.invalidate({ id });
      setAnularMode(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Error al anular.");
    }
  }

  if (query.isLoading) {
    return <p className="p-6 text-sm text-muted-foreground">Cargando certificado…</p>;
  }
  if (query.error) {
    return (
      <p role="alert" className="p-6 text-sm text-destructive">
        {query.error.message}
      </p>
    );
  }

  const cert = query.data;
  if (!cert) return null;

  const estado = String(cert.estado_workflow ?? "borrador");
  const esFirmado = estado !== "borrador";

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Certificado de Defunción</h1>
          <p className="font-mono text-xs text-muted-foreground">{id}</p>
        </div>
        <Badge variant={ESTADO_VARIANT[estado] ?? "outline"} className="text-sm">
          {ESTADO_LABEL[estado] ?? estado}
        </Badge>
      </div>

      {/* Banner inmutabilidad */}
      {esFirmado && (
        <div
          role="note"
          className="flex items-center gap-2 rounded-md border border-amber-400/50 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-300"
        >
          <Lock className="h-4 w-4 shrink-0" aria-hidden />
          <span>
            <strong>DOCUMENTO INMUTABLE POST-FIRMA.</strong> Este certificado no puede
            modificarse. Cualquier corrección requiere proceso de rectificación ECE.
          </span>
        </div>
      )}

      {/* Datos clínicos */}
      <Card>
        <CardHeader><CardTitle>Datos de defunción</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <FieldRow
            label="Paciente"
            value={String((cert as { paciente_nombre?: unknown }).paciente_nombre ?? cert.paciente_id ?? "—")}
          />
          <FieldRow
            label="Fecha y hora"
            value={cert.fecha_hora_defuncion ? dateFmt.format(new Date(cert.fecha_hora_defuncion)) : "—"}
          />
          <FieldRow label="Lugar" value={<span className="capitalize">{String(cert.lugar_defuncion ?? "—")}</span>} />
          <FieldRow label="Causa directa (A)" value={<span className="font-mono">{String(cert.causa_principal_cie10 ?? "—")}</span>} />
          <FieldRow
            label="Causas intermedias (B-C)"
            value={
              Array.isArray(cert.causas_intermedias_cie10) && cert.causas_intermedias_cie10.length > 0
                ? cert.causas_intermedias_cie10.map((c: unknown) => String(c)).join(", ")
                : "Ninguna"
            }
          />
          <FieldRow label="Causa básica (D)" value={<span className="font-mono">{String(cert.causa_basica_cie10 ?? "—")}</span>} />
          <FieldRow label="Manera de muerte" value={<span className="capitalize">{String(cert.manera ?? "—")}</span>} />
          <FieldRow
            label="Autopsia"
            value={
              cert.autopsia_realizada ? (
                <span className="flex items-center gap-1 text-green-700">
                  <CheckCircle className="h-3.5 w-3.5" aria-hidden /> Sí
                </span>
              ) : (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <XCircle className="h-3.5 w-3.5" aria-hidden /> No
                </span>
              )
            }
          />
          {cert.observaciones && (
            <FieldRow label="Observaciones" value={String(cert.observaciones)} />
          )}
        </CardContent>
      </Card>

      {/* Trazabilidad workflow */}
      <Card>
        <CardHeader><CardTitle>Trazabilidad del workflow</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <FieldRow
            label="Firmado en"
            value={cert.firmado_en ? dateFmt.format(new Date(cert.firmado_en)) : "Pendiente"}
          />
          <FieldRow
            label="Validado en"
            value={cert.validado_en ? dateFmt.format(new Date(cert.validado_en)) : "Pendiente"}
          />
          <FieldRow
            label="Certificado en"
            value={cert.certificado_en ? dateFmt.format(new Date(cert.certificado_en)) : "Pendiente"}
          />
          {cert.anulado_en && (
            <>
              <FieldRow label="Anulado en" value={dateFmt.format(new Date(cert.anulado_en))} />
              <FieldRow label="Motivo anulación" value={String(cert.motivo_anulacion ?? "—")} />
            </>
          )}
          {cert.payload_hash && (
            <FieldRow
              label="Hash de integridad"
              value={<span className="font-mono text-xs text-muted-foreground">{String(cert.payload_hash).slice(0, 32)}…</span>}
            />
          )}
        </CardContent>
      </Card>

      {/* Acciones contextuales por rol */}
      {estado !== "anulado" && estado !== "certificado" && (
        <Card>
          <CardHeader><CardTitle>Acciones</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {actionError && (
              <p role="alert" className="text-sm text-destructive">{actionError}</p>
            )}

            <div className="flex flex-wrap gap-2">
              {/* MC: firmar (borrador) */}
              {estado === "borrador" && (
                <Button onClick={() => { setActionError(null); setPendingAction("firmar"); }}>
                  Firmar (MC)
                </Button>
              )}

              {/* MC: validar (firmado) — requiere PIN (B-03) */}
              {estado === "firmado" && (
                <Button
                  variant="secondary"
                  onClick={() => { setActionError(null); setPendingAction("validar"); }}
                >
                  Validar (MC)
                </Button>
              )}

              {/* DIR: certificar (validado) */}
              {estado === "validado" && (
                <Button onClick={() => { setActionError(null); setPendingAction("certificar"); }}>
                  Certificar DIR (Art. 21 NTEC)
                </Button>
              )}

              {/* DIR: anular (pre-certificado) */}
              {["borrador", "firmado", "validado"].includes(estado) && (
                <Button
                  variant="destructive"
                  onClick={() => { setAnularMode(true); setActionError(null); }}
                >
                  Anular (DIR)
                </Button>
              )}
            </div>

            {/* Panel anulación */}
            {anularMode && (
              <div className="space-y-2 rounded-md border border-destructive/30 p-3">
                <Label htmlFor="motivo-anulacion">Motivo de anulación (mín. 10 caracteres)</Label>
                <textarea
                  id="motivo-anulacion"
                  value={motivoAnulacion}
                  onChange={(e) => setMotivoAnulacion(e.target.value)}
                  rows={3}
                  minLength={10}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                />
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleAnular}
                    disabled={anularMutation.isPending}
                  >
                    {anularMutation.isPending ? "Anulando…" : "Confirmar anulación"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setAnularMode(false)}>
                    Cancelar
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {estado === "certificado" && (
        <div className="flex items-center gap-2 rounded-md border border-green-400/50 bg-green-50 px-4 py-2.5 text-sm text-green-800 dark:border-green-500/30 dark:bg-green-950/30 dark:text-green-300">
          <CheckCircle className="h-4 w-4 shrink-0" aria-hidden />
          <span>Certificado validado y certificado por DIR. Documento oficial conforme Art. 21 NTEC.</span>
        </div>
      )}

      {/* Dialogs PIN */}
      {pendingAction === "validar" && (
        <PinDialog
          titulo="Validar Certificado de Defunción (MC) — B-03"
          onConfirm={async (pin) => {
            await validarMutation.mutateAsync({ id, firmaPin: pin });
            await utils.eceCertDef.get.invalidate({ id });
            setPendingAction(null);
          }}
          onCancel={() => setPendingAction(null)}
        />
      )}
      {pendingAction === "firmar" && (
        <PinDialog
          titulo="Firmar Certificado de Defunción (MC)"
          onConfirm={async (pin) => {
            await firmarMutation.mutateAsync({ id, pin });
            await utils.eceCertDef.get.invalidate({ id });
            setPendingAction(null);
          }}
          onCancel={() => setPendingAction(null)}
        />
      )}
      {pendingAction === "certificar" && (
        <PinDialog
          titulo="Certificar (DIR) — Art. 21 NTEC"
          onConfirm={async (pin) => {
            await certificarMutation.mutateAsync({ id, pin });
            await utils.eceCertDef.get.invalidate({ id });
            setPendingAction(null);
            router.push("/ece/defuncion");
          }}
          onCancel={() => setPendingAction(null)}
        />
      )}
    </div>
  );
}
