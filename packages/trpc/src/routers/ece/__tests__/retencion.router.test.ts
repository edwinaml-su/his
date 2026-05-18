/**
 * Tests unitarios — retencionRouter (US.F2.7.29-32).
 *
 * Estrategia:
 *   - Vitest + vitest-mock-extended.
 *   - withTenantContext mockeado síncrono.
 *   - router.createCaller(ctx) para sub-routers.
 *
 * Casos cubiertos (16 tests):
 *   Zod — reglas:
 *     1.  reglaUpsert — aniosRetencion < 1 falla
 *     2.  reglaUpsert — aniosRetencion válido pasa
 *     3.  reglaUpsert — motivoLegal < 5 chars falla
 *     4.  reglaUpsert — cie10Pattern null (default) válido
 *   Zod — expedientes:
 *     5.  listExpedientes — diasProximos > 365 falla
 *     6.  listExpedientes — diasProximos default 90
 *   Zod — eliminacion:
 *     7.  solicitar — motivoBaja < 20 chars falla
 *     8.  firmar — numeroFirma = 3 falla (solo 1 o 2)
 *   Mutations:
 *     9.  reglas.list — devuelve array
 *     10. reglas.upsert — crea regla devuelve id
 *     11. reglas.upsert — actualiza regla devuelve id (con id input)
 *     12. eliminacion.solicitar — NOT_FOUND si episodio no existe
 *     13. eliminacion.solicitar — CONFLICT si ya hay solicitud activa
 *     14. eliminacion.solicitar — happy path devuelve id
 *     15. eliminacion.rechazar — NOT_FOUND si solicitud no existe
 *     16. eliminacion.rechazar — happy path devuelve ok
 *
 * @QA E2E: apps/web/e2e/fase2/retencion.spec.ts
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Schemas inline
// ---------------------------------------------------------------------------

const reglaUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  cie10Pattern: z.string().max(20).nullable().default(null),
  aniosRetencion: z.number().int().min(1).max(100),
  motivoLegal: z.string().min(5).max(500),
  vigenteDesde: z.string().datetime({ offset: true }).optional(),
  vigenteHasta: z.string().datetime({ offset: true }).optional().nullable(),
});

const listExpedientesSchema = z.object({
  diasProximos: z.number().int().min(1).max(365).default(90),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

const solicitarSchema = z.object({
  episodioId: z.string().uuid(),
  motivoBaja: z.string().min(20).max(2000),
  reglaRetencionId: z.string().uuid().optional(),
});

const firmarSchema = z.object({
  eliminacionId: z.string().uuid(),
  firmaPin: z.string().min(4).max(20),
  numeroFirma: z.literal(1).or(z.literal(2)),
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../rls-context", () => ({
  withTenantContext: async (
    _prisma: PrismaClient,
    _tenant: unknown,
    fn: (tx: PrismaClient) => Promise<unknown>,
    _opts?: unknown,
  ) => fn(_prisma),
}));

import { retencionRouter } from "../retencion.router";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORG_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000002";
const EPISODIO_ID = "30000000-0000-4000-8000-000000000003";
const REGLA_ID = "40000000-0000-4000-8000-000000000004";
const ELIM_ID = "50000000-0000-4000-8000-000000000005";

function buildCtx(roleCodes: string[] = ["DIR"]) {
  const prisma = mockDeep<PrismaClient>();
  prisma.$transaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  );
  (prisma.$executeRaw as ReturnType<typeof vi.fn>).mockResolvedValue(1);
  (prisma.$executeRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue(0);

  return {
    prisma,
    user: { id: USER_ID, email: "dir@test.com", fullName: "Director Test" },
    tenant: {
      organizationId: ORG_ID,
      roleCodes,
    },
  };
}

type Ctx = ReturnType<typeof buildCtx>;

// ---------------------------------------------------------------------------
// Tests — Zod validators
// ---------------------------------------------------------------------------

describe("retencionRouter — Zod validators", () => {
  it("1. reglaUpsert: aniosRetencion < 1 falla", () => {
    expect(
      reglaUpsertSchema.safeParse({ aniosRetencion: 0, motivoLegal: "Base legal" })
        .success,
    ).toBe(false);
  });

  it("2. reglaUpsert: aniosRetencion válido pasa", () => {
    expect(
      reglaUpsertSchema.safeParse({ aniosRetencion: 10, motivoLegal: "NTEC Art. 6" })
        .success,
    ).toBe(true);
  });

  it("3. reglaUpsert: motivoLegal < 5 chars falla", () => {
    expect(
      reglaUpsertSchema.safeParse({ aniosRetencion: 5, motivoLegal: "NT" }).success,
    ).toBe(false);
  });

  it("4. reglaUpsert: cie10Pattern null (default) válido", () => {
    const r = reglaUpsertSchema.safeParse({
      aniosRetencion: 5,
      motivoLegal: "Base general",
      cie10Pattern: null,
    });
    expect(r.success).toBe(true);
    expect(r.data?.cie10Pattern).toBeNull();
  });

  it("5. listExpedientes: diasProximos > 365 falla", () => {
    expect(
      listExpedientesSchema.safeParse({ diasProximos: 400 }).success,
    ).toBe(false);
  });

  it("6. listExpedientes: diasProximos default es 90", () => {
    const r = listExpedientesSchema.safeParse({});
    expect(r.success).toBe(true);
    expect(r.data?.diasProximos).toBe(90);
  });

  it("7. solicitar: motivoBaja < 20 chars falla", () => {
    expect(
      solicitarSchema.safeParse({
        episodioId: EPISODIO_ID,
        motivoBaja: "Motivo corto",
      }).success,
    ).toBe(false);
  });

  it("8. firmar: numeroFirma = 3 falla (solo 1 o 2)", () => {
    expect(
      firmarSchema.safeParse({
        eliminacionId: ELIM_ID,
        firmaPin: "1234",
        numeroFirma: 3,
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests — reglas.*
// ---------------------------------------------------------------------------

describe("retencionRouter — reglas.list", () => {
  let ctx: Ctx;

  beforeEach(() => {
    ctx = buildCtx(["DIR"]);
  });

  it("9. reglas.list: devuelve array de reglas", async () => {
    const reglaMock = {
      id: REGLA_ID,
      cie10_pattern: "X%",
      anios_retencion: 10,
      motivo_legal: "Causas externas NTEC",
      vigente_desde: new Date(),
      vigente_hasta: null,
    };
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      reglaMock,
    ]);

    const caller = retencionRouter.createCaller(ctx as never);
    const result = await caller.reglas.list();
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toMatchObject({ id: REGLA_ID });
  });
});

describe("retencionRouter — reglas.upsert", () => {
  let ctx: Ctx;

  beforeEach(() => {
    ctx = buildCtx(["DIR"]);
  });

  it("10. upsert: crea regla nueva devuelve id", async () => {
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: REGLA_ID },
    ]);

    const caller = retencionRouter.createCaller(ctx as never);
    const result = await caller.reglas.upsert({
      aniosRetencion: 10,
      motivoLegal: "NTEC Art. 6 — causas externas",
      cie10Pattern: "X%",
    });
    expect(result).toEqual({ id: REGLA_ID });
  });

  it("11. upsert: actualiza regla existente devuelve id", async () => {
    (ctx.prisma.$executeRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce(1);

    const caller = retencionRouter.createCaller(ctx as never);
    const result = await caller.reglas.upsert({
      id: REGLA_ID,
      aniosRetencion: 5,
      motivoLegal: "NTEC Art. 6 — base general",
    });
    expect(result).toEqual({ id: REGLA_ID });
  });
});

// ---------------------------------------------------------------------------
// Tests — eliminacion.*
// ---------------------------------------------------------------------------

describe("retencionRouter — eliminacion.solicitar", () => {
  let ctx: Ctx;

  beforeEach(() => {
    ctx = buildCtx(["DIR"]);
  });

  it("12. solicitar: NOT_FOUND si episodio no existe", async () => {
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const caller = retencionRouter.createCaller(ctx as never);
    await expect(
      caller.eliminacion.solicitar({
        episodioId: EPISODIO_ID,
        motivoBaja:
          "Expediente vencido según regla de retención aplicable al caso forense",
      }),
    ).rejects.toThrow(TRPCError);
  });

  it("13. solicitar: CONFLICT si ya hay solicitud activa", async () => {
    // Episodio existe
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: EPISODIO_ID, fecha_vencimiento_retencion: new Date("2020-01-01") },
    ]);
    // Solicitud activa ya existe
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { count: 1n },
    ]);

    const caller = retencionRouter.createCaller(ctx as never);
    await expect(
      caller.eliminacion.solicitar({
        episodioId: EPISODIO_ID,
        motivoBaja:
          "Expediente vencido según regla de retención aplicable al caso forense",
      }),
    ).rejects.toThrow(TRPCError);
  });

  it("14. solicitar: happy path devuelve id de eliminación", async () => {
    // Episodio existe
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: EPISODIO_ID, fecha_vencimiento_retencion: new Date("2020-01-01") },
    ]);
    // Sin solicitudes activas
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { count: 0n },
    ]);
    // Insert devuelve id
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: ELIM_ID },
    ]);
    // Update episodio a POR_ELIMINAR
    (ctx.prisma.$executeRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce(1);

    const caller = retencionRouter.createCaller(ctx as never);
    const result = await caller.eliminacion.solicitar({
      episodioId: EPISODIO_ID,
      motivoBaja:
        "Expediente vencido según regla de retención aplicable al caso forense",
    });
    expect(result).toEqual({ id: ELIM_ID });
  });
});

describe("retencionRouter — eliminacion.rechazar", () => {
  let ctx: Ctx;

  beforeEach(() => {
    ctx = buildCtx(["DIR"]);
  });

  it("15. rechazar: NOT_FOUND si solicitud no existe", async () => {
    (ctx.prisma.$executeRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce(0);

    const caller = retencionRouter.createCaller(ctx as never);
    await expect(
      caller.eliminacion.rechazar({
        eliminacionId: ELIM_ID,
        motivoRechazo: "El expediente está en proceso judicial activo",
      }),
    ).rejects.toThrow(TRPCError);
  });

  it("16. rechazar: happy path devuelve ok", async () => {
    (ctx.prisma.$executeRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce(1);
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { episodio_id: EPISODIO_ID },
    ]);
    (ctx.prisma.$executeRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce(1);

    const caller = retencionRouter.createCaller(ctx as never);
    const result = await caller.eliminacion.rechazar({
      eliminacionId: ELIM_ID,
      motivoRechazo: "El expediente está en proceso judicial activo",
    });
    expect(result).toEqual({ ok: true });
  });
});
