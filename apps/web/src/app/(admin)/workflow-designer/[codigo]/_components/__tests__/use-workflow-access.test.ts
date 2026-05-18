/**
 * Tests unitarios — useWorkflowAccess (US.F2.2.14)
 *
 * Verifica que los roles editores (WORKFLOW_DESIGNER, DIR, ADMIN) den canEdit=true
 * y que cualquier otro rol quede en read-only.
 */
import { describe, it, expect } from "vitest";
import { useWorkflowAccess } from "../use-workflow-access";

describe("useWorkflowAccess", () => {
  // ── Roles editores ───────────────────────────────────────────────────────────

  it("WORKFLOW_DESIGNER puede editar", () => {
    const { canEdit, isReadOnly } = useWorkflowAccess(["WORKFLOW_DESIGNER"]);
    expect(canEdit).toBe(true);
    expect(isReadOnly).toBe(false);
  });

  it("DIR puede editar", () => {
    const { canEdit } = useWorkflowAccess(["DIR"]);
    expect(canEdit).toBe(true);
  });

  it("ADMIN puede editar", () => {
    const { canEdit } = useWorkflowAccess(["ADMIN"]);
    expect(canEdit).toBe(true);
  });

  it("combinación de roles que incluye WORKFLOW_DESIGNER puede editar", () => {
    const { canEdit } = useWorkflowAccess(["PHYSICIAN", "NURSE", "WORKFLOW_DESIGNER"]);
    expect(canEdit).toBe(true);
  });

  // ── Roles no editores ────────────────────────────────────────────────────────

  it("ENF (enfermería) es solo lectura", () => {
    const { canEdit, isReadOnly } = useWorkflowAccess(["ENF"]);
    expect(canEdit).toBe(false);
    expect(isReadOnly).toBe(true);
  });

  it("MC (médico clínico) es solo lectura", () => {
    const { canEdit } = useWorkflowAccess(["MC"]);
    expect(canEdit).toBe(false);
  });

  it("PHYSICIAN es solo lectura", () => {
    const { canEdit } = useWorkflowAccess(["PHYSICIAN"]);
    expect(canEdit).toBe(false);
  });

  it("combinación MC + ENF sigue siendo solo lectura", () => {
    const { canEdit } = useWorkflowAccess(["MC", "ENF"]);
    expect(canEdit).toBe(false);
  });

  it("array vacío es solo lectura", () => {
    const { canEdit, isReadOnly } = useWorkflowAccess([]);
    expect(canEdit).toBe(false);
    expect(isReadOnly).toBe(true);
  });

  // ── Invariantes ──────────────────────────────────────────────────────────────

  it("canEdit y isReadOnly son siempre opuestos", () => {
    for (const codes of [["DIR"], ["ENF"], [], ["WORKFLOW_DESIGNER", "MC"]]) {
      const { canEdit, isReadOnly } = useWorkflowAccess(codes);
      expect(canEdit).toBe(!isReadOnly);
    }
  });

  it("case sensitive: 'dir' minúscula no da acceso", () => {
    const { canEdit } = useWorkflowAccess(["dir"]);
    expect(canEdit).toBe(false);
  });
});
