# ADR 0001 — AND-compose para filtros tenant en queries de catálogo

- **Estado:** Aceptado
- **Fecha:** 2026-05-13
- **Decisores:** @AS (proponente), @AE, @DBA
- **Fase:** 2 (Construcción Waves 6/7/8)
- **Contexto del descubrimiento:** Cross-tenant security review en Stream A de Fase 5 (PR #9).

## Contexto

Los routers tRPC de Phase 2 (Outpatient, Pharmacy, LIS, Imaging, Insurance, etc.) exponen endpoints de búsqueda (`list`, `search`, `findMany`) sobre entidades que pueden ser:

1. **Tenant-private** (e.g. `OutpatientAppointment`, `Prescription`) — siempre filtradas por `organizationId`.
2. **Catálogo global con override por tenant** (e.g. `Drug`, `LabPanel`, `Insurer`) — `organizationId NULL` para registros globales del catálogo MINSAL/DNM/CSSP, valor concreto cuando una org sobrescribe o crea su propia variante.

El patrón naïve de armar `where` con un objeto literal y luego "agregar el filtro de tenant" es vulnerable:

```ts
// ANTIPATTERN — el caller puede sobrescribir organizationId
const where = input.where ?? {};
where.organizationId = ctx.tenant.organizationId; // demasiado tarde si input ya tiene OR/NOT
```

Si `input.where` contiene `{ OR: [{ organizationId: 'X' }, { id: ... }] }`, el override silencioso falla porque Prisma evalúa `OR` antes del campo top-level.

## Decisión

Todos los routers Phase 2 que tocan entidades multi-tenant aplican **AND-compose**: el filtro de tenant se combina con `AND` al filtro del caller, garantizando que la cláusula de seguridad no pueda ser sobrescrita.

```ts
// PATTERN APROBADO
const tenantFilter = isGlobalCatalog
  ? { OR: [
      { organizationId: ctx.tenant.organizationId },
      { organizationId: null },
    ]}
  : { organizationId: ctx.tenant.organizationId };

const where = {
  AND: [
    tenantFilter,
    input.where ?? {},
  ],
};
```

Para catálogos globales (`Drug`, `LabPanel`, `Insurer`, `StockItem`), el filtro tenant acepta `organizationId IS NULL OR organizationId = currentOrg` — esto se compone con el filtro del usuario vía AND y nunca puede ser anulado.

## Consecuencias

**Positivas:**
- Imposibilidad arquitectónica de filtrar cross-tenant aunque el caller envíe `where` malicioso.
- Defensa-en-profundidad: complementa RLS Postgres (`packages/database/sql/01_rls_policies.sql`) sin reemplazarla.
- Patrón uniforme en los 14 módulos Phase 2, fácil de auditar.

**Negativas:**
- Cláusulas SQL ligeramente más anidadas — Prisma optimiza pero el plan se vuelve menos legible.
- Test obligatorio cross-tenant por cada router (cubierto por `apps/web/src/test/integration/cross-tenant.integration.test.ts`).

**Neutrales:**
- No cambia el contrato tRPC público; es invisible para el cliente.

## Alternativas consideradas

1. **Confiar solo en RLS Postgres.** Rechazada: deja vulnerable la capa de aplicación si la sesión SQL pierde el `SET LOCAL app.current_org_id`. AND-compose protege incluso en runtime degradado.
2. **Server-side filter helper único (e.g. `withTenant(where)`).** Rechazada por @AS al revisar PRs: añade una indirección que oculta el patrón y dificulta auditar cada router individualmente. La explicitud gana.
3. **Validación post-query (filtrar resultados después de la consulta).** Rechazada: penalización de rendimiento + ventana de error donde datos cross-tenant podrían llegar al cliente antes del filtro JS.

## Referencias

- `apps/web/src/server/api/routers/drug.ts` — implementación de referencia (catálogo global).
- `apps/web/src/server/api/routers/outpatient.ts` — implementación tenant-private.
- `apps/web/src/test/integration/cross-tenant.integration.test.ts` — 15 tests cubriendo los 14 módulos.
- `packages/database/sql/01_rls_policies.sql` — RLS subyacente (defensa primera capa).
- `docs/02_arquitectura_software.md` §5 — multi-tenant strategy.
