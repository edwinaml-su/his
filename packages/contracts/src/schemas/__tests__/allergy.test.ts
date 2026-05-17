/**
 * Tests de schemas de alergias (US-4.7).
 */
import { describe, it, expect } from "vitest";
import {
  allergySeverityEnum,
  allergyManifestationEnum,
  allergyStatusEnum,
  allergyConfidenceEnum,
  allergyCreateInput,
  allergyUpdateInput,
  allergyByPatientInput,
  allergyResolveInput,
} from "../allergy";

const u = "00000000-0000-0000-0000-000000000001";

describe("allergySeverityEnum", () => {
  it.each(["mild", "moderate", "severe", "life-threatening"])("acepta %s", (s) => {
    expect(allergySeverityEnum.safeParse(s).success).toBe(true);
  });
  it("rechaza valor desconocido", () => {
    expect(allergySeverityEnum.safeParse("critical").success).toBe(false);
  });
});

describe("allergyManifestationEnum", () => {
  it.each(["rash", "urticaria", "anaphylaxis", "other"])("acepta %s", (m) => {
    expect(allergyManifestationEnum.safeParse(m).success).toBe(true);
  });
  it("rechaza manifestacion desconocida", () => {
    expect(allergyManifestationEnum.safeParse("fever").success).toBe(false);
  });
});

describe("allergyStatusEnum", () => {
  it.each(["ACTIVE", "INACTIVE", "RESOLVED"])("acepta %s", (s) => {
    expect(allergyStatusEnum.safeParse(s).success).toBe(true);
  });
});

describe("allergyConfidenceEnum", () => {
  it.each(["CONFIRMED", "SUSPECTED", "REFUTED"])("acepta %s", (c) => {
    expect(allergyConfidenceEnum.safeParse(c).success).toBe(true);
  });
});

describe("allergyCreateInput", () => {
  const VALID = {
    patientId: u,
    substanceText: "Penicilina",
    severity: "moderate",
  };

  it("acepta input minimo valido", () => {
    expect(allergyCreateInput.safeParse(VALID).success).toBe(true);
  });

  it("acepta campos opcionales completos", () => {
    const full = {
      ...VALID,
      substanceConceptId: u,
      reaction: "Urticaria generalizada",
      clinicalManifestation: "urticaria",
      status: "ACTIVE",
      confidence: "CONFIRMED",
      onsetDate: new Date("2024-01-01"),
      lastReactionDate: new Date("2024-06-01"),
      verified: true,
    };
    expect(allergyCreateInput.safeParse(full).success).toBe(true);
  });

  it("rechaza patientId no-uuid", () => {
    expect(allergyCreateInput.safeParse({ ...VALID, patientId: "bad" }).success).toBe(false);
  });

  it("rechaza substanceText vacio", () => {
    expect(allergyCreateInput.safeParse({ ...VALID, substanceText: "" }).success).toBe(false);
  });

  it("rechaza severity invalida", () => {
    expect(allergyCreateInput.safeParse({ ...VALID, severity: "extreme" }).success).toBe(false);
  });
});

describe("allergyUpdateInput", () => {
  it("acepta actualizacion parcial", () => {
    expect(allergyUpdateInput.safeParse({ id: u, severity: "severe" }).success).toBe(true);
  });

  it("rechaza id no-uuid", () => {
    expect(allergyUpdateInput.safeParse({ id: "bad" }).success).toBe(false);
  });
});

describe("allergyByPatientInput", () => {
  it("acepta patientId UUID", () => {
    expect(allergyByPatientInput.safeParse({ patientId: u }).success).toBe(true);
  });

  it("rechaza patientId no-uuid", () => {
    expect(allergyByPatientInput.safeParse({ patientId: "bad" }).success).toBe(false);
  });
});

describe("allergyResolveInput", () => {
  it("acepta id UUID", () => {
    expect(allergyResolveInput.safeParse({ id: u }).success).toBe(true);
  });

  it("rechaza id no-uuid", () => {
    expect(allergyResolveInput.safeParse({ id: "bad" }).success).toBe(false);
  });
});
