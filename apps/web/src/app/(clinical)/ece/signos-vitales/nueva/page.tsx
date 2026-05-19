"use client";

/**
 * ECE — Nuevo Registro de Signos Vitales
 *
 * Form de captura rápida (objetivo ≤30 s).  Implementado con controlled state
 * React nativo para mantener zero-dep overhead (react-hook-form no está en el
 * workspace; se puede migrar cuando se añada).
 *
 * Validación inline con umbrales de @his/contracts/schemas/inpatient.
 * Slider de dolor con <input type="range"> nativo estilizado con Tailwind.
 *
 * Accesibilidad: todos los inputs tienen <label> explícito + aria-describedby
 * para mensajes de error (WCAG 2.2 AA).
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Badge } from "@his/ui/components/badge";
import {
  VITAL_THRESHOLDS_ADULT,
  evaluateVitalAlerts,
  type InpatientVitalAlert,
} from "@his/contracts/schemas/inpatient";
import { trpc } from "@/lib/trpc/react";

// ---------------------------------------------------------------------------
// Schema de validación (replica eceSignosVitalesCreateSchema — actualizar
// cuando el contrato ECE esté publicado en @his/contracts).
// ---------------------------------------------------------------------------

const RANGES = {
  systolicBp: { min: 60, max: 250, label: "TA Sistólica", unit: "mmHg" },
  diastolicBp: { min: 30, max: 150, label: "TA Diastólica", unit: "mmHg" },
  heartRate: { min: 20, max: 250, label: "Frecuencia cardíaca", unit: "lpm" },
  respiratoryRate: { min: 4, max: 60, label: "Frecuencia respiratoria", unit: "rpm" },
  temperatureC: { min: 30, max: 43, label: "Temperatura", unit: "°C" },
  spo2: { min: 50, max: 100, label: "SpO₂", unit: "%" },
  pesoKg: { min: 0.5, max: 300, label: "Peso", unit: "kg" },
  tallaCm: { min: 30, max: 250, label: "Talla", unit: "cm" },
  glucometriaMgdl: { min: 20, max: 600, label: "Glucometría", unit: "mg/dL" },
} as const;

type RangeField = keyof typeof RANGES;

interface FormState {
  systolicBp: string;
  diastolicBp: string;
  heartRate: string;
  respiratoryRate: string;
  temperatureC: string;
  spo2: string;
  painScale: number; // 0-10 slider nativo
  // HD-18: datos antropométricos
  pesoKg: string;
  tallaCm: string;
  glucometriaMgdl: string;
}

const INITIAL: FormState = {
  systolicBp: "",
  diastolicBp: "",
  heartRate: "",
  respiratoryRate: "",
  temperatureC: "",
  spo2: "",
  painScale: 0,
  pesoKg: "",
  tallaCm: "",
  glucometriaMgdl: "",
};

// ---------------------------------------------------------------------------
// Helpers de validación inline
// ---------------------------------------------------------------------------

function validateField(field: RangeField, raw: string): string | null {
  if (raw.trim() === "") return null; // opcional — solo valida si hay valor
  const n = Number(raw);
  if (!Number.isFinite(n)) return "Debe ser un número válido";
  const { min, max } = RANGES[field];
  if (n < min || n > max) return `Fuera del rango aceptado (${min}–${max})`;
  return null;
}

function parseOpt(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Calcula IMC visual en tiempo real (solo para mostrar, el router lo persiste). */
function calcImcDisplay(pesoKgRaw: string, tallaCmRaw: string): string | null {
  const peso = parseOpt(pesoKgRaw);
  const talla = parseOpt(tallaCmRaw);
  if (!peso || !talla || talla === 0) return null;
  const tallaM = talla / 100;
  const imc = Math.round((peso / (tallaM * tallaM)) * 10) / 10;
  return String(imc);
}

// ---------------------------------------------------------------------------
// Subcomponentes
// ---------------------------------------------------------------------------

