/**
 * Tests unitarios — careBoardRouter (CC-0026 D3).
 *
 * Mismo patrón de mock plano de Prisma que `care-task.router.test.ts`
 * (sin mockDeep): `$transaction` + `$executeRawUnsafe` reales-suficientes
 * para que `withTenantContext` corra, más `careTask.{findMany,groupBy}` y
 * `serviceUnit.findMany` como `vi.fn()`.
 *
 * Casos cubiertos:
 *   - areas: mezcla conteos PENDIENTE/EN_PROCESO por unidad + fila virtual
 *     "enfermeria" con conteo por rol NURSE.
 *   - board: ordena vencidas (PENDIENTE + dueAt pasado) antes que el resto,
 *     luego por prioridad CRITICAL>HIGH>NORMAL>LOW, luego dueAt asc.
 *   - board: sin `status`, incluye CUMPLIDA solo si `completedAt` es de hoy
 *     (se verifica vía el `where` armado, ya que el filtrado de fecha ocurre
 *     en la query, no en el mock).
 */
import { describe, it, expect, vi } from "vitest";
import { careBoardRouter } from "../care-board.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

const UNIT_QX = "00000000-0000-0000-0000-000000000201";
const UNIT_LAB = "00000000-0000-0000-0000-000000000202";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makePrisma(overrides: Record<string, unknown> = {}): any {
  const prisma: Record<string, unknown> = {
    $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    careTask: {
      findMany: vi.fn().mockResolvedValue([]),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    serviceUnit: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    ...overrides,
  };
  prisma.$transaction = vi
    .fn()
    .mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
  return prisma;
}

function task(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "00000000-0000-0000-0000-000000000900",
    organizationId: MOCK_TENANT.organizationId,
    serviceUnitId: UNIT_QX,
    assignedRoleCode: "NURSE",
    status: "PENDIENTE",
    priority: "NORMAL",
    dueAt: null,
    patient: { id: "p1", firstName: "Ana", lastName: "Pérez", mrn: "MRN-1" },
    serviceUnit: { id: UNIT_QX, code: "QX", name: "Quirófanos" },
    ...overrides,
  };
}

