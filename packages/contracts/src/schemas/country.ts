import { z } from "zod";

/** ISO 3166-1 alpha-3 (e.g., "SLV", "GTM"). 3 letras mayúsculas. */
export const iso3Regex = /^[A-Z]{3}$/;
/** ISO 3166-1 alpha-2 (e.g., "SV", "GT"). 2 letras mayúsculas. */
export const iso2Regex = /^[A-Z]{2}$/;

export const countrySchema = z.object({
  id: z.string().uuid(),
  isoAlpha3: z.string().length(3),
  isoNumeric: z.number().int(),
  name: z.string(),
  defaultLocale: z.string(),
  defaultTzId: z.string(),
  active: z.boolean(),
});

/**
 * US-1.1 — Crear país.
 *
 * Validación:
 *  - `isoAlpha3` debe ser ISO 3166-1 alpha-3 (3 letras mayúsculas).
 *  - `isoNumeric` debe ser un entero entre 1 y 999 (3 dígitos ISO 3166-1 numeric).
 *  - `defaultLocale` IETF BCP-47 básico tipo `xx-XX` (no estricto en MVP).
 *  - `defaultTzId` IANA timezone (validación cliente best-effort).
 *  - `defaultCurrencyId` opcional: si se provee, se enlaza CountryCurrency
 *    como `isFunctional=true, isLegalTender=true`.
 */
export const countryCreateInput = z.object({
  isoAlpha3: z
    .string()
    .trim()
    .toUpperCase()
    .regex(iso3Regex, "Debe ser ISO 3166-1 alpha-3 (3 letras mayúsculas)."),
  isoAlpha2: z
    .string()
    .trim()
    .toUpperCase()
    .regex(iso2Regex, "Debe ser ISO 3166-1 alpha-2 (2 letras mayúsculas).")
    .optional(),
  isoNumeric: z
    .number({ invalid_type_error: "Código numérico requerido." })
    .int()
    .min(1, "Mínimo 1.")
    .max(999, "Máximo 3 dígitos (1-999)."),
  name: z.string().trim().min(2, "Mínimo 2 caracteres.").max(120),
  nameLocal: z.string().trim().min(2).max(120).optional(),
  defaultLocale: z
    .string()
    .trim()
    .min(2, "Locale requerido.")
    .max(20)
    .regex(/^[a-zA-Z]{2,3}(-[A-Za-z0-9]{2,8})*$/i, "Formato locale inválido (ej. es-SV)."),
  defaultTzId: z
    .string()
    .trim()
    .min(3, "Timezone requerida.")
    .max(60),
  defaultCurrencyId: z.string().uuid().optional(),
  active: z.boolean().optional(),
});

/** US-1.1 — Actualizar país. Todos los campos opcionales menos `id`. */
export const countryUpdateInput = z.object({
  id: z.string().uuid(),
  isoAlpha3: z
    .string()
    .trim()
    .toUpperCase()
    .regex(iso3Regex, "Debe ser ISO 3166-1 alpha-3.")
    .optional(),
  isoAlpha2: z
    .string()
    .trim()
    .toUpperCase()
    .regex(iso2Regex, "Debe ser ISO 3166-1 alpha-2.")
    .optional(),
  isoNumeric: z.number().int().min(1).max(999).optional(),
  name: z.string().trim().min(2).max(120).optional(),
  nameLocal: z.string().trim().min(2).max(120).optional(),
  defaultLocale: z
    .string()
    .trim()
    .min(2)
    .max(20)
    .regex(/^[a-zA-Z]{2,3}(-[A-Za-z0-9]{2,8})*$/i, "Formato locale inválido.")
    .optional(),
  defaultTzId: z.string().trim().min(3).max(60).optional(),
  defaultCurrencyId: z.string().uuid().optional(),
});

/** US-1.1 — Desactivar / activar país. */
export const countryDeactivateInput = z.object({
  id: z.string().uuid(),
});

export const countryActivateInput = z.object({
  id: z.string().uuid(),
});

export const countryListInput = z
  .object({
    search: z.string().trim().max(120).optional(),
    activeOnly: z.boolean().optional(),
  })
  .optional();

export type CountryDTO = z.infer<typeof countrySchema>;
export type CountryCreateInput = z.infer<typeof countryCreateInput>;
export type CountryUpdateInput = z.infer<typeof countryUpdateInput>;
export type CountryDeactivateInput = z.infer<typeof countryDeactivateInput>;
export type CountryActivateInput = z.infer<typeof countryActivateInput>;
