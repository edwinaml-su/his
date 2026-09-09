/**
 * Tests del inventoryRouter (§19 — Beta.10 hardening layer 1).
 *
 * New coverage:
 *   - FEFO enforcement on OUT / movement.out
 *   - Negative stock guard on OUT
 *   - expiringLots endpoint
 *   - TRANSFER blocked via movement.create (must use movement.transfer)
 *   - movement.transfer atomicity (paired $transaction)
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { inventoryRouter } from "../inventory.router";
import { makeCtx } from "../../__tests__/helpers/caller";

const u = "00000000-0000-0000-0000-000000000001";
const u2 = "00000000-0000-0000-0000-000000000002";

describe("inventoryRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    // withTenantContext usa prisma.$transaction(callback). El mock deep no ejecuta
    // el callback por defecto — lo configuramos para que lo haga con prisma como tx,
    // lo que permite que los mocks de stockMovement.create, stockLot.create, etc. sean
    // interceptados dentro del withTenantContext. Aplica solo cuando el arg es función.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as any).mockImplementation(async (fnOrArray: unknown) => {
      if (typeof fnOrArray === "function") {
        return fnOrArray(prisma);
      }
      // Forma array (no usada en inventory ahora, pero por compatibilidad):
      return Promise.all(fnOrArray as Promise<unknown>[]);
    });
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
  describe("expiringLots", () => {
    it("filtra por organizationId y cutoff date con daysAhead=30", async () => {
      prisma.stockLot.findMany.mockResolvedValue([] as never);
      const caller = inventoryRouter.createCaller(makeCtx({ prisma }));
      await caller.expiringLots({ daysAhead: 30, limit: 50 });
      const where = prisma.stockLot.findMany.mock.calls[0]![0]!.where as {
        organizationId: string;
        expiryDate: { not: null; lte: Date };
        quantityOnHand: { gt: number };
      };
      expect(where.organizationId).toBeTruthy();
      expect(where.expiryDate.lte).toBeInstanceOf(Date);
      expect(where.quantityOnHand).toMatchObject({ gt: 0 });
    });

    it("filtra por establishmentId y itemId cuando se pasan", async () => {
      prisma.stockLot.findMany.mockResolvedValue([] as never);
      const caller = inventoryRouter.createCaller(makeCtx({ prisma }));
      await caller.expiringLots({ daysAhead: 7, establishmentId: u, itemId: u, limit: 10 });
      const where = prisma.stockLot.findMany.mock.calls[0]![0]!.where as {
        establishmentId: string;
        itemId: string;
      };
      expect(where.establishmentId).toBe(u);
      expect(where.itemId).toBe(u);
    });

    it("cutoff = now + daysAhead días", async () => {
      prisma.stockLot.findMany.mockResolvedValue([] as never);
      const before = new Date();
      const caller = inventoryRouter.createCaller(makeCtx({ prisma }));
      await caller.expiringLots({ daysAhead: 15, limit: 50 });
      const after = new Date();
      const where = prisma.stockLot.findMany.mock.calls[0]![0]!.where as {
        expiryDate: { lte: Date };
      };
      const cutoff = where.expiryDate.lte;
      const expectedMin = new Date(before);
      expectedMin.setDate(expectedMin.getDate() + 15);
      const expectedMax = new Date(after);
      expectedMax.setDate(expectedMax.getDate() + 15);
      expect(cutoff.getTime()).toBeGreaterThanOrEqual(expectedMin.getTime());
      expect(cutoff.getTime()).toBeLessThanOrEqual(expectedMax.getTime());
    });
  });

  // -------------------------------------------------------------------------
  describe("movement.create — FEFO + negative stock guards", () => {
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
      // FEFO query returns null (no lots with expiry) so no FEFO violation,
      // then lot ownership check returns null → NOT_FOUND.
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

    it("PRECONDITION_FAILED si FEFO violation (earlier lot exists)", async () => {
      prisma.establishment.findFirst.mockResolvedValue({ id: u } as never);
      // FEFO query returns a DIFFERENT lot (u2) as the earliest-expiring.
      prisma.stockLot.findFirst.mockResolvedValueOnce({
        id: u2,
        lotNumber: "LOT-EARLIER",
        expiryDate: new Date("2026-06-01"),
      } as never);
      const caller = inventoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.movement.create({
          establishmentId: u,
          itemId: u,
          lotId: u,
          type: "OUT",
          quantity: 5,
        }),
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringContaining("FEFO violation: lot LOT-EARLIER expires earlier"),
      });
    });

    it("PRECONDITION_FAILED si stock insuficiente en OUT", async () => {
      prisma.establishment.findFirst.mockResolvedValue({ id: u } as never);
      // FEFO: earliest lot IS the consumed lot (no FEFO violation).
      prisma.stockLot.findFirst
        .mockResolvedValueOnce({ id: u, lotNumber: "LOT-A", expiryDate: new Date("2027-01-01") } as never)
        // Lot ownership check: quantity < requested.
        .mockResolvedValueOnce({ id: u, quantityOnHand: 3, qualityStatus: "AVAILABLE" } as never);
      const caller = inventoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.movement.create({
          establishmentId: u,
          itemId: u,
          lotId: u,
          type: "OUT",
          quantity: 10,
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("create OK sin lotId (ADJUST)", async () => {
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

    it("BAD_REQUEST si type es TRANSFER (debe usar movement.transfer)", async () => {
      prisma.establishment.findFirst.mockResolvedValue({ id: u } as never);
      const caller = inventoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.movement.create({
          establishmentId: u,
          itemId: u,
          type: "TRANSFER",
          quantity: 5,
          referenceCode: "REF-001",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  // -------------------------------------------------------------------------
  describe("movement.out — FEFO enforcement", () => {
    it("BAD_REQUEST si type no es OUT", async () => {
      const caller = inventoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.movement.out({
          establishmentId: u,
          itemId: u,
          type: "IN",
          quantity: 5,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("OUT sin lotId OK (no FEFO check needed)", async () => {
      prisma.establishment.findFirst.mockResolvedValue({ id: u } as never);
      prisma.stockMovement.create.mockResolvedValue({ id: u } as never);
      const caller = inventoryRouter.createCaller(makeCtx({ prisma }));
      await caller.movement.out({
        establishmentId: u,
        itemId: u,
        type: "OUT",
        quantity: 5,
      });
      expect(prisma.stockMovement.create).toHaveBeenCalled();
    });

    it("OUT con FEFO compliant lot pasa", async () => {
      prisma.establishment.findFirst.mockResolvedValue({ id: u } as never);
      // FEFO: earliest lot IS the consumed lot.
      prisma.stockLot.findFirst
        .mockResolvedValueOnce({ id: u, lotNumber: "LOT-A", expiryDate: new Date("2027-01-01") } as never)
        .mockResolvedValueOnce({ id: u, quantityOnHand: 50, qualityStatus: "AVAILABLE" } as never);
      prisma.stockMovement.create.mockResolvedValue({ id: u } as never);
      const caller = inventoryRouter.createCaller(makeCtx({ prisma }));
      await caller.movement.out({
        establishmentId: u,
        itemId: u,
        lotId: u,
        type: "OUT",
        quantity: 10,
      });
      expect(prisma.stockMovement.create).toHaveBeenCalled();
    });

    it("OUT bloqueado si el lote no está AVAILABLE (recall/cuarentena)", async () => {
      prisma.establishment.findFirst.mockResolvedValue({ id: u } as never);
      // FEFO: el lote consumido ES el earliest (sin violación FEFO).
      prisma.stockLot.findFirst
        .mockResolvedValueOnce({ id: u, lotNumber: "LOT-A", expiryDate: new Date("2027-01-01") } as never)
        // Lot ownership: estado de calidad RECALL bloquea la salida.
        .mockResolvedValueOnce({ id: u, quantityOnHand: 50, qualityStatus: "RECALL" } as never);
      const caller = inventoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.movement.out({
          establishmentId: u,
          itemId: u,
          lotId: u,
          type: "OUT",
          quantity: 5,
        }),
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringContaining("estado de calidad: RECALL"),
      });
    });

    it("OUT FEFO violation blocks the movement", async () => {
      prisma.establishment.findFirst.mockResolvedValue({ id: u } as never);
      // FEFO: returns a DIFFERENT lot with earlier expiry.
      prisma.stockLot.findFirst.mockResolvedValueOnce({
        id: u2,
        lotNumber: "LOT-EARLIER",
        expiryDate: new Date("2026-03-01"),
      } as never);
      const caller = inventoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.movement.out({
          establishmentId: u,
          itemId: u,
          lotId: u,
          type: "OUT",
          quantity: 5,
        }),
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringContaining("FEFO violation: lot LOT-EARLIER expires earlier"),
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("movement.transfer — atomic pair", () => {
    it("NOT_FOUND si establecimiento origen no existe", async () => {
      prisma.establishment.findFirst
        .mockResolvedValueOnce(null as never)
        .mockResolvedValueOnce({ id: u2 } as never);
      const caller = inventoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.movement.transfer({
          srcEstablishmentId: u,
          dstEstablishmentId: u2,
          itemId: u,
          srcLotId: u,
          quantity: 5,
          referenceCode: "TRF-001",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("NOT_FOUND si establecimiento destino no existe", async () => {
      prisma.establishment.findFirst
        .mockResolvedValueOnce({ id: u } as never)
        .mockResolvedValueOnce(null as never);
      const caller = inventoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.movement.transfer({
          srcEstablishmentId: u,
          dstEstablishmentId: u2,
          itemId: u,
          srcLotId: u,
          quantity: 5,
          referenceCode: "TRF-001",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("PRECONDITION_FAILED si lote origen no tiene stock suficiente", async () => {
      prisma.establishment.findFirst
        .mockResolvedValueOnce({ id: u } as never)
        .mockResolvedValueOnce({ id: u2 } as never);
      // FEFO: no earlier lot (returns null → no violation).
      prisma.stockLot.findFirst
        .mockResolvedValueOnce(null as never)
        // src lot ownership: quantityOnHand < requested.
        .mockResolvedValueOnce({ id: u, quantityOnHand: 2 } as never);
      const caller = inventoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.movement.transfer({
          srcEstablishmentId: u,
          dstEstablishmentId: u2,
          itemId: u,
          srcLotId: u,
          quantity: 10,
          referenceCode: "TRF-002",
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("crea par OUT+IN con mismo transferGroupId en $transaction", async () => {
      prisma.establishment.findFirst
        .mockResolvedValueOnce({ id: u } as never)
        .mockResolvedValueOnce({ id: u2 } as never);
      // FEFO: no violation.
      prisma.stockLot.findFirst
        .mockResolvedValueOnce(null as never)
        .mockResolvedValueOnce({ id: u, quantityOnHand: 100 } as never);

      // withTenantContext usa callback; el beforeEach ya configura $transaction para
      // ejecutar el callback con prisma. Solo necesitamos mockear los creates:
      prisma.stockMovement.create
        .mockResolvedValueOnce({ id: "out-id" } as never)
        .mockResolvedValueOnce({ id: "in-id" } as never);

      const caller = inventoryRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.movement.transfer({
        srcEstablishmentId: u,
        dstEstablishmentId: u2,
        itemId: u,
        srcLotId: u,
        quantity: 10,
        referenceCode: "TRF-003",
      });

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(result.transferGroupId).toBeTruthy();
      expect(result.outMovementId).toBe("out-id");
      expect(result.inMovementId).toBe("in-id");
    });
  });

  // -------------------------------------------------------------------------
  describe("movement.consumo — docs/48 Ola 3 (C3-3)", () => {
    it("NOT_FOUND si establishment no es del tenant", async () => {
      prisma.establishment.findFirst.mockResolvedValue(null as never);
      const caller = inventoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.movement.consumo({
          establishmentId: u,
          itemId: u,
          quantity: 3,
          motivoConsumo: "ASEO",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("crea un StockMovement type=CONSUMPTION con el motivo catalogado en reason", async () => {
      prisma.establishment.findFirst.mockResolvedValue({ id: u } as never);
      prisma.stockMovement.create.mockResolvedValue({ id: u } as never);
      const caller = inventoryRouter.createCaller(makeCtx({ prisma }));
      await caller.movement.consumo({
        establishmentId: u,
        itemId: u,
        quantity: 3,
        motivoConsumo: "MERMA",
        reason: "vencimiento en bodega",
      });
      const data = prisma.stockMovement.create.mock.calls[0]![0]!.data as {
        type: string;
        quantity: number;
        reason: string;
        performedById: string;
      };
      expect(data.type).toBe("CONSUMPTION");
      expect(data.quantity).toBe(3);
      expect(data.reason).toBe("MERMA: vencimiento en bodega");
      expect(data.performedById).toBeTruthy();
    });

    it("sin reason libre, usa el motivoConsumo tal cual", async () => {
      prisma.establishment.findFirst.mockResolvedValue({ id: u } as never);
      prisma.stockMovement.create.mockResolvedValue({ id: u } as never);
      const caller = inventoryRouter.createCaller(makeCtx({ prisma }));
      await caller.movement.consumo({
        establishmentId: u,
        itemId: u,
        quantity: 1,
        motivoConsumo: "DOCENCIA",
      });
      const data = prisma.stockMovement.create.mock.calls[0]![0]!.data as { reason: string };
      expect(data.reason).toBe("DOCENCIA");
    });

    it("PRECONDITION_FAILED si el lote no tiene stock suficiente", async () => {
      prisma.establishment.findFirst.mockResolvedValue({ id: u } as never);
      // FEFO: el lote consumido ES el earliest (sin violación).
      prisma.stockLot.findFirst
        .mockResolvedValueOnce({ id: u, lotNumber: "LOT-A", expiryDate: new Date("2027-01-01") } as never)
        .mockResolvedValueOnce({ id: u, quantityOnHand: 1, qualityStatus: "AVAILABLE" } as never);
      const caller = inventoryRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.movement.consumo({
          establishmentId: u,
          itemId: u,
          lotId: u,
          quantity: 5,
          motivoConsumo: "OTRO",
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    // Nota: CONSUMPTION nunca captura cargo por construcción — este archivo
    // (inventory.router.ts) no importa `capturarCargo`, así que no hay ruta
    // de código que pueda invocarlo (ver docs/48 Ola 3 C3-3). No hace falta
    // mockear/espiar el módulo: la garantía es estructural, no un `if`.
  });

  // -------------------------------------------------------------------------
  describe("gs1.listAlertas — join por StockItem.gtin (docs/48 Ola 3, C3-4)", () => {
    const THRESHOLD_ROW = {
      gtin_id: u,
      ubicacion_gln: "7750000000001",
      stock_minimo: 100,
      stock_critico: 20,
      reorder_point: 50,
      dias_caducidad_alerta: 30,
      gtin_codigo: "07501000001234",
      gtin_descripcion: "Amoxicilina 500mg",
      gln_descripcion: "Bodega Central",
    };

    it("matchea StockItem por columna gtin (no por sku) cuando existe", async () => {
      prisma.$queryRaw.mockResolvedValue([THRESHOLD_ROW] as never);
      prisma.stockItem.findMany.mockResolvedValueOnce([{ id: u }] as never);
      prisma.stockLot.findMany.mockResolvedValue([] as never);

      const caller = inventoryRouter.createCaller(makeCtx({ prisma }));
      await caller.gs1.listAlertas({ limit: 100 });

      const where = prisma.stockItem.findMany.mock.calls[0]![0]!.where as { gtin?: string };
      expect(where.gtin).toBe(THRESHOLD_ROW.gtin_codigo);
      // Un solo lookup: el match por gtin fue suficiente, no cae al fallback sku.
      expect(prisma.stockItem.findMany).toHaveBeenCalledTimes(1);
    });

    it("cae a sku (legado) solo si el join por gtin no matchea ningún StockItem", async () => {
      prisma.$queryRaw.mockResolvedValue([THRESHOLD_ROW] as never);
      prisma.stockItem.findMany
        .mockResolvedValueOnce([] as never) // gtin: sin match
        .mockResolvedValueOnce([{ id: u }] as never); // fallback sku: match
      prisma.stockLot.findMany.mockResolvedValue([] as never);

      const caller = inventoryRouter.createCaller(makeCtx({ prisma }));
      await caller.gs1.listAlertas({ limit: 100 });

      expect(prisma.stockItem.findMany).toHaveBeenCalledTimes(2);
      const gtinCall = prisma.stockItem.findMany.mock.calls[0]![0]!.where as { gtin?: string };
      const skuCall = prisma.stockItem.findMany.mock.calls[1]![0]!.where as { sku?: string };
      expect(gtinCall.gtin).toBe(THRESHOLD_ROW.gtin_codigo);
      expect(skuCall.sku).toBe(THRESHOLD_ROW.gtin_codigo);
    });

    it("sin match ni por gtin ni por sku, no genera alertas para ese threshold", async () => {
      prisma.$queryRaw.mockResolvedValue([THRESHOLD_ROW] as never);
      prisma.stockItem.findMany.mockResolvedValue([] as never);

      const caller = inventoryRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.gs1.listAlertas({ limit: 100 });

      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
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
