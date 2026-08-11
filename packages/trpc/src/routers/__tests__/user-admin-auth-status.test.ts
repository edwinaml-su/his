/**
 * CC-0019 — cobertura del cálculo de `authStatus` (SIN_CUENTA / INVITADO /
 * ACTIVO) agregado a `userAdmin.listAll` y `userAdmin.get`. No repite la
 * cobertura pre-existente de paginación/filtros/roles (fuera de alcance de
 * este cambio) — solo la derivación nueva.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { userAdminRouter } from "../user-admin.router";
import { makeCtx } from "../../__tests__/helpers/caller";

vi.mock("@his/infrastructure", () => ({
  hashPin: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  sendMail: vi.fn(),
}));

const U1 = "00000000-0000-0000-0000-000000000011";
const U2 = "00000000-0000-0000-0000-000000000012";
const U3 = "00000000-0000-0000-0000-000000000013";

describe("userAdmin.listAll — authStatus", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    vi.clearAllMocks();
  });

  function caller() {
    return userAdminRouter.createCaller(makeCtx({ prisma }));
  }

  it("clasifica SIN_CUENTA / INVITADO / ACTIVO según auth.users", async () => {
    prisma.user.count.mockResolvedValue(3 as never);
    prisma.user.findMany.mockResolvedValue([
      { id: U1, email: "sincuenta@his.test", fullName: "Sin Cuenta", active: true, mfaEnabled: false, lastLoginAt: null, _count: { roles: 0 } },
      { id: U2, email: "invitado@his.test", fullName: "Invitado", active: true, mfaEnabled: false, lastLoginAt: null, _count: { roles: 0 } },
      { id: U3, email: "activo@his.test", fullName: "Activo", active: true, mfaEnabled: false, lastLoginAt: null, _count: { roles: 1 } },
    ] as never);
    prisma.userOrganizationRole.groupBy.mockResolvedValue([] as never);
    // Solo invitado@ y activo@ tienen fila en auth.users; activo@ ya inició sesión.
    prisma.$queryRaw.mockResolvedValue([
      { email: "invitado@his.test", lastSignInAt: null },
      { email: "activo@his.test", lastSignInAt: new Date("2026-01-01T00:00:00Z") },
    ] as never);

    const res = await caller().listAll({ page: 1, pageSize: 20 });

    const byEmail = new Map(res.items.map((i: { email: string; authStatus: string }) => [i.email, i.authStatus]));
    expect(byEmail.get("sincuenta@his.test")).toBe("SIN_CUENTA");
    expect(byEmail.get("invitado@his.test")).toBe("INVITADO");
    expect(byEmail.get("activo@his.test")).toBe("ACTIVO");
  });

  it("no consulta auth.users si la página no tiene usuarios", async () => {
    prisma.user.count.mockResolvedValue(0 as never);
    prisma.user.findMany.mockResolvedValue([] as never);
    prisma.userOrganizationRole.groupBy.mockResolvedValue([] as never);

    const res = await caller().listAll({ page: 1, pageSize: 20 });

    expect(res.items).toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

describe("userAdmin.get — authStatus", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    vi.clearAllMocks();
  });

  function caller() {
    return userAdminRouter.createCaller(makeCtx({ prisma }));
  }

  it("ACTIVO cuando auth.users tiene last_sign_in_at", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: U1,
      email: "activo@his.test",
      fullName: "Activo",
      active: true,
      mfaEnabled: false,
      lastLoginAt: null,
      createdAt: new Date(),
      roles: [],
    } as never);
    prisma.$queryRaw.mockResolvedValue([
      { lastSignInAt: new Date("2026-01-01T00:00:00Z") },
    ] as never);

    const res = await caller().get({ id: U1 });
    expect(res.authStatus).toBe("ACTIVO");
  });

  it("SIN_CUENTA cuando no hay fila en auth.users", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: U1,
      email: "sincuenta@his.test",
      fullName: "Sin Cuenta",
      active: true,
      mfaEnabled: false,
      lastLoginAt: null,
      createdAt: new Date(),
      roles: [],
    } as never);
    prisma.$queryRaw.mockResolvedValue([] as never);

    const res = await caller().get({ id: U1 });
    expect(res.authStatus).toBe("SIN_CUENTA");
  });
});
