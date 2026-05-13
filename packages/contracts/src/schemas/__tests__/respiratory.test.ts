/**
 * Tests del schema §21 Respiratory (Wave 8).
 */
import { describe, it, expect } from "vitest";
import {
  respiratoryOrderTypeEnum,
  respiratoryOrderStatusEnum,
  ventilatorModeEnum,
  medicalGasTypeEnum,
  respiratoryOrderCreateInput,
  respiratoryOrderListInput,
  respiratoryOrderCompleteInput,
  respiratoryOrderCancelInput,
  ventilatorSessionCreateInput,
  ventilatorSessionEndInput,
  ventilatorSessionListInput,
  medicalGasUsageCreateInput,
  medicalGasUsageListInput,
} from "../respiratory";

const u = "00000000-0000-0000-0000-000000000001";

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
});

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
});

describe("respiratoryOrderListInput / complete / cancel", () => {
  it("default limit=50", () => {
    const r = respiratoryOrderListInput.safeParse({});
    if (r.success) expect(r.data.limit).toBe(50);
  });

  it("complete requiere uuid", () =>
    expect(respiratoryOrderCompleteInput.safeParse({ id: "abc" }).success).toBe(false));

  it("cancel acepta uuid", () =>
    expect(respiratoryOrderCancelInput.safeParse({ id: u }).success).toBe(true));
});

describe("ventilatorSessionCreateInput", () => {
  it("acepta sesión válida", () =>
    expect(
      ventilatorSessionCreateInput.safeParse({
        orderId: u,
        mode: "AC",
        tidalVolume: 450,
        rrSet: 14,
        peep: 5,
        fio2: 40,
      }).success,
    ).toBe(true));

  it("rechaza rrSet > 60", () =>
    expect(
      ventilatorSessionCreateInput.safeParse({
        orderId: u,
        mode: "PSV",
        rrSet: 70,
      }).success,
    ).toBe(false));

  it("rechaza rrSet negativo", () =>
    expect(
      ventilatorSessionCreateInput.safeParse({
        orderId: u,
        mode: "SIMV",
        rrSet: -5,
      }).success,
    ).toBe(false));

  it("end requiere uuid", () =>
    expect(ventilatorSessionEndInput.safeParse({ id: u }).success).toBe(true));

  it("list default limit=50", () => {
    const r = ventilatorSessionListInput.safeParse({});
    if (r.success) expect(r.data.limit).toBe(50);
  });
});

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
