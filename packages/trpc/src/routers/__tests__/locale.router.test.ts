/**
 * Tests del locale router (geoDivisions, holidays, currentLocale).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { localeRouter } from "../locale.router";
import { makeCtx } from "../../__tests__/helpers/caller";

describe("localeRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  // ------------------------------------------------------------------ currentLocale
  describe("currentLocale", () => {
    it("retorna el fallback SV sin consultar la BD cuando no hay ctx.tenant (público, ej. login)", async () => {
      const caller = localeRouter.createCaller(makeCtx({ prisma, tenant: null }));
      const result = await caller.currentLocale();

      expect(result).toMatchObject({
        country: "SV",
        isoAlpha3: "SLV",
        locale: "es-SV",
        timezone: "America/El_Salvador",
        currency: "USD",
      });
      expect(prisma.organization.findUnique).not.toHaveBeenCalled();
    });

    it("resuelve TZ/locale/moneda de la organización del tenant vía resolverLocaleOrg (SV)", async () => {
      prisma.organization.findUnique.mockResolvedValue({
        country: {
          isoAlpha2: "SV",
          isoAlpha3: "SLV",
          defaultTzId: "America/El_Salvador",
          defaultLocale: "es-SV",
        },
        functionalCurr: { isoCode: "USD" },
      } as never);

      const caller = localeRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.currentLocale();

      expect(result).toMatchObject({
        country: "SV",
        isoAlpha3: "SLV",
        locale: "es-SV",
        timezone: "America/El_Salvador",
        currency: "USD",
      });
      expect(prisma.organization.findUnique).toHaveBeenCalled();
    });

    it("resuelve una organización GT (sql/255) — R2.1: multi-país deja de ser accidente de offset", async () => {
      prisma.organization.findUnique.mockResolvedValue({
        country: {
          isoAlpha2: "GT",
          isoAlpha3: "GTM",
          defaultTzId: "America/Guatemala",
          defaultLocale: "es-GT",
        },
        functionalCurr: { isoCode: "GTQ" },
      } as never);

      const caller = localeRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.currentLocale();

      expect(result).toMatchObject({
        country: "GT",
        isoAlpha3: "GTM",
        locale: "es-GT",
        timezone: "America/Guatemala",
        currency: "GTQ",
      });
    });

    it("cae al fallback SV si la organización del tenant no se encuentra", async () => {
      prisma.organization.findUnique.mockResolvedValue(null as never);
      const caller = localeRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.currentLocale();
      expect(result).toMatchObject({
        country: "SV",
        isoAlpha3: "SLV",
        locale: "es-SV",
        timezone: "America/El_Salvador",
        currency: "USD",
      });
    });
  });

  // ------------------------------------------------------------------ geoDivisions
  describe("geoDivisions", () => {
    it("retorna [] si el pais no existe en BD", async () => {
      prisma.country.findUnique.mockResolvedValue(null as never);

      const caller = localeRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.geoDivisions({ countryIso3: "XXX" });

      expect(result).toEqual([]);
    });

    it("usa SLV como iso3 por defecto cuando no se especifica", async () => {
      prisma.country.findUnique.mockResolvedValue({ id: "cid-slv" } as never);
      prisma.geoDivision.findMany.mockResolvedValue([] as never);

      const caller = localeRouter.createCaller(makeCtx({ prisma }));
      await caller.geoDivisions();

      expect(prisma.country.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isoAlpha3: "SLV" } }),
      );
    });

    it("pasa level y parentId al where cuando se especifican", async () => {
      prisma.country.findUnique.mockResolvedValue({ id: "cid-slv" } as never);
      prisma.geoDivision.findMany.mockResolvedValue([] as never);

      const caller = localeRouter.createCaller(makeCtx({ prisma }));
      await caller.geoDivisions({
        level: 2,
        parentId: "00000000-0000-0000-0000-000000000010",
      });

      expect(prisma.geoDivision.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            level: 2,
            parentId: "00000000-0000-0000-0000-000000000010",
          }),
        }),
      );
    });
  });

  // ------------------------------------------------------------------ holidays
  describe("holidays", () => {
    it("retorna [] si el pais no existe en BD", async () => {
      prisma.country.findUnique.mockResolvedValue(null as never);

      const caller = localeRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.holidays({ countryIso3: "XXX" });

      expect(result).toEqual([]);
    });

    it("usa el anio actual cuando no se especifica", async () => {
      prisma.country.findUnique.mockResolvedValue({ id: "cid-slv" } as never);
      prisma.holiday.findMany.mockResolvedValue([] as never);

      const caller = localeRouter.createCaller(makeCtx({ prisma }));
      await caller.holidays();

      const year = new Date().getUTCFullYear();
      expect(prisma.holiday.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            date: {
              gte: new Date(Date.UTC(year, 0, 1)),
              lt: new Date(Date.UTC(year + 1, 0, 1)),
            },
          }),
        }),
      );
    });

    it("usa el anio especificado en el filtro de fechas", async () => {
      prisma.country.findUnique.mockResolvedValue({ id: "cid-slv" } as never);
      prisma.holiday.findMany.mockResolvedValue([] as never);

      const caller = localeRouter.createCaller(makeCtx({ prisma }));
      await caller.holidays({ year: 2026 });

      expect(prisma.holiday.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            date: {
              gte: new Date(Date.UTC(2026, 0, 1)),
              lt: new Date(Date.UTC(2027, 0, 1)),
            },
          }),
        }),
      );
    });
  });
});
