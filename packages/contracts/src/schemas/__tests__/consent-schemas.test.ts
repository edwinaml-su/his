/**
 * Tests de schemas de consentimiento (US-2.9).
 */
import { describe, it, expect } from "vitest";
import {
  consentPurposeEnum,
  consentStatusEnum,
  consentListInput,
  consentGetInput,
  consentByPatientInput,
  consentCreateInput,
  consentRevokeInput,
  consentTemplateListInput,
} from "../consent";

const u = "00000000-0000-0000-0000-000000000001";

describe("consentPurposeEnum", () => {
  it.each(["data-processing", "mpi-cross-org", "transfusion", "research", "telemedicine"])(
    "acepta %s",
    (p) => expect(consentPurposeEnum.safeParse(p).success).toBe(true),
  );
  it("rechaza proposito desconocido", () => {
    expect(consentPurposeEnum.safeParse("surgery").success).toBe(false);
  });
});

describe("consentStatusEnum", () => {
  it.each(["active", "revoked", "expired"])("acepta %s", (s) => {
    expect(consentStatusEnum.safeParse(s).success).toBe(true);
  });
});

describe("consentListInput", () => {
  it("acepta input vacio con defaults", () => {
    const result = consentListInput.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.pageSize).toBe(20);
    }
  });

  it("acepta filtros completos", () => {
    const result = consentListInput.safeParse({
      patientId: u,
      purpose: "transfusion",
      status: "active",
      from: "2025-01-01",
      to: "2025-12-31",
      page: 1,
      pageSize: 10,
    });
    expect(result.success).toBe(true);
  });

  it("rechaza pageSize mayor a 100", () => {
    expect(consentListInput.safeParse({ pageSize: 101 }).success).toBe(false);
  });
});

describe("consentGetInput", () => {
  it("acepta UUID valido", () => {
    expect(consentGetInput.safeParse({ id: u }).success).toBe(true);
  });
  it("rechaza id no-uuid", () => {
    expect(consentGetInput.safeParse({ id: "bad" }).success).toBe(false);
  });
});

describe("consentByPatientInput", () => {
  it("acepta patientId UUID", () => {
    expect(consentByPatientInput.safeParse({ patientId: u }).success).toBe(true);
  });
  it("rechaza patientId no-uuid", () => {
    expect(consentByPatientInput.safeParse({ patientId: "bad" }).success).toBe(false);
  });
});

describe("consentCreateInput", () => {
  const VALID = { patientId: u, purpose: "data-processing" as const, version: 1 };

  it("acepta input minimo valido", () => {
    expect(consentCreateInput.safeParse(VALID).success).toBe(true);
  });

  it("granted=true por defecto", () => {
    const result = consentCreateInput.safeParse(VALID);
    if (result.success) expect(result.data.granted).toBe(true);
  });

  it("acepta granted=false (revocacion inicial)", () => {
    expect(consentCreateInput.safeParse({ ...VALID, granted: false }).success).toBe(true);
  });

  it("rechaza patientId no-uuid", () => {
    expect(consentCreateInput.safeParse({ ...VALID, patientId: "bad" }).success).toBe(false);
  });

  it("rechaza version 0", () => {
    expect(consentCreateInput.safeParse({ ...VALID, version: 0 }).success).toBe(false);
  });

  it("rechaza proposito invalido", () => {
    expect(consentCreateInput.safeParse({ ...VALID, purpose: "unknown" }).success).toBe(false);
  });
});

describe("consentRevokeInput", () => {
  it("acepta id sin reason", () => {
    expect(consentRevokeInput.safeParse({ id: u }).success).toBe(true);
  });

  it("acepta reason valido", () => {
    expect(consentRevokeInput.safeParse({ id: u, reason: "Paciente solicita revocación" }).success).toBe(true);
  });

  it("rechaza reason vacio cuando se provee", () => {
    expect(consentRevokeInput.safeParse({ id: u, reason: "" }).success).toBe(false);
  });
});

describe("consentTemplateListInput", () => {
  it("acepta input vacio", () => {
    expect(consentTemplateListInput.safeParse({}).success).toBe(true);
  });

  it("acepta countryIso de 3 letras", () => {
    expect(consentTemplateListInput.safeParse({ countryIso: "SLV" }).success).toBe(true);
  });

  it("rechaza countryIso de longitud incorrecta", () => {
    expect(consentTemplateListInput.safeParse({ countryIso: "SV" }).success).toBe(false);
  });
});
