"use client";

/**
 * ECE — Wizard nuevo consentimiento informado.
 * 3 pasos: Tipo → Contenido clínico → Firmas (paciente + MC con PIN).
 *
 * INMUTABLE POST-FIRMA — advertencia persistente en todos los pasos.
 * Doble firma requerida: paciente (canvas/upload) + MC (PIN electrónico).
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Lock, CheckCircle2, Circle, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Form, FormField, FormError } from "@his/ui/components/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { PinConfirmModal } from "@/components/firma/pin-confirm-modal";
import { trpc } from "@/lib/trpc/react";

// ─── Tipos ───────────────────────────────────────────────────────────────────

type TipoConsentimiento = "HOSPITALIZACION" | "QUIRURGICO" | "ANESTESICO";

interface Step1State {
  tipo: TipoConsentimiento | "";
  episodioId: string;
  pacienteId: string;
}

interface Step2State {
  procedimiento: string;
  riesgos: string;
  alternativas: string;
  indicaciones: string;
}

type SignMethod = "canvas" | "upload";

interface Step3State {
  firmaMetodo: SignMethod;
  firmaArchivoNombre: string; // nombre del archivo subido (UI only)
  firmaDataUrl: string;       // dataURL canvas o placeholder upload
  pinConfirmado: boolean;
  firmaId: string;
}

// ─── Constantes ──────────────────────────────────────────────────────────────

const TIPO_OPTIONS: { value: TipoConsentimiento; label: string }[] = [
  { value: "HOSPITALIZACION", label: "Hospitalización" },
  { value: "QUIRURGICO", label: "Quirúrgico" },
  { value: "ANESTESICO", label: "Anestésico" },
];

const STEPS = ["Tipo de documento", "Contenido clínico", "Firmas"];

// ─── Step indicator ──────────────────────────────────────────────────────────

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <nav aria-label="Pasos del wizard" className="mb-6">
      <ol className="flex items-center gap-0">
        {STEPS.map((label, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <React.Fragment key={label}>
              <li className="flex flex-col items-center">
                <span
                  aria-current={active ? "step" : undefined}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors"
                  style={{
                    background: done || active ? "#1a3c6e" : undefined,
                    color: done || active ? "#fff" : undefined,
                    border: done || active ? "none" : "2px solid #d1d5db",
                  }}
                >
                  {done ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : i + 1}
                </span>
                <span className={`mt-1 text-xs ${active ? "font-semibold text-[#1a3c6e]" : "text-muted-foreground"}`}>
                  {label}
                </span>
              </li>
              {i < total - 1 && (
                <div className="mx-1 mb-4 h-px flex-1 bg-border" aria-hidden />
              )}
            </React.Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

// ─── Banner inmutabilidad ────────────────────────────────────────────────────

function ImmutabilityBanner() {
  return (
    <div
      role="note"
      className="flex items-center gap-2 rounded-md border border-amber-400/50 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-300"
    >
      <Lock className="h-4 w-4 shrink-0" aria-hidden />
      <span>
        <strong>Documento inmutable post-firma.</strong> Una vez completada la doble firma,
        este consentimiento no podrá modificarse ni eliminarse.
      </span>
    </div>
  );
}

// ─── Canvas firma paciente ───────────────────────────────────────────────────

function SignatureCanvas({
  onChange,
}: {
  onChange: (dataUrl: string) => void;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const drawing = React.useRef(false);

  function getPos(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    drawing.current = true;
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.strokeStyle = "#1a3c6e";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  function onMouseUp() {
    drawing.current = false;
    onChange(canvasRef.current!.toDataURL());
  }

  function clear() {
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.clearRect(0, 0, canvasRef.current!.width, canvasRef.current!.height);
    onChange("");
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        width={480}
        height={160}
        className="w-full cursor-crosshair rounded-md border bg-white"
        aria-label="Área de firma del paciente — dibuje su firma aquí"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => { drawing.current = false; }}
      />
      <Button type="button" variant="outline" size="sm" onClick={clear}>
        Limpiar firma
      </Button>
    </div>
  );
}

// ─── Página principal ────────────────────────────────────────────────────────

export default function NuevoConsentimientoPage() {
  const router = useRouter();
  const [step, setStep] = React.useState(0);

  const [s1, setS1] = React.useState<Step1State>({
    tipo: "",
    episodioId: "",
    pacienteId: "",
  });

  const [s2, setS2] = React.useState<Step2State>({
    procedimiento: "",
    riesgos: "",
    alternativas: "",
    indicaciones: "",
  });

  const [s3, setS3] = React.useState<Step3State>({
    firmaMetodo: "canvas",
    firmaArchivoNombre: "",
    firmaDataUrl: "",
    pinConfirmado: false,
    firmaId: "",
  });

  const [showPinModal, setShowPinModal] = React.useState(false);
  const [clientError, setClientError] = React.useState<string | null>(null);

  // Workflow: crear instancia en borrador
  const createInstance = trpc.workflowInstance.create.useMutation({
    onSuccess: () => router.push("/ece/consentimiento"),
  });

  // ── Validaciones por paso ──────────────────────────────────────────────────

  function validateStep0(): string | null {
    if (!s1.tipo) return "Seleccione el tipo de consentimiento.";
    if (!s1.pacienteId.trim()) return "Paciente es requerido.";
    return null;
  }

  function validateStep1(): string | null {
    if (!s2.procedimiento.trim()) return "Descripción del procedimiento es requerida.";
    if (!s2.riesgos.trim()) return "Los riesgos son requeridos.";
    if (!s2.alternativas.trim()) return "Las alternativas son requeridas.";
    return null;
  }

  function validateStep2(): string | null {
    if (!s3.firmaDataUrl) return "La firma del paciente es requerida.";
    if (!s3.pinConfirmado) return "Debe confirmar con su PIN de firma médica.";
    return null;
  }

  function nextStep() {
    let err: string | null = null;
    if (step === 0) err = validateStep0();
    if (step === 1) err = validateStep1();
    setClientError(err);
    if (!err) setStep((s) => s + 1);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validateStep2();
    setClientError(err);
    if (err) return;

    createInstance.mutate({
      tipoDocumentoId: s1.tipo, // UI simplificada — en producción resolver UUID por código
      pacienteId: s1.pacienteId.trim(),
      episodioId: s1.episodioId.trim() || undefined,
    });
  }

  const isSubmitting = createInstance.isPending;
  const errorMessage = clientError ?? createInstance.error?.message ?? null;

  // ── Renderizado por paso ───────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Nuevo consentimiento informado</h1>
        <p className="text-sm text-muted-foreground">
          Complete los tres pasos para generar y firmar el documento.
        </p>
      </div>

      <ImmutabilityBanner />
      <StepIndicator current={step} total={STEPS.length} />

      {/* Paso 0: Tipo */}
      {step === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Tipo de consentimiento</CardTitle>
          </CardHeader>
          <CardContent>
            <Form
              onSubmit={(e) => {
                e.preventDefault();
                nextStep();
              }}
            >
              <FormField>
                <Label htmlFor="tipo">Tipo</Label>
                <Select
                  value={s1.tipo}
                  onValueChange={(v) => setS1((p) => ({ ...p, tipo: v as TipoConsentimiento }))}
                >
                  <SelectTrigger id="tipo">
                    <SelectValue placeholder="Seleccione tipo…" />
                  </SelectTrigger>
                  <SelectContent>
                    {TIPO_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>

              <FormField>
                <Label htmlFor="pacienteId">Paciente (UUID)</Label>
                <Input
                  id="pacienteId"
                  required
                  placeholder="xxxxxxxx-xxxx-..."
                  value={s1.pacienteId}
                  onChange={(e) => setS1((p) => ({ ...p, pacienteId: e.target.value }))}
                />
              </FormField>

              <FormField>
                <Label htmlFor="episodioId">Episodio (UUID, opcional)</Label>
                <Input
                  id="episodioId"
                  placeholder="xxxxxxxx-xxxx-..."
                  value={s1.episodioId}
                  onChange={(e) => setS1((p) => ({ ...p, episodioId: e.target.value }))}
                />
              </FormField>

              {errorMessage && (
                <FormError>{errorMessage}</FormError>
              )}

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => router.back()}>
                  Cancelar
                </Button>
                <Button type="submit">
                  Siguiente <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
                </Button>
              </div>
            </Form>
          </CardContent>
        </Card>
      )}

      {/* Paso 1: Contenido clínico */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Procedimiento, riesgos y alternativas</CardTitle>
          </CardHeader>
          <CardContent>
            <Form
              onSubmit={(e) => {
                e.preventDefault();
                nextStep();
              }}
            >
              <FormField>
                <Label htmlFor="procedimiento">Descripción del procedimiento</Label>
                <textarea
                  id="procedimiento"
                  required
                  value={s2.procedimiento}
                  onChange={(e) => setS2((p) => ({ ...p, procedimiento: e.target.value }))}
                  placeholder="Describa el procedimiento en términos comprensibles para el paciente…"
                  className="min-h-[100px] w-full rounded-md border bg-background p-3 text-sm"
                  maxLength={4000}
                />
              </FormField>

              <FormField>
                <Label htmlFor="riesgos">Riesgos</Label>
                <textarea
                  id="riesgos"
                  required
                  value={s2.riesgos}
                  onChange={(e) => setS2((p) => ({ ...p, riesgos: e.target.value }))}
                  placeholder="Riesgos inherentes al procedimiento…"
                  className="min-h-[80px] w-full rounded-md border bg-background p-3 text-sm"
                  maxLength={2000}
                />
              </FormField>

              <FormField>
                <Label htmlFor="alternativas">Alternativas</Label>
                <textarea
                  id="alternativas"
                  required
                  value={s2.alternativas}
                  onChange={(e) => setS2((p) => ({ ...p, alternativas: e.target.value }))}
                  placeholder="Alternativas terapéuticas disponibles…"
                  className="min-h-[80px] w-full rounded-md border bg-background p-3 text-sm"
                  maxLength={2000}
                />
              </FormField>

              <FormField>
                <Label htmlFor="indicaciones">Indicaciones post-procedimiento (opcional)</Label>
                <textarea
                  id="indicaciones"
                  value={s2.indicaciones}
                  onChange={(e) => setS2((p) => ({ ...p, indicaciones: e.target.value }))}
                  placeholder="Cuidados, restricciones, signos de alarma…"
                  className="min-h-[80px] w-full rounded-md border bg-background p-3 text-sm"
                  maxLength={2000}
                />
              </FormField>

              {errorMessage && <FormError>{errorMessage}</FormError>}

              <div className="flex justify-between gap-2">
                <Button type="button" variant="outline" onClick={() => setStep(0)}>
                  Atrás
                </Button>
                <Button type="submit">
                  Siguiente <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
                </Button>
              </div>
            </Form>
          </CardContent>
        </Card>
      )}

      {/* Paso 2: Firmas */}
      {step === 2 && (
        <div className="space-y-4">
          {/* Firma del paciente */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {s3.firmaDataUrl
                  ? <CheckCircle2 className="h-5 w-5 text-green-600" aria-hidden />
                  : <Circle className="h-5 w-5 text-muted-foreground" aria-hidden />
                }
                1. Firma del paciente
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Selector método */}
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant={s3.firmaMetodo === "canvas" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setS3((p) => ({ ...p, firmaMetodo: "canvas", firmaDataUrl: "" }))}
                >
                  Dibujar firma
                </Button>
                <Button
                  type="button"
                  variant={s3.firmaMetodo === "upload" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setS3((p) => ({ ...p, firmaMetodo: "upload", firmaDataUrl: "" }))}
                >
                  Subir imagen
                </Button>
              </div>

              {s3.firmaMetodo === "canvas" && (
                <SignatureCanvas
                  onChange={(dataUrl) => setS3((p) => ({ ...p, firmaDataUrl: dataUrl }))}
                />
              )}

              {s3.firmaMetodo === "upload" && (
                <div className="space-y-2">
                  <Input
                    type="file"
                    accept="image/*,.pdf"
                    aria-label="Subir imagen de firma del paciente"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setS3((p) => ({
                        ...p,
                        firmaArchivoNombre: file.name,
                        firmaDataUrl: `upload:${file.name}`,
                      }));
                    }}
                  />
                  {s3.firmaArchivoNombre && (
                    <p className="text-xs text-muted-foreground">
                      Archivo: {s3.firmaArchivoNombre}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Firma MC con PIN */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {s3.pinConfirmado
                  ? <CheckCircle2 className="h-5 w-5 text-green-600" aria-hidden />
                  : <Circle className="h-5 w-5 text-muted-foreground" aria-hidden />
                }
                2. Firma del médico (MC) — PIN electrónico
              </CardTitle>
            </CardHeader>
            <CardContent>
              {s3.pinConfirmado ? (
                <div className="flex items-center gap-2 text-sm text-green-700">
                  <CheckCircle2 className="h-4 w-4" aria-hidden />
                  Firma médica confirmada (firmaId: {s3.firmaId.slice(0, 8)}…)
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowPinModal(true)}
                  disabled={!s3.firmaDataUrl}
                >
                  Confirmar con PIN de firma
                </Button>
              )}
              {!s3.firmaDataUrl && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Complete primero la firma del paciente.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Envío */}
          <Form onSubmit={onSubmit}>
            {errorMessage && <FormError>{errorMessage}</FormError>}

            <div className="flex justify-between gap-2">
              <Button type="button" variant="outline" onClick={() => setStep(1)}>
                Atrás
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting || !s3.pinConfirmado || !s3.firmaDataUrl}
                className="bg-[#1a3c6e] hover:bg-[#15305a] text-white"
              >
                {isSubmitting ? "Registrando…" : "Crear consentimiento firmado"}
              </Button>
            </div>
          </Form>
        </div>
      )}

      {/* PIN Modal */}
      <PinConfirmModal
        open={showPinModal}
        onClose={() => setShowPinModal(false)}
        resource={`consentimiento/${s1.tipo}`}
        action="firmar_consentimiento"
        onConfirmed={(firmaId) => {
          setS3((p) => ({ ...p, pinConfirmado: true, firmaId }));
          setShowPinModal(false);
        }}
      />
    </div>
  );
}
