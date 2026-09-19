/**
 * CC-A (auditoría 2026-09-18, P1) — tests de `resolverVatRate`.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { resolverVatRate, DEFAULT_VAT_RATE } from "../vat";

const ORG_ID = "00000000-0000-0000-0000-000000000001";

describe("resolverVatRate", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  it("usa Country.vatRate cuando la org tiene país configurado", async () => {
    prisma.organization.findUnique.mockResolvedValue({
      country: { vatRate: { toNumber: () => 0.12 } },
    } as never);

    const rate = await resolverVatRate(prisma, ORG_ID);

    expect(rate).toBe(0.12);
  });

  it("default 0.13 si la org no tiene país configurado", async () => {
    prisma.organization.findUnique.mockResolvedValue({ country: null } as never);

    const rate = await resolverVatRate(prisma, ORG_ID);

    expect(rate).toBe(DEFAULT_VAT_RATE);
  });

  it("default 0.13 si la organización no existe", async () => {
    prisma.organization.findUnique.mockResolvedValue(null as never);

    const rate = await resolverVatRate(prisma, ORG_ID);

    expect(rate).toBe(DEFAULT_VAT_RATE);
  });
});
