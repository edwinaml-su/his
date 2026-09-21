/**
 * R4.5 — tests del procedure organization.setMfaStaffRequired (SQL 263).
 * Mismo patrón de autorización que organization-gs1-prefix.test.ts.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { organizationRouter } from "../organization.router";
import { makeCtx } from "../../__tests__/helpers/caller";

const ORG_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "00000000-0000-0000-0000-000000000099";

const ADMIN_MEMBERSHIP = { id: "m1", userId: USER_ID, organizationId: ORG_ID };

describe("organizationRouter.setMfaStaffRequired", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    // withTenantContext usa $transaction — debe ejecutar el callback con el mismo mock.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as unknown as { mockImplementation: (fn: any) => void })
      .mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma));
  });

  it("prende el switch cuando el usuario es ADMIN vigente", async () => {
    prisma.userOrganizationRole.findFirst.mockResolvedValue(ADMIN_MEMBERSHIP as never);
    prisma.organization.update.mockResolvedValue({
      id: ORG_ID,
      mfaStaffRequired: true,
    } as never);

    const caller = organizationRouter.createCaller(makeCtx({ prisma, user: { id: USER_ID } as never }));
    const result = await caller.setMfaStaffRequired({
      organizationId: ORG_ID,
      mfaStaffRequired: true,
    });

    expect(result).toEqual({ ok: true, organizationId: ORG_ID, mfaStaffRequired: true });
    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ mfaStaffRequired: true }),
      }),
    );
  });

  it("apaga el switch (default) cuando el usuario es ADMIN vigente", async () => {
    prisma.userOrganizationRole.findFirst.mockResolvedValue(ADMIN_MEMBERSHIP as never);
    prisma.organization.update.mockResolvedValue({
      id: ORG_ID,
      mfaStaffRequired: false,
    } as never);

    const caller = organizationRouter.createCaller(makeCtx({ prisma, user: { id: USER_ID } as never }));
    const result = await caller.setMfaStaffRequired({
      organizationId: ORG_ID,
      mfaStaffRequired: false,
    });

    expect(result).toEqual({ ok: true, organizationId: ORG_ID, mfaStaffRequired: false });
  });

  it("lanza FORBIDDEN cuando el usuario no es ADMIN vigente en la organización", async () => {
    prisma.userOrganizationRole.findFirst.mockResolvedValue(null as never);

    const caller = organizationRouter.createCaller(makeCtx({ prisma, user: { id: USER_ID } as never }));

    await expect(
      caller.setMfaStaffRequired({ organizationId: ORG_ID, mfaStaffRequired: true }),
    ).rejects.toThrow(TRPCError);
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it("lanza BAD_REQUEST si organizationId no es un UUID válido (Zod)", async () => {
    const caller = organizationRouter.createCaller(makeCtx({ prisma, user: { id: USER_ID } as never }));

    await expect(
      caller.setMfaStaffRequired({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        organizationId: "no-es-uuid" as any,
        mfaStaffRequired: true,
      }),
    ).rejects.toThrow();
  });
});
