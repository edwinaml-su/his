/**
 * Nivel B — filtros de scoping por ServiceUnit para queries data-layer.
 *
 * Complementa Nivel A (sidebar). Mientras Nivel A oculta items del menú,
 * Nivel B oculta filas en queries que devuelven datos operativos
 * (encounters abiertos, camas, triajes, citas, etc.) restringiéndolos a los
 * servicios donde el usuario está asignado.
 *
 * Reglas:
 *   - Si el usuario es cross-service (ADMIN/DIR/COO/CFO/CEO/MEDICAL_DIRECTOR/
 *     AUDITOR): el helper devuelve `undefined` → no se aplica filtro.
 *   - Si el usuario NO tiene asignaciones (lista vacía): devuelve `undefined`
 *     → backward compat (usuarios pre-Nivel-A o sin scoping aún configurado
 *     ven todo). Esto es deliberado para rollout gradual.
 *   - Si el usuario tiene asignaciones: devuelve `{ in: ids }` listo para
 *     fusionar con un filtro Prisma sobre la columna `serviceUnitId`.
 *
 * Convenciones de uso:
 *   ```ts
 *   const scope = serviceUnitIdInScope(ctx.tenant);
 *   await ctx.prisma.bed.findMany({
 *     where: {
 *       organizationId: ctx.tenant.organizationId,
 *       ...(scope ? { serviceUnitId: scope } : {}),
 *     },
 *   });
 *   ```
 *
 * Para tablas con `serviceUnitId` nullable (e.g. `Encounter.serviceUnitId`,
 * `OutpatientAppointment.serviceUnitId`):
 *   - Por defecto el helper restringe a filas con `serviceUnitId IN (...)`.
 *   - Si se desea incluir filas SIN servicio asignado (legacy / pendientes
 *     de clasificar), pasa `includeNullable: true` y el helper devuelve
 *     `{ OR: [{ serviceUnitId: { in } }, { serviceUnitId: null }] }`.
 *
 * Aplicación obligatoria en queries que listan trabajo operativo del
 * servicio. NO aplicar en MPI / catálogos / consultas históricas — un
 * paciente atendido hace 6 meses en ER no debe desaparecer del registry
 * porque hoy el usuario rotó a UCIN.
 */
import type { TenantContext } from "@his/contracts";

/**
 * Devuelve `{ in: ids }` cuando el filtro debe aplicarse, o `undefined`
 * cuando NO debe aplicarse (bypass cross-service o backward compat).
 */
export function serviceUnitIdInScope(
  tenant: Pick<TenantContext, "assignedServiceUnitIds" | "isCrossServiceRole">,
): { in: string[] } | undefined {
  if (tenant.isCrossServiceRole) return undefined;
  if (!tenant.assignedServiceUnitIds || tenant.assignedServiceUnitIds.length === 0) {
    return undefined;
  }
  return { in: tenant.assignedServiceUnitIds };
}

/**
 * Helper para construir un fragmento WHERE Prisma que respete el scope.
 * Útil cuando el `serviceUnitId` es nullable y quieres seguir permitiendo
 * registros sin servicio asignado (legacy o pendientes de clasificación).
 *
 * @returns Un objeto que se puede esparcir en un `where` de Prisma. Vacío
 *          (sin keys) cuando no aplica filtro.
 *
 * Ejemplo:
 *   ```ts
 *   const where: Prisma.EncounterWhereInput = {
 *     organizationId: ctx.tenant.organizationId,
 *     dischargedAt: null,
 *     ...serviceUnitWhereFragment(ctx.tenant, "serviceUnitId", { includeNullable: false }),
 *   };
 *   ```
 */
export function serviceUnitWhereFragment(
  tenant: Pick<TenantContext, "assignedServiceUnitIds" | "isCrossServiceRole">,
  field: string,
  options: { includeNullable?: boolean } = {},
): Record<string, unknown> {
  const scope = serviceUnitIdInScope(tenant);
  if (!scope) return {};
  if (options.includeNullable) {
    return {
      OR: [{ [field]: scope }, { [field]: null }],
    };
  }
  return { [field]: scope };
}

/**
 * `true` si el usuario ESTÁ scoping y el `serviceUnitId` pasado NO está en
 * su lista — es decir, el acceso debería ser bloqueado. Útil para validar
 * inputs en mutations (e.g. "asignar cama a encounter").
 *
 * Devuelve `false` cuando:
 *   - El usuario es cross-service.
 *   - No tiene asignaciones (backward compat).
 *   - El `serviceUnitId` ESTÁ en su lista.
 *   - `serviceUnitId` es null o undefined (no podemos validar).
 */
export function isOutOfServiceUnitScope(
  tenant: Pick<TenantContext, "assignedServiceUnitIds" | "isCrossServiceRole">,
  serviceUnitId: string | null | undefined,
): boolean {
  if (tenant.isCrossServiceRole) return false;
  if (!tenant.assignedServiceUnitIds || tenant.assignedServiceUnitIds.length === 0) {
    return false; // backward compat
  }
  if (!serviceUnitId) return false; // no se puede validar
  return !tenant.assignedServiceUnitIds.includes(serviceUnitId);
}
