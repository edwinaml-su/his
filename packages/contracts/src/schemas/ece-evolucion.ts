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
  // Núcleo (R4): obligatorio para firmar en la UI
  presionSistolica: z.string().default(""),
  presionDiastolica: z.string().default(""),
  frecuenciaCardiaca: z.string().default(""),
  frecuenciaRespiratoria: z.string().default(""),
  temperatura: z.string().default(""),
  saturacionO2: z.string().default(""),
  fio2: z.string().default(""),
  // Estado neurológico y metabólico (R1.2)
  glasgowOcular: z.string().default(""),
  glasgowVerbal: z.string().default(""),
  glasgowMotora: z.string().default(""),
  glucometriaMgdl: z.string().default(""),
  // Antropometría (R1.3)
  pesoKg: z.string().default(""),
  pesoLb: z.string().default(""),
  tallaM: z.string().default(""),
  tallaFt: z.string().default(""),
  /** @deprecated CC-0006 R1 migró talla a m/ft; conservado para round-trip de borradores previos. */
  tallaCm: z.string().default(""),
  perimetroCintura: z.string().default(""),
  // Balance hídrico (R1.4)
  balanceHidrico: z.string().default(""),
  diuresisHoraria: z.string().default(""),
  // Gineco-obstétrico (R1.5) — solo se llenan si la paciente es femenina
  fechaUltimaRegla: z.string().default(""),
  gestaG: z.string().default(""),
  partoTermino: z.string().default(""),
  partoPretermino: z.string().default(""),
  abortos: z.string().default(""),
  vivos: z.string().default(""),
  // Dolor (EVA)
  escalaDolor: z.number().int().min(0).max(10).default(0),
});
export type EvolucionSignos = z.infer<typeof evolucionSignosSchema>;

/** CC-0006 R3: especialidad médica (catálogo MedicalSpecialty; permite texto libre). */
export const evolucionEspecialidadSchema = z.object({
  id: z.string().uuid().nullable().default(null),
  nombre: z.string().trim().min(1).max(120),
});
export type EvolucionEspecialidad = z.infer<typeof evolucionEspecialidadSchema>;

/** CC-0006: payload estructurado en la columna data jsonb. */
export const evolucionDataSchema = z.object({
  signosVitalesId: z.string().uuid().optional(),
  /** R3: especialidad médica (persistida en data jsonb, sin columna nueva). */
  especialidad: evolucionEspecialidadSchema.optional(),
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
