/**
 * Tests del schema Zod de Patient — validaciones de borde + superRefine
 * que delega en `validateIdentifier` (DUI/NIT/NIE).
 */
import { describe, it, expect } from "vitest";
import {
  patientCreateSchema,
  patientIdentifierSchema,
  patientAllergySchema,
  patientSearchSchema,
} from "../patient";
import { VALID_DUIS, INVALID_DUIS } from "@his/test-utils/fixtures/dui";

const baseUuid = "00000000-0000-0000-0000-000000000001";

describe("patientCreateSchema", () => {
  const valid = {
    mrn: "MRN-0001",
    firstName: "Ana",
    lastName: "Pérez",
    biologicalSexId: baseUuid,
    birthDate: "1990-01-01",
  };

  it("acepta input mínimo válido", () => {
    expect(patientCreateSchema.safeParse(valid).success).toBe(true);
  });

  it("rechaza firstName vacío", () => {
    const r = patientCreateSchema.safeParse({ ...valid, firstName: "" });
    expect(r.success).toBe(false);
  });

  it("rechaza biologicalSexId no-UUID", () => {
    const r = patientCreateSchema.safeParse({ ...valid, biologicalSexId: "not-a-uuid" });
    expect(r.success).toBe(false);
  });

  it("acepta birthDate como string ISO (coerce.date)", () => {
    const r = patientCreateSchema.safeParse({ ...valid, birthDate: "1985-06-15" });
    expect(r.success).toBe(true);
  });

  it("acepta isUnknown=true sin birthDate (NN/desconocido)", () => {
    const r = patientCreateSchema.safeParse({
      mrn: "NN-0001",
      firstName: "Desconocido",
      lastName: "NN",
      biologicalSexId: baseUuid,
      isUnknown: true,
    });
    expect(r.success).toBe(true);
  });

  it("rechaza mrn que excede 40 caracteres", () => {
    const r = patientCreateSchema.safeParse({ ...valid, mrn: "M".repeat(41) });
    expect(r.success).toBe(false);
  });
});

describe("patientIdentifierSchema — superRefine sobre validateIdentifier", () => {
  const base = {
    identifierTypeId: baseUuid,
    isPrimary: true,
  };

  it("acepta DUI válido", () => {
    const r = patientIdentifierSchema.safeParse({
      ...base,
      kind: "DUI",
      value: VALID_DUIS[0],
    });
    expect(r.success).toBe(true);
  });

  it("rechaza DUI con verificador incorrecto", () => {
    const r = patientIdentifierSchema.safeParse({
      ...base,
      kind: "DUI",
      value: INVALID_DUIS.badCheck,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.path).toContain("value");
    }
  });

  it("rechaza DUI demasiado corto", () => {
    const r = patientIdentifierSchema.safeParse({
      ...base,
      kind: "DUI",
      value: "12345",
    });
    expect(r.success).toBe(false);
  });

  it("rechaza kind inválido", () => {
    const r = patientIdentifierSchema.safeParse({
      ...base,
      kind: "FOO",
      value: "X",
    });
    expect(r.success).toBe(false);
  });
});

describe("patientAllergySchema", () => {
  it("acepta severidad válida", () => {
    const r = patientAllergySchema.safeParse({
      substanceText: "Penicilina",
      severity: "severe",
      verified: true,
    });
    expect(r.success).toBe(true);
  });

  it("rechaza severidad fuera del enum", () => {
    const r = patientAllergySchema.safeParse({
      substanceText: "Penicilina",
      severity: "extremely-severe",
    });
    expect(r.success).toBe(false);
  });
});

describe("patientSearchSchema", () => {
  it("normaliza query con trim", () => {
    const r = patientSearchSchema.safeParse({ query: "  María  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.query).toBe("María");
  });

  it("rechaza query vacío tras trim", () => {
    const r = patientSearchSchema.safeParse({ query: "   " });
    expect(r.success).toBe(false);
  });

  it("usa limit por defecto 20", () => {
    const r = patientSearchSchema.safeParse({ query: "abc" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(20);
  });

  it("rechaza limit > 50", () => {
    const r = patientSearchSchema.safeParse({ query: "abc", limit: 51 });
    expect(r.success).toBe(false);
  });
});
