/**
 * Tests unitarios para apps/web/src/lib/auth/abac.ts (US-2.4).
 *
 * Sin BD, sin fetch. Solo lógica pura de control de acceso basada en atributos.
 *
 * Comportamientos subtiles documentados:
 *  - `active` = undefined se trata como activo (solo `!== false` deniega).
 *  - ADMIN no puede prescribir ni dispensar (separación de funciones TDR §6.2).
 *  - TRIAGE_NURSE solo ve pacientes con `hasActiveTriage === true` (boolean
 *    estricto; undefined/false deniega).
 *  - `canAccessService` es MVP-permisiva: cualquier usuario activo en la org
 *    accede; el parámetro `_serviceUnitId` se ignora hasta Sprint 2.
 *  - Rol aliases inglés/español son equivalentes: "medico" == "PHYSICIAN",
 *    "enfermeria" == "NURSE", etc.
 */
import { describe, it, expect } from "vitest";
import {
  canAccessPatient,
  canPrescribe,
  canDispense,
  canAccessService,
  canSign,
  MVP_ABAC_RULES,
  type AbacUser,
  type AbacPatient,
} from "../abac";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_A = "00000000-0000-0000-0000-0000000000aa";
const ORG_B = "00000000-0000-0000-0000-0000000000bb";

function user(roleCodes: string[], org = ORG_A, active?: boolean): AbacUser {
  return { id: "u1", organizationId: org, roleCodes, active };
}

function patient(org = ORG_A, hasActiveTriage?: boolean): AbacPatient {
  return { id: "p1", organizationId: org, hasActiveTriage };
}

// ---------------------------------------------------------------------------
// canAccessPatient
// ---------------------------------------------------------------------------

