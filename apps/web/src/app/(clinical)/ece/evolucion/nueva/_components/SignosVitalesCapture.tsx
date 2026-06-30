"use client";

/**
 * Captura de signos vitales (CC-0006 R1/R2/R4.1) — controlled, SIN tRPC.
 *
 *   - Núcleo SIEMPRE visible: Presión arterial (TA sist/diast) + Oxigenación
 *     y signos cardiorrespiratorios (FC, FR, Temperatura, SpO₂, FiO₂). Los 7
 *     son obligatorios (R4.1); `showErrors` los resalta al intentar guardar.
 *   - Bloque colapsable ("+ Ver más / − Ver menos", inicia plegado) desde
 *     Estado neurológico/metabólico hasta Dolor: Glasgow (3 selectores + total
 *     + severidad), glucometría, antropometría (peso kg↔lb, talla m↔ft, IMC,
 *     cintura), balance hídrico, gineco-obstétrico y EVA.
 *   - Gineco-obstétrico solo si sexo femenino (R2); FPP solo si además está en
 *     edad fértil (puedeEmbarazo).
 *
 * SignosState y los rangos/factores/cálculos viven en módulos centralizados
 * (`_lib/types`, `lib/evolucion/signos-vitales`) para tropicalizar sin tocar UI.
 */

import * as React from "react";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Badge } from "@his/ui/components/badge";
import { Switch } from "@his/ui/components/switch";
import { SIGNOS_EMPTY, tieneSignos, type SignosState } from "../_lib/types";
import {
  validarRango,
  computeAlertasVitales,
  kgALb,
  lbAKg,
  mAFt,
  ftAM,
  imcFrom,
  imcClasificacion,
  ictFrom,
  ictClasificacion,
  glasgowTotal,
  glasgowSeveridad,
  fppNaegele,
  gestacionDesdeFur,
  esFemenino,
  puedeEmbarazo,
  evaLabel,
  GLASGOW_OCULAR,
  GLASGOW_VERBAL,
  GLASGOW_MOTORA,
  type VitalRangeKey,
  type ImcClaseKey,
  type IctClaseKey,
} from "../../../../../../lib/evolucion/signos-vitales";

// Compat: el resto del flujo importa SIGNOS_INITIAL desde aquí.
export const SIGNOS_INITIAL: SignosState = SIGNOS_EMPTY;
export type { SignosState };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseOpt(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

const inputClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

const IMC_COLOR: Record<ImcClaseKey, string> = {
  bajo: "text-amber-600 dark:text-amber-400",
  normal: "text-green-700 dark:text-green-400",
  sobrepeso: "text-amber-600 dark:text-amber-400",
  obesidad: "text-destructive",
};

const ICT_COLOR: Record<IctClaseKey, string> = {
  saludable: "text-green-700 dark:text-green-400",
  riesgoAumentado: "text-amber-600 dark:text-amber-400",
  riesgoAlto: "text-destructive",
};

// ─── Subcomponentes ─────────────────────────────────────────────────────────

function CalcBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-sm" aria-live="polite">
      {children}
    </div>
  );
}

interface VitalFieldProps {
  field: VitalRangeKey;
  inputId: string;
  label: string;
  unit: string;
  step?: string;
  placeholder?: string;
  required?: boolean;
  value: string;
  onChange: (val: string) => void;
  showErrors: boolean;
  critico?: boolean;
}

/** Input numérico de signo vital con validación de rango (y obligatorio si aplica). */
function VitalField({
  field,
  inputId,
  label,
  unit,
  step = "1",
  placeholder,
  required = false,
  value,
  onChange,
  showErrors,
  critico = false,
}: VitalFieldProps) {
  const [touched, setTouched] = React.useState(false);
  const rangeErr = validarRango(field, value);
  const emptyReq = required && value.trim() === "";
  const show = showErrors || touched;
  const errMsg = show ? (emptyReq ? "Obligatorio" : rangeErr) : null;
  const invalid = !!errMsg || critico;

  return (
    <div className="space-y-1">
      <Label htmlFor={inputId}>
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
        <span className="ml-1 text-xs text-muted-foreground">({unit})</span>
      </Label>
      <div className="relative">
        <Input
          id={inputId}
          inputMode="decimal"
          type="number"
          step={step}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setTouched(true)}
          aria-describedby={errMsg ? `${inputId}-err` : undefined}
          aria-invalid={invalid || undefined}
          className={invalid ? "border-destructive focus-visible:ring-destructive" : undefined}
        />
        {critico && (
          <Badge variant="destructive" className="absolute -right-1 -top-2.5 px-1 py-0 text-[10px]">
            !
          </Badge>
        )}
      </div>
      {errMsg && (
        <p id={`${inputId}-err`} role="alert" className="text-xs text-destructive">
          {errMsg}
        </p>
      )}
    </div>
  );
}

