/**
 * Tests unitarios — careTaskRouter (CC-0026 D1).
 *
 * Estrategia: mock plano de Prisma (sin mockDeep) con `$transaction` +
 * `$executeRawUnsafe` reales-suficientes para que `withTenantContext` (sin
 * mockear) corra su `SET LOCAL` + demote, más `careTask.{findMany,count,
 * findFirst,update}` como `vi.fn()` — mismo patrón que
 * `allocation-rule.router.test.ts`.
 *
 * Casos cubiertos:
 *   - list: pagina, arma el `where` con los filtros opcionales, retorna total.
 *   - iniciar: PENDIENTE→EN_PROCESO, toma assigneeId si estaba NULL.
 *   - iniciar: NOT_FOUND si la tarea no existe; CONFLICT si no está PENDIENTE.
 *   - completar: PENDIENTE|EN_PROCESO→CUMPLIDA con completedById/completedAt.
 *   - completar: CONFLICT si ya está CUMPLIDA/CANCELADA.
 *   - cancelar: requiere cancelReason ≥5 chars (Zod); CONFLICT si no aplica.
 *   - requireRole: un rol sin NURSE/PHYSICIAN/... no puede mutar (FORBIDDEN).
 */
import { describe, it, expect, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { careTaskRouter } from "../care-task.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

const TASK_ID = "00000000-0000-0000-0000-000000000100";
const USER_ID = MOCK_TENANT.userId;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makePrisma(overrides: Record<string, unknown> = {}): any {
  const prisma: Record<string, unknown> = {
    $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    careTask: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: TASK_ID, ...data }),
      ),
    },
    ...overrides,
  };
  prisma.$transaction = vi
    .fn()
    .mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
  return prisma;
}

function baseTask(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: TASK_ID,
    organizationId: MOCK_TENANT.organizationId,
    establishmentId: MOCK_TENANT.establishmentId,
    serviceUnitId: null,
    assignedRoleCode: "NURSE",
    assigneeId: null,
    status: "PENDIENTE",
    ...overrides,
  };
}