function FieldError({ id, message }: { id: string; message: string | null }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-xs text-destructive">
      {message}
    </p>
  );
}

function AlertaBanner({ alerts }: { alerts: InpatientVitalAlert[] }) {
  const criticos = alerts.filter((a) => a.severity === "critical");
  if (criticos.length === 0) return null;
  return (
    <div
      role="status"
      aria-live="assertive"
      className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive"
      data-testid="alerta-critica"
    >
      <Badge variant="destructive">Alerta crítica</Badge>
      {criticos.map((a) => (
        <span key={a.field} className="font-medium">
          {a.reason}
        </span>
      ))}
    </div>
  );
}

function PainSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const PAIN_LABELS = [
    "Sin dolor",    // 0
    "Muy leve",     // 1
    "Leve",         // 2
    "Leve-mod.",    // 3
    "Moderado",     // 4
    "Moderado",     // 5
    "Moderado-int.",// 6
    "Intenso",      // 7
    "Muy intenso",  // 8
    "Severo",       // 9
    "Máximo",       // 10
  ] as const;

  const color =
    value >= 8
      ? "text-destructive font-semibold"
      : value >= 5
        ? "text-amber-600 dark:text-amber-400"
        : "text-green-700 dark:text-green-400";

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <Label htmlFor="pain-slider">
          Dolor (escala EVA 0–10)
        </Label>
        <span className={`text-sm font-semibold tabular-nums ${color}`} aria-live="polite">
          {value} — {PAIN_LABELS[value]}
        </span>
      </div>
      <input
        id="pain-slider"
        type="range"
        min={0}
        max={10}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-gradient-to-r from-green-400 via-amber-400 to-red-500 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label="Escala de dolor 0 a 10"
        aria-valuemin={0}
        aria-valuemax={10}
        aria-valuenow={value}
        aria-valuetext={`${value} — ${PAIN_LABELS[value]}`}
      />
      {/* Marcadores visuales */}
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>0</span>
        <span>5</span>
        <span>10</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------

