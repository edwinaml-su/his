/**
 * CC-A (auditoría 2026-09-18, P1) — tests de `validarTipoDocumentoPorPais`.
 *
 * Casos exigidos por el hallazgo: DUI inválido rechazado cuando type=DUI
 * (delegado al superRefine de contracts, no a este helper — ver
 * patient.test.ts), tipo del catálogo del país aceptado, tipo inexistente
 * rechazado.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { VALID_NITS, INVALID_NITS } from "@his/test-utils";
import { validarTipoDocumentoPorPais } from "../document-type";

const COUNTRY_GT = "00000000-0000-0000-0000-000000000001";

describe("validarTipoDocumentoPorPais", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  it("tipo legacy SV (DUI) — no consulta IdentifierType", async () => {
    await validarTipoDocumentoPorPais(prisma, {
      countryId: COUNTRY_GT,
      documentType: "DUI",
      documentNumber: "04829175-3",
    });

    expect(prisma.identifierType.findFirst).not.toHaveBeenCalled();
  });

  it("tipo legacy SV (CARNET_RESIDENCIA) — no consulta IdentifierType", async () => {
    await validarTipoDocumentoPorPais(prisma, {
      countryId: COUNTRY_GT,
      documentType: "CARNET_RESIDENCIA",
    });

    expect(prisma.identifierType.findFirst).not.toHaveBeenCalled();
  });

  it("tipo del catálogo del país (DPI, sin validador reconocido) — aceptado", async () => {
    prisma.identifierType.findFirst.mockResolvedValue({ code: "DPI" } as never);

    await expect(
      validarTipoDocumentoPorPais(prisma, {
        countryId: COUNTRY_GT,
        documentType: "DPI",
        documentNumber: "1234 56789 0101",
      }),
    ).resolves.toBeUndefined();
    expect(prisma.identifierType.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { countryId: COUNTRY_GT, code: "DPI", active: true },
      }),
    );
  });

  it("tipo inexistente/inactivo para el país — BAD_REQUEST", async () => {
    prisma.identifierType.findFirst.mockResolvedValue(null as never);

    await expect(
      validarTipoDocumentoPorPais(prisma, { countryId: COUNTRY_GT, documentType: "DPI" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("IdentifierType(SV,'NIT') con número inválido — BAD_REQUEST (algoritmo SV aplica)", async () => {
    const COUNTRY_SV = "00000000-0000-0000-0000-000000000002";
    prisma.identifierType.findFirst.mockResolvedValue({
      code: "NIT",
      country: { isoAlpha3: "SLV" },
    } as never);

    await expect(
      validarTipoDocumentoPorPais(prisma, {
        countryId: COUNTRY_SV,
        documentType: "NIT",
        documentNumber: INVALID_NITS.badCheck,
      }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("IdentifierType(SV,'NIT') con número válido — aceptado (algoritmo SV aplica)", async () => {
    const COUNTRY_SV = "00000000-0000-0000-0000-000000000002";
    prisma.identifierType.findFirst.mockResolvedValue({
      code: "NIT",
      country: { isoAlpha3: "SLV" },
    } as never);

    await expect(
      validarTipoDocumentoPorPais(prisma, {
        countryId: COUNTRY_SV,
        documentType: "NIT",
        documentNumber: VALID_NITS[0]!,
      }),
    ).resolves.toBeUndefined();
  });

  // P2-2 (revisión independiente 2026-09-19) — un IdentifierType con código
  // "NIT" de OTRO país (ej. GT) NO debe validarse con el algoritmo módulo-11
  // salvadoreño: un NIT guatemalteco legítimo rechazaría con ese algoritmo.
  it("IdentifierType(GT,'NIT') — NO aplica el algoritmo SV, acepta cualquier valor no vacío", async () => {
    prisma.identifierType.findFirst.mockResolvedValue({
      code: "NIT",
      country: { isoAlpha3: "GTM" },
    } as never);

    // INVALID_NITS.badCheck falla el módulo-11 salvadoreño — si el bug
    // estuviera presente, esto lanzaría BAD_REQUEST.
    await expect(
      validarTipoDocumentoPorPais(prisma, {
        countryId: COUNTRY_GT,
        documentType: "NIT",
        documentNumber: INVALID_NITS.badCheck,
      }),
    ).resolves.toBeUndefined();
  });
});
