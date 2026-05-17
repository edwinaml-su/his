/**
 * Tests del country router (list, create, update, deactivate, activate).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@his/database";
import { countryRouter } from "../country.router";
import { makeCtx } from "../../__tests__/helpers/caller";

function fn<T>(returnValue: T) {
  return vi.fn().mockResolvedValue(returnValue);
}

const COUNTRY = {
  id: "00000000-0000-0000-0000-000000000021",
  isoAlpha3: "SLV",
  isoNumeric: 222,
  name: "El Salvador",
  active: true,
  defaultLocale: "es-SV",
  defaultTzId: "America/El_Salvador",
};

describe("countryRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  // ------------------------------------------------------------------ list
  describe("list", () => {
    it("lista paises activos cuando activeOnly=true", async () => {
      prisma.country.findMany.mockResolvedValue([COUNTRY] as never);

      const caller = countryRouter.createCaller(makeCtx({ prisma }));
      await caller.list({ activeOnly: true });

      expect(prisma.country.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ active: true }),
        }),
      );
    });

    it("sin filtro active cuando activeOnly=false", async () => {
      prisma.country.findMany.mockResolvedValue([COUNTRY] as never);

      const caller = countryRouter.createCaller(makeCtx({ prisma }));
      await caller.list({ activeOnly: false });

      const callArg = prisma.country.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(callArg.where).not.toHaveProperty("active");
    });

    it("aplica filtro OR name/iso3 cuando hay search", async () => {
      prisma.country.findMany.mockResolvedValue([COUNTRY] as never);

      const caller = countryRouter.createCaller(makeCtx({ prisma }));
      await caller.list({ search: "Salvador" });

      const callArg = prisma.country.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(callArg.where).toHaveProperty("OR");
    });
  });

  // ------------------------------------------------------------------ create
  describe("create", () => {
    it("crea un pais y retorna el registro", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = mockDeep<PrismaClient>();
        tx.country.create.mockResolvedValue(COUNTRY as never);
        tx.countryCurrency.updateMany.mockResolvedValue({ count: 0 } as never);
        tx.countryCurrency.upsert.mockResolvedValue({} as never);
        return fn(tx);
      });

      const caller = countryRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.create({
        isoAlpha3: "SLV",
        isoNumeric: 222,
        name: "El Salvador",
        defaultLocale: "es-SV",
        defaultTzId: "America/El_Salvador",
      });

      expect(result).toMatchObject({ isoAlpha3: "SLV" });
    });

    it("lanza CONFLICT con mensaje legible cuando P2002", async () => {
      const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint", {
        code: "P2002",
        clientVersion: "5.0.0",
        meta: { target: ["isoAlpha3"] },
      });
      prisma.$transaction.mockRejectedValue(p2002 as never);

      const caller = countryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.create({
          isoAlpha3: "SLV",
          isoNumeric: 222,
          name: "Duplicado",
          defaultLocale: "es-SV",
          defaultTzId: "America/El_Salvador",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  // ------------------------------------------------------------------ deactivate
  describe("deactivate", () => {
    it("lanza BAD_REQUEST si existen orgs activas en el pais", async () => {
      prisma.organization.count.mockResolvedValue(2 as never);

      const caller = countryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.deactivate({ id: COUNTRY.id }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("desactiva el pais cuando no hay orgs activas", async () => {
      prisma.organization.count.mockResolvedValue(0 as never);
      prisma.country.update.mockResolvedValue({ ...COUNTRY, active: false } as never);

      const caller = countryRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.deactivate({ id: COUNTRY.id });

      expect(result.active).toBe(false);
    });

    it("lanza NOT_FOUND (P2025) si el id no existe", async () => {
      prisma.organization.count.mockResolvedValue(0 as never);
      const p2025 = new Prisma.PrismaClientKnownRequestError("Not found", {
        code: "P2025",
        clientVersion: "5.0.0",
      });
      prisma.country.update.mockRejectedValue(p2025 as never);

      const caller = countryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.deactivate({ id: "00000000-0000-0000-0000-000000000000" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // ------------------------------------------------------------------ activate
  describe("activate", () => {
    it("reactiva un pais previamente desactivado", async () => {
      prisma.country.update.mockResolvedValue({ ...COUNTRY, active: true } as never);

      const caller = countryRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.activate({ id: COUNTRY.id });

      expect(result.active).toBe(true);
      expect(prisma.country.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { active: true } }),
      );
    });
  });
});
