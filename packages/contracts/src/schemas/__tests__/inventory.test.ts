/**
 * Tests del schema §19 Inventory (Wave 8 / Phase 2 entry).
 */
import { describe, it, expect } from "vitest";
import {
  stockMovementTypeEnum,
  stockItemCreateInput,
  stockItemListInput,
  stockLotCreateInput,
  stockLotListInput,
  stockMovementCreateInput,
  stockMovementListInput,
} from "../inventory";

const u = "00000000-0000-0000-0000-000000000001";

describe("stockMovementTypeEnum", () => {
  it.each(["IN", "OUT", "TRANSFER", "ADJUST"])("type %s válido", (t) =>
    expect(stockMovementTypeEnum.safeParse(t).success).toBe(true),
  );
  it("type FOO inválido", () =>
    expect(stockMovementTypeEnum.safeParse("FOO").success).toBe(false));
});

describe("stockItemCreateInput", () => {
  it("acepta input mínimo", () =>
    expect(
      stockItemCreateInput.safeParse({
        sku: "ACET-500",
        name: "Acetaminofén 500mg",
        unitOfMeasure: "TAB",
      }).success,
    ).toBe(true));

  it("acepta organizationId null", () =>
    expect(
      stockItemCreateInput.safeParse({
        organizationId: null,
        sku: "X",
        name: "X",
        unitOfMeasure: "UN",
      }).success,
    ).toBe(true));

  it("rechaza sku vacío", () =>
    expect(
      stockItemCreateInput.safeParse({ sku: "", name: "X", unitOfMeasure: "UN" }).success,
    ).toBe(false));

  it("rechaza unitOfMeasure vacío", () =>
    expect(
      stockItemCreateInput.safeParse({ sku: "X", name: "X", unitOfMeasure: "" }).success,
    ).toBe(false));

  it("trackLots default true", () => {
    const r = stockItemCreateInput.safeParse({
      sku: "X",
      name: "X",
      unitOfMeasure: "UN",
    });
    if (r.success) expect(r.data.trackLots).toBe(true);
  });

  it("rechaza reorderLevel negativo", () =>
    expect(
      stockItemCreateInput.safeParse({
        sku: "X",
        name: "X",
        unitOfMeasure: "UN",
        reorderLevel: -1,
      }).success,
    ).toBe(false));
});

describe("stockItemListInput", () => {
  it("activeOnly default true, limit default 50", () => {
    const r = stockItemListInput.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.activeOnly).toBe(true);
      expect(r.data.limit).toBe(50);
    }
  });

  it("limit > 200 inválido", () =>
    expect(stockItemListInput.safeParse({ limit: 999 }).success).toBe(false));
});

describe("stockLotCreateInput", () => {
  it("acepta lote sin expiry (item sin trackLots o perpetuo)", () =>
    expect(
      stockLotCreateInput.safeParse({
        establishmentId: u,
        itemId: u,
        lotNumber: "LOT-2026-01",
        quantityOnHand: 100,
      }).success,
    ).toBe(true));

  it("acepta lote con expiry", () =>
    expect(
      stockLotCreateInput.safeParse({
        establishmentId: u,
        itemId: u,
        lotNumber: "LOT-2027-A",
        expiryDate: new Date("2027-12-31"),
        quantityOnHand: 50,
        costPerUnit: 1.25,
      }).success,
    ).toBe(true));

  it("rechaza quantity negativa", () =>
    expect(
      stockLotCreateInput.safeParse({
        establishmentId: u,
        itemId: u,
        lotNumber: "L",
        quantityOnHand: -1,
      }).success,
    ).toBe(false));

  it("rechaza lotNumber vacío", () =>
    expect(
      stockLotCreateInput.safeParse({
        establishmentId: u,
        itemId: u,
        lotNumber: "",
      }).success,
    ).toBe(false));
});

describe("stockLotListInput", () => {
  it("default limit=50, activeOnly=true", () => {
    const r = stockLotListInput.safeParse({});
    if (r.success) {
      expect(r.data.limit).toBe(50);
      expect(r.data.activeOnly).toBe(true);
    }
  });

  it("acepta expiringBefore", () =>
    expect(
      stockLotListInput.safeParse({ expiringBefore: new Date("2026-12-31") }).success,
    ).toBe(true));
});

describe("stockMovementCreateInput", () => {
  it("acepta IN sin reference", () =>
    expect(
      stockMovementCreateInput.safeParse({
        establishmentId: u,
        itemId: u,
        type: "IN",
        quantity: 10,
      }).success,
    ).toBe(true));

  it("rechaza quantity 0", () =>
    expect(
      stockMovementCreateInput.safeParse({
        establishmentId: u,
        itemId: u,
        type: "OUT",
        quantity: 0,
      }).success,
    ).toBe(false));

  it("rechaza quantity negativa", () =>
    expect(
      stockMovementCreateInput.safeParse({
        establishmentId: u,
        itemId: u,
        type: "OUT",
        quantity: -5,
      }).success,
    ).toBe(false));

  it("TRANSFER sin referenceCode falla", () =>
    expect(
      stockMovementCreateInput.safeParse({
        establishmentId: u,
        itemId: u,
        type: "TRANSFER",
        quantity: 5,
      }).success,
    ).toBe(false));

  it("TRANSFER con referenceCode OK", () =>
    expect(
      stockMovementCreateInput.safeParse({
        establishmentId: u,
        itemId: u,
        type: "TRANSFER",
        quantity: 5,
        referenceCode: "EST-DEST-001",
      }).success,
    ).toBe(true));

  it("ADJUST acepta lotId opcional", () =>
    expect(
      stockMovementCreateInput.safeParse({
        establishmentId: u,
        itemId: u,
        lotId: u,
        type: "ADJUST",
        quantity: 2,
        reason: "Conteo físico",
      }).success,
    ).toBe(true));
});

describe("stockMovementListInput", () => {
  it("default limit=100, limit > 500 inválido", () => {
    const r = stockMovementListInput.safeParse({});
    if (r.success) expect(r.data.limit).toBe(100);
    expect(stockMovementListInput.safeParse({ limit: 1000 }).success).toBe(false);
  });
});
