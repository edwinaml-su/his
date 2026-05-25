"use client";

/**
 * ECE — Adjuntar Documento Clínico Asociado.
 * NTEC §15, §38 — wizard 2 pasos.
 *
 * Paso 1: metadata (categoria, título, descripcion, paciente, episodio opcional)
 * Paso 2: drag & drop / input file
 *   → calcula SHA-256 cliente con crypto.subtle
 *   → solicita URL firmada POST /api/ece/documento-asociado/signed-url
 *   → upload al bucket
 *   → llama eceDocAsoc.create con metadata + storagePath
 */
import { useState, useRef, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/react";
import {
  CATEGORIA_DOC_ASOC,
  MIME_TYPES_PERMITIDOS,
} from "@his/contracts/schemas/documento-asociado";

// ---------------------------------------------------------------------------
// Labels en español
// ---------------------------------------------------------------------------

const CATEGORIA_LABEL: Record<typeof CATEGORIA_DOC_ASOC[number], string> = {
  imagen_diagnostica:    "Imagen diagnóstica",
  laboratorio_externo:   "Laboratorio externo",
  referencia_externa:    "Referencia externa",
  consentimiento_externo:"Consentimiento externo",
  otro:                  "Otro",
};

const TAMANO_MAX = 52_428_800; // 50 MB

// ---------------------------------------------------------------------------
// SHA-256 cliente (crypto.subtle — sin dependencias)
// ---------------------------------------------------------------------------

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------
// Tipos de pasos
// ---------------------------------------------------------------------------

type Step = 1 | 2;

interface MetaValues {
  pacienteId: string;
  episodioId: string;
  categoria:  typeof CATEGORIA_DOC_ASOC[number] | "";
  titulo:     string;
  descripcion:string;
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export default function DocAsocNuevoPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [meta, setMeta] = useState<MetaValues>({
    pacienteId: "",
    episodioId: "",
    categoria:  "",
    titulo:     "",
    descripcion:"",
  });
  const [metaErrors, setMetaErrors] = useState<Partial<Record<keyof MetaValues, string>>>({});

  // Paso 2: estado del archivo
  const [file, setFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<"idle"|"hashing"|"uploading"|"done"|"error">("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const createMutation = trpc.eceDocAsoc.create.useMutation({
    onSuccess: (data) => {
      router.push(`/ece/documento-asociado/${data.id}`);
    },
    onError: (err) => {
      setUploadError(err.message);
      setUploadProgress("error");
    },
  });

  // ---------------------------------------------------------------------------
  // Paso 1: validación de metadata
  // ---------------------------------------------------------------------------

  function validateMeta(): boolean {
    const errors: Partial<Record<keyof MetaValues, string>> = {};
    if (!meta.pacienteId.match(/^[0-9a-f-]{36}$/i)) {
      errors.pacienteId = "UUID inválido.";
    }
    if (meta.episodioId && !meta.episodioId.match(/^[0-9a-f-]{36}$/i)) {
      errors.episodioId = "UUID inválido (o déjelo vacío).";
    }
    if (!meta.categoria) errors.categoria = "Seleccione una categoría.";
    if (meta.titulo.trim().length < 3) errors.titulo = "Mínimo 3 caracteres.";
    setMetaErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function handleMetaNext(e: FormEvent) {
    e.preventDefault();
    if (validateMeta()) setStep(2);
  }

  // ---------------------------------------------------------------------------
  // Paso 2: manejo del archivo
  // ---------------------------------------------------------------------------

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (f) validateAndSetFile(f);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files?.[0] ?? null;
    if (f) validateAndSetFile(f);
  }

  function validateAndSetFile(f: File): boolean {
    if (f.size > TAMANO_MAX) {
      setUploadError(`El archivo supera el límite de 50 MB (${(f.size / 1_048_576).toFixed(1)} MB).`);
      return false;
    }
    if (!(MIME_TYPES_PERMITIDOS as readonly string[]).includes(f.type)) {
      setUploadError(`Tipo de archivo no permitido: ${f.type}. Use PDF, JPEG, PNG, TIFF o DICOM.`);
      return false;
    }
    setFile(f);
    setUploadError(null);
    setUploadProgress("idle");
    return true;
  }

  async function handleUploadAndCreate() {
    if (!file || !meta.categoria) return;
    setUploadProgress("hashing");
    setUploadError(null);

    try {
      // 1. SHA-256 cliente
      const arrayBuffer = await file.arrayBuffer();
      const hashSha256 = await sha256Hex(arrayBuffer);

      // 2. Solicitar URL firmada de upload
      setUploadProgress("uploading");
      const signedRes = await fetch("/api/ece/documento-asociado/signed-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, mimeType: file.type }),
      });

      if (!signedRes.ok) {
        const err = (await signedRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Error al obtener URL de upload.");
      }

      const { uploadUrl, storagePath } = (await signedRes.json()) as {
        uploadUrl: string;
        storagePath: string;
      };

      // 3. Upload directo al bucket
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });

      if (!uploadRes.ok) {
        throw new Error(`Error al subir el archivo al storage (HTTP ${uploadRes.status}).`);
      }

      // 4. Persistir metadata via tRPC
      setUploadProgress("done");
      createMutation.mutate({
        pacienteId:   meta.pacienteId,
        episodioId:   meta.episodioId || undefined,
        categoria:    meta.categoria,
        titulo:       meta.titulo.trim(),
        descripcion:  meta.descripcion.trim() || undefined,
        storagePath,
        mimeType:     file.type as typeof MIME_TYPES_PERMITIDOS[number],
        tamanoBytes:  file.size,
        hashSha256,
      });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Error inesperado.");
      setUploadProgress("error");
    }
  }

  const isPending = uploadProgress === "hashing" || uploadProgress === "uploading" || createMutation.isPending;

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-4">
      <h1 className="text-xl font-semibold">Adjuntar Documento Clínico</h1>
      <p className="text-sm text-muted-foreground">
        NTEC §15, §38 — Paso {step} de 2.
      </p>

      {/* ── Paso 1: Metadata ─────────────────────────────────────────────── */}
      {step === 1 && (
        <Card>
          <CardHeader><CardTitle>Información del documento</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleMetaNext} className="space-y-4" noValidate>
              {/* Paciente */}
              <div className="space-y-1">
                <Label htmlFor="pacienteId">ID Paciente (UUID) *</Label>
                <Input
                  id="pacienteId"
                  value={meta.pacienteId}
                  onChange={(e) => setMeta((m) => ({ ...m, pacienteId: e.target.value }))}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  aria-invalid={!!metaErrors.pacienteId}
                />
                {metaErrors.pacienteId && (
                  <p role="alert" className="text-sm text-destructive">{metaErrors.pacienteId}</p>
                )}
              </div>

              {/* Episodio (opcional) */}
              <div className="space-y-1">
                <Label htmlFor="episodioId">ID Episodio (UUID, opcional)</Label>
                <Input
                  id="episodioId"
                  value={meta.episodioId}
                  onChange={(e) => setMeta((m) => ({ ...m, episodioId: e.target.value }))}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  aria-invalid={!!metaErrors.episodioId}
                />
                {metaErrors.episodioId && (
                  <p role="alert" className="text-sm text-destructive">{metaErrors.episodioId}</p>
                )}
              </div>

              {/* Categoría */}
              <div className="space-y-1">
                <Label>Categoría *</Label>
                <Select
                  value={meta.categoria}
                  onValueChange={(v) => setMeta((m) => ({
                    ...m,
                    categoria: v as typeof CATEGORIA_DOC_ASOC[number],
                  }))}
                >
                  <SelectTrigger aria-invalid={!!metaErrors.categoria}>
                    <SelectValue placeholder="Seleccione…" />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIA_DOC_ASOC.map((c) => (
                      <SelectItem key={c} value={c}>{CATEGORIA_LABEL[c]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {metaErrors.categoria && (
                  <p role="alert" className="text-sm text-destructive">{metaErrors.categoria}</p>
                )}
              </div>

              {/* Título */}
              <div className="space-y-1">
                <Label htmlFor="titulo">Título *</Label>
                <Input
                  id="titulo"
                  value={meta.titulo}
                  onChange={(e) => setMeta((m) => ({ ...m, titulo: e.target.value }))}
                  maxLength={255}
                  aria-invalid={!!metaErrors.titulo}
                />
                {metaErrors.titulo && (
                  <p role="alert" className="text-sm text-destructive">{metaErrors.titulo}</p>
                )}
              </div>

              {/* Descripción */}
              <div className="space-y-1">
                <Label htmlFor="descripcion">Descripción (opcional)</Label>
                <textarea
                  id="descripcion"
                  value={meta.descripcion}
                  onChange={(e) => setMeta((m) => ({ ...m, descripcion: e.target.value }))}
                  maxLength={1_000}
                  rows={3}
                  className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              <Button type="submit" className="w-full">Siguiente: Seleccionar archivo</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* ── Paso 2: Archivo ──────────────────────────────────────────────── */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Seleccionar y subir archivo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Zona drag & drop */}
            <div
              role="button"
              tabIndex={0}
              aria-label="Zona de arrastre de archivos. También puede hacer clic para seleccionar."
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click(); }}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={`flex min-h-[140px] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 transition-colors ${
                isDragging ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"
              }`}
            >
              {file ? (
                <div className="text-center">
                  <p className="font-medium text-sm">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(file.size / 1_048_576).toFixed(2)} MB — {file.type}
                  </p>
                </div>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">Arrastre aquí o haga clic para seleccionar</p>
                  <p className="text-xs text-muted-foreground">PDF, JPEG, PNG, TIFF, DICOM — máx. 50 MB</p>
                </>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept={MIME_TYPES_PERMITIDOS.join(",")}
              className="sr-only"
              aria-hidden
              onChange={handleFileChange}
            />

            {/* Progreso / errores */}
            {uploadProgress === "hashing" && (
              <p className="text-sm text-muted-foreground">Calculando hash SHA-256…</p>
            )}
            {uploadProgress === "uploading" && (
              <p className="text-sm text-muted-foreground">Subiendo al repositorio seguro…</p>
            )}
            {uploadError && (
              <p role="alert" className="text-sm text-destructive">{uploadError}</p>
            )}

            {/* Botones */}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep(1)}
                disabled={isPending}
                className="flex-1"
              >
                Volver
              </Button>
              <Button
                type="button"
                onClick={handleUploadAndCreate}
                disabled={!file || isPending}
                className="flex-1"
                aria-busy={isPending}
              >
                {isPending ? "Procesando…" : "Adjuntar documento"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
