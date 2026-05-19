/**
 * gs1-lote-trace.router.test.ts
 *
 * HI-10 (P0): loteTrace — trazabilidad por número de lote.
 * HI-11 (P1): initiateRecall — control de rol + idempotencia.
 *
 * Estrategia: mock de prisma.$queryRawUnsafe / $executeRawUnsafe / $transaction.
 * No requiere BD activa.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { gs1LoteTraceRouter } from "../gs1-lote-trace.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

// Mock @his/database porque el stub del worktree no exporta emitDomainEvent.
vi.mock("@his/database", () => ({
  emitDomainEvent: vi.fn().mockResolvedValue({ id: "evt-mocked" }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GTIN_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const LOT_NUMBER = "LOTE-2026-ABC";

function makeGtinRow(overrides: Record<string, unknown> = {}) {
  return {
    id: GTIN_ID,
    codigo: "07501000001234",
    descripcion: "Amoxicilina 500 mg Cápsulas",
    fabricante: "Lab Pharma SA",
    recall_status: "NONE",
    activo: true,
    ...overrides,
  };
}

function makeRecepcionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "rec-001",
    fecha: new Date("2026-05-01T08:00:00Z"),
    numero_documento_recepcion: "FAC-2026-001",
    proveedor_gln: "8000000000001",
    sscc_pallet: "180012345678901234",
    ...overrides,
  };
}

function makeEpcisRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-001",
    event_time: new Date("2026-05-02T10:00:00Z"),
    subtipo: "PHARMACY_DISPENSE",
    what: { gtin: "07501000001234", lote: LOT_NUMBER },
    where_data: { readPoint: "8000000000001" },
    who: { gsrnProfesional: "800000000000000001" },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let prisma: DeepMockProxy<PrismaClient>;

beforeEach(() => {
  prisma = mockDeep<PrismaClient>();
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// loteTrace
// ---------------------------------------------------------------------------

describe("gs1LoteTrace.loteTrace", () => {
  it("devuelve datos completos para un lote existente", async () => {
    // 3 queries: gtin, recepciones, movimientos, dispensaciones
    prisma.$queryRawUnsafe = vi
      .fn()
      .mockResolvedValueOnce([makeGtinRow()])          // gtin
      .mockResolvedValueOnce([makeRecepcionRow()])     // recepciones
      .mockResolvedValueOnce([makeEpcisRow()])         // movimientos
      .mockResolvedValueOnce([]);                      // dispensaciones

    const caller = gs1LoteTraceRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.loteTrace({ lotNumber: LOT_NUMBER });

    expect(result.gtin).not.toBeNull();
    expect(result.gtin?.codigo).toBe("07501000001234");
    expect(result.gtin?.recallStatus).toBe("NONE");
    expect(result.recepciones).toHaveLength(1);
    expect(result.recepciones[0]!.establecimientoOrigen).toBe("8000000000001");
    expect(result.movimientos).toHaveLength(1);
    expect(result.movimientos[0]!.tipo).toBe("PHARMACY_DISPENSE");
    expect(result.dispensaciones).toHaveLength(0);
  });

  it("devuelve gtin null y arrays vacíos para lote inexistente (no 404)", async () => {
    prisma.$queryRawUnsafe = vi
      .fn()
      .mockResolvedValueOnce([])   // gtin no encontrado
      .mockResolvedValueOnce([])   // recepciones vacías
      .mockResolvedValueOnce([])   // movimientos vacíos
      .mockResolvedValueOnce([]);  // dispensaciones vacías

    const caller = gs1LoteTraceRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.loteTrace({ lotNumber: "LOTE-INEXISTENTE" });

    expect(result.gtin).toBeNull();
    expect(result.recepciones).toHaveLength(0);
    expect(result.movimientos).toHaveLength(0);
    expect(result.dispensaciones).toHaveLength(0);
  });

  it("incluye dispensaciones cuando hay eventos consumed", async () => {
    const dispRow = {
      id: "disp-001",
      event_time: new Date("2026-05-03T11:00:00Z"),
      patient_id: "pat-uuid-001",
      prescripcion_id: "rx-uuid-001",
    };
    prisma.$queryRawUnsafe = vi
      .fn()
      .mockResolvedValueOnce([makeGtinRow()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([dispRow]);

    const caller = gs1LoteTraceRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.loteTrace({ lotNumber: LOT_NUMBER });

    expect(result.dispensaciones).toHaveLength(1);
    expect(result.dispensaciones[0]!.paciente_id).toBe("pat-uuid-001");
    expect(result.dispensaciones[0]!.prescripcion_id).toBe("rx-uuid-001");
  });

  it("mapea recallStatus correctamente cuando está en recall", async () => {
    prisma.$queryRawUnsafe = vi
      .fn()
      .mockResolvedValueOnce([makeGtinRow({ recall_status: "INICIADO" })])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const caller = gs1LoteTraceRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.loteTrace({ lotNumber: LOT_NUMBER });

    expect(result.gtin?.recallStatus).toBe("INICIADO");
  });
});

// ---------------------------------------------------------------------------
// initiateRecall
// ---------------------------------------------------------------------------

describe("gs1LoteTrace.initiateRecall", () => {
  const recallInput = {
    gtinId:    GTIN_ID,
    motivo:    "Contaminación detectada en lote — MINSAL notificado",
    severidad: "VOLUNTARIO" as const,
  };

  it("happy path: marca recall y emite evento de dominio", async () => {
    // withTenantContext usa $transaction internamente
    prisma.$transaction = vi.fn().mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const txMock = {
          $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
          $queryRawUnsafe: vi.fn().mockResolvedValue([{ recall_status: "NONE" }]),
          domainEvent: {
            create: vi.fn().mockResolvedValue({ id: "evt-001" }),
          },
          auditLog: {
            create: vi.fn().mockResolvedValue({ id: "audit-001" }),
          },
        };
        return fn(txMock);
      },
    );

    const caller = gs1LoteTraceRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.initiateRecall(recallInput);

    expect(result.ok).toBe(true);
  });

  it("lanza NOT_FOUND si el GTIN no existe", async () => {
    prisma.$transaction = vi.fn().mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const txMock = {
          $executeRawUnsafe: vi.fn(),
          $queryRawUnsafe: vi.fn().mockResolvedValue([]),  // GTIN no encontrado
          domainEvent: { create: vi.fn() },
          auditLog: { create: vi.fn() },
        };
        return fn(txMock);
      },
    );

    const caller = gs1LoteTraceRouter.createCaller(makeCtx({ prisma }));
    await expect(caller.initiateRecall(recallInput)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("lanza CONFLICT si el GTIN ya tiene recall activo (idempotencia)", async () => {
    prisma.$transaction = vi.fn().mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const txMock = {
          $executeRawUnsafe: vi.fn(),
          $queryRawUnsafe: vi.fn().mockResolvedValue([{ recall_status: "INICIADO" }]),
          domainEvent: { create: vi.fn() },
          auditLog: { create: vi.fn() },
        };
        return fn(txMock);
      },
    );

    const caller = gs1LoteTraceRouter.createCaller(makeCtx({ prisma }));
    await expect(caller.initiateRecall(recallInput)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("lanza CONFLICT si recall_status es OBLIGATORIO (ya activo)", async () => {
    prisma.$transaction = vi.fn().mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const txMock = {
          $executeRawUnsafe: vi.fn(),
          $queryRawUnsafe: vi.fn().mockResolvedValue([{ recall_status: "OBLIGATORIO" }]),
          domainEvent: { create: vi.fn() },
          auditLog: { create: vi.fn() },
        };
        return fn(txMock);
      },
    );

    const caller = gs1LoteTraceRouter.createCaller(makeCtx({ prisma }));
    await expect(caller.initiateRecall(recallInput)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("lanza FORBIDDEN para usuario sin rol ADMIN/DIRECTOR (HI-11)", async () => {
    const tenantSinRol = {
      ...MOCK_TENANT,
      roleCodes: ["NURSE", "PHARM"],  // Sin ADMIN ni DIRECTOR
    };

    const caller = gs1LoteTraceRouter.createCaller(
      makeCtx({ prisma, tenant: tenantSinRol }),
    );

    await expect(caller.initiateRecall(recallInput)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("lanza error de validación Zod si motivo < 10 caracteres", async () => {
    const caller = gs1LoteTraceRouter.createCaller(makeCtx({ prisma }));

    await expect(
      caller.initiateRecall({ ...recallInput, motivo: "corto" }),
    ).rejects.toThrow();
  });
});
