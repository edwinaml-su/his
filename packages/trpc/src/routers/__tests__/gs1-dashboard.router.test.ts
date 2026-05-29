/**
 * Tests unitarios: gs1DashboardRouter — US.F2.6.5.
 *
 * Verifica: query de conteos, vencimientos, GSRN renovación.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { gs1DashboardRouter } from "../gs1-dashboard.router";
import { makeCtx } from "../../__tests__/helpers/caller";

const UUID_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const UUID_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const UUID_C = "cccccccc-cccc-cccc-cccc-cccccccccccc";

let prisma: DeepMockProxy<PrismaClient>;

beforeEach(() => {
  prisma = mockDeep<PrismaClient>();
  // HI-02 (PR #338): el router envuelve en withTenantContext → prisma.$transaction.
  // Mockear $transaction para ejecutar el callback con prisma directo, y
  // $executeRawUnsafe como no-op (lo llama applyTenantContext con SET LOCAL).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma.$transaction as any).mockImplementation(async (cb: any) => {
    if (typeof cb === "function") return cb(prisma);
    return undefined;
  });
  prisma.$executeRawUnsafe.mockResolvedValue(0 as never);
});

function mockQuerySequence(returnValues: unknown[]) {
  let call = 0;
  return vi.fn().mockImplementation(async () => {
    const val = returnValues[call] ?? [];
    call++;
    return val;
  });
}

describe("gs1Dashboard.summary", () => {
  it("retorna conteos parseados como enteros", async () => {
    prisma.$queryRawUnsafe = mockQuerySequence([
      [{ gsrn_activos: "42", gln_registrados: "15", gtin_con_lotes: "8" }],
      [], // vencimientos
      [], // renovacion
    ]);

    const caller = gs1DashboardRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.summary({ vencimientosDias: 30 });

    expect(result.counts.gsrnActivos).toBe(42);
    expect(result.counts.glnRegistrados).toBe(15);
    expect(result.counts.gtinConLotes).toBe(8);
    expect(typeof result.counts.gsrnActivos).toBe("number");
  });

  it("devuelve conteos en 0 si la BD retorna row vacía", async () => {
    prisma.$queryRawUnsafe = mockQuerySequence([
      [],  // counts row vacía → usa default {0,0,0}
      [],
      [],
    ]);

    const caller = gs1DashboardRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.summary({ vencimientosDias: 30 });

    expect(result.counts.gsrnActivos).toBe(0);
  });

  it("retorna lista de vencimientos próximos con recallStatus", async () => {
    const vencRow = {
      id: UUID_A,
      codigo: "00000000000000",
      descripcion: "Amoxicilina 500mg",
      lote_vencimiento: new Date("2026-05-25"),
      recall_status: "ALERTA",
    };

    prisma.$queryRawUnsafe = mockQuerySequence([
      [{ gsrn_activos: "1", gln_registrados: "1", gtin_con_lotes: "1" }],
      [vencRow],
      [],
    ]);

    const caller = gs1DashboardRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.summary({ vencimientosDias: 30 });

    expect(result.vencimientosPróximos).toHaveLength(1);
    expect(result.vencimientosPróximos[0]!.recallStatus).toBe("ALERTA");
  });

  it("retorna GSRN pendientes de renovación", async () => {
    const gsrnRow = {
      id: UUID_B,
      codigo: "000000000000000000",
      tipo: "profesional",
      referencia_id: UUID_C,
    };

    prisma.$queryRawUnsafe = mockQuerySequence([
      [{ gsrn_activos: "5", gln_registrados: "3", gtin_con_lotes: "2" }],
      [],
      [gsrnRow],
    ]);

    const caller = gs1DashboardRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.summary({ vencimientosDias: 30 });

    expect(result.gsrnPendientesRenovacion).toHaveLength(1);
    expect(result.gsrnPendientesRenovacion[0]!.tipo).toBe("profesional");
  });

  it("recall_status null en vencimiento se normaliza a 'NONE'", async () => {
    const vencRow = {
      id: UUID_A,
      codigo: "00000000000000",
      descripcion: "Test",
      lote_vencimiento: new Date("2026-05-28"),
      recall_status: null,
    };

    prisma.$queryRawUnsafe = mockQuerySequence([
      [{ gsrn_activos: "0", gln_registrados: "0", gtin_con_lotes: "1" }],
      [vencRow],
      [],
    ]);

    const caller = gs1DashboardRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.summary({ vencimientosDias: 30 });

    expect(result.vencimientosPróximos[0]!.recallStatus).toBe("NONE");
  });

  it("incluye generadoEn como Date reciente", async () => {
    prisma.$queryRawUnsafe = mockQuerySequence([[{ gsrn_activos: "0", gln_registrados: "0", gtin_con_lotes: "0" }], [], []]);

    const caller = gs1DashboardRouter.createCaller(makeCtx({ prisma }));
    const before = Date.now();
    const result = await caller.summary({ vencimientosDias: 30 });
    const after = Date.now();

    expect(result.generadoEn.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.generadoEn.getTime()).toBeLessThanOrEqual(after);
  });
});
