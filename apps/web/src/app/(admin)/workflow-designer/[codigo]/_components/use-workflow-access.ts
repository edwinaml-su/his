/**
 * Hook para determinar si el usuario actual tiene acceso de edición
 * al Workflow Designer.
 *
 * Roles editores: WORKFLOW_DESIGNER, DIR, ADMIN.
 * Todo lo demás = solo lectura (US.F2.2.14).
 */
"use client";

const EDITOR_ROLES = new Set(["WORKFLOW_DESIGNER", "DIR", "ADMIN"]);

export function useWorkflowAccess(roleCodes: string[]): {
  canEdit: boolean;
  isReadOnly: boolean;
} {
  const canEdit = roleCodes.some((r) => EDITOR_ROLES.has(r));
  return { canEdit, isReadOnly: !canEdit };
}
