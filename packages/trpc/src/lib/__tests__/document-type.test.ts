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

  it("tipo del catálogo con validador reconocido (NIT) y número inválido — BAD_REQUEST", async () => {
    prisma.identifierType.findFirst.mockResolvedValue({ code: "NIT" } as never);

    await expect(
      validarTipoDocumentoPorPais(prisma, {
        countryId: COUNTRY_GT,
        documentType: "NIT",
        documentNumber: INVALID_NITS.badCheck,
      }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("tipo del catálogo con validador reconocido (NIT) y número válido — aceptado", async () => {
    prisma.identifierType.findFirst.mockResolvedValue({ code: "NIT" } as never);

    await expect(
      validarTipoDocumentoPorPais(prisma, {
        countryId: COUNTRY_GT,
        documentType: "NIT",
        documentNumber: VALID_NITS[0]!,
      }),
    ).resolves.toBeUndefined();
  });
});
