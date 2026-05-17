/**
 * Tests unitarios — useEcePermissions hook.
 *
 * Ambiente: jsdom (vitest). Se usa renderHook de @testing-library/react
 * para ejercitar el hook con distintos arrays de roleCodes.
 *
 * Comportamientos cubiertos:
 *  - Mapa de permisos correcto para ADMIN (bypass total).
 *  - PHYSICIAN: canFirmar, canValidar, canSolicitarRectificacion true;
 *    canCertificar, canAprobarRectificacion, canDesignWorkflow false.
 *  - NURSE: canFirmar, canSolicitar true; canValidar false.
 *  - DIR: canCertificar, canAnular, canReadBitacora, canAprobar, canDesign true;
 *    canFirmar false.
 *  - ARCH: solo canReadBitacora true.
 *  - ESP: canFirmar true, resto false excepto ADMIN bypass.
 *  - roleCodes vacío → todo false.
 *  - Roles stream #16 (IC, AC, ADM) → todo false.
 *  - Alias MC, MT, ENF resueltos.
 *  - Helper genérico `can(permission)` funciona igual que los atajos.
 *  - Memoización: referencia estable cuando roleCodes no cambia.
 *  - Memoización: resultado nuevo cuando roleCodes cambia.
 */
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useEcePermissions } from "../use-ece-permissions";
import type { EcePermission } from "@/lib/auth/ece-permissions";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function render(roles: string[]) {
  return renderHook(() => useEcePermissions(roles)).result.current;
}

