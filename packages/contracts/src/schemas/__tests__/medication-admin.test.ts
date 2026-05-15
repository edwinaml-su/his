/**
 * Tests del schema 16 eMAR -- Beta.8 hardening layer 1.
 * Valida: state machine enum, BCMA fields, secondVerifierId, timing-window inputs.
 */
import { describe, it, expect } from "vitest";
import {
  medAdminStatusEnum,
  medAdminRouteEnum,
  medicationAdministrationRecordInput,
  medicationAdministrationListInput,
  medicationAdministrationGetInput,
  VALID_TRANSITIONS,
  detectAllergyMismatch,
  type AllergyMismatchAllergyInput,
  type AllergyMismatchDrugInput,
} from "../medication-admin";

const u = "00000000-0000-0000-0000-000000000001";
const a1 = "00000000-0000-0000-0000-0000000000a1";
const a2 = "00000000-0000-0000-0000-0000000000a2";
const d1 = "00000000-0000-0000-0000-0000000000d1";

describe("medAdminStatusEnum", () => {
  it.each([
    "SCHEDULED",
    "ADMINISTERED",
    "GIVEN",
    "HELD",
    "REFUSED",
    "MISSED",
    "DOCUMENTED_LATE",
  ])("status %s valido", (s) =>
    expect(medAdminStatusEnum.safeParse(s).success).toBe(true),
  );

  it("rechaza desconocido", () =>
    expect(medAdminStatusEnum.safeParse("PENDING").success).toBe(false));
});

describe("VALID_TRANSITIONS", () => {
  it("SCHEDULED puede ir a ADMINISTERED, REFUSED, MISSED, HELD", () => {
    expect(VALID_TRANSITIONS.SCHEDULED).toEqual(
      expect.arrayContaining(["ADMINISTERED", "REFUSED", "MISSED", "HELD"]),
    );
  });

  it("ADMINISTERED es estado terminal (sin transiciones)", () => {
    expect(VALID_TRANSITIONS.ADMINISTERED).toEqual([]);
  });

  it("HELD puede retornar a SCHEDULED", () => {
    expect(VALID_TRANSITIONS.HELD).toContain("SCHEDULED");
  });
});

describe("medAdminRouteEnum", () => {
  it.each(["ORAL", "IV", "IM", "SC", "INHALED"])("ruta %s valida", (r) =>
    expect(medAdminRouteEnum.safeParse(r).success).toBe(true),
  );
});

