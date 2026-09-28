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

## 9. Routers sin contexto RLS — decisiones 2026-09-27 (R02)

Cierre del residual de R02 (auditoría RLS externa): 18 routers detectados sin
`withTenantContext`/`withPortalContext`/`withEceContext`. Metodología: para
cada uno se identificaron las tablas tocadas, si son catálogo global o
tenant/PHI-scoped, y se verificó en prod (solo lectura, `mcp__Supabase__execute_sql`
contra `ejacvsgbewcerxtjtwto`) si existe RLS y qué policies aplican al rol
`authenticated`. Decisión **(a)** = migrado en este PR; **(b)** = privilegio
mantenido con justificación (comentario `R02 (auditoria RLS externa...)` en
la cabecera del propio archivo); **pendiente** = requiere una policy nueva no
aplicada aquí (ver `packages/database/sql/268_r02_policies_routers_residuales.sql`).

| Router (procedure) | Tablas | Tenant-scoped / global | Decisión | Razón |
|---|---|---|---|---|
| `audit-integrity.router.ts` | `audit."AuditLog"` (vía `fn_verify_chain`/`fn_chain_stats`) | Tenant-scoped (`auditlog_tenant_select`), pero el router audita la cadena COMPLETA a propósito | (b) | Demotar filtraría el `count(*)`/la cadena por `organizationId`, invalidando la verificación global. Acceso ya restringido a `super_admin`/`admin_clinico`. |
| `country.router.ts` | `Country`, `CountryCurrency` | Global (sin `organizationId`) | (b) | Únicas policies son `*_select_all` (SELECT, `qual=true`); sin policy de escritura para `authenticated` — demotar rompe create/update/deactivate/activate. |
| `currency.router.ts` | `Currency`, `ExchangeRate` | Global | (b) | Router 100% lectura; policies `*_select_all` ya abiertas, sin restricción de tenant que aplicar. |
| `drug-classifier.router.ts` | `DrugClassifier` | Global (tabla puente sin `organizationId`) | (b) | `drug_classifier_select` es la única policy (SELECT, `qual=true`); sin policy de INSERT/DELETE — `add`/`remove` requieren rol BYPASSRLS. Gap de IDOR distinto (no valida `drugId` contra tenant) anotado en `decisions_needed`, fuera de este alcance. |
| `epcis-query.router.ts` | `ece.epcis_event_equipment` | **Tenant-scoped** (vía `BiomedicalEquipment.organizationId`) | **(a) migrado** | Policies `epcis_event_equipment_select/_insert` ya exigen `organizationId = current_org_id() OR is_break_glass()`. Antes del fix, las 4 queries usaban `$queryRawUnsafe` directo sin filtro de organización — cross-tenant leak real. Ninguna policy nueva necesaria. |
| `exchange-rate.router.ts` | `ExchangeRate` | Global | (b) | Única policy `fx_select_all` (SELECT, `qual=true`); sin policy de INSERT para `authenticated` — `create` requiere rol BYPASSRLS. |
| `locale.router.ts` | `Country`, `GeoDivision`, `Holiday` | Global | (b) | Policies `*_select_all` abiertas. `currentLocale` lee `Organization` por `ctx.tenant.organizationId` (server-derivado, no input de usuario) — sin vector cross-tenant. |
| `mfa.router.ts` | `User`, `UserCredential` (propios) | Self-scoped (no tenant) | (b), migración diferida | Policies `user_self_modify`/`user_cred_self` calzarían con el filtro JS existente (`ctx.user.id` en todo lado), pero `enroll`/`verify` usan `$transaction([...])` en forma ARRAY (no callback) y no existe un helper "solo usuario, sin org" en `rls-context.ts`. Migrar exige un PR aislado (nuevo helper + tests) — no se fuerza aquí para no reescribir ~18 tests existentes sin ganancia de seguridad real. |
| `portal.router.ts` → `account.enableMfa` | `PortalAccount` | Self-scoped (portal) | **(a) migrado** | `portal_account_select`/`_update` (`id = current_portal_account()`). La RPC a Vault (`set_portal_mfa_secret_vault`) queda fuera del contexto: `authenticated` NO tiene `EXECUTE` sobre ella (verificado en prod). |
| `portal.router.ts` → `account.verifyMfa` | `PortalAccount` | Self-scoped (portal) | **(a) migrado** | Igual que `enableMfa`; la RPC `get_portal_mfa_secret` también queda fuera (sin `EXECUTE` para `authenticated`). |
| `portal.router.ts` → `auth.logout` | `PortalSession` | Self-scoped (portal) | **(a) migrado** | `portal_session_update` (`accountId = current_portal_account()`) cubre exactamente el `updateMany` existente. |
| `portal.router.ts` → `account.register`/`verifyEmail`, `auth.requestLogin`/`verifyLogin` | `PortalAccount`, `PortalMagicLink` | Self-scoped (portal), pre-sesión | (b) | `PortalAccount` no tiene policy de INSERT y `PortalMagicLink` no tiene policy de UPDATE para `authenticated` (verificado en prod) — el alta de cuenta y el consumo del magic link (`consumedAt`) son estructuralmente pre-sesión (no existe `current_portal_account()` todavía). Defensa real: anti-enumeration + rate limit. |
| `portal.router.ts` → `guardian.list` | `GuardianRelationship`, `Patient` (join `wardPatient`) | Tenant-scoped (`Patient`) + self-scoped (`GuardianRelationship`) | (b), **pendiente** | `GuardianRelationship` sí tiene policy portal-aware, pero `Patient` solo tiene `organizationId = current_org_id()` — GUC que `withPortalContext` no setea. Migrar tal cual dejaría `ward` siempre `null`. Policy nueva propuesta (NO aplicada) en SQL 268. Mismo gap ya late en `expedienteRouter.getMiExpediente`/`hce.labResults.get` (ya usan `withPortalContext` hoy) — documentado, no corregido en este PR. |
| `user-service-unit.router.ts` | `UserServiceUnitAssignment` | Tenant-scoped, vía `ServiceUnit.organizationId` en JS | (b) — **decisión previa, sin cambios** | Ya trae su propia justificación de cabecera (R02 anterior, 2026-08-22): la única policy es de SELECT propia (`userId = current_user_id()`), incompatible con `listByUser`/`listByService` (consultan asignaciones de OTROS usuarios) y sin policy de escritura. Se referencia aquí solo para dejar registro en la tabla maestra. |
| `workflow-estado.router.ts` | `ece.flujo_estado`, `ece.flujo_transicion`, `ece.documento_rol` | Global (catálogo motor ECE, sin `organizationId`) | (b) | Única policy es `catalogo_read_all` (SELECT); sin policy de escritura — demotar rompe todo `create`/`update`/`delete`. Control real: `requireRole(["DIR","WORKFLOW_DESIGNER"])`. |
| `workflow-plantilla.router.ts` | `ece.workflow_plantilla`, `ece.flujo_estado`, `ece.flujo_transicion` | Global | (b) | Mismo patrón: `catalogo_read_all` sin escritura; `applyToWorkflow` requiere BYPASSRLS. |
| `workflow-rol.router.ts` | `ece.documento_rol`, `ece.rol` | Global | (b) | Mismo patrón `catalogo_read_all` sin escritura. |
| `workflow-simulacion.router.ts` | `ece.flujo_estado`, `ece.flujo_transicion` | Global | (b) | 100% lectura, sin mutación; `catalogo_read_all` ya abierta. |
| `workflow-transicion.router.ts` | `ece.flujo_transicion`, `ece.flujo_estado`, `ece.documento_rol`, `ece.rol` | Global | (b) | Mismo patrón `catalogo_read_all` sin escritura. |
| `workflow-validator-visual.router.ts` | `ece.rol` | Global | (b) | 100% lectura (`tenantProcedure`, valida un grafo pasado por input). |
| `workflow-validator.router.ts` | `ece.flujo_estado`, `ece.flujo_transicion`, `ece.documento_rol` | Global | (b) | 100% lectura. |
| `ece/critical-result.router.ts` | `ece.critical_result_notification` | **Tenant-scoped** (`crn_tenant_isolation`) | **(b), parcial — residual abierto** | Las 4 procedures llaman `applyTenantContext` (primitiva de bajo nivel, no el azúcar `withTenantContext`) — apareció en el listado inicial por un grep literal que no capturaba esa variante. Pero solo `pending` demota a `authenticated`; `emit`/`confirmReadback`/`escalate` pasan `demoteRole: false` (bloqueadas por `audit."AuditLog"` sin policy de INSERT para `authenticated` — ver justificación de cabecera del router) y siguen corriendo con el rol BYPASSRLS de Supabase. GUC de organización aplicado en las 4, pero RLS real NO aplica en 3/4. Sin cambios en este PR; ver `decisions_needed`. |

**Pendiente de aprobación (no aplicado a prod):** `packages/database/sql/268_r02_policies_routers_residuales.sql` —
policy nueva de SELECT en `Patient` para lecturas del portal (propio paciente
+ ward bajo tutela activa), necesaria para migrar `guardian.list` sin romper
el JOIN a `wardPatient`.
