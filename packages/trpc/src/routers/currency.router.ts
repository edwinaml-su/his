import { z } from "zod";
import { router, publicProcedure } from "../trpc";

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
});
