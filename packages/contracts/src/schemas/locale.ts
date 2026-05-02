/**
 * US-7.1 / US-7.2 — Schemas Zod para el router de localización SV.
 *
 * Notas:
 *  - `geoDivisions` filtra por `level` (1=depto, 2=municipio, 3=distrito,
 *    4=cantón) y opcionalmente por `parentId` (ej. obtener municipios de un
 *    depto puntual).
 *  - `holidays` filtra por año (calculado en BD vía `gte/lt` de `date`).
 */
import { z } from "zod";

export const geoLevelSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

export const geoDivisionsInput = z
  .object({
    countryIso3: z.string().length(3).optional(),
    level: geoLevelSchema.optional(),
    parentId: z.string().uuid().optional(),
  })
  .optional();

export const holidaysInput = z
  .object({
    countryIso3: z.string().length(3).optional(),
    year: z.number().int().min(2000).max(2100).optional(),
  })
  .optional();

export const localeInfoSchema = z.object({
  country: z.string(),
  isoAlpha3: z.string(),
  locale: z.string(),
  timezone: z.string(),
  currency: z.string(),
  dateFormat: z.string(),
});

export type GeoDivisionsInput = z.infer<typeof geoDivisionsInput>;
export type HolidaysInput = z.infer<typeof holidaysInput>;
export type LocaleInfoDTO = z.infer<typeof localeInfoSchema>;
