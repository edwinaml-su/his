/**
 * Tests del catalog router (CRUD genérico).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { catalogRouter } from "../catalog.router";
import { makeCtx } from "../../__tests__/helpers/caller";

/** Helper local: pequeño envoltorio sobre vi.fn() para reducir ruido. */
function fn<T>(returnValue: T) {
  return vi.fn().mockResolvedValue(returnValue);
}

describe("catalogRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  it("list aplica activeOnly=true por defecto sobre el modelo solicitado", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).biologicalSex = { findMany: fn([]) };

    const caller = catalogRouter.createCaller(makeCtx({ prisma }));
    await caller.list({ catalog: "biologicalSex" });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fm = (prisma as any).biologicalSex.findMany;
    expect(fm).toHaveBeenCalled();
    expect(fm.mock.calls[0][0].where).toEqual({ active: true });
  });

  it("list con activeOnly=false omite filtro active", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).gender = { findMany: fn([]) };

    const caller = catalogRouter.createCaller(makeCtx({ prisma }));
    await caller.list({ catalog: "gender", activeOnly: false });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fm = (prisma as any).gender.findMany;
    expect(fm.mock.calls[0][0].where).toEqual({});
  });

  it("get retorna NOT_FOUND si no existe", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).maritalStatus = { findUnique: fn(null) };

    const caller = catalogRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.get({
        catalog: "maritalStatus",
        id: "00000000-0000-0000-0000-000000000001",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("create delega al modelo correspondiente", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).occupation = { create: fn({ id: "x" }) };

    const caller = catalogRouter.createCaller(makeCtx({ prisma }));
    await caller.create({
      catalog: "occupation",
      data: { name: "Médico", code: "MED" },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma as any).occupation.create).toHaveBeenCalledWith({
      data: { name: "Médico", code: "MED" },
    });
  });

  it("deactivate hace soft-disable (active=false)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).religion = { update: fn({ id: "r1", active: false }) };

    const caller = catalogRouter.createCaller(makeCtx({ prisma }));
    await caller.deactivate({
      catalog: "religion",
      id: "00000000-0000-0000-0000-000000000099",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma as any).religion.update).toHaveBeenCalledWith({
      where: { id: "00000000-0000-0000-0000-000000000099" },
      data: { active: false },
    });
  });

  it("rechaza catálogo desconocido", async () => {
    const caller = catalogRouter.createCaller(makeCtx({ prisma }));
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      caller.list({ catalog: "noSuchCatalog" as any }),
    ).rejects.toThrow();
  });
});