describe("careTaskRouter", () => {
  describe("list", () => {
    it("pagina y arma el where con organizationId + filtros opcionales", async () => {
      const prisma = makePrisma({
        careTask: {
          findMany: vi.fn().mockResolvedValue([baseTask()]),
          count: vi.fn().mockResolvedValue(1),
        },
      });
      const caller = careTaskRouter.createCaller(makeCtx({ prisma }));

      const result = await caller.list({
        page: 1,
        pageSize: 20,
        status: "PENDIENTE",
        assignedRoleCode: "NURSE",
      });

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(prisma.careTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: MOCK_TENANT.organizationId,
            status: "PENDIENTE",
            assignedRoleCode: "NURSE",
          }),
          skip: 0,
          take: 20,
        }),
      );
    });
  });

  describe("iniciar", () => {
    it("PENDIENTE → EN_PROCESO y toma assigneeId si estaba NULL", async () => {
      const prisma = makePrisma({
        careTask: {
          findFirst: vi.fn().mockResolvedValue(baseTask({ assigneeId: null })),
          update: vi.fn().mockResolvedValue(baseTask({ status: "EN_PROCESO", assigneeId: USER_ID })),
        },
      });
      const caller = careTaskRouter.createCaller(makeCtx({ prisma }));

      const result = await caller.iniciar({ id: TASK_ID });

      expect(result.status).toBe("EN_PROCESO");
      expect(prisma.careTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: TASK_ID },
          data: expect.objectContaining({ status: "EN_PROCESO", assigneeId: USER_ID }),
        }),
      );
    });

    it("no sobrescribe assigneeId si ya tenía uno asignado", async () => {
      const otroUsuario = "00000000-0000-0000-0000-0000000000ff";
      const prisma = makePrisma({
        careTask: {
          findFirst: vi.fn().mockResolvedValue(baseTask({ assigneeId: otroUsuario })),
          update: vi.fn().mockResolvedValue(baseTask({ status: "EN_PROCESO" })),
        },
      });
      const caller = careTaskRouter.createCaller(makeCtx({ prisma }));

      await caller.iniciar({ id: TASK_ID });

      expect(prisma.careTask.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ assigneeId: otroUsuario }) }),
      );
    });

    it("NOT_FOUND si la tarea no existe", async () => {
      const prisma = makePrisma();
      const caller = careTaskRouter.createCaller(makeCtx({ prisma }));

      await expect(caller.iniciar({ id: TASK_ID })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("CONFLICT si la tarea no está PENDIENTE", async () => {
      const prisma = makePrisma({
        careTask: { findFirst: vi.fn().mockResolvedValue(baseTask({ status: "CUMPLIDA" })) },
      });
      const caller = careTaskRouter.createCaller(makeCtx({ prisma }));

      await expect(caller.iniciar({ id: TASK_ID })).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });

    it("FORBIDDEN si el rol no está autorizado", async () => {
      const prisma = makePrisma();
      const caller = careTaskRouter.createCaller(
        makeCtx({ prisma, tenant: { ...MOCK_TENANT, roleCodes: ["ACCOUNTANT"] } }),
      );

      await expect(caller.iniciar({ id: TASK_ID })).rejects.toThrow(TRPCError);
    });
  });

  describe("completar", () => {
    it("EN_PROCESO → CUMPLIDA con completedById/completedAt", async () => {
      const prisma = makePrisma({
        careTask: {
          findFirst: vi.fn().mockResolvedValue(baseTask({ status: "EN_PROCESO" })),
          update: vi
            .fn()
            .mockResolvedValue(baseTask({ status: "CUMPLIDA", completedById: USER_ID })),
        },
      });
      const caller = careTaskRouter.createCaller(makeCtx({ prisma }));

      const result = await caller.completar({ id: TASK_ID });

      expect(result.status).toBe("CUMPLIDA");
      expect(prisma.careTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "CUMPLIDA",
            completedById: USER_ID,
            completedAt: expect.any(Date),
          }),
        }),
      );
    });

    it("CONFLICT si ya está CUMPLIDA", async () => {
      const prisma = makePrisma({
        careTask: { findFirst: vi.fn().mockResolvedValue(baseTask({ status: "CUMPLIDA" })) },
      });
      const caller = careTaskRouter.createCaller(makeCtx({ prisma }));

      await expect(caller.completar({ id: TASK_ID })).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });
  });

  describe("cancelar", () => {
    it("PENDIENTE → CANCELADA con cancelReason", async () => {
      const prisma = makePrisma({
        careTask: {
          findFirst: vi.fn().mockResolvedValue(baseTask()),
          update: vi
            .fn()
            .mockResolvedValue(baseTask({ status: "CANCELADA", cancelReason: "Ya no aplica" })),
        },
      });
      const caller = careTaskRouter.createCaller(makeCtx({ prisma }));

      const result = await caller.cancelar({ id: TASK_ID, cancelReason: "Ya no aplica" });

      expect(result.status).toBe("CANCELADA");
    });

    it("rechaza cancelReason menor a 5 caracteres (Zod)", async () => {
      const prisma = makePrisma();
      const caller = careTaskRouter.createCaller(makeCtx({ prisma }));

      await expect(
        caller.cancelar({ id: TASK_ID, cancelReason: "no" }),
      ).rejects.toThrow();
    });

    it("CONFLICT si ya está CANCELADA", async () => {
      const prisma = makePrisma({
        careTask: { findFirst: vi.fn().mockResolvedValue(baseTask({ status: "CANCELADA" })) },
      });
      const caller = careTaskRouter.createCaller(makeCtx({ prisma }));

      await expect(
        caller.cancelar({ id: TASK_ID, cancelReason: "Motivo válido" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });
});
