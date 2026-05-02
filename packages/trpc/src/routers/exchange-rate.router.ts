/**
 * US-1.3 — Router de tasas de cambio (multi-moneda).
 *
 * Procedures:
 *   - list        : listado paginado con filtros (par, tipo, rango de fechas).
 *   - create      : append-only. Si existe tasa vigente con misma combinación
 *                   (from/to/rateType), la cierra (validTo = nueva.validFrom)
 *                   ANTES de insertar la nueva. Toda la operación va en una
 *                   transacción Prisma para mantener la cadena temporal sin
 *                   solapamientos.
 *   - getCurrent  : devuelve la tasa vigente al timestamp `at` (default: now).
 *   - history     : audit trail completo para un par (todas las versiones).
 *
 * Patrón de versionado:
 *   - El histórico es INMUTABLE: nunca se hace UPDATE sobre `rate` ni DELETE.
 *   - Una "corrección" siempre genera un nuevo registro con un nuevo id; el
 *     registro anterior queda con `validTo` = `nueva.validFrom` (boundary
 *     half-open: [validFrom, validTo)).
 *   - La consulta de "vigente" usa: validFrom <= now AND (validTo IS NULL OR
 *     validTo > now). Coincide con currency.exchangeRates ya existente para
 *     evitar inconsistencias entre routers.
 *
 * Importación de schemas: replicados inline (mismo patrón que break-glass.router)
 * porque la barrel `@his/contracts/schemas/index.ts` está congelada. Si
 * divergen, la fuente de verdad es `packages/contracts/src/schemas/exchange-rate.ts`.
 *
 * Registro en _app.ts: lo hace @Orq tras consolidación, no este equipo.
 *
 * TODO(Sprint 2): permission check específico (solo ADMIN_FIN puede `create`).
 * TODO(Sprint 2): exponer `bulkImport` para la integración real BCR.
 * TODO(Sprint 5): tasa cruzada (from -> USD -> to) cuando no hay par directo.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { Prisma } from "@his/database";
import { router, tenantProcedure } from "../trpc";

// -----------------------------------------------------------------------------
// Schemas locales — espejo del canónico en
// `packages/contracts/src/schemas/exchange-rate.ts`. Replicados aquí porque
// `tsconfig.json` de @his/trpc fija `rootDir: src` (no permite imports fuera
// del package) y la barrel `@his/contracts/schemas/index.ts` está congelada
// en Sprint 1. Si divergen, prevalece el de contracts (single source of truth
// para clientes UI).
// -----------------------------------------------------------------------------

const VALID_FROM_FUTURE_LIMIT_DAYS = 30;

const fxRateTypeEnum = z.enum(["BUY", "SELL", "AVERAGE", "OFFICIAL", "FISCAL"]);

const fxRateValue = z
  .union([z.number(), z.string()])
  .transform((v, ctx) => {
    const s = typeof v === "number" ? String(v) : v.trim();
    if (!/^\d+(\.\d{1,8})?$/.test(s)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Tasa inválida: usar formato decimal con hasta 8 lugares.",
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

const exchangeRateCreateInput = z
  .object({
    fromCurrencyId: z.string().uuid(),
    toCurrencyId: z.string().uuid(),
    rateType: fxRateTypeEnum,
    rate: fxRateValue,
    validFrom: z.coerce.date(),
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

const exchangeRateListInput = z
  .object({
    fromCurrencyId: z.string().uuid().optional(),
    toCurrencyId: z.string().uuid().optional(),
    rateType: fxRateTypeEnum.optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    onlyCurrent: z.boolean().optional(),
    at: z.coerce.date().optional(),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(25),
  })
  .default({ page: 1, pageSize: 25 });

const exchangeRateGetCurrentInput = z.object({
  fromCurrencyId: z.string().uuid(),
  toCurrencyId: z.string().uuid(),
  rateType: fxRateTypeEnum,
  at: z.coerce.date().optional(),
});

const exchangeRateHistoryInput = z.object({
  fromCurrencyId: z.string().uuid(),
  toCurrencyId: z.string().uuid(),
  rateType: fxRateTypeEnum.optional(),
});

// -----------------------------------------------------------------------------
// Utilidades internas
// -----------------------------------------------------------------------------

function rethrowPrisma(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      // unique([fromCurrency, toCurrency, rateType, validFrom])
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "Ya existe una tasa para esa combinación (origen/destino/tipo) con la misma fecha de vigencia.",
      });
    }
    if (err.code === "P2003") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Moneda origen o destino no existe.",
      });
    }
  }
  throw err;
}

export const exchangeRateRouter = router({
  /**
   * Listado paginado para la UI admin. Por defecto trae el histórico completo
   * en orden descendente por `validFrom`. Si `onlyCurrent` viene en true,
   * filtra por vigentes a `at` (o now).
   */
  list: tenantProcedure.input(exchangeRateListInput).query(async ({ ctx, input }) => {
    const at = input.at ?? new Date();
    const where: Prisma.ExchangeRateWhereInput = {
      ...(input.fromCurrencyId ? { fromCurrency: input.fromCurrencyId } : {}),
      ...(input.toCurrencyId ? { toCurrency: input.toCurrencyId } : {}),
      ...(input.rateType ? { rateType: input.rateType } : {}),
      ...(input.from || input.to
        ? {
            validFrom: {
              ...(input.from ? { gte: input.from } : {}),
              ...(input.to ? { lte: input.to } : {}),
            },
          }
        : {}),
      ...(input.onlyCurrent
        ? {
            validFrom: { lte: at },
            OR: [{ validTo: null }, { validTo: { gt: at } }],
          }
        : {}),
    };

    const skip = (input.page - 1) * input.pageSize;
    const [total, rows] = await Promise.all([
      ctx.prisma.exchangeRate.count({ where }),
      ctx.prisma.exchangeRate.findMany({
        where,
        orderBy: [{ validFrom: "desc" }, { createdAt: "desc" }],
        skip,
        take: input.pageSize,
        include: {
          from: { select: { id: true, isoCode: true, name: true, symbol: true } },
          to: { select: { id: true, isoCode: true, name: true, symbol: true } },
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
   * Append-only: nunca update. Cierra la cadena temporal previa fijando
   * `validTo` del registro vigente (si existe) al momento `validFrom` de la
   * nueva tasa, y luego inserta. Va en transacción para evitar gaps/overlaps.
   */
  create: tenantProcedure.input(exchangeRateCreateInput).mutation(async ({ ctx, input }) => {
    // Doble check de existencia y "active" — Prisma FK solo verifica id.
    const [from, to] = await Promise.all([
      ctx.prisma.currency.findUnique({
        where: { id: input.fromCurrencyId },
        select: { id: true, active: true, isoCode: true },
      }),
      ctx.prisma.currency.findUnique({
        where: { id: input.toCurrencyId },
        select: { id: true, active: true, isoCode: true },
      }),
    ]);
    if (!from || !to) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Moneda origen o destino no existe." });
    }
    if (!from.active || !to.active) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Solo se pueden registrar tasas para monedas activas.",
      });
    }

    try {
      return await ctx.prisma.$transaction(async (tx) => {
        // Cierra la tasa vigente (si la hay) que se solape con la nueva.
        // Boundary: [validFrom, validTo) → la previa pasa a tener validTo
        // = nueva.validFrom (puede coincidir con validFrom previa pero NO se
        // hace si la previa tiene validFrom > nueva.validFrom: en tal caso
        // sería "tasa retroactiva" y dejamos al usuario gestionar conflicto
        // unique vía P2002).
        const current = await tx.exchangeRate.findFirst({
          where: {
            fromCurrency: input.fromCurrencyId,
            toCurrency: input.toCurrencyId,
            rateType: input.rateType,
            validFrom: { lte: input.validFrom },
            OR: [{ validTo: null }, { validTo: { gt: input.validFrom } }],
          },
          orderBy: { validFrom: "desc" },
        });

        if (current && current.validFrom < input.validFrom) {
          // Cerramos la cadena. NO modificamos `rate` ni otros campos:
          // solo el límite superior. Esto preserva la inmutabilidad histórica
          // del valor original.
          await tx.exchangeRate.update({
            where: { id: current.id },
            data: { validTo: input.validFrom },
          });
        } else if (current && current.validFrom.getTime() === input.validFrom.getTime()) {
          // Misma fecha exacta → unique constraint disparará P2002 en el insert.
          // Lo dejamos caer para que rethrowPrisma traduzca a CONFLICT legible.
        }

        return tx.exchangeRate.create({
          data: {
            fromCurrency: input.fromCurrencyId,
            toCurrency: input.toCurrencyId,
            rateType: input.rateType,
            rate: new Prisma.Decimal(input.rate),
            validFrom: input.validFrom,
            // validTo: null  → la nueva queda "abierta" hasta que llegue la siguiente.
            source: input.source ?? "manual",
          },
        });
      });
    } catch (err) {
      rethrowPrisma(err);
    }
  }),

  /**
   * Devuelve la tasa vigente al timestamp `at` (default: now) para una
   * combinación específica (from/to/rateType). NULL si no hay vigente.
   */
  getCurrent: tenantProcedure
    .input(exchangeRateGetCurrentInput)
    .query(async ({ ctx, input }) => {
      const at = input.at ?? new Date();
      return ctx.prisma.exchangeRate.findFirst({
        where: {
          fromCurrency: input.fromCurrencyId,
          toCurrency: input.toCurrencyId,
          rateType: input.rateType,
          validFrom: { lte: at },
          OR: [{ validTo: null }, { validTo: { gt: at } }],
        },
        orderBy: { validFrom: "desc" },
      });
    }),

  /**
   * Audit trail: lista todas las versiones históricas para un par
   * (opcionalmente filtradas por rateType). Inmutable por diseño.
   */
  history: tenantProcedure
    .input(exchangeRateHistoryInput)
    .query(async ({ ctx, input }) => {
      return ctx.prisma.exchangeRate.findMany({
        where: {
          fromCurrency: input.fromCurrencyId,
          toCurrency: input.toCurrencyId,
          ...(input.rateType ? { rateType: input.rateType } : {}),
        },
        orderBy: { validFrom: "asc" },
      });
    }),
});
