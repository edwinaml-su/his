"use client";

/**
 * ECE — Nueva epicrisis: wizard de 5 pasos.
 *
 * Paso 1: Datos episodio          — episodioHospitalarioId + fecha/motivo egreso
 * Paso 2: Resumen ingreso         — motivo, exploración inicial, dx ingreso
 * Paso 3: Evolución hospitalaria  — texto libre
 * Paso 4: Diagnóstico egreso CIE-10 — multiple (principal + asociados)
 * Paso 5: Tratamiento + indicaciones + firma MC
 *
 * Autosave borrador a localStorage cada 60 s.
 * Preview PDF disponible desde el paso 4 en adelante.
 * Post-creación → redirect a /ece/epicrisis/[id] para flujo de firma.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Lock, Plus, Trash2, FileText, ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Badge } from "@his/ui/components/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { EpicrisisPdfPreview, type EpicrisisPdfData } from "@/components/epicrisis-pdf-preview";
import { trpc } from "@/lib/trpc/react";

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const MOTIVO_EGRESO_OPTIONS = [
  { value: "alta_medica", label: "Alta médica" },
  { value: "alta_voluntaria", label: "Alta voluntaria" },
  { value: "traslado", label: "Traslado a otro centro" },
  { value: "fallecido", label: "Fallecido" },
  { value: "otro", label: "Otro" },
] as const;

type MotivoEgreso = (typeof MOTIVO_EGRESO_OPTIONS)[number]["value"];

const LS_KEY = "his:epicrisis:draft";
const AUTOSAVE_INTERVAL_MS = 60_000;

// ---------------------------------------------------------------------------
// Tipos del formulario
// ---------------------------------------------------------------------------

interface DiagnosticoItem {
  cie10: string;
  descripcion: string;
  tipo: "principal" | "secundario" | "comorbilidad";
}

interface WizardForm {
  // Paso 1
  episodioHospitalarioId: string;
  fechaEgreso: string; // ISO date string para el input type="date"
  motivoEgreso: MotivoEgreso | "";
  // Paso 2
  resumenIngreso: string;
  // Paso 3
  evolucionHospitalaria: string;
  // Paso 4
  diagnosticos: DiagnosticoItem[];
  // Paso 5
  tratamientoEgreso: string;
  indicacionesEgreso: string;
  notas: string;
}

const INITIAL_DIAGNOSTICO: DiagnosticoItem = {
  cie10: "",
  descripcion: "",
  tipo: "principal",
};

const INITIAL_FORM: WizardForm = {
  episodioHospitalarioId: "",
  fechaEgreso: "",
  motivoEgreso: "",
  resumenIngreso: "",
  evolucionHospitalaria: "",
  diagnosticos: [{ ...INITIAL_DIAGNOSTICO }],
  tratamientoEgreso: "",
  indicacionesEgreso: "",
  notas: "",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CIE10_REGEX = /^[A-Z][0-9]{2}(\.[0-9A-Z]{0,4})?$/;

function validateStep(step: number, form: WizardForm): string | null {
  switch (step) {
    case 1:
      if (!form.episodioHospitalarioId.trim())
        return "El ID del episodio hospitalario es requerido.";
      if (!form.fechaEgreso) return "La fecha de egreso es requerida.";
      if (!form.motivoEgreso) return "El motivo de egreso es requerido.";
      return null;
    case 2:
      if (form.resumenIngreso.trim().length < 10)
        return "El resumen de ingreso debe tener al menos 10 caracteres.";
      return null;
    case 3:
      // Evolución es recomendada pero no obligatoria
      return null;
    case 4: {
      if (form.diagnosticos.length === 0)
        return "Se requiere al menos un diagnóstico de egreso.";
      const hasPrincipal = form.diagnosticos.some((d) => d.tipo === "principal");
      if (!hasPrincipal) return "Se requiere al menos un diagnóstico principal.";
      for (const dx of form.diagnosticos) {
        if (!CIE10_REGEX.test(dx.cie10))
          return `Código CIE-10 inválido: "${dx.cie10}". Use formato A00 o A00.0`;
        if (!dx.descripcion.trim())
          return "Todos los diagnósticos requieren descripción.";
      }
      return null;
    }
    case 5:
      if (form.tratamientoEgreso.trim().length < 5)
        return "El tratamiento al egreso es requerido (mín. 5 caracteres).";
      if (form.indicacionesEgreso.trim().length < 5)
        return "Las indicaciones post-alta son requeridas (mín. 5 caracteres).";
      return null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

const STEP_LABELS = [
  "Episodio",
  "Ingreso",
  "Evolución",
  "Diagnóstico",
  "Tratamiento",
];

function StepIndicator({
  currentStep,
  totalSteps,
}: {
  currentStep: number;
  totalSteps: number;
}) {
  return (
    <nav aria-label="Progreso del wizard" className="mb-6">
      <ol role="list" className="flex items-center gap-2">
        {Array.from({ length: totalSteps }, (_, i) => {
          const stepNum = i + 1;
          const isDone = stepNum < currentStep;
          const isCurrent = stepNum === currentStep;

          return (
            <li key={stepNum} className="flex items-center gap-2">
              <div
                aria-current={isCurrent ? "step" : undefined}
                aria-label={`Paso ${stepNum}: ${STEP_LABELS[i]}`}
                className={[
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors",
                  isDone
                    ? "bg-green-600 text-white"
                    : isCurrent
                      ? "bg-[#1a3c6e] text-white"
                      : "bg-muted text-muted-foreground",
                ].join(" ")}
              >
                {isDone ? "✓" : stepNum}
              </div>
              <span
                className={[
                  "hidden text-sm sm:inline",
                  isCurrent ? "font-medium text-foreground" : "text-muted-foreground",
                ].join(" ")}
              >
                {STEP_LABELS[i]}
              </span>
              {stepNum < totalSteps && (
                <div
                  aria-hidden
                  className={[
                    "h-0.5 w-6 sm:w-10",
                    isDone ? "bg-green-600" : "bg-border",
                  ].join(" ")}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Sub-formularios por paso
// ---------------------------------------------------------------------------

function Step1({
  form,
  onChange,
}: {
  form: WizardForm;
  onChange: <K extends keyof WizardForm>(k: K, v: WizardForm[K]) => void;
}) {
  return (
    <fieldset className="space-y-4 border-0 p-0">
      <legend className="sr-only">Paso 1: Datos del episodio</legend>

      <div className="space-y-1.5">
        <Label htmlFor="episodioId">Episodio hospitalario (UUID)</Label>
        <Input
          id="episodioId"
          required
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          value={form.episodioHospitalarioId}
          onChange={(e) => onChange("episodioHospitalarioId", e.target.value)}
          aria-describedby="episodioId-hint"
        />
        <p id="episodioId-hint" className="text-xs text-muted-foreground">
          Identificador único del episodio de hospitalización en el HIS.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="fechaEgreso">Fecha de egreso</Label>
          <Input
            id="fechaEgreso"
            type="date"
            required
            value={form.fechaEgreso}
            onChange={(e) => onChange("fechaEgreso", e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="motivoEgreso">Motivo de egreso</Label>
          <Select
            value={form.motivoEgreso}
            onValueChange={(v) => onChange("motivoEgreso", v as MotivoEgreso)}
          >
            <SelectTrigger id="motivoEgreso" aria-required="true">
              <SelectValue placeholder="Seleccionar motivo…" />
            </SelectTrigger>
            <SelectContent>
              {MOTIVO_EGRESO_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </fieldset>
  );
}

function Step2({
  form,
  onChange,
}: {
  form: WizardForm;
  onChange: <K extends keyof WizardForm>(k: K, v: WizardForm[K]) => void;
}) {
  return (
    <fieldset className="space-y-4 border-0 p-0">
      <legend className="sr-only">Paso 2: Resumen de ingreso</legend>

      <div className="space-y-1.5">
        <Label htmlFor="resumenIngreso">
          Motivo de ingreso, exploración inicial y diagnóstico de ingreso
        </Label>
        <textarea
          id="resumenIngreso"
          required
          value={form.resumenIngreso}
          onChange={(e) => onChange("resumenIngreso", e.target.value)}
          placeholder="Paciente de X años que ingresó el [fecha] con diagnóstico de… Se realizó examen físico que reveló…"
          className="min-h-[200px] w-full rounded-md border bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          maxLength={10000}
          aria-describedby="resumenIngreso-count"
        />
        <p
          id="resumenIngreso-count"
          className="text-right text-xs text-muted-foreground"
          aria-live="polite"
          aria-atomic="true"
        >
          {form.resumenIngreso.length}/10 000
        </p>
      </div>
    </fieldset>
  );
}

function Step3({
  form,
  onChange,
}: {
  form: WizardForm;
  onChange: <K extends keyof WizardForm>(k: K, v: WizardForm[K]) => void;
}) {
  return (
    <fieldset className="space-y-4 border-0 p-0">
      <legend className="sr-only">Paso 3: Evolución hospitalaria</legend>

      <div className="space-y-1.5">
        <Label htmlFor="evolucion">
          Evolución durante la hospitalización
        </Label>
        <p className="text-xs text-muted-foreground">
          Procedimientos realizados, respuesta al tratamiento, complicaciones, interconsultas.
        </p>
        <textarea
          id="evolucion"
          value={form.evolucionHospitalaria}
          onChange={(e) => onChange("evolucionHospitalaria", e.target.value)}
          placeholder="Durante la hospitalización se realizó… con respuesta… Se presentaron las siguientes complicaciones:…"
          className="min-h-[200px] w-full rounded-md border bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          maxLength={10000}
          aria-describedby="evolucion-count"
        />
        <p
          id="evolucion-count"
          className="text-right text-xs text-muted-foreground"
          aria-live="polite"
          aria-atomic="true"
        >
          {form.evolucionHospitalaria.length}/10 000
        </p>
      </div>
    </fieldset>
  );
}

function Step4({
  form,
  onChange,
}: {
  form: WizardForm;
  onChange: <K extends keyof WizardForm>(k: K, v: WizardForm[K]) => void;
}) {
  function updateDx(index: number, field: keyof DiagnosticoItem, value: string) {
    const updated = form.diagnosticos.map((dx, i) =>
      i === index ? { ...dx, [field]: field === "cie10" ? value.toUpperCase() : value } : dx,
    );
    onChange("diagnosticos", updated);
  }

  function addDx() {
    onChange("diagnosticos", [
      ...form.diagnosticos,
      { cie10: "", descripcion: "", tipo: "secundario" },
    ]);
  }

  function removeDx(index: number) {
    onChange(
      "diagnosticos",
      form.diagnosticos.filter((_, i) => i !== index),
    );
  }

  return (
    <fieldset className="space-y-4 border-0 p-0">
      <legend className="sr-only">Paso 4: Diagnósticos de egreso CIE-10</legend>

      <div className="space-y-3">
        {form.diagnosticos.map((dx, i) => (
          <div
            key={i}
            className="rounded-md border p-3"
            role="group"
            aria-label={`Diagnóstico ${i + 1}`}
          >
            <div className="mb-2 flex items-center justify-between">
              <Badge
                variant={dx.tipo === "principal" ? "default" : "secondary"}
                aria-label={`Tipo: ${dx.tipo}`}
              >
                {dx.tipo}
              </Badge>
              {form.diagnosticos.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeDx(i)}
                  className="rounded p-1 text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Eliminar diagnóstico ${i + 1}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[120px_1fr_130px]">
              <div className="space-y-1">
                <Label htmlFor={`cie10-${i}`}>CIE-10</Label>
                <Input
                  id={`cie10-${i}`}
                  required
                  placeholder="J18.9"
                  value={dx.cie10}
                  onChange={(e) => updateDx(i, "cie10", e.target.value)}
                  maxLength={10}
                  aria-invalid={
                    dx.cie10.length > 0 && !CIE10_REGEX.test(dx.cie10)
                      ? true
                      : undefined
                  }
                  aria-describedby={
                    dx.cie10.length > 0 && !CIE10_REGEX.test(dx.cie10)
                      ? `cie10-error-${i}`
                      : undefined
                  }
                />
                {dx.cie10.length > 0 && !CIE10_REGEX.test(dx.cie10) && (
                  <p id={`cie10-error-${i}`} className="text-xs text-destructive" role="alert">
                    Formato inválido
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor={`desc-${i}`}>Descripción</Label>
                <Input
                  id={`desc-${i}`}
                  required
                  placeholder="Neumonía no especificada…"
                  value={dx.descripcion}
                  onChange={(e) => updateDx(i, "descripcion", e.target.value)}
                  maxLength={500}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`tipo-${i}`}>Tipo</Label>
                <Select
                  value={dx.tipo}
                  onValueChange={(v) =>
                    updateDx(i, "tipo", v)
                  }
                >
                  <SelectTrigger id={`tipo-${i}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="principal">Principal</SelectItem>
                    <SelectItem value="secundario">Secundario</SelectItem>
                    <SelectItem value="comorbilidad">Comorbilidad</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addDx}
        className="w-full"
        aria-label="Agregar diagnóstico de egreso"
      >
        <Plus className="mr-1.5 h-4 w-4" aria-hidden />
        Agregar diagnóstico
      </Button>
    </fieldset>
  );
}

function Step5({
  form,
  onChange,
}: {
  form: WizardForm;
  onChange: <K extends keyof WizardForm>(k: K, v: WizardForm[K]) => void;
}) {
  return (
    <fieldset className="space-y-4 border-0 p-0">
      <legend className="sr-only">Paso 5: Tratamiento, indicaciones y firma</legend>

      <div className="space-y-1.5">
        <Label htmlFor="tratamiento">Tratamiento al egreso</Label>
        <textarea
          id="tratamiento"
          required
          value={form.tratamientoEgreso}
          onChange={(e) => onChange("tratamientoEgreso", e.target.value)}
          placeholder="1. Amoxicilina 500 mg cada 8 h por 7 días&#10;2. Ibuprofeno 400 mg cada 12 h por 5 días, con alimentos…"
          className="min-h-[140px] w-full rounded-md border bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          maxLength={5000}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="indicaciones">Indicaciones post-alta y próximos controles</Label>
        <textarea
          id="indicaciones"
          required
          value={form.indicacionesEgreso}
          onChange={(e) => onChange("indicacionesEgreso", e.target.value)}
          placeholder="Dieta blanda por 5 días. Reposo relativo. Control en consulta externa en 2 semanas. Consultar si presenta fiebre mayor de 38.5 °C…"
          className="min-h-[140px] w-full rounded-md border bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          maxLength={5000}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="notas">Notas adicionales (opcional)</Label>
        <textarea
          id="notas"
          value={form.notas}
          onChange={(e) => onChange("notas", e.target.value)}
          placeholder="Observaciones adicionales del médico tratante…"
          className="min-h-[80px] w-full rounded-md border bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          maxLength={2000}
        />
      </div>

      <div
        role="note"
        className="rounded-md border border-[#1a3c6e]/30 bg-[#1a3c6e]/5 p-3 text-sm text-[#1a3c6e]"
      >
        Al guardar, el documento quedará en estado <strong>Borrador</strong>.
        Será redirigido a la vista de detalle para que proceda con la firma MC.
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Página / Wizard principal
// ---------------------------------------------------------------------------

const TOTAL_STEPS = 5;

export default function NuevaEpicrisisPage() {
  const router = useRouter();
  const [step, setStep] = React.useState(1);
  const [form, setForm] = React.useState<WizardForm>(() => {
    // Intentar restaurar borrador de localStorage
    if (typeof window !== "undefined") {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) return JSON.parse(raw) as WizardForm;
      } catch {
        // borrador corrupto — ignorar
      }
    }
    return INITIAL_FORM;
  });
  const [stepError, setStepError] = React.useState<string | null>(null);
  const [showPreview, setShowPreview] = React.useState(false);

  function updateField<K extends keyof WizardForm>(key: K, value: WizardForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // Autosave a localStorage cada 60 s
  React.useEffect(() => {
    const interval = setInterval(() => {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(form));
      } catch {
        // cuota localStorage excedida — ignorar
      }
    }, AUTOSAVE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [form]);

  const create = trpc.eceEpicrisis.create.useMutation({
    onSuccess: (data: { id: string }) => {
      // Limpiar borrador al guardar exitosamente
      try { localStorage.removeItem(LS_KEY); } catch { /* noop */ }
      router.push(`/ece/epicrisis/${data.id}`);
    },
  });

  function handleNext() {
    const err = validateStep(step, form);
    setStepError(err);
    if (err) return;
    setStepError(null);
    setStep((s) => s + 1);
  }

  function handleBack() {
    setStepError(null);
    setStep((s) => s - 1);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validateStep(5, form);
    setStepError(err);
    if (err) return;

    create.mutate({
      episodioHospitalarioId: form.episodioHospitalarioId.trim(),
      fechaEgreso: new Date(form.fechaEgreso),
      motivoEgreso: form.motivoEgreso as NonNullable<typeof form.motivoEgreso>,
      diagnosticoEgresoCie10: form.diagnosticos,
      resumenIngreso: form.resumenIngreso,
      evolucionHospitalaria: form.evolucionHospitalaria,
      tratamientoEgreso: form.tratamientoEgreso,
      indicacionesEgreso: form.indicacionesEgreso,
      notas: form.notas || undefined,
    });
  }

  // PDF preview data (parcial, para pasos 4 y 5)
  const previewData: EpicrisisPdfData = {
    id: "borrador",
    episodioId: form.episodioHospitalarioId || "—",
    pacienteNombre: "Paciente",
    fechaEgreso: form.fechaEgreso ? new Date(form.fechaEgreso) : new Date(),
    motivoEgreso: form.motivoEgreso || "—",
    establecimientoNombre: "Complejo Hospitalario Avante",
    diagnosticosEgreso: form.diagnosticos.filter(
      (d) => d.cie10 && d.descripcion,
    ),
    resumenIngreso: form.resumenIngreso || "(Pendiente)",
    evolucionHospitalaria: form.evolucionHospitalaria || "(Pendiente)",
    tratamientoEgreso: form.tratamientoEgreso || "(Pendiente)",
    indicacionesEgreso: form.indicacionesEgreso || "(Pendiente)",
    notas: form.notas || null,
    estado: "borrador",
  };

  const errorMessage = stepError ?? create.error?.message ?? null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Nueva epicrisis de egreso</h1>
          <p className="text-sm text-muted-foreground">
            Complete los datos clínicos del egreso hospitalario.
          </p>
        </div>
        {step >= 4 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowPreview((v) => !v)}
            aria-label={showPreview ? "Ocultar vista previa PDF" : "Ver vista previa PDF"}
          >
            <FileText className="mr-1.5 h-4 w-4" aria-hidden />
            {showPreview ? "Ocultar PDF" : "Preview PDF"}
          </Button>
        )}
      </div>

      {/* Banner inmutabilidad */}
      <div
        role="note"
        aria-label="Advertencia: documento inmutable post-firma"
        className="flex items-center gap-2 rounded-md border border-amber-400/50 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-300"
      >
        <Lock className="h-4 w-4 shrink-0" aria-hidden />
        <span>
          <strong>Documento inmutable post-firma.</strong> Una vez firmado por MC no se
          podrá modificar el contenido clínico (Art. 40 Reglamento ECE).
        </span>
      </div>

      {/* Step indicator */}
      <StepIndicator currentStep={step} totalSteps={TOTAL_STEPS} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_380px]">
        {/* Formulario */}
        <Card>
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} noValidate>
              <h2 className="mb-4 text-base font-semibold text-[#1a3c6e]">
                Paso {step} — {STEP_LABELS[step - 1]}
              </h2>

              {step === 1 && <Step1 form={form} onChange={updateField} />}
              {step === 2 && <Step2 form={form} onChange={updateField} />}
              {step === 3 && <Step3 form={form} onChange={updateField} />}
              {step === 4 && <Step4 form={form} onChange={updateField} />}
              {step === 5 && <Step5 form={form} onChange={updateField} />}

              {/* Error de validación o server */}
              {errorMessage && (
                <p
                  role="alert"
                  className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
                >
                  {errorMessage}
                </p>
              )}

              {/* Navegación */}
              <div className="mt-6 flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={step === 1 ? () => router.back() : handleBack}
                  disabled={create.isPending}
                  aria-label={step === 1 ? "Cancelar y volver" : "Paso anterior"}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" aria-hidden />
                  {step === 1 ? "Cancelar" : "Anterior"}
                </Button>

                {step < TOTAL_STEPS ? (
                  <Button
                    type="button"
                    onClick={handleNext}
                    aria-label={`Avanzar al paso ${step + 1}`}
                  >
                    Siguiente
                    <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    disabled={create.isPending}
                    className="bg-[#1a3c6e] hover:bg-[#15305a] text-white"
                    aria-label="Guardar epicrisis como borrador"
                  >
                    {create.isPending ? "Guardando…" : "Guardar epicrisis (borrador)"}
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>

        {/* PDF preview lateral */}
        {showPreview && step >= 4 && (
          <div>
            <EpicrisisPdfPreview data={previewData} showPrintButton={false} />
          </div>
        )}
      </div>
    </div>
  );
}
