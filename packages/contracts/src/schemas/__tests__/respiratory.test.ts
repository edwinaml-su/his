/**
 * Tests del schema §21 Respiratory (Wave 8 / Beta.12 hardening layer 1).
 *
 * Beta.12 coverage:
 *   - VentilatorSessionStatus enum.
 *   - Medically-safe ranges: PEEP, FiO2, RR, Vt.
 *   - ventilatorSessionTransitionInput.
 *   - respiratoryOrderRenewInput / getExpiredOrdersInput.
 */
import { describe, it, expect } from "vitest";
import {
  respiratoryOrderTypeEnum,
  respiratoryOrderStatusEnum,
  ventilatorModeEnum,
  medicalGasTypeEnum,
  ventilatorSessionStatusEnum,
  respiratoryOrderCreateInput,
  respiratoryOrderListInput,
  respiratoryOrderCompleteInput,
  respiratoryOrderCancelInput,
  respiratoryOrderRenewInput,
  getExpiredOrdersInput,
  ventilatorSessionCreateInput,
  ventilatorSessionEndInput,
  ventilatorSessionListInput,
  ventilatorSessionTransitionInput,
  medicalGasUsageCreateInput,
  medicalGasUsageListInput,
  ventilatorParamsSchema,
  PEEP_MIN,
  PEEP_MAX,
  FIO2_MIN,
  FIO2_MAX,
  RR_MIN,
  RR_MAX,
  VT_ABS_MIN,
  VT_ABS_MAX,
} from "../respiratory";

const u = "00000000-0000-0000-0000-000000000001";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

describe("enums", () => {
  it.each([
    "OXYGEN_THERAPY",
    "MECHANICAL_VENT",
    "NEBULIZATION",
    "AEROSOL",
    "CPAP_BIPAP",
    "CHEST_PHYSIO",
  ])("order type %s válido", (t) =>
    expect(respiratoryOrderTypeEnum.safeParse(t).success).toBe(true),
  );

  it.each(["ACTIVE", "COMPLETED", "CANCELLED", "ON_HOLD"])("status %s válido", (s) =>
    expect(respiratoryOrderStatusEnum.safeParse(s).success).toBe(true),
  );

  it.each(["AC", "SIMV", "PSV", "CPAP", "BIPAP", "PRVC", "OTHER"])(
    "ventilator mode %s válido",
    (m) => expect(ventilatorModeEnum.safeParse(m).success).toBe(true),
  );

  it.each(["O2", "AIR", "N2O", "CO2", "HELIOX"])("gas type %s válido", (g) =>
    expect(medicalGasTypeEnum.safeParse(g).success).toBe(true),
  );

  it("ventilator mode FOO inválido", () =>
    expect(ventilatorModeEnum.safeParse("FOO").success).toBe(false));

  // Beta.12 — VentilatorSessionStatus
  it.each(["ACTIVE", "WEANING", "EXTUBATED", "ESCALATED", "FAILED_EXTUBATION"])(
    "ventilatorSessionStatus %s válido",
    (s) => expect(ventilatorSessionStatusEnum.safeParse(s).success).toBe(true),
  );

  it("ventilatorSessionStatus UNKNOWN inválido", () =>
    expect(ventilatorSessionStatusEnum.safeParse("UNKNOWN").success).toBe(false));
});

// ---------------------------------------------------------------------------
// RespiratoryOrder create
// ---------------------------------------------------------------------------