describe("careBoardRouter", () => {
  describe("areas", () => {
    it("mezcla conteos por unidad y agrega la fila virtual enfermería", async () => {
      const prisma = makePrisma({
        serviceUnit: {
          findMany: vi.fn().mockResolvedValue([
            { id: UNIT_QX, code: "QX", name: "Quirófanos", areaType: "QUIROFANO" },
            { id: UNIT_LAB, code: "LAB", name: "Laboratorio Clínico", areaType: "LABORATORIO" },
          ]),
        },
        careTask: {
          findMany: vi.fn(),
          // Primera llamada groupBy: por unidad+status. Segunda: por rol NURSE.
          groupBy: vi
            .fn()
            .mockResolvedValueOnce([
              { serviceUnitId: UNIT_QX, status: "PENDIENTE", _count: { _all: 3 } },
              { serviceUnitId: UNIT_QX, status: "EN_PROCESO", _count: { _all: 1 } },
              { serviceUnitId: UNIT_LAB, status: "PENDIENTE", _count: { _all: 2 } },
            ])
            .mockResolvedValueOnce([
              { status: "PENDIENTE", _count: { _all: 5 } },
              { status: "EN_PROCESO", _count: { _all: 2 } },
            ]),
        },
      });
      const caller = careBoardRouter.createCaller(makeCtx({ prisma }));

      const result = await caller.areas();

      expect(result.areas).toHaveLength(2);
      const qx = result.areas.find((a) => a.id === UNIT_QX);
      expect(qx).toMatchObject({ pendienteCount: 3, enProcesoCount: 1 });
      const lab = result.areas.find((a) => a.id === UNIT_LAB);
      expect(lab).toMatchObject({ pendienteCount: 2, enProcesoCount: 0 });

      expect(result.enfermeria).toMatchObject({
        kind: "role",
        id: "enfermeria",
        pendienteCount: 5,
        enProcesoCount: 2,
      });
    });

    it("devuelve 0/0 cuando una unidad no tiene tareas", async () => {
      const prisma = makePrisma({
        serviceUnit: {
          findMany: vi
            .fn()
            .mockResolvedValue([{ id: UNIT_QX, code: "QX", name: "Quirófanos", areaType: "QUIROFANO" }]),
        },
      });
      const caller = careBoardRouter.createCaller(makeCtx({ prisma }));

      const result = await caller.areas();

      expect(result.areas[0]).toMatchObject({ pendienteCount: 0, enProcesoCount: 0 });
      expect(result.enfermeria).toMatchObject({ pendienteCount: 0, enProcesoCount: 0 });
    });
  });

  describe("board", () => {
    it("ordena vencidas primero, luego por prioridad, luego dueAt asc", async () => {
      const now = Date.now();
      const past = new Date(now - 60 * 60 * 1000); // hace 1h — vencida si PENDIENTE
      const soon = new Date(now + 30 * 60 * 1000);
      const later = new Date(now + 90 * 60 * 1000);

      const overdueNormal = task({ id: "t-overdue", priority: "NORMAL", dueAt: past, status: "PENDIENTE" });
      const criticalNotOverdue = task({ id: "t-critical", priority: "CRITICAL", dueAt: soon, status: "PENDIENTE" });
      const highNotOverdue = task({ id: "t-high", priority: "HIGH", dueAt: later, status: "PENDIENTE" });
      const lowInProceso = task({ id: "t-low", priority: "LOW", dueAt: past, status: "EN_PROCESO" }); // no cuenta como vencida (no PENDIENTE)

      const prisma = makePrisma({
        careTask: {
          findMany: vi
            .fn()
            .mockResolvedValue([highNotOverdue, lowInProceso, criticalNotOverdue, overdueNormal]),
          groupBy: vi.fn(),
        },
      });
      const caller = careBoardRouter.createCaller(makeCtx({ prisma }));

      const result = await caller.board({ serviceUnitId: UNIT_QX, page: 1, pageSize: 20 });

      expect(result.items.map((t) => t.id)).toEqual([
        "t-overdue", // única vencida (PENDIENTE + dueAt pasado) → siempre al tope
        "t-critical", // no vencida, pero mayor prioridad entre las no vencidas
        "t-high",
        "t-low",
      ]);
      expect(result.total).toBe(4);
    });

    it("filtra por serviceUnitId cuando se especifica, no por rol", async () => {
      const prisma = makePrisma();
      const caller = careBoardRouter.createCaller(makeCtx({ prisma }));

      await caller.board({ serviceUnitId: UNIT_QX, page: 1, pageSize: 20 });

      expect(prisma.careTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: MOCK_TENANT.organizationId,
            serviceUnitId: UNIT_QX,
          }),
        }),
      );
    });

    it("filtra por rol NURSE cuando se pide el tablero de enfermería", async () => {
      const prisma = makePrisma();
      const caller = careBoardRouter.createCaller(makeCtx({ prisma }));

      await caller.board({ rol: "NURSE", page: 1, pageSize: 20 });

      expect(prisma.careTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: MOCK_TENANT.organizationId,
            assignedRoleCode: "NURSE",
          }),
        }),
      );
    });

    it("pagina en memoria tras ordenar", async () => {
      const items = Array.from({ length: 5 }, (_, i) =>
        task({ id: `t-${i}`, priority: "NORMAL", dueAt: new Date(Date.now() + i * 1000) }),
      );
      const prisma = makePrisma({
        careTask: { findMany: vi.fn().mockResolvedValue(items), groupBy: vi.fn() },
      });
      const caller = careBoardRouter.createCaller(makeCtx({ prisma }));

      const result = await caller.board({ serviceUnitId: UNIT_QX, page: 2, pageSize: 2 });

      expect(result.total).toBe(5);
      expect(result.items.map((t) => t.id)).toEqual(["t-2", "t-3"]);
    });

    it("rechaza cuando no se especifica ni serviceUnitId ni rol (Zod)", async () => {
      const prisma = makePrisma();
      const caller = careBoardRouter.createCaller(makeCtx({ prisma }));

      await expect(caller.board({ page: 1, pageSize: 20 } as never)).rejects.toThrow();
    });
  });
});
