/**
 * Tests de userAdmin.resetPassword (Beta.22 fix — escribe a Supabase Auth).
 *
 * Cubre los guards + el happy path. El happy path verifica que se escribe a
 * Supabase Auth (auth.users via $executeRaw) — la corrección de raíz del bug
 * "el reset no afectaba el login" (escribía solo en UserCredential).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { userAdminRouter } from "../user-admin.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_USER_ADMIN } from "@his/test-utils";

vi.mock("@his/infrastructure", () => ({
  hashPin: vi.fn().mockResolvedValue({ hash: "$argon2id$test$hash", salt: "aabb" }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const TARGET_ID = "00000000-0000-0000-0000-0000000000ff";
const TARGET_EMAIL = "target@his.test";
const AUTH_UUID = "a48fed25-9eb2-4d07-9124-e25c6ac95cbe";
const VALID_INPUT = { id: TARGET_ID, newPassword: "Avante062026", reason: "reset por olvido" };

function adminCallerRoles() {
  return [{ role: { code: "ADMIN" } }];
}

describe("userAdmin.resetPassword", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    vi.clearAllMocks();
  });

  function caller() {
    return userAdminRouter.createCaller(makeCtx({ prisma }));
  }

  it("bloquea auto-reset (id === caller)", async () => {
    await expect(
      caller().resetPassword({ ...VALID_INPUT, id: MOCK_USER_ADMIN.id }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rechaza caller no-ADMIN con FORBIDDEN", async () => {
    prisma.userOrganizationRole.findMany.mockResolvedValue([] as never);
    await expect(caller().resetPassword(VALID_INPUT)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("NOT_FOUND si el usuario destino no existe", async () => {
    prisma.userOrganizationRole.findMany.mockResolvedValue(adminCallerRoles() as never);
    prisma.user.findUnique.mockResolvedValue(null as never);
    await expect(caller().resetPassword(VALID_INPUT)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("BAD_REQUEST si el usuario destino está inactivo", async () => {
    prisma.userOrganizationRole.findMany.mockResolvedValue(adminCallerRoles() as never);
    prisma.user.findUnique.mockResolvedValue({
      id: TARGET_ID,
      email: TARGET_EMAIL,
      active: false,
    } as never);
    await expect(caller().resetPassword(VALID_INPUT)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("PRECONDITION_FAILED si no hay cuenta en Supabase Auth", async () => {
    prisma.userOrganizationRole.findMany.mockResolvedValue(adminCallerRoles() as never);
    prisma.user.findUnique.mockResolvedValue({
      id: TARGET_ID,
      email: TARGET_EMAIL,
      active: true,
    } as never);
    prisma.$queryRaw.mockResolvedValue([] as never); // auth.users vacío
    await expect(caller().resetPassword(VALID_INPUT)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  it("happy path: escribe a Supabase Auth (auth.users) y devuelve ok", async () => {
    prisma.userOrganizationRole.findMany.mockResolvedValue(adminCallerRoles() as never);
    prisma.user.findUnique.mockResolvedValue({
      id: TARGET_ID,
      email: TARGET_EMAIL,
      active: true,
    } as never);
    prisma.$queryRaw.mockResolvedValue([{ id: AUTH_UUID }] as never);
    prisma.$executeRaw.mockResolvedValue(1 as never);
    prisma.$transaction.mockResolvedValue([] as never);

    const res = await caller().resetPassword(VALID_INPUT);
    expect(res).toMatchObject({ ok: true, userId: TARGET_ID });
    // 2 $executeRaw: UPDATE auth.users + INSERT auth.identities (functional fix).
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    // UserCredential write (audit) sigue presente.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
