"use client";

/**
 * SignosVitalesModal — RF-06.
 * Modal de captura de signos vitales con calculadoras:
 * Glasgow, IMC, ICT, conversores kg↔lb / m↔ft, FPP Naegele, EVA.
 * Campos obligatorios: TA sist/diast, FC, FR, Temp, SpO₂, FiO₂.
 */

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@his/ui/components/dialog";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import {
  calcImc,
  imcClasificacion,
  calcIct,
  ictClasificacion,
  calcularFppEg,
  parseNum,
} from "./utils";

export interface VitalesState {
  sis: string;
  dia: string;
  fc: string;
  fr: string;
  temp: string;
  spo2: string;
  fio2: string;
  gcsO: string;
  gcsV: string;
  gcsM: string;
  gluco: string;
  pesoKg: string;
  pesoLb: string;
  tallaM: string;
  tallaFt: string;
  cintura: string;
  balance: string;
  diuresis: string;
  fur: string;
  goG: string;
  goPt: string;
  goPp: string;
  goA: string;
  goV: string;
  dolor: string;
}

export const VITALES_INITIAL: VitalesState = {
  sis: "", dia: "", fc: "", fr: "", temp: "", spo2: "", fio2: "",
  gcsO: "", gcsV: "", gcsM: "", gluco: "",
  pesoKg: "", pesoLb: "", tallaM: "", tallaFt: "",
  cintura: "", balance: "", diuresis: "",
  fur: "", goG: "", goPt: "", goPp: "", goA: "", goV: "",
  dolor: "0",
};

interface SignosVitalesModalProps {
  open: boolean;
  onClose: () => void;
  value: VitalesState;
  onSave: (v: VitalesState) => void;
  isFemenina: boolean;
}

const PAIN_LABELS: [number, string, string][] = [
  [0, "Sin dolor", "#16a34a"],
  [3, "Dolor leve", "#65a30d"],
  [6, "Dolor moderado", "#ea580c"],
  [9, "Dolor intenso", "#dc2626"],
  [10, "Dolor máximo", "#b91c1c"],
];

function getPainLabel(v: number): { label: string; color: string } {
  let lbl = "Sin dolor", col = "#16a34a";
  for (const [mx, t, c] of PAIN_LABELS) {
    if (v <= mx) { lbl = t; col = c; break; }
  }
  return { label: lbl, color: col };
}

function computeAlerts(v: VitalesState): string[] {
  const n = (k: keyof VitalesState) => {
    const val = v[k];
    if (val === "" || val == null || isNaN(Number(val))) return null;
    return Number(val);
  };
  const sis = n("sis"), dia = n("dia"), fc = n("fc"), fr = n("fr"),
    t = n("temp"), s = n("spo2"), d = n("dolor"),
    gluco = n("gluco"), diur = n("diuresis"), pesoKg = n("pesoKg"),
    gO = n("gcsO"), gV = n("gcsV"), gM = n("gcsM");
  const a: string[] = [];
  if (s != null && s < 90) a.push("SpO₂ baja");
  if ((sis != null && sis >= 180) || (dia != null && dia >= 110)) a.push("Crisis hipertensiva");
  if (sis != null && sis < 90) a.push("Hipotensión");
  if (t != null && t >= 39.5) a.push("Fiebre alta");
  if (t != null && t <= 35) a.push("Hipotermia");
  if (fc != null && fc > 120) a.push("Taquicardia");
  if (fc != null && fc < 50) a.push("Bradicardia");
  if (fr != null && fr > 24) a.push("Taquipnea");
  if (fr != null && fr < 10) a.push("Bradipnea");
  if (gluco != null && gluco < 70) a.push("Hipoglucemia");
  if (gluco != null && gluco >= 250) a.push("Hiperglucemia");
  if (gO != null && gV != null && gM != null && gO + gV + gM <= 8) a.push("Glasgow ≤8");
  if (diur != null && pesoKg != null && pesoKg > 0 && diur < 0.5 * pesoKg) a.push("Oliguria");
  if (d != null && d >= 7) a.push("Dolor intenso");
  return a;
}

