/**
 * Tests unitarios — cptRouter (CC-0007 RF-09).
 *
 * cptRouter usa ctx.prisma.eceCatalogoCpt DIRECTO (sin withEceContext ni
 * withTenantContext). No requiere mock de rls-context.
 *
 * Casos cubiertos (5 tests):
 *   1. buscar — happy path: llama findMany con filtros activo+OR insensitive
 *   2. buscar — Zod rechaza q vacío (min 1)
 *   3. buscar — Zod rechaza q > 100 chars
 *   4. list — llama findMany where activo:true y respeta limit
 *   5. list — Zod rechaza limit 0
 */
import { describe, it, expect } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { cptRouter } from "../cpt.router";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ID1 = "00000000-0000-4000-8000-000000000001";

function buildCtx() {
  const prisma = mockDeep<PrismaClient>();
  return {
    prisma,
    user: { id: ID1, email: "dr@test.com", fullName: "Doctor Test" },
    tenant: {
      userId: ID1,
      organizationId: ID1,
      countryId: ID1,
      establishmentId: ID1,
      roleCodes: ["PHYSICIAN"],
      assignedServiceUnitIds: [],
      assignedServiceUnitCodes: [],
      isCrossServiceRole: true,
    },
    portalAccount: null,
  };
}

const fakeCpts = [
  { id: ID1, codigo: "99213", descripcion: "Consulta de seguimiento" },
  { id: "00000000-0000-4000-8000-000000000002", codigo: "99203", descripcion: "Consulta nueva" },
];

// ─── Tests: buscar ────────────────────────────────────────────────────────────

describe("cptRouter.buscar", () => {
  it("1. llama findMany con activo:true y OR case-insensitive, retorna resultados", async () => {
    const ctx = buildCtx();
    (ctx.prisma.eceCatalogoCpt.findMany as ReturnType<typeof import("vitest").vi.fn>)
      .mockResolvedValueOnce(fakeCpts as never);

    const caller = cptRouter.createCaller(ctx as never);
    const result = await caller.buscar({ q: "99213" });

    expect(result).toHaveLength(2);

    const args = (ctx.prisma.eceCatalogoCpt.findMany as ReturnType<typeof import("vitest").vi.fn>)
      .mock.calls[0]![0];
    expect(args.where).toMatchObject({
      activo: true,
      OR: [
        { codigo: { contains: "99213", mode: "insensitive" } },
        { descripcion: { contains: "99213", mode: "insensitive" } },
      ],
    });
    expect(args.take).toBe(20);
    expect(args.orderBy).toEqual({ codigo: "asc" });
    expect(args.select).toEqual({ id: true, codigo: true, descripcion: true });
  });

  it("2. Zod rechaza q vacío (min 1)", async () => {
    const ctx = buildCtx();
    const caller = cptRouter.createCaller(ctx as never);
    await expect(caller.buscar({ q: "" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("3. Zod rechaza q > 100 chars", async () => {
    const ctx = buildCtx();
    const caller = cptRouter.createCaller(ctx as never);
    const q = "a".repeat(101);
    await expect(caller.buscar({ q })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ─── Tests: list ─────────────────────────────────────────────────────────────

describe("cptRouter.list", () => {
  it("4. llama findMany con activo:true y toma limit correcto", async () => {
    const ctx = buildCtx();
    (ctx.prisma.eceCatalogoCpt.findMany as ReturnType<typeof import("vitest").vi.fn>)
      .mockResolvedValueOnce(fakeCpts as never);

    const caller = cptRouter.createCaller(ctx as never);
    const result = await caller.list({ limit: 50 });

    expect(result).toHaveLength(2);

    const args = (ctx.prisma.eceCatalogoCpt.findMany as ReturnType<typeof import("vitest").vi.fn>)
      .mock.calls[0]![0];
    expect(args.where).toEqual({ activo: true });
    expect(args.take).toBe(50);
    expect(args.orderBy).toEqual({ codigo: "asc" });
    expect(args.select).toEqual({ id: true, codigo: true, descripcion: true });
  });

  it("5. Zod rechaza limit 0 (min 1)", async () => {
    const ctx = buildCtx();
    const caller = cptRouter.createCaller(ctx as never);
    await expect(caller.list({ limit: 0 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
