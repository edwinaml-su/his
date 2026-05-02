# 12 — Validación RLS multi-tenant (US-1.7)

> Sprint 1 · Story US-1.7 (8 SP) · Owner: @QA + @DBA
> Criterio macro: usuario de Org A NO puede leer datos de Org B.

## 1. Estrategia: defensa en profundidad

El aislamiento por `organizationId` se aplica en **tres capas** independientes.
Una sola capa basta para mitigar el ataque más obvio; pedir las tres protege
contra bugs y operación manual ad-hoc.

| Capa | Mecanismo                                | Falla si...                                 |
| ---- | ---------------------------------------- | ------------------------------------------- |
| 1    | Filtros en aplicación (`where: { organizationId: ctx.tenant.organizationId }`) en cada router tRPC | Un router olvida el filtro. |
| 2    | Validación de `tenant` en middleware tRPC (`tenantProcedure`) — rechaza requests sin `ctx.tenant`. | Capa 1 ya pasó pero el filtro estaba mal armado. |
| 3    | **RLS de Postgres** (`01_rls_policies.sql`) — última línea, evalúa `organizationId = current_org_id()` por fila. | Solo puede fallar si el rol ejecutante tiene `BYPASSRLS` (ej. service_role). |

**MVP (Sprint 1):** las capas 1 y 2 son obligatorias. La capa 3 está
**activa en BD** pero el contexto se setea desde el **JWT de Supabase** en
runtime web (Auth → PostgREST) y solo opcionalmente desde la app vía
`withTenantContext` (Prisma con connection string plano).

**Fase 2+:** el helper `withTenantContext` se vuelve obligatorio en todos los
routers. Una vez logrado, podremos revocar grants directos al rol app sobre
tablas tenant-scoped, dejando la capa 3 como guardia real contra cualquier
query sin filtro (incluyendo SQL ad-hoc desde dashboards).

## 2. Cómo el contexto llega a Postgres

Las policies leen 3 GUC:

- `app.current_user_id` (uuid)
- `app.current_org_id` (uuid)
- `app.is_break_glass` (boolean)

Los helpers SQL en `04_rls_session_helpers.sql` extienden los originales
(`01_rls_policies.sql`) para leer estas variables ANTES de caer al claim JWT.
Con esto un test de Vitest puede:

```sql
SELECT public.set_tenant_context('<user_uuid>', '<org_uuid>', false);
```

dentro de una transacción (`SET LOCAL` solo aplica al scope transaccional).
El helper TS en `packages/trpc/src/rls-context.ts` envuelve esa llamada
(`applyTenantContext`, `withTenantContext`).

## 3. Cómo correr los tests

Pre-requisitos:

1. Una BD Postgres dedicada a TEST (no usar la de dev).
2. Migraciones Prisma aplicadas + seed mínimo (al menos un `Country`,
   una `BiologicalSex`, una `Currency`).
3. SQL aplicado en orden:
   - `packages/database/sql/01_rls_policies.sql`
   - `packages/database/sql/04_rls_session_helpers.sql`
4. `DATABASE_URL` apuntando a un rol **sin** `BYPASSRLS` (un rol app),
   sino el Test 3 fallará (los superusuarios saltan RLS por diseño).

Comando:

```bash
RUN_RLS_TESTS=1 DATABASE_URL="postgresql://app_user:...@host:5432/his_test" \
  npm run -w @his/trpc test -- rls-isolation
```

Sin `RUN_RLS_TESTS=1` la suite se marca como `skip` (Vitest
`describe.skipIf`) — CI verde sin BD real.

## 4. Matriz de aislamiento esperada

| # | Contexto seteado          | Operación                              | Resultado esperado            |
| - | ------------------------- | -------------------------------------- | ----------------------------- |
| 1 | `app.current_org_id = A`  | `findUnique(patientA)`                 | Devuelve paciente A           |
| 2 | `app.current_org_id = A`  | `findUnique(patientB)`                 | `null` (RLS oculta)           |
| 2 | `app.current_org_id = A`  | `findMany({ organizationId: B })`      | `[]` (RLS filtra a 0)         |
| 3 | (sin contexto)            | `findMany` cualquier paciente          | `[]` (current_org_id = NULL)  |
| 4 | `app.is_break_glass=true` | `findMany` ambos pacientes             | Devuelve ambos (queda audit)  |

