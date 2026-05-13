/**
 * Tests del schema §12 Emergency.
 * Valida forma del contrato Zod; transición disposition y LWBS automation
 * viven en `emergency.router.ts`.
 */
import { describe, it, expect } from "vitest";
import {
  emergencyDispositionEnum,
  emergencyArrivalModeEnum,
  emergencyNoteCategoryEnum,
  emergencyVisitCreateInput,
  emergencyVisitListInput,
  emergencyVisitDispositionInput,
  emergencyVisitStartObservationInput,
  emergencyVisitEndObservationInput,
  emergencyNoteCreateInput,
} from "../emergency";

const u = "00000000-0000-0000-0000-000000000001";

describe("emergencyDispositionEnum", () => {
  it.each([
    "PENDING",
    "DISCHARGED",
    "ADMITTED",
    "TRANSFERRED",
    "LWBS",
    "AMA",
    "DECEASED",
  ])("acepta disposition %s", (s) =>
    expect(emergencyDispositionEnum.safeParse(s).success).toBe(true),
  );
  it("rechaza desconocida", () =>
    expect(emergencyDispositionEnum.safeParse("OBSERVATION").success).toBe(false));
});

describe("emergencyArrivalModeEnum / emergencyNoteCategoryEnum", () => {
  it("arrivalMode AMBULANCE válido", () =>
    expect(emergencyArrivalModeEnum.safeParse("AMBULANCE").success).toBe(true));
  it("note category OBSERVATION válido", () =>
    expect(emergencyNoteCategoryEnum.safeParse("OBSERVATION").success).toBe(true));
});

describe("emergencyVisitCreateInput", () => {
  it("aplica default arrivalMode=WALK_IN", () => {
    const r = emergencyVisitCreateInput.safeParse({
      encounterId: u,
      establishmentId: u,
      patientId: u,
      chiefComplaint: "Dolor torácico",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.arrivalMode).toBe("WALK_IN");
  });

  it("acepta arrivalMode AMBULANCE y treatingId", () => {
    const r = emergencyVisitCreateInput.safeParse({
      encounterId: u,
      establishmentId: u,
      patientId: u,
      chiefComplaint: "Trauma craneal",
      arrivalMode: "AMBULANCE",
      treatingId: u,
    });
    expect(r.success).toBe(true);
  });

  it("rechaza chiefComplaint vacío", () =>
    expect(
      emergencyVisitCreateInput.safeParse({
        encounterId: u,
        establishmentId: u,
        patientId: u,
        chiefComplaint: "",
      }).success,
    ).toBe(false));
});

describe("emergencyVisitListInput", () => {
  it("aplica default limit=50", () => {
    const r = emergencyVisitListInput.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(50);
  });

  it("rechaza limit > 200", () =>
    expect(emergencyVisitListInput.safeParse({ limit: 999 }).success).toBe(false));
});

describe("emergencyVisitDispositionInput", () => {
  it("acepta disposition LWBS sin notes", () =>
    expect(
      emergencyVisitDispositionInput.safeParse({ id: u, disposition: "LWBS" }).success,
    ).toBe(true));

  it("rechaza disposition vacía", () =>
    expect(
      emergencyVisitDispositionInput.safeParse({ id: u, disposition: "" }).success,
    ).toBe(false));
});

describe("emergencyVisit start/end observation", () => {
  it("start observation requiere id UUID", () =>
    expect(emergencyVisitStartObservationInput.safeParse({ id: u }).success).toBe(true));
  it("end observation rechaza id no-UUID", () =>
    expect(emergencyVisitEndObservationInput.safeParse({ id: "x" }).success).toBe(false));
});

describe("emergencyNoteCreateInput", () => {
  it("acepta nota válida", () =>
    expect(
      emergencyNoteCreateInput.safeParse({
        visitId: u,
        category: "REASSESSMENT",
        body: "Mejoría tras analgesia",
      }).success,
    ).toBe(true));

  it("rechaza body vacío", () =>
    expect(
      emergencyNoteCreateInput.safeParse({
        visitId: u,
        category: "OBSERVATION",
        body: "",
      }).success,
    ).toBe(false));
});
