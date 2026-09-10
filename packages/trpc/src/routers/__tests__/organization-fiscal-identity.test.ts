/**
 * Tests del procedure organization.updateFiscalIdentity (parametrización
 * admin 2026-09-10 — razón social/NIT/NRC editables, antes solo por SQL).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@his/database";
import { TRPCError } from "@trpc/server";
import { organizationRouter } from "../organization.router";
import { makeCtx } from "../../__tests__/helpers/caller";

const ORG_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "00000000-0000-0000-0000-000000000099";

const ADMIN_MEMBERSHIP = { id: "m1", userId: USER_ID, organizationId: ORG_ID };

describe("organizationRouter.updateFiscalIdentity", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    // withTenantContext usa $transaction — debe ejecutar el callback con el mismo mock.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as unknown as { mockImplementation: (fn: any) => void })
      .mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma));
  });

  it("persiste razón social, nombre comercial, NIT y NRC", async () => {
    prisma.userOrganizationRole.findFirst.mockResolvedValue(ADMIN_MEMBERSHIP as never);
    prisma.organization.update.mockResolvedValue({
      id: ORG_ID,
      legalName: "INVERSIONES AVANTE, S.A. DE C.V.",
      tradeName: "Complejo Avante",
      taxId: "0614-123456-001-2",
      nrc: "277720-3",
    } as never);

    const caller = organizationRouter.createCaller(makeCtx({ prisma, user: { id: USER_ID } as never }));
    const result = await caller.updateFiscalIdentity({
      organizationId: ORG_ID,
      legalName: "INVERSIONES AVANTE, S.A. DE C.V.",
      tradeName: "Complejo Avante",
      taxId: "0614-123456-001-2",
      nrc: "277720-3",
    });

    expect(result.ok).toBe(true);
    expect(result.nrc).toBe("277720-3");
    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          legalName: "INVERSIONES AVANTE, S.A. DE C.V.",
          tradeName: "Complejo Avante",
          taxId: "0614-123456-001-2",
          nrc: "277720-3",
          updatedBy: USER_ID,
        }),
      }),
    );
  });

  it("acepta nrc/tradeName null (org sin esos datos)", async () => {
    prisma.userOrganizationRole.findFirst.mockResolvedValue(ADMIN_MEMBERSHIP as never);
    prisma.organization.update.mockResolvedValue({
      id: ORG_ID,
      legalName: "Clínica X",
      tradeName: null,
      taxId: "0614-000000-000-0",
      nrc: null,
    } as never);

    const caller = organizationRouter.createCaller(makeCtx({ prisma, user: { id: USER_ID } as never }));
    const result = await caller.updateFiscalIdentity({
      organizationId: ORG_ID,
      legalName: "Clínica X",
      taxId: "0614-000000-000-0",
    });

    expect(result.ok).toBe(true);
    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tradeName: null, nrc: null }),
      }),
    );
  });

  it("lanza FORBIDDEN cuando el usuario no es ADMIN", async () => {
    prisma.userOrganizationRole.findFirst.mockResolvedValue(null as never);

    const caller = organizationRouter.createCaller(makeCtx({ prisma, user: { id: USER_ID } as never }));

    await expect(
      caller.updateFiscalIdentity({
        organizationId: ORG_ID,
        legalName: "Clínica X",
        taxId: "0614-000000-000-0",
      }),
    ).rejects.toThrow(TRPCError);
  });

  it("lanza CONFLICT cuando el NIT ya existe en el país (Organization_countryId_taxId_key)", async () => {
    prisma.userOrganizationRole.findFirst.mockResolvedValue(ADMIN_MEMBERSHIP as never);
    prisma.organization.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "5.22.0",
        meta: { target: ["countryId", "taxId"] },
      }) as never,
    );

    const caller = organizationRouter.createCaller(makeCtx({ prisma, user: { id: USER_ID } as never }));

    await expect(
      caller.updateFiscalIdentity({
        organizationId: ORG_ID,
        legalName: "Clínica X",
        taxId: "0614-000000-000-0",
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining("NIT") });
  });

  it("lanza BAD_REQUEST si legalName está vacío (Zod)", async () => {
    const caller = organizationRouter.createCaller(makeCtx({ prisma, user: { id: USER_ID } as never }));

    await expect(
      caller.updateFiscalIdentity({
        organizationId: ORG_ID,
        legalName: "X",
        taxId: "0614-000000-000-0",
      }),
    ).rejects.toThrow();
  });
});
