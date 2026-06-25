"use client";

/**
 * Captura de signos vitales reutilizable (controlled).
 *
 * SIN llamadas tRPC — solo UI. El padre (ProblemasModal) decide cuándo y
 * cómo persistir los valores vía eceSignosVitales.create.
 *
 * Lógica extraída de apps/web/src/app/(clinical)/ece/signos-vitales/nueva/page.tsx.
 */

import * as React from "react";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Badge } from "@his/ui/components/badge";
import {
  evaluateVitalAlerts,
  type InpatientVitalAlert,
} from "@his/contracts/schemas/inpatient";

// ─── Tipo público (no importar desde @his/trpc para evitar ciclo web→trpc) ──

export interface SignosState {
  presionSistolica: string;
  presionDiastolica: string;
  frecuenciaCardiaca: string;
  frecuenciaRespiratoria: string;
  temperatura: string;
  saturacionO2: string;
  escalaDolor: number;
  pesoKg: string;
  tallaCm: string;
  glucometriaMgdl: string;
}

export const SIGNOS_INITIAL: SignosState = {
  presionSistolica: "",
  presionDiastolica: "",
  frecuenciaCardiaca: "",
  frecuenciaRespiratoria: "",
  temperatura: "",
  saturacionO2: "",
  escalaDolor: 0,
  pesoKg: "",
  tallaCm: "",
  glucometriaMgdl: "",
};

// ─── Rangos (igual que signos-vitales/nueva) ────────────────────────────────

const RANGES = {
  presionSistolica: { min: 60, max: 260, label: "TA Sistólica", unit: "mmHg", step: "1" },
  presionDiastolica: { min: 40, max: 160, label: "TA Diastólica", unit: "mmHg", step: "1" },
  frecuenciaCardiaca: { min: 30, max: 220, label: "Frecuencia cardíaca", unit: "lpm", step: "1" },
  frecuenciaRespiratoria: { min: 4, max: 60, label: "Frecuencia respiratoria", unit: "rpm", step: "1" },
  temperatura: { min: 30, max: 43, label: "Temperatura", unit: "°C", step: "0.1" },
  saturacionO2: { min: 50, max: 100, label: "SpO₂", unit: "%", step: "1" },
  pesoKg: { min: 0.5, max: 300, label: "Peso", unit: "kg", step: "0.1" },
  tallaCm: { min: 30, max: 250, label: "Talla", unit: "cm", step: "1" },
  glucometriaMgdl: { min: 20, max: 600, label: "Glucometría", unit: "mg/dL", step: "1" },
} as const;

type RangeField = keyof typeof RANGES;

const PAIN_LABELS = [
  "Sin dolor", "Muy leve", "Leve", "Leve-mod.", "Moderado",
  "Moderado", "Moderado-int.", "Intenso", "Muy intenso", "Severo", "Máximo",
] as const;

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseOpt(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function validateField(field: RangeField, raw: string): string | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return "Debe ser un número válido";
  const { min, max } = RANGES[field];
  if (n < min || n > max) return `Fuera del rango aceptado (${min}–${max})`;
  return null;
}

function calcImcDisplay(pesoKgRaw: string, tallaCmRaw: string): string | null {
  const peso = parseOpt(pesoKgRaw);
  const talla = parseOpt(tallaCmRaw);
  if (!peso || !talla || talla === 0) return null;
  const tallaM = talla / 100;
  return String(Math.round((peso / (tallaM * tallaM)) * 10) / 10);
}

// ─── Subcomponentes ─────────────────────────────────────────────────────────

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
      role="alert"
      className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
      data-testid="signos-alerta-critica"
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

// ─── Componente principal ────────────────────────────────────────────────────

interface SignosVitalesCaptureProps {
  /** ID único para evitar colisión de htmlFor cuando hay múltiples instancias en la misma página. */
  idPrefix?: string;
  value: SignosState;
  onChange: (next: SignosState) => void;
}

