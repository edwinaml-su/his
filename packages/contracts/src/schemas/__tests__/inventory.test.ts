/**
 * Tests del schema §19 Inventory (Beta.10 hardening layer 1).
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
  stockTransferInput,
  expiringLotsInput,
  configurarThresholdInput,
  listAlertasInput,
  alertaTipoEnum,
} from "../inventory";

const u = "00000000-0000-0000-0000-000000000001";
const u2 = "00000000-0000-0000-0000-000000000002";

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

describe("expiringLotsInput", () => {
  it("daysAhead defaults to 30", () => {
    const r = expiringLotsInput.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.daysAhead).toBe(30);
      expect(r.data.limit).toBe(50);
    }
  });

  it("acepta daysAhead personalizado y filtros opcionales", () =>
    expect(
      expiringLotsInput.safeParse({
        daysAhead: 7,
        establishmentId: u,
        itemId: u,
        limit: 20,
      }).success,
    ).toBe(true));

  it("rechaza daysAhead = 0", () =>
    expect(expiringLotsInput.safeParse({ daysAhead: 0 }).success).toBe(false));

  it("rechaza daysAhead > 365", () =>
    expect(expiringLotsInput.safeParse({ daysAhead: 366 }).success).toBe(false));
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

  it("acepta transferGroupId UUID opcional", () =>
    expect(
      stockMovementCreateInput.safeParse({
        establishmentId: u,
        itemId: u,
        type: "IN",
        quantity: 5,
        transferGroupId: u,
      }).success,
    ).toBe(true));
});

describe("stockTransferInput", () => {
  const base = {
    srcEstablishmentId: u,
    dstEstablishmentId: u2,
    itemId: u,
    srcLotId: u,
    quantity: 10,
    referenceCode: "TRF-001",
  };

  it("acepta transfer válido", () =>
    expect(stockTransferInput.safeParse(base).success).toBe(true));

  it("rechaza cuando src === dst", () =>
    expect(
      stockTransferInput.safeParse({ ...base, dstEstablishmentId: u }).success,
    ).toBe(false));

  it("rechaza quantity 0", () =>
    expect(
      stockTransferInput.safeParse({ ...base, quantity: 0 }).success,
    ).toBe(false));

  it("rechaza sin referenceCode", () =>
    expect(
      stockTransferInput.safeParse({ ...base, referenceCode: undefined }).success,
    ).toBe(false));

  it("acepta dstLotId opcional", () =>
    expect(
      stockTransferInput.safeParse({ ...base, dstLotId: u2 }).success,
    ).toBe(true));
});

describe("stockMovementListInput", () => {
  it("default limit=100, limit > 500 inválido", () => {
    const r = stockMovementListInput.safeParse({});
    if (r.success) expect(r.data.limit).toBe(100);
    expect(stockMovementListInput.safeParse({ limit: 1000 }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GS1 Threshold schemas (SQL 83)
// ---------------------------------------------------------------------------

describe("alertaTipoEnum", () => {
  it.each(["stock_bajo", "stock_critico", "proximo_vencer", "vencido"])(
    "tipo %s válido",
    (t) => expect(alertaTipoEnum.safeParse(t).success).toBe(true),
  );
  it("tipo desconocido inválido", () =>
    expect(alertaTipoEnum.safeParse("sin_stock").success).toBe(false));
});

describe("configurarThresholdInput", () => {
  const base = {
    gtinId: u,
    ubicacionGln: "7799999001234",
    stockMinimo: 100,
    stockCritico: 20,
    reorderPoint: 50,
    diasCaducidadAlerta: 30,
  };

  it("acepta threshold válido completo", () =>
    expect(configurarThresholdInput.safeParse(base).success).toBe(true));

  it("diasCaducidadAlerta default 30 cuando se omite", () => {
    const { diasCaducidadAlerta: _, ...sinDias } = base;
    const r = configurarThresholdInput.safeParse(sinDias);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.diasCaducidadAlerta).toBe(30);
  });

  it("rechaza stockCritico > stockMinimo", () =>
    expect(
      configurarThresholdInput.safeParse({ ...base, stockCritico: 150 }).success,
    ).toBe(false));

  it("rechaza stockMinimo negativo", () =>
    expect(
      configurarThresholdInput.safeParse({ ...base, stockMinimo: -1 }).success,
    ).toBe(false));

  it("rechaza diasCaducidadAlerta = 0", () =>
    expect(
      configurarThresholdInput.safeParse({ ...base, diasCaducidadAlerta: 0 }).success,
    ).toBe(false));

  it("rechaza diasCaducidadAlerta > 365", () =>
    expect(
      configurarThresholdInput.safeParse({ ...base, diasCaducidadAlerta: 366 }).success,
    ).toBe(false));

  it("acepta stockCritico = stockMinimo (límite exacto válido)", () =>
    expect(
      configurarThresholdInput.safeParse({ ...base, stockCritico: 100, stockMinimo: 100 }).success,
    ).toBe(true));

  it("rechaza gtinId con formato inválido (no UUID)", () =>
    expect(
      configurarThresholdInput.safeParse({ ...base, gtinId: "not-a-uuid" }).success,
    ).toBe(false));
});

describe("listAlertasInput", () => {
  it("default limit=100 sin filtros", () => {
    const r = listAlertasInput.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(100);
  });

  it("acepta filtro por tipos de alerta", () =>
    expect(
      listAlertasInput.safeParse({ tipos: ["stock_critico", "vencido"] }).success,
    ).toBe(true));

  it("rechaza tipo de alerta desconocido en array", () =>
    expect(
      listAlertasInput.safeParse({ tipos: ["stock_critico", "inexistente"] }).success,
    ).toBe(false));

  it("acepta filtro por gtinId UUID", () =>
    expect(listAlertasInput.safeParse({ gtinId: u }).success).toBe(true));

  it("acepta filtro combinado gtinId + ubicacionGln", () =>
    expect(
      listAlertasInput.safeParse({ gtinId: u, ubicacionGln: "7799999001234" }).success,
    ).toBe(true));
});
