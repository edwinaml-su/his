/**
 * Tests del audit router (listByEntity, listByUser, listOrgChanges).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { auditRouter } from "../audit.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_USER_ADMIN, MOCK_TENANT } from "@his/test-utils";

function fn<T>(returnValue: T) {
  return vi.fn().mockResolvedValue(returnValue);
}

const BASE_LOG = {
  id: BigInt(1),
  occurredAt: new Date("2025-01-01T00:00:00Z"),
  userId: MOCK_USER_ADMIN.id,
  organizationId: MOCK_TENANT.organizationId,
  action: "UPDATE",
  entity: "Patient",
  entityId: "00000000-0000-0000-0000-000000000099",
  beforeJson: { name: "Antiguo" },
  afterJson: { name: "Nuevo" },
  justification: null,
};

describe("auditRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  // ------------------------------------------------------------------ listByEntity
  describe("listByEntity", () => {
    it("retorna items paginados filtrando por entity+entityId+org", async () => {
      prisma.auditLog.findMany.mockResolvedValue([BASE_LOG] as never);
      prisma.auditLog.count.mockResolvedValue(1);

      const caller = auditRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.listByEntity({
        entity: "Patient",
        entityId: "00000000-0000-0000-0000-000000000099",
      });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(50);
    });

    it("paginacion personalizada se refleja en skip/take", async () => {
      prisma.auditLog.findMany.mockResolvedValue([] as never);
      prisma.auditLog.count.mockResolvedValue(0);

      const caller = auditRouter.createCaller(makeCtx({ prisma }));
      await caller.listByEntity({
        entity: "Patient",
        entityId: "00000000-0000-0000-0000-000000000099",
        page: 3,
        pageSize: 10,
      });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });
  });

  // ------------------------------------------------------------------ listByUser
  describe("listByUser", () => {
    it("retorna logs del usuario con filtro de org", async () => {
      prisma.auditLog.findMany.mockResolvedValue([BASE_LOG] as never);
      prisma.auditLog.count.mockResolvedValue(1);

      const caller = auditRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.listByUser({ userId: MOCK_USER_ADMIN.id });

      expect(result.total).toBe(1);
    });

    it("cuando from y to se proveen se incluye occurredAt en where", async () => {
      prisma.auditLog.findMany.mockResolvedValue([] as never);
      prisma.auditLog.count.mockResolvedValue(0);

      const caller = auditRouter.createCaller(makeCtx({ prisma }));
      const from = new Date("2025-01-01");
      const to = new Date("2025-12-31");
      await caller.listByUser({ userId: MOCK_USER_ADMIN.id, from, to });

      const callArg = prisma.auditLog.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(callArg.where).toMatchObject({
        occurredAt: { gte: from, lte: to },
      });
    });

    it("sin from/to el where no incluye occurredAt", async () => {
      prisma.auditLog.findMany.mockResolvedValue([] as never);
      prisma.auditLog.count.mockResolvedValue(0);

      const caller = auditRouter.createCaller(makeCtx({ prisma }));
      await caller.listByUser({ userId: MOCK_USER_ADMIN.id });

      const callArg = prisma.auditLog.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(callArg.where).not.toHaveProperty("occurredAt");
    });
  });

  // ------------------------------------------------------------------ listOrgChanges
  describe("listOrgChanges", () => {
    it("retorna vacio si el usuario no tiene memberships", async () => {
      prisma.userOrganizationRole.findMany.mockResolvedValue([] as never);

      const caller = auditRouter.createCaller(makeCtx({ prisma, tenant: null }));
      const result = await caller.listOrgChanges({ entityKind: "ALL" });

      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it("cuando hay memberships consulta auditLog y enriquece con userLabel", async () => {
      prisma.userOrganizationRole.findMany.mockResolvedValue([
        { organizationId: MOCK_TENANT.organizationId },
      ] as never);
      prisma.auditLog.findMany.mockResolvedValue([BASE_LOG] as never);
      prisma.auditLog.count.mockResolvedValue(1);
      prisma.user.findMany.mockResolvedValue([
        { id: MOCK_USER_ADMIN.id, fullName: "QA Admin", email: "qa.admin@his.test" },
      ] as never);

      const caller = auditRouter.createCaller(makeCtx({ prisma, tenant: null }));
      const result = await caller.listOrgChanges({ entityKind: "ALL" });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].userLabel).toBe("QA Admin");
    });

    it("filtra por entityKind especifico (Organization)", async () => {
      prisma.userOrganizationRole.findMany.mockResolvedValue([
        { organizationId: MOCK_TENANT.organizationId },
      ] as never);
      prisma.auditLog.findMany.mockResolvedValue([] as never);
      prisma.auditLog.count.mockResolvedValue(0);

      const caller = auditRouter.createCaller(makeCtx({ prisma, tenant: null }));
      await caller.listOrgChanges({ entityKind: "Organization" });

      const callArg = prisma.auditLog.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(callArg.where).toMatchObject({ entity: "Organization" });
    });

    it("changedFields detecta campos modificados correctamente", async () => {
      const log = {
        ...BASE_LOG,
        beforeJson: { name: "Antiguo", active: true },
        afterJson: { name: "Nuevo", active: true },
      };
      prisma.userOrganizationRole.findMany.mockResolvedValue([
        { organizationId: MOCK_TENANT.organizationId },
      ] as never);
      prisma.auditLog.findMany.mockResolvedValue([log] as never);
      prisma.auditLog.count.mockResolvedValue(1);
      prisma.user.findMany.mockResolvedValue([] as never);

      const caller = auditRouter.createCaller(makeCtx({ prisma, tenant: null }));
      const result = await caller.listOrgChanges({ entityKind: "ALL" });

      expect(result.items[0].changedFields).toEqual(["name"]);
    });

    it("changedFields retorna todas las keys cuando before es null (INSERT)", async () => {
      const log = {
        ...BASE_LOG,
        beforeJson: null,
        afterJson: { name: "Nuevo", active: true },
      };
      prisma.userOrganizationRole.findMany.mockResolvedValue([
        { organizationId: MOCK_TENANT.organizationId },
      ] as never);
      prisma.auditLog.findMany.mockResolvedValue([log] as never);
      prisma.auditLog.count.mockResolvedValue(1);
      prisma.user.findMany.mockResolvedValue([] as never);

      const caller = auditRouter.createCaller(makeCtx({ prisma, tenant: null }));
      const result = await caller.listOrgChanges({ entityKind: "ALL" });

      expect(result.items[0].changedFields).toContain("name");
      expect(result.items[0].changedFields).toContain("active");
    });
  });
});
