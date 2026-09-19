/**
 * org-locale.ts — R2.1 (Plan remediación 2026-09).
 *
 * Auditoría 2026-09-18: TZ/locale/moneda eran constantes globales
 * ("America/El_Salvador" / "es-SV" / "USD" hardcodeadas) pese a que
 * `Country.defaultTzId`/`defaultLocale` YA están modelados y sembrados (SV +
 * GT desde sql/255). Este helper es el punto único de resolución
 * `Organization -> Country` (+ moneda funcional) para que el resto del
 * código deje de asumir SV.
 *
 * REGLA DE ORO: el fallback es EXACTAMENTE el comportamiento histórico —
 * `America/El_Salvador` / `es-SV` / `USD` — si la organización no existe o
 * si falta cualquier eslabón (país sin defaultTzId/defaultLocale, sin
 * moneda funcional). Cero cambio observable para las orgs SV.
 *
 * No cachea entre requests: en un runtime serverless (Vercel) un caché por
 * proceso podría filtrar el resultado de una organización a otra. Si un
 * caller necesita reusar el resultado dentro del mismo request, es
 * responsabilidad del caller (ver `resolverLocaleOrgCacheado` más abajo,
 * pensado para un único request con varias llamadas al mismo org).
 */

export interface OrgLocale {
  timeZone: string;
  /** BCP-47, ej. "es-SV" / "es-GT". */
  locale: string;
  /** ISO-4217 de la moneda funcional de la organización. */
  currencyCode: string;
  /** ISO 3166-1 alfa-2 del país (nullable en BD — ver Country.isoAlpha2). */
  isoAlpha2: string | null;
  /** ISO 3166-1 alfa-3 del país. */
  isoAlpha3: string;
}

export const FALLBACK_ORG_LOCALE: OrgLocale = {
  timeZone: "America/El_Salvador",
  locale: "es-SV",
  currencyCode: "USD",
  isoAlpha2: "SV",
  isoAlpha3: "SLV",
};

/** Subconjunto de PrismaClient que necesita este helper (facilita mockear en tests). */
type PrismaLike = {
  organization: {
    findUnique: (args: {
      where: { id: string };
      select: {
        country: {
          select: {
            isoAlpha2: true;
            isoAlpha3: true;
            defaultTzId: true;
            defaultLocale: true;
          };
        };
        functionalCurr: { select: { isoCode: true } };
      };
    }) => Promise<{
      country: {
        isoAlpha2: string | null;
        isoAlpha3: string;
        defaultTzId: string;
        defaultLocale: string;
      } | null;
      functionalCurr: { isoCode: string } | null;
    } | null>;
  };
};

/**
 * Resuelve TZ/locale/moneda de una organización vía
 * `Organization.countryId -> Country.defaultTzId/defaultLocale` +
 * `Organization.functionalCurrency -> Currency.isoCode`.
 *
 * Acepta tanto `ctx.prisma` como el `tx` de `withTenantContext` — es una
 * lectura de datos de referencia (país/moneda), no PHI, así que no exige
 * contexto tenant demotado; los call sites que ya están dentro de un `tx`
 * simplemente lo reusan.
 */
export async function resolverLocaleOrg(
  prisma: PrismaLike,
  organizationId: string,
): Promise<OrgLocale> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      country: {
        select: { isoAlpha2: true, isoAlpha3: true, defaultTzId: true, defaultLocale: true },
      },
      functionalCurr: { select: { isoCode: true } },
    },
  });
  if (!org) return FALLBACK_ORG_LOCALE;

  return {
    timeZone: org.country?.defaultTzId ?? FALLBACK_ORG_LOCALE.timeZone,
    locale: org.country?.defaultLocale ?? FALLBACK_ORG_LOCALE.locale,
    currencyCode: org.functionalCurr?.isoCode ?? FALLBACK_ORG_LOCALE.currencyCode,
    isoAlpha2: org.country?.isoAlpha2 ?? FALLBACK_ORG_LOCALE.isoAlpha2,
    isoAlpha3: org.country?.isoAlpha3 ?? FALLBACK_ORG_LOCALE.isoAlpha3,
  };
}