describe("respiratoryOrderCreateInput", () => {
  it("acepta input mínimo", () =>
    expect(
      respiratoryOrderCreateInput.safeParse({
        encounterId: u,
        patientId: u,
        prescriberId: u,
        type: "OXYGEN_THERAPY",
        flowRate: 3,
      }).success,
    ).toBe(true));

  it("rechaza fio2 < 21", () =>
    expect(
      respiratoryOrderCreateInput.safeParse({
        encounterId: u,
        patientId: u,
        prescriberId: u,
        type: "MECHANICAL_VENT",
        fio2: 18,
      }).success,
    ).toBe(false));

  it("rechaza fio2 > 100", () =>
    expect(
      respiratoryOrderCreateInput.safeParse({
        encounterId: u,
        patientId: u,
        prescriberId: u,
        type: "MECHANICAL_VENT",
        fio2: 110,
      }).success,
    ).toBe(false));

  it("rechaza flowRate negativo", () =>
    expect(
      respiratoryOrderCreateInput.safeParse({
        encounterId: u,
        patientId: u,
        prescriberId: u,
        type: "OXYGEN_THERAPY",
        flowRate: -1,
      }).success,
    ).toBe(false));

  it("rechaza uuid inválido", () =>
    expect(
      respiratoryOrderCreateInput.safeParse({
        encounterId: "abc",
        patientId: u,
        prescriberId: u,
        type: "AEROSOL",
      }).success,
    ).toBe(false));

  it("acepta expiresAt como fecha (Beta.12)", () => {
    const r = respiratoryOrderCreateInput.safeParse({
      encounterId: u,
      patientId: u,
      prescriberId: u,
      type: "OXYGEN_THERAPY",
      expiresAt: new Date("2026-05-14T12:00:00Z"),
    });
    expect(r.success).toBe(true);
  });

  it("acepta expiresAt como string ISO (coerce, Beta.12)", () => {
    const r = respiratoryOrderCreateInput.safeParse({
      encounterId: u,
      patientId: u,
      prescriberId: u,
      type: "OXYGEN_THERAPY",
      expiresAt: "2026-05-14T12:00:00Z",
    });
    expect(r.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// RespiratoryOrder list / complete / cancel / renew / getExpired
// ---------------------------------------------------------------------------

describe("respiratoryOrderListInput / complete / cancel / renew / getExpired", () => {
  it("default limit=50", () => {
    const r = respiratoryOrderListInput.safeParse({});
    if (r.success) expect(r.data.limit).toBe(50);
  });

  it("complete requiere uuid", () =>
    expect(respiratoryOrderCompleteInput.safeParse({ id: "abc" }).success).toBe(false));

  it("cancel acepta uuid", () =>
    expect(respiratoryOrderCancelInput.safeParse({ id: u }).success).toBe(true));

  it("renew acepta uuid (Beta.12)", () =>
    expect(respiratoryOrderRenewInput.safeParse({ id: u }).success).toBe(true));

  it("renew rechaza no-uuid (Beta.12)", () =>
    expect(respiratoryOrderRenewInput.safeParse({ id: "bad" }).success).toBe(false));

  it("getExpiredOrdersInput default limit=100 (Beta.12)", () => {
    const r = getExpiredOrdersInput.safeParse({});
    if (r.success) expect(r.data.limit).toBe(100);
  });

  it("getExpiredOrdersInput acepta asOf como Date (Beta.12)", () => {
    const r = getExpiredOrdersInput.safeParse({ asOf: new Date(), limit: 50 });
    expect(r.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ventilatorParamsSchema — medically-safe ranges (Beta.12)
// ---------------------------------------------------------------------------

describe("ventilatorParamsSchema — medically-safe ranges", () => {
  it("PEEP en límite inferior válido", () =>
    expect(ventilatorParamsSchema.safeParse({ peep: PEEP_MIN }).success).toBe(true));

  it("PEEP en límite superior válido", () =>
    expect(ventilatorParamsSchema.safeParse({ peep: PEEP_MAX }).success).toBe(true));

  it(`PEEP < ${PEEP_MIN} inválido`, () =>
    expect(ventilatorParamsSchema.safeParse({ peep: PEEP_MIN - 1 }).success).toBe(false));

  it(`PEEP > ${PEEP_MAX} inválido`, () =>
    expect(ventilatorParamsSchema.safeParse({ peep: PEEP_MAX + 1 }).success).toBe(false));

  it("FiO2 en límite inferior válido", () =>
    expect(ventilatorParamsSchema.safeParse({ fio2: FIO2_MIN }).success).toBe(true));

  it("FiO2 en límite superior válido", () =>
    expect(ventilatorParamsSchema.safeParse({ fio2: FIO2_MAX }).success).toBe(true));

  it(`FiO2 < ${FIO2_MIN} inválido`, () =>
    expect(ventilatorParamsSchema.safeParse({ fio2: FIO2_MIN - 0.01 }).success).toBe(false));

  it(`FiO2 > ${FIO2_MAX} inválido`, () =>
    expect(ventilatorParamsSchema.safeParse({ fio2: FIO2_MAX + 0.01 }).success).toBe(false));

  it("RR en límite inferior válido", () =>
    expect(ventilatorParamsSchema.safeParse({ rrSet: RR_MIN }).success).toBe(true));

  it("RR en límite superior válido", () =>
    expect(ventilatorParamsSchema.safeParse({ rrSet: RR_MAX }).success).toBe(true));

  it(`RR < ${RR_MIN} inválido`, () =>
    expect(ventilatorParamsSchema.safeParse({ rrSet: RR_MIN - 1 }).success).toBe(false));

  it(`RR > ${RR_MAX} inválido`, () =>
    expect(ventilatorParamsSchema.safeParse({ rrSet: RR_MAX + 1 }).success).toBe(false));

  it("Vt en límite inferior válido", () =>
    expect(ventilatorParamsSchema.safeParse({ tidalVolume: VT_ABS_MIN }).success).toBe(true));

  it("Vt en límite superior válido", () =>
    expect(ventilatorParamsSchema.safeParse({ tidalVolume: VT_ABS_MAX }).success).toBe(true));

  it(`Vt < ${VT_ABS_MIN} mL inválido`, () =>
    expect(ventilatorParamsSchema.safeParse({ tidalVolume: VT_ABS_MIN - 1 }).success).toBe(false));

  it(`Vt > ${VT_ABS_MAX} mL inválido`, () =>
    expect(ventilatorParamsSchema.safeParse({ tidalVolume: VT_ABS_MAX + 1 }).success).toBe(false));

  it("acepta parámetros todos en rango", () =>
    expect(
      ventilatorParamsSchema.safeParse({
        peep: 8,
        fio2: 0.4,
        rrSet: 14,
        tidalVolume: 450,
        patientWeightKg: 70,
      }).success,
    ).toBe(true));
});

// ---------------------------------------------------------------------------
// VentilatorSession create / end / list / transition
// ---------------------------------------------------------------------------

describe("ventilatorSessionCreateInput", () => {
  it("acepta sesión con params en rango", () =>
    expect(
      ventilatorSessionCreateInput.safeParse({
        orderId: u,
        mode: "AC",
        tidalVolume: 450,
        rrSet: 14,
        peep: 8,
        fio2: 0.4,
        patientWeightKg: 70,
      }).success,
    ).toBe(true));

  it("rechaza rrSet > RR_MAX", () =>
    expect(
      ventilatorSessionCreateInput.safeParse({
        orderId: u,
        mode: "PSV",
        rrSet: RR_MAX + 1,
      }).success,
    ).toBe(false));

  it("rechaza rrSet < RR_MIN", () =>
    expect(
      ventilatorSessionCreateInput.safeParse({
        orderId: u,
        mode: "SIMV",
        rrSet: RR_MIN - 1,
      }).success,
    ).toBe(false));

  it("rechaza peep fuera de rango", () =>
    expect(
      ventilatorSessionCreateInput.safeParse({
        orderId: u,
        mode: "AC",
        peep: PEEP_MAX + 1,
      }).success,
    ).toBe(false));

  it("rechaza fio2 > 1.0", () =>
    expect(
      ventilatorSessionCreateInput.safeParse({
        orderId: u,
        mode: "AC",
        fio2: 1.1,
      }).success,
    ).toBe(false));

  it("end requiere uuid", () =>
    expect(ventilatorSessionEndInput.safeParse({ id: u }).success).toBe(true));

  it("list default limit=50", () => {
    const r = ventilatorSessionListInput.safeParse({});
    if (r.success) expect(r.data.limit).toBe(50);
  });

  it("list filtra por statusSM (Beta.12)", () => {
    const r = ventilatorSessionListInput.safeParse({ statusSM: "WEANING", limit: 10 });
    expect(r.success).toBe(true);
  });
});

describe("ventilatorSessionTransitionInput (Beta.12)", () => {
  it("acepta transición válida ACTIVE→WEANING", () =>
    expect(
      ventilatorSessionTransitionInput.safeParse({ id: u, to: "WEANING" }).success,
    ).toBe(true));

  it("acepta transición con notes", () =>
    expect(
      ventilatorSessionTransitionInput.safeParse({ id: u, to: "EXTUBATED", notes: "ok" }).success,
    ).toBe(true));

  it("rechaza to inválido", () =>
    expect(
      ventilatorSessionTransitionInput.safeParse({ id: u, to: "RUNNING" }).success,
    ).toBe(false));

  it("rechaza id no-uuid", () =>
    expect(
      ventilatorSessionTransitionInput.safeParse({ id: "bad", to: "WEANING" }).success,
    ).toBe(false));
});

// ---------------------------------------------------------------------------
// MedicalGasUsage
// ---------------------------------------------------------------------------

describe("medicalGasUsageCreateInput", () => {
  it("acepta input válido", () =>
    expect(
      medicalGasUsageCreateInput.safeParse({
        orderId: u,
        gasType: "O2",
        volumeLiters: 120.5,
      }).success,
    ).toBe(true));

  it("rechaza volumeLiters 0", () =>
    expect(
      medicalGasUsageCreateInput.safeParse({
        orderId: u,
        gasType: "AIR",
        volumeLiters: 0,
      }).success,
    ).toBe(false));

  it("rechaza volumeLiters negativo", () =>
    expect(
      medicalGasUsageCreateInput.safeParse({
        orderId: u,
        gasType: "O2",
        volumeLiters: -10,
      }).success,
    ).toBe(false));

  it("list default limit=100, max=500", () => {
    const r = medicalGasUsageListInput.safeParse({});
    if (r.success) expect(r.data.limit).toBe(100);
    expect(medicalGasUsageListInput.safeParse({ limit: 1000 }).success).toBe(false);
  });
});
