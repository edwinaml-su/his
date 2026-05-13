/**
 * Tests del schema §11 Inpatient.
 * Valida forma del contrato Zod; las reglas de transición de estado
 * viven en `inpatient.router.ts`.
 */
import { describe, it, expect } from "vitest";
import {
  inpatientStatusEnum,
  carePlanStatusEnum,
  kardexCategoryEnum,
  kardexShiftEnum,
  inpatientAdmissionCreateInput,
  inpatientAdmissionListInput,
  inpatientAdmissionDischargeInput,
  inpatientVitalsRecordInput,
  inpatientKardexCreateInput,
  inpatientCarePlanCreateInput,
  inpatientCarePlanUpdateStatusInput,
} from "../inpatient";

const u = "00000000-0000-0000-0000-000000000001";

describe("inpatientStatusEnum", () => {
  it.each(["ACTIVE", "ON_LEAVE", "DISCHARGED", "TRANSFERRED_OUT"])(
    "acepta estado %s",
    (s) => expect(inpatientStatusEnum.safeParse(s).success).toBe(true),
  );
  it("rechaza estado desconocido", () =>
    expect(inpatientStatusEnum.safeParse("DEAD").success).toBe(false));
});

describe("carePlanStatusEnum / kardexCategoryEnum / kardexShiftEnum", () => {
  it("carePlanStatusEnum acepta DRAFT", () =>
    expect(carePlanStatusEnum.safeParse("DRAFT").success).toBe(true));
  it("kardexCategoryEnum acepta DIET", () =>
    expect(kardexCategoryEnum.safeParse("DIET").success).toBe(true));
  it("kardexShiftEnum acepta MORNING", () =>
    expect(kardexShiftEnum.safeParse("MORNING").success).toBe(true));
});

describe("inpatientAdmissionCreateInput", () => {
  it("acepta input mínimo válido", () => {
    expect(
      inpatientAdmissionCreateInput.safeParse({
        encounterId: u,
        establishmentId: u,
        patientId: u,
        attendingId: u,
        reason: "ICC descompensada",
      }).success,
    ).toBe(true);
  });

  it("rechaza reason vacío", () => {
    expect(
      inpatientAdmissionCreateInput.safeParse({
        encounterId: u,
        establishmentId: u,
        patientId: u,
        attendingId: u,
        reason: "",
      }).success,
    ).toBe(false);
  });

  it("rechaza expectedLos fuera de rango", () => {
    expect(
      inpatientAdmissionCreateInput.safeParse({
        encounterId: u,
        establishmentId: u,
        patientId: u,
        attendingId: u,
        reason: "X",
        expectedLos: 0,
      }).success,
    ).toBe(false);
    expect(
      inpatientAdmissionCreateInput.safeParse({
        encounterId: u,
        establishmentId: u,
        patientId: u,
        attendingId: u,
        reason: "X",
        expectedLos: 400,
      }).success,
    ).toBe(false);
  });

  it("rechaza UUID inválido en attendingId", () => {
    expect(
      inpatientAdmissionCreateInput.safeParse({
        encounterId: u,
        establishmentId: u,
        patientId: u,
        attendingId: "not-uuid",
        reason: "X",
      }).success,
    ).toBe(false);
  });
});

describe("inpatientAdmissionListInput", () => {
  it("aplica default limit=50", () => {
    const r = inpatientAdmissionListInput.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(50);
  });
  it("rechaza limit > 200", () =>
    expect(inpatientAdmissionListInput.safeParse({ limit: 201 }).success).toBe(false));
});

describe("inpatientAdmissionDischargeInput", () => {
  it("requiere id UUID", () =>
    expect(
      inpatientAdmissionDischargeInput.safeParse({ id: "x", notes: "ok" }).success,
    ).toBe(false));

  it("acepta id sin notes", () =>
    expect(inpatientAdmissionDischargeInput.safeParse({ id: u }).success).toBe(true));
});

describe("inpatientVitalsRecordInput", () => {
  it("acepta sólo admissionId (vitals todas opcionales)", () =>
    expect(inpatientVitalsRecordInput.safeParse({ admissionId: u }).success).toBe(true));

  it("rechaza temperatura > 45", () =>
    expect(
      inpatientVitalsRecordInput.safeParse({ admissionId: u, temperatureC: 46 }).success,
    ).toBe(false));

  it("rechaza heartRate < 20", () =>
    expect(
      inpatientVitalsRecordInput.safeParse({ admissionId: u, heartRate: 19 }).success,
    ).toBe(false));

  it("rechaza painScale > 10", () =>
    expect(
      inpatientVitalsRecordInput.safeParse({ admissionId: u, painScale: 11 }).success,
    ).toBe(false));
});

describe("inpatientKardexCreateInput", () => {
  it("acepta entrada DIET con shift MORNING", () =>
    expect(
      inpatientKardexCreateInput.safeParse({
        admissionId: u,
        category: "DIET",
        entry: "Líquida absoluta",
        shift: "MORNING",
      }).success,
    ).toBe(true));

  it("rechaza categoría desconocida", () =>
    expect(
      inpatientKardexCreateInput.safeParse({
        admissionId: u,
        category: "RANDOM",
        entry: "x",
      }).success,
    ).toBe(false));
});

describe("inpatientCarePlanCreateInput / UpdateStatusInput", () => {
  it("crea plan mínimo", () =>
    expect(
      inpatientCarePlanCreateInput.safeParse({
        admissionId: u,
        title: "Manejo de dolor",
      }).success,
    ).toBe(true));

  it("rechaza título vacío", () =>
    expect(
      inpatientCarePlanCreateInput.safeParse({ admissionId: u, title: "" }).success,
    ).toBe(false));

  it("actualiza status a ACTIVE", () =>
    expect(
      inpatientCarePlanUpdateStatusInput.safeParse({ id: u, status: "ACTIVE" }).success,
    ).toBe(true));
});