const ALL_PERMS: EcePermission[] = [
  "ece.documento.firmar",
  "ece.documento.validar",
  "ece.documento.certificar",
  "ece.documento.anular",
  "ece.bitacora.read",
  "ece.rectificacion.solicitar",
  "ece.rectificacion.aprobar",
  "ece.workflow.designer",
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useEcePermissions", () => {
  // --- ADMIN bypass ---
  describe("ADMIN — bypass total", () => {
    it("todos los atajos de permiso son true", () => {
      const p = render(["ADMIN"]);
      expect(p.canFirmar).toBe(true);
      expect(p.canValidar).toBe(true);
      expect(p.canCertificar).toBe(true);
      expect(p.canAnular).toBe(true);
      expect(p.canReadBitacora).toBe(true);
      expect(p.canSolicitarRectificacion).toBe(true);
      expect(p.canAprobarRectificacion).toBe(true);
      expect(p.canDesignWorkflow).toBe(true);
    });

    it("helper can() retorna true para cualquier permiso ECE", () => {
      const p = render(["ADMIN"]);
      for (const perm of ALL_PERMS) {
        expect(p.can(perm), `ADMIN debe poder ${perm}`).toBe(true);
      }
    });

    it("super_admin también tiene bypass total", () => {
      const p = render(["super_admin"]);
      expect(p.canCertificar).toBe(true);
      expect(p.canDesignWorkflow).toBe(true);
    });
  });

  // --- PHYSICIAN ---
  describe("PHYSICIAN", () => {
    it("puede firmar, validar y solicitar rectificación", () => {
      const p = render(["PHYSICIAN"]);
      expect(p.canFirmar).toBe(true);
      expect(p.canValidar).toBe(true);
      expect(p.canSolicitarRectificacion).toBe(true);
    });

    it("NO puede certificar, anular, leer bitácora, aprobar ni diseñar", () => {
      const p = render(["PHYSICIAN"]);
      expect(p.canCertificar).toBe(false);
      expect(p.canAnular).toBe(false);
      expect(p.canReadBitacora).toBe(false);
      expect(p.canAprobarRectificacion).toBe(false);
      expect(p.canDesignWorkflow).toBe(false);
    });
  });

  // --- NURSE ---
  describe("NURSE", () => {
    it("puede firmar y solicitar rectificación", () => {
      const p = render(["NURSE"]);
      expect(p.canFirmar).toBe(true);
      expect(p.canSolicitarRectificacion).toBe(true);
    });

    it("NO puede validar ni certificar", () => {
      const p = render(["NURSE"]);
      expect(p.canValidar).toBe(false);
      expect(p.canCertificar).toBe(false);
    });
  });

  // --- DIR ---
  describe("DIR", () => {
    it("puede certificar, anular, leer bitácora, aprobar y diseñar", () => {
      const p = render(["DIR"]);
      expect(p.canCertificar).toBe(true);
      expect(p.canAnular).toBe(true);
      expect(p.canReadBitacora).toBe(true);
      expect(p.canAprobarRectificacion).toBe(true);
      expect(p.canDesignWorkflow).toBe(true);
    });

    it("NO puede firmar ni validar (separación de funciones)", () => {
      const p = render(["DIR"]);
      expect(p.canFirmar).toBe(false);
      expect(p.canValidar).toBe(false);
    });
  });

  // --- ARCH ---
  describe("ARCH (Archivo Clínico)", () => {
    it("solo puede leer la bitácora", () => {
      const p = render(["ARCH"]);
      expect(p.canReadBitacora).toBe(true);
      expect(p.canFirmar).toBe(false);
      expect(p.canCertificar).toBe(false);
      expect(p.canValidar).toBe(false);
      expect(p.canDesignWorkflow).toBe(false);
    });
  });

  // --- ESP ---
  describe("ESP (Especialista)", () => {
    it("puede firmar, no puede validar ni certificar", () => {
      const p = render(["ESP"]);
      expect(p.canFirmar).toBe(true);
      expect(p.canValidar).toBe(false);
      expect(p.canCertificar).toBe(false);
    });
  });

  // --- Aliases MC, MT, ENF ---
  describe("Aliases de roles ECE", () => {
    it("MC puede firmar y validar", () => {
      const p = render(["MC"]);
      expect(p.canFirmar).toBe(true);
      expect(p.canValidar).toBe(true);
    });

    it("MT puede firmar y validar (alias PHYSICIAN)", () => {
      const p = render(["MT"]);
      expect(p.canFirmar).toBe(true);
      expect(p.canValidar).toBe(true);
    });

    it("ENF puede firmar y solicitar rectificación (alias NURSE)", () => {
      const p = render(["ENF"]);
      expect(p.canFirmar).toBe(true);
      expect(p.canSolicitarRectificacion).toBe(true);
      expect(p.canValidar).toBe(false);
    });

    it("medico (alias español) resuelto igual que PHYSICIAN", () => {
      const p = render(["medico"]);
      expect(p.canFirmar).toBe(true);
      expect(p.canValidar).toBe(true);
      expect(p.canCertificar).toBe(false);
    });

    it("enfermeria (alias español) resuelto igual que NURSE", () => {
      const p = render(["enfermeria"]);
      expect(p.canFirmar).toBe(true);
      expect(p.canSolicitarRectificacion).toBe(true);
      expect(p.canValidar).toBe(false);
    });
  });

  // --- Roles stream #16 (IC, AC, ADM) ---
  describe("Roles auxiliares stream #16 — IC / AC / ADM", () => {
    it("IC → todo false", () => {
      const p = render(["IC"]);
      for (const perm of ALL_PERMS) {
        expect(p.can(perm), `IC no debe poder ${perm}`).toBe(false);
      }
    });

    it("AC → todo false", () => {
      const p = render(["AC"]);
      expect(p.canFirmar).toBe(false);
      expect(p.canCertificar).toBe(false);
      expect(p.canReadBitacora).toBe(false);
    });

    it("ADM → todo false", () => {
      const p = render(["ADM"]);
      expect(p.canFirmar).toBe(false);
      expect(p.canSolicitarRectificacion).toBe(false);
    });

    it("IC + MC puede firmar vía MC", () => {
      const p = render(["IC", "MC"]);
      expect(p.canFirmar).toBe(true);
      expect(p.canValidar).toBe(true);
    });
  });

  // --- roleCodes vacío / desconocido ---
  describe("roleCodes vacío o desconocido", () => {
    it("array vacío → todos los permisos false", () => {
      const p = render([]);
      for (const perm of ALL_PERMS) {
        expect(p.can(perm), `sin roles no debe poder ${perm}`).toBe(false);
      }
    });

    it("PHARMACIST no tiene permisos ECE", () => {
      const p = render(["PHARMACIST"]);
      expect(p.canFirmar).toBe(false);
      expect(p.canCertificar).toBe(false);
    });

    it("rol con espacios no coincide con alias válido", () => {
      const p = render([" ADMIN", "ADMIN "]);
      expect(p.canCertificar).toBe(false);
    });
  });

  // --- Combinaciones de roles ---
  describe("Combinaciones de roles", () => {
    it("NURSE + ARCH puede firmar y leer bitácora", () => {
      const p = render(["NURSE", "ARCH"]);
      expect(p.canFirmar).toBe(true);
      expect(p.canReadBitacora).toBe(true);
      expect(p.canCertificar).toBe(false);
    });

    it("PHYSICIAN + DIR tiene acceso a firmar y certificar", () => {
      const p = render(["PHYSICIAN", "DIR"]);
      expect(p.canFirmar).toBe(true);
      expect(p.canCertificar).toBe(true);
    });

    it("ESP + NURSE puede firmar; ninguno puede validar", () => {
      const p = render(["ESP", "NURSE"]);
      expect(p.canFirmar).toBe(true);
      expect(p.canValidar).toBe(false);
    });
  });

  // --- Helper genérico can() ---
  describe("Helper genérico can()", () => {
    it("can() es coherente con los atajos de nombre", () => {
      const p = render(["PHYSICIAN"]);
      expect(p.can("ece.documento.firmar")).toBe(p.canFirmar);
      expect(p.can("ece.documento.validar")).toBe(p.canValidar);
      expect(p.can("ece.documento.certificar")).toBe(p.canCertificar);
      expect(p.can("ece.rectificacion.solicitar")).toBe(p.canSolicitarRectificacion);
    });

    it("can() para DIR es coherente con atajos", () => {
      const p = render(["DIR"]);
      expect(p.can("ece.documento.certificar")).toBe(p.canCertificar);
      expect(p.can("ece.workflow.designer")).toBe(p.canDesignWorkflow);
      expect(p.can("ece.bitacora.read")).toBe(p.canReadBitacora);
    });
  });

  // --- Memoización ---
  describe("Memoización (useMemo)", () => {
    it("referencia estable cuando roleCodes no cambia entre renders", () => {
      const roles = ["PHYSICIAN"];
      const { result, rerender } = renderHook(
        ({ codes }) => useEcePermissions(codes),
        { initialProps: { codes: roles } },
      );
      const first = result.current;
      rerender({ codes: roles });
      expect(result.current).toBe(first);
    });

    it("nuevo objeto cuando roleCodes cambia", () => {
      const { result, rerender } = renderHook(
        ({ codes }) => useEcePermissions(codes),
        { initialProps: { codes: ["NURSE"] } },
      );
      const first = result.current;
      rerender({ codes: ["DIR"] });
      expect(result.current).not.toBe(first);
      expect(result.current.canCertificar).toBe(true);
    });
  });
});
