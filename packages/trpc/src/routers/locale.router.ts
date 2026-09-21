/**
 * US-7.1 / US-7.2 / US-7.4 — Router de localización SV.
 *
 * - geoDivisions: lista deptos/municipios/distritos. Filtros opcionales.
 * - holidays:     lista feriados (default año actual SV).
 * - currentLocale: devuelve perfil locale es-SV / America/El_Salvador.
 *
 * NOTA: este router se publica como módulo pero su registro en `_app.ts`
 * lo realiza el equipo dueño del root router (no nosotros). Se exporta
 * como `localeRouter` para wiring posterior.
 *
 * Los schemas Zod se replican aquí inline (mismas reglas que
 * `@his/contracts/src/schemas/locale.ts`) porque el barrel `@his/contracts`
 * todavía no incluye `locale.ts` y la `rootDir` de este paquete impide
 * imports cross-package por ruta relativa. El día que el barrel se amplíe,
 * basta sustituir las constantes locales por imports desde `@his/contracts`.
 */
import { z } from "zod";
import { router, publicProcedure } from "../trpc";
import { resolverLocaleOrg, FALLBACK_ORG_LOCALE } from "../lib/org-locale";

const geoLevelSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

const geoDivisionsInput = z
  .object({
    countryIso3: z.string().length(3).optional(),
    level: geoLevelSchema.optional(),
    parentId: z.string().uuid().optional(),
  })
  .optional();

const holidaysInput = z
  .object({
    countryIso3: z.string().length(3).optional(),
    year: z.number().int().min(2000).max(2100).optional(),
  })
  .optional();

export const localeRouter = router({
  /**
   * Lista divisiones geográficas. Por defecto devuelve los 14 departamentos
   * de SV. Pasar `level: 2` y `parentId` para drill-down a municipios.
   */
  geoDivisions: publicProcedure.input(geoDivisionsInput).query(async ({ ctx, input }) => {
    const iso3 = input?.countryIso3 ?? "SLV";
    const country = await ctx.prisma.country.findUnique({
      where: { isoAlpha3: iso3 },
      select: { id: true },
    });
    if (!country) return [];

    return ctx.prisma.geoDivision.findMany({
      where: {
        countryId: country.id,
        ...(input?.level !== undefined ? { level: input.level } : {}),
        ...(input?.parentId !== undefined ? { parentId: input.parentId } : {}),
        validTo: null,
      },
      orderBy: [{ level: "asc" }, { code: "asc" }],
      select: {
        id: true,
        countryId: true,
        parentId: true,
        level: true,
        code: true,
        name: true,
        validFrom: true,
      },
    });
  }),

  /** Lista feriados del país y año (default: año actual SV). */
  holidays: publicProcedure.input(holidaysInput).query(async ({ ctx, input }) => {
    const iso3 = input?.countryIso3 ?? "SLV";
    const country = await ctx.prisma.country.findUnique({
      where: { isoAlpha3: iso3 },
      select: { id: true },
    });
    if (!country) return [];

    const year = input?.year ?? new Date().getUTCFullYear();
    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year + 1, 0, 1));

    return ctx.prisma.holiday.findMany({
      where: {
        countryId: country.id,
        date: { gte: start, lt: end },
      },
      orderBy: { date: "asc" },
      select: {
        id: true,
        date: true,
        name: true,
        kind: true,
        recurring: true,
        geoDivisionId: true,
      },
    });
  }),

  /**
   * Perfil de localización aplicable al usuario. R2.2 (plan remediación
   * 2026-09): antes devolvía siempre el estático SV; ahora resuelve la TZ/
   * locale/moneda reales de `ctx.tenant.organizationId` vía
   * `resolverLocaleOrg`. `currentLocale` es `publicProcedure` (se consume
   * antes del login, ej. pantalla de login) — sin `ctx.tenant` no hay
   * organización que resolver, así que se devuelve el fallback SV exacto
   * SIN tocar la BD (mismo comportamiento observable de antes para ese caso).
   *
   * `dateFormat` queda fijo en "DD/MM/AAAA": no hay columna en `Country`
   * que lo modele todavía (gap conocido, no bloquea R2.1/R2.2 porque GT usa
   * el mismo formato que SV).
   */
  currentLocale: publicProcedure.query(async ({ ctx }) => {
    const organizationId = ctx.tenant?.organizationId;
    const resolved = organizationId
      ? await resolverLocaleOrg(ctx.prisma, organizationId)
      : FALLBACK_ORG_LOCALE;

    return {
      country: resolved.isoAlpha2 ?? FALLBACK_ORG_LOCALE.isoAlpha2,
      isoAlpha3: resolved.isoAlpha3,
      locale: resolved.locale,
      timezone: resolved.timeZone,
      currency: resolved.currencyCode,
      dateFormat: "DD/MM/AAAA",
    };
  }),
});
