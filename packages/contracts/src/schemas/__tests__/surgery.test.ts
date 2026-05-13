/**
 * Tests del schema §13 Surgery — Beta.6 hardening layer 1.
 * Cubre WHO checklist inputs, anesthesia schema, state machine enum,
 * OR conflict schema, postpone schema.
 */
import { describe, it, expect } from "vitest";
import {
  surgeryCaseStatusEnum,
  asaClassEnum,
  anesthesiaTypeEnum,
  operatingRoomCreateInput,
  operatingRoomListInput,
  surgeryCaseCreateInput,
  surgeryCaseListInput,
  surgeryCaseSignInInput,
  surgeryCaseTimeOutInput,
  surgeryCaseSignOutInput,
  surgeryCaseStartInput,
  surgeryCasePostOpInput,
  surgeryCaseCompleteInput,
  surgeryCaseCancelInput,
  surgeryCasePostponeInput,
  surgeryCaseAnesthesiaInput,
} from "../surgery";

const u = "00000000-0000-0000-0000-000000000001";
const start = new Date(Date.now() + 86_400_000);
const end = new Date(Date.now() + 86_400_000 + 3 * 3_600_000);

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
describe("surgeryCaseStatusEnum", () => {
  it.each([
    "SCHEDULED",
    "CONFIRMED",
    "IN_PROGRESS",
    "POST_OP",
    "COMPLETED",
    "CANCELLED",
    "POSTPONED",
  ])("status %s válido", (s) =>
    expect(surgeryCaseStatusEnum.safeParse(s).success).toBe(true),
  );

  it("status desconocido inválido", () =>
    expect(surgeryCaseStatusEnum.safeParse("UNKNOWN").success).toBe(false));
});

describe("asaClassEnum", () => {
  it("ASA_III válido", () =>
    expect(asaClassEnum.safeParse("ASA_III").success).toBe(true));
  it("ASA_VII inválido", () =>
    expect(asaClassEnum.safeParse("ASA_VII").success).toBe(false));
});

describe("anesthesiaTypeEnum", () => {
  it.each(["GENERAL", "REGIONAL", "LOCAL", "SEDATION", "NONE"])(
    "tipo %s válido",
    (t) => expect(anesthesiaTypeEnum.safeParse(t).success).toBe(true),
  );
  it("tipo desconocido inválido", () =>
    expect(anesthesiaTypeEnum.safeParse("SPINAL").success).toBe(false));
});

// ---------------------------------------------------------------------------
// OR catalog inputs
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Case create
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Case list
// ---------------------------------------------------------------------------
describe("surgeryCaseListInput", () => {
  it("default limit=50", () => {
    const r = surgeryCaseListInput.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(50);
  });

  it("filtra por POST_OP", () =>
    expect(
      surgeryCaseListInput.safeParse({ status: "POST_OP" }).success,
    ).toBe(true));
});

// ---------------------------------------------------------------------------
// WHO checklist inputs
// ---------------------------------------------------------------------------
describe("WHO checklist inputs", () => {
  it("signIn requiere id UUID válido", () =>
    expect(surgeryCaseSignInInput.safeParse({ id: u }).success).toBe(true));

  it("signIn rechaza id no-UUID", () =>
    expect(surgeryCaseSignInInput.safeParse({ id: "abc" }).success).toBe(false));

  it("timeOut acepta UUID", () =>
    expect(surgeryCaseTimeOutInput.safeParse({ id: u }).success).toBe(true));

  it("signOut acepta UUID", () =>
    expect(surgeryCaseSignOutInput.safeParse({ id: u }).success).toBe(true));

  it("start rechaza id no-UUID", () =>
    expect(surgeryCaseStartInput.safeParse({ id: "abc" }).success).toBe(false));
});

// ---------------------------------------------------------------------------
// postOp / complete / cancel inputs
// ---------------------------------------------------------------------------
describe("surgeryCasePostOpInput / completeInput / cancelInput", () => {
  it("postOp acepta sólo id", () =>
    expect(surgeryCasePostOpInput.safeParse({ id: u }).success).toBe(true));

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

// ---------------------------------------------------------------------------
// Postpone input
// ---------------------------------------------------------------------------
describe("surgeryCasePostponeInput", () => {
  const newStart = new Date(Date.now() + 2 * 86_400_000);
  const newEnd = new Date(Date.now() + 2 * 86_400_000 + 2 * 3_600_000);

  it("acepta input válido", () =>
    expect(
      surgeryCasePostponeInput.safeParse({
        id: u,
        cancelReason: "Conflicto de agenda",
        newScheduledStart: newStart,
        newScheduledEnd: newEnd,
      }).success,
    ).toBe(true));

  it("rechaza sin cancelReason", () =>
    expect(
      surgeryCasePostponeInput.safeParse({
        id: u,
        cancelReason: "",
        newScheduledStart: newStart,
        newScheduledEnd: newEnd,
      }).success,
    ).toBe(false));
});

// ---------------------------------------------------------------------------
// Anesthesia input
// ---------------------------------------------------------------------------
describe("surgeryCaseAnesthesiaInput", () => {
  it("acepta anesthesiaType GENERAL sin end", () =>
    expect(
      surgeryCaseAnesthesiaInput.safeParse({
        id: u,
        anesthesiaType: "GENERAL",
        anesthesiaStartAt: start,
      }).success,
    ).toBe(true));

  it("acepta con anesthesiaEndAt > start", () =>
    expect(
      surgeryCaseAnesthesiaInput.safeParse({
        id: u,
        anesthesiaType: "REGIONAL",
        anesthesiaStartAt: start,
        anesthesiaEndAt: end,
      }).success,
    ).toBe(true));

  it("rechaza anesthesiaEndAt <= anesthesiaStartAt", () =>
    expect(
      surgeryCaseAnesthesiaInput.safeParse({
        id: u,
        anesthesiaType: "LOCAL",
        anesthesiaStartAt: end,
        anesthesiaEndAt: start,
      }).success,
    ).toBe(false));

  it("rechaza tipo desconocido", () =>
    expect(
      surgeryCaseAnesthesiaInput.safeParse({
        id: u,
        anesthesiaType: "EPIDURAL",
        anesthesiaStartAt: start,
      }).success,
    ).toBe(false));
});
