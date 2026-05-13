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
  detectInteractionAlerts,
  hasBlockingInteraction,
  sortLotsByFEFO,
  validateLotForDispense,
  planFefoDispense,
  isControlledDispensingClass,
  isHighRiskAtc,
  canTransitionPrescription,
  isTerminalPrescriptionStatus,
  type DrugInteractionEntry,
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

// ---------------------------------------------------------------------------
// Beta.2 hardening tests
// ---------------------------------------------------------------------------

describe("Beta.2 — detectInteractionAlerts", () => {
  const dataset: DrugInteractionEntry[] = [
    {
      atcA: "B01AA03",
      atcB: "M01AE01",
      severity: "major",
      description: "Warfarina + Ibuprofeno",
    },
    {
      atcA: "C09AA02",
      atcB: "C09CA01",
      severity: "major",
      description: "IECA + ARA II",
    },
    {
      atcA: "N02BE01",
      atcB: "B01AA03",
      severity: "moderate",
      description: "Paracetamol crónico + Warfarina",
    },
  ];

  it("vacío con menos de 2 drugs", () => {
    expect(detectInteractionAlerts([], dataset)).toEqual([]);
    expect(detectInteractionAlerts([{ atcCode: "B01AA03" }], dataset)).toEqual([]);
  });

  it("detecta interacción (orden A,B)", () => {
    const r = detectInteractionAlerts(
      [{ atcCode: "B01AA03", name: "Warfarina" }, { atcCode: "M01AE01", name: "Ibuprofeno" }],
      dataset,
    );
    expect(r).toHaveLength(1);
    expect(r[0]!.severity).toBe("major");
  });

  it("detecta interacción aunque drugs vengan en orden inverso", () => {
    const r = detectInteractionAlerts(
      [{ atcCode: "M01AE01" }, { atcCode: "B01AA03" }],
      dataset,
    );
    expect(r).toHaveLength(1);
  });

  it("normaliza atcCode a mayúsculas", () => {
    const r = detectInteractionAlerts(
      [{ atcCode: "b01aa03" }, { atcCode: "m01ae01" }],
      dataset,
    );
    expect(r).toHaveLength(1);
  });

  it("ignora atcCode null/empty", () => {
    expect(
      detectInteractionAlerts(
        [{ atcCode: null }, { atcCode: "" }, { atcCode: "X" }],
        dataset,
      ),
    ).toEqual([]);
  });

  it("detecta múltiples pares en una receta", () => {
    const r = detectInteractionAlerts(
      [
        { atcCode: "B01AA03" }, // Warfarina
        { atcCode: "M01AE01" }, // Ibuprofeno → major con warfarina
        { atcCode: "N02BE01" }, // Paracetamol → moderate con warfarina
      ],
      dataset,
    );
    expect(r).toHaveLength(2);
  });
});

describe("Beta.2 — hasBlockingInteraction", () => {
  it("true si alerts incluye major", () =>
    expect(
      hasBlockingInteraction([
        { atcA: "X", atcB: "Y", severity: "major", description: "" },
      ]),
    ).toBe(true));
  it("true si alerts incluye contraindicated", () =>
    expect(
      hasBlockingInteraction([
        { atcA: "X", atcB: "Y", severity: "contraindicated", description: "" },
      ]),
    ).toBe(true));
  it("false si solo minor o moderate", () =>
    expect(
      hasBlockingInteraction([
        { atcA: "X", atcB: "Y", severity: "minor", description: "" },
        { atcA: "A", atcB: "B", severity: "moderate", description: "" },
      ]),
    ).toBe(false));
  it("false con array vacío", () =>
    expect(hasBlockingInteraction([])).toBe(false));
});

describe("Beta.2 — sortLotsByFEFO", () => {
  const today = new Date("2026-05-13T00:00:00Z");
  const future1 = new Date("2026-06-01T00:00:00Z");
  const future2 = new Date("2027-01-15T00:00:00Z");
  const expired = new Date("2025-12-01T00:00:00Z");

  it("ordena ascendente por expiryDate", () => {
    const lots = [
      { lotNumber: "L1", expiryDate: future2, stockQuantity: 10 },
      { lotNumber: "L2", expiryDate: future1, stockQuantity: 5 },
    ];
    const sorted = sortLotsByFEFO(lots, { now: today });
    expect(sorted[0]!.lotNumber).toBe("L2");
    expect(sorted[1]!.lotNumber).toBe("L1");
  });

  it("filtra expirados si filterExpired=true", () => {
    const lots = [
      { lotNumber: "OK", expiryDate: future1, stockQuantity: 5 },
      { lotNumber: "EXP", expiryDate: expired, stockQuantity: 100 },
    ];
    const sorted = sortLotsByFEFO(lots, { now: today, filterExpired: true });
    expect(sorted).toHaveLength(1);
    expect(sorted[0]!.lotNumber).toBe("OK");
  });

  it("lotes sin expiryDate van al final", () => {
    const lots = [
      { lotNumber: "NO_EXP", expiryDate: null, stockQuantity: 1 },
      { lotNumber: "FUT", expiryDate: future1, stockQuantity: 1 },
    ];
    const sorted = sortLotsByFEFO(lots);
    expect(sorted[0]!.lotNumber).toBe("FUT");
    expect(sorted[1]!.lotNumber).toBe("NO_EXP");
  });
});

