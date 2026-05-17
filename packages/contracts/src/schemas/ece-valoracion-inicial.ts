/**
 * Schemas Zod — ECE Valoración Inicial de Enfermería.
 *
 * Cubre `ece.valoracion_inicial_enfermeria` — registro maestro one-per-episodio
 * al ingreso hospitalario.
 *
 * Norma: TDR §4 NTEC / Acuerdo n.° 1616 (MINSAL, 2024).
 */
import { z } from "zod";

/** Escalas clínicas usadas en la valoración inicial. */
export const escalaBradenSchema = z
  .number()
  .int()
  .min(6)
  .max(23)
  .describe("Escala Braden riesgo úlcera por presión (6–23)");

export const escalaMorseSchema = z
  .number()
  .int()
  .min(0)
  .max(125)
  .describe("Escala Morse riesgo de caídas (0–125)");

export const escalaDoloreSchema = z
  .number()
  .int()
  .min(0)
  .max(10)
  .describe("Escala de dolor EVA (0–10)");

/** Estados del workflow de la valoración. */
export const estadoValoracionEnum = z.enum([
  "borrador",
  "firmado",
  "validado",
  "anulado",
]);
export type EstadoValoracion = z.infer<typeof estadoValoracionEnum>;

/** Crea la valoración inicial de enfermería al ingreso. */
export const eceValoracionInicialCreateSchema = z.object({
  episodioHospitalarioId: z.string().uuid(),
  fechaHora: z.coerce.date(),
  antecedentesPersonales: z.string().trim().max(4000).optional(),
  antecedentesFamiliares: z.string().trim().max(4000).optional(),
  alergiasConocidas: z.string().trim().max(2000).optional(),
  medicamentosActuales: z.string().trim().max(2000).optional(),
  escalaBraden: escalaBradenSchema.optional(),
  escalaMorse: escalaMorseSchema.optional(),
  escalaDolor: escalaDoloreSchema.optional(),
  estadoConsciencia: z.string().trim().max(500).optional(),
  dispositivosInvasivos: z.string().trim().max(1000).optional(),
  educacionBrindada: z.string().trim().max(2000).optional(),
  planCuidadosInicial: z.string().trim().max(4000).optional(),
});

export type EceValoracionInicialCreateInput = z.infer<
  typeof eceValoracionInicialCreateSchema
>;

/** Actualiza una valoración en estado borrador. Mismos campos que create. */
export const eceValoracionInicialUpdateSchema =
  eceValoracionInicialCreateSchema
    .partial()
    .extend({ id: z.string().uuid() });

export type EceValoracionInicialUpdateInput = z.infer<
  typeof eceValoracionInicialUpdateSchema
>;

/** Filtros para listar valoraciones. */
export const eceValoracionInicialListSchema = z.object({
  episodioHospitalarioId: z.string().uuid().optional(),
  estado: estadoValoracionEnum.optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

export type EceValoracionInicialListInput = z.infer<
  typeof eceValoracionInicialListSchema
>;

/** Id-only para get / firmar / validar. */
export const eceValoracionInicialIdSchema = z.object({
  id: z.string().uuid(),
});

export type EceValoracionInicialIdInput = z.infer<
  typeof eceValoracionInicialIdSchema
>;
