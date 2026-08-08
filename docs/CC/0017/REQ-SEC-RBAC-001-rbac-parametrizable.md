# REQ-SEC-RBAC-001 — Motor de autorización RBAC parametrizable (Fase 1)

| Campo | Valor |
|---|---|
| Control de cambios | **CC-0017** |
| Fecha | 2026-08-08 |
| Solicitante | Edwin Martínez (Inversiones Avante) — auditoría interna |
| Rama | `feat/cc-0017-rbac-parametrizable` |
| SQL | `packages/database/sql/194_cc0017_rbac_parametrizable.sql` — **NO aplicado a prod** (lo aplica el orquestador tras revisar) |
| Alcance | Fase 1 de 3 (F1 motor fail-safe + PoC; F2 ABAC persistente; F3 break-glass) |

## 1. Hallazgo de auditoría

`requireRole([...])` (`packages/trpc/src/trpc.ts:58`) compara `ctx.tenant.roleCodes` contra **arrays literales hardcodeados en cada router**. Barrido real del código (excluyendo tests):

- **375 call sites** de `requireRole([...])` en **95 routers** (98 archivos con el patrón, 3 de ellos sólo en tests, descartados del barrido).
- **45 códigos de rol distintos** usados en esos literales.

La tabla `RolePermission` — modelo "empresarial" con pantalla `/roles` (CRUD real, `rbac.router.ts`, matriz tri-state ALLOW/UNSET/DENY) — **nunca se lee en el enforcement real**. Cambiar permisos en `/roles` no altera absolutamente nada del comportamiento de la aplicación: es una pantalla decorativa que aparenta gobernar accesos y no gobierna ninguno.

Los códigos sembrados originalmente (`seed.ts:351`: `PHYSICIAN`, `NURSE`, `ADMISSION_CLERK`, `TRIAGE_NURSE`, `PHARMACIST`, `ADMIN`; `sql/75_specialized_roles.sql`: `ANEST`, `GO`, `PEDIA`, `ENF_NRP`) **no coinciden** con la mayoría de los 45 literales reales (`MEDICO`, `ENF`, `FARM`, `MC`, `MT`, `RAD`, `QX`, `ADM`, `ARCH`, `ESP`...). Un rol nuevo creado hoy vía `/roles` queda **inerte**: no existe ningún literal `requireRole([...])` que lo mencione, así que ese rol jamás desbloquea ni un solo procedure, sin importar qué permisos se le asignen en la matriz.

`break-glass` (`app.is_break_glass`, GUC de RLS) tampoco tiene contraparte de aplicación en el enforcement de `requireRole` — queda fuera del alcance de esta fase (ver §5, F3).

## 2. Principio de diseño: FAIL-SAFE hacia el comportamiento actual

**Nada de lo entregado en esta fase cambia quién tiene acceso hoy**, hasta que un admin configure explícitamente herencia, alias o permisos nuevos. Se descartó reescribir los 375 call sites (riesgo inaceptable en un sistema clínico en producción — un solo error de transcripción en 375 sitios puede bloquear un hospital o abrir un acceso indebido). La parametrización se logra por:

1. **Herencia de roles** (`Role.inheritsFromRoleId`, 1:1) — un rol nuevo puede heredar los accesos EFECTIVOS de un rol existente.
2. **Alias de código** (`RoleCodeAlias`) — mapea variantes de nomenclatura (`MEDICO`→`PHYSICIAN`) al código canónico que ya usan los literales.
3. `requireRole([...])` se **reimplementa sin cambiar su firma**, evaluando contra el set de roles **efectivos** (directos ∪ herencia ∪ alias) en vez de sólo los directos.

### Decisión: herencia 1:1, no N:M

Se evaluaron dos modelos:

- **1:1** (`Role.inheritsFromRoleId` → un solo padre) — elegido.
- **N:M** (tabla puente `RoleInheritance(roleId, parentRoleId)`) — descartado para esta fase.

Justificación: el caso de uso real es "rol nuevo = clon de un rol existente + extras" (p.ej. un admin crea `MEDICO_RESIDENTE_JR` heredando de `PHYSICIAN`). Herencia múltiple introduce ambigüedad de resolución quirúrgica (¿qué pasa si un permiso es ALLOW en un padre y DENY en otro?) sin que exista hoy un caso de uso que la justifique. Si F2 necesita N:M, la migración es no-destructiva: `inheritsFromRoleId` se convierte en la primera fila de una tabla puente nueva sin romper lo ya configurado.

### Fail-safe verificado con tests, no sólo declarado

`packages/trpc/src/rbac/effective-roles.ts` implementa el motor con **fallback silencioso** en cada punto de fallo: `Role.findMany` devuelve `undefined`/`[]`/lanza error → se devuelve `tenant.roleCodes` sin modificar. Esto es lo que garantiza que:

