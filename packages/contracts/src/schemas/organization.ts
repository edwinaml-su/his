import { z } from "zod";

export const organizationSchema = z.object({
  id: z.string().uuid(),
  countryId: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  legalName: z.string().min(2).max(200),
  tradeName: z.string().max(200).nullable(),
  taxId: z.string().min(2).max(40),
  functionalCurrency: z.string().uuid(),
  /**
   * US-1.6 — moneda de presentación.
   * NOTA Sprint 1: se persiste en `reportingCurrency` (campo existente).
   * TODO(Sprint 2): renombrar columna a `presentationCurrencyId` y separar
   * semánticamente reporting (consolidación holding) vs presentation (UI/print).
   */
  reportingCurrency: z.string().uuid().nullable(),
  active: z.boolean(),
});

export const organizationCreateSchema = organizationSchema.pick({
  countryId: true,
  parentId: true,
  legalName: true,
  tradeName: true,
  taxId: true,
  functionalCurrency: true,
  reportingCurrency: true,
});

/**
 * US-1.6 — input de la mutation `setFunctionalCurrency`.
 * Valida UUIDs en frontera; las reglas de dominio (currency activa,
 * pertenencia ADMIN, advertencia por transacciones) van en el router.
 */
export const setFunctionalCurrencyInputSchema = z.object({
  organizationId: z.string().uuid(),
  currencyId: z.string().uuid(),
  /** Si false y hay transacciones, el server devuelve `requiresConfirmation: true`. */
  confirmDestructive: z.boolean().optional().default(false),
});

export const setFunctionalCurrencyResultSchema = z.object({
  ok: z.boolean(),
  organizationId: z.string().uuid(),
  functionalCurrency: z.string().uuid(),
  /** Cantidad de encuentros existentes en la org (para mostrar warning). */
  encounterCount: z.number().int().nonnegative(),
  /** True cuando hay transacciones y el cliente debe re-llamar con confirmDestructive=true. */
  requiresConfirmation: z.boolean(),
  warning: z.string().nullable(),
});

export type OrganizationDTO = z.infer<typeof organizationSchema>;
export type OrganizationCreateInput = z.infer<typeof organizationCreateSchema>;
export type SetFunctionalCurrencyInput = z.infer<typeof setFunctionalCurrencyInputSchema>;
export type SetFunctionalCurrencyResult = z.infer<typeof setFunctionalCurrencyResultSchema>;
