/**
 * Tests del procedure organization.setGs1CompanyPrefix (US.F2.S7.W2).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { organizationRouter } from "../organization.router";
import { makeCtx } from "../../__tests__/helpers/caller";

const ORG_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "00000000-0000-0000-0000-000000000099";

/** Simula la membresía ADMIN vigente que el procedure requiere. */
const ADMIN_MEMBERSHIP = { id: "m1", userId: USER_ID, organizationId: ORG_ID };

describe("organizationRouter.setGs1CompanyPrefix", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    // withTenantContext usa $transaction — debe ejecutar el callback con el mismo mock.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as unknown as { mockImplementation: (fn: any) => void })
      .mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma));
  });

  it("persiste un prefijo de 7 dígitos válido", async () => {
    prisma.userOrganizationRole.findFirst.mockResolvedValue(ADMIN_MEMBERSHIP as never);
    prisma.organization.update.mockResolvedValue({
      id: ORG_ID,
      gs1CompanyPrefix: "7503000",
    } as never);

    const caller = organizationRouter.createCaller(makeCtx({ prisma, user: { id: USER_ID } as never }));
    const result = await caller.setGs1CompanyPrefix({
      organizationId: ORG_ID,
      gs1CompanyPrefix: "7503000",
    });

    expect(result.ok).toBe(true);
    expect(result.gs1CompanyPrefix).toBe("7503000");
    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ gs1CompanyPrefix: "7503000" }),
      }),
    );
  });

  it("persiste un prefijo de 9 dígitos válido", async () => {
    prisma.userOrganizationRole.findFirst.mockResolvedValue(ADMIN_MEMBERSHIP as never);
    prisma.organization.update.mockResolvedValue({
      id: ORG_ID,
      gs1CompanyPrefix: "750300012",
    } as never);

    const caller = organizationRouter.createCaller(makeCtx({ prisma, user: { id: USER_ID } as never }));
    const result = await caller.setGs1CompanyPrefix({
      organizationId: ORG_ID,
      gs1CompanyPrefix: "750300012",
    });

    expect(result.ok).toBe(true);
    expect(result.gs1CompanyPrefix).toBe("750300012");
  });

  it("limpia el prefijo cuando se envía null", async () => {
    prisma.userOrganizationRole.findFirst.mockResolvedValue(ADMIN_MEMBERSHIP as never);
    prisma.organization.update.mockResolvedValue({
      id: ORG_ID,
      gs1CompanyPrefix: null,
    } as never);

    const caller = organizationRouter.createCaller(makeCtx({ prisma, user: { id: USER_ID } as never }));
    const result = await caller.setGs1CompanyPrefix({
      organizationId: ORG_ID,
      gs1CompanyPrefix: null,
    });

    expect(result.ok).toBe(true);
    expect(result.gs1CompanyPrefix).toBeNull();
    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ gs1CompanyPrefix: null }),
      }),
    );
  });

  it("lanza FORBIDDEN cuando el usuario no es ADMIN", async () => {
    prisma.userOrganizationRole.findFirst.mockResolvedValue(null as never);

    const caller = organizationRouter.createCaller(makeCtx({ prisma, user: { id: USER_ID } as never }));

    await expect(
      caller.setGs1CompanyPrefix({
        organizationId: ORG_ID,
        gs1CompanyPrefix: "7503000",
      }),
    ).rejects.toThrow(TRPCError);
  });

  it("lanza BAD_REQUEST si el prefijo tiene menos de 7 dígitos (Zod)", async () => {
    const caller = organizationRouter.createCaller(makeCtx({ prisma, user: { id: USER_ID } as never }));

    await expect(
      caller.setGs1CompanyPrefix({
        organizationId: ORG_ID,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        gs1CompanyPrefix: "123456" as any, // 6 dígitos — inválido
      }),
    ).rejects.toThrow();
  });

  it("lanza BAD_REQUEST si el prefijo tiene más de 9 dígitos (Zod)", async () => {
    const caller = organizationRouter.createCaller(makeCtx({ prisma, user: { id: USER_ID } as never }));

    await expect(
      caller.setGs1CompanyPrefix({
        organizationId: ORG_ID,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        gs1CompanyPrefix: "1234567890" as any, // 10 dígitos — inválido
      }),
    ).rejects.toThrow();
  });
});
