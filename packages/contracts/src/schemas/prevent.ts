/**
 * AHA PREVENT™ — esquema de entrada y tipos de la calculadora nativa de riesgo
 * cardiovascular (CC-0009 / calculadora `nativo`).
 *
 * Estima el riesgo a 10 y 30 años de ECV total, ASCVD, insuficiencia cardíaca,
 * enfermedad coronaria e ictus en adultos de 30–79 años sin ECV establecida.
 *
 * Origen: coeficientes de `martingmayer/preventr` (MIT) · Khan SS et al.,
 * Circulation 2024 (DOI 10.1161/CIRCULATIONAHA.123.067626). Ecuaciones © AHA.
 *
 * El motor de cálculo vive en `@his/infrastructure/formula` (prevent.ts).
 */
import { z } from "zod";

export const preventSexEnum = z.enum(["female", "male"]);
export type PreventSex = z.infer<typeof preventSexEnum>;

export const preventHorizonEnum = z.enum(["10yr", "30yr"]);
export type PreventHorizon = z.infer<typeof preventHorizonEnum>;

export const preventModelEnum = z.enum(["base", "uacr", "hba1c"]);
export type PreventModel = z.infer<typeof preventModelEnum>;

export const preventOutcomeEnum = z.enum([
  "total_cvd",
  "ascvd",
  "heart_failure",
  "chd",
  "stroke",
]);
export type PreventOutcome = z.infer<typeof preventOutcomeEnum>;

/** Rangos verificados contra el repo origen (sección 3 del requerimiento). */
export const preventInputSchema = z
  .object({
    sex: preventSexEnum,
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
    horizon: preventHorizonEnum.default("10yr"),
  })
  .refine((d) => d.hdlCholesterol < d.totalCholesterol, {
    message: "HDL debe ser menor que el colesterol total",
    path: ["hdlCholesterol"],
  });

export type PreventInput = z.infer<typeof preventInputSchema>;

export interface PreventResult {
  model: PreventModel;
  horizon: PreventHorizon;
  sex: PreventSex;
  risks: Record<PreventOutcome, number>;
}
