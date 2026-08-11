/**
 * CC-0019 — tests de userAdmin.create (alta end-to-end), resendInvitation y
 * listSinCuentaAuth.
 *
 * `createAuthUser` / `deleteAuthUser` / `generateAuthActionLink`
 * (`../../lib/supabase-admin`) y `sendMail` (`@his/infrastructure`) se
 * mockean — no se golpea Supabase Auth ni SMTP real.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { userAdminRouter } from "../user-admin.router";
import { makeCtx } from "../../__tests__/helpers/caller";

vi.mock("@his/infrastructure", () => ({
  hashPin: vi.fn().mockResolvedValue({ hash: "$argon2id$test$hash", salt: "aabb" }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  sendMail: vi.fn().mockResolvedValue({ providerMessageId: "msg-1", status: "SENT" }),
}));

vi.mock("../../lib/supabase-admin", () => ({
  createAuthUser: vi.fn(),
  deleteAuthUser: vi.fn().mockResolvedValue(undefined),
  generateAuthActionLink: vi.fn(),
}));

import { sendMail } from "@his/infrastructure";
import { createAuthUser, deleteAuthUser, generateAuthActionLink } from "../../lib/supabase-admin";

const NEW_ID = "00000000-0000-0000-0000-0000000000aa";
const NEW_EMAIL = "nuevo@his.test";
const AUTH_UUID = "b1b2c3d4-9eb2-4d07-9124-e25c6ac95cbe";

/**
 * Mismo helper que `user-admin-reset-password.test.ts`: mockea el grant
 * ADMIN → user.manage que `requirePermission` resuelve vía roles efectivos.
 */
function grantUserManageToAdmin(prisma: DeepMockProxy<PrismaClient>) {
  prisma.role.findMany.mockResolvedValue([
    { id: "role-admin", code: "ADMIN", inheritsFromRoleId: null },
  ] as never);
  prisma.roleCodeAlias.findMany.mockResolvedValue([] as never);
  prisma.rolePermission.findMany.mockResolvedValue([
    { effect: "ALLOW", permission: { code: "user.manage" } },
  ] as never);
}

