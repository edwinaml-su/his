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
  resultEnterWithPatientContextInput,
  evaluateLabResultFlag,
  isCriticalFlag,
  applyReflexRules,
  canTransitionLabOrder,
  isTerminalLabOrderStatus,
  type LabReferenceRange,
  type ReflexRule,
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

// ---------------------------------------------------------------------------
// Beta.3 hardening tests
// ---------------------------------------------------------------------------

describe("Beta.3 — evaluateLabResultFlag", () => {
  const adultGlucose: LabReferenceRange = {
    minValue: 70,
    maxValue: 100,
    ageMinYears: 18,
    ageMaxYears: null,
    sex: "BOTH",
    criticalLow: 40,
    criticalHigh: 400,
  };
  const pediatricGlucose: LabReferenceRange = {
    minValue: 60,
    maxValue: 110,
    ageMinYears: 0,
    ageMaxYears: 17,
    sex: "BOTH",
    criticalLow: 30,
    criticalHigh: 400,
  };
  const adultHemoglobinMale: LabReferenceRange = {
    minValue: 13.5,
    maxValue: 17.5,
    ageMinYears: 18,
    ageMaxYears: null,
    sex: "MALE",
    criticalLow: 7,
    criticalHigh: 20,
  };
  const adultHemoglobinFemale: LabReferenceRange = {
    minValue: 12.0,
    maxValue: 15.5,
    ageMinYears: 18,
    ageMaxYears: null,
    sex: "FEMALE",
    criticalLow: 7,
    criticalHigh: 20,
  };

  it("NORMAL si valueNumeric es null/undefined", () =>
    expect(
      evaluateLabResultFlag({
        valueNumeric: null,
        ranges: [adultGlucose],
        patientAgeYears: 30,
      }),
    ).toBe("NORMAL"));

  it("NORMAL si está dentro del rango", () =>
    expect(
      evaluateLabResultFlag({
        valueNumeric: 85,
        ranges: [adultGlucose],
        patientAgeYears: 30,
      }),
    ).toBe("NORMAL"));

  it("LOW si bajo rango pero no crítico", () =>
    expect(
      evaluateLabResultFlag({
        valueNumeric: 65,
        ranges: [adultGlucose],
        patientAgeYears: 30,
      }),
    ).toBe("LOW"));

  it("HIGH si sobre rango pero no crítico", () =>
    expect(
      evaluateLabResultFlag({
        valueNumeric: 120,
        ranges: [adultGlucose],
        patientAgeYears: 30,
      }),
    ).toBe("HIGH"));

  it("CRITICAL_LOW si <= criticalLow", () =>
    expect(
      evaluateLabResultFlag({
        valueNumeric: 35,
        ranges: [adultGlucose],
        patientAgeYears: 30,
      }),
    ).toBe("CRITICAL_LOW"));

  it("CRITICAL_HIGH si >= criticalHigh", () =>
    expect(
      evaluateLabResultFlag({
        valueNumeric: 450,
        ranges: [adultGlucose],
        patientAgeYears: 30,
      }),
    ).toBe("CRITICAL_HIGH"));

  it("selecciona rango pediátrico para niño", () =>
    expect(
      evaluateLabResultFlag({
        valueNumeric: 95,
        ranges: [pediatricGlucose, adultGlucose],
        patientAgeYears: 5,
      }),
    ).toBe("NORMAL"));

  it("selecciona rango pediátrico CRITICAL_LOW correctamente", () =>
    expect(
      evaluateLabResultFlag({
        valueNumeric: 25,
        ranges: [pediatricGlucose, adultGlucose],
        patientAgeYears: 5,
      }),
    ).toBe("CRITICAL_LOW"));

  it("estratifica por sexo: MALE usa adultHemoglobinMale", () =>
    expect(
      evaluateLabResultFlag({
        valueNumeric: 14,
        ranges: [adultHemoglobinMale, adultHemoglobinFemale],
        patientAgeYears: 30,
        patientSex: "MALE",
      }),
    ).toBe("NORMAL"));

  it("estratifica por sexo: FEMALE 14 está dentro de rango femenino", () =>
    expect(
      evaluateLabResultFlag({
        valueNumeric: 14,
        ranges: [adultHemoglobinMale, adultHemoglobinFemale],
        patientAgeYears: 30,
        patientSex: "FEMALE",
      }),
    ).toBe("NORMAL"));

  it("estratifica por sexo: FEMALE 12.5 → NORMAL (dentro 12.0-15.5)", () =>
    expect(
      evaluateLabResultFlag({
        valueNumeric: 12.5,
        ranges: [adultHemoglobinMale, adultHemoglobinFemale],
        patientAgeYears: 30,
        patientSex: "FEMALE",
      }),
    ).toBe("NORMAL"));

  it("NORMAL si no hay ranges aplicables", () =>
    expect(
      evaluateLabResultFlag({
        valueNumeric: 100,
        ranges: [],
        patientAgeYears: 30,
      }),
    ).toBe("NORMAL"));
});

