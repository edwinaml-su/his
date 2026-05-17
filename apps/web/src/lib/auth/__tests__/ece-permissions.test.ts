/**
 * Tests unitarios — ece-permissions (apps/web).
 *
 * La cobertura completa de la lógica está en
 * packages/contracts/src/schemas/__tests__/ece-permissions.test.ts.
 * Aquí verificamos la implementación local de apps/web que no depende
 * del symlink de @his/contracts para typecheck.
 */
import { describe, it, expect } from "vitest";
import { hasEcePermission } from "../ece-permissions";

describe("hasEcePermission (apps/web local)", () => {
  it("ADMIN tiene permiso ece.documento.certificar", () => {
    expect(hasEcePermission("ece.documento.certificar", { roleCodes: ["ADMIN"] })).toBe(true);
  });

  it("NURSE no puede certificar", () => {
    expect(hasEcePermission("ece.documento.certificar", { roleCodes: ["NURSE"] })).toBe(false);
  });

  it("NURSE puede firmar", () => {
    expect(hasEcePermission("ece.documento.firmar", { roleCodes: ["NURSE"] })).toBe(true);
  });
});
