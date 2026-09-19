/**
 * CC-A (auditoría 2026-09-18, P0) — tests de `resolverTasaFuncional`.
 *
 * Los 3 casos exigidos por el hallazgo: moneda funcional ⇒ 1 sin query extra,
 * moneda distinta con tasa vigente ⇒ tasa aplicada, sin tasa ⇒
 * PRECONDITION_FAILED (nunca 1 silencioso).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { resolverTasaFuncional, buscarTasaVigente } from "../exchange";

const ORG_ID = "00000000-0000-0000-0000-000000000001";
const USD_ID = "00000000-0000-0000-0000-000000000031";
const GTQ_ID = "00000000-0000-0000-0000-000000000032";

function rateRow(rate: number, rateType = "AVERAGE") {
  return {
    id: "rr1",
    fromCurrency: GTQ_ID,
    toCurrency: USD_ID,
    rate: { toNumber: () => rate },
    rateType,
    validFrom: new Date("2025-01-01"),
    validTo: null,
  };
}

describe("resolverTasaFuncional", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    prisma.organization.findUnique.mockResolvedValue({
      functionalCurrency: USD_ID,
    } as never);
  });

  it("moneda funcional (currencyId === functionalCurrency) ⇒ 1 sin consultar ExchangeRate", async () => {
    const result = await resolverTasaFuncional(prisma, {
      organizationId: ORG_ID,
      currencyId: USD_ID,
    });

    expect(result).toBe(1);
    expect(prisma.exchangeRate.findFirst).not.toHaveBeenCalled();
  });

  it("con `functionalCurrencyId` provisto por el caller, no consulta Organization", async () => {
    const result = await resolverTasaFuncional(prisma, {
      organizationId: ORG_ID,
      currencyId: USD_ID,
      functionalCurrencyId: USD_ID,
    });

    expect(result).toBe(1);
    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
  });

  it("moneda distinta con tasa vigente ⇒ aplica la tasa encontrada", async () => {
    prisma.exchangeRate.findFirst.mockResolvedValue(rateRow(7.75) as never);

    const result = await resolverTasaFuncional(prisma, {
      organizationId: ORG_ID,
      currencyId: GTQ_ID,
    });

    expect(result).toBe(7.75);
    expect(prisma.exchangeRate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ fromCurrency: GTQ_ID, toCurrency: USD_ID }),
      }),
    );
  });

  it("moneda distinta sin tasa vigente ⇒ PRECONDITION_FAILED (nunca 1 silencioso)", async () => {
    prisma.exchangeRate.findFirst.mockResolvedValue(null as never);

    await expect(
      resolverTasaFuncional(prisma, { organizationId: ORG_ID, currencyId: GTQ_ID }),
    ).rejects.toThrow(TRPCError);
    await expect(
      resolverTasaFuncional(prisma, { organizationId: ORG_ID, currencyId: GTQ_ID }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("organización sin moneda funcional configurada ⇒ PRECONDITION_FAILED", async () => {
    prisma.organization.findUnique.mockResolvedValue({ functionalCurrency: null } as never);

    await expect(
      resolverTasaFuncional(prisma, { organizationId: ORG_ID, currencyId: GTQ_ID }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

describe("buscarTasaVigente", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  it("itera el fallback OFFICIAL→AVERAGE→FISCAL→SELL→BUY hasta encontrar tasa", async () => {
    prisma.exchangeRate.findFirst
      .mockResolvedValueOnce(null as never) // OFFICIAL
      .mockResolvedValueOnce(rateRow(7.75) as never); // AVERAGE

    const result = await buscarTasaVigente(prisma, { from: GTQ_ID, to: USD_ID });

    expect(result?.rateType).toBe("AVERAGE");
    expect(prisma.exchangeRate.findFirst).toHaveBeenCalledTimes(2);
  });

  it("con rateType explícito no itera fallback", async () => {
    prisma.exchangeRate.findFirst.mockResolvedValue(null as never);

    await buscarTasaVigente(prisma, { from: GTQ_ID, to: USD_ID, rateType: "BUY" });

    expect(prisma.exchangeRate.findFirst).toHaveBeenCalledTimes(1);
  });
});