## 5. Cobertura actual

Tablas con RLS habilitada en `01_rls_policies.sql`:

- **Cubiertas por US-1.7 explícitamente** (criterio): `Patient`, `Encounter`, `Bed`, `TriageEvaluation`.
- **Cubiertas adicionalmente** (mismo patrón `tenant_isolation_*`):
  `Organization`, `Establishment`, `Ledger`, `ServiceUnit`, `TriageLevel`,
  `TriageFlowchart`, `Role`, `UserOrganizationRole`.
- **Hijas vía Patient/Encounter/TriageEvaluation/TriageFlowchart**:
  `PatientIdentifier`, `PatientAddress`, `PatientPhone`, `PatientEmail`,
  `PatientEmergencyContact`, `PatientEthnicity`, `PatientReligion`,
  `PatientLanguage`, `PatientAllergy`, `PatientConsent`, `PatientMerge`,
  `BedAssignment`, `EncounterTransfer`, `TriageDiscriminator`,
  `TriageFlowchartVitalSign`, `TriageVitalSign`, `TriageDiscriminatorHit`.

## 6. Limitaciones conocidas

1. **Catálogos globales sin RLS por diseño**: `Country`, `Currency`,
   `BiologicalSex`, `Gender`, `MaritalStatus`, etc. Son referenciales
   compartidos cross-tenant.
2. **Tablas auditoría (`audit.AuditLog`)**: tienen RLS aparte (no cubierto
   por este test). Plan: US-1.8.
3. **`PatientMerge` referencia solo `toPatientId`** en su policy
   (`01_rls_policies.sql` línea 247). Si una operación intenta filtrar por
   `fromPatientId` cross-org, NO está cubierto. *(observado, no corregido en
   este PR — abrir ticket.)*
4. **Policies asumen `service_role` con BYPASSRLS** para migraciones y seeds.
   Cualquier conexión que use ese rol salta RLS — el test 3 lo detecta si la
   suite corre con el rol equivocado.
5. **Defensa en profundidad NO aplicada en routers actuales**: el helper
   `withTenantContext` está disponible pero los routers tRPC del Sprint 1
   siguen usando filtros en aplicación. Migración programada Fase 2.
6. Los tests cubren `Patient` directo. La cobertura de `Encounter`, `Bed`,
   `TriageEvaluation` se infiere por simetría de policies (mismo `DO $$`
   loop) — si se requiere validación explícita por tabla, expandir la suite.

## 7. Bugs / hallazgos en RLS (no corregidos aquí)

> Cualquier cambio a `01_rls_policies.sql` va en otro PR/historia.

- **B-1 (severidad: media)**: la policy `patient_soft_delete` solo es
  `RESTRICTIVE` para `SELECT`. `UPDATE` y `DELETE` sobre filas con
  `deletedAt IS NOT NULL` no están restringidos por esa policy específica
  (la genérica `tenant_isolation_modify` sí los limita por org, pero un user
  de la misma org puede modificar registros borrados lógicamente). Confirmar
  si es intencional.
- **B-2 (severidad: baja)**: `is_break_glass()` original cae a `false` si el
  cast del JWT a `boolean` falla silenciosamente. La extensión en
  `04_rls_session_helpers.sql` mantiene el mismo comportamiento.
- **B-3 (severidad: baja)**: no hay policy explícita para tablas
  `WITH CHECK` en `INSERT` cuando `organizationId` no se provee. Se confía en
  el DEFAULT de Prisma + filtro en aplicación.

## 8. Archivos

| Path                                                    | Rol                                  |
| ------------------------------------------------------- | ------------------------------------ |
| `packages/database/sql/01_rls_policies.sql`             | Policies base (no tocado en US-1.7). |
| `packages/database/sql/04_rls_session_helpers.sql`      | Helpers GUC + `set_tenant_context`.  |
| `packages/trpc/src/rls-context.ts`                      | Wrapper TS (`withTenantContext`).    |
| `packages/trpc/src/__tests__/rls-isolation.test.ts`     | Suite Vitest (gated por `RUN_RLS_TESTS`). |