describe("userAdmin.create (CC-0019)", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    vi.clearAllMocks();
    (createAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: AUTH_UUID });
    (generateAuthActionLink as ReturnType<typeof vi.fn>).mockResolvedValue(
      "https://project.supabase.co/verify?token=xyz",
    );
    (sendMail as ReturnType<typeof vi.fn>).mockResolvedValue({
      providerMessageId: "msg-1",
      status: "SENT",
    });
  });

  function caller() {
    return userAdminRouter.createCaller(makeCtx({ prisma }));
  }

  it("rechaza sin el permiso user.manage con FORBIDDEN", async () => {
    await expect(
      caller().create({ email: NEW_EMAIL, fullName: "Nuevo Usuario" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(createAuthUser).not.toHaveBeenCalled();
  });

  it("CONFLICT si el email ya existe en public.User — NO toca Supabase Auth", async () => {
    grantUserManageToAdmin(prisma);
    prisma.user.findUnique.mockResolvedValue({ id: "existing" } as never);

    await expect(
      caller().create({ email: NEW_EMAIL, fullName: "Nuevo Usuario" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(createAuthUser).not.toHaveBeenCalled();
  });

  it("happy path: crea cuenta Auth + User local + invita por email", async () => {
    grantUserManageToAdmin(prisma);
    prisma.user.findUnique.mockResolvedValue(null as never); // sin dupe local
    prisma.$queryRaw.mockResolvedValue([] as never); // sin cuenta Auth existente
    prisma.user.create.mockResolvedValue({
      id: NEW_ID,
      email: NEW_EMAIL,
      fullName: "Nuevo Usuario",
      active: true,
      mfaEnabled: false,
    } as never);

    const res = await caller().create({ email: NEW_EMAIL, fullName: "Nuevo Usuario" });

    expect(createAuthUser).toHaveBeenCalledWith(NEW_EMAIL);
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: NEW_EMAIL, active: true, mfaEnabled: false }),
      }),
    );
    expect(generateAuthActionLink).toHaveBeenCalledWith(
      expect.objectContaining({ type: "recovery", email: NEW_EMAIL }),
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: NEW_EMAIL, subject: expect.stringContaining("HIS Avante") }),
    );
    expect(res).toMatchObject({ id: NEW_ID, authCreated: true, invitationSent: true });
  });

  it("reutiliza una cuenta Auth huérfana existente en vez de crear otra", async () => {
    grantUserManageToAdmin(prisma);
    prisma.user.findUnique.mockResolvedValue(null as never);
    prisma.$queryRaw.mockResolvedValue([{ id: AUTH_UUID }] as never); // ya existe en auth.users
    prisma.user.create.mockResolvedValue({
      id: NEW_ID,
      email: NEW_EMAIL,
      fullName: "Nuevo Usuario",
    } as never);

    const res = await caller().create({ email: NEW_EMAIL, fullName: "Nuevo Usuario" });

    expect(createAuthUser).not.toHaveBeenCalled();
    expect(res).toMatchObject({ authCreated: true, invitationSent: true });
  });

  it("si crear el User local falla y la cuenta Auth se creó en este request, compensa borrándola", async () => {
    grantUserManageToAdmin(prisma);
    prisma.user.findUnique.mockResolvedValue(null as never);
    prisma.$queryRaw.mockResolvedValue([] as never); // no existía → se crea
    prisma.user.create.mockRejectedValue(new Error("db down") as never);

    await expect(caller().create({ email: NEW_EMAIL, fullName: "Nuevo Usuario" })).rejects.toThrow();

    expect(createAuthUser).toHaveBeenCalledWith(NEW_EMAIL);
    expect(deleteAuthUser).toHaveBeenCalledWith(AUTH_UUID);
  });

  it("si crear el User local falla pero la cuenta Auth era huérfana reutilizada, NO la borra", async () => {
    grantUserManageToAdmin(prisma);
    prisma.user.findUnique.mockResolvedValue(null as never);
    prisma.$queryRaw.mockResolvedValue([{ id: AUTH_UUID }] as never); // reutilizada
    prisma.user.create.mockRejectedValue(new Error("db down") as never);

    await expect(caller().create({ email: NEW_EMAIL, fullName: "Nuevo Usuario" })).rejects.toThrow();

    expect(deleteAuthUser).not.toHaveBeenCalled();
  });

  it("si Supabase Auth no puede crear la cuenta, no crea ningún registro local", async () => {
    grantUserManageToAdmin(prisma);
    prisma.user.findUnique.mockResolvedValue(null as never);
    prisma.$queryRaw.mockResolvedValue([] as never);
    (createAuthUser as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("GoTrue 500"));

    await expect(
      caller().create({ email: NEW_EMAIL, fullName: "Nuevo Usuario" }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("si el envío de la invitación falla, el usuario queda creado con invitationSent:false (no revierte)", async () => {
    grantUserManageToAdmin(prisma);
    prisma.user.findUnique.mockResolvedValue(null as never);
    prisma.$queryRaw.mockResolvedValue([] as never);
    prisma.user.create.mockResolvedValue({
      id: NEW_ID,
      email: NEW_EMAIL,
      fullName: "Nuevo Usuario",
    } as never);
    (generateAuthActionLink as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("SMTP down"),
    );

    const res = await caller().create({ email: NEW_EMAIL, fullName: "Nuevo Usuario" });

    expect(res).toMatchObject({ id: NEW_ID, authCreated: true, invitationSent: false });
  });
});

describe("userAdmin.resendInvitation (CC-0019)", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    vi.clearAllMocks();
    (createAuthUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: AUTH_UUID });
    (generateAuthActionLink as ReturnType<typeof vi.fn>).mockResolvedValue(
      "https://project.supabase.co/verify?token=xyz",
    );
    (sendMail as ReturnType<typeof vi.fn>).mockResolvedValue({
      providerMessageId: "msg-1",
      status: "SENT",
    });
  });

  function caller() {
    return userAdminRouter.createCaller(makeCtx({ prisma }));
  }

  it("rechaza sin el permiso user.manage con FORBIDDEN", async () => {
    await expect(caller().resendInvitation({ userId: NEW_ID })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("NOT_FOUND si el usuario no existe", async () => {
    grantUserManageToAdmin(prisma);
    prisma.user.findUnique.mockResolvedValue(null as never);
    await expect(caller().resendInvitation({ userId: NEW_ID })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("BAD_REQUEST si el usuario está inactivo", async () => {
    grantUserManageToAdmin(prisma);
    prisma.user.findUnique.mockResolvedValue({
      id: NEW_ID,
      email: NEW_EMAIL,
      fullName: "X",
      active: false,
    } as never);
    await expect(caller().resendInvitation({ userId: NEW_ID })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("happy path: provisiona (si falta) y reenvía", async () => {
    grantUserManageToAdmin(prisma);
    prisma.user.findUnique.mockResolvedValue({
      id: NEW_ID,
      email: NEW_EMAIL,
      fullName: "Nuevo Usuario",
      active: true,
    } as never);
    prisma.$queryRaw.mockResolvedValue([] as never); // sin cuenta Auth → se provisiona

    const res = await caller().resendInvitation({ userId: NEW_ID });

    expect(createAuthUser).toHaveBeenCalledWith(NEW_EMAIL);
    expect(sendMail).toHaveBeenCalled();
    expect(res).toMatchObject({ ok: true, userId: NEW_ID, email: NEW_EMAIL });
  });

  it("INTERNAL_SERVER_ERROR si el envío de correo falla", async () => {
    grantUserManageToAdmin(prisma);
    prisma.user.findUnique.mockResolvedValue({
      id: NEW_ID,
      email: NEW_EMAIL,
      fullName: "Nuevo Usuario",
      active: true,
    } as never);
    prisma.$queryRaw.mockResolvedValue([{ id: AUTH_UUID }] as never);
    (sendMail as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("SMTP down"));

    await expect(caller().resendInvitation({ userId: NEW_ID })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });
});

describe("userAdmin.listSinCuentaAuth (CC-0019)", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    vi.clearAllMocks();
  });

  function caller() {
    return userAdminRouter.createCaller(makeCtx({ prisma }));
  }

  it("rechaza sin el permiso user.manage con FORBIDDEN", async () => {
    await expect(caller().listSinCuentaAuth()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("devuelve las filas del query raw", async () => {
    grantUserManageToAdmin(prisma);
    prisma.$queryRaw.mockResolvedValue([
      { id: "u1", email: "huerfano@his.test", fullName: "Huérfano Uno" },
    ] as never);

    const res = await caller().listSinCuentaAuth();
    expect(res).toEqual([{ id: "u1", email: "huerfano@his.test", fullName: "Huérfano Uno" }]);
  });
});