- Sin config nueva (herencia/alias vacíos), el resultado de `requireRole` es **bit-idéntico** al de antes de CC-0017.
- Los **2717 tests preexistentes** que ejercitan routers `requireRole`-protegidos — ninguno mockea `prisma.role.findMany` — siguieron pasando **sin modificar un solo test** tras cablear el motor (`vitest-mock-extended` devuelve `undefined` para métodos no configurados → `Array.isArray(undefined) === false` → rama de fallback → mismo resultado de autorización).

La prueba de identidad de comportamiento vive en:
- `packages/trpc/src/rbac/__tests__/effective-roles.test.ts` (§1 "fail-safe": 5 tests que fuerzan cada rama de fallo — mock sin configurar, `[]`, excepción, `roleCodes` vacío, Role rows sin herencia).
- `packages/trpc/src/__tests__/rbac-engine.test.ts` (describe "caso base — fail-safe, identidad con comportamiento pre-CC-0017": 3 tests end-to-end contra un router real construido con el `requireRole` de producción).

### Caching — evaluado y descartado

Se implementó inicialmente un cache por-tenant (`WeakMap` keyed por el objeto `TenantContext`) para evitar recalcular herencia/permisos dentro del mismo batch tRPC. **Se revirtió**: el propio patrón de tests del repo reutiliza masivamente un único objeto `MOCK_TENANT` (mismo `object` reference) como default de `makeCtx()` — el `WeakMap` module-scoped filtraba resultados de un `it()` a otro dentro del mismo archivo (se detectó porque `audit-rbac.test.ts` y `accounting.test.ts` empezaron a fallar al correr la suite completa, no en aislamiento). Es un riesgo real más allá de los tests: nada garantiza que dos requests HTTP distintos nunca compartan la misma instancia de `TenantContext`. Se optó por simplicidad: cada `requireRole`/`requirePermission` resuelve independientemente (1-3 queries indexadas baratas por procedure). Candidato de optimización para F2 con una key verdaderamente per-request si el profiling muestra que importa.

## 3. Motor (`packages/trpc/src/rbac/effective-roles.ts` + `packages/trpc/src/trpc.ts`)

- `getEffectiveRoleCodes(prisma, tenant)`: expande `roleCodes` con herencia transitiva (BFS con `visited` Set + tope duro de 20 saltos — anti-ciclo) y alias.
- `getEffectivePermissions(prisma, tenant)`: `RolePermission` de los roles efectivos, agregado con **DENY ganando sobre ALLOW** sin importar el orden de llegada.
- `requireRole(roleCodes: string[])`: firma sin cambios; evalúa contra roles efectivos.
- `requirePermission(permissionCode: string)`: helper **nuevo**, opt-in. Fail-safe hacia **denegar** (a diferencia de `requireRole`, que hace fail-safe hacia "mismo comportamiento de antes") — apropiado porque es un gate nuevo que aún no gobierna nada heredado; sin seed aplicado, deniega a todos por diseño.

## 4. Catálogo de `Permission` (182 permisos)

**Criterio**: `resource` = dominio del router (nombre de archivo sin `.router.ts`; prefijo `ece.` para `packages/trpc/src/routers/ece/*`). `action` = clasificado por proximidad de `.query(`/`.mutation(` inmediatamente después de cada `requireRole([...])` real (`read`/`write`), o `access` cuando el helper de procedure se reusa en endpoints mixtos y no se pudo clasificar con certeza mecánica. **No es 1 permiso por procedure** — se agrupó por recurso.acción lógica: 154 permisos derivados mecánicamente de 375 call sites reales + 26 del seed MVP original (`seed.ts`) + 2 finos agregados a mano para las pruebas de concepto (`accounting.post`, `rbac.manage`).

Metodología reproducible: script que recorre cada router, extrae los `requireRole([...])` (regex sobre AST simplificado, no parser completo — suficiente porque el estilo del código es uniforme), agrupa por `(resource, action)` y produce el catálogo + el mapeo rol→permisos (usado para §5).

## 5. Seed de `RolePermission` — espejo del estado actual (489 grants)

**Crítico**: esta siembra **no cambia el enforcement de `requireRole`** (que sigue comparando arrays literales). Es preparación de datos para `requirePermission()` — sólo los 3 procedures de prueba de concepto (§6) la consultan en runtime hoy. Se generó automáticamente: para cada `(rol, router)` donde el rol aparece en al menos un `requireRole([...])` de ese router, se otorga `ALLOW` al permiso `(resource, action)` correspondiente. 489 pares `(rol, permiso)` cubriendo los 45 roles reales.

## 6. `requirePermission` — 3 procedures de prueba de concepto (NO se migraron los 375 restantes)