describe("medicationAdministrationRecordInput", () => {
  it("acepta input minimo con defaults SCHEDULED y scans=false", () => {
    const r = medicationAdministrationRecordInput.safeParse({
      prescriptionItemId: u,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.status).toBe("SCHEDULED");
      expect(r.data.patientBarcodeScanned).toBe(false);
      expect(r.data.drugBarcodeScanned).toBe(false);
      expect(r.data.providerBadgeScanned).toBe(false);
      expect(r.data.timingWindowMinutes).toBe(30);
    }
  });

  it("acepta BCMA completo con ADMINISTERED", () =>
    expect(
      medicationAdministrationRecordInput.safeParse({
        prescriptionItemId: u,
        status: "ADMINISTERED",
        patientBarcodeScanned: true,
        drugBarcodeScanned: true,
        providerBadgeScanned: true,
        scannedAt: new Date(),
        doseAmount: 500,
        doseUnit: "mg",
        route: "IV",
      }).success,
    ).toBe(true));

  it("acepta secondVerifierId como UUID valido", () =>
    expect(
      medicationAdministrationRecordInput.safeParse({
        prescriptionItemId: u,
        secondVerifierId: u,
      }).success,
    ).toBe(true));

  it("rechaza secondVerifierId con string no-UUID", () =>
    expect(
      medicationAdministrationRecordInput.safeParse({
        prescriptionItemId: u,
        secondVerifierId: "not-uuid",
      }).success,
    ).toBe(false));

  it("acepta scheduledTime como Date", () =>
    expect(
      medicationAdministrationRecordInput.safeParse({
        prescriptionItemId: u,
        scheduledTime: new Date("2026-05-13T08:00:00Z"),
      }).success,
    ).toBe(true));

  it("acepta scheduledTime como string ISO", () =>
    expect(
      medicationAdministrationRecordInput.safeParse({
        prescriptionItemId: u,
        scheduledTime: "2026-05-13T08:00:00Z",
      }).success,
    ).toBe(true));

  it("acepta timingWindowMinutes personalizado", () => {
    const r = medicationAdministrationRecordInput.safeParse({
      prescriptionItemId: u,
      timingWindowMinutes: 60,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.timingWindowMinutes).toBe(60);
  });

  it("rechaza timingWindowMinutes > 240", () =>
    expect(
      medicationAdministrationRecordInput.safeParse({
        prescriptionItemId: u,
        timingWindowMinutes: 300,
      }).success,
    ).toBe(false));

  it("rechaza timingWindowMinutes < 1", () =>
    expect(
      medicationAdministrationRecordInput.safeParse({
        prescriptionItemId: u,
        timingWindowMinutes: 0,
      }).success,
    ).toBe(false));

  it("acepta overrideReason de >= 10 chars", () =>
    expect(
      medicationAdministrationRecordInput.safeParse({
        prescriptionItemId: u,
        overrideReason: "Paciente solicito retraso por nauseas",
      }).success,
    ).toBe(true));

  it("rechaza overrideReason < 10 chars", () =>
    expect(
      medicationAdministrationRecordInput.safeParse({
        prescriptionItemId: u,
        overrideReason: "corto",
      }).success,
    ).toBe(false));

  it("rechaza doseAmount negativo", () =>
    expect(
      medicationAdministrationRecordInput.safeParse({
        prescriptionItemId: u,
        doseAmount: -1,
      }).success,
    ).toBe(false));

  it("rechaza UUID invalido en prescriptionItemId", () =>
    expect(
      medicationAdministrationRecordInput.safeParse({
        prescriptionItemId: "not-uuid",
      }).success,
    ).toBe(false));

  it("rechaza route invalida", () =>
    expect(
      medicationAdministrationRecordInput.safeParse({
        prescriptionItemId: u,
        route: "FAKE",
      }).success,
    ).toBe(false));
});

describe("medicationAdministrationListInput", () => {
  it("aplica default limit=50", () => {
    const r = medicationAdministrationListInput.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(50);
  });

  it("rechaza limit > 200", () =>
    expect(
      medicationAdministrationListInput.safeParse({ limit: 500 }).success,
    ).toBe(false));

  it("acepta filtro por status", () =>
    expect(
      medicationAdministrationListInput.safeParse({ status: "REFUSED" }).success,
    ).toBe(true));

  it("acepta nuevo status SCHEDULED", () =>
    expect(
      medicationAdministrationListInput.safeParse({ status: "SCHEDULED" }).success,
    ).toBe(true));

  it("acepta nuevo status ADMINISTERED", () =>
    expect(
      medicationAdministrationListInput.safeParse({ status: "ADMINISTERED" }).success,
    ).toBe(true));
});

describe("medicationAdministrationGetInput", () => {
  it("requiere UUID", () => {
    expect(medicationAdministrationGetInput.safeParse({ id: u }).success).toBe(true);
    expect(medicationAdministrationGetInput.safeParse({ id: "x" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Beta.15 (US.B15.4.3b) — detectAllergyMismatch
// ---------------------------------------------------------------------------

describe("detectAllergyMismatch", () => {
  const drugPenicilina: AllergyMismatchDrugInput = {
    id: d1,
    atcCode: "J01CA04",
    genericName: "Amoxicilina",
    brandName: null,
  };
  const drugSinAtc: AllergyMismatchDrugInput = {
    id: d1,
    atcCode: null,
    genericName: "Amoxicilina",
    brandName: "Amoxil",
  };

  function makeAllergy(
    overrides: Partial<AllergyMismatchAllergyInput> & { id: string },
  ): AllergyMismatchAllergyInput {
    return {
      substanceText: "amoxicilina",
      allergenAtcCode: null,
      severity: "moderate",
      ...overrides,
    };
  }

  it("retorna [] si no hay alergias", () => {
    expect(detectAllergyMismatch([], drugPenicilina)).toEqual([]);
  });

  it("retorna [] si drug sin atcCode y sin match de nombre", () => {
    const drug: AllergyMismatchDrugInput = {
      id: d1,
      atcCode: null,
      genericName: "Paracetamol",
      brandName: null,
    };
    const allergies = [makeAllergy({ id: a1, substanceText: "amoxicilina" })];
    expect(detectAllergyMismatch(allergies, drug)).toEqual([]);
  });

  it("match por ATC code igual (case-insensitive)", () => {
    const allergies = [
      makeAllergy({
        id: a1,
        substanceText: "amoxi",
        allergenAtcCode: "j01ca04",
        severity: "severe",
      }),
    ];
    const r = detectAllergyMismatch(allergies, drugPenicilina);
    expect(r).toHaveLength(1);
    expect(r[0]).toEqual({ allergyId: a1, severity: "severe", matchedBy: "atc" });
  });

  it("match por nombre case-insensitive — substanceText incluido en genericName", () => {
    const allergies = [
      makeAllergy({ id: a1, substanceText: "AMOXIcilina" }),
    ];
    const r = detectAllergyMismatch(allergies, drugPenicilina);
    expect(r).toHaveLength(1);
    expect(r[0]!.matchedBy).toBe("name");
  });

  it("match por nombre cuando drug tiene sólo brandName (sin atc)", () => {
    const allergies = [makeAllergy({ id: a1, substanceText: "amoxil" })];
    const r = detectAllergyMismatch(allergies, drugSinAtc);
    expect(r).toHaveLength(1);
    expect(r[0]!.matchedBy).toBe("name");
  });

  it("substring corto < 3 chars no dispara match", () => {
    const allergies = [makeAllergy({ id: a1, substanceText: "x" })];
    expect(detectAllergyMismatch(allergies, drugPenicilina)).toEqual([]);
  });

  it("preserva múltiples allergies que matchean (coexisten)", () => {
    const allergies = [
      makeAllergy({ id: a1, substanceText: "amoxicilina", severity: "severe" }),
      makeAllergy({
        id: a2,
        substanceText: "no-match",
        allergenAtcCode: "J01CA04",
        severity: "mild",
      }),
    ];
    const r = detectAllergyMismatch(allergies, drugPenicilina);
    expect(r).toHaveLength(2);
    expect(r.map((h) => h.allergyId).sort()).toEqual([a1, a2].sort());
  });

  it("ignora allergy.severity al decidir match (severity sólo informativa)", () => {
    const allergies = [
      makeAllergy({ id: a1, substanceText: "amoxicilina", severity: "mild" }),
    ];
    const r = detectAllergyMismatch(allergies, drugPenicilina);
    expect(r).toHaveLength(1);
    expect(r[0]!.severity).toBe("mild");
  });

  it("ATC code distinto no matchea aunque comparta prefijo (sin jerarquía)", () => {
    const allergies = [
      makeAllergy({ id: a1, substanceText: "no-match", allergenAtcCode: "J01CA" }),
    ];
    expect(detectAllergyMismatch(allergies, drugPenicilina)).toEqual([]);
  });

  it("substanceText vacío + sin ATC no matchea", () => {
    const allergies = [
      makeAllergy({ id: a1, substanceText: "", allergenAtcCode: null }),
    ];
    expect(detectAllergyMismatch(allergies, drugPenicilina)).toEqual([]);
  });
});
