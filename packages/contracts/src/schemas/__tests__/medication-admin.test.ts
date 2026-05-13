/**
 * Tests del schema §16 eMAR.
 * Valida forma del contrato Zod; BCMA scan logic y validación HMR
 * viven en `medication-admin.router.ts`.
 */
import { describe, it, expect } from "vitest";
import {
  medAdminStatusEnum,
  medAdminRouteEnum,
  medicationAdministrationRecordInput,
  medicationAdministrationListInput,
  medicationAdministrationGetInput,
} from "../medication-admin";

const u = "00000000-0000-0000-0000-000000000001";

describe("medAdminStatusEnum", () => {
  it.each([
    "GIVEN",
    "HELD",
    "REFUSED",
    "MISSED",
    "DOCUMENTED_LATE",
  ])("status %s válido", (s) =>
    expect(medAdminStatusEnum.safeParse(s).success).toBe(true),
  );
  it("rechaza desconocido", () =>
    expect(medAdminStatusEnum.safeParse("PENDING").success).toBe(false));
});

describe("medAdminRouteEnum", () => {
  it.each(["ORAL", "IV", "IM", "SC", "INHALED"])("ruta %s válida", (r) =>
    expect(medAdminRouteEnum.safeParse(r).success).toBe(true),
  );
});

describe("medicationAdministrationRecordInput", () => {
  it("acepta input mínimo con default status=GIVEN y wristband=false", () => {
    const r = medicationAdministrationRecordInput.safeParse({
      prescriptionItemId: u,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.status).toBe("GIVEN");
      expect(r.data.patientWristbandScanned).toBe(false);
    }
  });

  it("acepta input completo con doble check", () =>
    expect(
      medicationAdministrationRecordInput.safeParse({
        prescriptionItemId: u,
        status: "GIVEN",
        doseAmount: 500,
        doseUnit: "mg",
        route: "IV",
        site: "brazo izq",
        barcodeScannedAt: new Date(),
        patientWristbandScanned: true,
        doubleCheckById: u,
      }).success,
    ).toBe(true));

  it("rechaza doseAmount negativo", () =>
    expect(
      medicationAdministrationRecordInput.safeParse({
        prescriptionItemId: u,
        doseAmount: -1,
      }).success,
    ).toBe(false));

  it("rechaza UUID inválido en prescriptionItemId", () =>
    expect(
      medicationAdministrationRecordInput.safeParse({
        prescriptionItemId: "not-uuid",
      }).success,
    ).toBe(false));

  it("rechaza route inválida", () =>
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
    expect(medicationAdministrationListInput.safeParse({ limit: 500 }).success).toBe(
      false,
    ));

  it("acepta filtro por status", () =>
    expect(
      medicationAdministrationListInput.safeParse({ status: "REFUSED" }).success,
    ).toBe(true));
});

describe("medicationAdministrationGetInput", () => {
  it("requiere UUID", () => {
    expect(medicationAdministrationGetInput.safeParse({ id: u }).success).toBe(true);
    expect(medicationAdministrationGetInput.safeParse({ id: "x" }).success).toBe(false);
  });
});
