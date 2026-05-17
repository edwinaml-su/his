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

  // =========================================================================
  // Roles especializados (75_specialized_roles.sql)
  // =========================================================================

  // --- ece.cirugia.programar ---
  describe("ece.cirugia.programar", () => {
    it("MC puede programar cirugía", () => {
      expect(can(["MC"], "ece.cirugia.programar")).toBe(true);
    });

    it("ESP puede programar cirugía", () => {
      expect(can(["ESP"], "ece.cirugia.programar")).toBe(true);
    });

    it("GO puede programar cirugía obstétrica", () => {
      expect(can(["GO"], "ece.cirugia.programar")).toBe(true);
    });

    it("ANEST NO puede programar cirugía (solo administra anestesia)", () => {
      expect(can(["ANEST"], "ece.cirugia.programar")).toBe(false);
    });

    it("NURSE NO puede programar cirugía", () => {
      expect(can(["NURSE"], "ece.cirugia.programar")).toBe(false);
    });

    it("ADMIN tiene acceso por bypass", () => {
      expect(can(["ADMIN"], "ece.cirugia.programar")).toBe(true);
    });
  });

  // --- ece.cirugia.firmar_acto ---
  describe("ece.cirugia.firmar_acto", () => {
    it("ESP cirujano firma el acto quirúrgico", () => {
      expect(can(["ESP"], "ece.cirugia.firmar_acto")).toBe(true);
    });

    it("MC solo NO puede firmar el acto (requiere calidad de especialista)", () => {
      expect(can(["MC"], "ece.cirugia.firmar_acto")).toBe(false);
    });

    it("GO solo NO puede firmar acto quirúrgico general (usa ESP para eso)", () => {
      expect(can(["GO"], "ece.cirugia.firmar_acto")).toBe(false);
    });

    it("ANEST NO firma acto quirúrgico", () => {
      expect(can(["ANEST"], "ece.cirugia.firmar_acto")).toBe(false);
    });

    it("NURSE NO firma acto quirúrgico", () => {
      expect(can(["NURSE"], "ece.cirugia.firmar_acto")).toBe(false);
    });

    it("ADMIN tiene acceso por bypass", () => {
      expect(can(["ADMIN"], "ece.cirugia.firmar_acto")).toBe(true);
    });
  });

  // --- ece.anestesia.administrar ---
  describe("ece.anestesia.administrar", () => {
    it("ANEST administra anestesia", () => {
      expect(can(["ANEST"], "ece.anestesia.administrar")).toBe(true);
    });

    it("ESP NO administra anestesia (separación de funciones)", () => {
      expect(can(["ESP"], "ece.anestesia.administrar")).toBe(false);
    });

    it("PHYSICIAN NO administra anestesia", () => {
      expect(can(["PHYSICIAN"], "ece.anestesia.administrar")).toBe(false);
    });

    it("NURSE NO administra anestesia", () => {
      expect(can(["NURSE"], "ece.anestesia.administrar")).toBe(false);
    });
  });

  // --- ece.urpa.dar_alta ---
  describe("ece.urpa.dar_alta", () => {
    it("NURSE puede dar alta URPA", () => {
      expect(can(["NURSE"], "ece.urpa.dar_alta")).toBe(true);
    });

    it("ENF (alias) puede dar alta URPA", () => {
      expect(can(["ENF"], "ece.urpa.dar_alta")).toBe(true);
    });

    it("ENF_NRP puede dar alta URPA", () => {
      expect(can(["ENF_NRP"], "ece.urpa.dar_alta")).toBe(true);
    });

    it("PHYSICIAN NO da alta URPA directamente (debe ordenar, ENF ejecuta)", () => {
      expect(can(["PHYSICIAN"], "ece.urpa.dar_alta")).toBe(false);
    });

    it("ANEST NO da alta URPA (solo ordena)", () => {
      expect(can(["ANEST"], "ece.urpa.dar_alta")).toBe(false);
    });
  });

  // --- ece.partograma.registrar ---
  describe("ece.partograma.registrar", () => {
    it("ENF puede registrar partograma", () => {
      expect(can(["ENF"], "ece.partograma.registrar")).toBe(true);
    });

    it("NURSE puede registrar partograma", () => {
      expect(can(["NURSE"], "ece.partograma.registrar")).toBe(true);
    });

    it("MC puede registrar partograma", () => {
      expect(can(["MC"], "ece.partograma.registrar")).toBe(true);
    });

    it("GO puede registrar partograma", () => {
      expect(can(["GO"], "ece.partograma.registrar")).toBe(true);
    });

    it("ANEST NO registra partograma", () => {
      expect(can(["ANEST"], "ece.partograma.registrar")).toBe(false);
    });
  });

  // --- ece.rn.firmar ---
  describe("ece.rn.firmar", () => {
    it("PEDIA firma acta de recién nacido", () => {
      expect(can(["PEDIA"], "ece.rn.firmar")).toBe(true);
    });

    it("MC NO firma acta de RN (requiere pediatra)", () => {
      expect(can(["MC"], "ece.rn.firmar")).toBe(false);
    });

    it("GO NO firma acta de RN", () => {
      expect(can(["GO"], "ece.rn.firmar")).toBe(false);
    });

    it("ENF_NRP NO firma acta de RN (ejecuta reanimación, no firma acta)", () => {
      expect(can(["ENF_NRP"], "ece.rn.firmar")).toBe(false);
    });

    it("ADMIN tiene acceso por bypass", () => {
      expect(can(["ADMIN"], "ece.rn.firmar")).toBe(true);
    });
  });

  // --- ece.reanimacion.ejecutar ---
  describe("ece.reanimacion.ejecutar", () => {
    it("PEDIA ejecuta protocolo NRP", () => {
      expect(can(["PEDIA"], "ece.reanimacion.ejecutar")).toBe(true);
    });

    it("ENF_NRP ejecuta protocolo NRP", () => {
      expect(can(["ENF_NRP"], "ece.reanimacion.ejecutar")).toBe(true);
    });

    it("NURSE sin certificación NRP NO puede ejecutar reanimación", () => {
      expect(can(["NURSE"], "ece.reanimacion.ejecutar")).toBe(false);
    });

    it("MC sin certificación NRP NO puede ejecutar reanimación", () => {
      expect(can(["MC"], "ece.reanimacion.ejecutar")).toBe(false);
    });

    it("PEDIA + ENF_NRP (equipo neonatal) ambos pueden", () => {
      expect(can(["PEDIA", "ENF_NRP"], "ece.reanimacion.ejecutar")).toBe(true);
    });
  });

  // --- ADMIN bypass sobre permisos nuevos ---
  describe("ADMIN bypass — permisos especializados", () => {
    it("ADMIN tiene acceso a todos los permisos especializados", () => {
      const perms: EcePermission[] = [
        "ece.cirugia.programar",
        "ece.cirugia.firmar_acto",
        "ece.anestesia.administrar",
        "ece.urpa.dar_alta",
        "ece.partograma.registrar",
        "ece.rn.firmar",
        "ece.reanimacion.ejecutar",
      ];
      for (const p of perms) {
        expect(can(["ADMIN"], p), `ADMIN debe tener ${p}`).toBe(true);
      }
    });
  });

  // --- Roles stream #16 (IC, AC, ADM) ---
  describe("Roles stream #16 — IC / AC / ADM", () => {
    it("IC (Interoperabilidad Clínica) no tiene permisos ECE por defecto", () => {
      const roles = ["IC"];
      expect(can(roles, "ece.documento.firmar")).toBe(false);
      expect(can(roles, "ece.documento.validar")).toBe(false);
      expect(can(roles, "ece.bitacora.read")).toBe(false);
    });

    it("AC (Apoyo Clínico) no puede firmar ni certificar", () => {
      const roles = ["AC"];
      expect(can(roles, "ece.documento.firmar")).toBe(false);
      expect(can(roles, "ece.documento.certificar")).toBe(false);
    });

    it("ADM (Admisión) no tiene acceso clínico ECE", () => {
      const roles = ["ADM"];
      expect(can(roles, "ece.documento.firmar")).toBe(false);
      expect(can(roles, "ece.rectificacion.solicitar")).toBe(false);
    });

    it("IC + MC (combinado) puede firmar vía MC aunque IC no pueda", () => {
      const roles = ["IC", "MC"];
      expect(can(roles, "ece.documento.firmar")).toBe(true);
      expect(can(roles, "ece.documento.validar")).toBe(true);
    });

    it("AC + ENF puede firmar y solicitar rectificación vía ENF", () => {
      const roles = ["AC", "ENF"];
      expect(can(roles, "ece.documento.firmar")).toBe(true);
      expect(can(roles, "ece.rectificacion.solicitar")).toBe(true);
      expect(can(roles, "ece.documento.certificar")).toBe(false);
    });
  });

  // --- Alias adicionales (super_admin, ADMIN_GLOBAL) ---
  describe("Aliases ADMIN adicionales", () => {
    it("super_admin tiene bypass total", () => {
      const perms: EcePermission[] = [
        "ece.documento.firmar",
        "ece.documento.certificar",
        "ece.documento.anular",
        "ece.bitacora.read",
        "ece.workflow.designer",
      ];
      for (const p of perms) {
        expect(can(["super_admin"], p), `super_admin debe tener ${p}`).toBe(true);
      }
    });

    it("ADMIN_GLOBAL tiene bypass total igual que ADMIN", () => {
      const perms: EcePermission[] = [
        "ece.rectificacion.aprobar",
        "ece.workflow.designer",
        "ece.documento.anular",
      ];
      for (const p of perms) {
        expect(can(["ADMIN_GLOBAL"], p), `ADMIN_GLOBAL debe tener ${p}`).toBe(true);
      }
    });
  });

  // --- Alias español (medico, enfermeria) ---
  describe("Aliases en español (medico, enfermeria)", () => {
    it("medico (alias) puede firmar y validar igual que PHYSICIAN", () => {
      expect(can(["medico"], "ece.documento.firmar")).toBe(true);
      expect(can(["medico"], "ece.documento.validar")).toBe(true);
      expect(can(["medico"], "ece.documento.certificar")).toBe(false);
    });

    it("enfermeria (alias) puede firmar y solicitar rectificación igual que NURSE", () => {
      expect(can(["enfermeria"], "ece.documento.firmar")).toBe(true);
      expect(can(["enfermeria"], "ece.rectificacion.solicitar")).toBe(true);
      expect(can(["enfermeria"], "ece.documento.validar")).toBe(false);
    });
  });

  // --- ESP overlapping con NURSE ---
  describe("ESP + NURSE — overlap de roles clínicos", () => {
    it("ESP + NURSE puede firmar (ambos tienen ese permiso)", () => {
      expect(can(["ESP", "NURSE"], "ece.documento.firmar")).toBe(true);
    });

    it("ESP + NURSE no puede validar (ninguno de los dos puede)", () => {
      expect(can(["ESP", "NURSE"], "ece.documento.validar")).toBe(false);
    });

    it("ESP + NURSE no puede certificar", () => {
      expect(can(["ESP", "NURSE"], "ece.documento.certificar")).toBe(false);
    });
  });

  // --- ecePersonalRoles ignorado en contexto actual ---
  describe("ecePersonalRoles — campo adicional", () => {
    it("ecePersonalRoles no infla permisos cuando roleCodes es vacío", () => {
      const result = hasEcePermission("ece.documento.firmar", {
        roleCodes: [],
        ecePersonalRoles: ["MC", "ESP"],
      });
      expect(result).toBe(false);
    });

    it("ecePersonalRoles presente + roleCodes válido retorna el resultado de roleCodes", () => {
      const result = hasEcePermission("ece.documento.firmar", {
        roleCodes: ["NURSE"],
        ecePersonalRoles: ["ARCH"],
      });
      expect(result).toBe(true);
    });
  });

  // --- Roles no reconocidos + whitespace edge cases ---
  describe("Roles no reconocidos y edge cases de strings", () => {
    it("rol con espacios no coincide con alias válido", () => {
      expect(can([" ADMIN"], "ece.documento.firmar")).toBe(false);
      expect(can(["ADMIN "], "ece.bitacora.read")).toBe(false);
    });

    it("rol en minúsculas no reconocido no otorga permisos (excepto aliases explícitos)", () => {
      expect(can(["dir"], "ece.documento.certificar")).toBe(false);
      expect(can(["nurse"], "ece.documento.firmar")).toBe(false);
    });

    it("rol numérico/symbol string no otorga permisos", () => {
      expect(can(["123", "!@#"], "ece.documento.firmar")).toBe(false);
    });

    it("array con varios roles desconocidos acumula denegación", () => {
      const roles = ["FARMACIA", "ESTERILIZACION", "IMAGEN", "LABORATORIO"];
      const perms: EcePermission[] = [
        "ece.documento.firmar",
        "ece.documento.certificar",
        "ece.bitacora.read",
        "ece.rectificacion.aprobar",
        "ece.workflow.designer",
      ];
      for (const p of perms) {
        expect(can(roles, p), `roles auxiliares no deben poder ${p}`).toBe(false);
      }
    });
  });

  // --- Todos los permisos ECE cubiertos exhaustivamente para IC/AC/ADM ---
  describe("Cobertura exhaustiva permisos — roles auxiliares stream #16", () => {
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

    it("IC niega todos los permisos ECE", () => {
      for (const p of ALL_PERMS) {
        expect(can(["IC"], p), `IC no debe poder ${p}`).toBe(false);
      }
    });

    it("AC niega todos los permisos ECE", () => {
      for (const p of ALL_PERMS) {
        expect(can(["AC"], p), `AC no debe poder ${p}`).toBe(false);
      }
    });

    it("ADM niega todos los permisos ECE", () => {
      for (const p of ALL_PERMS) {
        expect(can(["ADM"], p), `ADM no debe poder ${p}`).toBe(false);
      }
    });
  });
});
