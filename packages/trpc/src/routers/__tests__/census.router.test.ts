/**
 * Tests del census router (US-5.4).
 *
 * Cubre:
 *  - bedMap filtra por organizationId del tenant.
 *  - occupancyStats agrega counts por status correctamente.
 *  - dailyMovements respeta el rango [start, end) del día solicitado.
 *  - kpisByService calcula días-cama, giro de cama y estancia promedio.
 *  - Las 4 procedures corren bajo contexto RLS (demote a rol `authenticated`,
 *    OWASP A01:2025 — el rol de Supabase tiene BYPASSRLS, así que sin esto
 *    el aislamiento tenant depende solo del filtro JS).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { censusRouter } from "../census.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

describe("censusRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  let rawCalls: string[];

  /** Toda query PHI/tenant debe correr tras `SET LOCAL ROLE authenticated`. */
  function expectRlsApplied() {
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(rawCalls.some((s) => s.includes("set_tenant_context"))).toBe(true);
    expect(rawCalls.some((s) => s.includes("SET LOCAL ROLE authenticated"))).toBe(true);
  }

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    rawCalls = [];
    // NOTA: NO usamos `installTenantContextMock` (helper de caller.ts) porque
    // hace una reasignación PLANA de `$transaction`/`$executeRawUnsafe`
    // (`prisma.$transaction = async (fn) => fn(prisma)`), que les quita la
    // naturaleza de mock/spy — `expect(...).toHaveBeenCalled()` lanzaría en
    // runtime sobre una función plana. Usamos `.mockImplementation` (mismo
    // patrón que `workflow-inbox.rls.test.ts`) para conservar la capacidad
    // de aseverar sobre las llamadas.
    prisma.$executeRawUnsafe.mockImplementation(((sql: string) => {
      rawCalls.push(sql);
      return Promise.resolve(0);
    }) as never);
    prisma.$transaction.mockImplementation((async (fn: (tx: unknown) => unknown) =>
      typeof fn === "function" ? fn(prisma) : undefined) as never);
  });

  describe("bedMap", () => {
    it("filtra serviceUnit.findMany por organizationId del tenant y demota el rol", async () => {
      prisma.serviceUnit.findMany.mockResolvedValue([] as never);

      const caller = censusRouter.createCaller(makeCtx({ prisma }));
      await caller.bedMap();

      const args = prisma.serviceUnit.findMany.mock.calls[0]![0];
      expect(args.where).toMatchObject({
        organizationId: MOCK_TENANT.organizationId,
        active: true,
      });
      expectRlsApplied();
    });
  });

  describe("occupancyStats", () => {
    it("agrega counts por status, computa occupancyPct y demota el rol", async () => {
      // groupBy global por status: 4 OCCUPIED, 6 FREE, 1 BLOCKED.
      prisma.bed.groupBy.mockImplementation(((args: { by: string[] }) => {
        if (args.by.length === 1) {
          return Promise.resolve([
            { status: "OCCUPIED", _count: { _all: 4 } },
            { status: "FREE", _count: { _all: 6 } },
            { status: "BLOCKED", _count: { _all: 1 } },
          ]);
        }
        // byService — sin pivote para este test.
        return Promise.resolve([]);
      }) as never);
      prisma.serviceUnit.findMany.mockResolvedValue([] as never);

      const caller = censusRouter.createCaller(makeCtx({ prisma }));
      const out = await caller.occupancyStats();

      // total = 11; operational = total - BLOCKED = 10; pct = 4/10 = 40.
      expect(out.global.total).toBe(11);
      expect(out.global.operational).toBe(10);
      expect(out.global.occupied).toBe(4);
      expect(out.global.occupancyPct).toBeCloseTo(40);
      expectRlsApplied();
    });
  });

  describe("dailyMovements", () => {
    it("aplica filtro por ventana del día sobre admittedAt y dischargedAt, y demota el rol", async () => {
      prisma.encounter.findMany.mockResolvedValue([] as never);
      prisma.encounterTransfer.findMany.mockResolvedValue([] as never);

      const date = new Date("2026-05-03T10:00:00Z");
      const caller = censusRouter.createCaller(makeCtx({ prisma }));
      await caller.dailyMovements({ date });

      // Primer call (admissions) — espera admittedAt: { gte: start, lt: end }.
      const admissionsArgs = prisma.encounter.findMany.mock.calls[0]![0];
      const range = admissionsArgs.where.admittedAt as { gte: Date; lt: Date };
      expect(range.gte).toBeInstanceOf(Date);
      expect(range.lt).toBeInstanceOf(Date);
      // [start, end) son 24h exactas.
      expect(range.lt.getTime() - range.gte.getTime()).toBe(24 * 60 * 60 * 1000);
      expectRlsApplied();
    });
  });

  describe("kpisByService", () => {
    const SERVICE_UNIT_ID = "44444444-4444-4444-8444-444444444444";

    it("calcula días-cama, giro de cama y estancia promedio, y demota el rol", async () => {
      prisma.serviceUnit.findFirst.mockResolvedValue({
        id: SERVICE_UNIT_ID,
        name: "Medicina Interna",
      } as never);
      prisma.bed.count.mockResolvedValueOnce(10 as never); // bedTotal
      prisma.bed.count.mockResolvedValueOnce(8 as never); // bedOperational

      const now = new Date("2026-05-10T00:00:00Z");
      const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      // Un egreso de 5 días dentro de la ventana.
      prisma.encounter.findMany.mockResolvedValue([
        {
          admittedAt: new Date(since.getTime() + 24 * 60 * 60 * 1000),
          dischargedAt: new Date(since.getTime() + 6 * 24 * 60 * 60 * 1000),
        },
      ] as never);
      // Una asignación de cama activa durante toda la ventana.
      prisma.bedAssignment.findMany.mockResolvedValue([
        { assignedAt: new Date(since.getTime() - 24 * 60 * 60 * 1000), releasedAt: null },
      ] as never);

      const caller = censusRouter.createCaller(makeCtx({ prisma }));
      const out = await caller.kpisByService({ serviceUnitId: SERVICE_UNIT_ID });

      expect(out.serviceUnitId).toBe(SERVICE_UNIT_ID);
      expect(out.serviceUnitName).toBe("Medicina Interna");
      expect(out.bedTotal).toBe(10);
      expect(out.bedOperational).toBe(8);
      expect(out.dischargesInWindow).toBe(1);
      expect(out.avgLengthOfStay).toBeCloseTo(5, 1);
      // turnover = egresos / camas operativas = 1/8 = 0.125, redondeado a
      // 2 decimales por el router (`Number(turnover.toFixed(2))` → 0.13).
      expect(out.turnover).toBeCloseTo(0.13, 2);
      expectRlsApplied();
    });

    it("serviceUnitName es null si el servicio no existe/no pertenece al tenant", async () => {
      prisma.serviceUnit.findFirst.mockResolvedValue(null as never);
      prisma.bed.count.mockResolvedValue(0 as never);
      prisma.encounter.findMany.mockResolvedValue([] as never);
      prisma.bedAssignment.findMany.mockResolvedValue([] as never);

      const caller = censusRouter.createCaller(makeCtx({ prisma }));
      const out = await caller.kpisByService({ serviceUnitId: SERVICE_UNIT_ID });

      expect(out.serviceUnitName).toBeNull();
      expect(out.dischargesInWindow).toBe(0);
      expect(out.turnover).toBe(0);
      expect(out.avgLengthOfStay).toBe(0);
    });
  });
});
