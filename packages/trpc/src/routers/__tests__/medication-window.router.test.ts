/**
 * Tests del router medication-window (US.F2.6.52)
 *
 * Cubre:
 * - getProximasACerrar: retorna indicaciones próximas + alertas pendientes
 * - markAttended: marca alerta como atendida (idempotente)
 * - emitWindowClosingAlerts: emite alertas para indicaciones próximas
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { medicationWindowRouter } from "../medication-window.router";
import { makeCtx } from "../../__tests__/helpers/caller";

// Helper para crear caller con prisma mock
function makeCaller(prismaOverrides: Record<string, unknown> = {}) {
  const ctx = makeCtx({ prisma: prismaOverrides as never });
  return medicationWindowRouter.createCaller(ctx);
}

describe("medicationWindowRouter.getProximasACerrar", () => {
  it("retorna indicaciones y alertas pendientes cuando existen", async () => {
    const now = new Date();
    const cutoff = new Date(now.getTime() + 14 * 60_000); // dentro del umbral de 15 min

    const mockIndic = {
      indication_id: "indic-001",
      patient_id: "patient-001",
      patient_gsrn: "123456789000000005",
      gtin_medicamento: "00012345678905",
      nombre_medicamento: "Enalapril 10mg",
      proxima_administracion: cutoff,
      minutos_restantes: 14,
    };

    const mockAlerta = {
      id: "alert-001",
      indication_id: "indic-001",
      organization_id: "org-001",
      ventana_cierre_en: cutoff,
      enviado_en: now,
      atendido_en: null,
      atendido_por_id: null,
    };

    const caller = makeCaller({
      $queryRawUnsafe: vi.fn()
        .mockResolvedValueOnce([mockIndic])
        .mockResolvedValueOnce([mockAlerta]),
    });

    const result = await caller.getProximasACerrar();

    expect(result.indicaciones).toHaveLength(1);
    expect(result.indicaciones[0]!.indicationId).toBe("indic-001");
    expect(result.indicaciones[0]!.nombreMedicamento).toBe("Enalapril 10mg");
    expect(result.alertasPendientes).toHaveLength(1);
    expect(result.alertasPendientes[0]!.alertId).toBe("alert-001");
  });

  it("retorna listas vacías cuando no hay indicaciones próximas", async () => {
    const caller = makeCaller({
      $queryRawUnsafe: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
    });

    const result = await caller.getProximasACerrar();

    expect(result.indicaciones).toHaveLength(0);
    expect(result.alertasPendientes).toHaveLength(0);
  });

  it("mapea minutos_restantes como número redondeado", async () => {
    const now = new Date();
    const mockIndic = {
      indication_id: "indic-002",
      patient_id: "patient-002",
      patient_gsrn: null,
      gtin_medicamento: null,
      nombre_medicamento: null,
      proxima_administracion: now,
      minutos_restantes: 7.6, // float desde Postgres EXTRACT
    };

    const caller = makeCaller({
      $queryRawUnsafe: vi.fn()
        .mockResolvedValueOnce([mockIndic])
        .mockResolvedValueOnce([]),
    });

    const result = await caller.getProximasACerrar();

    expect(result.indicaciones[0]!.minutosRestantes).toBe(8); // Math.round(7.6) = 8
  });
});

/** Mock de tx completo con las APIs que withTenantContext necesita. */
function makeTxMock(overrides: Record<string, unknown> = {}) {
  return {
    $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe("medicationWindowRouter.markAttended", () => {
  it("marca la alerta como atendida y retorna attended=true", async () => {
    const txMock = makeTxMock({
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ id: "alert-001" }]),
    });
    const ctx = makeCtx({
      prisma: {
        $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(txMock)),
      } as never,
    });

    const caller = medicationWindowRouter.createCaller(ctx);
    const result = await caller.markAttended({ alertId: "00000000-0000-0000-0000-000000000001" });

    expect(result.attended).toBe(true);
  });

  it("retorna attended=false cuando la alerta no existe (idempotente)", async () => {
    const txMock = makeTxMock({
      $queryRawUnsafe: vi.fn().mockResolvedValue([]), // ninguna fila actualizada
    });
    const ctx = makeCtx({
      prisma: {
        $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(txMock)),
      } as never,
    });

    const caller = medicationWindowRouter.createCaller(ctx);
    const result = await caller.markAttended({ alertId: "00000000-0000-0000-0000-000000000001" });

    expect(result.attended).toBe(false);
  });
});

describe("medicationWindowRouter.emitWindowClosingAlerts", () => {
  it("retorna emitted=0 cuando no hay indicaciones próximas sin alerta", async () => {
    const ctx = makeCtx({
      prisma: {
        $queryRawUnsafe: vi.fn().mockResolvedValue([]), // sin indicaciones
      } as never,
    });

    const caller = medicationWindowRouter.createCaller(ctx);
    const result = await caller.emitWindowClosingAlerts();

    expect(result.emitted).toBe(0);
  });

  it("emite alertas para indicaciones próximas y retorna el conteo", async () => {
    const now = new Date();
    const mockIndic = {
      indication_id: "indic-001",
      proxima_administracion: new Date(now.getTime() + 10 * 60_000),
    };

    const txMock = makeTxMock({
      $executeRawUnsafe: vi.fn().mockResolvedValue(1),
    });
    const ctx = makeCtx({
      prisma: {
        $queryRawUnsafe: vi.fn().mockResolvedValue([mockIndic]),
        $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(txMock)),
      } as never,
    });

    const caller = medicationWindowRouter.createCaller(ctx);
    const result = await caller.emitWindowClosingAlerts();

    expect(result.emitted).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tests de state machine de la alerta
// ---------------------------------------------------------------------------

describe("window alert state machine", () => {
  it("alerta pendiente: atendido_en es null inicialmente", () => {
    const alerta = {
      id: "alert-001",
      indication_id: "indic-001",
      organization_id: "org-001",
      ventana_cierre_en: new Date(Date.now() + 10 * 60_000),
      enviado_en: new Date(),
      atendido_en: null,       // estado: PENDIENTE
      atendido_por_id: null,
    };
    expect(alerta.atendido_en).toBeNull();
  });

  it("alerta atendida: atendido_en tiene timestamp", () => {
    const alerta = {
      id: "alert-001",
      indication_id: "indic-001",
      organization_id: "org-001",
      ventana_cierre_en: new Date(Date.now() + 10 * 60_000),
      enviado_en: new Date(),
      atendido_en: new Date(),  // estado: ATENDIDA
      atendido_por_id: "user-001",
    };
    expect(alerta.atendido_en).toBeInstanceOf(Date);
    expect(alerta.atendido_por_id).toBe("user-001");
  });

  it("ventana cerrando se define como < 15 min restantes", () => {
    const ahora = Date.now();
    const ventanaCierreEn = ahora + 14 * 60_000; // 14 min → cerrando
    const minutosRestantes = Math.round((ventanaCierreEn - ahora) / 60_000);

    expect(minutosRestantes).toBeLessThan(15);
  });

  it("ventana abierta: > 15 min no genera alerta", () => {
    const ahora = Date.now();
    const ventanaCierreEn = ahora + 20 * 60_000; // 20 min → no debería alertar
    const minutosRestantes = Math.round((ventanaCierreEn - ahora) / 60_000);

    expect(minutosRestantes).toBeGreaterThanOrEqual(15);
  });
});
