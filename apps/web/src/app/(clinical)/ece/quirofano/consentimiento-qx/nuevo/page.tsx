"use client";

/**
 * ECE — Wizard consentimiento quirúrgico (CONS_QX, NTEC §4.12).
 *
 * 4 pasos:
 *   0. Procedimiento + riesgos (heredado de CONS_INF)
 *   1. Anestesia + transfusión + autorizaciones (campos específicos CONS_QX)
 *   2. Firma del paciente (canvas / upload)
 *   3. Firma del MC con PIN electrónico
 *
 * Doble firma requerida. Documento INMUTABLE post-firma.
 * Reutiliza SignatureCanvas, ImmutabilityBanner y PinConfirmModal de consentimiento base.
 */
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
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

type TipoAnestesia = "general" | "regional" | "local" | "sedacion" | "combinada";

interface Step0State {
  episodioId: string;
  procedimiento: string;
  riesgos: string;
  alternativas: string;
}

interface Step1State {
  tipoAnestesia: TipoAnestesia | "";
  transfusionAutorizada: boolean;
  ampliacionQuirurgicaAutorizada: boolean;
  fotografiaGrabacionAutorizada: boolean;
}

interface Step2State {
  firmaMetodo: "canvas" | "upload";
  firmaArchivoNombre: string;
  firmaDataUrl: string;
}

interface Step3State {
  pinConfirmado: boolean;
  firmaId: string;
}

// ─── Constantes ──────────────────────────────────────────────────────────────

const ANESTESIA_OPTIONS: { value: TipoAnestesia; label: string }[] = [
  { value: "general", label: "General" },
  { value: "regional", label: "Regional" },
  { value: "local", label: "Local" },
  { value: "sedacion", label: "Sedación" },
  { value: "combinada", label: "Combinada" },
];

const STEPS = [
  "Procedimiento y riesgos",
  "Anestesia y autorizaciones",
  "Firma paciente",
  "Firma MC",
];

// ─── Componentes reutilizados localmente ─────────────────────────────────────

