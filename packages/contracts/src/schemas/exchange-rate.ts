/**
 * @his/contracts/schemas/exchange-rate — schemas Zod para US-1.3 Multi-moneda.
 *
 * Cubre la operación CRUD-append (NO update) sobre `ExchangeRate` y la query
 * de tasa vigente. La inmutabilidad histórica se traduce en:
 *   - `create` no acepta `validTo`: lo administra el router cerrando la tasa
 *     anterior con la misma combinación (from/to/rateType).
 *   - No existe `update` ni `delete`: cualquier corrección es un nuevo registro.
 *
 * Tipos de tasa (TDR §5.3): BUY, SELL, AVERAGE, OFFICIAL, FISCAL.
 * SPOT existe en el enum Prisma pero queda fuera del flujo manual MVP
 * (SPOT lo carga el feed automático en Sprint 5 — ver fetch-bcr-rates).
 *
 * Fuente única de verdad para los formularios web; se replica inline en el
 * router por la restricción de barrel frozen (mismo patrón que break-glass).
 */
import { z } from "zod";

/** Tipos de tasa expuestos al usuario en el formulario manual. */
export const fxRateTypeEnum = z.enum(["BUY", "SELL", "AVERAGE", "OFFICIAL", "FISCAL"]);

/** Cota superior para `validFrom`: como mucho 30 días en el futuro. */
export const VALID_FROM_FUTURE_LIMIT_DAYS = 30;

/**
 * Decimal positivo con hasta 8 lugares decimales (alineado con Decimal(18,8)).
 * Aceptamos string o number desde el form para evitar pérdidas de precisión
 * en JS; el router convierte a Prisma.Decimal antes del insert.
 */
export const fxRateValue = z
  .union([z.number(), z.string()])
  .transform((v, ctx) => {
    const s = typeof v === "number" ? String(v) : v.trim();
    if (!/^\d+(\.\d{1,8})?$/.test(s)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Tasa inválida: usar formato decimal con hasta 8 lugares (ej. 8.75000000).",
      });
      return z.NEVER;
    }
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "La tasa debe ser mayor que 0.",
      });
      return z.NEVER;
    }
    return s;
  });

/** Input para crear una nueva tasa (append-only). */
export const exchangeRateCreateInput = z
  .object({
    fromCurrencyId: z.string().uuid({ message: "Moneda origen inválida." }),
    toCurrencyId: z.string().uuid({ message: "Moneda destino inválida." }),
    rateType: fxRateTypeEnum,
    rate: fxRateValue,
    validFrom: z.coerce.date({ invalid_type_error: "Fecha de vigencia inválida." }),
    source: z.string().trim().min(1).max(80).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.fromCurrencyId === val.toCurrencyId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["toCurrencyId"],
        message: "La moneda destino debe ser distinta de la moneda origen.",
      });
    }
    const limit = new Date();
    limit.setDate(limit.getDate() + VALID_FROM_FUTURE_LIMIT_DAYS);
    if (val.validFrom > limit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["validFrom"],
        message: `La fecha de vigencia no puede estar a más de ${VALID_FROM_FUTURE_LIMIT_DAYS} días en el futuro.`,
      });
    }
  });

/** Filtros para `list` (UI paginada). */
export const exchangeRateListInput = z
  .object({
    fromCurrencyId: z.string().uuid().optional(),
    toCurrencyId: z.string().uuid().optional(),
    rateType: fxRateTypeEnum.optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    /** Si es true, solo devuelve tasas vigentes a `at` (default now). */
    onlyCurrent: z.boolean().optional(),
    at: z.coerce.date().optional(),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(25),
  })
  .default({ page: 1, pageSize: 25 });

/** Input para `getCurrent` (tasa vigente al momento). */
export const exchangeRateGetCurrentInput = z.object({
  fromCurrencyId: z.string().uuid(),
  toCurrencyId: z.string().uuid(),
  rateType: fxRateTypeEnum,
  at: z.coerce.date().optional(),
});

/** Input para `history` (auditoría: todas las tasas históricas de un par). */
export const exchangeRateHistoryInput = z.object({
  fromCurrencyId: z.string().uuid(),
  toCurrencyId: z.string().uuid(),
  rateType: fxRateTypeEnum.optional(),
});

/** Input para `currency.getRate` — utilitario de conversión. */
export const currencyGetRateInput = z.object({
  from: z.string().uuid(),
  to: z.string().uuid(),
  at: z.coerce.date().optional(),
  rateType: fxRateTypeEnum.optional(),
});

export type FxRateTypeUI = z.infer<typeof fxRateTypeEnum>;
export type ExchangeRateCreateInput = z.infer<typeof exchangeRateCreateInput>;
export type ExchangeRateListInput = z.infer<typeof exchangeRateListInput>;
export type ExchangeRateGetCurrentInput = z.infer<typeof exchangeRateGetCurrentInput>;
export type ExchangeRateHistoryInput = z.infer<typeof exchangeRateHistoryInput>;
export type CurrencyGetRateInput = z.infer<typeof currencyGetRateInput>;
