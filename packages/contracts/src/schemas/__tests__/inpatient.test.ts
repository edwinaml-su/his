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
  inpatientAdmissionGoOnLeaveInput,
  inpatientAdmissionReturnFromLeaveInput,
  inpatientAdmissionTransferOutInput,
  inpatientVitalsRecordInput,
  inpatientKardexCreateInput,
  inpatientCarePlanCreateInput,
  inpatientCarePlanUpdateStatusInput,
  canTransitionInpatient,
  isTerminalInpatientStatus,
  evaluateVitalAlerts,
  VITAL_THRESHOLDS_ADULT,
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

// ---------------------------------------------------------------------------
// Beta.1 hardening tests
// ---------------------------------------------------------------------------

describe("Beta.1 — state machine canTransitionInpatient", () => {
  it("ACTIVE → ON_LEAVE permitido", () =>
    expect(canTransitionInpatient("ACTIVE", "ON_LEAVE")).toBe(true));
  it("ACTIVE → DISCHARGED permitido", () =>
    expect(canTransitionInpatient("ACTIVE", "DISCHARGED")).toBe(true));
  it("ACTIVE → TRANSFERRED_OUT permitido", () =>
    expect(canTransitionInpatient("ACTIVE", "TRANSFERRED_OUT")).toBe(true));
  it("ON_LEAVE → ACTIVE permitido", () =>
    expect(canTransitionInpatient("ON_LEAVE", "ACTIVE")).toBe(true));
  it("ON_LEAVE → DISCHARGED permitido", () =>
    expect(canTransitionInpatient("ON_LEAVE", "DISCHARGED")).toBe(true));
  it("ON_LEAVE → TRANSFERRED_OUT NO permitido", () =>
    expect(canTransitionInpatient("ON_LEAVE", "TRANSFERRED_OUT")).toBe(false));
  it("DISCHARGED es terminal (todo NO permitido)", () => {
    expect(canTransitionInpatient("DISCHARGED", "ACTIVE")).toBe(false);
    expect(canTransitionInpatient("DISCHARGED", "ON_LEAVE")).toBe(false);
    expect(canTransitionInpatient("DISCHARGED", "TRANSFERRED_OUT")).toBe(false);
  });
  it("TRANSFERRED_OUT es terminal", () => {
    expect(canTransitionInpatient("TRANSFERRED_OUT", "ACTIVE")).toBe(false);
    expect(canTransitionInpatient("TRANSFERRED_OUT", "DISCHARGED")).toBe(false);
  });
});

describe("Beta.1 — isTerminalInpatientStatus", () => {
  it("DISCHARGED y TRANSFERRED_OUT son terminales", () => {
    expect(isTerminalInpatientStatus("DISCHARGED")).toBe(true);
    expect(isTerminalInpatientStatus("TRANSFERRED_OUT")).toBe(true);
  });
  it("ACTIVE y ON_LEAVE NO son terminales", () => {
    expect(isTerminalInpatientStatus("ACTIVE")).toBe(false);
    expect(isTerminalInpatientStatus("ON_LEAVE")).toBe(false);
  });
});

describe("Beta.1 — evaluateVitalAlerts", () => {
  it("vacío cuando todas las vitales son null/undefined", () => {
    expect(evaluateVitalAlerts({})).toEqual([]);
  });

  it("vacío cuando todas en rango normal", () => {
    expect(
      evaluateVitalAlerts({
        temperatureC: 37.0,
        heartRate: 75,
        respiratoryRate: 16,
        systolicBp: 120,
        diastolicBp: 80,
        spo2: 98,
        painScale: 2,
      }),
    ).toEqual([]);
  });

  it("CRITICAL low en spo2 ≤ 88", () => {
    const r = evaluateVitalAlerts({ spo2: 85 });
    expect(r).toHaveLength(1);
    expect(r[0]!.severity).toBe("critical");
    expect(r[0]!.field).toBe("spo2");
  });

  it("CRITICAL high en heartRate ≥ 130", () => {
    const r = evaluateVitalAlerts({ heartRate: 135 });
    expect(r).toHaveLength(1);
    expect(r[0]!.severity).toBe("critical");
  });

  it("WARN low en heartRate = 50", () => {
    const r = evaluateVitalAlerts({ heartRate: 50 });
    expect(r).toHaveLength(1);
    expect(r[0]!.severity).toBe("warn");
  });

  it("WARN high en temperatureC = 38.5", () => {
    const r = evaluateVitalAlerts({ temperatureC: 38.5 });
    expect(r).toHaveLength(1);
    expect(r[0]!.severity).toBe("warn");
  });

  it("múltiples alerts agrupadas en una sola llamada", () => {
    const r = evaluateVitalAlerts({
      heartRate: 135,
      spo2: 85,
      respiratoryRate: 32,
    });
    expect(r.length).toBeGreaterThanOrEqual(3);
    expect(r.every((a) => a.severity === "critical")).toBe(true);
  });

  it("threshold exporta valores correctos adulto", () => {
    expect(VITAL_THRESHOLDS_ADULT.heartRate.criticalLow).toBe(40);
    expect(VITAL_THRESHOLDS_ADULT.heartRate.criticalHigh).toBe(130);
    expect(VITAL_THRESHOLDS_ADULT.spo2.criticalLow).toBe(88);
  });
});

describe("Beta.1 — inpatientAdmissionGoOnLeaveInput", () => {
  it("acepta input válido", () =>
    expect(
      inpatientAdmissionGoOnLeaveInput.safeParse({
        id: u,
        reason: "Pase domiciliario 24h",
      }).success,
    ).toBe(true));
  it("rechaza reason vacío", () =>
    expect(
      inpatientAdmissionGoOnLeaveInput.safeParse({ id: u, reason: "" }).success,
    ).toBe(false));
});

describe("Beta.1 — inpatientAdmissionReturnFromLeaveInput", () => {
  it("acepta sólo id", () =>
    expect(
      inpatientAdmissionReturnFromLeaveInput.safeParse({ id: u }).success,
    ).toBe(true));
});

describe("Beta.1 — inpatientAdmissionTransferOutInput", () => {
  it("acepta input completo", () =>
    expect(
      inpatientAdmissionTransferOutInput.safeParse({
        id: u,
        destinationName: "Hospital Bloom",
        reason: "Transplante hepático",
        notes: "Coordinado con cirujano",
      }).success,
    ).toBe(true));
  it("rechaza destinationName vacío", () =>
    expect(
      inpatientAdmissionTransferOutInput.safeParse({
        id: u,
        destinationName: "",
        reason: "x",
      }).success,
    ).toBe(false));
});

describe("Beta.1 — inpatientAdmissionCreateInput con bedId", () => {
  it("acepta input con bedId + bedAssignmentReason", () =>
    expect(
      inpatientAdmissionCreateInput.safeParse({
        encounterId: u,
        establishmentId: u,
        patientId: u,
        attendingId: u,
        reason: "X",
        bedId: u,
        bedAssignmentReason: "Asignación inicial",
      }).success,
    ).toBe(true));
  it("rechaza bedId no-UUID", () =>
    expect(
      inpatientAdmissionCreateInput.safeParse({
        encounterId: u,
        establishmentId: u,
        patientId: u,
        attendingId: u,
        reason: "X",
        bedId: "not-a-uuid",
      }).success,
    ).toBe(false));
});
