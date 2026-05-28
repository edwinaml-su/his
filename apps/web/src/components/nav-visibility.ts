/**
 * Lógica pura de visibilidad de items del menú lateral.
 *
 * Vive separada de `app-shell.tsx` para:
 *   1) Reutilizarse desde tests unitarios sin tener que montar React.
 *   2) Ser invocable también desde el server (e.g. middleware o redirects
 *      tipo "si el usuario no tiene servicio para esta ruta, 302 a /dashboard").
 *
 * Nivel A — un usuario solo ve items vinculados a sus servicios asignados.
 * Roles cross-servicio (ADMIN/DIR/COO/CFO/CEO/MEDICAL_DIRECTOR/AUDITOR)
 * bypassean el filtro.
 */
export interface NavItemVisibility {
  /** Si está definido, requiere al menos un rol en común. */
  requiredRoles?: string[];
  /**
   * Si está definido y > 0 elementos: requiere intersección con los servicios
   * asignados del usuario. Roles cross-servicio bypassean.
   */
  requiredServiceUnits?: string[];
}

/**
 * Predicado central de visibilidad — un solo lugar para la lógica de
 * `requiredRoles` + `requiredServiceUnits`. Lo consume SectionGroup,
 * SidebarNoResults y cualquier middleware server-side futuro.
 *
 * Reglas:
 *   1) `requiredRoles`: si está definido, el usuario debe tener al menos uno.
 *   2) `requiredServiceUnits` (Nivel A):
 *      - Si el usuario es cross-service (ADMIN/DIR/COO/…): bypass total.
 *      - Si el usuario no tiene asignaciones de servicio: backward compat,
 *        el item se muestra (pre-Nivel-A / usuarios sin servicio aún).
 *      - Si el usuario tiene asignaciones: se requiere intersección con
 *        `requiredServiceUnits` (al menos un code en común).
 */
export function isItemVisible(
  item: NavItemVisibility,
  roleCodes: string[],
  assignedServiceUnitCodes: string[],
  isCrossServiceRole: boolean,
): boolean {
  if (
    item.requiredRoles &&
    !item.requiredRoles.some((r) => roleCodes.includes(r))
  ) {
    return false;
  }
  if (item.requiredServiceUnits && item.requiredServiceUnits.length > 0) {
    if (isCrossServiceRole) return true;
    if (assignedServiceUnitCodes.length === 0) return true; // backward compat
    return item.requiredServiceUnits.some((code) =>
      assignedServiceUnitCodes.includes(code),
    );
  }
  return true;
}