describe("Beta.2 — validateLotForDispense", () => {
  const today = new Date("2026-05-13T00:00:00Z");
  const future = new Date("2027-01-01T00:00:00Z");
  const expired = new Date("2025-12-01T00:00:00Z");

  it("ok con lote válido", () => {
    const r = validateLotForDispense(
      { lotNumber: "L1", expiryDate: future, stockQuantity: 100 },
      10,
      today,
    );
    expect(r.ok).toBe(true);
  });

  it("rechaza si no hay expiryDate", () => {
    const r = validateLotForDispense(
      { lotNumber: "L1", expiryDate: null, stockQuantity: 10 },
      1,
      today,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("sin fecha de expiración");
  });

  it("rechaza lote expirado", () => {
    const r = validateLotForDispense(
      { lotNumber: "EXP", expiryDate: expired, stockQuantity: 100 },
      1,
      today,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("expirado");
  });

  it("rechaza quantity 0 o negativa", () => {
    const r1 = validateLotForDispense(
      { lotNumber: "L", expiryDate: future, stockQuantity: 100 },
      0,
      today,
    );
    expect(r1.ok).toBe(false);
    const r2 = validateLotForDispense(
      { lotNumber: "L", expiryDate: future, stockQuantity: 100 },
      -5,
      today,
    );
    expect(r2.ok).toBe(false);
  });

  it("rechaza si stock insuficiente", () => {
    const r = validateLotForDispense(
      { lotNumber: "L", expiryDate: future, stockQuantity: 5 },
      10,
      today,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("Stock insuficiente");
  });
});

describe("Beta.2 — planFefoDispense", () => {
  const today = new Date("2026-05-13T00:00:00Z");
  const future1 = new Date("2026-06-01T00:00:00Z");
  const future2 = new Date("2027-01-15T00:00:00Z");

  it("planea desde lote más próximo a vencer primero", () => {
    const lots = [
      { lotNumber: "L_LATE", expiryDate: future2, stockQuantity: 100 },
      { lotNumber: "L_EARLY", expiryDate: future1, stockQuantity: 20 },
    ];
    const r = planFefoDispense(lots, 30, today);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan).toHaveLength(2);
      expect(r.plan[0]!.lot.lotNumber).toBe("L_EARLY");
      expect(r.plan[0]!.takeQuantity).toBe(20);
      expect(r.plan[1]!.lot.lotNumber).toBe("L_LATE");
      expect(r.plan[1]!.takeQuantity).toBe(10);
    }
  });

  it("retorna ok=false si totalAvailable < requested", () => {
    const lots = [
      { lotNumber: "L", expiryDate: future1, stockQuantity: 5 },
    ];
    const r = planFefoDispense(lots, 10, today);
    expect(r.ok).toBe(false);
    expect(r.totalAvailable).toBe(5);
  });

  it("usa solo 1 lote si cubre la cantidad", () => {
    const lots = [
      { lotNumber: "L", expiryDate: future1, stockQuantity: 100 },
    ];
    const r = planFefoDispense(lots, 30, today);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan).toHaveLength(1);
      expect(r.plan[0]!.takeQuantity).toBe(30);
    }
  });
});

describe("Beta.2 — isControlledDispensingClass", () => {
  it("RX_CONTROLLED = true", () =>
    expect(isControlledDispensingClass("RX_CONTROLLED")).toBe(true));
  it("RX = false", () => expect(isControlledDispensingClass("RX")).toBe(false));
  it("OTC = false", () => expect(isControlledDispensingClass("OTC")).toBe(false));
});

describe("Beta.2 — isHighRiskAtc", () => {
  it("Insulina A10AB05 → true", () =>
    expect(isHighRiskAtc("A10AB05")).toBe(true));
  it("Warfarina B01AA03 → true", () =>
    expect(isHighRiskAtc("B01AA03")).toBe(true));
  it("Morfina N02AA01 → true", () =>
    expect(isHighRiskAtc("N02AA01")).toBe(true));
  it("Amiodarona C01BD01 → true", () =>
    expect(isHighRiskAtc("C01BD01")).toBe(true));
  it("Paracetamol N02BE01 → false", () =>
    expect(isHighRiskAtc("N02BE01")).toBe(false));
  it("Amoxicilina J01CA04 → false", () =>
    expect(isHighRiskAtc("J01CA04")).toBe(false));
  it("null o undefined → false", () => {
    expect(isHighRiskAtc(null)).toBe(false);
    expect(isHighRiskAtc(undefined)).toBe(false);
  });
});

describe("Beta.2 — canTransitionPrescription", () => {
  it("DRAFT → SIGNED true", () =>
    expect(canTransitionPrescription("DRAFT", "SIGNED")).toBe(true));
  it("DRAFT → CANCELLED true", () =>
    expect(canTransitionPrescription("DRAFT", "CANCELLED")).toBe(true));
  it("DRAFT → DISPENSED NO permitido (debe pasar por SIGNED)", () =>
    expect(canTransitionPrescription("DRAFT", "DISPENSED")).toBe(false));
  it("SIGNED → DISPENSED true", () =>
    expect(canTransitionPrescription("SIGNED", "DISPENSED")).toBe(true));
  it("SIGNED → PARTIALLY_DISPENSED true", () =>
    expect(canTransitionPrescription("SIGNED", "PARTIALLY_DISPENSED")).toBe(true));
  it("DISPENSED es terminal", () => {
    expect(canTransitionPrescription("DISPENSED", "SIGNED")).toBe(false);
    expect(canTransitionPrescription("DISPENSED", "CANCELLED")).toBe(false);
  });
  it("isTerminalPrescriptionStatus reconoce DISPENSED, CANCELLED, EXPIRED", () => {
    expect(isTerminalPrescriptionStatus("DISPENSED")).toBe(true);
    expect(isTerminalPrescriptionStatus("CANCELLED")).toBe(true);
    expect(isTerminalPrescriptionStatus("EXPIRED")).toBe(true);
    expect(isTerminalPrescriptionStatus("DRAFT")).toBe(false);
    expect(isTerminalPrescriptionStatus("SIGNED")).toBe(false);
  });
});