export function SignosVitalesModal({
  open, onClose, value, onSave, isFemenina,
}: SignosVitalesModalProps) {
  const [draft, setDraft] = React.useState<VitalesState>(VITALES_INITIAL);
  const [errors, setErrors] = React.useState<Partial<Record<keyof VitalesState, string>>>({});
  const [moreOpen, setMoreOpen] = React.useState(false);

  React.useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  function set(k: keyof VitalesState, v: string) {
    setDraft((d) => ({ ...d, [k]: v }));
  }

  function syncPeso(from: "kg" | "lb") {
    if (from === "kg") {
      const kg = parseFloat(draft.pesoKg);
      set("pesoLb", isNaN(kg) ? "" : (kg * 2.20462).toFixed(1));
    } else {
      const lb = parseFloat(draft.pesoLb);
      set("pesoKg", isNaN(lb) ? "" : (lb / 2.20462).toFixed(1));
    }
  }

  function syncTalla(from: "m" | "ft") {
    if (from === "m") {
      const m = parseFloat(draft.tallaM);
      set("tallaFt", isNaN(m) ? "" : (m * 3.28084).toFixed(2));
    } else {
      const ft = parseFloat(draft.tallaFt);
      set("tallaM", isNaN(ft) ? "" : (ft / 3.28084).toFixed(2));
    }
  }

  const imcVal = calcImc(parseNum(draft.pesoKg) ?? null, parseNum(draft.tallaM) ?? null);
  const ictVal = calcIct(parseNum(draft.cintura) ?? null, parseNum(draft.tallaM) ?? null);
  const gcsO = parseNum(draft.gcsO), gcsV = parseNum(draft.gcsV), gcsM = parseNum(draft.gcsM);
  const gcsTotal = gcsO != null && gcsV != null && gcsM != null ? gcsO + gcsV + gcsM : null;
  const fppData = calcularFppEg(draft.fur);
  const painNum = parseInt(draft.dolor, 10) || 0;
  const { label: painLabel, color: painColor } = getPainLabel(painNum);
  const alerts = computeAlerts(draft);
  const anyFilled = Object.entries(draft).some(
    ([k, v]) => k !== "dolor" && v !== "" && v != null,
  ) || painNum > 0;

  function validate(): boolean {
    const req: Array<keyof VitalesState> = ["sis", "dia", "fc", "fr", "temp", "spo2", "fio2"];
    const errs: Partial<Record<keyof VitalesState, string>> = {};
    for (const k of req) {
      if (!draft[k].trim()) errs[k] = "Obligatorio";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleSave() {
    if (!validate()) return;
    onSave(draft);
    onClose();
  }

  function field(
    id: keyof VitalesState,
    label: string,
    unit: string,
    required = false,
    opts?: { type?: string; onBlur?: () => void; onChange?: (v: string) => void },
  ) {
    return (
      <div>
        <Label htmlFor={`sv-${id}`} className="mb-1 block text-xs">
          {label}{" "}
          {required && <span className="font-bold text-destructive">*</span>}{" "}
          <span className="font-normal text-muted-foreground">({unit})</span>
        </Label>
        <Input
          id={`sv-${id}`}
          inputMode="decimal"
          type={opts?.type ?? "number"}
          value={draft[id]}
          onChange={(e) => {
            if (opts?.onChange) {
              opts.onChange(e.target.value);
            } else {
              set(id, e.target.value);
            }
          }}
          onBlur={opts?.onBlur}
          className={errors[id] ? "border-destructive" : ""}
        />
        {errors[id] && (
          <p className="mt-0.5 text-xs text-destructive">{errors[id]}</p>
        )}
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Signos vitales</DialogTitle>
        </DialogHeader>

        <div className="max-h-[64vh] space-y-4 overflow-y-auto pr-1">
          {/* Alertas */}
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2.5 text-sm">
            {alerts.length > 0 ? (
              alerts.map((a) => (
                <span
                  key={a}
                  className="inline-flex items-center gap-1 rounded-md bg-destructive px-2 py-0.5 text-xs font-bold text-destructive-foreground"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} className="h-3 w-3">
                    <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
                  </svg>
                  {a}
                </span>
              ))
            ) : anyFilled ? (
              <span className="flex items-center gap-1 text-xs font-semibold text-success">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                Sin alertas críticas
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">
                Ingrese signos para evaluar alertas críticas.
              </span>
            )}
          </div>

          {/* Presión arterial */}
          <fieldset className="rounded-md border border-border p-3">
            <legend className="mb-2 border-b border-border pb-1 text-sm font-bold">Presión arterial</legend>
            <div className="grid grid-cols-2 gap-3">
              {field("sis", "TA Sistólica", "mmHg", true)}
              {field("dia", "TA Diastólica", "mmHg", true)}
            </div>
          </fieldset>

          {/* Cardiorrespiratorios */}
          <fieldset className="rounded-md border border-border p-3">
            <legend className="mb-2 border-b border-border pb-1 text-sm font-bold">
              Oxigenación y cardiorrespiratorios
            </legend>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {field("fc", "FC", "lpm", true)}
              {field("fr", "FR", "rpm", true)}
              {field("temp", "Temperatura", "°C", true)}
              {field("spo2", "SpO₂", "%", true)}
              {field("fio2", "FiO₂", "%", true)}
            </div>
          </fieldset>

          {/* Dolor EVA */}
          <fieldset className="rounded-md border border-border p-3">
            <div className="mb-1 flex items-baseline justify-between">
              <Label className="text-xs">Dolor (escala EVA 0–10)</Label>
              <span className="text-xs font-bold" style={{ color: painColor }}>
                {painNum} — {painLabel}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={10}
              step={1}
              value={draft.dolor}
              onChange={(e) => set("dolor", e.target.value)}
              className="h-2 w-full cursor-pointer rounded-full"
              style={{
                background: `linear-gradient(90deg, #22c55e, #eab308, #ef4444)`,
              }}
            />
            <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
              {Array.from({ length: 11 }, (_, i) => (
                <span key={i}>{i}</span>
              ))}
            </div>
          </fieldset>

          {/* Ver más — Neurológico + Antropometría + Balance + Gineco */}
          <button
            type="button"
            onClick={() => setMoreOpen((m) => !m)}
            className="flex items-center gap-1.5 rounded-md border border-dashed border-input bg-surface-1 px-3 py-2 text-sm font-semibold transition-colors hover:border-ring hover:text-primary"
          >
            {moreOpen ? "− Ver menos" : "+ Ver más"}
          </button>

          {moreOpen && (
            <>
              {/* Glasgow */}
              <fieldset className="rounded-md border border-border p-3">
                <legend className="mb-2 border-b border-border pb-1 text-sm font-bold">
                  Estado neurológico y metabólico
                </legend>
                <Label className="mb-2 block text-xs">Escala de Glasgow</Label>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <span className="mb-1 block text-[11px] font-semibold text-muted-foreground">Apertura ocular</span>
                    <select
                      className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                      value={draft.gcsO}
                      onChange={(e) => set("gcsO", e.target.value)}
                    >
                      <option value="">—</option>
                      <option value="4">4 · Espontánea</option>
                      <option value="3">3 · A la voz</option>
                      <option value="2">2 · Al dolor</option>
                      <option value="1">1 · Ninguna</option>
                    </select>
                  </div>
                  <div>
                    <span className="mb-1 block text-[11px] font-semibold text-muted-foreground">Resp. verbal</span>
                    <select
                      className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                      value={draft.gcsV}
                      onChange={(e) => set("gcsV", e.target.value)}
                    >
                      <option value="">—</option>
                      <option value="5">5 · Orientada</option>
                      <option value="4">4 · Confusa</option>
                      <option value="3">3 · Palabras inaprop.</option>
                      <option value="2">2 · Sonidos incomp.</option>
                      <option value="1">1 · Ninguna</option>
                    </select>
                  </div>
                  <div>
                    <span className="mb-1 block text-[11px] font-semibold text-muted-foreground">Resp. motora</span>
                    <select
                      className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                      value={draft.gcsM}
                      onChange={(e) => set("gcsM", e.target.value)}
                    >
                      <option value="">—</option>
                      <option value="6">6 · Obedece órdenes</option>
                      <option value="5">5 · Localiza dolor</option>
                      <option value="4">4 · Retira al dolor</option>
                      <option value="3">3 · Flexión anormal</option>
                      <option value="2">2 · Extensión anormal</option>
                      <option value="1">1 · Ninguna</option>
                    </select>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm">
                  {gcsTotal != null ? (
                    <span>
                      <strong>{gcsTotal}/15</strong>{" "}
                      <span style={{ color: gcsTotal >= 13 ? "#16a34a" : gcsTotal >= 9 ? "#ea580c" : "#dc2626", fontWeight: 700 }}>
                        {gcsTotal >= 13 ? "Leve" : gcsTotal >= 9 ? "Moderado" : "Grave"}
                      </span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-xs">Seleccione las 3 respuestas.</span>
                  )}
                </div>
                <div className="mt-3">
                  {field("gluco", "Glucometría capilar", "mg/dL")}
                </div>
              </fieldset>

              {/* Antropometría */}
              <fieldset className="rounded-md border border-border p-3">
                <legend className="mb-2 border-b border-border pb-1 text-sm font-bold">Antropometría</legend>
                <div className="grid grid-cols-2 gap-3">
                  {field("pesoKg", "Peso", "kg", false, {
                    onBlur: () => syncPeso("kg"),
                    onChange: (v) => set("pesoKg", v),
                  })}
                  {field("pesoLb", "Peso", "lb", false, {
                    onBlur: () => syncPeso("lb"),
                    onChange: (v) => set("pesoLb", v),
                  })}
                  {field("tallaM", "Talla", "m", false, {
                    onBlur: () => syncTalla("m"),
                    onChange: (v) => set("tallaM", v),
                  })}
                  {field("tallaFt", "Talla", "ft", false, {
                    onBlur: () => syncTalla("ft"),
                    onChange: (v) => set("tallaFt", v),
                  })}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <Label className="mb-1 block text-xs">IMC (calculado)</Label>
                    <div className="flex min-h-[38px] items-center rounded-md border border-border bg-surface-2 px-3 text-sm">
                      {imcVal ? (
                        <>
                          <strong>{imcVal.toFixed(1)}</strong>&nbsp;kg/m²&nbsp;·&nbsp;
                          <span style={{ color: imcClasificacion(imcVal).color, fontWeight: 700 }}>
                            {imcClasificacion(imcVal).label}
                          </span>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">Peso(kg) y talla(m) requeridos.</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <Label className="mb-1 block text-xs">Índice cintura-talla</Label>
                    <div className="flex min-h-[38px] items-center rounded-md border border-border bg-surface-2 px-3 text-sm">
                      {ictVal ? (
                        <>
                          <strong>{ictVal.toFixed(2)}</strong>&nbsp;·&nbsp;
                          <span style={{ color: ictClasificacion(ictVal).color, fontWeight: 700 }}>
                            {ictClasificacion(ictVal).label}
                          </span>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">Cintura(cm) y talla(m) requeridos.</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-3">
                  {field("cintura", "Perímetro de cintura", "cm")}
                </div>
              </fieldset>

              {/* Balance hídrico */}
              <fieldset className="rounded-md border border-border p-3">
                <legend className="mb-2 border-b border-border pb-1 text-sm font-bold">Balance hídrico</legend>
                <div className="grid grid-cols-2 gap-3">
                  {field("balance", "Balance hídrico", "mL")}
                  {field("diuresis", "Diuresis horaria", "mL/h")}
                </div>
              </fieldset>

              {/* Gineco-obstétrico (solo femenina) */}
              {isFemenina && (
                <fieldset className="rounded-md border border-border p-3">
                  <legend className="mb-2 border-b border-border pb-1 text-sm font-bold">Gineco-obstétrico</legend>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="sv-fur" className="mb-1 block text-xs">Fecha de última regla (FUR)</Label>
                      <Input
                        id="sv-fur"
                        type="date"
                        value={draft.fur}
                        onChange={(e) => set("fur", e.target.value)}
                      />
                    </div>
                    <div>
                      <Label className="mb-1 block text-xs">FPP (Naegele)</Label>
                      <div className="flex min-h-[38px] items-center rounded-md border border-border bg-surface-2 px-3 text-sm">
                        {fppData ? (
                          <span><strong>{fppData.fpp}</strong>{fppData.egTexto !== "—" && <> · {fppData.egTexto}</>}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Se calcula con FUR.</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3">
                    <Label className="mb-1 block text-xs">Fórmula obstétrica (G · P · P · A · V)</Label>
                    <div className="grid grid-cols-5 gap-2">
                      {(["goG", "goPt", "goPp", "goA", "goV"] as const).map((k, i) => (
                        <div key={k}>
                          <div className="mb-1 text-center text-[10px] font-semibold text-muted-foreground">
                            {["G", "P", "P", "A", "V"][i]}
                          </div>
                          <Input
                            inputMode="numeric"
                            placeholder="0"
                            value={draft[k]}
                            onChange={(e) => set(k, e.target.value)}
                            className="text-center"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </fieldset>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleSave}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="mr-1.5 h-4 w-4">
              <path d="M20 6 9 17l-5-5" />
            </svg>
            Guardar signos
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Genera chips de resumen para mostrar en el card de signos vitales. */
export function buildVitalesChips(v: VitalesState): string[] {
  const out: string[] = [];
  if (v.sis && v.dia) out.push(`TA ${v.sis}/${v.dia} mmHg`);
  else {
    if (v.sis) out.push(`TA sist ${v.sis} mmHg`);
    if (v.dia) out.push(`TA diast ${v.dia} mmHg`);
  }
  if (v.fc) out.push(`FC ${v.fc} lpm`);
  if (v.fr) out.push(`FR ${v.fr} rpm`);
  if (v.temp) out.push(`Temp ${v.temp} °C`);
  if (v.spo2) out.push(`SpO₂ ${v.spo2}%`);
  if (v.fio2) out.push(`FiO₂ ${v.fio2}%`);
  const gO = parseNum(v.gcsO), gV = parseNum(v.gcsV), gM = parseNum(v.gcsM);
  if (gO != null && gV != null && gM != null) out.push(`Glasgow ${gO + gV + gM}/15`);
  if (v.gluco) out.push(`Gluco ${v.gluco} mg/dL`);
  if (v.pesoKg) out.push(`Peso ${v.pesoKg} kg`);
  else if (v.pesoLb) out.push(`Peso ${v.pesoLb} lb`);
  if (v.tallaM) out.push(`Talla ${v.tallaM} m`);
  else if (v.tallaFt) out.push(`Talla ${v.tallaFt} ft`);
  const imc = calcImc(parseNum(v.pesoKg) ?? null, parseNum(v.tallaM) ?? null);
  if (imc) out.push(`IMC ${imc.toFixed(1)}`);
  const ict = calcIct(parseNum(v.cintura) ?? null, parseNum(v.tallaM) ?? null);
  if (ict) out.push(`ICT ${ict.toFixed(2)}`);
  if (v.cintura) out.push(`Cintura ${v.cintura} cm`);
  if (v.balance) out.push(`Balance ${v.balance} mL`);
  if (v.diuresis) out.push(`Diuresis ${v.diuresis} mL/h`);
  if (v.fur) out.push(`FUR ${v.fur}`);
  const fpp = calcularFppEg(v.fur);
  if (fpp) out.push(`FPP ${fpp.fpp}`);
  const gos = [v.goG, v.goPt, v.goPp, v.goA, v.goV];
  if (gos.some((x) => x !== "")) {
    out.push(`GO G${v.goG || 0} P${v.goPt || 0} P${v.goPp || 0} A${v.goA || 0} V${v.goV || 0}`);
  }
  if (parseInt(v.dolor, 10) > 0) out.push(`Dolor ${v.dolor}/10`);
  return out;
}
