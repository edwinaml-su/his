/**
 * Tests del inventoryRouter (§19 — Wave 8 Phase 2 skeleton).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { inventoryRouter } from "../inventory.router";
import { makeCtx } from "../../__tests__/helpers/caller";

const u = "00000000-0000-0000-0000-000000000001";

describe("inventoryRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  // -------------------------------------------------------------------------
  describe("item.list", () => {
    it("incluye catálogo global y tenant en OR cuando no hay search", async () => {
      prisma.stockItem.findMany.mockResolvedValue([] as never);
      const caller = inventoryRouter.createCaller(makeCtx({ prisma }));
      await caller.item.list({ activeOnly: true, limit: 50 });
      const and = (prisma.stockItem.findMany.mock.calls[0]![0]!.where as {
        AND: object[];
      }).AND;
      expect(and.some((c) => "OR" in c)).toBe(true);
    });

    it("search no sobreescribe tenancy (compone con AND)", async () => {
      prisma.stockItem.findMany.mockResolvedValue([] as never);
      const caller = inventoryRouter.createCaller(makeCtx({ prisma }));
      await caller.item.list({ activeOnly: true, search: "acetam", limit: 10 });
      const and = (prisma.stockItem.findMany.mock.calls[0]![0]!.where as {
        AND: object[];
      }).AND;
      const orsCount = and.filter((c) => "OR" in c).length;
      expect(orsCount).toBeGreaterThanOrEqual(2);
    });

    it("respeta limit", async () => {
      prisma.stockItem.findMany.mockResolvedValue([] as never);
      const caller = inventoryRouter.createCaller(makeCtx({ prisma }));
      await caller.item.list({ activeOnly: true, limit: 7 });
      expect(prisma.stockItem.findMany.mock.calls[0]![0]!.take).toBe(7);
    });
  });

  describe("item.create", () => {
    it("asigna organizationId del tenant por defecto", async () => {
      prisma.stockItem.create.mockResolvedValue({ id: u } as never);
      const caller = inventoryRouter.createCaller(makeCtx({ prisma }));
      await caller.item.create({
        sku: "AC",
        name: "Acetaminofén",
        unitOfMeasure: "TAB",
      });
      const data = prisma.stockItem.create.mock.calls[0]![0]!.data as {
        organizationId: string | null;
      };
      expect(data.organizationId).toBeTruthy();
    });

    it("respeta organizationId=null", async () => {
      prisma.stockItem.create.mockResolvedValue({ id: u } as never);
      const caller = inventoryRouter.createCaller(makeCtx({ prisma }));
      await caller.item.create({
        organizationId: null,
        sku: "GL",
        name: "Global Item",
        unitOfMeasure: "UN",
      });
      const data = prisma.stockItem.create.mock.calls[0]![0]!.data as {
        organizationId: string | null;
      };
      expect(data.organizationId).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe("lot.list / create", () => {
    it("list filtra por organizationId y expiryDate cuando expiringBefore", async () => {
      prisma.stockLot.findMany.mockResolvedValue([] as never);
      const caller = inventoryRouter.createCaller(makeCtx({ prisma }));
      await caller.lot.list({
        activeOnly: true,
        expiringBefore: new Date("2026-12-31"),
        limit: 30,
      });
      const where = prisma.stockLot.findMany.mock.calls[0]![0]!.where as {
        organizationId: string;
        expiryDate: { not: null; lte: Date } | undefined;
      };
      expect(where.organizationId).toBeTruthy();
      expect(where.expiryDate).toBeTruthy();
    });

    it("create NOT_FOUND si establishment no es del tenant", async () => {
      prisma.establishment.findFirst.mockResolvedValue(null as never);
      const caller = inventoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.lot.create({
          establishmentId: u,
          itemId: u,
          lotNumber: "L1",
          quantityOnHand: 5,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("create NOT_FOUND si item no es visible para tenant", async () => {
      prisma.establishment.findFirst.mockResolvedValue({ id: u } as never);
      prisma.stockItem.findFirst.mockResolvedValue(null as never);
      const caller = inventoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.lot.create({
          establishmentId: u,
          itemId: u,
          lotNumber: "L1",
          quantityOnHand: 5,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("create OK setea organizationId", async () => {
      prisma.establishment.findFirst.mockResolvedValue({ id: u } as never);
      prisma.stockItem.findFirst.mockResolvedValue({ id: u } as never);
      prisma.stockLot.create.mockResolvedValue({ id: u } as never);
      const caller = inventoryRouter.createCaller(makeCtx({ prisma }));
      await caller.lot.create({
        establishmentId: u,
        itemId: u,
        lotNumber: "LOT-2027-A",
        expiryDate: new Date("2027-12-31"),
        quantityOnHand: 100,
        costPerUnit: 1.5,
      });
      const data = prisma.stockLot.create.mock.calls[0]![0]!.data as {
        organizationId: string;
        createdBy: string;
      };
      expect(data.organizationId).toBeTruthy();
      expect(data.createdBy).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  describe("movement.create", () => {
    it("NOT_FOUND si establishment no es del tenant", async () => {
      prisma.establishment.findFirst.mockResolvedValue(null as never);
      const caller = inventoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.movement.create({
          establishmentId: u,
          itemId: u,
          type: "IN",
          quantity: 10,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("NOT_FOUND si lot no pertenece al item/tenant", async () => {
      prisma.establishment.findFirst.mockResolvedValue({ id: u } as never);
      prisma.stockLot.findFirst.mockResolvedValue(null as never);
      const caller = inventoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.movement.create({
          establishmentId: u,
          itemId: u,
          lotId: u,
          type: "OUT",
          quantity: 5,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("create OK sin lotId", async () => {
      prisma.establishment.findFirst.mockResolvedValue({ id: u } as never);
      prisma.stockMovement.create.mockResolvedValue({ id: u } as never);
      const caller = inventoryRouter.createCaller(makeCtx({ prisma }));
      await caller.movement.create({
        establishmentId: u,
        itemId: u,
        type: "ADJUST",
        quantity: 2,
        reason: "Conteo físico",
      });
      const data = prisma.stockMovement.create.mock.calls[0]![0]!.data as {
        type: string;
        performedById: string;
      };
      expect(data.type).toBe("ADJUST");
      expect(data.performedById).toBeTruthy();
    });

    it("create TRANSFER OK con lotId y referenceCode", async () => {
      prisma.establishment.findFirst.mockResolvedValue({ id: u } as never);
      prisma.stockLot.findFirst.mockResolvedValue({ id: u } as never);
      prisma.stockMovement.create.mockResolvedValue({ id: u } as never);
      const caller = inventoryRouter.createCaller(makeCtx({ prisma }));
      await caller.movement.create({
        establishmentId: u,
        itemId: u,
        lotId: u,
        type: "TRANSFER",
        quantity: 5,
        referenceCode: "EST-X-002",
      });
      expect(prisma.stockMovement.create).toHaveBeenCalled();
    });
  });

  describe("movement.list / get", () => {
    it("list filtra por organizationId", async () => {
      prisma.stockMovement.findMany.mockResolvedValue([] as never);
      const caller = inventoryRouter.createCaller(makeCtx({ prisma }));
      await caller.movement.list({ limit: 100 });
      const where = prisma.stockMovement.findMany.mock.calls[0]![0]!.where as {
        organizationId: string;
      };
      expect(where.organizationId).toBeTruthy();
    });

    it("list filtra por type y rango de fechas", async () => {
      prisma.stockMovement.findMany.mockResolvedValue([] as never);
      const caller = inventoryRouter.createCaller(makeCtx({ prisma }));
      await caller.movement.list({
        type: "OUT",
        fromDate: new Date("2026-01-01"),
        toDate: new Date("2026-12-31"),
        limit: 100,
      });
      const where = prisma.stockMovement.findMany.mock.calls[0]![0]!.where as {
        type: string;
        performedAt: { gte: Date; lte: Date };
      };
      expect(where.type).toBe("OUT");
      expect(where.performedAt.gte).toBeInstanceOf(Date);
      expect(where.performedAt.lte).toBeInstanceOf(Date);
    });

    it("get NOT_FOUND si no existe", async () => {
      prisma.stockMovement.findFirst.mockResolvedValue(null as never);
      const caller = inventoryRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.movement.get({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });
});
