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
} from "../medication-admin";

const u = "00000000-0000-0000-0000-000000000001";

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
