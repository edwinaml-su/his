/**
 * CC-0031 Fase 0 — verifica que TODA entrada de `TASK_REQUIRED_ROLES`
 * (workflow-inbox.ts) resuelve a ≥1 rol REAL vía `resolveCanonicalRoleCode`
 * (roles pre-existentes + roles/alias nuevos de `sql/238`).
 *
 * Antes de CC-0031 esto fallaba para GS1_TRANSFER_PENDING, GS1_RETURN_PENDING,
 * EQUIPMENT_CALIBRATION_DUE, EQUIPMENT_MAINTENANCE_DUE, LAB_TO_PROCESS e
 * IMAGING_TO_REPORT (00 §5.1: ningún código de esos arrays era un `Role` real
 * ni tenía alias) — este test es la regresión que evita reintroducir un
 * "código huérfano" (tarea que nunca le aparece a nadie).
 */
import { describe, it, expect } from "vitest";
import { TASK_REQUIRED_ROLES, type TaskType } from "../workflow-inbox";
import {
  ALL_ROLE_ALIASES,
  CC0031_NEW_ROLE_ALIASES,
  CC0031_NEW_ROLE_CODES,
  ESCALATION_ROLE_BY_ASSIGNED_ROLE,
  PRE_EXISTING_ROLE_ALIASES,
  REAL_ROLE_CODES,
  resolveCanonicalRoleCode,
  resolveEscalationRole,
} from "../notification-roles";

describe("CC-0031 — cobertura de roles de TASK_REQUIRED_ROLES", () => {
  const taskTypes = Object.keys(TASK_REQUIRED_ROLES) as TaskType[];

  it("no está vacío (guard contra un import roto)", () => {
    expect(taskTypes.length).toBeGreaterThan(30);
  });

  it.each(taskTypes)(
    "%s resuelve a ≥1 rol real vía Role/alias",
    (taskType) => {
      const roles = TASK_REQUIRED_ROLES[taskType];
      const resolved = roles.map(resolveCanonicalRoleCode).filter((r): r is string => r !== null);
      expect(resolved.length, `${taskType}: [${roles.join(", ")}] no resuelve a ningún rol real`).toBeGreaterThan(0);
    },
  );

  it("cada código huérfano documentado en 00 §5.1 tiene alias (o es un rol nuevo)", () => {
    const ORPHANS = [
      "MC", "ENF", "PHARM", "LAB_TECH", "LAB", "LAB_VALIDATOR", "RAD", "RADIOLOGO",
      "TRIAGIST", "ANESTH", "ADM", "DPO", "BB", "CALIDAD", "BODEGA", "BIOMEDICA",
      "MANTENIMIENTO", "LIMPIEZA", "RECEPCION", "NUTRI", "RESP", "TERAPISTA",
      "OBSTETRA", "NEONATOLOGO", "FARMACO", "FACTURACION", "GERENTE",
      "ADMIN_CLINICO", "LAB_TECHNICIAN", "RAD_TECHNICIAN",
    ];
    const unresolved = ORPHANS.filter((code) => resolveCanonicalRoleCode(code) === null);
    expect(unresolved).toEqual([]);
  });

  it("no hay alias que apunte a un código que a su vez no sea real", () => {
    for (const [source, canonical] of Object.entries(ALL_ROLE_ALIASES)) {
      if (canonical === "super_admin") continue; // rol de sistema fuera de Role tenant-scoped.
      expect(REAL_ROLE_CODES, `alias ${source} → ${canonical} no resuelve a un Role real`).toContain(
        canonical,
      );
    }
  });

  it("los alias nuevos de sql/238 no chocan con los ya sembrados por sql/194", () => {
    const overlap = Object.keys(CC0031_NEW_ROLE_ALIASES).filter(
      (k) => k in PRE_EXISTING_ROLE_ALIASES,
    );
    expect(overlap).toEqual([]);
  });

  it("resolveEscalationRole: default es DIR para roles sin entrada explícita", () => {
    expect(resolveEscalationRole("WORKFLOW_DESIGNER")).toBe("DIR");
  });

  it.each(Object.entries(ESCALATION_ROLE_BY_ASSIGNED_ROLE))(
    "resolveEscalationRole(%s) → %s es un rol real",
    (assignedRole, escalationRole) => {
      expect(REAL_ROLE_CODES).toContain(escalationRole);
      expect(resolveEscalationRole(assignedRole)).toBe(escalationRole);
    },
  );

  it("todos los roles nuevos de CC-0031 aparecen en REAL_ROLE_CODES", () => {
    for (const code of CC0031_NEW_ROLE_CODES) {
      expect(REAL_ROLE_CODES).toContain(code);
    }
  });
});
