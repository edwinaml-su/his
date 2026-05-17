/**
 * Tests del currency router (list, exchangeRates, listRates, getRate).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { currencyRouter } from "../currency.router";
import { makeCtx } from "../../__tests__/helpers/caller";

const USD_ID = "00000000-0000-0000-0000-000000000031";
const EUR_ID = "00000000-0000-0000-0000-000000000032";

const RATE_ROW = {
  id: "rr1",
  fromCurrency: USD_ID,
  toCurrency: EUR_ID,
  rate: { toString: () => "0.92" },
  rateType: "OFFICIAL",
  source: "ECB",
  validFrom: new Date("2025-01-01"),
  validTo: null,
};

describe("currencyRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  // ------------------------------------------------------------------ list
  describe("list", () => {
    it("retorna monedas activas ordenadas por isoCode", async () => {
      const currencies = [
        { id: USD_ID, isoCode: "USD", active: true },
        { id: EUR_ID, isoCode: "EUR", active: true },
      ];
      prisma.currency.findMany.mockResolvedValue(currencies as never);

      const caller = currencyRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.list();

      expect(result).toHaveLength(2);
      expect(prisma.currency.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { active: true } }),
      );
    });
  });

  // ------------------------------------------------------------------ exchangeRates
  describe("exchangeRates", () => {
    it("devuelve tasas vigentes a la fecha indicada", async () => {
      prisma.exchangeRate.findMany.mockResolvedValue([RATE_ROW] as never);

      const caller = currencyRouter.createCaller(makeCtx({ prisma }));
      const at = new Date("2025-06-01");
      const result = await caller.exchangeRates({ at });

      expect(result).toHaveLength(1);
      expect(prisma.exchangeRate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ validFrom: { lte: at } }),
        }),
      );
    });

    it("filtra por fromCurrency y toCurrency cuando se proveen", async () => {
      prisma.exchangeRate.findMany.mockResolvedValue([] as never);

      const caller = currencyRouter.createCaller(makeCtx({ prisma }));
      await caller.exchangeRates({ fromCurrency: USD_ID, toCurrency: EUR_ID });

      expect(prisma.exchangeRate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            fromCurrency: USD_ID,
            toCurrency: EUR_ID,
          }),
        }),
      );
    });
  });

  // ------------------------------------------------------------------ getRate
  describe("getRate", () => {
    it("retorna rate=1 y isIdentity=true cuando from===to sin consultar BD", async () => {
      const caller = currencyRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.getRate({ from: USD_ID, to: USD_ID });

      expect(result).toMatchObject({ rate: "1", isIdentity: true });
      expect(prisma.exchangeRate.findFirst).not.toHaveBeenCalled();
    });

    it("retorna la tasa encontrada con fallback OFFICIAL primero", async () => {
      prisma.exchangeRate.findFirst.mockResolvedValue(RATE_ROW as never);

      const caller = currencyRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.getRate({ from: USD_ID, to: EUR_ID });

      expect(result).toMatchObject({ rate: "0.92", rateType: "OFFICIAL", isIdentity: false });
      expect(prisma.exchangeRate.findFirst).toHaveBeenCalledTimes(1);
    });

    it("retorna null si no hay tasa para el par", async () => {
      prisma.exchangeRate.findFirst.mockResolvedValue(null as never);

      const caller = currencyRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.getRate({ from: USD_ID, to: EUR_ID });

      expect(result).toBeNull();
      // Itera todos los fallback types (OFFICIAL, AVERAGE, FISCAL, SELL, BUY)
      expect(prisma.exchangeRate.findFirst).toHaveBeenCalledTimes(5);
    });

    it("cuando se especifica rateType no itera fallback", async () => {
      prisma.exchangeRate.findFirst.mockResolvedValue(null as never);

      const caller = currencyRouter.createCaller(makeCtx({ prisma }));
      await caller.getRate({ from: USD_ID, to: EUR_ID, rateType: "BUY" });

      expect(prisma.exchangeRate.findFirst).toHaveBeenCalledTimes(1);
    });
  });

  // ------------------------------------------------------------------ listRates
  describe("listRates", () => {
    it("devuelve paginacion con pageCount calculado", async () => {
      prisma.exchangeRate.count.mockResolvedValue(25 as never);
      prisma.exchangeRate.findMany.mockResolvedValue([] as never);

      const caller = currencyRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.listRates({ page: 1, pageSize: 10 });

      expect(result.total).toBe(25);
      expect(result.pageCount).toBe(3);
    });

    it("pageCount minimo es 1 cuando total=0", async () => {
      prisma.exchangeRate.count.mockResolvedValue(0 as never);
      prisma.exchangeRate.findMany.mockResolvedValue([] as never);

      const caller = currencyRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.listRates();

      expect(result.pageCount).toBe(1);
    });
  });
});
