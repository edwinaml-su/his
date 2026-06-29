/**
 * Tests del schema Zod de Patient — validaciones de borde + superRefine
 * que delega en `validateIdentifier` (DUI/NIT/NIE).
 */
import { describe, it, expect } from "vitest";
import {
  patientCreateSchema,
  patientUpdateSchema,
  patientIdentifierSchema,
  patientAllergySchema,
  patientSearchSchema,
  mergeFieldKeys,
} from "../patient";
import { VALID_DUIS, INVALID_DUIS } from "@his/test-utils/fixtures/dui";

// DUI válido fixture conocido para pruebas CC-0002.
const VALID_DUI_CC = VALID_DUIS[0]!;

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

  it("rechaza isUnknown=true sin birthDate (CC-0002: birthDate es requerida para generar expediente)", () => {
    // CC-0002 §6: birthDate es requerida para derivar el AA del expediente.
    // Los pacientes NN deben registrarse con la fecha estimada más cercana posible.
    const r = patientCreateSchema.safeParse({
      mrn: "NN-0001",
      firstName: "Desconocido",
      lastName: "NN",
      biologicalSexId: baseUuid,
      isUnknown: true,
    });
    expect(r.success).toBe(false);
  });

  it("rechaza mrn que excede 40 caracteres", () => {
    const r = patientCreateSchema.safeParse({ ...valid, mrn: "M".repeat(41) });
    expect(r.success).toBe(false);
  });

  // CC-0008 §6: mrn ya no se captura en pre-registro (se autogenera server-side).
  it("acepta input sin mrn (autogenerado server-side)", () => {
    const { mrn: _mrn, ...sinMrn } = valid;
    const r = patientCreateSchema.safeParse(sinMrn);
    expect(r.success).toBe(true);
  });

  // CC-0008 §6: nombres/apellidos extendidos + switch trae documento.
  it("acepta tercer nombre y apellido de casada", () => {
    const r = patientCreateSchema.safeParse({
      ...valid,
      thirdName: "Lucía",
      marriedLastName: "de Pérez",
    });
    expect(r.success).toBe(true);
  });

  it("traeDocumento aplica default true cuando se omite", () => {
    const r = patientCreateSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.traeDocumento).toBe(true);
  });

  it("acepta traeDocumento=false (paciente sin documento)", () => {
    const { mrn: _mrn, ...sinMrn } = valid;
    const r = patientCreateSchema.safeParse({ ...sinMrn, traeDocumento: false });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.traeDocumento).toBe(false);
  });

  it("documentType ausente → pasa (opcional)", () => {
    const r = patientCreateSchema.safeParse(valid);
    expect(r.success).toBe(true);
  });

  // CC-0002 §5/§10 — documento propio (DUI/DNI/PASAPORTE)
  it("DUI propio con documentNumber inválido → falla superRefine", () => {
    const r = patientCreateSchema.safeParse({
      ...valid,
      documentType: "DUI",
      documentNumber: INVALID_DUIS.badCheck,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.includes("documentNumber"))).toBe(true);
    }
  });

  it("DUI propio con documentNumber válido → pasa", () => {
    const r = patientCreateSchema.safeParse({
      ...valid,
      documentType: "DUI",
      documentNumber: VALID_DUI_CC,
    });
    expect(r.success).toBe(true);
  });

  it("documento propio (DNI) sin documentNumber → falla superRefine", () => {
    const r = patientCreateSchema.safeParse({ ...valid, documentType: "DNI" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.includes("documentNumber"))).toBe(true);
    }
  });

  // CC-0002 §10 — DUI_RESP
  it("DUI_RESP sin responsable → falla superRefine", () => {
    const r = patientCreateSchema.safeParse({ ...valid, documentType: "DUI_RESP" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.includes("responsable"))).toBe(true);
    }
  });

  it("DUI_RESP con responsable y paciente menor → pasa", () => {
    const birthDateReciente = new Date();
    birthDateReciente.setFullYear(birthDateReciente.getFullYear() - 5);
    const r = patientCreateSchema.safeParse({
      ...valid,
      birthDate: birthDateReciente.toISOString(),
      documentType: "DUI_RESP",
      responsable: { nombre: "Maria Lopez", parentesco: "madre", dui: VALID_DUI_CC },
    });
    expect(r.success).toBe(true);
  });

  it("DUI_RESP con paciente mayor de edad (1980) → falla superRefine", () => {
    const r = patientCreateSchema.safeParse({
      ...valid,
      birthDate: "1980-01-01",
      documentType: "DUI_RESP",
      responsable: { nombre: "Maria Lopez", parentesco: "madre", dui: VALID_DUI_CC },
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.includes("documentType"))).toBe(true);
    }
  });
});

// =============================================================================
// CC-0002 §6 / §14 Esc. 5 — Inmutabilidad del expediente en update.
// El expediente no forma parte de patientUpdateSchema, por lo que no puede
// modificarse via tRPC patient.update. La garantía SQL (trigger/SECDEF) aplica
// a nivel de BD; aquí verificamos la barrera en capa TS.
// =============================================================================

describe("patientUpdateSchema — expediente excluido (§14 Esc. 5)", () => {
  const baseUpdate = {
    id: "00000000-0000-0000-0000-000000000001",
    firstName: "Ana",
  };

  it("acepta update válido sin expediente", () => {
    const r = patientUpdateSchema.safeParse(baseUpdate);
    expect(r.success).toBe(true);
  });

  it("no expone 'expediente' en mergeFieldKeys (campo inmutable excluido de merge)", () => {
    // Si expediente apareciera en mergeFieldKeys significaría que puede
    // sobrescribirse durante el merge de duplicados — eso violaría §6.
    expect(mergeFieldKeys).not.toContain("expediente");
  });

  it("un input con expediente pasa el parse porque Zod lo ignora (campo desconocido → strip)", () => {
    // patientUpdateSchema usa .strict() SOLO si está configurado; por defecto Zod
    // hace strip de campos no declarados. El expediente llega al router pero
    // NO se incluye en el spread del data → no se escribe en BD.
    const r = patientUpdateSchema.safeParse({ ...baseUpdate, expediente: "SV9999999" });
    expect(r.success).toBe(true);
    if (r.success) {
      // El campo expediente NO debe aparecer en los datos parseados.
      expect("expediente" in r.data).toBe(false);
    }
  });

  it("tipo TS de patientUpdateSchema no incluye expediente (inferencia)", () => {
    // Aserciones de tipos en tiempo de ejecución no son directamente verificables,
    // pero confirmamos que el valor parseado solo contiene los campos esperados.
    const r = patientUpdateSchema.safeParse({ id: "00000000-0000-0000-0000-000000000001" });
    if (r.success) {
      const keys = Object.keys(r.data);
      expect(keys).not.toContain("expediente");
    }
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