| Procedure | Antes | Ahora | Permiso | Roles otorgados en el seed (espejo exacto) |
|---|---|---|---|---|
| `accounting.journal.post` | `requireRole(["ACCOUNTANT","ACCOUNTANT_SENIOR","ADMIN"])` | `requirePermission("accounting.post")` | `accounting.post` | ACCOUNTANT, ACCOUNTANT_SENIOR, ADMIN |
| `rbac.purgeInactiveUsers` | `requireRole(["DIR","super_admin"])` | `requirePermission("rbac.manage")` | `rbac.manage` | DIR, super_admin |
| `userAdmin.resetPassword` | Chequeo manual `UserOrganizationRole.findMany` + `role.code === "ADMIN"` (TODO histórico: *"gate por requireRole(['ADMIN']) cuando el helper esté disponible"*) | `requirePermission("user.manage")` | `user.manage` (ya existía en el seed MVP) | ADMIN |

Cada migración se verificó con tests que mockean el grant exacto del seed (`prisma.role.findMany` + `prisma.rolePermission.findMany`) y confirman que el mismo conjunto de roles que pasaba antes sigue pasando ahora — ver `accounting.test.ts` (describe `journal.post`), `audit-rbac.test.ts` (describe `rbac.purgeInactiveUsers`), `user-admin-reset-password.test.ts`.

## 7. Mapeo de alias — resueltos (evidencia directa en código) vs pendientes

### Resueltos (sembrados en `RoleCodeAlias`, globales)

| sourceCode | canonicalCode | Evidencia |
|---|---|---|
| `MEDICO` | `PHYSICIAN` | `blood-bank.router.ts:37`: `const PHYSICIAN_ROLES = ["PHYSICIAN", "MEDICO"];` — equivalencia declarada explícitamente en el propio código. |
| `MC` | `PHYSICIAN` | Co-ocurren juntos en decenas de `requireRole(["MC","PHYSICIAN"])` (certificado-defuncion, consentimiento, indicaciones-medicas...). `docs/flujos/CERT_DEF.md:75`: *"MC / PHYSICIAN (Médico Tratante o Médico de Turno)"* — mismo actor, dos convenciones de nombre. |
| `ENF` | `NURSE` | Co-ocurren en 9+ routers como par redundante (`["NURSE","ENF"]`, `indicaciones-medicas.router.ts:282`). |
| `FARM` | `PHARMACIST` | Co-ocurren directamente: `gs1-proceso-c.router.ts:133`: `requireRole(["PHARMACIST","NURSE","ENF","FARM"])`. |
| `ANES` | `ANEST` | Mismo rol real (anestesiólogo) con dos abreviaturas; `ANEST` es el código canónico sembrado en `sql/75_specialized_roles.sql`. `ANES` no co-ocurre con ningún otro código de anestesiólogo — variante de un solo autor. |
| `SUPER_ADMIN` | `super_admin` | Variante de casing puro del mismo código (`rbac.router.ts`: `SUPER_ADMIN_CODE = "super_admin"`, comparación case-insensitive vía `.toLowerCase()` en `isSuperAdmin()`; `requireRole` en cambio es case-sensitive, así que sin este alias `requireRole(["super_admin"])` NO reconocía a un rol literal `SUPER_ADMIN`). |

### Pendientes — investigados, NO se inventó un alias

| Código | Por qué queda pendiente |
|---|---|
| `MT` | Ambiguo: `docs/flujos/ATN_EMERG.md:62` documenta *"MEDICO_URGENCIAS (MT / PHYSICIAN)"* (MT ≈ PHYSICIAN), pero `docs/flujos/ACT_QX.md:66` dice *"rol HIS PHYSICIAN, rol ECE ESP o MT"* (MT tratado como alternativa a ESP, el rol de especialista). El significado de MT cambia según contexto clínico — aliasearlo a PHYSICIAN sería incorrecto en los routers donde en realidad se usa como código de especialista. |
| `PHARM` | Candidato obvio a `PHARMACIST` por semántica, pero **nunca co-ocurren** en el mismo `requireRole([...])` en ningún router (9 archivos usan `PHARM`, 3 usan `PHARMACIST`, cero solapamiento) — sin evidencia de equivalencia operativa, no se infiere. |
| `ADM` vs `ADMIN` | Investigado y **descartado explícitamente** como alias: co-ocurren en el mismo array repetidamente (`requireRole(["ADM","DIR","ADMIN"])`, `ece-bridge-patient.router.ts`) como **roles distintos y complementarios**, no como sinónimos — el patrón indica que ambos deben tener acceso independientemente, no que sean la misma entidad. |
| `DIR` vs `DIRECTOR` vs `MEDICAL_DIRECTOR` | Descartado: `user-service-unit.router.ts:32` los agrupa explícitamente como roles cross-servicio **distintos** (`ADMIN_ROLES = ["ADMIN","DIR","DIRECTOR","MEDICAL_DIRECTOR"]`), igual que `CROSS_SERVICE_ROLE_CODES` en `packages/contracts/src/types/index.ts` — coexisten por diseño. |
| `ADMIN_CLINICO`, `ADMIN_ORG`, `DIR_MEDICO` | Siempre aparecen emparejados con su código "base" (`ADMIN`/`DIR`) como roles adicionales, no sustitutos — indicio de granularidad intencional, no drift de nomenclatura. |