function StepIndicator({ current }: { current: number }) {
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
                <span
                  className={`mt-1 text-xs ${active ? "font-semibold text-[#1a3c6e]" : "text-muted-foreground"}`}
                >
                  {label}
                </span>
              </li>
              {i < STEPS.length - 1 && (
                <div className="mx-1 mb-4 h-px flex-1 bg-border" aria-hidden />
              )}
            </React.Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

function ImmutabilityBanner() {
  return (
    <div
      role="note"
      className="flex items-center gap-2 rounded-md border border-amber-400/50 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-300"
    >
      <Lock className="h-4 w-4 shrink-0" aria-hidden />
      <span>
        <strong>Documento inmutable post-firma.</strong> Una vez completada la doble firma,
        este consentimiento quirúrgico no podrá modificarse ni eliminarse.
      </span>
    </div>
  );
}

function SignatureCanvas({ onChange }: { onChange: (dataUrl: string) => void }) {
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

// ─── Checkbox accesible ───────────────────────────────────────────────────────

function CheckField({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-border accent-[#1a3c6e]"
      />
      <Label htmlFor={id} className="cursor-pointer leading-snug">
        {label}
      </Label>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function NuevoConsentimientoQxPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Si viene desde acto-quirurgico, episodioId y actoId se pasan como query param
  const episodioIdParam = searchParams.get("episodioId") ?? "";

  const [step, setStep] = React.useState(0);
  const [clientError, setClientError] = React.useState<string | null>(null);
  const [showPinModal, setShowPinModal] = React.useState(false);

  const [s0, setS0] = React.useState<Step0State>({
    episodioId: episodioIdParam,
    procedimiento: "",
    riesgos: "",
    alternativas: "",
  });

  const [s1, setS1] = React.useState<Step1State>({
    tipoAnestesia: "",
    transfusionAutorizada: false,
    ampliacionQuirurgicaAutorizada: false,
    fotografiaGrabacionAutorizada: false,
  });

  const [s2, setS2] = React.useState<Step2State>({
    firmaMetodo: "canvas",
    firmaArchivoNombre: "",
    firmaDataUrl: "",
  });

  const [s3, setS3] = React.useState<Step3State>({
    pinConfirmado: false,
    firmaId: "",
  });

  // Crear borrador quirúrgico vía tRPC
  const crearQx = trpc.eceConsentimiento.crearQuirurgico.useMutation({
    onSuccess: () => router.push("/ece/quirofano/consentimiento-qx"),
  });

  // ── Validaciones ──────────────────────────────────────────────────────────

  function validateStep0(): string | null {
    if (!s0.episodioId.trim()) return "El episodio es requerido.";
    if (!s0.procedimiento.trim()) return "La descripción del procedimiento es requerida.";
    if (!s0.riesgos.trim()) return "Los riesgos son requeridos.";
    if (!s0.alternativas.trim()) return "Las alternativas son requeridas.";
    return null;
  }

  function validateStep1(): string | null {
    if (!s1.tipoAnestesia) return "Seleccione el tipo de anestesia.";
    return null;
  }

  function validateStep2(): string | null {
    if (!s2.firmaDataUrl) return "La firma del paciente es requerida.";
    return null;
  }

  function validateStep3(): string | null {
    if (!s3.pinConfirmado) return "Debe confirmar con su PIN de firma médica.";
    return null;
  }

  function nextStep() {
    let err: string | null = null;
    if (step === 0) err = validateStep0();
    if (step === 1) err = validateStep1();
    if (step === 2) err = validateStep2();
    setClientError(err);
    if (!err) setStep((s) => s + 1);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validateStep3();
    setClientError(err);
    if (err) return;

    crearQx.mutate({
      episodioId: s0.episodioId.trim(),
      tipoConsentimiento: "quirurgico",
      procedimientoDescrito: s0.procedimiento,
      riesgos: s0.riesgos,
      alternativas: s0.alternativas,
      tipoAnestesia: s1.tipoAnestesia as TipoAnestesia,
      transfusionAutorizada: s1.transfusionAutorizada,
      ampliacionQuirurgicaAutorizada: s1.ampliacionQuirurgicaAutorizada,
      fotografiaGrabacionAutorizada: s1.fotografiaGrabacionAutorizada,
    });
  }

  const isSubmitting = crearQx.isPending;
  const errorMessage = clientError ?? crearQx.error?.message ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Nuevo consentimiento quirúrgico</h1>
        <p className="text-sm text-muted-foreground">
          CONS_QX — NTEC §4.12. Doble firma requerida: paciente y médico cirujano.
        </p>
      </div>

      <ImmutabilityBanner />
      <StepIndicator current={step} />

      {/* ── Paso 0: Procedimiento y riesgos ── */}
      {step === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Procedimiento, riesgos y alternativas</CardTitle>
          </CardHeader>
          <CardContent>
            <Form onSubmit={(e) => { e.preventDefault(); nextStep(); }}>
              <FormField>
                <Label htmlFor="episodioId">Episodio (UUID)</Label>
                <Input
                  id="episodioId"
                  required
                  placeholder="xxxxxxxx-xxxx-..."
                  value={s0.episodioId}
                  onChange={(e) => setS0((p) => ({ ...p, episodioId: e.target.value }))}
                />
              </FormField>

              <FormField>
                <Label htmlFor="procedimiento">Descripción del procedimiento quirúrgico</Label>
                <textarea
                  id="procedimiento"
                  required
                  value={s0.procedimiento}
                  onChange={(e) => setS0((p) => ({ ...p, procedimiento: e.target.value }))}
                  placeholder="Describa el procedimiento en términos comprensibles para el paciente…"
                  className="min-h-[100px] w-full rounded-md border bg-background p-3 text-sm"
                  maxLength={4000}
                />
              </FormField>

              <FormField>
                <Label htmlFor="riesgos">Riesgos quirúrgicos</Label>
                <textarea
                  id="riesgos"
                  required
                  value={s0.riesgos}
                  onChange={(e) => setS0((p) => ({ ...p, riesgos: e.target.value }))}
                  placeholder="Riesgos inherentes al procedimiento…"
                  className="min-h-[80px] w-full rounded-md border bg-background p-3 text-sm"
                  maxLength={2000}
                />
              </FormField>

              <FormField>
                <Label htmlFor="alternativas">Alternativas terapéuticas</Label>
                <textarea
                  id="alternativas"
                  required
                  value={s0.alternativas}
                  onChange={(e) => setS0((p) => ({ ...p, alternativas: e.target.value }))}
                  placeholder="Alternativas no quirúrgicas disponibles…"
                  className="min-h-[80px] w-full rounded-md border bg-background p-3 text-sm"
                  maxLength={2000}
                />
              </FormField>

              {errorMessage && <FormError>{errorMessage}</FormError>}

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

      {/* ── Paso 1: Anestesia y autorizaciones específicas ── */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Anestesia y autorizaciones quirúrgicas</CardTitle>
          </CardHeader>
          <CardContent>
            <Form onSubmit={(e) => { e.preventDefault(); nextStep(); }}>
              <FormField>
                <Label htmlFor="tipoAnestesia">Tipo de anestesia</Label>
                <Select
                  value={s1.tipoAnestesia}
                  onValueChange={(v) => setS1((p) => ({ ...p, tipoAnestesia: v as TipoAnestesia }))}
                >
                  <SelectTrigger id="tipoAnestesia">
                    <SelectValue placeholder="Seleccione tipo de anestesia…" />
                  </SelectTrigger>
                  <SelectContent>
                    {ANESTESIA_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>

              <fieldset className="space-y-3">
                <legend className="text-sm font-medium">
                  Autorizaciones adicionales del paciente
                </legend>
                <CheckField
                  id="transfusion"
                  label="Autoriza transfusión de hemoderivados en caso necesario"
                  checked={s1.transfusionAutorizada}
                  onChange={(v) => setS1((p) => ({ ...p, transfusionAutorizada: v }))}
                />
                <CheckField
                  id="ampliacion"
                  label="Autoriza ampliación del acto quirúrgico si las condiciones intraoperatorias lo requieren"
                  checked={s1.ampliacionQuirurgicaAutorizada}
                  onChange={(v) => setS1((p) => ({ ...p, ampliacionQuirurgicaAutorizada: v }))}
                />
                <CheckField
                  id="fotografia"
                  label="Autoriza fotografía y/o grabación con fines médicos o docentes"
                  checked={s1.fotografiaGrabacionAutorizada}
                  onChange={(v) => setS1((p) => ({ ...p, fotografiaGrabacionAutorizada: v }))}
                />
              </fieldset>

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

      {/* ── Paso 2: Firma del paciente ── */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {s2.firmaDataUrl
                ? <CheckCircle2 className="h-5 w-5 text-green-600" aria-hidden />
                : <Circle className="h-5 w-5 text-muted-foreground" aria-hidden />}
              Firma del paciente / representante legal
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Form onSubmit={(e) => { e.preventDefault(); nextStep(); }}>
              <div className="mb-4 flex gap-3">
                <Button
                  type="button"
                  variant={s2.firmaMetodo === "canvas" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setS2((p) => ({ ...p, firmaMetodo: "canvas", firmaDataUrl: "" }))}
                >
                  Dibujar firma
                </Button>
                <Button
                  type="button"
                  variant={s2.firmaMetodo === "upload" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setS2((p) => ({ ...p, firmaMetodo: "upload", firmaDataUrl: "" }))}
                >
                  Subir imagen
                </Button>
              </div>

              {s2.firmaMetodo === "canvas" && (
                <SignatureCanvas
                  onChange={(dataUrl) => setS2((p) => ({ ...p, firmaDataUrl: dataUrl }))}
                />
              )}

              {s2.firmaMetodo === "upload" && (
                <div className="space-y-2">
                  <Input
                    type="file"
                    accept="image/*,.pdf"
                    aria-label="Subir imagen de firma del paciente"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setS2((p) => ({
                        ...p,
                        firmaArchivoNombre: file.name,
                        firmaDataUrl: `upload:${file.name}`,
                      }));
                    }}
                  />
                  {s2.firmaArchivoNombre && (
                    <p className="text-xs text-muted-foreground">
                      Archivo: {s2.firmaArchivoNombre}
                    </p>
                  )}
                </div>
              )}

              {errorMessage && <FormError>{errorMessage}</FormError>}

              <div className="mt-4 flex justify-between gap-2">
                <Button type="button" variant="outline" onClick={() => setStep(1)}>
                  Atrás
                </Button>
                <Button type="submit" disabled={!s2.firmaDataUrl}>
                  Siguiente <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
                </Button>
              </div>
            </Form>
          </CardContent>
        </Card>
      )}

      {/* ── Paso 3: Firma MC con PIN ── */}
      {step === 3 && (
        <Form onSubmit={onSubmit}>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {s3.pinConfirmado
                  ? <CheckCircle2 className="h-5 w-5 text-green-600" aria-hidden />
                  : <Circle className="h-5 w-5 text-muted-foreground" aria-hidden />}
                Firma del médico cirujano (MC) — PIN electrónico
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
                >
                  Confirmar con PIN de firma
                </Button>
              )}
            </CardContent>
          </Card>

          {errorMessage && <FormError>{errorMessage}</FormError>}

          <div className="mt-4 flex justify-between gap-2">
            <Button type="button" variant="outline" onClick={() => setStep(2)}>
              Atrás
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !s3.pinConfirmado}
              className="bg-[#1a3c6e] hover:bg-[#15305a] text-white"
            >
              {isSubmitting ? "Registrando…" : "Crear consentimiento quirúrgico firmado"}
            </Button>
          </div>
        </Form>
      )}

      <PinConfirmModal
        open={showPinModal}
        onClose={() => setShowPinModal(false)}
        resource="consentimiento/quirurgico"
        action="firmar_consentimiento_qx"
        onConfirmed={(firmaId) => {
          setS3({ pinConfirmado: true, firmaId });
          setShowPinModal(false);
        }}
      />
    </div>
  );
}
