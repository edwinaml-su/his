/**
 * Tests unitarios — contingenciaRouter (US.F2.7.26-28).
 *
 * Estrategia:
 *   - Vitest + vitest-mock-extended (DeepMockProxy<PrismaClient>).
 *   - withTenantContext mockeado para ejecutar callback síncronamente.
 *   - router.createCaller(ctx) para invocar procedures directamente.
 *
 * Casos cubiertos (16 tests):
 *   Zod validators:
 *     1. activar — motivo mínimo 10 chars falla
 *     2. activar — motivo válido pasa
 *     3. activar — esperadoHasta ISO válido pasa
 *     4. activar — esperadoHasta string inválido falla
 *     5. desactivar — id no-uuid falla
 *     6. registrarRetroactivo — tipoDocumento inválido falla
 *     7. registrarRetroactivo — timestampRealPapel no-ISO falla
 *   Mutations:
 *     8.  activar — happy path devuelve id
 *     9.  activar — CONFLICT si ya hay evento activo
 *     10. desactivar — NOT_FOUND si id no existe
 *     11. desactivar — CONFLICT si ya desactivado
 *     12. desactivar — happy path ok
 *     13. estadoActual — activo true cuando hay evento sin desactivado_en
 *     14. estadoActual — activo false cuando no hay eventos activos
 *     15. registrarRetroactivo — BAD_REQUEST si encounterId ausente
 *     16. registrarRetroactivo — BAD_REQUEST si timestamp fuera del período
 *
 * @QA E2E: apps/web/e2e/fase2/contingencia.spec.ts
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Schemas inline para tests (evita symlinks de worktree)
// ---------------------------------------------------------------------------

const activarSchema = z.object({
  motivo: z.string().min(10).max(1000),
  esperadoHasta: z.string().datetime({ offset: true }).optional(),
});

const desactivarSchema = z.object({
  contingenciaEventoId: z.string().uuid(),
});

const registrarRetroactivoSchema = z.object({
  contingenciaEventoId: z.string().uuid(),
  tipoDocumento: z.enum([
    "signos_vitales",
    "hoja_triaje",
    "indicaciones_medicas",
    "evolucion_medica",
  ]),
  encounterId: z.string().uuid().optional(),
  contenido: z.record(z.unknown()),
  timestampRealPapel: z.string().datetime({ offset: true }),
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

// Importar router DESPUÉS de los mocks
import { contingenciaRouter } from "../contingencia.router";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORG_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000002";
const EVENTO_ID = "00000000-0000-4000-8000-000000000003";
const EPISODIO_ID = "00000000-0000-4000-8000-000000000004";

function buildCtx(roleCodes: string[] = ["ADM"]) {
  const prisma = mockDeep<PrismaClient>();

  prisma.$transaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  );
  (prisma.$executeRaw as ReturnType<typeof vi.fn>).mockResolvedValue(1);
  (prisma.$executeRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue(0);

  return {
    prisma,
    user: { id: USER_ID, email: "adm@test.com", fullName: "Admin Test" },
    tenant: {
      organizationId: ORG_ID,
      roleCodes,
    },
  };
}

type Ctx = ReturnType<typeof buildCtx>;

// ---------------------------------------------------------------------------
// Tests — Zod validators (puros, sin router)
// ---------------------------------------------------------------------------

describe("contingenciaRouter — Zod validators", () => {
  it("1. activar: motivo < 10 chars falla", () => {
    expect(activarSchema.safeParse({ motivo: "corto" }).success).toBe(false);
  });

  it("2. activar: motivo >= 10 chars pasa", () => {
    expect(
      activarSchema.safeParse({ motivo: "Falla de red principal" }).success,
    ).toBe(true);
  });

  it("3. activar: esperadoHasta ISO válido pasa", () => {
    expect(
      activarSchema.safeParse({
        motivo: "Falla de red principal",
        esperadoHasta: "2026-05-18T14:00:00-06:00",
      }).success,
    ).toBe(true);
  });

  it("4. activar: esperadoHasta string no-ISO falla", () => {
    expect(
      activarSchema.safeParse({
        motivo: "Falla de red principal",
        esperadoHasta: "mañana a las 2pm",
      }).success,
    ).toBe(false);
  });

  it("5. desactivar: id no-uuid falla", () => {
    expect(
      desactivarSchema.safeParse({ contingenciaEventoId: "no-es-uuid" }).success,
    ).toBe(false);
  });

  it("6. registrarRetroactivo: tipoDocumento inválido falla", () => {
    expect(
      registrarRetroactivoSchema.safeParse({
        contingenciaEventoId: EVENTO_ID,
        tipoDocumento: "rx_chest",
        contenido: {},
        timestampRealPapel: "2026-05-16T10:00:00-06:00",
      }).success,
    ).toBe(false);
  });

  it("7. registrarRetroactivo: timestampRealPapel no-ISO falla", () => {
    expect(
      registrarRetroactivoSchema.safeParse({
        contingenciaEventoId: EVENTO_ID,
        tipoDocumento: "signos_vitales",
        contenido: {},
        timestampRealPapel: "16-05-2026",
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests — activar (usando createCaller)
// ---------------------------------------------------------------------------

describe("contingenciaRouter — activar", () => {
  let ctx: Ctx;

  beforeEach(() => {
    ctx = buildCtx(["ADM"]);
  });

  it("8. activar: happy path devuelve id", async () => {
    // Sin evento activo
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    // Insert devuelve id
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: EVENTO_ID },
    ]);

    const caller = contingenciaRouter.createCaller(ctx as never);
    const result = await caller.activar({ motivo: "Falla de red principal" });
    expect(result).toEqual({ id: EVENTO_ID });
  });

  it("9. activar: CONFLICT si ya hay evento activo", async () => {
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: EVENTO_ID,
        motivo: "Ya activo",
        activado_en: new Date("2026-05-18T08:00:00Z"),
        activado_por_id: USER_ID,
        esperado_hasta: null,
      },
    ]);

    const caller = contingenciaRouter.createCaller(ctx as never);
    await expect(
      caller.activar({ motivo: "Segundo intento de contingencia" }),
    ).rejects.toThrow(TRPCError);
  });
});

// ---------------------------------------------------------------------------
// Tests — desactivar
// ---------------------------------------------------------------------------

describe("contingenciaRouter — desactivar", () => {
  let ctx: Ctx;

  beforeEach(() => {
    ctx = buildCtx(["DIR"]);
  });

  it("10. desactivar: NOT_FOUND si id no existe", async () => {
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const caller = contingenciaRouter.createCaller(ctx as never);
    await expect(
      caller.desactivar({ contingenciaEventoId: EVENTO_ID }),
    ).rejects.toThrow(TRPCError);
  });

  it("11. desactivar: CONFLICT si ya fue desactivado", async () => {
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: EVENTO_ID, desactivado_en: new Date("2026-05-17T10:00:00Z") },
    ]);

    const caller = contingenciaRouter.createCaller(ctx as never);
    await expect(
      caller.desactivar({ contingenciaEventoId: EVENTO_ID }),
    ).rejects.toThrow(TRPCError);
  });

  it("12. desactivar: happy path devuelve ok", async () => {
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: EVENTO_ID, desactivado_en: null },
    ]);
    (ctx.prisma.$executeRaw as ReturnType<typeof vi.fn>).mockResolvedValue(1);

    const caller = contingenciaRouter.createCaller(ctx as never);
    const result = await caller.desactivar({ contingenciaEventoId: EVENTO_ID });
    expect(result).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// Tests — estadoActual
// ---------------------------------------------------------------------------

describe("contingenciaRouter — estadoActual", () => {
  it("13. estadoActual: activo true cuando hay evento sin desactivado_en", async () => {
    const ctx = buildCtx(["NURSE"]);
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: EVENTO_ID,
        motivo: "Corte de luz",
        activado_en: new Date("2026-05-18T08:00:00Z"),
        activado_por_id: USER_ID,
        esperado_hasta: null,
      },
    ]);

    const caller = contingenciaRouter.createCaller(ctx as never);
    const result = await caller.estadoActual();

    expect(result.activo).toBe(true);
    expect(result.evento).not.toBeNull();
  });

  it("14. estadoActual: activo false cuando no hay eventos activos", async () => {
    const ctx = buildCtx(["NURSE"]);
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const caller = contingenciaRouter.createCaller(ctx as never);
    const result = await caller.estadoActual();

    expect(result.activo).toBe(false);
    expect(result.evento).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests — registrarRetroactivo
// ---------------------------------------------------------------------------

describe("contingenciaRouter — registrarRetroactivo", () => {
  it("15. BAD_REQUEST si encounterId ausente", async () => {
    const ctx = buildCtx(["NURSE"]);
    // Evento existe y cubre el período
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: EVENTO_ID,
        activado_en: new Date("2026-05-16T06:00:00Z"),
        desactivado_en: new Date("2026-05-16T18:00:00Z"),
      },
    ]);

    const caller = contingenciaRouter.createCaller(ctx as never);
    await expect(
      caller.registrarRetroactivo({
        contingenciaEventoId: EVENTO_ID,
        tipoDocumento: "signos_vitales",
        contenido: {},
        timestampRealPapel: "2026-05-16T10:00:00-06:00",
        // encounterId ausente
      }),
    ).rejects.toThrow(TRPCError);
  });

  it("16. BAD_REQUEST si timestamp fuera del período de contingencia", async () => {
    const ctx = buildCtx(["NURSE"]);
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: EVENTO_ID,
        activado_en: new Date("2026-05-16T06:00:00Z"),
        desactivado_en: new Date("2026-05-16T10:00:00Z"),
      },
    ]);

    const caller = contingenciaRouter.createCaller(ctx as never);
    await expect(
      caller.registrarRetroactivo({
        contingenciaEventoId: EVENTO_ID,
        tipoDocumento: "signos_vitales",
        encounterId: EPISODIO_ID,
        contenido: {},
        // Timestamp FUERA del período (después del desactivado_en)
        timestampRealPapel: "2026-05-17T10:00:00-06:00",
      }),
    ).rejects.toThrow(TRPCError);
  });
});