describe("canAccessPatient", () => {
  it("ADMIN puede ver cualquier paciente de su org", () => {
    expect(canAccessPatient(user(["admin_clinico"]), patient())).toBe(true);
  });

  it("super_admin puede ver paciente de cualquier org", () => {
    // ADMIN bypass no requiere sameOrg
    expect(canAccessPatient(user(["super_admin"]), patient(ORG_B))).toBe(true);
  });

  it("alias ADMIN (inglés) es equivalente a super_admin", () => {
    expect(canAccessPatient(user(["ADMIN"]), patient(ORG_B))).toBe(true);
  });

  it("PHYSICIAN puede ver paciente de la misma org", () => {
    expect(canAccessPatient(user(["medico"]), patient())).toBe(true);
  });

  it("PHYSICIAN alias inglés funciona", () => {
    expect(canAccessPatient(user(["PHYSICIAN"]), patient())).toBe(true);
  });

  it("PHYSICIAN deniega paciente de otra org", () => {
    expect(canAccessPatient(user(["medico"]), patient(ORG_B))).toBe(false);
  });

  it("NURSE puede ver paciente de la misma org", () => {
    expect(canAccessPatient(user(["enfermeria"]), patient())).toBe(true);
  });

  it("NURSE alias inglés funciona", () => {
    expect(canAccessPatient(user(["NURSE"]), patient())).toBe(true);
  });

  it("NURSE deniega paciente de otra org", () => {
    expect(canAccessPatient(user(["enfermeria"]), patient(ORG_B))).toBe(false);
  });

  it("TRIAGE_NURSE permite con triage activo en misma org", () => {
    expect(canAccessPatient(user(["triador"]), patient(ORG_A, true))).toBe(true);
  });

  it("TRIAGE_NURSE alias inglés funciona", () => {
    expect(canAccessPatient(user(["TRIAGE_NURSE"]), patient(ORG_A, true))).toBe(true);
  });

  it("TRIAGE_NURSE deniega si hasActiveTriage es false", () => {
    expect(canAccessPatient(user(["triador"]), patient(ORG_A, false))).toBe(false);
  });

  it("TRIAGE_NURSE deniega si hasActiveTriage es undefined", () => {
    expect(canAccessPatient(user(["triador"]), patient(ORG_A, undefined))).toBe(false);
  });

  it("TRIAGE_NURSE deniega aunque triage activo si es otra org", () => {
    expect(canAccessPatient(user(["triador"]), patient(ORG_B, true))).toBe(false);
  });

  it("usuario sin rol conocido → DENY", () => {
    expect(canAccessPatient(user(["lectura"]), patient())).toBe(false);
  });

  it("usuario sin roles → DENY", () => {
    expect(canAccessPatient(user([]), patient())).toBe(false);
  });

  it("usuario inactivo (active=false) → DENY aunque sea ADMIN", () => {
    expect(canAccessPatient(user(["super_admin", "admin_clinico"], ORG_A, false), patient())).toBe(false);
  });

  it("active=undefined se trata como activo", () => {
    // El campo active es opcional; ausente = activo
    expect(canAccessPatient(user(["medico"], ORG_A, undefined), patient())).toBe(true);
  });

  it("combinación rol + org: PHYSICIAN en ORG_B ve paciente ORG_B", () => {
    expect(canAccessPatient(user(["medico"], ORG_B), patient(ORG_B))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// canPrescribe
// ---------------------------------------------------------------------------

describe("canPrescribe", () => {
  it("PHYSICIAN en misma org puede prescribir", () => {
    expect(canPrescribe(user(["medico"]), patient())).toBe(true);
  });

  it("PHYSICIAN alias inglés puede prescribir", () => {
    expect(canPrescribe(user(["PHYSICIAN"]), patient())).toBe(true);
  });

  it("PHYSICIAN en otra org → DENY", () => {
    expect(canPrescribe(user(["medico"]), patient(ORG_B))).toBe(false);
  });

  it("ADMIN no puede prescribir (separación TDR §6.2)", () => {
    expect(canPrescribe(user(["super_admin"]), patient())).toBe(false);
  });

  it("NURSE no puede prescribir", () => {
    expect(canPrescribe(user(["enfermeria"]), patient())).toBe(false);
  });

  it("usuario inactivo → DENY", () => {
    expect(canPrescribe(user(["medico"], ORG_A, false), patient())).toBe(false);
  });

  it("sin roles → DENY", () => {
    expect(canPrescribe(user([]), patient())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canDispense
// ---------------------------------------------------------------------------

describe("canDispense", () => {
  it("PHARMACIST en misma org puede dispensar", () => {
    expect(canDispense(user(["farmaceutico"]), patient())).toBe(true);
  });

  it("PHARMACIST alias inglés puede dispensar", () => {
    expect(canDispense(user(["PHARMACIST"]), patient())).toBe(true);
  });

  it("PHARMACIST en otra org → DENY", () => {
    expect(canDispense(user(["farmaceutico"]), patient(ORG_B))).toBe(false);
  });

  it("PHYSICIAN no puede dispensar (separación TDR §6.2)", () => {
    expect(canDispense(user(["medico"]), patient())).toBe(false);
  });

  it("ADMIN no puede dispensar", () => {
    expect(canDispense(user(["super_admin"]), patient())).toBe(false);
  });

  it("usuario inactivo → DENY", () => {
    expect(canDispense(user(["farmaceutico"], ORG_A, false), patient())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canAccessService
// ---------------------------------------------------------------------------

describe("canAccessService", () => {
  it("usuario activo en misma org puede acceder a unidad de servicio", () => {
    expect(canAccessService(user(["medico"]), ORG_A, "su-1")).toBe(true);
  });

  it("usuario activo en otra org → DENY", () => {
    expect(canAccessService(user(["medico"]), ORG_B, "su-1")).toBe(false);
  });

  it("usuario inactivo → DENY", () => {
    expect(canAccessService(user(["medico"], ORG_A, false), ORG_A, "su-1")).toBe(false);
  });

  it("rol sin importar: cualquier rol activo en la org accede (MVP)", () => {
    // MVP no filtra por rol en canAccessService
    expect(canAccessService(user(["lectura"]), ORG_A, "su-1")).toBe(true);
  });

  it("sin roles pero activo en la org → ALLOW (MVP)", () => {
    expect(canAccessService(user([]), ORG_A, "su-1")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// canSign
// ---------------------------------------------------------------------------

describe("canSign", () => {
  it("PHYSICIAN en misma org puede firmar", () => {
    expect(canSign(user(["medico"]), patient())).toBe(true);
  });

  it("PHYSICIAN alias inglés puede firmar", () => {
    expect(canSign(user(["PHYSICIAN"]), patient())).toBe(true);
  });

  it("PHYSICIAN en otra org → DENY", () => {
    expect(canSign(user(["medico"]), patient(ORG_B))).toBe(false);
  });

  it("ADMIN no puede firmar asistencialmente", () => {
    expect(canSign(user(["super_admin"]), patient())).toBe(false);
  });

  it("NURSE no puede firmar", () => {
    expect(canSign(user(["enfermeria"]), patient())).toBe(false);
  });

  it("usuario inactivo → DENY", () => {
    expect(canSign(user(["medico"], ORG_A, false), patient())).toBe(false);
  });

  it("sin roles → DENY", () => {
    expect(canSign(user([]), patient())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MVP_ABAC_RULES — integridad estructural
// ---------------------------------------------------------------------------

describe("MVP_ABAC_RULES", () => {
  it("contiene al menos 7 reglas declarativas", () => {
    expect(MVP_ABAC_RULES.length).toBeGreaterThanOrEqual(7);
  });

  it("todas las reglas tienen id, action, resourceKind, allowedRoles, condition, description", () => {
    for (const rule of MVP_ABAC_RULES) {
      expect(rule.id).toBeTruthy();
      expect(rule.action).toBeTruthy();
      expect(rule.resourceKind).toBeTruthy();
      expect(Array.isArray(rule.allowedRoles)).toBe(true);
      expect(rule.condition).toBeTruthy();
      expect(rule.description).toBeTruthy();
    }
  });

  it("ids son únicos", () => {
    const ids = MVP_ABAC_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("existe regla PRESCRIBE solo para médico", () => {
    const prescribeRule = MVP_ABAC_RULES.find((r) => r.action === "PRESCRIBE");
    expect(prescribeRule).toBeDefined();
    expect(prescribeRule!.allowedRoles).toContain("medico");
    expect(prescribeRule!.allowedRoles).not.toContain("super_admin");
  });

  it("existe regla DISPENSE solo para farmacéutico", () => {
    const dispenseRule = MVP_ABAC_RULES.find((r) => r.action === "DISPENSE");
    expect(dispenseRule).toBeDefined();
    expect(dispenseRule!.allowedRoles).toContain("farmaceutico");
  });

  it("existe regla SIGN para médico", () => {
    const signRule = MVP_ABAC_RULES.find((r) => r.action === "SIGN");
    expect(signRule).toBeDefined();
    expect(signRule!.allowedRoles).toContain("medico");
  });
});
