/**
 * Tests unitarios — plantillaTextoRouter (CC-0007 RF-04/RF-07).
 *
 * Usa withTenantContext → mock de "../../rls-context" (path relativo al router
 * que importa desde packages/trpc/src/rls-context).
 *
 * Casos cubiertos (8 tests):
 *   1. list — retorna plantillas activas filtradas por campo
 *   2. list — sin campo retorna todas las activas
 *   3. create — persiste organizationId del tenant
 *   4. update — actualiza solo titulo cuando se provee
 *   5. update — lanza BAD_REQUEST si titulo===undefined && contenido===undefined
 *   6. eliminar — hace soft-delete (activo=false)
 *   7. Zod — rechaza campo inválido en list
 *   8. Zod — rechaza titulo > 200 chars en create
 */
import { describe, it, expect, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";

// Mock de withTenantContext: ejecuta el callback directamente con prisma mock.
// El router importa desde "../../rls-context" (relativo a su ubicación en
// packages/trpc/src/routers/ece/).
vi.mock("../../rls-context", () => ({
  withTenantContext: async (
    prisma: PrismaClient,
    _tenant: unknown,
    fn: (tx: PrismaClient) => Promise<unknown>,
  ) => fn(prisma),
}));

import { plantillaTextoRouter } from "../plantilla-texto.router";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ID1 = "00000000-0000-4000-8000-000000000001";
const ORG_ID = "00000000-0000-0000-0000-0000000000aa";

function buildCtx() {
  const prisma = mockDeep<PrismaClient>();
  prisma.$transaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  );
  (prisma.$executeRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue(0);
  return {
    prisma,
    user: { id: ID1, email: "dr@test.com", fullName: "Doctor Test" },
    tenant: {
      userId: ID1,
      organizationId: ORG_ID,
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

const fakePlantilla = {
  id: ID1,
  campo: "ENFERMEDAD_ACTUAL" as const,
  titulo: "Plantilla HTA",
  contenido: "Paciente con HTA conocida de larga data...",
};

// ─── Tests: list ─────────────────────────────────────────────────────────────

describe("plantillaTextoRouter.list", () => {
  it("1. filtra por campo cuando se provee", async () => {
    const ctx = buildCtx();
    (ctx.prisma.ecePlantillaTexto.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([fakePlantilla] as never);

    const caller = plantillaTextoRouter.createCaller(ctx as never);
    const result = await caller.list({ campo: "ENFERMEDAD_ACTUAL" });

    expect(result).toHaveLength(1);
    const args = (ctx.prisma.ecePlantillaTexto.findMany as ReturnType<typeof vi.fn>)
      .mock.calls[0]![0];
    expect(args.where).toMatchObject({ activo: true, campo: "ENFERMEDAD_ACTUAL" });
    expect(args.orderBy).toEqual({ titulo: "asc" });
  });

  it("2. sin campo retorna todas las activas (sin filtro campo)", async () => {
    const ctx = buildCtx();
    (ctx.prisma.ecePlantillaTexto.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([fakePlantilla] as never);

    const caller = plantillaTextoRouter.createCaller(ctx as never);
    await caller.list({});

    const args = (ctx.prisma.ecePlantillaTexto.findMany as ReturnType<typeof vi.fn>)
      .mock.calls[0]![0];
    // No debe tener campo en where
    expect(args.where).toEqual({ activo: true });
  });
});

// ─── Tests: create ────────────────────────────────────────────────────────────

describe("plantillaTextoRouter.create", () => {
  it("3. crea plantilla con organizationId del tenant", async () => {
    const ctx = buildCtx();
    (ctx.prisma.ecePlantillaTexto.create as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(fakePlantilla as never);

    const caller = plantillaTextoRouter.createCaller(ctx as never);
    await caller.create({
      campo: "ENFERMEDAD_ACTUAL",
      titulo: "Plantilla HTA",
      contenido: "Paciente con HTA conocida...",
    });

    const args = (ctx.prisma.ecePlantillaTexto.create as ReturnType<typeof vi.fn>)
      .mock.calls[0]![0];
    expect(args.data).toMatchObject({
      organizationId: ORG_ID,
      campo: "ENFERMEDAD_ACTUAL",
      titulo: "Plantilla HTA",
    });
  });
});

// ─── Tests: update ────────────────────────────────────────────────────────────

describe("plantillaTextoRouter.update", () => {
  it("4. actualiza solo titulo cuando se provee", async () => {
    const ctx = buildCtx();
    (ctx.prisma.ecePlantillaTexto.update as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ...fakePlantilla, titulo: "Nuevo titulo" } as never);

    const caller = plantillaTextoRouter.createCaller(ctx as never);
    await caller.update({ id: ID1, titulo: "Nuevo titulo" });

    const args = (ctx.prisma.ecePlantillaTexto.update as ReturnType<typeof vi.fn>)
      .mock.calls[0]![0];
    expect(args.where).toEqual({ id: ID1 });
    expect(args.data).toEqual({ titulo: "Nuevo titulo" });
    // contenido no debe aparecer en data
    expect(args.data.contenido).toBeUndefined();
  });

  it("5. lanza BAD_REQUEST si titulo===undefined && contenido===undefined", async () => {
    const ctx = buildCtx();
    const caller = plantillaTextoRouter.createCaller(ctx as never);
    await expect(caller.update({ id: ID1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ─── Tests: eliminar ─────────────────────────────────────────────────────────

describe("plantillaTextoRouter.eliminar", () => {
  it("6. hace soft-delete (activo=false)", async () => {
    const ctx = buildCtx();
    (ctx.prisma.ecePlantillaTexto.update as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ...fakePlantilla, activo: false } as never);

    const caller = plantillaTextoRouter.createCaller(ctx as never);
    await caller.eliminar({ id: ID1 });

    const args = (ctx.prisma.ecePlantillaTexto.update as ReturnType<typeof vi.fn>)
      .mock.calls[0]![0];
    expect(args.where).toEqual({ id: ID1 });
    expect(args.data).toEqual({ activo: false });
  });
});

// ─── Tests: Zod ──────────────────────────────────────────────────────────────

describe("plantillaTextoRouter — validación Zod", () => {
  it("7. rechaza campo inválido en list", async () => {
    const ctx = buildCtx();
    const caller = plantillaTextoRouter.createCaller(ctx as never);
    await expect(
      caller.list({ campo: "CAMPO_INVALIDO" as never }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("8. rechaza titulo > 200 chars en create", async () => {
    const ctx = buildCtx();
    const caller = plantillaTextoRouter.createCaller(ctx as never);
    await expect(
      caller.create({
        campo: "EXAMEN_FISICO",
        titulo: "T".repeat(201),
        contenido: "contenido",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
