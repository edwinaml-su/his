/**
 * Tests del schema §20 Services & Equipment (Wave 8).
 */
import { describe, it, expect } from "vitest";
import {
  equipmentStatusEnum,
  pmScheduleStatusEnum,
  calibrationResultEnum,
  equipmentCreateInput,
  equipmentListInput,
  equipmentSetStatusInput,
  pmScheduleCreateInput,
  pmScheduleListInput,
  pmScheduleCompleteInput,
  pmScheduleCancelInput,
  calibrationLogCreateInput,
  calibrationLogListInput,
} from "../services-equipment";

const u = "00000000-0000-0000-0000-000000000001";
const past = new Date("2026-01-01");
const future = new Date("2027-01-01");

describe("enums", () => {
  it.each(["OPERATIONAL", "UNDER_MAINTENANCE", "OUT_OF_SERVICE", "RETIRED"])(
    "equipment status %s válido",
    (s) => expect(equipmentStatusEnum.safeParse(s).success).toBe(true),
  );

  it.each(["PLANNED", "COMPLETED", "OVERDUE", "CANCELLED"])(
    "PM status %s válido",
    (s) => expect(pmScheduleStatusEnum.safeParse(s).success).toBe(true),
  );

  it.each(["PASS", "FAIL", "CONDITIONAL"])("calibration result %s válido", (r) =>
    expect(calibrationResultEnum.safeParse(r).success).toBe(true),
  );

  it("calibration result XYZ inválido", () =>
    expect(calibrationResultEnum.safeParse("XYZ").success).toBe(false));
});

describe("equipmentCreateInput", () => {
  it("acepta input mínimo", () =>
    expect(
      equipmentCreateInput.safeParse({
        establishmentId: u,
        assetTag: "AT-001",
        name: "Monitor de signos vitales",
      }).success,
    ).toBe(true));

  it("rechaza assetTag vacío", () =>
    expect(
      equipmentCreateInput.safeParse({
        establishmentId: u,
        assetTag: "",
        name: "X",
      }).success,
    ).toBe(false));

  it("rechaza UUID inválido", () =>
    expect(
      equipmentCreateInput.safeParse({
        establishmentId: "no-uuid",
        assetTag: "AT",
        name: "X",
      }).success,
    ).toBe(false));

  it("acepta campos extendidos", () =>
    expect(
      equipmentCreateInput.safeParse({
        establishmentId: u,
        assetTag: "AT-002",
        name: "Ventilador",
        manufacturer: "Hamilton",
        model: "G5",
        serialNumber: "SN-12345",
        category: "VENTILADOR",
        location: "UCI sala 3",
        installDate: past,
      }).success,
    ).toBe(true));
});

describe("equipmentListInput / setStatusInput", () => {
  it("activeOnly default true, limit default 50", () => {
    const r = equipmentListInput.safeParse({});
    if (r.success) {
      expect(r.data.activeOnly).toBe(true);
      expect(r.data.limit).toBe(50);
    }
  });

  it("setStatus requiere uuid + status", () => {
    expect(
      equipmentSetStatusInput.safeParse({ id: u, status: "UNDER_MAINTENANCE" }).success,
    ).toBe(true);
    expect(equipmentSetStatusInput.safeParse({ id: u, status: "X" }).success).toBe(false);
  });
});

describe("pmScheduleCreateInput / complete / cancel", () => {
  it("acepta input válido", () =>
    expect(
      pmScheduleCreateInput.safeParse({
        equipmentId: u,
        scheduledAt: future,
        taskNotes: "PM trimestral",
      }).success,
    ).toBe(true));

  it("complete acepta sólo id", () =>
    expect(pmScheduleCompleteInput.safeParse({ id: u }).success).toBe(true));

  it("cancel rechaza id no-UUID", () =>
    expect(pmScheduleCancelInput.safeParse({ id: "abc" }).success).toBe(false));

  it("list filtra por status", () =>
    expect(pmScheduleListInput.safeParse({ status: "PLANNED" }).success).toBe(true));
});

describe("calibrationLogCreateInput", () => {
  it("acepta input válido", () =>
    expect(
      calibrationLogCreateInput.safeParse({
        equipmentId: u,
        calibratedAt: past,
        result: "PASS",
        nextDueAt: future,
      }).success,
    ).toBe(true));

  it("rechaza nextDueAt anterior a calibratedAt", () =>
    expect(
      calibrationLogCreateInput.safeParse({
        equipmentId: u,
        calibratedAt: future,
        result: "PASS",
        nextDueAt: past,
      }).success,
    ).toBe(false));

  it("acepta sin nextDueAt", () =>
    expect(
      calibrationLogCreateInput.safeParse({
        equipmentId: u,
        calibratedAt: past,
        result: "FAIL",
      }).success,
    ).toBe(true));

  it("list default limit=50", () => {
    const r = calibrationLogListInput.safeParse({});
    if (r.success) expect(r.data.limit).toBe(50);
  });
});
