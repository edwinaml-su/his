/**
 * Tests del schema §13 Surgery.
 * Valida forma del contrato Zod; detección de solape de OR y time-out
 * workflow viven en `surgery.router.ts`.
 */
import { describe, it, expect } from "vitest";
import {
  surgeryCaseStatusEnum,
  asaClassEnum,
  operatingRoomCreateInput,
  operatingRoomListInput,
  surgeryCaseCreateInput,
  surgeryCaseListInput,
  surgeryCaseTimeOutInput,
  surgeryCaseStartInput,
  surgeryCaseCompleteInput,
  surgeryCaseCancelInput,
} from "../surgery";

const u = "00000000-0000-0000-0000-000000000001";
const start = new Date(Date.now() + 86_400_000);
const end = new Date(Date.now() + 86_400_000 + 3 * 3600_000);

describe("surgeryCaseStatusEnum / asaClassEnum", () => {
  it.each([
    "SCHEDULED",
    "CONFIRMED",
    "IN_PROGRESS",
    "COMPLETED",
    "CANCELLED",
    "POSTPONED",
  ])("status %s válido", (s) =>
    expect(surgeryCaseStatusEnum.safeParse(s).success).toBe(true),
  );

  it("ASA_III válido", () =>
    expect(asaClassEnum.safeParse("ASA_III").success).toBe(true));
  it("ASA_VII inválido", () =>
    expect(asaClassEnum.safeParse("ASA_VII").success).toBe(false));
});

describe("operatingRoomCreateInput / listInput", () => {
  it("acepta input válido", () =>
    expect(
      operatingRoomCreateInput.safeParse({
        establishmentId: u,
        code: "OR-01",
        name: "Quirófano 1",
      }).success,
    ).toBe(true));

  it("rechaza code vacío", () =>
    expect(
      operatingRoomCreateInput.safeParse({
        establishmentId: u,
        code: "",
        name: "x",
      }).success,
    ).toBe(false));

  it("list aplica default activeOnly=true", () => {
    const r = operatingRoomListInput.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.activeOnly).toBe(true);
  });
});

describe("surgeryCaseCreateInput", () => {
  it("acepta caso programado válido", () =>
    expect(
      surgeryCaseCreateInput.safeParse({
        encounterId: u,
        establishmentId: u,
        patientId: u,
        primarySurgeonId: u,
        procedureDescription: "Apendicectomía laparoscópica",
        scheduledStart: start,
        scheduledEnd: end,
        asaClass: "ASA_II",
      }).success,
    ).toBe(true));

  it("rechaza scheduledEnd <= scheduledStart", () =>
    expect(
      surgeryCaseCreateInput.safeParse({
        encounterId: u,
        establishmentId: u,
        patientId: u,
        primarySurgeonId: u,
        procedureDescription: "x",
        scheduledStart: end,
        scheduledEnd: start,
      }).success,
    ).toBe(false));

  it("rechaza procedureDescription vacío", () =>
    expect(
      surgeryCaseCreateInput.safeParse({
        encounterId: u,
        establishmentId: u,
        patientId: u,
        primarySurgeonId: u,
        procedureDescription: "",
        scheduledStart: start,
        scheduledEnd: end,
      }).success,
    ).toBe(false));
});

describe("surgeryCaseListInput", () => {
  it("default limit=50", () => {
    const r = surgeryCaseListInput.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(50);
  });
});

describe("surgeryCase time-out / start / complete / cancel", () => {
  it("timeOut requiere id UUID", () =>
    expect(surgeryCaseTimeOutInput.safeParse({ id: u }).success).toBe(true));

  it("start rechaza id no-UUID", () =>
    expect(surgeryCaseStartInput.safeParse({ id: "abc" }).success).toBe(false));

  it("complete acepta sólo id (notas opcionales)", () =>
    expect(surgeryCaseCompleteInput.safeParse({ id: u }).success).toBe(true));

  it("cancel requiere reason no vacío", () =>
    expect(
      surgeryCaseCancelInput.safeParse({ id: u, cancelReason: "" }).success,
    ).toBe(false));

  it("cancel acepta razón válida", () =>
    expect(
      surgeryCaseCancelInput.safeParse({
        id: u,
        cancelReason: "Paciente no en ayuno",
      }).success,
    ).toBe(true));
});
