"use client";

/**
 * ECE — Detalle de Documento Clínico Asociado.
 * NTEC §15, §38 — archivo adjunto al expediente.
 *
 * - Preview inline si es imagen (JPEG/PNG).
 * - Enlace de descarga para PDF/DICOM (URL firmada 60 min).
 * - Flujo de firma con PinDialog inline.
 * - Anulación solo en estado borrador (DIR/ADMIN).
 */
import { use, useState, type FormEvent } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { trpc } from "@/lib/trpc/react";

// ---------------------------------------------------------------------------
// Parámetros
// ---------------------------------------------------------------------------

interface PageProps {
  params: Promise<{ id: string }>;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

const ESTADO_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  borrador: "outline",
  firmado:  "secondary",
  anulado:  "destructive",
};

const CATEGORIA_LABEL: Record<string, string> = {
  imagen_diagnostica:    "Imagen diagnóstica",
  laboratorio_externo:   "Laboratorio externo",
  referencia_externa:    "Referencia externa",
  consentimiento_externo:"Consentimiento externo",
  otro:                  "Otro",
};

const dateFmt = new Intl.DateTimeFormat("es-SV", { dateStyle: "long", timeStyle: "short" });

const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/tiff"]);

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export default function DocAsocDetailPage({ params }: PageProps) {
  const { id } = use(params);

  const query = trpc.eceDocAsoc.get.useQuery({ id });
  const firmarMutation = trpc.eceDocAsoc.firmar.useMutation({
    onSuccess: () => query.refetch(),
    onError: (err) => setPinError(err.message),
  });
  const anularMutation = trpc.eceDocAsoc.anular.useMutation({
    onSuccess: () => query.refetch(),
  });

  // Estado PIN dialog
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  // Estado anulación
  const [anularOpen, setAnularOpen] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [motivoError, setMotivoError] = useState<string | null>(null);

  // URL firmada de descarga
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  async function fetchDownloadUrl(storagePath: string) {
    setDownloadLoading(true);
    setDownloadError(null);
    try {
      const res = await fetch(
        `/api/ece/documento-asociado/signed-url?path=${encodeURIComponent(storagePath)}`,
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Error al obtener URL de descarga.");
      }
      const { downloadUrl: url } = (await res.json()) as { downloadUrl: string };
      setDownloadUrl(url);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Error.");
    } finally {
      setDownloadLoading(false);
    }
  }

  function handleFirmarConfirm(pin: string) {
    setPinError(null);
    firmarMutation.mutate({ id, firmaPin: pin });
    setPinModalOpen(false);
  }

  function handleAnular(e: FormEvent) {
    e.preventDefault();
    if (motivo.trim().length < 10) {
      setMotivoError("El motivo debe tener al menos 10 caracteres.");
      return;
    }
    setMotivoError(null);
    anularMutation.mutate({ id, motivoAnulacion: motivo.trim() });
    setAnularOpen(false);
  }

  if (query.isLoading) {
    return <p className="p-4 text-sm text-muted-foreground">Cargando…</p>;
  }
  if (query.error) {
    return (
      <p role="alert" className="p-4 text-sm text-destructive">{query.error.message}</p>
    );
  }

  const doc = query.data;
  if (!doc) return null;

  const isImage = IMAGE_MIMES.has(doc.mime_type);
  const isBorrador = doc.estado_registro === "borrador";
  const isFirmado = doc.estado_registro === "firmado";

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">{doc.titulo}</h1>
          <p className="text-sm text-muted-foreground">
            {CATEGORIA_LABEL[doc.categoria] ?? doc.categoria} — NTEC §15/§38
          </p>
        </div>
        <Badge variant={ESTADO_VARIANT[doc.estado_registro] ?? "outline"}>
          {doc.estado_registro}
        </Badge>
      </div>

      {/* Metadata */}
      <Card>
        <CardHeader><CardTitle>Datos del documento</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {doc.descripcion && (
            <p><span className="font-medium">Descripción:</span> {doc.descripcion}</p>
          )}
          <p><span className="font-medium">Fecha del documento:</span> {doc.fecha_documento}</p>
          <p><span className="font-medium">Tipo de archivo:</span> {doc.mime_type}</p>
          <p>
            <span className="font-medium">Tamaño:</span>{" "}
            {(doc.tamanoBytes / 1_048_576).toFixed(2)} MB
          </p>
          <p>
            <span className="font-medium">SHA-256:</span>{" "}
            <code className="font-mono text-xs break-all">{doc.hash_sha256}</code>
          </p>
          <p>
            <span className="font-medium">Adjuntado:</span>{" "}
            {dateFmt.format(new Date(doc.adjuntado_en))}
          </p>
          {doc.firmado_en && (
            <p>
              <span className="font-medium">Firmado:</span>{" "}
              {dateFmt.format(new Date(doc.firmado_en))}
            </p>
          )}
          {doc.motivo_anulacion && (
            <p className="text-destructive">
              <span className="font-medium">Motivo anulación:</span> {doc.motivo_anulacion}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Preview / Descarga */}
      <Card>
        <CardHeader><CardTitle>Archivo</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {/* Preview imagen */}
          {isImage && downloadUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={downloadUrl}
              alt={doc.titulo}
              className="max-w-full rounded-md border"
            />
          )}

          {/* Obtener URL firmada */}
          {!downloadUrl && (
            <Button
              type="button"
              variant="outline"
              onClick={() => fetchDownloadUrl(doc.storage_path)}
              disabled={downloadLoading}
              aria-busy={downloadLoading}
            >
              {downloadLoading ? "Obteniendo enlace…" : "Obtener enlace de descarga"}
            </Button>
          )}

          {downloadError && (
            <p role="alert" className="text-sm text-destructive">{downloadError}</p>
          )}

          {/* Enlace de descarga (PDF/DICOM o imagen) */}
          {downloadUrl && (
            <a
              href={downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              download={doc.titulo}
              className="inline-flex items-center gap-1 text-sm text-primary underline underline-offset-2"
            >
              Descargar archivo
            </a>
          )}
        </CardContent>
      </Card>

      {/* Acciones */}
      {(isBorrador || isFirmado) && (
        <Card>
          <CardHeader><CardTitle>Acciones</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {isBorrador && (
              <>
                <Button onClick={() => setPinModalOpen(true)}>
                  Firmar con PIN
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => setAnularOpen(true)}
                  disabled={anularMutation.isPending}
                >
                  Anular (DIR/ADMIN)
                </Button>
              </>
            )}
          </CardContent>
          {firmarMutation.isError && (
            <CardContent>
              <p role="alert" className="text-sm text-destructive">{firmarMutation.error.message}</p>
            </CardContent>
          )}
          {anularMutation.isError && (
            <CardContent>
              <p role="alert" className="text-sm text-destructive">{anularMutation.error.message}</p>
            </CardContent>
          )}
        </Card>
      )}

      {/* PIN Dialog */}
      {pinModalOpen && (
        <PinDialog
          titulo="Firmar documento clínico asociado"
          error={pinError}
          loading={firmarMutation.isPending}
          onConfirm={handleFirmarConfirm}
          onCancel={() => { setPinModalOpen(false); setPinError(null); }}
        />
      )}

      {/* Anular Dialog */}
      {anularOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <form
            onSubmit={handleAnular}
            className="w-full max-w-sm space-y-4 rounded-lg border bg-background p-6 shadow-lg"
          >
            <h2 className="text-lg font-semibold text-destructive">Anular documento</h2>
            <div className="space-y-1.5">
              <Label htmlFor="motivo-anulacion">Motivo de anulación (mín. 10 chars)</Label>
              <textarea
                id="motivo-anulacion"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                rows={3}
                className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-destructive"
                required
              />
              {motivoError && (
                <p role="alert" className="text-sm text-destructive">{motivoError}</p>
              )}
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => setAnularOpen(false)}
                disabled={anularMutation.isPending}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={anularMutation.isPending}
                aria-busy={anularMutation.isPending}
              >
                {anularMutation.isPending ? "Anulando…" : "Confirmar anulación"}
              </Button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// PinDialog inline — patrón fall-event/nuevo
// ---------------------------------------------------------------------------

interface PinDialogProps {
  titulo: string;
  error: string | null;
  loading: boolean;
  onConfirm: (pin: string) => void;
  onCancel: () => void;
}

function PinDialog({ titulo, error, loading, onConfirm, onCancel }: PinDialogProps) {
  const [pin, setPin] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!pin.trim()) { setLocalError("El PIN es requerido."); return; }
    setLocalError(null);
    onConfirm(pin.trim());
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
        {(localError ?? error) && (
          <p role="alert" className="text-sm text-destructive">{localError ?? error}</p>
        )}
        <div className="flex gap-2 justify-end">
          <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
            Cancelar
          </Button>
          <Button type="submit" disabled={loading} aria-busy={loading}>
            {loading ? "Verificando…" : "Confirmar"}
          </Button>
        </div>
      </form>
    </div>
  );
}
