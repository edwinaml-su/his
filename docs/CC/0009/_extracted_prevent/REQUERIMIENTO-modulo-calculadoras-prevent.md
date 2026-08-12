# Requerimiento: Módulo de Calculadoras — AHA PREVENT™

> Documento de especificación para implementar en el HIS (github.com/edwinaml-su/his) vía Claude Code.
> Stack objetivo: Next.js 14 + tRPC + Zod + Prisma (monorepo Turborepo).

## 1. Contexto y objetivo

Incorporar la calculadora de riesgo cardiovascular **AHA PREVENT™** al HIS como un módulo de calculadoras extensible. Estima el riesgo a **10 y 30 años** de: ECV total (total_cvd), ASCVD, insuficiencia cardíaca (heart_failure), enfermedad coronaria (chd) e ictus (stroke), en adultos de **30–79 años sin ECV conocida**.

### Origen de los datos (procedencia y licencia)
- Coeficientes extraídos del paquete R \`martingmayer/preventr\` (licencia **MIT**), archivo \`R/sysdata.rda\`.
- Fuente primaria: Khan SS, et al. Circulation. 2024. DOI: 10.1161/CIRCULATIONAHA.123.067626.
- Ecuaciones subyacentes © American Heart Association (PREVENT™). La licencia MIT permite incorporarlas en software propietario conservando el aviso de copyright.

### Validación
Verificado reproduciendo **exactamente** los casos oficiales de referencia (snapshot \`estimate_risk.md\` del paquete). Modelos base, uacr y hba1c coinciden al 100%.

## 2. Arquitectura de archivos

\`\`\`
packages/domain/calculators/
├── data/prevent-coefficients.json      ← incluido en este ZIP
├── src/prevent/{schema,coefficients,transforms,prevent,index}.ts
├── src/{registry,index}.ts
├── tests/prevent.test.ts
└── package.json
\`\`\`

Los coeficientes numéricos viven en \`data/prevent-coefficients.json\`; el código los importa (NO hardcodeados).

## 3. Rangos de entrada verificados

| Campo | Rango | Unidad |
|---|---|---|
| age | 30–79 | años |
| totalCholesterol | 130–320 | mg/dL |
| hdlCholesterol | 20–100 | mg/dL |
| systolicBP | 90–180 | mmHg |
| eGFR | 15–140 | mL/min/1.73m² |
| bmi | 18.5–39.9 | kg/m² |
| hba1c (opcional) | 4.5–15 | % |
| uacr (opcional) | 0.1–25000 | mg/g |
| diabetes, smoking, onStatin, onBPMeds | boolean | — |

## 4. Lógica de transformación

- **age** = (edad − 55)/10; en 30 años se añade **age²** como 2º término.
- **non-HDL-C** = (total − HDL)·0.02586 − 3.5
- **HDL-C** = (HDL·0.02586 − 1.3)/0.3
- **SBP** (knot 110): low=(min(SBP,110)−110)/20 ; high=(max(SBP,110)−130)/20
- **BMI** (knot 30): low=(min(BMI,30)−25)/5 ; high=(max(BMI,30)−30)/5
- **eGFR** (knot 60): low=(min(eGFR,60)−60)/−15 ; high=(max(eGFR,60)−90)/−15
- Interacciones: onBPMeds·sbp_high, onStatin·non_hdl, y age·(non_hdl, hdl, sbp_high, dm, smoking, bmi_high, egfr_low)
- **hba1c**: dm ? (hba1c−5.3):0 ; dm ? 0:(hba1c−5.3) ; missing flag
- **uacr**: log(uacr) ; missing flag
- Último término = intercepto (1). Riesgo = 1/(1+exp(−Σ coef·término))·100.

Selección de modelo: hba1c presente → hba1c; uacr presente → uacr; si no → base.

**El Salvador**: modelos sdi/full dependen de ZIP de EE.UU. y NO aplican (incluidos en JSON solo por completitud).

## 5. Archivos de código

### src/prevent/schema.ts
\`\`\`typescript
import { z } from "zod";
export const SexEnum = z.enum(["female", "male"]);
export type Sex = z.infer<typeof SexEnum>;
export const HorizonEnum = z.enum(["10yr", "30yr"]);
export type Horizon = z.infer<typeof HorizonEnum>;
export const PreventModelEnum = z.enum(["base", "uacr", "hba1c"]);
export type PreventModel = z.infer<typeof PreventModelEnum>;
export const OutcomeEnum = z.enum(["total_cvd","ascvd","heart_failure","chd","stroke"]);
export type Outcome = z.infer<typeof OutcomeEnum>;
export const PreventInputSchema = z.object({
  sex: SexEnum,
  age: z.number().min(30).max(79),
  totalCholesterol: z.number().min(130).max(320),
  hdlCholesterol: z.number().min(20).max(100),
  systolicBP: z.number().min(90).max(180),
  eGFR: z.number().min(15).max(140),
  bmi: z.number().min(18.5).max(39.9),
  diabetes: z.boolean(),
  smoking: z.boolean(),
  onStatin: z.boolean(),
  onBPMeds: z.boolean(),
  hba1c: z.number().min(4.5).max(15).optional(),
  uacr: z.number().min(0.1).max(25000).optional(),
  horizon: HorizonEnum.default("10yr"),
}).refine((d) => d.hdlCholesterol < d.totalCholesterol, {
  message: "HDL debe ser menor que el colesterol total", path: ["hdlCholesterol"],
});
export type PreventInput = z.infer<typeof PreventInputSchema>;
export interface PreventResult { model: PreventModel; horizon: Horizon; sex: Sex; risks: Record<Outcome, number>; }
\`\`\`

### src/prevent/transforms.ts
\`\`\`typescript
import type { PreventInput } from "./schema";
export const CHOL_MGDL_TO_MMOL = 0.02586;
export const toMmol = (mgdl: number): number => mgdl * CHOL_MGDL_TO_MMOL;
export const logistic = (x: number): number => 1 / (1 + Math.exp(-x));
export function baseTerms(inp: PreventInput): number[] {
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
  return [age, nonHdl, hdl, sbpLow, sbpHigh, dm, smk, bmiLow, bmiHigh, egfrLow, egfrHigh, bpTx, statin,
    bpTx * sbpHigh, statin * nonHdl, age * nonHdl, age * hdl, age * sbpHigh, age * dm, age * smk, age * bmiHigh, age * egfrLow];
}
export function hba1cTerms(inp: PreventInput): number[] {
  const dm = inp.diabetes ? 1 : 0;
  const missing = inp.hba1c == null ? 1 : 0;
  const centered = inp.hba1c != null ? inp.hba1c - 5.3 : 0;
  return [dm ? centered : 0, dm ? 0 : centered, missing];
}
export function uacrTerms(inp: PreventInput): number[] {
  const missing = inp.uacr == null ? 1 : 0;
  const lnUacr = inp.uacr != null ? Math.log(inp.uacr) : 0;
  return [lnUacr, missing];
}
export function buildFeatures(inp: PreventInput, model: "base"|"uacr"|"hba1c", horizon: "10yr"|"30yr"): number[] {
  const base = baseTerms(inp);
  const withAge2 = horizon === "30yr" ? [base[0], base[0]*base[0], ...base.slice(1)] : base;
  let extra: number[] = [];
  if (model === "uacr") extra = uacrTerms(inp);
  else if (model === "hba1c") extra = hba1cTerms(inp);
  return [...withAge2, ...extra, 1];
}
\`\`\`

### src/prevent/coefficients.ts
\`\`\`typescript
import raw from "../../data/prevent-coefficients.json";
export type OutcomeKey = "female_total_cvd"|"male_total_cvd"|"female_ascvd"|"male_ascvd"|"female_heart_failure"|"male_heart_failure"|"female_chd"|"male_chd"|"female_stroke"|"male_stroke";
export type ModelKey = "base_10yr"|"base_30yr"|"uacr_10yr"|"uacr_30yr"|"hba1c_10yr"|"hba1c_30yr"|"sdi_10yr"|"sdi_30yr"|"full_10yr"|"full_30yr";
interface CoefficientFile { meta: Record<string, unknown>; centering: Record<string, unknown>; term_order: Record<ModelKey, string[]>; coefficients: Record<ModelKey, Record<OutcomeKey, number[]>>; }
const data = raw as unknown as CoefficientFile;
export function getCoefficients(model: ModelKey, outcome: OutcomeKey): number[] {
  const c = data.coefficients[model]?.[outcome];
  if (!c) throw new Error(\`Coeficientes no encontrados: \${model}/\${outcome}\`);
  return c;
}
export const coefficientMeta = data.meta;
\`\`\`

### src/prevent/prevent.ts
\`\`\`typescript
import { PreventInputSchema, type PreventInput, type PreventResult, type Outcome, type PreventModel, type Horizon } from "./schema";
import { buildFeatures, logistic } from "./transforms";
import { getCoefficients, type ModelKey, type OutcomeKey } from "./coefficients";
const OUTCOMES: Outcome[] = ["total_cvd","ascvd","heart_failure","chd","stroke"];
function resolveModel(inp: PreventInput): PreventModel {
  if (inp.hba1c != null) return "hba1c";
  if (inp.uacr != null) return "uacr";
  return "base";
}
function dot(coef: number[], features: number[]): number {
  if (coef.length !== features.length) throw new Error(\`Desajuste: coef=\${coef.length} features=\${features.length}\`);
  let s = 0; for (let i = 0; i < coef.length; i++) s += coef[i] * features[i]; return s;
}
export function calculatePrevent(input: PreventInput): PreventResult {
  const parsed = PreventInputSchema.parse(input);
  const model = resolveModel(parsed);
  const horizon: Horizon = parsed.horizon;
  const modelKey = \`\${model}_\${horizon}\` as ModelKey;
  const features = buildFeatures(parsed, model, horizon);
  const risks = {} as Record<Outcome, number>;
  for (const outcome of OUTCOMES) {
    const key = \`\${parsed.sex}_\${outcome}\` as OutcomeKey;
    const coef = getCoefficients(modelKey, key);
    risks[outcome] = Number((logistic(dot(coef, features)) * 100).toFixed(1));
  }
  return { model, horizon, sex: parsed.sex, risks };
}
\`\`\`

### src/prevent/index.ts
\`\`\`typescript
export * from "./schema";
export * from "./prevent";
export { coefficientMeta } from "./coefficients";
\`\`\`

### src/registry.ts
\`\`\`typescript
import type { z } from "zod";
import { PreventInputSchema, calculatePrevent } from "./prevent";
export interface CalculatorDefinition<TInput = unknown, TResult = unknown> {
  id: string; name: string; description: string; inputSchema: z.ZodTypeAny;
  compute: (input: TInput) => TResult; attribution: string; disclaimer: string;
}
export const preventCalculator: CalculatorDefinition = {
  id: "aha-prevent",
  name: "AHA PREVENT™ — Riesgo cardiovascular",
  description: "Estima el riesgo a 10 y 30 años de ECV total, ASCVD, insuficiencia cardíaca, enfermedad coronaria e ictus en adultos de 30–79 años sin ECV conocida.",
  inputSchema: PreventInputSchema,
  compute: calculatePrevent as (input: unknown) => unknown,
  attribution: "Ecuaciones © American Heart Association (PREVENT™). Khan SS et al., Circulation 2024. Implementación de referencia: preventr (MIT).",
  disclaimer: "Solo con fines informativos. No reemplaza el juicio clínico. Válido en adultos 30–79 años sin ECV establecida.",
};
export const calculators: Record<string, CalculatorDefinition> = { [preventCalculator.id]: preventCalculator };
\`\`\`

### src/index.ts
\`\`\`typescript
export * from "./prevent";
export * from "./registry";
\`\`\`

### tests/prevent.test.ts
\`\`\`typescript
import { describe, it, expect } from "vitest";
import { calculatePrevent } from "../src/prevent";
const BASE = { age: 50, totalCholesterol: 200, hdlCholesterol: 45, systolicBP: 160, eGFR: 90, bmi: 35, diabetes: true, smoking: false, onStatin: false, onBPMeds: true } as const;
const CASES = [
  { name: "base 10yr", input: { ...BASE, horizon: "10yr" as const },
    female: { total_cvd: 14.7, ascvd: 9.2, heart_failure: 8.1, chd: 4.4, stroke: 5.4 },
    male: { total_cvd: 16.3, ascvd: 10.2, heart_failure: 10.6, chd: 5.6, stroke: 5.2 } },
  { name: "base 30yr", input: { ...BASE, horizon: "30yr" as const },
    female: { total_cvd: 53.0, ascvd: 35.4, heart_failure: 39.0, chd: 19.8, stroke: 22.1 },
    male: { total_cvd: 51.4, ascvd: 34.9, heart_failure: 42.4, chd: 21.6, stroke: 19.7 } },
  { name: "uacr 10yr", input: { ...BASE, uacr: 40, horizon: "10yr" as const },
    female: { total_cvd: 16.0, ascvd: 9.9, heart_failure: 8.9, chd: 4.8, stroke: 5.9 },
    male: { total_cvd: 17.2, ascvd: 11.0, heart_failure: 11.0, chd: 5.9, stroke: 5.6 } },
  { name: "hba1c 10yr", input: { ...BASE, hba1c: 7.5, horizon: "10yr" as const },
    female: { total_cvd: 13.6, ascvd: 8.3, heart_failure: 8.1, chd: 4.1, stroke: 4.6 },
    male: { total_cvd: 15.5, ascvd: 9.4, heart_failure: 10.1, chd: 5.1, stroke: 4.7 } },
];
describe("PREVENT — validación oficial", () => {
  for (const c of CASES) for (const sex of ["female","male"] as const) {
    it(\`\${c.name} — \${sex}\`, () => {
      const res = calculatePrevent({ ...c.input, sex });
      const expected = c[sex];
      for (const [outcome, val] of Object.entries(expected))
        expect(res.risks[outcome as keyof typeof res.risks]).toBeCloseTo(val, 1);
    });
  }
});
\`\`\`

### package.json
\`\`\`json
{
  "name": "@his/calculators",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "zod": "^3.23.0" },
  "devDependencies": { "vitest": "^1.6.0", "typescript": "^5.4.0" }
}
\`\`\`

## 6. Pasos de integración
1. Coloca \`prevent-coefficients.json\` en \`packages/domain/calculators/data/\`.
2. Asegura \`"resolveJsonModule": true\` en tsconfig.
3. Crea los archivos de la sección 5.
4. Ejecuta \`pnpm --filter @his/calculators test\` (8 casos deben pasar).
5. Expón por tRPC con \`PreventInputSchema\` como input llamando a \`calculatePrevent\`.

## 7. Cumplimiento (UI de producción)
- Atribución a la AHA (PREVENT™) y cita del paper.
- Disclaimer: "No reemplaza el juicio clínico."
- Limitar a adultos 30–79 años sin ECV establecida.
- Conservar aviso de licencia MIT de preventr.