// ─── Componente principal ────────────────────────────────────────────────────

interface SignosVitalesCaptureProps {
  idPrefix?: string;
  value: SignosState;
  onChange: (next: SignosState) => void;
  /** Sexo biológico del paciente ('F' habilita gineco-obstétrico, R2). */
  sexo?: string | null;
  /** Edad en años (alimenta FPP "puede estar embarazada", R2). */
  edad?: number | null;
  /** Fuerza el resaltado de errores (al intentar guardar el modal, R4.1). */
  showErrors?: boolean;
}

export function SignosVitalesCapture({
  idPrefix = "sv",
  value,
  onChange,
  sexo = null,
  edad = null,
  showErrors = false,
}: SignosVitalesCaptureProps) {
  const [expanded, setExpanded] = React.useState(false);
  // §10.4 — el cálculo de FPP se activa con el interruptor (no se persiste: es
  // un derivado de la FUR, que sí se guarda).
  const [fppOn, setFppOn] = React.useState(false);

  function setField(field: keyof SignosState, val: string | number) {
    onChange({ ...value, [field]: val });
  }

  // Conversión bidireccional peso/talla.
  function onPesoKg(raw: string) {
    const n = parseOpt(raw);
    onChange({ ...value, pesoKg: raw, pesoLb: n != null ? kgALb(n) : "" });
  }
  function onPesoLb(raw: string) {
    const n = parseOpt(raw);
    onChange({ ...value, pesoLb: raw, pesoKg: n != null ? lbAKg(n) : "" });
  }
  function onTallaM(raw: string) {
    const n = parseOpt(raw);
    onChange({ ...value, tallaM: raw, tallaFt: n != null ? mAFt(n) : "" });
  }
  function onTallaFt(raw: string) {
    const n = parseOpt(raw);
    onChange({ ...value, tallaFt: raw, tallaM: n != null ? ftAM(n) : "" });
  }

  // Alertas clínicas en vivo (R1.6).
  const alertas = computeAlertasVitales({
    presionSistolica: parseOpt(value.presionSistolica),
    presionDiastolica: parseOpt(value.presionDiastolica),
    frecuenciaCardiaca: parseOpt(value.frecuenciaCardiaca),
    frecuenciaRespiratoria: parseOpt(value.frecuenciaRespiratoria),
    temperatura: parseOpt(value.temperatura),
    saturacionO2: parseOpt(value.saturacionO2),
    dolorEva: value.escalaDolor,
    glucometriaMgdl: parseOpt(value.glucometriaMgdl),
    glasgowOcular: parseOpt(value.glasgowOcular),
    glasgowVerbal: parseOpt(value.glasgowVerbal),
    glasgowMotora: parseOpt(value.glasgowMotora),
    diuresisHoraria: parseOpt(value.diuresisHoraria),
    pesoKg: parseOpt(value.pesoKg),
  });

  // Glasgow total + severidad.
  const gTotal = glasgowTotal(
    parseOpt(value.glasgowOcular),
    parseOpt(value.glasgowVerbal),
    parseOpt(value.glasgowMotora),
  );

  // IMC.
  const pesoKgN = parseOpt(value.pesoKg);
  const tallaMN = parseOpt(value.tallaM);
  const imc = pesoKgN != null && tallaMN != null && tallaMN > 0 ? imcFrom(pesoKgN, tallaMN) : null;
  const imcClase = imc != null ? imcClasificacion(imc) : null;

  // Índice cintura-talla (§10.7).
  const cinturaN = parseOpt(value.perimetroCintura);
  const ict = cinturaN != null && tallaMN != null && tallaMN > 0 ? ictFrom(cinturaN, tallaMN) : null;
  const ictClase = ict != null ? ictClasificacion(ict) : null;

  // FPP / gestación (solo si puede embarazo, y con el interruptor activo).
  const mostrarFpp = puedeEmbarazo(sexo, edad);
  const fpp = mostrarFpp && fppOn ? fppNaegele(value.fechaUltimaRegla) : null;
  const gestacion = mostrarFpp && fppOn ? gestacionDesdeFur(value.fechaUltimaRegla) : null;

  const mostrarGineco = esFemenino(sexo);
  // §10.4 — la fila de alertas distingue "sin alertas" (verde) de "sin datos".
  const hayDatos = tieneSignos(value);

  return (
    <div className="space-y-4" data-testid="signos-vitales-capture">
      {/* §10.4 — fila de alertas (#alertRow): 3 estados recalculados en vivo. */}
      <div
        role={alertas.length > 0 ? "alert" : "status"}
        data-testid="signos-alertas"
        className={
          alertas.length > 0
            ? "flex flex-wrap items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            : hayDatos
              ? "flex items-center gap-2 rounded-md border border-green-600/40 bg-green-600/10 px-3 py-2 text-sm font-medium text-green-700 dark:text-green-400"
              : "flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground"
        }
      >
        {alertas.length > 0 ? (
          <>
            <Badge variant="destructive">Alertas</Badge>
            {alertas.map((a) => (
              <span key={a} className="font-medium">
                {a}
              </span>
            ))}
          </>
        ) : hayDatos ? (
          <>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="h-4 w-4 shrink-0">
              <circle cx="12" cy="12" r="9" />
              <path d="M8.5 12.5 11 15l4.5-5" />
            </svg>
            Sin alertas críticas
          </>
        ) : (
          "Ingrese signos para evaluar alertas críticas automáticamente."
        )}
      </div>

      {/* ── Núcleo (siempre visible) ──────────────────────────────────────── */}
      <fieldset className="space-y-3 rounded-lg border p-3">
        <legend className="px-1 text-sm font-semibold text-foreground">Presión arterial</legend>
        <div className="grid grid-cols-2 gap-3">
          <VitalField
            field="presionSistolica"
            inputId={`${idPrefix}-presionSistolica`}
            label="TA Sistólica"
            unit="mmHg"
            placeholder="60–260"
            required
            value={value.presionSistolica}
            onChange={(v) => setField("presionSistolica", v)}
            showErrors={showErrors}
            critico={alertas.includes("Crisis hipertensiva") || alertas.includes("Hipotensión")}
          />
          <VitalField
            field="presionDiastolica"
            inputId={`${idPrefix}-presionDiastolica`}
            label="TA Diastólica"
            unit="mmHg"
            placeholder="40–160"
            required
            value={value.presionDiastolica}
            onChange={(v) => setField("presionDiastolica", v)}
            showErrors={showErrors}
            critico={alertas.includes("Crisis hipertensiva")}
          />
        </div>
      </fieldset>

      <fieldset className="space-y-3 rounded-lg border p-3">
        <legend className="px-1 text-sm font-semibold text-foreground">
          Oxigenación y signos cardiorrespiratorios
        </legend>
        <div className="grid grid-cols-2 gap-3">
          <VitalField
            field="frecuenciaCardiaca"
            inputId={`${idPrefix}-frecuenciaCardiaca`}
            label="Frecuencia cardíaca"
            unit="lpm"
            placeholder="30–220"
            required
            value={value.frecuenciaCardiaca}
            onChange={(v) => setField("frecuenciaCardiaca", v)}
            showErrors={showErrors}
            critico={alertas.includes("Taquicardia") || alertas.includes("Bradicardia")}
          />
          <VitalField
            field="frecuenciaRespiratoria"
            inputId={`${idPrefix}-frecuenciaRespiratoria`}
            label="Frecuencia respiratoria"
            unit="rpm"
            placeholder="4–60"
            required
            value={value.frecuenciaRespiratoria}
            onChange={(v) => setField("frecuenciaRespiratoria", v)}
            showErrors={showErrors}
            critico={alertas.includes("Taquipnea") || alertas.includes("Bradipnea")}
          />
          <VitalField
            field="temperatura"
            inputId={`${idPrefix}-temperatura`}
            label="Temperatura"
            unit="°C"
            step="0.1"
            placeholder="30–43"
            required
            value={value.temperatura}
            onChange={(v) => setField("temperatura", v)}
            showErrors={showErrors}
            critico={alertas.includes("Fiebre alta") || alertas.includes("Hipotermia")}
          />
          <VitalField
            field="saturacionO2"
            inputId={`${idPrefix}-saturacionO2`}
            label="SpO₂"
            unit="%"
            placeholder="50–100"
            required
            value={value.saturacionO2}
            onChange={(v) => setField("saturacionO2", v)}
            showErrors={showErrors}
            critico={alertas.includes("SpO₂ baja")}
          />
          <VitalField
            field="fio2"
            inputId={`${idPrefix}-fio2`}
            label="FiO₂"
            unit="%"
            placeholder="21–100"
            required
            value={value.fio2}
            onChange={(v) => setField("fio2", v)}
            showErrors={showErrors}
          />
        </div>
      </fieldset>

      {/* ── Toggle Ver más / Ver menos ────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        aria-controls={`${idPrefix}-vmore`}
        className="text-sm font-medium text-primary hover:underline"
      >
        {expanded ? "− Ver menos" : "+ Ver más"}
      </button>

      {/* ── Bloque colapsable (inicia plegado) ────────────────────────────── */}
      <div id={`${idPrefix}-vmore`} className={expanded ? "space-y-4" : "hidden"}>
        {/* Estado neurológico y metabólico */}
        <fieldset className="space-y-3 rounded-lg border p-3">
          <legend className="px-1 text-sm font-semibold text-foreground">
            Estado neurológico y metabólico
          </legend>
          <Label>Escala de Glasgow</Label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {(
              [
                { key: "glasgowOcular", label: "Apertura ocular", opts: GLASGOW_OCULAR },
                { key: "glasgowVerbal", label: "Respuesta verbal", opts: GLASGOW_VERBAL },
                { key: "glasgowMotora", label: "Respuesta motora", opts: GLASGOW_MOTORA },
              ] as const
            ).map(({ key, label, opts }) => {
              const selId = `${idPrefix}-${key}`;
              return (
                <div key={key} className="space-y-1">
                  <Label htmlFor={selId} className="text-xs text-muted-foreground">
                    {label}
                  </Label>
                  <select
                    id={selId}
                    value={value[key]}
                    onChange={(e) => setField(key, e.target.value)}
                    className={inputClass}
                  >
                    <option value="">—</option>
                    {opts.map((o) => (
                      <option key={o.valor} value={String(o.valor)}>
                        {o.valor} · {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
          <div className="space-y-1">
            <Label>Total Glasgow</Label>
            <CalcBox>
              {gTotal != null ? (
                <span className="font-semibold">
                  {gTotal}/15 —{" "}
                  <span
                    className={
                      gTotal >= 13
                        ? "text-green-700 dark:text-green-400"
                        : gTotal >= 9
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-destructive"
                    }
                  >
                    {glasgowSeveridad(gTotal)}
                  </span>
                </span>
              ) : (
                <span className="text-muted-foreground">Apertura ocular + verbal + motora.</span>
              )}
            </CalcBox>
          </div>
          <div className="max-w-[220px]">
            <VitalField
              field="glucometriaMgdl"
              inputId={`${idPrefix}-glucometriaMgdl`}
              label="Glucometría capilar"
              unit="mg/dL"
              placeholder="10–900"
              value={value.glucometriaMgdl}
              onChange={(v) => setField("glucometriaMgdl", v)}
              showErrors={showErrors}
              critico={alertas.includes("Hipoglucemia") || alertas.includes("Hiperglucemia")}
            />
          </div>
        </fieldset>

        {/* Antropometría */}
        <fieldset className="space-y-3 rounded-lg border p-3">
          <legend className="px-1 text-sm font-semibold text-foreground">Antropometría</legend>
          <div className="grid grid-cols-2 gap-3">
            <VitalField
              field="pesoKg"
              inputId={`${idPrefix}-pesoKg`}
              label="Peso"
              unit="kg"
              step="0.1"
              placeholder="kg"
              value={value.pesoKg}
              onChange={onPesoKg}
              showErrors={showErrors}
            />
            <VitalField
              field="pesoLb"
              inputId={`${idPrefix}-pesoLb`}
              label="Peso"
              unit="lb"
              step="0.1"
              placeholder="lb"
              value={value.pesoLb}
              onChange={onPesoLb}
              showErrors={showErrors}
            />
            <VitalField
              field="tallaM"
              inputId={`${idPrefix}-tallaM`}
              label="Talla"
              unit="m"
              step="0.01"
              placeholder="m"
              value={value.tallaM}
              onChange={onTallaM}
              showErrors={showErrors}
            />
            <VitalField
              field="tallaFt"
              inputId={`${idPrefix}-tallaFt`}
              label="Talla"
              unit="ft"
              step="0.01"
              placeholder="ft"
              value={value.tallaFt}
              onChange={onTallaFt}
              showErrors={showErrors}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>IMC (calculado)</Label>
              <CalcBox>
                {imc != null && imcClase ? (
                  <span className="font-semibold">
                    {imc.toFixed(1)} kg/m² —{" "}
                    <span className={IMC_COLOR[imcClase.key]}>{imcClase.label}</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">Se calcula con peso (kg) y talla (m).</span>
                )}
              </CalcBox>
            </div>
            <div className="space-y-1">
              <Label>Índice cintura-talla (calculado)</Label>
              <CalcBox>
                {ict != null && ictClase ? (
                  <span className="font-semibold">
                    {ict.toFixed(2)} —{" "}
                    <span className={ICT_COLOR[ictClase.key]}>{ictClase.label}</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">Se calcula con cintura (cm) y talla (m).</span>
                )}
              </CalcBox>
            </div>
          </div>
          <div className="max-w-[220px]">
            <VitalField
              field="perimetroCintura"
              inputId={`${idPrefix}-perimetroCintura`}
              label="Perímetro de cintura"
              unit="cm"
              placeholder="30–250"
              value={value.perimetroCintura}
              onChange={(v) => setField("perimetroCintura", v)}
              showErrors={showErrors}
            />
          </div>
        </fieldset>

        {/* Balance hídrico */}
        <fieldset className="space-y-3 rounded-lg border p-3">
          <legend className="px-1 text-sm font-semibold text-foreground">Balance hídrico</legend>
          <div className="grid grid-cols-2 gap-3">
            <VitalField
              field="balanceHidrico"
              inputId={`${idPrefix}-balanceHidrico`}
              label="Balance hídrico"
              unit="mL"
              placeholder="± mL"
              value={value.balanceHidrico}
              onChange={(v) => setField("balanceHidrico", v)}
              showErrors={showErrors}
            />
            <VitalField
              field="diuresisHoraria"
              inputId={`${idPrefix}-diuresisHoraria`}
              label="Diuresis horaria"
              unit="mL/h"
              placeholder="0–2000"
              value={value.diuresisHoraria}
              onChange={(v) => setField("diuresisHoraria", v)}
              showErrors={showErrors}
              critico={alertas.includes("Oliguria")}
            />
          </div>
        </fieldset>

        {/* Gineco-obstétrico (solo femenino) */}
        {mostrarGineco && (
          <fieldset className="space-y-3 rounded-lg border p-3">
            <legend className="flex items-center gap-2 px-1 text-sm font-semibold text-foreground">
              Gineco-obstétrico
              <span className="inline-flex items-center rounded-md border border-[#fecaca] bg-[#fee2e2] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#dc2626] dark:border-[#5a2326] dark:bg-[#2a1314] dark:text-[#f87171]">
                Obligatorio
              </span>
            </legend>
            <div className={`grid gap-3 ${mostrarFpp ? "grid-cols-2" : "grid-cols-1"}`}>
              <div className="space-y-1">
                <Label htmlFor={`${idPrefix}-fechaUltimaRegla`}>Fecha de última regla (FUR)</Label>
                <Input
                  id={`${idPrefix}-fechaUltimaRegla`}
                  type="date"
                  value={value.fechaUltimaRegla}
                  onChange={(e) => setField("fechaUltimaRegla", e.target.value)}
                />
              </div>
              {mostrarFpp && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="mb-0">
                      Fecha probable de parto{" "}
                      <span className="text-xs font-normal text-muted-foreground">(Naegele)</span>
                    </Label>
                    <Switch
                      checked={fppOn}
                      onCheckedChange={setFppOn}
                      aria-label="Calcular fecha probable de parto"
                    />
                  </div>
                  <CalcBox>
                    {!fppOn ? (
                      <span className="text-muted-foreground">Active el interruptor para calcular la FPP.</span>
                    ) : fpp ? (
                      <span className="font-semibold">
                        {fpp.toLocaleDateString("es-SV", { day: "2-digit", month: "2-digit", year: "numeric" })}
                        {gestacion && (
                          <span className="ml-2 font-normal text-muted-foreground">· {gestacion.label}</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Registre la FUR para calcular (Naegele).</span>
                    )}
                  </CalcBox>
                </div>
              )}
            </div>
            <Label>
              Fórmula obstétrica (G · P · P · A · V)
              <span className="ml-0.5 text-destructive">*</span>
            </Label>
            <div className="grid grid-cols-5 gap-2">
              {(
                [
                  { key: "gestaG", letra: "G", desc: "Gestas" },
                  { key: "partoTermino", letra: "P", desc: "Término" },
                  { key: "partoPretermino", letra: "P", desc: "Pretérm." },
                  { key: "abortos", letra: "A", desc: "Abortos" },
                  { key: "vivos", letra: "V", desc: "Vivos" },
                ] as const
              ).map(({ key, letra, desc }) => {
                const gid = `${idPrefix}-${key}`;
                const faltante = showErrors && value[key].trim() === "";
                return (
                  <div key={key} className="space-y-1">
                    <Label htmlFor={gid} className="text-xs">
                      <span className="font-bold">{letra}</span>{" "}
                      <span className="text-muted-foreground">{desc}</span>
                    </Label>
                    <Input
                      id={gid}
                      inputMode="numeric"
                      type="number"
                      step="1"
                      placeholder="0"
                      value={value[key]}
                      onChange={(e) => setField(key, e.target.value)}
                      aria-invalid={faltante || undefined}
                      className={faltante ? "border-destructive focus-visible:ring-destructive" : undefined}
                    />
                  </div>
                );
              })}
            </div>
          </fieldset>
        )}

        {/* Dolor (EVA) */}
        <fieldset className="rounded-lg border p-3">
          <legend className="sr-only">Escala de dolor</legend>
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <Label htmlFor={`${idPrefix}-dolor`}>Dolor (escala EVA 0–10)</Label>
              <span
                className={`text-sm font-semibold tabular-nums ${
                  value.escalaDolor >= 7
                    ? "text-destructive"
                    : value.escalaDolor >= 4
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-green-700 dark:text-green-400"
                }`}
                aria-live="polite"
              >
                {value.escalaDolor} — {evaLabel(value.escalaDolor)}
              </span>
            </div>
            <input
              id={`${idPrefix}-dolor`}
              type="range"
              min={0}
              max={10}
              step={1}
              value={value.escalaDolor}
              onChange={(e) => setField("escalaDolor", Number(e.target.value))}
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-gradient-to-r from-green-400 via-amber-400 to-red-500 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label="Escala de dolor 0 a 10"
              aria-valuemin={0}
              aria-valuemax={10}
              aria-valuenow={value.escalaDolor}
              aria-valuetext={`${value.escalaDolor} — ${evaLabel(value.escalaDolor)}`}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>0</span>
              <span>5</span>
              <span>10</span>
            </div>
          </div>
        </fieldset>
      </div>
    </div>
  );
}
