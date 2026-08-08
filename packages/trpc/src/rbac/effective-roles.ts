/**
 * CC-0017 Fase 1 — motor de autorización RBAC parametrizable.
 *
 * Expande `tenant.roleCodes` (los roles directos que ya resuelve
 * `apps/web/src/lib/auth/session.ts`) con:
 *   1. Herencia transitiva (`Role.inheritsFromRoleId`, anti-ciclo).
 *   2. Alias de código (`RoleCodeAlias`, p.ej. "MEDICO" → "PHYSICIAN").
 *
 * y resuelve el set de permisos efectivos (`RolePermission` de los roles
 * efectivos, con DENY ganando sobre ALLOW).
 *
 * FAIL-SAFE — este es el contrato de seguridad de todo el módulo:
 *   Cualquier fallo al resolver Role/RoleCodeAlias/RolePermission (tablas
 *   vacías, mock de Prisma sin configurar en tests, error de conexión, tipo
 *   inesperado) hace *fallback silencioso* a `tenant.roleCodes` tal cual
 *   venía. `requireRole()` en `../trpc.ts` sigue comparando ese set contra
 *   los arrays literales existentes — si no hay herencia/alias configurados,
 *   el resultado es BIT-IDÉNTICO al comportamiento pre-CC-0017. Ver
 *   `packages/trpc/src/rbac/__tests__/effective-roles.test.ts` y
 *   `packages/trpc/src/__tests__/rbac-engine.test.ts` para la prueba de esa
 *   identidad.
 *
 *   Este fail-safe es también lo que mantiene verdes los ~2700 tests
 *   existentes que ejercitan routers `requireRole`-protegidos sin mockear
 *   `prisma.role.findMany`: `vitest-mock-extended` devuelve `undefined` para
 *   métodos no configurados → `Array.isArray(undefined) === false` → se
 *   toma la rama de fallback → mismo resultado de autorización que antes.
 *
 * SIN caching entre llamadas: se evaluó (y se descartó) un WeakMap keyed por
 * `tenant` para evitar recalcular herencia/permisos dentro del mismo batch
 * tRPC. Se revirtió porque los tests del monorepo reutilizan masivamente un
 * único objeto `MOCK_TENANT` (mismo `object` reference) como default de
 * `makeCtx()` en decenas de archivos — un WeakMap module-scoped filtraba
 * resultados de un `it()` a otro dentro del mismo archivo de test (mismo
 * `tenant` reference, distinto mock de Prisma). Es un riesgo real, no sólo de
 * test: nada garantiza que dos requests distintos NUNCA compartan la misma
 * instancia de `TenantContext`. Cada `requireRole`/`requirePermission` re-
 * resuelve independientemente; son 1-3 queries indexadas baratas por
 * procedure, no un hot path. Candidato de optimización para F2 si el
 * profiling muestra que importa — con una key verdaderamente per-request
 * (no per-objeto-JS-reusable), no con esta forma.
 */
import type { PrismaClient } from "@prisma/client";
import type { TenantContext } from "@his/contracts";

/** Tope duro anti-ciclo además del `visited` Set (defensa en profundidad). */
const MAX_INHERITANCE_DEPTH = 20;

type RolesDelegate = Pick<PrismaClient, "role" | "roleCodeAlias" | "rolePermission">;

interface RoleRow {
  id: string;
  code: string;
  inheritsFromRoleId: string | null;
}

/**
 * Devuelve `tenant.roleCodes` expandido con herencia + alias. Fail-safe: ante
 * cualquier problema, devuelve `tenant.roleCodes` sin modificar.
 */
export async function getEffectiveRoleCodes(
  prisma: RolesDelegate,
  tenant: Pick<TenantContext, "roleCodes" | "organizationId">,
): Promise<string[]> {
  const base = tenant.roleCodes;
  if (!Array.isArray(base) || base.length === 0) return base;

  try {
    const roles = await prisma.role.findMany({
      where: {
        code: { in: base },
        OR: [{ organizationId: tenant.organizationId }, { organizationId: null }],
      },
      select: { id: true, code: true, inheritsFromRoleId: true },
    });

    // Sin Role rows resueltas (BD nueva sin seed, mock sin configurar en
    // tests, tabla vacía) → fallback exacto al comportamiento actual.
    if (!Array.isArray(roles) || roles.length === 0) return base;

    const codeSet = new Set(base);
    const visited = new Set<string>(roles.map((r) => r.id));
    let frontier: RoleRow[] = roles;
    let depth = 0;

    while (frontier.length > 0 && depth < MAX_INHERITANCE_DEPTH) {
      depth++;
      const parentIds = frontier
        .map((r) => r.inheritsFromRoleId)
        .filter((id): id is string => !!id && !visited.has(id));
      if (parentIds.length === 0) break;

      const parents = await prisma.role.findMany({
        where: { id: { in: parentIds } },
        select: { id: true, code: true, inheritsFromRoleId: true },
      });
      if (!Array.isArray(parents) || parents.length === 0) break;

      for (const p of parents) {
        visited.add(p.id);
        codeSet.add(p.code);
      }
      frontier = parents;
    }

    // Alias: código directo/heredado → código canónico.
    const aliasRows = await prisma.roleCodeAlias.findMany({
      where: {
        sourceCode: { in: Array.from(codeSet) },
        OR: [{ organizationId: tenant.organizationId }, { organizationId: null }],
      },
      select: { canonicalCode: true },
    });
    if (Array.isArray(aliasRows)) {
      for (const a of aliasRows) codeSet.add(a.canonicalCode);
    }

    return Array.from(codeSet);
  } catch {
    // Autorización nunca debe romperse (500) por este motor nuevo — en el
    // peor caso se comporta como si herencia/alias no existieran.
    return base;
  }
}

/**
 * Set de permisos efectivos de los roles efectivos del tenant. DENY gana
 * sobre ALLOW cuando dos roles efectivos discrepan en el mismo permiso.
 * Fail-safe: ante cualquier problema devuelve un Map vacío (deniega por
 * defecto en `requirePermission` — comportamiento seguro para un motor
 * nuevo que aún no gobierna ningún procedure heredado).
 */
export async function getEffectivePermissions(
  prisma: RolesDelegate,
  tenant: Pick<TenantContext, "roleCodes" | "organizationId">,
): Promise<Map<string, "ALLOW" | "DENY">> {
  try {
    const effectiveRoles = await getEffectiveRoleCodes(prisma, tenant);
    if (effectiveRoles.length === 0) return new Map();

    const roles = await prisma.role.findMany({
      where: {
        code: { in: effectiveRoles },
        OR: [{ organizationId: tenant.organizationId }, { organizationId: null }],
      },
      select: { id: true },
    });
    if (!Array.isArray(roles) || roles.length === 0) return new Map();

    const grants = await prisma.rolePermission.findMany({
      where: { roleId: { in: roles.map((r) => r.id) } },
      select: { effect: true, permission: { select: { code: true } } },
    });
    if (!Array.isArray(grants)) return new Map();

    const map = new Map<string, "ALLOW" | "DENY">();
    for (const g of grants) {
      const code = g.permission?.code;
      if (!code) continue;
      if (g.effect === "DENY") {
        map.set(code, "DENY"); // DENY siempre gana, sin importar el orden.
        continue;
      }
      if (!map.has(code)) map.set(code, "ALLOW");
    }
    return map;
  } catch {
    return new Map();
  }
}
