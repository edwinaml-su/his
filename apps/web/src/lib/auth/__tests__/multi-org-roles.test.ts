/**
 * Tests unitarios para apps/web/src/lib/auth/multi-org-roles.ts.
 *
 * CC-B (directriz Edwin 2026-09-19) — agrega SUPER_ADMIN/CONTRALOR_CORP/
 * DIR_PAIS a los roles con visibilidad multi-organización (switcher cross-org
 * vía cookie `his.orgs`).
 */
import { describe, it, expect } from "vitest";
import { MULTI_ORG_ROLE_CODES, hasMultiOrgRole } from "../multi-org-roles";

describe("MULTI_ORG_ROLE_CODES", () => {
  it("incluye los 4 roles originales", () => {
    expect(MULTI_ORG_ROLE_CODES).toEqual(
      expect.arrayContaining(["DIR", "ADM", "JEFE", "GERENTE"]),
    );
  });

  it("incluye los 3 roles corporativos nuevos (CC-B)", () => {
    expect(MULTI_ORG_ROLE_CODES).toEqual(
      expect.arrayContaining(["SUPER_ADMIN", "CONTRALOR_CORP", "DIR_PAIS"]),
    );
  });
});

describe("hasMultiOrgRole", () => {
  it("retorna true para SUPER_ADMIN", () => {
    expect(hasMultiOrgRole(["SUPER_ADMIN"])).toBe(true);
  });

  it("retorna true para CONTRALOR_CORP", () => {
    expect(hasMultiOrgRole(["CONTRALOR_CORP"])).toBe(true);
  });

  it("retorna true para DIR_PAIS", () => {
    expect(hasMultiOrgRole(["DIR_PAIS"])).toBe(true);
  });

  it("retorna true si el usuario tiene un rol multi-org entre varios", () => {
    expect(hasMultiOrgRole(["NURSE", "DIR_PAIS"])).toBe(true);
  });

  it("retorna false para roles clínicos sin visibilidad cross-org", () => {
    expect(hasMultiOrgRole(["NURSE", "PHYSICIAN"])).toBe(false);
  });

  it("retorna false para lista vacía", () => {
    expect(hasMultiOrgRole([])).toBe(false);
  });
});