export function SignosVitalesCapture({
  idPrefix = "sv",
  value,
  onChange,
}: SignosVitalesCaptureProps) {
  const [touched, setTouched] = React.useState<Partial<Record<RangeField, boolean>>>({});

  const alerts: InpatientVitalAlert[] = evaluateVitalAlerts({
    systolicBp: parseOpt(value.presionSistolica),
    diastolicBp: parseOpt(value.presionDiastolica),
    heartRate: parseOpt(value.frecuenciaCardiaca),
    respiratoryRate: parseOpt(value.frecuenciaRespiratoria),
    temperatureC: parseOpt(value.temperatura),
    spo2: parseOpt(value.saturacionO2),
    painScale: value.escalaDolor,
  });

  const fieldErrors: Partial<Record<RangeField, string | null>> = {};
  for (const k of Object.keys(RANGES) as RangeField[]) {
    fieldErrors[k] = touched[k] ? validateField(k, value[k] as string) : null;
  }

  const imcDisplay = calcImcDisplay(value.pesoKg, value.tallaCm);

  function setField(field: RangeField, val: string) {
    onChange({ ...value, [field]: val });
  }

  function markTouched(field: RangeField) {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }

  const painColor =
    value.escalaDolor >= 8
      ? "text-destructive font-semibold"
      : value.escalaDolor >= 5
        ? "text-amber-600 dark:text-amber-400"
        : "text-green-700 dark:text-green-400";

  return (
    <div className="space-y-4" data-testid="signos-vitales-capture">
      <AlertaBanner alerts={alerts} />

      {/* Presión arterial */}
      <fieldset className="rounded-lg border p-3 space-y-3">
        <legend className="px-1 text-sm font-semibold text-foreground">Presión arterial</legend>
        <div className="grid grid-cols-2 gap-3">
          {(["presionSistolica", "presionDiastolica"] as const).map((field) => {
            const r = RANGES[field];
            const err = fieldErrors[field];
            const isCrit = alerts.some((a) => a.field === field && a.severity === "critical");
            const inputId = `${idPrefix}-${field}`;
            return (
              <div key={field} className="space-y-1">
                <Label htmlFor={inputId}>
                  {r.label}
                  <span className="ml-1 text-xs text-muted-foreground">({r.unit})</span>
                </Label>
                <div className="relative">
                  <Input
                    id={inputId}
                    inputMode="decimal"
                    type="number"
                    step={r.step}
                    placeholder={`${r.min}–${r.max}`}
                    value={value[field]}
                    onChange={(e) => setField(field, e.target.value)}
                    onBlur={() => markTouched(field)}
                    aria-describedby={err ? `${inputId}-err` : undefined}
                    aria-invalid={!!err}
                    className={isCrit ? "border-destructive focus-visible:ring-destructive" : undefined}
                  />
                  {isCrit && (
                    <Badge variant="destructive" className="absolute -right-1 -top-2.5 text-[10px] px-1 py-0">!</Badge>
                  )}
                </div>
                <FieldError id={`${inputId}-err`} message={err ?? null} />
              </div>
            );
          })}
        </div>
      </fieldset>

      {/* Signos cardiorrespiratorios */}
      <fieldset className="rounded-lg border p-3 space-y-3">
        <legend className="px-1 text-sm font-semibold text-foreground">Signos cardiorrespiratorios</legend>
        <div className="grid grid-cols-2 gap-3">
          {(["frecuenciaCardiaca", "frecuenciaRespiratoria", "temperatura", "saturacionO2"] as const).map((field) => {
            const r = RANGES[field];
            const err = fieldErrors[field];
            const isCrit = alerts.some((a) => a.field === field && a.severity === "critical");
            const inputId = `${idPrefix}-${field}`;
            return (
              <div key={field} className="space-y-1">
                <Label htmlFor={inputId}>
                  {r.label}
                  <span className="ml-1 text-xs text-muted-foreground">({r.unit})</span>
                </Label>
                <div className="relative">
                  <Input
                    id={inputId}
                    inputMode="decimal"
                    type="number"
                    step={r.step}
                    placeholder={`${r.min}–${r.max}`}
                    value={value[field]}
                    onChange={(e) => setField(field, e.target.value)}
                    onBlur={() => markTouched(field)}
                    aria-describedby={err ? `${inputId}-err` : undefined}
                    aria-invalid={!!err}
                    className={isCrit ? "border-destructive focus-visible:ring-destructive" : undefined}
                  />
                  {isCrit && (
                    <Badge variant="destructive" className="absolute -right-1 -top-2.5 text-[10px] px-1 py-0">!</Badge>
                  )}
                </div>
                <FieldError id={`${inputId}-err`} message={err ?? null} />
              </div>
            );
          })}
        </div>
      </fieldset>

      {/* Escala de dolor */}
      <fieldset className="rounded-lg border p-3">
        <legend className="sr-only">Escala de dolor</legend>
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <Label htmlFor={`${idPrefix}-dolor`}>
              Dolor (escala EVA 0–10)
            </Label>
            <span className={`text-sm font-semibold tabular-nums ${painColor}`} aria-live="polite">
              {value.escalaDolor} — {PAIN_LABELS[value.escalaDolor]}
            </span>
          </div>
          <input
            id={`${idPrefix}-dolor`}
            type="range"
            min={0}
            max={10}
            step={1}
            value={value.escalaDolor}
            onChange={(e) => onChange({ ...value, escalaDolor: Number(e.target.value) })}
            className="h-2 w-full cursor-pointer appearance-none rounded-full bg-gradient-to-r from-green-400 via-amber-400 to-red-500 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label="Escala de dolor 0 a 10"
            aria-valuemin={0}
            aria-valuemax={10}
            aria-valuenow={value.escalaDolor}
            aria-valuetext={`${value.escalaDolor} — ${PAIN_LABELS[value.escalaDolor]}`}
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>0</span>
            <span>5</span>
            <span>10</span>
          </div>
        </div>
      </fieldset>

      {/* Datos antropométricos */}
      <fieldset className="rounded-lg border p-3 space-y-3">
        <legend className="px-1 text-sm font-semibold text-foreground">
          Datos antropométricos <span className="font-normal text-muted-foreground">(opcional)</span>
        </legend>
        <div className="grid grid-cols-2 gap-3">
          {(["pesoKg", "tallaCm"] as const).map((field) => {
            const r = RANGES[field];
            const err = fieldErrors[field];
            const inputId = `${idPrefix}-${field}`;
            return (
              <div key={field} className="space-y-1">
                <Label htmlFor={inputId}>
                  {r.label}
                  <span className="ml-1 text-xs text-muted-foreground">({r.unit})</span>
                </Label>
                <Input
                  id={inputId}
                  inputMode="decimal"
                  type="number"
                  step={r.step}
                  placeholder={`${r.min}–${r.max}`}
                  value={value[field]}
                  onChange={(e) => setField(field, e.target.value)}
                  onBlur={() => markTouched(field)}
                  aria-describedby={err ? `${inputId}-err` : undefined}
                  aria-invalid={!!err}
                />
                <FieldError id={`${inputId}-err`} message={err ?? null} />
              </div>
            );
          })}
        </div>
        {imcDisplay && (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            IMC calculado: <span className="font-semibold text-foreground">{imcDisplay} kg/m²</span>
          </p>
        )}
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-glucometriaMgdl`}>
            {RANGES.glucometriaMgdl.label}
            <span className="ml-1 text-xs text-muted-foreground">({RANGES.glucometriaMgdl.unit})</span>
          </Label>
          <Input
            id={`${idPrefix}-glucometriaMgdl`}
            inputMode="decimal"
            type="number"
            step="1"
            placeholder={`${RANGES.glucometriaMgdl.min}–${RANGES.glucometriaMgdl.max}`}
            value={value.glucometriaMgdl}
            onChange={(e) => setField("glucometriaMgdl", e.target.value)}
            onBlur={() => markTouched("glucometriaMgdl")}
            aria-describedby={fieldErrors.glucometriaMgdl ? `${idPrefix}-glucometriaMgdl-err` : undefined}
            aria-invalid={!!fieldErrors.glucometriaMgdl}
            className="max-w-[200px]"
          />
          <FieldError id={`${idPrefix}-glucometriaMgdl-err`} message={fieldErrors.glucometriaMgdl ?? null} />
        </div>
      </fieldset>
    </div>
  );
}
