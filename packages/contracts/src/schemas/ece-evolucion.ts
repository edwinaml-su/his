import { z } from "zod";

/** CC-0006: un problema POMR. parentId=null → raíz; si apunta a otro problema → hijo (1 solo nivel). */
export const evolucionProblemaSchema = z.object({
  id: z.string().min(1),
  texto: z.string().trim().min(1).max(500),
  parentId: z.string().nullable(),
  orden: z.number().int().nonnegative(),
});
export type EvolucionProblema = z.infer<typeof evolucionProblemaSchema>;

/** CC-0006: una indicación del plan (se agregan de a una). */
export const indicacionPlanSchema = z.object({
  id: z.string().min(1),
  texto: z.string().trim().min(1).max(2000),
  orden: z.number().int().nonnegative(),
});
export type IndicacionPlan = z.infer<typeof indicacionPlanSchema>;

/**
 * CC-0006: signos vitales del flujo (parte del Objetivo). Se autosalvan dentro de
 * data.signos como strings (shape de SignosState en UI) para round-trip sin pérdida;
 * la UI valida rangos y calcula alertas. NO se crea fila ece.signos_vitales separada:
 * el modelo autosave-first generaría filas huérfanas en cada guardado; data jsonb queda
 * cubierto por el audit hash-chain y el trigger de inmutabilidad post-firma.
 */
export const evolucionSignosSchema = z.object({
  presionSistolica: z.string().default(""),
  presionDiastolica: z.string().default(""),
  frecuenciaCardiaca: z.string().default(""),
  frecuenciaRespiratoria: z.string().default(""),
  temperatura: z.string().default(""),
  saturacionO2: z.string().default(""),
  escalaDolor: z.number().int().min(0).max(10).default(0),
  pesoKg: z.string().default(""),
  tallaCm: z.string().default(""),
  glucometriaMgdl: z.string().default(""),
});
export type EvolucionSignos = z.infer<typeof evolucionSignosSchema>;

/** CC-0006: payload estructurado en la columna data jsonb. */
export const evolucionDataSchema = z.object({
  signosVitalesId: z.string().uuid().optional(),
  problemas: z.array(evolucionProblemaSchema).default([]),
  plan: z.array(indicacionPlanSchema).default([]),
  signos: evolucionSignosSchema.optional(),
});
export type EvolucionData = z.infer<typeof evolucionDataSchema>;

export const eceEvolucionCreateSchema = z.object({
  episodioId: z.string().uuid(),
  fecha: z.coerce.date(),
  // D-3: S/O opcionales — gating en UI (borrador permite vacíos; firmar exige S+O+A+P)
  soapSubjetivo: z.string().trim().max(8000).default(""),
  soapObjetivo: z.string().trim().max(8000).default(""),
  soapAnalisis: z.string().trim().max(8000).default(""),
  soapPlan: z.string().trim().max(8000).default(""),
  data: evolucionDataSchema.optional(),
});

export type EceEvolucionCreateInput = z.infer<typeof eceEvolucionCreateSchema>;

export const eceEvolucionUpdateSchema = z.object({
  id: z.string().uuid(),
  // autosave de borrador permite vacíos; el gating real (S+O+A+P no vacíos) está en UI/firmar
  soapSubjetivo: z.string().trim().max(8000).optional(),
  soapObjetivo: z.string().trim().max(8000).optional(),
  soapAnalisis: z.string().trim().max(8000).optional(),
  soapPlan: z.string().trim().max(8000).optional(),
  data: evolucionDataSchema.optional(),
});

export const eceEvolucionListSchema = z.object({
  episodioId: z.string().uuid().optional(),
  fecha: z.coerce.date().optional(),
  autorId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().uuid().optional(),
});
