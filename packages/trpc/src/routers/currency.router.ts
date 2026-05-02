import { z } from "zod";
import { router, publicProcedure, tenantProcedure } from "../trpc";

/**
 * US-1.3 — extensiones para multi-moneda:
 *  - `getRate(from, to, at?, rateType?)`: utilitario de conversión. Devuelve
 *    la tasa vigente en `at` (default now) para el par `from→to`. Si no se
 *    pasa `rateType`, intenta en orden de preferencia OFFICIAL → AVERAGE →
 *    FISCAL → SELL → BUY (mismo orden que usan ledgers contables Avante).
 *    Caso especial `from === to`: rate=1 sin tocar BD.
 *  - `listRates`: alias semántico de `exchangeRates` con paginación ligera
 *    (orientado a selectors UI; no reemplaza `exchangeRate.list` con su
 *    paginación full).
 *
 * Mantiene compat con `exchangeRates` (consumido por country/organization),
 * por eso lo dejamos.
 */
const fxRateTypeEnum = z.enum(["BUY", "SELL", "AVERAGE", "OFFICIAL", "FISCAL"]);

/** Orden de preferencia cuando el caller no especifica rateType. */
const RATE_TYPE_FALLBACK = ["OFFICIAL", "AVERAGE", "FISCAL", "SELL", "BUY"] as const;

export const currencyRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    return ctx.prisma.currency.findMany({
      where: { active: true },
      orderBy: { isoCode: "asc" },
    });
  }),

  /** Tasas de cambio vigentes a la fecha indicada (default: ahora). */
  exchangeRates: publicProcedure
    .input(
      z
        .object({
          at: z.coerce.date().optional(),
          fromCurrency: z.string().uuid().optional(),
          toCurrency: z.string().uuid().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const at = input?.at ?? new Date();
      return ctx.prisma.exchangeRate.findMany({
        where: {
          ...(input?.fromCurrency ? { fromCurrency: input.fromCurrency } : {}),
          ...(input?.toCurrency ? { toCurrency: input.toCurrency } : {}),
          validFrom: { lte: at },
          OR: [{ validTo: null }, { validTo: { gte: at } }],
        },
        orderBy: { validFrom: "desc" },
      });
    }),

  /**
   * US-1.3 — listado paginado de tasas vigentes. Pensado para selectors UI
   * que necesitan "qué tasas hay disponibles ahora" sin cargar el histórico
   * completo.
   */
  listRates: tenantProcedure
    .input(
      z
        .object({
          at: z.coerce.date().optional(),
          rateType: fxRateTypeEnum.optional(),
          page: z.number().int().min(1).default(1),
          pageSize: z.number().int().min(1).max(100).default(50),
        })
        .default({ page: 1, pageSize: 50 }),
    )
    .query(async ({ ctx, input }) => {
      const at = input.at ?? new Date();
      const where = {
        ...(input.rateType ? { rateType: input.rateType } : {}),
        validFrom: { lte: at },
        OR: [{ validTo: null }, { validTo: { gt: at } }],
      };
      const skip = (input.page - 1) * input.pageSize;
      const [total, rows] = await Promise.all([
        ctx.prisma.exchangeRate.count({ where }),
        ctx.prisma.exchangeRate.findMany({
          where,
          orderBy: { validFrom: "desc" },
          skip,
          take: input.pageSize,
          include: {
            from: { select: { id: true, isoCode: true, symbol: true } },
            to: { select: { id: true, isoCode: true, symbol: true } },
          },
        }),
      ]);
      return {
        rows,
        total,
        page: input.page,
        pageSize: input.pageSize,
        pageCount: Math.max(1, Math.ceil(total / input.pageSize)),
      };
    }),

  /**
   * US-1.3 — Conversión utilitaria. Devuelve `{ rate, source, rateType }` o
   * null si no existe tasa vigente (ni con fallback). Cuando `from === to`
   * devuelve 1 sin consultar la BD.
   *
   * NO crea ni modifica tasas: es una query pura para Ledger/Encounter.
   */
  getRate: tenantProcedure
    .input(
      z.object({
        from: z.string().uuid(),
        to: z.string().uuid(),
        at: z.coerce.date().optional(),
        rateType: fxRateTypeEnum.optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (input.from === input.to) {
        return {
          rate: "1",
          rateType: "OFFICIAL" as const,
          source: "identity",
          validFrom: input.at ?? new Date(),
          isIdentity: true,
        };
      }
      const at = input.at ?? new Date();
      const types = input.rateType ? [input.rateType] : [...RATE_TYPE_FALLBACK];

      for (const t of types) {
        const row = await ctx.prisma.exchangeRate.findFirst({
          where: {
            fromCurrency: input.from,
            toCurrency: input.to,
            rateType: t,
            validFrom: { lte: at },
            OR: [{ validTo: null }, { validTo: { gt: at } }],
          },
          orderBy: { validFrom: "desc" },
        });
        if (row) {
          return {
            rate: row.rate.toString(),
            rateType: row.rateType,
            source: row.source,
            validFrom: row.validFrom,
            isIdentity: false,
          };
        }
      }
      return null;
    }),
});
