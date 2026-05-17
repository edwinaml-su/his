/**
 * Tests unitarios — hasEcePermission (ece-permissions.ts).
 *
 * Sin BD, sin fetch. Lógica pura de mapeo rol → permiso ECE.
 *
 * Cobertura:
 *   - ADMIN tiene acceso total (bypass).
 *   - DIR tiene acceso a: certificar, anular, bitacora.read, rectificacion.aprobar,
 *     workflow.designer. NO tiene: firmar, validar, rectificacion.solicitar.
 *   - PHYSICIAN puede: firmar, validar, rectificacion.solicitar. NO puede lo de DIR.
 *   - NURSE puede: firmar, rectificacion.solicitar. NO puede: validar, certificar.
 *   - ARCH puede: bitacora.read. No puede certificar ni firmar.
 *   - ESP puede: firmar. No puede validar ni certificar.
 *   - Usuario sin rol específico → deniega todo.
 *   - Alias ECE: MC, MT equivalen a PHYSICIAN; ENF equivale a NURSE.
 */
import { describe, it, expect } from "vitest";
import { hasEcePermission, type EcePermission } from "../ece-permissions";

// Helper para reducir repetición en los tests.
function can(roleCodes: string[], perm: EcePermission) {
  return hasEcePermission(perm, { roleCodes });
}