export default function NuevoSignoVitalPage() {
  const router = useRouter();
  const [form, setForm] = React.useState<FormState>(INITIAL);
  const [touched, setTouched] = React.useState<Partial<Record<RangeField, boolean>>>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  const createMutation = trpc.eceSignosVitales.create.useMutation();
  const firmarMutation = trpc.eceSignosVitales.firmar.useMutation();

  // Compute alerts en tiempo real
  const alerts: InpatientVitalAlert[] = evaluateVitalAlerts({
    systolicBp: parseOpt(form.systolicBp),
    diastolicBp: parseOpt(form.diastolicBp),
    heartRate: parseOpt(form.heartRate),
    respiratoryRate: parseOpt(form.respiratoryRate),
    temperatureC: parseOpt(form.temperatureC),
    spo2: parseOpt(form.spo2),
    painScale: form.painScale,
  });

  const fieldErrors: Partial<Record<RangeField, string | null>> = {};
  for (const k of Object.keys(RANGES) as RangeField[]) {
    const val = k === "pesoKg" || k === "tallaCm" || k === "glucometriaMgdl"
      ? (form[k] as string)
      : (form[k as keyof Omit<FormState, "painScale">] as string);
    fieldErrors[k] = touched[k] ? validateField(k, val) : null;
  }

  const hasErrors = Object.values(fieldErrors).some((e) => e !== null);

  const imcDisplay = calcImcDisplay(form.pesoKg, form.tallaCm);

  const setField = (field: RangeField, val: string) => {
    setForm((prev) => ({ ...prev, [field]: val }));
  };

  const markTouched = (field: RangeField) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    // Marcar todos los campos como tocados para mostrar errores
    const allTouched = Object.fromEntries(
      (Object.keys(RANGES) as RangeField[]).map((k) => [k, true]),
    ) as Record<RangeField, boolean>;
    setTouched(allTouched);

    if (hasErrors) return;

    setSubmitting(true);
    try {
      // Crear el registro en borrador
      const { id } = await createMutation.mutateAsync({
        presionSistolica: parseOpt(form.systolicBp) ?? undefined,
        presionDiastolica: parseOpt(form.diastolicBp) ?? undefined,
        frecuenciaCardiaca: parseOpt(form.heartRate) ?? undefined,
        frecuenciaRespiratoria: parseOpt(form.respiratoryRate) ?? undefined,
        temperatura: parseOpt(form.temperatureC) ?? undefined,
        saturacionO2: parseOpt(form.spo2) ?? undefined,
        escalaDolor: form.painScale,
        pesoKg: parseOpt(form.pesoKg) ?? undefined,
        tallaCm: parseOpt(form.tallaCm) ?? undefined,
        glucometriaMgdl: parseOpt(form.glucometriaMgdl) ?? undefined,
      });

      // Firmar inmediatamente (flujo de alta frecuencia: borrador → firmado en una acción)
      await firmarMutation.mutateAsync({ id });

      router.push("/ece/signos-vitales");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error al registrar signos vitales.";
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Encabezado */}
      <div>
        <h1 className="text-xl font-semibold text-foreground">Nuevo registro de signos vitales</h1>
        <p className="text-sm text-muted-foreground">ECE · Captura rápida</p>
      </div>

      {/* Alerta crítica en tiempo real */}
      <AlertaBanner alerts={alerts} />

      {submitError && (
        <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {submitError}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-6" aria-label="Formulario de signos vitales">
        {/* Presión arterial */}
        <fieldset className="rounded-lg border p-4 space-y-4">
          <legend className="px-1 text-sm font-semibold text-foreground">
            Presión arterial
          </legend>
          <div className="grid grid-cols-2 gap-4">
            {(["systolicBp", "diastolicBp"] as const).map((field) => {
              const r = RANGES[field];
              const err = fieldErrors[field];
              const isCrit = alerts.some((a) => a.field === field && a.severity === "critical");
              return (
                <div key={field} className="space-y-1.5">
                  <Label htmlFor={field}>
                    {r.label}
                    <span className="ml-1 text-xs text-muted-foreground">({r.unit})</span>
                  </Label>
                  <div className="relative">
                    <Input
                      id={field}
                      inputMode="decimal"
                      type="number"
                      step="1"
                      placeholder={`${r.min}–${r.max}`}
                      value={form[field]}
                      onChange={(e) => setField(field, e.target.value)}
                      onBlur={() => markTouched(field)}
                      aria-describedby={err ? `${field}-err` : undefined}
                      aria-invalid={!!err}
                      className={
                        isCrit
                          ? "border-destructive ring-destructive focus-visible:ring-destructive"
                          : undefined
                      }
                    />
                    {isCrit && (
                      <Badge
                        variant="destructive"
                        className="absolute -right-1 -top-2.5 text-[10px] px-1 py-0"
                      >
                        !
                      </Badge>
                    )}
                  </div>
                  <FieldError id={`${field}-err`} message={err ?? null} />
                </div>
              );
            })}
          </div>
        </fieldset>

        {/* Signos restantes en grid 2-cols */}
        <fieldset className="rounded-lg border p-4 space-y-4">
          <legend className="px-1 text-sm font-semibold text-foreground">
            Signos cardiorrespiratorios y metabólicos
          </legend>
          <div className="grid grid-cols-2 gap-4">
            {(["heartRate", "respiratoryRate", "temperatureC", "spo2"] as const).map((field) => {
              const r = RANGES[field];
              const err = fieldErrors[field];
              const isCrit = alerts.some((a) => a.field === field && a.severity === "critical");
              return (
                <div key={field} className="space-y-1.5">
                  <Label htmlFor={field}>
                    {r.label}
                    <span className="ml-1 text-xs text-muted-foreground">({r.unit})</span>
                  </Label>
                  <div className="relative">
                    <Input
                      id={field}
                      inputMode="decimal"
                      type="number"
                      step={field === "temperatureC" ? "0.1" : "1"}
                      placeholder={`${r.min}–${r.max}`}
                      value={form[field]}
                      onChange={(e) => setField(field, e.target.value)}
                      onBlur={() => markTouched(field)}
                      aria-describedby={err ? `${field}-err` : undefined}
                      aria-invalid={!!err}
                      className={
                        isCrit
                          ? "border-destructive ring-destructive focus-visible:ring-destructive"
                          : undefined
                      }
                    />
                    {isCrit && (
                      <Badge
                        variant="destructive"
                        className="absolute -right-1 -top-2.5 text-[10px] px-1 py-0"
                      >
                        !
                      </Badge>
                    )}
                  </div>
                  <FieldError id={`${field}-err`} message={err ?? null} />
                </div>
              );
            })}
          </div>
        </fieldset>

        {/* Escala de dolor */}
        <fieldset className="rounded-lg border p-4">
          <legend className="sr-only">Escala de dolor</legend>
          <PainSlider
            value={form.painScale}
            onChange={(v) => setForm((prev) => ({ ...prev, painScale: v }))}
          />
        </fieldset>

        {/* Datos antropométricos (HD-18 — NTEC Art. 28) */}
        <fieldset className="rounded-lg border p-4 space-y-4">
          <legend className="px-1 text-sm font-semibold text-foreground">
            Datos antropométricos <span className="font-normal text-muted-foreground">(opcional)</span>
          </legend>
          <div className="grid grid-cols-2 gap-4">
            {(["pesoKg", "tallaCm"] as const).map((field) => {
              const r = RANGES[field];
              const err = fieldErrors[field];
              return (
                <div key={field} className="space-y-1.5">
                  <Label htmlFor={field}>
                    {r.label}
                    <span className="ml-1 text-xs text-muted-foreground">({r.unit})</span>
                  </Label>
                  <Input
                    id={field}
                    inputMode="decimal"
                    type="number"
                    step="0.1"
                    placeholder={`${r.min}–${r.max}`}
                    value={form[field]}
                    onChange={(e) => setField(field, e.target.value)}
                    onBlur={() => markTouched(field)}
                    aria-describedby={err ? `${field}-err` : undefined}
                    aria-invalid={!!err}
                  />
                  <FieldError id={`${field}-err`} message={err ?? null} />
                </div>
              );
            })}
          </div>

          {/* IMC calculado automáticamente */}
          {imcDisplay && (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              IMC calculado: <span className="font-semibold text-foreground">{imcDisplay} kg/m²</span>
            </p>
          )}

          {/* Glucometría */}
          <div className="space-y-1.5">
            <Label htmlFor="glucometriaMgdl">
              {RANGES.glucometriaMgdl.label}
              <span className="ml-1 text-xs text-muted-foreground">({RANGES.glucometriaMgdl.unit})</span>
            </Label>
            <Input
              id="glucometriaMgdl"
              inputMode="decimal"
              type="number"
              step="1"
              placeholder={`${RANGES.glucometriaMgdl.min}–${RANGES.glucometriaMgdl.max}`}
              value={form.glucometriaMgdl}
              onChange={(e) => setField("glucometriaMgdl", e.target.value)}
              onBlur={() => markTouched("glucometriaMgdl")}
              aria-describedby={fieldErrors.glucometriaMgdl ? "glucometriaMgdl-err" : undefined}
              aria-invalid={!!fieldErrors.glucometriaMgdl}
              className="max-w-[200px]"
            />
            <FieldError id="glucometriaMgdl-err" message={fieldErrors.glucometriaMgdl ?? null} />
          </div>
        </fieldset>

        {/* Acciones */}
        <div className="flex gap-3 justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={submitting}
            aria-busy={submitting}
          >
            {submitting ? "Registrando..." : "Registrar y Firmar"}
          </Button>
        </div>
      </form>
    </div>
  );
}