describe("Beta.3 — isCriticalFlag", () => {
  it("true para CRITICAL_LOW", () =>
    expect(isCriticalFlag("CRITICAL_LOW")).toBe(true));
  it("true para CRITICAL_HIGH", () =>
    expect(isCriticalFlag("CRITICAL_HIGH")).toBe(true));
  it("false para NORMAL, LOW, HIGH, ABNORMAL", () => {
    expect(isCriticalFlag("NORMAL")).toBe(false);
    expect(isCriticalFlag("LOW")).toBe(false);
    expect(isCriticalFlag("HIGH")).toBe(false);
    expect(isCriticalFlag("ABNORMAL")).toBe(false);
  });
});

describe("Beta.3 — applyReflexRules", () => {
  const rules: ReflexRule[] = [
    {
      triggerTestCode: "TSH",
      triggerCondition: "ABOVE",
      triggerThreshold: 5.0,
      reflexTestCode: "FT4",
      reflexTestName: "Free T4",
      active: true,
    },
    {
      triggerTestCode: "TSH",
      triggerCondition: "BELOW",
      triggerThreshold: 0.4,
      reflexTestCode: "FT3",
      reflexTestName: "Free T3",
      active: true,
    },
    {
      triggerTestCode: "PSA",
      triggerCondition: "FLAGGED",
      reflexTestCode: "FREE_PSA",
      reflexTestName: "Free PSA ratio",
      active: true,
    },
    {
      triggerTestCode: "HIV_SCREEN",
      triggerCondition: "POSITIVE",
      reflexTestCode: "HIV_CONFIRM",
      reflexTestName: "HIV confirmatorio Western Blot",
      active: true,
    },
    {
      triggerTestCode: "INACTIVE_RULE",
      triggerCondition: "FLAGGED",
      reflexTestCode: "X",
      reflexTestName: "X",
      active: false,
    },
  ];

  it("ABOVE: TSH > 5 dispara FT4", () => {
    const r = applyReflexRules({
      testCode: "TSH",
      valueNumeric: 6.5,
      flag: "HIGH",
      rules,
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.reflexTestCode).toBe("FT4");
  });

  it("BELOW: TSH < 0.4 dispara FT3", () => {
    const r = applyReflexRules({
      testCode: "TSH",
      valueNumeric: 0.2,
      flag: "LOW",
      rules,
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.reflexTestCode).toBe("FT3");
  });

  it("FLAGGED: PSA con flag distinto de NORMAL dispara FREE_PSA", () => {
    const r = applyReflexRules({
      testCode: "PSA",
      valueNumeric: 5,
      flag: "HIGH",
      rules,
    });
    expect(r.find((x) => x.reflexTestCode === "FREE_PSA")).toBeTruthy();
  });

  it("POSITIVE: HIV_SCREEN HIGH (positivo) dispara confirmatorio", () => {
    const r = applyReflexRules({
      testCode: "HIV_SCREEN",
      flag: "CRITICAL_HIGH",
      rules,
    });
    expect(r.find((x) => x.reflexTestCode === "HIV_CONFIRM")).toBeTruthy();
  });

  it("no dispara para regla inactive", () => {
    const r = applyReflexRules({
      testCode: "INACTIVE_RULE",
      flag: "HIGH",
      rules,
    });
    expect(r).toHaveLength(0);
  });

  it("retorna lista vacía si no hay rules aplicables", () => {
    const r = applyReflexRules({
      testCode: "UNKNOWN",
      flag: "NORMAL",
      rules,
    });
    expect(r).toEqual([]);
  });

  it("TSH=4.5 (en rango) no dispara FT4 (ABOVE 5)", () => {
    const r = applyReflexRules({
      testCode: "TSH",
      valueNumeric: 4.5,
      flag: "NORMAL",
      rules,
    });
    expect(r).toEqual([]);
  });
});

describe("Beta.3 — canTransitionLabOrder", () => {
  it("DRAFT → ORDERED true", () =>
    expect(canTransitionLabOrder("DRAFT", "ORDERED")).toBe(true));
  it("DRAFT → CANCELLED true", () =>
    expect(canTransitionLabOrder("DRAFT", "CANCELLED")).toBe(true));
  it("DRAFT → COLLECTED false (debe pasar por ORDERED)", () =>
    expect(canTransitionLabOrder("DRAFT", "COLLECTED")).toBe(false));
  it("ORDERED → COLLECTED true", () =>
    expect(canTransitionLabOrder("ORDERED", "COLLECTED")).toBe(true));
  it("COLLECTED → IN_PROCESS true", () =>
    expect(canTransitionLabOrder("COLLECTED", "IN_PROCESS")).toBe(true));
  it("IN_PROCESS → RESULTED true", () =>
    expect(canTransitionLabOrder("IN_PROCESS", "RESULTED")).toBe(true));
  it("RESULTED → VALIDATED true", () =>
    expect(canTransitionLabOrder("RESULTED", "VALIDATED")).toBe(true));
  it("VALIDATED es terminal", () => {
    expect(canTransitionLabOrder("VALIDATED", "CANCELLED")).toBe(false);
    expect(canTransitionLabOrder("VALIDATED", "RESULTED")).toBe(false);
  });
  it("CANCELLED es terminal", () => {
    expect(canTransitionLabOrder("CANCELLED", "ORDERED")).toBe(false);
  });
  it("isTerminalLabOrderStatus reconoce VALIDATED y CANCELLED", () => {
    expect(isTerminalLabOrderStatus("VALIDATED")).toBe(true);
    expect(isTerminalLabOrderStatus("CANCELLED")).toBe(true);
    expect(isTerminalLabOrderStatus("DRAFT")).toBe(false);
    expect(isTerminalLabOrderStatus("RESULTED")).toBe(false);
  });
});

describe("Beta.3 — resultEnterWithPatientContextInput", () => {
  it("acepta input con patientAgeYears y patientSex", () => {
    const r = resultEnterWithPatientContextInput.safeParse({
      orderItemId: u,
      valueNumeric: 100,
      patientAgeYears: 30,
      patientSex: "MALE",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.forceFlagOverride).toBe(false);
  });

  it("rechaza patientAgeYears > 120", () =>
    expect(
      resultEnterWithPatientContextInput.safeParse({
        orderItemId: u,
        patientAgeYears: 121,
      }).success,
    ).toBe(false));

  it("acepta forceFlagOverride explicit true", () => {
    const r = resultEnterWithPatientContextInput.safeParse({
      orderItemId: u,
      flag: "HIGH",
      forceFlagOverride: true,
    });
    expect(r.success).toBe(true);
  });
});