## 8. UI (`/roles`)

- `apps/web/src/app/(admin)/roles/role-inheritance.tsx` (nuevo): selector "hereda de" en el detalle del rol (`[id]/page.tsx`), con `Select` sobre `rbac.listRoles` filtrando el propio rol. Llama `rbac.setRoleInheritance`; revierte el select ante error del server (auto-herencia, ciclo, boundary tenant).
- `[id]/page.tsx`: agrega la card "Herencia de roles" antes de la matriz de permisos existente + nota explícita de que la matriz alimenta `requirePermission` (hoy sólo los 3 procedures de §6) y que el resto de la plataforma sigue en `requireRole` (que sí respeta la herencia).
- `rbac.router.ts` gana `setRoleInheritance`, `listRoleAliases`, `setRoleAlias`, `deleteRoleAlias` — mismos boundaries tenant/global que el resto de RBAC (global sólo `super_admin`).

## 9. Qué queda para F2 y F3

- **F2 — ABAC persistente**: hoy el "Nivel A" de scope por servicio (`assignedServiceUnitIds`/`isCrossServiceRole` en `TenantContext`) vive en `session.ts`, no en el motor de `effective-roles.ts`. Migrar los 375 call sites restantes a `requirePermission` es trabajo de F2 (uno a la vez, con el mismo patrón de tests demostrado aquí — no en bloque).
- **F2 — cache real por-request**: si el profiling muestra que las 1-3 queries extra por `requireRole` importan, implementar un cache atado al ciclo de vida real del request HTTP (no a la identidad de un objeto JS reusable — ver §2 "Caching — evaluado y descartado").
- **F3 — break-glass en enforcement**: `app.is_break_glass` existe como GUC de RLS pero no tiene lectura en `requireRole`/`requirePermission`. Definir semántica (¿bypass total? ¿requiere permiso `*.break_glass`? ¿auditoría reforzada?) antes de cablearlo.
- **Aliases pendientes** (§7): `MT`, `PHARM` requieren decisión de negocio (no técnica) — Edwin/DIR debe confirmar si "Médico Tratante" es siempre PHYSICIAN o si hay casos donde debe seguir siendo tratado como ESP.

## 10. Verificación

- `npm run -w @his/contracts typecheck` — verde.
- `npm run -w @his/trpc typecheck` — verde.
- `npm run -w @his/web typecheck` — verde.
- `npx vitest run --root packages/trpc` — **2759 passed, 0 failed, 24 skipped** (mismo skip count que antes de CC-0017; los 2717 tests preexistentes + 42 nuevos de este CC, sin que ninguno de los 2717 se haya tenido que reescribir por *comportamiento* — sólo 3 archivos (`audit-rbac.test.ts`, `accounting.test.ts`, `user-admin-reset-password.test.ts`) necesitaron mocks nuevos porque sus 3 procedures fueron **migradas intencionalmente** a `requirePermission` en esta misma fase).
- Identidad de comportamiento del caso base demostrada en `packages/trpc/src/rbac/__tests__/effective-roles.test.ts` (§1) y `packages/trpc/src/__tests__/rbac-engine.test.ts` (describe "caso base").

## 11. Orden de aplicación (para el orquestador)

1. Revisar y aplicar `packages/database/sql/194_cc0017_rbac_parametrizable.sql` a prod (vía Supabase MCP `apply_migration` o SQL Editor).
2. Verificar con `get_advisors` que las 2 policies nuevas de `RoleCodeAlias` no disparan warnings.
3. UAT manual en `/roles`: crear un rol de prueba heredando de `PHYSICIAN`, confirmar que un `requireRole(["PHYSICIAN"])` real (p.ej. `patient.read`) lo deja pasar sin haber tocado código.
4. Confirmar en logs/Sentry que `accounting.journal.post`, `rbac.purgeInactiveUsers` y `userAdmin.resetPassword` siguen funcionando para los roles esperados post-deploy (el seed SQL debe estar aplicado ANTES del deploy del código, o esos 3 procedures denegarán a todos temporalmente — fail-safe hacia "denegar", no hacia "romper").
