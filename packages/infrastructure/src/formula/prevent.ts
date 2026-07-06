/**
 * Motor AHA PREVENT™ — regresión logística de riesgo cardiovascular (CC-0009).
 *
 * Réplica fiel de `martingmayer/preventr` (R/estimate_risk.R + R/helpers.R),
 * licencia MIT · Khan SS et al., Circulation 2024. Ecuaciones © American Heart
 * Association. Verificado contra los 8 casos oficiales de referencia
 * (base/uacr/hba1c × 10yr/30yr × female/male) — ver prevent.test.ts.
 *
 * Coeficientes en `prevent-coefficients.json` (extraídos de sysdata.rda). El
 * código NO los hardcodea; carga por (modelo_horizonte, sexo_desenlace).
 *
 * Modelos sdi/full existen en el JSON pero NO se usan: dependen del SDI por ZIP
 * de EE.UU., inaplicable a El Salvador.
 */
import type {
  PreventHorizon,
  PreventInput,
  PreventModel,
  PreventOutcome,
  PreventResult,
} from "@his/contracts/schemas/prevent";
import { preventInputSchema } from "@his/contracts/schemas/prevent";
import raw from "./prevent-coefficients.json";

const CHOL_MGDL_TO_MMOL = 0.02586;
const toMmol = (mgdl: number): number => mgdl * CHOL_MGDL_TO_MMOL;
const logistic = (x: number): number => 1 / (1 + Math.exp(-x));

const OUTCOMES: PreventOutcome[] = [
  "total_cvd",
  "ascvd",
  "heart_failure",
  "chd",
  "stroke",
];

interface CoefficientFile {
  meta: Record<string, unknown>;
  coefficients: Record<string, Record<string, number[]>>;
}

const data = raw as unknown as CoefficientFile;
export const preventMeta = data.meta;

function getCoefficients(modelKey: string, outcomeKey: string): number[] {
  const c = data.coefficients[modelKey]?.[outcomeKey];
  if (!c) {
    throw new Error(`PREVENT: coeficientes no encontrados: ${modelKey}/${outcomeKey}`);
  }
  return c;
}

/**
 * Términos base compartidos por todos los modelos (22 términos, orden fijo).
 * Splines lineales por tramos en SBP (knot 110), BMI (knot 30), eGFR (knot 60)
 * + interacciones con edad y tratamiento. Ver sección 4 del requerimiento.
 */
function baseTerms(inp: PreventInput): number[] {
  const age = (inp.age - 55) / 10;
  const nonHdl = toMmol(inp.totalCholesterol - inp.hdlCholesterol) - 3.5;
  const hdl = (toMmol(inp.hdlCholesterol) - 1.3) / 0.3;
  const sbpLow = (Math.min(inp.systolicBP, 110) - 110) / 20;
  const sbpHigh = (Math.max(inp.systolicBP, 110) - 130) / 20;
  const dm = inp.diabetes ? 1 : 0;
  const smk = inp.smoking ? 1 : 0;
  const bmiLow = (Math.min(inp.bmi, 30) - 25) / 5;
  const bmiHigh = (Math.max(inp.bmi, 30) - 30) / 5;
  const egfrLow = (Math.min(inp.eGFR, 60) - 60) / -15;
  const egfrHigh = (Math.max(inp.eGFR, 60) - 90) / -15;
  const bpTx = inp.onBPMeds ? 1 : 0;
  const statin = inp.onStatin ? 1 : 0;
  return [
    age, nonHdl, hdl, sbpLow, sbpHigh, dm, smk, bmiLow, bmiHigh, egfrLow, egfrHigh,
    bpTx, statin, bpTx * sbpHigh, statin * nonHdl,
    age * nonHdl, age * hdl, age * sbpHigh, age * dm, age * smk, age * bmiHigh, age * egfrLow,
  ];
}

function hba1cTerms(inp: PreventInput): number[] {
  const dm = inp.diabetes ? 1 : 0;
  const missing = inp.hba1c == null ? 1 : 0;
  const centered = inp.hba1c != null ? inp.hba1c - 5.3 : 0;
  return [dm ? centered : 0, dm ? 0 : centered, missing];
}

function uacrTerms(inp: PreventInput): number[] {
  const missing = inp.uacr == null ? 1 : 0;
  const lnUacr = inp.uacr != null ? Math.log(inp.uacr) : 0;
  return [lnUacr, missing];
}

/**
 * Vector de features en el orden de `term_order`: base (+ age² como 2º término
 * a 30 años) + extra del modelo (uacr/hba1c) + intercepto (1) al final.
 */
function buildFeatures(
  inp: PreventInput,
  model: PreventModel,
  horizon: PreventHorizon,
): number[] {
  const base = baseTerms(inp);
  const ageTerm = (inp.age - 55) / 10;
  const withAge2 =
    horizon === "30yr" ? [ageTerm, ageTerm * ageTerm, ...base.slice(1)] : base;
  let extra: number[] = [];
  if (model === "uacr") extra = uacrTerms(inp);
  else if (model === "hba1c") extra = hba1cTerms(inp);
  return [...withAge2, ...extra, 1];
}

function resolveModel(inp: PreventInput): PreventModel {
  if (inp.hba1c != null) return "hba1c";
  if (inp.uacr != null) return "uacr";
  return "base";
}

function dot(coef: number[], features: number[]): number {
  if (coef.length !== features.length) {
    throw new Error(
      `PREVENT: desajuste coef=${coef.length} features=${features.length}`,
    );
  }
  let s = 0;
  for (let i = 0; i < coef.length; i++) s += coef[i]! * features[i]!;
  return s;
}

/**
 * Calcula el riesgo PREVENT para los 5 desenlaces del sexo/horizonte dados.
 * Valida la entrada con `preventInputSchema` (lanza ZodError si está fuera de
 * rango). Riesgo por desenlace = 1/(1+e^(−Σ coef·feature))·100, a 1 decimal.
 */
export function calcularPrevent(input: PreventInput): PreventResult {
  const parsed = preventInputSchema.parse(input);
  const model = resolveModel(parsed);
  const horizon = parsed.horizon;
  const modelKey = `${model}_${horizon}`;
  const features = buildFeatures(parsed, model, horizon);
  const risks = {} as Record<PreventOutcome, number>;
  for (const outcome of OUTCOMES) {
    const coef = getCoefficients(modelKey, `${parsed.sex}_${outcome}`);
    risks[outcome] = Number((logistic(dot(coef, features)) * 100).toFixed(1));
  }
  return { model, horizon, sex: parsed.sex, risks };
}
