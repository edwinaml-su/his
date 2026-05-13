/**
 * Tests del schema §15 Pharmacy.
 */
import { describe, it, expect } from "vitest";
import {
  pharmaceuticalFormEnum,
  dispensingClassEnum,
  adminRouteEnum,
  drugListInput,
  drugCreateInput,
  prescriptionItemInput,
  prescriptionCreateInput,
  prescriptionSignInput,
  prescriptionListInput,
  dispenseCreateInput,
} from "../pharmacy";

const u = "00000000-0000-0000-0000-000000000001";

describe("enums pharmacy", () => {
  it("pharmaceuticalForm acepta TABLET", () =>
    expect(pharmaceuticalFormEnum.safeParse("TABLET").success).toBe(true));
  it("pharmaceuticalForm rechaza GEL", () =>
    expect(pharmaceuticalFormEnum.safeParse("GEL").success).toBe(false));
  it("dispensingClass acepta RX_CONTROLLED", () =>
    expect(dispensingClassEnum.safeParse("RX_CONTROLLED").success).toBe(true));
  it("adminRoute acepta INHALED", () =>
    expect(adminRouteEnum.safeParse("INHALED").success).toBe(true));
});

describe("drugListInput", () => {
  it("default activeOnly=true, limit=50", () => {
    const r = drugListInput.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.activeOnly).toBe(true);
      expect(r.data.limit).toBe(50);
    }
  });

  it("rechaza limit > 200", () =>
    expect(drugListInput.safeParse({ limit: 201 }).success).toBe(false));
});

describe("drugCreateInput", () => {
  it("acepta input válido sin organizationId", () => {
    const r = drugCreateInput.safeParse({
      genericName: "Amoxicilina",
      pharmaceuticalForm: "TABLET",
      strengthValue: 500,
      strengthUnit: "mg",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.dispensingClass).toBe("RX");
      expect(r.data.organizationId).toBeNull();
    }
  });

  it("rechaza strengthValue negativo", () =>
    expect(
      drugCreateInput.safeParse({
        genericName: "X",
        pharmaceuticalForm: "TABLET",
        strengthValue: -1,
        strengthUnit: "mg",
      }).success,
    ).toBe(false));

  it("rechaza genericName vacío", () =>
    expect(
      drugCreateInput.safeParse({
        genericName: "",
        pharmaceuticalForm: "TABLET",
        strengthValue: 500,
        strengthUnit: "mg",
      }).success,
    ).toBe(false));
});

describe("prescriptionItemInput", () => {
  it("acepta ítem mínimo", () => {
    expect(
      prescriptionItemInput.safeParse({
        drugId: u,
        dosage: "1 tab",
        route: "ORAL",
        frequency: "c/8h",
      }).success,
    ).toBe(true);
  });

  it("rechaza durationDays > 365", () =>
    expect(
      prescriptionItemInput.safeParse({
        drugId: u,
        dosage: "1 tab",
        route: "ORAL",
        frequency: "c/8h",
        durationDays: 366,
      }).success,
    ).toBe(false));
});

describe("prescriptionCreateInput", () => {
  it("acepta receta con 1 ítem", () => {
    expect(
      prescriptionCreateInput.safeParse({
        encounterId: u,
        patientId: u,
        items: [
          { drugId: u, dosage: "1 tab", route: "ORAL", frequency: "c/8h" },
        ],
      }).success,
    ).toBe(true);
  });

  it("rechaza receta sin ítems", () =>
    expect(
      prescriptionCreateInput.safeParse({
        encounterId: u,
        patientId: u,
        items: [],
      }).success,
    ).toBe(false));

  it("rechaza > 50 ítems", () => {
    const items = Array.from({ length: 51 }, () => ({
      drugId: u,
      dosage: "1 tab",
      route: "ORAL" as const,
      frequency: "c/8h",
    }));
    expect(
      prescriptionCreateInput.safeParse({
        encounterId: u,
        patientId: u,
        items,
      }).success,
    ).toBe(false);
  });
});

describe("prescriptionSignInput", () => {
  it("acepta UUID", () =>
    expect(prescriptionSignInput.safeParse({ id: u }).success).toBe(true));
  it("rechaza no-UUID", () =>
    expect(prescriptionSignInput.safeParse({ id: "x" }).success).toBe(false));
});

describe("prescriptionListInput", () => {
  it("default limit=50", () => {
    const r = prescriptionListInput.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(50);
  });
});

describe("dispenseCreateInput", () => {
  it("acepta dispensación válida", () => {
    expect(
      dispenseCreateInput.safeParse({
        prescriptionItemId: u,
        quantity: 10,
        batchNumber: "LOT-2026-A",
      }).success,
    ).toBe(true);
  });

  it("rechaza quantity 0", () =>
    expect(
      dispenseCreateInput.safeParse({
        prescriptionItemId: u,
        quantity: 0,
      }).success,
    ).toBe(false));
});
