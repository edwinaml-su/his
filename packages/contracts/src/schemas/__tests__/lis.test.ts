/**
 * Tests del schema §17 LIS.
 */
import { describe, it, expect } from "vitest";
import {
  specimenTypeEnum,
  labPriorityEnum,
  labOrderStatusEnum,
  specimenConditionEnum,
  resultFlagEnum,
  labPanelListInput,
  labTestListInput,
  labOrderCreateInput,
  labOrderListInput,
  specimenCollectInput,
  specimenRejectInput,
  resultEnterInput,
  resultValidateInput,
} from "../lis";

const u = "00000000-0000-0000-0000-000000000001";

describe("enums LIS", () => {
  it("specimenType acepta BLOOD", () =>
    expect(specimenTypeEnum.safeParse("BLOOD").success).toBe(true));
  it("labPriority acepta STAT", () =>
    expect(labPriorityEnum.safeParse("STAT").success).toBe(true));
  it("labOrderStatus acepta VALIDATED", () =>
    expect(labOrderStatusEnum.safeParse("VALIDATED").success).toBe(true));
  it("specimenCondition rechaza GOOD", () =>
    expect(specimenConditionEnum.safeParse("GOOD").success).toBe(false));
  it("resultFlag acepta CRITICAL_HIGH", () =>
    expect(resultFlagEnum.safeParse("CRITICAL_HIGH").success).toBe(true));
});

describe("labPanelListInput", () => {
  it("aplica defaults", () => {
    const r = labPanelListInput.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.activeOnly).toBe(true);
      expect(r.data.limit).toBe(50);
    }
  });
});

describe("labTestListInput", () => {
  it("acepta panelId opcional", () =>
    expect(labTestListInput.safeParse({ panelId: u }).success).toBe(true));
  it("rechaza panelId no-UUID", () =>
    expect(labTestListInput.safeParse({ panelId: "x" }).success).toBe(false));
});

describe("labOrderCreateInput", () => {
  it("acepta orden con 1 ítem y prioridad por default", () => {
    const r = labOrderCreateInput.safeParse({
      encounterId: u,
      patientId: u,
      items: [{ testId: u }],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.priority).toBe("ROUTINE");
  });

  it("rechaza orden sin ítems", () =>
    expect(
      labOrderCreateInput.safeParse({
        encounterId: u,
        patientId: u,
        items: [],
      }).success,
    ).toBe(false));

  it("rechaza > 50 ítems", () => {
    const items = Array.from({ length: 51 }, () => ({ testId: u }));
    expect(
      labOrderCreateInput.safeParse({
        encounterId: u,
        patientId: u,
        items,
      }).success,
    ).toBe(false);
  });
});

describe("labOrderListInput", () => {
  it("acepta filtros vacíos con default limit=50", () => {
    const r = labOrderListInput.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(50);
  });
});

describe("specimenCollectInput", () => {
  it("acepta colección válida", () => {
    expect(
      specimenCollectInput.safeParse({
        orderId: u,
        type: "BLOOD",
        barcode: "BAR-001",
      }).success,
    ).toBe(true);
  });

  it("rechaza barcode vacío", () =>
    expect(
      specimenCollectInput.safeParse({
        orderId: u,
        type: "BLOOD",
        barcode: "",
      }).success,
    ).toBe(false));
});

describe("specimenRejectInput", () => {
  it("acepta rechazo con razón", () =>
    expect(
      specimenRejectInput.safeParse({
        id: u,
        rejectionReason: "Muestra hemolizada",
      }).success,
    ).toBe(true));

  it("rechaza razón vacía", () =>
    expect(
      specimenRejectInput.safeParse({ id: u, rejectionReason: "" }).success,
    ).toBe(false));
});

describe("resultEnterInput", () => {
  it("acepta resultado numérico con default flag=NORMAL", () => {
    const r = resultEnterInput.safeParse({
      orderItemId: u,
      valueNumeric: 7.2,
      valueUnit: "g/dL",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.flag).toBe("NORMAL");
  });

  it("acepta resultado de texto con flag CRITICAL_LOW", () => {
    expect(
      resultEnterInput.safeParse({
        orderItemId: u,
        valueText: "Positivo",
        flag: "CRITICAL_LOW",
      }).success,
    ).toBe(true);
  });
});

describe("resultValidateInput", () => {
  it("acepta UUID", () =>
    expect(resultValidateInput.safeParse({ resultId: u }).success).toBe(true));
  it("rechaza no-UUID", () =>
    expect(resultValidateInput.safeParse({ resultId: "x" }).success).toBe(
      false,
    ));
});
