/**
 * US-1.1 — Crear y administrar Países.
 *
 * Reglas de negocio:
 *  - ISO 3166-1 alpha-3 (`isoAlpha3`) y numeric (`isoNumeric`) son únicos a nivel DB.
 *    Mapeamos P2002 → CONFLICT con mensaje legible.
 *  - No se puede `deactivate` un país que tenga Organizations activas
 *    (countryId apunta a este país y `active=true`). Se valida ANTES de tocar la fila.
 *  - `defaultCurrencyId` opcional: si se provee al crear/actualizar, se enlaza/upsertea
 *    `CountryCurrency` con `isFunctional=true, isLegalTender=true`. La columna
 *    `defaultCurrencyId` no existe en el modelo Country actual (relación
 *    Country↔Currency es M:N vía CountryCurrency), así que reflejamos la "moneda
 *    funcional por defecto" como un upsert sobre la tabla puente.
 *
 * Procedures:
 *  - list (público): listado con filtro opcional por nombre/iso3 y activeOnly.
 *  - create / update / deactivate / activate: protectedProcedure (super-admin TI).
 *
 * TODO(Sprint 2): chequeo de rol específico (`requireRole(["SUPER_ADMIN"])`)
 * cuando el RBAC quede consolidado en @his/contracts.
 */
import { TRPCError } from "@trpc/server";
import { Prisma } from "@his/database";
import {
  countryCreateInput,
  countryUpdateInput,
  countryDeactivateInput,
  countryActivateInput,
  countryListInput,
} from "@his/contracts";
import { router, publicProcedure, protectedProcedure } from "../trpc";

/** Convierte errores Prisma comunes en TRPCError con mensaje es-SV. */
function rethrowPrisma(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      const target = (err.meta?.target as string[] | undefined)?.join(", ") ?? "campo único";
      throw new TRPCError({
        code: "CONFLICT",
        message: `Ya existe un país con el mismo ${target}.`,
      });
    }
    if (err.code === "P2025") {
      throw new TRPCError({ code: "NOT_FOUND", message: "País no encontrado." });
    }
  }
  throw err;
}

/**
 * Upsert de la moneda funcional del país en la tabla puente CountryCurrency.
 * Marca la nueva como `isFunctional=true` y desmarca cualquier otra.
 */
async function setFunctionalCurrency(
  prisma: Prisma.TransactionClient,
  countryId: string,
  currencyId: string,
) {
  // Desmarcar cualquier otra moneda funcional del país.
  await prisma.countryCurrency.updateMany({
    where: { countryId, NOT: { currencyId } },
    data: { isFunctional: false },
  });

  await prisma.countryCurrency.upsert({
    where: { countryId_currencyId: { countryId, currencyId } },
    create: {
      countryId,
      currencyId,
      isFunctional: true,
      isLegalTender: true,
    },
    update: {
      isFunctional: true,
      isLegalTender: true,
    },
  });
}

export const countryRouter = router({
  /** Listado con búsqueda por nombre / iso3 y filtro de activos. */
  list: publicProcedure.input(countryListInput).query(async ({ ctx, input }) => {
    const search = input?.search?.trim();
    const activeOnly = input?.activeOnly ?? false;

    return ctx.prisma.country.findMany({
      where: {
        ...(activeOnly ? { active: true } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { isoAlpha3: { contains: search.toUpperCase() } },
              ],
            }
          : {}),
      },
      include: {
        currencies: {
          where: { isFunctional: true },
          include: { currency: true },
          take: 1,
        },
      },
      orderBy: { name: "asc" },
    });
  }),

  create: protectedProcedure.input(countryCreateInput).mutation(async ({ ctx, input }) => {
    const { defaultCurrencyId, isoAlpha2, nameLocal, ...rest } = input;
    void isoAlpha2;
    void nameLocal; // Reservados para futura columna; no existen aún en schema.

    try {
      const country = await ctx.prisma.$transaction(async (tx) => {
        const created = await tx.country.create({
          data: {
            isoAlpha3: rest.isoAlpha3,
            isoNumeric: rest.isoNumeric,
            name: rest.name,
            defaultLocale: rest.defaultLocale,
            defaultTzId: rest.defaultTzId,
            ...(rest.active !== undefined ? { active: rest.active } : {}),
          },
        });

        if (defaultCurrencyId) {
          await setFunctionalCurrency(tx, created.id, defaultCurrencyId);
        }

        return created;
      });
      return country;
    } catch (err) {
      rethrowPrisma(err);
    }
  }),

  update: protectedProcedure.input(countryUpdateInput).mutation(async ({ ctx, input }) => {
    const { id, defaultCurrencyId, isoAlpha2, nameLocal, ...patch } = input;
    void isoAlpha2;
    void nameLocal;

    try {
      const country = await ctx.prisma.$transaction(async (tx) => {
        const updated = await tx.country.update({
          where: { id },
          data: {
            ...(patch.isoAlpha3 !== undefined ? { isoAlpha3: patch.isoAlpha3 } : {}),
            ...(patch.isoNumeric !== undefined ? { isoNumeric: patch.isoNumeric } : {}),
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.defaultLocale !== undefined ? { defaultLocale: patch.defaultLocale } : {}),
            ...(patch.defaultTzId !== undefined ? { defaultTzId: patch.defaultTzId } : {}),
          },
        });

        if (defaultCurrencyId) {
          await setFunctionalCurrency(tx, id, defaultCurrencyId);
        }

        return updated;
      });
      return country;
    } catch (err) {
      rethrowPrisma(err);
    }
  }),

  /**
   * Desactiva un país (soft delete). Bloquea si existen Organizations activas
   * que dependan del countryId — en ese caso lanza BAD_REQUEST con detalle.
   */
  deactivate: protectedProcedure
    .input(countryDeactivateInput)
    .mutation(async ({ ctx, input }) => {
      const orgCount = await ctx.prisma.organization.count({
        where: { countryId: input.id, active: true },
      });
      if (orgCount > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `No se puede desactivar: existen ${orgCount} organización(es) activa(s) en este país.`,
        });
      }

      try {
        return await ctx.prisma.country.update({
          where: { id: input.id },
          data: { active: false },
        });
      } catch (err) {
        rethrowPrisma(err);
      }
    }),

  /** Reactiva un país previamente desactivado. */
  activate: protectedProcedure.input(countryActivateInput).mutation(async ({ ctx, input }) => {
    try {
      return await ctx.prisma.country.update({
        where: { id: input.id },
        data: { active: true },
      });
    } catch (err) {
      rethrowPrisma(err);
    }
  }),
});
