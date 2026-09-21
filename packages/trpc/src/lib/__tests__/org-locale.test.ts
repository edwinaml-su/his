/**
 * org-locale.test.ts — R2.1. Cubre el contrato de fallback exacto a SV
 * (regla de oro del plan de remediación) y la resolución multi-país (GT).
 */
import { describe, it, expect, vi } from "vitest";
import { resolverLocaleOrg, FALLBACK_ORG_LOCALE } from "../org-locale";

function makePrisma(orgResult: unknown) {
  return {
    organization: {
      findUnique: vi.fn().mockResolvedValue(orgResult),
    },
  };
}

describe("resolverLocaleOrg", () => {
  it("resuelve TZ/locale/moneda desde Organization -> Country/Currency (SV)", async () => {
    const prisma = makePrisma({
      country: {
        isoAlpha2: "SV",
        isoAlpha3: "SLV",
        defaultTzId: "America/El_Salvador",
        defaultLocale: "es-SV",
      },
      functionalCurr: { isoCode: "USD" },
    });

    const result = await resolverLocaleOrg(prisma, "org-sv");

    expect(result).toEqual({
      timeZone: "America/El_Salvador",
      locale: "es-SV",
      currencyCode: "USD",
      isoAlpha2: "SV",
      isoAlpha3: "SLV",
    });
    expect(prisma.organization.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "org-sv" } }),
    );
  });

  it("resuelve una organización de otro país (GT, sql/255)", async () => {
    const prisma = makePrisma({
      country: {
        isoAlpha2: "GT",
        isoAlpha3: "GTM",
        defaultTzId: "America/Guatemala",
        defaultLocale: "es-GT",
      },
      functionalCurr: { isoCode: "GTQ" },
    });

    const result = await resolverLocaleOrg(prisma, "org-gt");

    expect(result).toEqual({
      timeZone: "America/Guatemala",
      locale: "es-GT",
      currencyCode: "GTQ",
      isoAlpha2: "GT",
      isoAlpha3: "GTM",
    });
  });

  it("cae al fallback SV exacto cuando la organización no existe", async () => {
    const prisma = makePrisma(null);
    const result = await resolverLocaleOrg(prisma, "org-inexistente");
    expect(result).toEqual(FALLBACK_ORG_LOCALE);
  });

  it("cae al fallback SV exacto cuando el país no tiene defaultTzId/defaultLocale", async () => {
    const prisma = makePrisma({
      country: null,
      functionalCurr: { isoCode: "USD" },
    });
    const result = await resolverLocaleOrg(prisma, "org-sin-pais");
    expect(result).toEqual({ ...FALLBACK_ORG_LOCALE, currencyCode: "USD" });
  });

  it("cae al fallback de moneda (USD) cuando la organización no tiene moneda funcional resuelta", async () => {
    const prisma = makePrisma({
      country: {
        isoAlpha2: "SV",
        isoAlpha3: "SLV",
        defaultTzId: "America/El_Salvador",
        defaultLocale: "es-SV",
      },
      functionalCurr: null,
    });
    const result = await resolverLocaleOrg(prisma, "org-sin-moneda");
    expect(result.currencyCode).toBe("USD");
  });
});