describe("hasEcePermission", () => {
  // --- ADMIN: bypass total ---
  describe("ADMIN", () => {
    const roles = ["ADMIN"];

    it("tiene acceso a todos los permisos ECE", () => {
      const perms: EcePermission[] = [
        "ece.documento.firmar",
        "ece.documento.validar",
        "ece.documento.certificar",
        "ece.documento.anular",
        "ece.bitacora.read",
        "ece.rectificacion.solicitar",
        "ece.rectificacion.aprobar",
        "ece.workflow.designer",
      ];
      for (const p of perms) {
        expect(can(roles, p), `ADMIN debe tener ${p}`).toBe(true);
      }
    });

    it("admin_clinico (alias español) también tiene bypass", () => {
      expect(can(["admin_clinico"], "ece.documento.certificar")).toBe(true);
    });
  });

  // --- DIR ---
  describe("DIR", () => {
    const roles = ["DIR"];

    it("puede certificar documentos (Art. 21 NTEC)", () => {
      expect(can(roles, "ece.documento.certificar")).toBe(true);
    });

    it("puede anular documentos", () => {
      expect(can(roles, "ece.documento.anular")).toBe(true);
    });

    it("puede leer la bitácora (Arts. 45-52 NTEC)", () => {
      expect(can(roles, "ece.bitacora.read")).toBe(true);
    });

    it("puede aprobar rectificaciones (Art. 41 NTEC)", () => {
      expect(can(roles, "ece.rectificacion.aprobar")).toBe(true);
    });

    it("puede diseñar workflows ECE", () => {
      expect(can(roles, "ece.workflow.designer")).toBe(true);
    });

    it("NO puede firmar documentos (separación de funciones)", () => {
      expect(can(roles, "ece.documento.firmar")).toBe(false);
    });

    it("NO puede validar documentos", () => {
      expect(can(roles, "ece.documento.validar")).toBe(false);
    });

    it("NO puede solicitar rectificaciones", () => {
      expect(can(roles, "ece.rectificacion.solicitar")).toBe(false);
    });
  });

  // --- PHYSICIAN ---
  describe("PHYSICIAN", () => {
    const roles = ["PHYSICIAN"];

    it("puede firmar documentos", () => {
      expect(can(roles, "ece.documento.firmar")).toBe(true);
    });

    it("puede validar documentos", () => {
      expect(can(roles, "ece.documento.validar")).toBe(true);
    });

    it("puede solicitar rectificaciones", () => {
      expect(can(roles, "ece.rectificacion.solicitar")).toBe(true);
    });

    it("NO puede certificar (solo DIR)", () => {
      expect(can(roles, "ece.documento.certificar")).toBe(false);
    });

    it("NO puede aprobar rectificaciones (solo DIR)", () => {
      expect(can(roles, "ece.rectificacion.aprobar")).toBe(false);
    });

    it("NO puede leer bitácora (solo DIR/ARCH)", () => {
      expect(can(roles, "ece.bitacora.read")).toBe(false);
    });
  });

  // --- NURSE ---
  describe("NURSE", () => {
    const roles = ["NURSE"];

    it("puede firmar documentos (signos vitales / enfermería)", () => {
      expect(can(roles, "ece.documento.firmar")).toBe(true);
    });

    it("puede solicitar rectificaciones", () => {
      expect(can(roles, "ece.rectificacion.solicitar")).toBe(true);
    });

    it("NO puede validar documentos (solo médicos)", () => {
      expect(can(roles, "ece.documento.validar")).toBe(false);
    });

    it("NO puede certificar", () => {
      expect(can(roles, "ece.documento.certificar")).toBe(false);
    });
  });

  // --- ARCH ---
  describe("ARCH (Archivo Clínico)", () => {
    it("puede leer la bitácora", () => {
      expect(can(["ARCH"], "ece.bitacora.read")).toBe(true);
    });

    it("NO puede certificar ni firmar", () => {
      expect(can(["ARCH"], "ece.documento.certificar")).toBe(false);
      expect(can(["ARCH"], "ece.documento.firmar")).toBe(false);
    });
  });

  // --- ESP ---
  describe("ESP (Especialista)", () => {
    it("puede firmar documentos (quirúrgicos / obstétricos)", () => {
      expect(can(["ESP"], "ece.documento.firmar")).toBe(true);
    });

    it("NO puede validar ni certificar", () => {
      expect(can(["ESP"], "ece.documento.validar")).toBe(false);
      expect(can(["ESP"], "ece.documento.certificar")).toBe(false);
    });
  });

  // --- Alias ECE (MC, MT, ENF) ---
  describe("Aliases de roles ECE (ece.rol)", () => {
    it("MC (médico cirujano) equivale a PHYSICIAN para firmar", () => {
      expect(can(["MC"], "ece.documento.firmar")).toBe(true);
    });

    it("MT (médico técnico) puede validar como PHYSICIAN", () => {
      expect(can(["MT"], "ece.documento.validar")).toBe(true);
    });

    it("ENF equivale a NURSE para solicitar rectificación", () => {
      expect(can(["ENF"], "ece.rectificacion.solicitar")).toBe(true);
    });
  });

  // --- Sin rol / rol desconocido ---
  describe("Sin roles o rol desconocido", () => {
    it("usuario sin roles no puede hacer nada", () => {
      const perms: EcePermission[] = [
        "ece.documento.firmar",
        "ece.documento.certificar",
        "ece.bitacora.read",
        "ece.rectificacion.aprobar",
      ];
      for (const p of perms) {
        expect(can([], p), `Sin rol no debe poder ${p}`).toBe(false);
      }
    });

    it("rol PHARMACIST no tiene permisos ECE", () => {
      expect(can(["PHARMACIST"], "ece.documento.firmar")).toBe(false);
    });
  });

  // --- Combinación de roles ---
  describe("Combinación de roles", () => {
    it("usuario con PHYSICIAN + DIR tiene acceso completo", () => {
      const roles = ["PHYSICIAN", "DIR"];
      expect(can(roles, "ece.documento.firmar")).toBe(true);
      expect(can(roles, "ece.documento.certificar")).toBe(true);
      expect(can(roles, "ece.rectificacion.aprobar")).toBe(true);
    });

    it("usuario con NURSE + ARCH puede firmar y leer bitácora", () => {
      const roles = ["NURSE", "ARCH"];
      expect(can(roles, "ece.documento.firmar")).toBe(true);
      expect(can(roles, "ece.bitacora.read")).toBe(true);
      expect(can(roles, "ece.documento.certificar")).toBe(false);
    });
  });
});
