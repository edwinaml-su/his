/**
 * Tests unitarios — eceLesionCausaExternaRouter (REQ-ECE-LCE-001, CC-0007).
 *
 * Estrategia (mismo patrón que signos-vitales.test.ts):
 *   - Prisma mockeado con vitest-mock-extended; cero I/O real.
 *   - withEceContext mockeado para ejecutar el callback con el prisma mock.
 *   - El router opera el modelo Prisma `eceLesionCausaExterna` (no raw SQL).
 *
 * Casos:
 *   1. Zod — datos mínimos válidos
 *   2. Zod — glasgowTotal fuera de rango (2 / 16) falla
 *   3. getByEpisodio — retorna el registro más reciente
 *   4. upsert — crea nuevo cuando no hay borrador
 *   5. upsert — actualiza el borrador existente
 *   6. firmar — NOT_FOUND cuando no existe
 *   7. firmar — BAD_REQUEST si el estado no es 'borrador'
 *   8. firmar — PRECONDITION_FAILED sin mecanismo
 *   9. firmar — happy path con ≥1 mecanismo
 *  10. autorización — NURSE no puede upsert/firmar (write = PHYSICIAN/MC/MT)
 */
import { describe, it, expect, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { lceDatosSchema, lceUpsertInput } from "@his/contracts";

vi.mock("../../ece/rls-context", () => ({
  withEceContext: async (
    prisma: PrismaClient,
    _personalId: string,
    _establecimientoId: string,
    fn: (tx: PrismaClient) => Promise<unknown>,
  ) => fn(prisma),
}));

import { eceLesionCausaExternaRouter } from "../lesion-causa-externa.router";

const uuid = () => "00000000-0000-4000-8000-000000000001";
const uuid2 = () => "00000000-0000-4000-8000-000000000002";

function buildCtx(roleCodes: string[] = ["PHYSICIAN"]) {
  const prisma = mockDeep<PrismaClient>();
  prisma.$transaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  );
  (prisma.$executeRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue(0);
  return {
    prisma,
    user: { id: uuid(), email: "med@test.com", fullName: "Médico Test" },
    tenant: { organizationId: uuid(), establishmentId: uuid2(), roleCodes },
    portalAccount: null,
  };
}

const datosMin = () => lceDatosSchema.parse({ mecanismo: ["Caída"] });

describe("lceDatosSchema — validación", () => {
  it("1. acepta datos mínimos (multi-selects con default [])", () => {
    const r = lceDatosSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.mecanismo).toEqual([]);
  });

  it("2. rechaza glasgowTotal fuera de rango (2 y 16)", () => {
    expect(lceDatosSchema.safeParse({ glasgowTotal: 2 }).success).toBe(false);
    expect(lceDatosSchema.safeParse({ glasgowTotal: 16 }).success).toBe(false);
  });
});

describe("eceLesionCausaExternaRouter — getByEpisodio", () => {
  it("3. retorna el registro del episodio", async () => {
    const ctx = buildCtx();
    const row = { id: uuid(), estadoRegistro: "borrador" };
    (ctx.prisma.eceLesionCausaExterna.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(row);
    const caller = eceLesionCausaExternaRouter.createCaller(ctx as never);
    const res = await caller.getByEpisodio({ episodioId: uuid() });
    expect(res).toEqual(row);
  });
});

describe("eceLesionCausaExternaRouter — upsert", () => {
  it("4. crea un registro nuevo cuando no hay borrador", async () => {
    const ctx = buildCtx();
    (ctx.prisma.eceLesionCausaExterna.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    (ctx.prisma.eceLesionCausaExterna.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: uuid2() });
    const caller = eceLesionCausaExternaRouter.createCaller(ctx as never);
    const res = await caller.upsert({ episodioId: uuid(), datos: datosMin() });
    expect(res.id).toBe(uuid2());
    expect(ctx.prisma.eceLesionCausaExterna.create).toHaveBeenCalled();
  });

  it("5. actualiza el borrador existente", async () => {
    const ctx = buildCtx();
    (ctx.prisma.eceLesionCausaExterna.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: uuid() });
    (ctx.prisma.eceLesionCausaExterna.update as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: uuid() });
    const caller = eceLesionCausaExternaRouter.createCaller(ctx as never);
    const res = await caller.upsert({ episodioId: uuid(), datos: datosMin() });
    expect(res.id).toBe(uuid());
    expect(ctx.prisma.eceLesionCausaExterna.update).toHaveBeenCalled();
    expect(ctx.prisma.eceLesionCausaExterna.create).not.toHaveBeenCalled();
  });
});

describe("eceLesionCausaExternaRouter — firmar", () => {
  it("6. NOT_FOUND cuando el registro no existe", async () => {
    const ctx = buildCtx();
    (ctx.prisma.eceLesionCausaExterna.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const caller = eceLesionCausaExternaRouter.createCaller(ctx as never);
    await expect(caller.firmar({ id: uuid() })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("7. BAD_REQUEST si el estado no es 'borrador'", async () => {
    const ctx = buildCtx();
    (ctx.prisma.eceLesionCausaExterna.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      estadoRegistro: "firmado",
      mecanismo: ["Caída"], mecExplosion: [], mecFuego: [], mecIntoxicacion: [], mecMordedura: [],
    });
    const caller = eceLesionCausaExternaRouter.createCaller(ctx as never);
    await expect(caller.firmar({ id: uuid() })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("8. PRECONDITION_FAILED sin ningún mecanismo", async () => {
    const ctx = buildCtx();
    (ctx.prisma.eceLesionCausaExterna.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      estadoRegistro: "borrador",
      mecanismo: [], mecExplosion: [], mecFuego: [], mecIntoxicacion: [], mecMordedura: [],
    });
    const caller = eceLesionCausaExternaRouter.createCaller(ctx as never);
    await expect(caller.firmar({ id: uuid() })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("9. happy path: firma cuando hay ≥1 mecanismo", async () => {
    const ctx = buildCtx();
    (ctx.prisma.eceLesionCausaExterna.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      estadoRegistro: "borrador",
      mecanismo: [], mecExplosion: [], mecFuego: ["Pirotecnia"], mecIntoxicacion: [], mecMordedura: [],
    });
    (ctx.prisma.eceLesionCausaExterna.update as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: uuid() });
    const caller = eceLesionCausaExternaRouter.createCaller(ctx as never);
    const res = await caller.firmar({ id: uuid() });
    expect(res.ok).toBe(true);
    expect(ctx.prisma.eceLesionCausaExterna.update).toHaveBeenCalled();
  });
});

describe("eceLesionCausaExternaRouter — autorización", () => {
  it("10. NURSE no puede upsert ni firmar (write = PHYSICIAN/MC/MT)", async () => {
    const ctx = buildCtx(["NURSE"]);
    const caller = eceLesionCausaExternaRouter.createCaller(ctx as never);
    await expect(
      caller.upsert({ episodioId: uuid(), datos: datosMin() }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.firmar({ id: uuid() })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("lceUpsertInput — forma del input", () => {
  it("11. exige episodioId uuid y datos", () => {
    expect(lceUpsertInput.safeParse({ episodioId: "no-uuid", datos: {} }).success).toBe(false);
    expect(lceUpsertInput.safeParse({ episodioId: uuid(), datos: {} }).success).toBe(true);
  });
});
