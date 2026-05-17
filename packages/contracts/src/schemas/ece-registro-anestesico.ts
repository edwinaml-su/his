/**
 * Schemas Zod — ECE Registro Anestésico Intraoperatorio.
 *
 * Cubre `ece.registro_anestesico`.
 * Firma exclusiva del anestesiólogo (rol ESP).
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const tipoAnestesiaEnum = z.enum([
  "general",
  "regional",
  "local",
  "sedacion",
]);
export type TipoAnestesia = z.infer<typeof tipoAnestesiaEnum>;

export const viaAereaEnum = z.enum(["intubacion", "mascarilla", "lma"]);
export type ViaAerea = z.infer<typeof viaAereaEnum>;

export const estadoRegistroAnestEnum = z.enum([
  "borrador",
  "firmado",
  "anulado",
]);
export type EstadoRegistroAnest = z.infer<typeof estadoRegistroAnestEnum>;

// ---------------------------------------------------------------------------
// Sub-schemas JSONB
// ---------------------------------------------------------------------------

/** Un medicamento administrado durante el acto quirúrgico. */
export const medicamentoAdministradoSchema = z.object({
  nombre: z.string().min(1).max(500),
  dosis: z.string().min(1).max(200),
  via: z.string().min(1).max(100),
  hora_administracion: z.string().datetime({ offset: true }),
});
export type MedicamentoAdministrado = z.infer<
  typeof medicamentoAdministradoSchema
>;

/** Un punto de la serie temporal de signos vitales intraoperatorios. */
export const signoVitalIntraopSchema = z.object({
  ts: z.string().datetime({ offset: true }),
  ta_sistolica: z.number().int().min(0).max(300).optional(),
  ta_diastolica: z.number().int().min(0).max(200).optional(),
  fc: z.number().int().min(0).max(300).optional(),
  fr: z.number().int().min(0).max(100).optional(),
  spo2: z.number().int().min(0).max(100).optional(),
  etco2: z.number().int().min(0).max(100).optional(),
});
export type SignoVitalIntraop = z.infer<typeof signoVitalIntraopSchema>;

// ---------------------------------------------------------------------------
// CRUD schemas
// ---------------------------------------------------------------------------

export const eceRegistroAnestesicoCreateSchema = z.object({
  actoQuirurgicoId: z.string().uuid(),
  asa: z.number().int().min(1).max(5),
  tipoAnestesia: tipoAnestesiaEnum,
  viaAerea: viaAereaEnum,
  medicamentosAdministrados: z.array(medicamentoAdministradoSchema).default([]),
  signosVitalesIntraop: z.array(signoVitalIntraopSchema).default([]),
  complicaciones: z.string().trim().max(4000).optional(),
  fluidoterapiaMl: z.number().int().min(0).optional(),
  perdidasSanguineasMl: z.number().int().min(0).optional(),
});
export type EceRegistroAnestesicoCreateInput = z.infer<
  typeof eceRegistroAnestesicoCreateSchema
>;

export const eceRegistroAnestesicoListSchema = z.object({
  actoQuirurgicoId: z.string().uuid().optional(),
  estado: estadoRegistroAnestEnum.optional(),
  limit: z.number().int().min(1).max(100).default(20),
});
export type EceRegistroAnestesicoListInput = z.infer<
  typeof eceRegistroAnestesicoListSchema
>;

export const eceRegistroAnestesicoIdSchema = z.object({
  id: z.string().uuid(),
});
export type EceRegistroAnestesicoIdInput = z.infer<
  typeof eceRegistroAnestesicoIdSchema
>;

/** Agrega un punto de signos vitales al array JSONB. */
export const registrarSignoVitalSchema = z.object({
  id: z.string().uuid(),
  signoVital: signoVitalIntraopSchema,
});
export type RegistrarSignoVitalInput = z.infer<
  typeof registrarSignoVitalSchema
>;
