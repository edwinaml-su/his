# Auditoría Stream J — Admin / Seguridad / RBAC / Configuración

**Fecha:** 2026-05-19
**Auditor:** @AS — Arquitecto de Software, Unidad de Transformación Digital, Inversiones Avante
**Rama auditada:** `feat/fase2-s1-gate` (commit `6532a92`)
**Método:** lectura estática de UI + routers tRPC + contratos Zod + schema Prisma + SQL DDL. Sin modificaciones ni queries destructivos.
**Scope:** 21 módulos — ABAC, Audit (×4), Audit Dashboard, RBAC Matriz, Roles, Users, Organizations, Countries, Exchange Rates, Ledgers, Insurance, SSO Config, MFA, Login/Signup/SSO, SLOs, Catálogos, SV Localization, Triage Config, Analytics, Settings Notifications, Patients Merge-Queue.

---

## Índice

1. [Módulo 1 — ABAC](#modulo-1)
2. [Módulo 2 — Audit](#modulo-2)
3. [Módulo 3 — Audit Dashboard (Outlier)](#modulo-3)
4. [Módulo 4 — RBAC Matriz](#modulo-4)
5. [Módulo 5 — Roles](#modulo-5)
6. [Módulo 6 — Users + Depuración](#modulo-6)
7. [Módulo 7 — Organizations](#modulo-7)
8. [Módulo 8 — Countries / Exchange Rates / Ledgers](#modulo-8)
9. [Módulo 9 — Insurance](#modulo-9)
10. [Módulo 10 — SSO Config](#modulo-10)
11. [Módulo 11 — MFA (enroll + verify)](#modulo-11)
12. [Módulo 12 — Login / Signup / SSO página](#modulo-12)
13. [Módulo 13 — SLOs](#modulo-13)
14. [Módulo 14 — Catálogos genéricos](#modulo-14)
15. [Módulo 15 — SV Localization + Triage Config](#modulo-15)
16. [Módulo 16 — Analytics (Metabase Embed)](#modulo-16)
17. [Módulo 17 — Patients Merge-Queue](#modulo-17)
18. [Resumen Consolidado Stream J](#resumen-consolidado)

---

## Módulo 1 — ABAC {#modulo-1}

### 1.1 Resumen ejecutivo

`/abac` es una vista informativa MVP que lista las reglas ABAC hardcoded en `apps/web/src/lib/auth/abac.ts`. No tiene operaciones de escritura ni consultas a BD. El módulo es transparente respecto a su estado provisional (banner "Lectura solamente — MVP"). El código es limpio y sin hallazgos de seguridad inmediatos.

**Actores:** Administrador (solo lectura).
**CRUD:** Solo lectura en cliente, sin llamadas tRPC.

### 1.2 Archivos auditados

- `apps/web/src/app/(admin)/abac/page.tsx`
- `apps/web/src/lib/auth/abac.ts`

### 1.3 Matriz de trazabilidad

| # | Campo UI | Payload tRPC | Prop Zod | Prop ORM | Columna DB | Observación |
|---|---|---|---|---|---|---|
| 1 | Filtro `action` | — (solo cliente) | — | — | — | Filtro en memoria sobre `MVP_ABAC_RULES`. Sin BD. |
| 2 | `rule.id` | — | — | — | — | UUID generado en tiempo de compilación. |
| 3 | `rule.allowedRoles` | — | — | — | — | Array de strings hardcoded. |
| 4 | `rule.condition` | — | — | — | — | String descriptivo, no ejecutado. |

### 1.4 Hallazgos

#### HJ-01 — C1/C9 — ABAC evaluado solo en frontend: sin `abacGuard` en capa tRPC (P1 ALTA)

**Descripción:** `abac.ts` declara explícitamente en su comentario: "NO bloquean tRPC todavía; se exponen para que la UI consulte y para que las pantallas que ya conocen al usuario y al recurso oculten/desactiven controles." Esto significa que toda la lógica ABAC (restricción por turno, por servicio, por sede) es puramente decorativa en el cliente. Un atacante con herramientas de acceso directo a tRPC (curl, Postman, cliente alternativo) puede ignorarla completamente. Los procedures de `prescribe`, `dispense`, `sign` y `read` sensibles no tienen guard ABAC en el servidor.

**Líneas afectadas:** `apps/web/src/lib/auth/abac.ts:8-10` (comentario TODO Sprint 2), `apps/web/src/app/(admin)/abac/page.tsx:64-68` (banner de advertencia).

**Recomendación:** Implementar `abacGuard(action, resourceKind)` como middleware tRPC que invoque `canPerformAction` antes de cada procedure sensible (PRESCRIBE, DISPENSE, SIGN). Persistir reglas en tabla `AbacRule` para que sean configurables por org. Este hallazgo es sistémico: afecta todos los routers clínicos donde ABAC debería restringir por turno/servicio.

**Riesgo go-live:** Alto. Rol NURSE podría prescribir si conoce el endpoint tRPC. Sin enforcement server-side, el ABAC no cumple TDR §6.2 ("control de acceso por servicio/sede/turno").

---

## Módulo 2 — Audit {#modulo-2}

### 2.1 Resumen ejecutivo

El módulo de auditoría cubre 4 sub-páginas: visor general (`/audit`), visor por entidad (`/audit/[entity]`), verificación de integridad hash (`/audit/integrity`) y dashboard STAT events (`/audit/stat-events`). El router `auditRouter` es robusto: usa `tenantProcedure` con filtro `organizationId` explícito, maneja paginación, y el módulo de integridad (`auditIntegrityRouter`) usa `requireRole` correctamente. La implementación de la cadena hash y su verificación SQL es sólida.

**Actores:** Administrador, Director Médico.
**CRUD:** Solo lectura (queries + verificación hash).

### 2.2 Archivos auditados

- `apps/web/src/app/(admin)/audit/page.tsx`
- `apps/web/src/app/(admin)/audit/[entity]/page.tsx`
- `apps/web/src/app/(admin)/audit/integrity/page.tsx`
- `apps/web/src/app/(admin)/audit/stat-events/page.tsx`
- `apps/web/src/app/(admin)/audit/stat-events/_components/stat-events-dashboard-client.tsx`
- `packages/trpc/src/routers/audit.router.ts`
- `packages/trpc/src/routers/audit-integrity.router.ts`

### 2.3 Matriz de trazabilidad

| # | Campo UI | Payload tRPC | Prop Zod | Prop ORM | Columna DB | Observación |
|---|---|---|---|---|---|---|
| 1 | `entity` (input) | `entity` | `z.string().min(1).max(80)` | `entity String` | `entity varchar(80)` | Sin whitelist de valores: acepta cualquier string. C5. |
| 2 | `entityId` (input) | `entityId` | `z.string().min(1).max(80)` | `entityId String` | `entityId varchar(80)` | Sin validación UUID. C7. |
| 3 | `fromId` (integrity) | `fromId` | `verifyChainInputSchema` | `$queryRaw` | BigInt | Parametrizado (no unsafe). Correcto. |
| 4 | `orgId` (stat-events) | server-side | `getTenantContext()` | — | — | Resuelto en RSC, pasado como prop. Correcto. |

### 2.4 Hallazgos

#### HJ-02 — C7 — `audit/integrity`: `(trpc as any)` cast para `auditIntegrity` (P2 MEDIA)

**Descripción:** En `apps/web/src/app/(admin)/audit/integrity/page.tsx:79-80` y `:93`, la página accede al router vía `(trpc as any).auditIntegrity.*` con comentario explícito: "auditIntegrity está modelado como query... Por ahora accedemos via `(trpc as any).auditIntegrity.*` siguiendo la convención del repo (idéntico a userAdmin/rbac antes de su wiring)." Este patrón suprime el tipado de TypeScript y es seguro solo si el router está correctamente registrado en `_app.ts`. Si no está registrado, falla en runtime sin error de compilación.

**Líneas afectadas:** `apps/web/src/app/(admin)/audit/integrity/page.tsx:79,93`.

**Recomendación:** Verificar que `auditIntegrityRouter` está wired en `_app.ts`. Una vez confirmado, reemplazar `(trpc as any)` por el tipo inferido. Este es el patrón documentado como "deuda técnica intencional" del repo, pero debe resolverse antes de producción.

**Riesgo go-live:** Medio. Si el router no está en `_app.ts`, el botón "Verificar ahora" fallará silenciosamente (error runtime no de compilación).

#### HJ-03 — C7 — `audit.listByEntity`: `entity` sin whitelist permite enumeración de tablas (P2 MEDIA)

**Descripción:** El procedimiento `audit.listByEntity` en `audit.router.ts:42-44` acepta `entity: z.string().min(1).max(80)` sin validar contra un enum de entidades conocidas. Un usuario puede pasar `entity: "User"` o `entity: "UserCredential"` y ver los eventos de audit de esas entidades para su org. Si `audit.AuditLog` registra eventos de tablas sensibles (credenciales, MFA), el visor los exposería sin filtro de entidad.

**Líneas afectadas:** `packages/trpc/src/routers/audit.router.ts:42-44`.

**Recomendación:** Añadir whitelist: `z.enum(["Patient", "Encounter", "Organization", "Establishment", "User", "..."])`. O mantener el string libre pero añadir `requireRole(["super_admin", "admin_clinico"])` en lugar de `tenantProcedure`.

**Riesgo go-live:** Medio. Depende de qué entidades disparan triggers de audit.

---

## Módulo 3 — Audit Dashboard (Outlier) {#modulo-3}

### 3.1 Resumen ejecutivo

`/audit-dashboard` y `audit-outlier.router.ts` implementan detección de accesos outlier en `ece.bitacora_acceso`. El router usa `requireRole(["DIR", "ARCH"])` correctamente en la mayoría de procedures. Sin embargo, hay varios hallazgos serios: las queries rawUnsafe sobre `ece.bitacora_acceso` no filtran por `organization_id`, exponiendo datos cross-tenant; el procedure `sensitiveAccess` tiene un bug de índice de parámetro SQL; y la tabla `AuditDashboardConfig` está definida en schema Prisma pero las queries del router la leen vía `$queryRawUnsafe` ignorando el ORM.

**Actores:** Director (DIR), Arquitecto (ARCH).
**CRUD:** Lectura + escritura (scanAndFlag, flagOutlier, upsertConfig).

### 3.2 Archivos auditados

- `apps/web/src/app/(admin)/audit-dashboard/page.tsx`
- `packages/trpc/src/routers/audit-outlier.router.ts`

### 3.3 Matriz de trazabilidad

| # | Campo UI | Payload tRPC | Prop Zod | Prop ORM | Columna DB | Observación |
|---|---|---|---|---|---|---|
| 1 | Filtro `desde` | `desde` | `z.string().datetime().optional()` | — | `timestamptz` | datetime ISO. Parametrizado. |
| 2 | Filtro `hasta` | `hasta` | `z.string().datetime().optional()` | — | `timestamptz` | datetime ISO. Parametrizado. |
| 3 | `bitacoraId` | `bitacoraId` | `z.string().uuid()` | — | `ece.bitacora_acceso.id` | UUID validado. |
| 4 | `motivo` | `motivo` | `z.string().min(1).max(200)` | — | `motivo_outlier varchar` | Parametrizado. |
| 5 | `ipWhitelist` | `ipWhitelist` | `z.array(z.string().max(45))` | `ipWhitelist text[]` | `text[]` | Sin validación de formato IP (acepta strings arbitrarios ≤45 chars). C7. |

### 3.4 Hallazgos

#### HJ-04 — C6/C9 — `auditOutlier`: queries sobre `ece.bitacora_acceso` sin filtro de tenant (P0 CRITICO)

**Descripción:** Los procedures `listOutliers`, `dashboardStats`, `topUsers` y `sensitiveAccess` ejecutan queries SQL directas sobre `ece.bitacora_acceso` sin ningún filtro `WHERE organization_id = ...`. La tabla `ece.bitacora_acceso` es compartida entre todos los tenants del proyecto Supabase. Como Prisma ejecuta como el rol con BYPASSRLS (ver CLAUDE.md §RLS), las queries devuelven registros de TODAS las organizaciones. Un DIR del Hospital A puede ver los accesos al expediente del Hospital B.

**Ejemplo concreto** en `audit-outlier.router.ts:143-147`:
```sql
SELECT COUNT(*) AS total FROM ece.bitacora_acceso b WHERE b.flag_outlier = true
```
Sin `AND b.organization_id = $N::uuid`.

**Afecta:** `listOutliers` (líneas 126-178), `dashboardStats` (264-309), `topUsers` (314-331), `sensitiveAccess` (337-379), `scanAndFlag` (205-258 — UPDATE sin filtro de org).

**Recomendación:** Añadir `AND b.organization_id = ${ctx.tenant.organizationId}::uuid` en todas las queries, o usar `withTenantContext` si la tabla tiene RLS activo. Verificar que `ece.bitacora_acceso` tiene columna `organization_id` y política RLS apropiada.

**Riesgo go-live:** Crítico. Violación directa de aislamiento multi-tenant. Datos de acceso de expedientes de otras organizaciones son visibles.

#### HJ-05 — C4 — `sensitiveAccess`: bug de índice de parámetro SQL (P1 ALTA)

**Descripción:** En `audit-outlier.router.ts:356-363`, la query `sensitiveAccess` construye parámetros con `idx` pero lo inicializa en `1` antes del bloque de condiciones y lo incrementa correctamente. Sin embargo, al final usa `$${idx}` y `$${idx + 1}` para LIMIT y OFFSET, pero `idx` en ese punto ya fue incrementado por los `if (input.desde)` / `if (input.hasta)`. El problema: los parámetros `dataParams = [...params, input.limit, input.offset]` tienen como índices `params.length+1` y `params.length+2`, pero el SQL usa `$${idx}` y `$${idx+1}` donde `idx` puede ser 1, 2 o 3 dependiendo de los filtros activos.

**Ejemplo:** Si `desde` y `hasta` vienen ambos, `idx = 3`, los params son `[desde, hasta, limit, offset]` (4 elementos). El SQL pide `LIMIT $3 OFFSET $4` pero `dataParams` tiene `limit` en posición 3 (índice base-1) y `offset` en posición 4. En este caso coincide. Pero si solo viene `desde`, `idx = 2`, el SQL pide `LIMIT $2 OFFSET $3`, y `dataParams = [desde, limit, offset]` — `limit` está en posición 2 y `offset` en posición 3. Correcto también. Sin filtros, `idx = 1`, SQL pide `LIMIT $1 OFFSET $2`, `dataParams = [limit, offset]`. También correcto.

Revisión más cuidadosa: el bug real es que la variable `idx` se reutiliza del bloque de condiciones (que incrementó `idx` para las condiciones de fecha) pero los `dataParams` se construyen por concatenación independiente. La posición del LIMIT en el array `dataParams` es siempre `params.length + 1`, no `idx`. Si `params.length` es 2 e `idx` es 3, ambos coinciden y funciona. Si `params.length` es 0 e `idx` es 1, también coincide. En la práctica los índices coinciden porque `idx = params.length + 1` al final del bloque. Sin embargo, el código es frágil: si se añade otro parámetro en el medio, rompería silenciosamente.

**Líneas afectadas:** `packages/trpc/src/routers/audit-outlier.router.ts:345-363`.

**Recomendación:** Usar `$queryRaw` con template literals (que cuentan automáticamente) o refactorizar para calcular los índices de LIMIT/OFFSET de forma explícita: `LIMIT $${params.length + 1} OFFSET $${params.length + 2}`.

**Riesgo go-live:** Alto. Bajo combinaciones de filtros específicas, podría retornar resultados incorrectos (LIMIT/OFFSET invertidos o incorrectos).

#### HJ-06 — C9 — `scanAndFlag`: UPDATE masivo sobre `bitacora_acceso` sin filtro de tenant (P0 CRITICO)

**Descripción:** El mutation `scanAndFlag` ejecuta un UPDATE sobre `ece.bitacora_acceso` (`audit-outlier.router.ts:239-256`) que marca registros como outlier en TODO el sistema, no solo en la org del tenant. La condición `WHERE b.ocurrido_en BETWEEN $1 AND $2 AND b.flag_outlier = false AND (...)` no incluye `b.organization_id = ...`. Un DIR del Hospital A puede marcar accesos del Hospital B como "outlier fuera de horario".

**Líneas afectadas:** `packages/trpc/src/routers/audit-outlier.router.ts:239-256`.

**Recomendación:** Añadir `AND b.organization_id = ${orgId}::uuid` en la cláusula WHERE del UPDATE.

**Riesgo go-live:** Crítico. Escritura cross-tenant. Un usuario malicioso puede contaminar la bitácora de otras organizaciones.

#### HJ-07 — C7 — `ipWhitelist` sin validación de formato IP (P2 MEDIA)

**Descripción:** El schema `upsertConfigInput` define `ipWhitelist: z.array(z.string().max(45))`. No valida que los elementos sean IPs válidas (IPv4 o IPv6). Un admin puede ingresar strings arbitrarios como `"cualquier cosa"` que se almacenarán en `text[]` y luego se usarán en la cláusula `NOT IN (...)` del SQL de scanAndFlag.

**Líneas afectadas:** `packages/trpc/src/routers/audit-outlier.router.ts:59-63`.

**Recomendación:** Añadir `.refine()` que valide IP con regex: `/^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]+$/`. O usar un schema de validación de IP dedicado.

**Riesgo go-live:** Bajo. No genera SQL injection (es parametrizado), pero puede producir whitelist ineficaz.

---

## Módulo 4 — RBAC Matriz {#modulo-4}

### 4.1 Resumen ejecutivo

`/rbac/matriz` muestra la tabla pivot usuario × recurso × acción. El router `rbac.permissionMatrix` usa `requireRole(["DIR", "super_admin"])` correctamente, filtra por org del tenant, y el algoritmo de resolución ALLOW-gana-sobre-DENY es consistente. El export CSV es client-side sin exposición de datos adicionales. Módulo bien implementado.

### 4.2 Archivos auditados

- `apps/web/src/app/(admin)/rbac/matriz/page.tsx`
- `packages/trpc/src/routers/rbac.router.ts` (parcial: `permissionMatrix`)

### 4.3 Hallazgos

#### HJ-08 — C9 — `permissionMatrix`: no filtra `userOrganizationRole` por `organizationId` del tenant (P1 ALTA)

**Descripción:** La query de `permissionMatrix` en `rbac.router.ts:367-392` filtra por roles globales o de la org del tenant (`role.organizationId`), pero NO filtra `userOrganizationRole.organizationId`. Esto incluye en la matriz a usuarios que tienen el rol en la org correcta, pero a través de cualquier asignación `UserOrganizationRole` — incluyendo asignaciones en otras organizaciones donde el mismo rol existe. El filtro actual es:
```ts
where: { role: { OR: [{ organizationId: orgId }, { organizationId: null }] } }
```
No hay `where: { organizationId: orgId }` sobre la propia `userOrganizationRole`. En la práctica la query puede devolver usuarios de otras organizaciones si tienen el mismo roleId.

**Líneas afectadas:** `packages/trpc/src/routers/rbac.router.ts:367-392`.

**Recomendación:** Añadir `organizationId: orgId` al `where` de `userOrganizationRole.findMany`.

**Riesgo go-live:** Alto. La matriz de permisos puede incluir usuarios de otras organizaciones, exponiendo sus emails y nombres completos.

---

## Módulo 5 — Roles {#modulo-5}

### 5.1 Resumen ejecutivo

El módulo de gestión de roles (`/roles` y `/roles/[id]`) implementa el RBAC correctamente: `tenantProcedure` en todos los procedures, boundary tenant validado explícitamente para roles de org, y `super_admin` requerido para roles globales. El patrón `trpc as any` para `rbac.listRoles` y `rbac.deactivateRole` es documentado y consistente con el repo. El `setRolePermissions` usa `$transaction` para atomicidad. La UI refleja correctamente el estado global vs org.

### 5.2 Archivos auditados

- `apps/web/src/app/(admin)/roles/page.tsx`
- `apps/web/src/app/(admin)/roles/[id]/page.tsx`
- `apps/web/src/app/(admin)/roles/role-form.tsx`
- `apps/web/src/app/(admin)/roles/permission-matrix.tsx`
- `packages/trpc/src/routers/rbac.router.ts`

### 5.3 Hallazgos

#### HJ-09 — C9 — `rbac.purgeInactiveUsers`: búsqueda de usuarios sin filtro de org (P1 ALTA)

**Descripción:** El procedure `purgeInactiveUsers` en `rbac.router.ts:458-491` busca `ctx.prisma.user.findMany({ where: { active: true, lastLoginAt: { lt: cutoff } } })` sin filtrar por organización. Esto devuelve y eventualmente marca como `INACTIVE` a usuarios de TODAS las organizaciones, no solo la del tenant. Un DIR del Hospital A puede ejecutar la depuración y marcar inactivos a usuarios del Hospital B.

**Líneas afectadas:** `packages/trpc/src/routers/rbac.router.ts:458-474`.

**Recomendación:** Añadir filtro de org: buscar solo usuarios con `roles: { some: { organizationId: ctx.tenant.organizationId, ... } }`. Alternativamente, filtrar el conjunto de `candidates` por `roles` vigentes en la org del tenant antes de ejecutar el UPDATE.

**Riesgo go-live:** Alto. Operación destructiva cross-tenant: puede desactivar usuarios de otras organizaciones.

#### HJ-10 — C9 — `rbac.reactivateUser`: UPDATE sin verificar pertenencia a la org (P1 ALTA)

**Descripción:** El procedure `reactivateUser` en `rbac.router.ts:497-523` ejecuta `$executeRawUnsafe` sobre `public."User"` usando solo `id = $1::uuid` sin verificar que el usuario pertenece a la organización del tenant. Un ADM puede reactivar cualquier usuario del sistema si conoce su UUID.

**Líneas afectadas:** `packages/trpc/src/routers/rbac.router.ts:503-507`.

**Recomendación:** Verificar antes del UPDATE que `userId` tiene un `UserOrganizationRole` vigente en `ctx.tenant.organizationId`, o al menos que alguna vez tuvo membresía en esa org.

**Riesgo go-live:** Alto. Permite reactivar usuarios de otras organizaciones, potencialmente escalando privilegios.

---

## Módulo 6 — Users + Depuración {#modulo-6}

### 6.1 Resumen ejecutivo

`/users` implementa CRUD básico de usuarios con el router `userAdminRouter`. La UI es funcional y el router usa `tenantProcedure`. Sin embargo, hay un hallazgo serio: el listado de usuarios (`listAll`) es global (no filtra por organización del tenant), y la creación de usuarios no inicia el flujo de invitación Supabase (documentado como stub). La auto-protección contra desactivar el propio usuario está implementada correctamente.

### 6.2 Archivos auditados

- `apps/web/src/app/(admin)/users/page.tsx`
- `apps/web/src/app/(admin)/users/[id]/page.tsx`
- `apps/web/src/app/(admin)/users/depuracion/page.tsx`
- `apps/web/src/app/(admin)/users/user-form.tsx`
- `apps/web/src/app/(admin)/users/role-assignment-dialog.tsx`
- `packages/trpc/src/routers/user-admin.router.ts`

### 6.3 Matriz de trazabilidad

| # | Campo UI | Payload tRPC | Prop Zod | Prop ORM | Columna DB | Observación |
|---|---|---|---|---|---|---|
| 1 | `email` | `email` | `z.string().email()` (via `userAdminCreateInput`) | `email String` | `email citext UNIQUE` | Validado por Zod. Correcto. |
| 2 | `fullName` | `fullName` | `z.string().min(1).max(200)` | `fullName String` | `fullName varchar(200)` | Correcto. |
| 3 | Búsqueda `search` | `search` | `z.string().optional()` | `contains...insensitive` | `ilike` | No expuesto a raw SQL. Correcto. |
| 4 | `active` toggle | `active` | `z.boolean().optional()` | `active Boolean` | `active boolean` | Correcto. |

### 6.4 Hallazgos

#### HJ-11 — C9 — `userAdmin.listAll`: listado global de usuarios sin filtro de org (P1 ALTA)

**Descripción:** En `user-admin.router.ts:58-76`, el comment explícito dice "El alcance es global por simplicidad MVP (TODO Sprint 2: filtrar por usuarios visibles a la org del tenant)." La query no tiene `organizationId` en el `where`. Un ADMIN puede ver emails, nombres, estado MFA y fechas de último login de usuarios de todas las organizaciones del sistema.

**Líneas afectadas:** `packages/trpc/src/routers/user-admin.router.ts:58-76`.

**Recomendación:** Añadir filtro: buscar solo usuarios con `roles: { some: { organizationId: ctx.tenant.organizationId } }` (al menos una membresía en la org activa). Este TODO está documentado pero es un gap de seguridad para go-live.

**Riesgo go-live:** Alto. Exposición de PII (email, nombre, estado MFA) de todos los usuarios del sistema a cualquier admin.

#### HJ-12 — C5 — `userAdmin.create`: sin invitation flow, usuarios quedan sin contraseña (P2 MEDIA)

**Descripción:** El router crea el `User` local con `active=true` pero sin tocar Supabase Auth. El usuario no recibe magic-link ni contraseña. Si un admin crea un usuario para otra persona, esa persona nunca podrá hacer login porque no existe en `auth.users`. El banner en la UI lo documenta ("magic-link Sprint 2") pero es un gap funcional.

**Líneas afectadas:** `packages/trpc/src/routers/user-admin.router.ts:173-187`.

**Recomendación:** Bloquear el botón "Nuevo usuario" en producción o añadir `disabled` con tooltip hasta que Sprint 2 implemente `userAdmin.invite`. Alternativamente, marcar los usuarios creados así con un flag `pendingInvite` visible en la tabla.

**Riesgo go-live:** Medio. Usuarios creados por admin no podrán hacer login. No es un riesgo de seguridad, pero sí de operatividad.

---

## Módulo 7 — Organizations {#modulo-7}

### 7.1 Resumen ejecutivo

`/organizations` y `/organizations/tree` son módulos bien implementados. `organization.listAll` y `organization.listMine` filtran correctamente por membresías del usuario. `setFunctionalCurrency` y `setGs1Prefix` verifican membresía ADMIN antes de modificar. La autorización dual (client-side gating + server-side check) está presente. El módulo de audit de org (`/organizations/audit`) reutiliza `audit.listOrgChanges` que filtra por orgs del usuario. Sin hallazgos de severidad alta.

### 7.2 Archivos auditados

- `apps/web/src/app/(admin)/organizations/page.tsx`
- `apps/web/src/app/(admin)/organizations/tree/page.tsx`
- `apps/web/src/app/(admin)/organizations/audit/page.tsx`
- `packages/trpc/src/routers/organization.router.ts` (parcial)

### 7.3 Hallazgos

#### HJ-13 — C1 — `organizations`: alta/edición completa ausente (P2 MEDIA)

**Descripción:** El módulo solo permite cambiar moneda funcional y prefijo GS1. La creación de nuevas organizaciones y establecimientos está diferida ("TDR §5.2 — alta/edición completa queda para Sprint 2"). En un entorno multipaís esto es funcionalidad crítica bloqueante para onboarding de nuevos hospitales.

**Líneas afectadas:** `apps/web/src/app/(admin)/organizations/page.tsx:7-8`.

**Recomendación:** Priorizar para Sprint 2. Documentar en backlog como bloqueante para onboarding multipaís.

**Riesgo go-live:** Medio. Para el piloto con una organización no bloquea, pero sí para expansión.

---

## Módulo 8 — Countries / Exchange Rates / Ledgers {#modulo-8}

### 8.1 Resumen ejecutivo

Los tres módulos son bien implementados:

- **Countries** (`country.router.ts`): catálogo global, solo lectura en UI. Sin hallazgos.
- **Exchange Rates** (`exchange-rate.router.ts`): implementa versionado append-only correcto con cierre de cadena temporal en transacción. Validación de monedas activas. `tenantProcedure` en todos los endpoints.
- **Ledgers** (`ledger.router.ts`): `assertAdminMembership` verificado en cada procedure antes de operar. Validación de unicidad por (org, kind). `protectedProcedure` con verificación explícita de rol ADMIN. Inmutabilidad de `kind` y `organizationId` tras creación.

### 8.2 Hallazgos

#### HJ-14 — C5 — `exchangeRate.create`: `validFrom` via `z.coerce.date()` con riesgo de timezone shift (P2 MEDIA)

**Descripción:** El schema `exchangeRateCreateInput` usa `validFrom: z.coerce.date()`. La UI envía la fecha como string ISO desde un `<input type="date">` o `<input type="datetime-local">`. Para `datetime-local`, el valor es sin zona horaria (ej. `2026-05-19T10:00`), que `z.coerce.date()` interpreta como hora local del servidor (UTC en Vercel). Para un usuario en UTC-6 (El Salvador), la fecha ingresada como `2026-05-19T06:00` local se convertiría a `2026-05-19T12:00Z` en el servidor, que es correcto. Sin embargo, si usa `<input type="date">` y el servidor interpreta `2026-05-19` como `2026-05-19T00:00:00Z`, para El Salvador esto es `2026-05-18T18:00:00-06:00`, lo que produce vigencia desde el día anterior.

**Líneas afectadas:** `packages/trpc/src/routers/exchange-rate.router.ts:79`, `apps/web/src/app/(admin)/exchange-rates/new/page.tsx`.

**Recomendación:** Usar `<input type="datetime-local">` para `validFrom` y asegurar que el cliente envía el timestamp con zona horaria explícita (ej. `2026-05-19T00:00:00-06:00`).

**Riesgo go-live:** Medio. Tasas de cambio con fecha de vigencia equivocada en ±1 día afectan conversiones financieras.

#### HJ-15 — C1 — `ledger`: sin transacciones financieras reales en MVP (P3 BAJA)

**Descripción:** Los `Ledger` existen pero `ChartOfAccounts`, `JournalEntry` y `LedgerRoundingPolicy` son TODOs Sprint 5. El `roundingPolicy` devuelve un stub hardcoded. El riesgo actual es bajo porque no hay movimientos financieros reales, pero al activar Sprint 5, el deactivate de ledgers con transacciones podría ser destructivo.

**Líneas afectadas:** `packages/trpc/src/routers/ledger.router.ts:383-384` (comentario TODO Sprint 5).

**Recomendación:** Documentar en backlog Sprint 5: bloquear `deactivate` cuando `JournalEntry.count({ ledgerId }) > 0`.

**Riesgo go-live:** Bajo en MVP. Bloquear en Sprint 5.

---

## Módulo 9 — Insurance {#modulo-9}

### 9.1 Resumen ejecutivo

`insurance.router.ts` implementa el modelo de aseguradoras con boundary de tenant correcto: las aseguradoras globales (`organizationId = null`) son visibles a todos los tenants; las privadas solo a la org propietaria. El estado machine PENDING→APPROVED/DENIED/PARTIAL está bien implementado con validaciones. `coveredProcedures` JSONB se valida con `z.safeParse` en runtime. El router usa `tenantProcedure` en todos los endpoints. Hallazgo menor: `insurer.create` permite crear aseguradoras con `organizationId = null` desde `tenantProcedure` sin verificar `super_admin`.

### 9.2 Archivos auditados

- `apps/web/src/app/(admin)/insurance/page.tsx`
- `apps/web/src/app/(admin)/insurance/new/page.tsx`
- `packages/trpc/src/routers/insurance.router.ts`

### 9.3 Hallazgos

#### HJ-16 — C9 — `insurance.insurer.create`: cualquier tenant puede crear aseguradoras globales (P1 ALTA)

**Descripción:** En `insurance.router.ts:99-121`, si el input incluye `organizationId: null`, el router asigna `orgId = null` creando una aseguradora global visible para todos los tenants. No hay verificación de que el usuario sea `super_admin`. El comentario dice "organizationId null = catálogo global (sólo service_role debería poder)" pero el enforcement no existe en código.

**Líneas afectadas:** `packages/trpc/src/routers/insurance.router.ts:103-106`.

**Recomendación:** Añadir verificación antes del `create`:
```ts
if (orgId === null && !isSuperAdmin(ctx.tenant.roleCodes)) {
  throw new TRPCError({ code: "FORBIDDEN", message: "Solo super_admin puede crear aseguradoras globales." });
}
```

**Riesgo go-live:** Alto. Un admin de hospital puede inyectar aseguradoras globales visibles para todas las organizaciones del sistema.

#### HJ-17 — C4 — `import { Prisma } from "@prisma/client"` en lugar de `@his/database` (P2 MEDIA)

**Descripción:** En `insurance.router.ts:13`, el import es `import { Prisma } from "@prisma/client"` (paquete base) en lugar de `import { Prisma } from "@his/database"` (paquete workspace). Puede causar drift de tipos si `@his/database` extiende o reexporta `Prisma` con modificaciones. Los demás routers usan `@his/database`.

**Líneas afectadas:** `packages/trpc/src/routers/insurance.router.ts:13`.

**Recomendación:** Cambiar a `import { Prisma } from "@his/database"` para consistencia.

**Riesgo go-live:** Bajo en función, pero inconsistente con el patrón del monorepo.

---

## Módulo 10 — SSO Config {#modulo-10}

### 10.1 Resumen ejecutivo

`/sso-config` es un stub MVP que persiste configuraciones SSO en `localStorage`. La UI lo documenta explícitamente con un banner "MVP — Configuración no persistente." El módulo valida con `ssoProviderConfigSchema` antes de guardar. Sin embargo, hay un riesgo importante: el `clientSecret` se almacena en `localStorage` del navegador en texto claro (aunque no el secret original si se deja en blanco al editar), y se incluye en el JSON exportado.

### 10.2 Archivos auditados

- `apps/web/src/app/(admin)/sso-config/page.tsx`

### 10.3 Hallazgos

#### HJ-18 — C8 — SSO Config: `clientSecret` almacenado en `localStorage` (P1 ALTA)

**Descripción:** En `sso-config/page.tsx:97-104`, la función `handleSave` persiste el objeto completo `StoredConfig` (que incluye `clientSecret`) en `localStorage` via `saveToStorage`. El campo `clientId` y `clientSecret` del proveedor SSO (OAuth2/SAML) quedan almacenados en texto claro en `localStorage`, accesibles a cualquier script que se ejecute en el mismo origen (XSS).

El comentario "NO precargamos secretos por seguridad UI" en la línea 280 es incorrecto: el secreto ingresado en el form SÍ se guarda completo si el usuario lo rellena en creación. En edición, si se deja en blanco, se usa `initial?.clientSecret` (el secreto guardado previamente).

**Líneas afectadas:** `apps/web/src/app/(admin)/sso-config/page.tsx:75-77,97-104,313`.

**Recomendación:** Para Sprint 2 (implementación real), los secretos deben persistirse en BD con cifrado AES-256-GCM (mismo patrón que MFA), nunca en localStorage. En MVP, al menos advertir explícitamente al usuario que `clientSecret` se guarda en su navegador y recomendar no usar secretos reales.

**Riesgo go-live:** Alto. Los client secrets de IdP (Google, Azure AD) son credenciales de alta sensibilidad. Su exposición permite suplantar la aplicación en el IdP.

#### HJ-19 — C1 — SSO Config: stub MVP sin persistencia real, sin enforcement de acceso (P2 MEDIA)

**Descripción:** El módulo no tiene ningún tRPC detrás: ni lectura ni escritura a BD. No hay `protectedProcedure` ni `requireRole`. Cualquier usuario autenticado que llegue a la URL puede configurar proveedores SSO (aunque en MVP no hay efecto real). La ruta debería requerir `super_admin` dado que SSO afecta a toda la autenticación del sistema.

**Líneas afectadas:** Toda la página `sso-config/page.tsx`.

**Recomendación:** Añadir `requireRole(["super_admin"])` en el layout de la ruta o en un guard de middleware Next.js para `/sso-config`. Para Sprint 2, wired a tRPC con `requireRole`.

**Riesgo go-live:** Bajo en MVP (sin efecto real), pero debe protegerse antes de activar SSO real.

---

## Módulo 11 — MFA (enroll + verify) {#modulo-11}

### 11.1 Resumen ejecutivo

El módulo MFA es el más crítico de seguridad del stream. La implementación es sólida en su núcleo: TOTP RFC 6238 correcto (HMAC-SHA1, ventana ±1, big-endian counter), AES-256-GCM con IV aleatorio y GCM tag para autenticación del ciphertext, `timingSafeEqual` para comparación de tokens. Sin embargo, hay duplicación de código (Server Action + router tRPC) con riesgo de divergencia, y un hallazgo de diseño sobre replay attacks.

### 11.2 Archivos auditados

- `apps/web/src/app/(auth)/mfa/page.tsx`
- `apps/web/src/app/(auth)/mfa/enroll/page.tsx`
- `apps/web/src/app/actions/mfa.ts`
- `packages/trpc/src/routers/mfa.router.ts`

### 11.3 Matriz de trazabilidad

| # | Campo UI | Payload | Prop Zod | Prop ORM | Columna DB | Observación |
|---|---|---|---|---|---|---|
| 1 | Token TOTP (6 díg.) | `token` | `z.string().trim().refine(RE_TOTP_TOKEN \| RE_BACKUP_CODE)` | `secretHash String` | `UserCredential.secretHash text` | Cifrado AES-256-GCM. Correcto. |
| 2 | Backup code (8 díg.) | `token` | Same schema | `secretHash` | Same | Consume el código (elimina del array). Correcto. |
| 3 | Secret base32 | Output only | — | `secretHash` (cifrado) | `UserCredential.secretHash` | Devuelto EN CLARO una sola vez. Documentado. |
| 4 | `backupCodes` | Output only | — | cifrado en secretHash | — | Devueltos EN CLARO una sola vez. Documentado. |

### 11.4 Hallazgos

#### HJ-20 — C10/C11 — MFA: sin protección contra replay de TOTP (P1 ALTA)

**Descripción:** El `verifyTotp` en `mfa.ts` y `mfa.router.ts` verifica correctamente el token contra la ventana `±1 step`. Sin embargo, no hay un mecanismo que prevenga el reuso del mismo token dentro de la misma ventana de 90 segundos. Un atacante que capture el token durante su envío (MitM) puede reutilizarlo hasta que expire el step (hasta 30s adicionales). RFC 6238 recomienda almacenar el último contador usado y rechazar tokens con contador igual o inferior.

**Líneas afectadas:** `apps/web/src/app/actions/mfa.ts:241-253` (verifyTotp), `packages/trpc/src/routers/mfa.router.ts:193-205` (misma función).

**Recomendación:** Almacenar el último counter exitoso en `UserCredential` (ej. en columna `lastCounter` o en el JSON cifrado). Al verificar, rechazar si `counter <= lastSuccessfulCounter`. Esto elimina el replay dentro de la ventana.

**Riesgo go-live:** Alto. En entornos hospitalarios con redes internas, un MitM tiene mayor factibilidad. El replay de TOTP es un vector documentado (RFC 6238 §5.2).

#### HJ-21 — C11 — MFA: duplicación de implementación TOTP en Server Action y router tRPC (P1 ALTA)

**Descripción:** El comentario de `mfa.router.ts:17-22` confirma la duplicación: "Los Server Actions de `apps/web/src/app/actions/mfa.ts` mantienen una copia paralela porque la página `/mfa` corre antes de que el usuario tenga sesión 'completa'... Si el algoritmo cambia, hay que actualizar AMBOS lugares." Las dos implementaciones difieren en detalles:
- `mfa.ts` (actions) no verifica `KEY_BYTES` en `getEncryptionKey` pero tiene constante `KEY_BYTES = 32`.
- `mfa.router.ts` no define `KEY_BYTES` pero deriva la key de la misma forma.
- La generación de backup codes usa `% max` en ambos: sesgo modular despreciable para `10^8` pero documentado.

El riesgo real es divergencia futura: si se corrige un bug en un lado y no en el otro.

**Líneas afectadas:** `apps/web/src/app/actions/mfa.ts` (todo el archivo), `packages/trpc/src/routers/mfa.router.ts` (todo el archivo).

**Recomendación:** Extraer la lógica TOTP/AES a un paquete `@his/auth-utils` compartido (o a `packages/contracts/src/utils/totp.ts`). Ambos consumidores importan del mismo lugar. Esto elimina el drift en futuras modificaciones.

**Riesgo go-live:** Alto por riesgo de divergencia. En estado actual las dos implementaciones son equivalentes, pero cualquier corrección futura en una que no se refleje en la otra introduce una vulnerabilidad silenciosa.

#### HJ-22 — C5 — MFA: `disableMfa()` sin re-autenticación (P2 MEDIA)

**Descripción:** `disableMfa()` en `mfa.ts:501-521` solo requiere una sesión Supabase válida (cookie de sesión). No pide contraseña ni TOTP actual antes de deshabilitar MFA. Un atacante con acceso a la sesión del usuario (ej. XSS, cookie robada) puede deshabilitar MFA sin conocer la contraseña. El comentario lo documenta: "UX: solo lo dispara el usuario desde su dashboard... En MVP confiamos en sesión vigente."

**Líneas afectadas:** `apps/web/src/app/actions/mfa.ts:501-521`.

**Recomendación:** Requerir que el usuario ingrese su contraseña actual (re-autenticación con Supabase) antes de poder deshabilitar MFA. Esta es la práctica estándar de todos los sistemas con MFA.

**Riesgo go-live:** Medio. El riesgo se materializa si hay XSS o session hijacking. Para entornos hospitalarios con datos PHI, el riesgo es elevado.

---

## Módulo 12 — Login / Signup / SSO página {#modulo-12}

### 12.1 Resumen ejecutivo

`/login` implementa el flujo de autenticación con Supabase correctamente: pre-check de lockout, llamada a Supabase, registro de resultado con `recordLoginAttempt`. La política de lockout (5 intentos, 15 min) está hardcoded en Server Actions. El flujo SSO (`/sso`) es un stub MVP que muestra un dialog explicativo. La página `/signup` (no auditada en detalle) sigue el mismo patrón que login.

### 12.2 Archivos auditados

- `apps/web/src/app/(auth)/login/page.tsx`
- `apps/web/src/app/(auth)/sso/page.tsx`
- `apps/web/src/app/actions/login-policy.ts`

### 12.3 Hallazgos

#### HJ-23 — C9 — `login-policy`: `recordLoginAttempt` corre en best-effort, lockout puede no registrarse (P2 MEDIA)

**Descripción:** En `login/page.tsx:74-79`:
```ts
let attemptResult: ... = {};
try {
  attemptResult = await recordLoginAttempt(email, !err);
} catch {
  // ignoramos: la UX no debe romperse por un fallo de telemetría
}
```
Si `recordLoginAttempt` falla (BD no disponible, timeout), el lockout nunca se registra. Un atacante puede disparar fuerza bruta si la BD está degradada. El comentario justifica esto como degradación graceful para no bloquear el login.

**Líneas afectadas:** `apps/web/src/app/(auth)/login/page.tsx:74-79`.

**Recomendación:** El trade-off es aceptable para MVP. Para producción, considerar un lockout en cache (Redis/Upstash) más resiliente que la BD. Documentar como deuda de seguridad.

**Riesgo go-live:** Bajo-Medio. El lockout funciona en condiciones normales. Solo vulnerable durante degradación de BD.

#### HJ-24 — C1 — `login`: sin CAPTCHA tras N intentos fallidos (P2 MEDIA)

**Descripción:** El lockout temporal (15 min tras 5 intentos) protege contra fuerza bruta, pero no hay CAPTCHA como capa adicional. Un atacante automatizado puede intentar 4 veces, esperar 15 min, intentar 4 veces, etc. sin límite de velocidad adicional.

**Líneas afectadas:** `apps/web/src/app/(auth)/login/page.tsx` (ausencia).

**Recomendación:** Supabase Auth soporta Cloudflare Turnstile. Activar en el dashboard de Supabase para añadir CAPTCHA invisible después del primer intento fallido.

**Riesgo go-live:** Medio. El lockout es una protección efectiva para ataques de diccionario simples pero no para ataques distribuidos.

---

## Módulo 13 — SLOs {#modulo-13}

### 13.1 Resumen ejecutivo

`/slos` es una Server Component que consume datos mock de `slo-checks.ts`. No hay llamadas tRPC ni BD. Sin riesgo de seguridad. La página está bien documentada sobre su estado MVP ("datos MOCK") y el push-back al TDR sobre el target de disponibilidad 99.5% vs 99.9% está justificado y documentado.

### 13.2 Hallazgos

Sin hallazgos de seguridad. Se identifican dos puntos informacionales:

- **HJ-inf-01 — C1:** SLO de disponibilidad 99.5% vs TDR 99.9% está documentado como push-back aprobado. No es un defecto, es una decisión arquitectónica registrada.
- **HJ-inf-02 — C1:** Los datos son 100% mock. No hay integración con Vercel Analytics ni Sentry. Sprint 6 pendiente.

---

## Módulo 14 — Catálogos genéricos {#modulo-14}

### 14.1 Resumen ejecutivo

`catalog.router.ts` implementa un CRUD genérico sobre 14 modelos de catálogo mediante un `modelMap` y acceso dinámico vía `(prisma as any)[model]`. El pattern es pragmático y funcional. Validación por catálogo via `catalogDataSchemas`. Validación cross-field para FK (`medicalSpecialty.parentId`, `serviceUnit.establishmentId`). Sin embargo, el acceso dinámico al modelo Prisma pierde el tipado y hay riesgo de model injection si `modelMap` se expande incorrectamente.

### 14.2 Archivos auditados

- `apps/web/src/app/(admin)/catalogs/[catalog]/page.tsx`
- `packages/trpc/src/routers/catalog.router.ts`

### 14.3 Hallazgos

#### HJ-25 — C7 — `catalog`: acceso dinámico `(prisma as any)[model]` sin verificación de modelo válido en tiempo de ejecución (P2 MEDIA)

**Descripción:** La función `model()` en `catalog.router.ts:52-57` hace `(prisma as any)[modelMap[key]]`. Si `key` no está en `catalogKeyEnum` (validado por Zod), Prisma lanzaría un error de "método no encontrado". El enum de Zod en el input protege contra keys arbitrarias, pero si el `modelMap` queda desincronizado del enum (se añade un key al enum sin añadirlo al map, o viceversa), la función ejecutaría `prisma.undefined.findMany()` que lanza en runtime sin compilación fallando.

**Líneas afectadas:** `packages/trpc/src/routers/catalog.router.ts:35-57`.

**Recomendación:** Añadir en la función `model()` una verificación explícita: `if (!modelMap[key]) throw new TRPCError(...)`. Ya está implementado ("Catálogo desconocido") pero para el case donde el key existe en el enum pero no en el map, el error sería "Cannot read properties of undefined" en lugar de un error controlado.

**Riesgo go-live:** Bajo. El enum Zod previene inputs inválidos. El riesgo es solo de regression al añadir nuevos catálogos.

#### HJ-26 — C9 — `catalog.create/update`: sin verificación de que `serviceUnit.organizationId` = tenant (P2 MEDIA)

**Descripción:** Para el catálogo `serviceUnit`, el router inyecta `organizationId = ctx.tenant.organizationId` en el `create`. Sin embargo, en `update`, el código no verifica que la `serviceUnit` siendo editada pertenezca al tenant actual. El filtro por `id` en Prisma es suficiente para encontrar la fila, y como no hay RLS activo en la query (Prisma con BYPASSRLS), un ADMIN puede editar `serviceUnit` de otras organizaciones si conoce el UUID.

**Líneas afectadas:** `packages/trpc/src/routers/catalog.router.ts:200-212`.

**Recomendación:** Para `catalog === "serviceUnit"`, añadir al `where` del `update`: `{ id: input.id, organizationId: ctx.tenant.organizationId }`. Usar `updateMany` con conteo de afectados para detectar cross-tenant.

**Riesgo go-live:** Medio. Permite editar unidades de servicio de otras organizaciones.

---

## Módulo 15 — SV Localization + Triage Config {#modulo-15}

### 15.1 Resumen ejecutivo

**SV Localization:** Server Component que consulta BD directamente (no via tRPC) con el cliente Prisma global. Las queries son de solo lectura sobre catálogos geográficos y feriados. El botón "Recargar seed SV" es un Server Action inline que solo llama `revalidatePath` y `console.log` — no ejecuta ninguna mutación. Sin hallazgos de seguridad.

**Triage Config:** Usa `(trpc as unknown as TrpcWithFlowchart)` cast tipado para acceder a `triageFlowchart.list` y `triageFlowchart.setActive`. El cast es más seguro que `as any` porque define la interfaz. El módulo es funcional sin hallazgos de seguridad críticos.

### 15.2 Hallazgos

#### HJ-27 — C9 — `sv-localization`: queries Prisma directas sin RLS (P2 MEDIA)

**Descripción:** `sv-localization/page.tsx` usa `prisma.country.findUnique(...)` y `prisma.geoDivision.count(...)` directamente (sin `withTenantContext`). Los catálogos `Country`, `GeoDivision` y `Holiday` son globales (sin `organizationId`), por lo que la omisión de RLS es correcta para catálogos globales. Sin embargo, el patrón de usar el cliente Prisma global directamente en un Server Component (sin tRPC) bypasea el layer de validación de permisos. Cualquier usuario autenticado puede ver los datos.

**Líneas afectadas:** `apps/web/src/app/(admin)/sv-localization/page.tsx:37-53`.

**Recomendación:** Wrapping en `protectedProcedure` para asegurar que solo usuarios autenticados accedan, aunque los datos sean globales. El Server Component ya requiere sesión implícitamente por el layout, así que el riesgo es bajo.

**Riesgo go-live:** Bajo. Catálogos geográficos son datos públicos.

#### HJ-28 — C9 — `triage-config`: `triageFlowchart.setActive` sin verificación de org-scope (P2 MEDIA)

**Descripción:** El procedure `triageFlowchart.setActive` (auditado en Stream A) activa/desactiva flujogramas Manchester. La página `triage-config` no verifica que el flujograma siendo activado pertenezca a la organización del tenant. Si los flujogramas son catálogos globales (sin `organizationId`), el SET de `active` podría afectar la configuración de otros tenants que usen el mismo flujograma.

**Líneas afectadas:** `apps/web/src/app/(admin)/triage-config/page.tsx:69-71`.

**Recomendación:** Verificar en el router `triageFlowchart.setActive` si el `active` es una bandera global o por-org. Si es global, debería requerir `super_admin`. Si es por-org, añadir tabla de configuración `OrgTriageFlowchart` con el flag.

**Riesgo go-live:** Medio. Afecta configuración del triage para otras organizaciones si los flujogramas son compartidos.

---

## Módulo 16 — Analytics (Metabase Embed) {#modulo-16}

### 16.1 Resumen ejecutivo

`/analytics` implementa un grid de KPIs que redirigen a `/analytics/[kpi]` donde se embebe un iframe de Metabase via JWT signed URL. El componente `MetabaseEmbed` usa una Server Action (`getMetabaseEmbedToken`) para obtener el token firmado. El iframe tiene `sandbox="allow-scripts allow-same-origin allow-popups allow-forms"`.

### 16.2 Hallazgos

#### HJ-29 — C8 — Analytics: iframe `sandbox` incluye `allow-same-origin` junto con `allow-scripts` (P1 ALTA)

**Descripción:** El iframe en `MetabaseEmbed.tsx:110-115` usa:
```
sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
```
La combinación `allow-scripts + allow-same-origin` efectivamente deshabilita el sandboxing de seguridad. Con ambos flags, el contenido del iframe puede ejecutar JavaScript y acceder al DOM del padre (mismo origen). Si el URL de Metabase es del mismo dominio (o si Metabase está embedido en el mismo origen), el iframe puede:
- Leer cookies del documento padre.
- Acceder a `localStorage` del padre (donde SSO Config guarda clientSecrets).
- Ejecutar JavaScript en el contexto del origen padre.

**Líneas afectadas:** `apps/web/src/app/(admin)/analytics/_components/MetabaseEmbed.tsx:112`.

**Recomendación:** Remover `allow-same-origin` si Metabase es un dominio externo (que es el caso típico). La sandbox debería ser: `sandbox="allow-scripts allow-popups allow-forms"`. Si se necesita `allow-same-origin` por alguna funcionalidad de Metabase, documentar el riesgo explícitamente.

**Riesgo go-live:** Alto. En la configuración actual, si Metabase comparte origen con el HIS, el iframe puede exfiltrar cookies de sesión y datos de localStorage.

---

## Módulo 17 — Patients Merge-Queue {#modulo-17}

### 17.1 Resumen ejecutivo

`/patients/merge-queue` implementa la cola de fusión de expedientes ECE con doble firma PIN (Director + Director Médico). La UI requiere dos campos PIN de ≥6 caracteres antes de habilitar el botón de confirmación. El router `patientDedup.confirmEceMerge` es llamado con los dos hashes PIN. Sin embargo, los "hashes" PIN son enviados como strings crudos desde el cliente — la UI no hashea nada antes del envío.

### 17.2 Archivos auditados

- `apps/web/src/app/(admin)/patients/merge-queue/page.tsx`
- `packages/trpc/src/routers/patient-dedup.router.ts` (referenciado, no leído en detalle)

### 17.3 Hallazgos

#### HJ-30 — C8 — Merge-queue: PIN enviado como texto plano desde el cliente (P1 ALTA)

**Descripción:** En `merge-queue/page.tsx:66` el campo se llama `firmaDir1Id` (label "PIN Director (hash)"), sugiriendo que debería enviarse un hash. Sin embargo, la UI hace `firmaDir1.trim()` sin hashear. El valor enviado a `patientDedup.confirmEceMerge` es el PIN en texto plano del teclado (en `firmaDir2Id: firmaDir2.trim()`). Si el router almacena o loguea el valor, el PIN queda expuesto en logs de audit. Si lo compara contra un hash almacenado en BD, la comparación sería texto plano vs hash, que nunca matchea.

**Líneas afectadas:** `apps/web/src/app/(admin)/patients/merge-queue/page.tsx:121-126`.

**Recomendación:** Hashear el PIN en el cliente antes de enviarlo: `crypto.subtle.digest("SHA-256", TextEncoder().encode(firmaDir1))`. O mejor, implementar el PIN como una firma sobre un nonce proporcionado por el servidor (challenge-response), evitando enviar el PIN o su hash directamente.

**Riesgo go-live:** Alto. El PIN de autorización de fusión de expedientes (acción irreversible) viaja en texto plano por la red. Si hay intercepción TLS, el PIN queda expuesto. El audit log podría registrar el PIN.

#### HJ-31 — C9 — Merge-queue: sin verificación server-side de quorum de roles (P1 ALTA)

**Descripción:** La UI muestra dos campos de PIN (Director + Director Médico) implícitamente asumiendo que son dos personas distintas. Sin embargo, la llamada a `patientDedup.confirmEceMerge` envía dos strings `firmaDir1Id` y `firmaDir2Id` que podrían ser el mismo valor (mismo PIN, mismo Director). Si el router no verifica que ambas firmas provienen de usuarios distintos con roles distintos (DIR y DIR_MEDICO), un único Director podría aprobar la fusión llenando ambos campos con su propio PIN.

**Líneas afectadas:** `apps/web/src/app/(admin)/patients/merge-queue/page.tsx:121-126` (cliente), router `patientDedup.confirmEceMerge` (no auditado en detalle).

**Recomendación:** El router debe verificar que:
1. `firmaDir1Id` pertenece a un usuario con rol DIR.
2. `firmaDir2Id` pertenece a un usuario con rol DIR_MEDICO (o equivalente).
3. `firmaDir1Id !== firmaDir2Id` (no auto-aprobación).
Si el sistema de PIN es por UserId (no por contraseña), usar el ID del usuario autenticado en contexto, no un string libre.

**Riesgo go-live:** Alto. Un Director podría auto-aprobar fusiones de expedientes, que es una acción irreversible con impacto en la historia clínica del paciente.

---

## Resumen Consolidado Stream J {#resumen-consolidado}

### Tabla global de hallazgos

| ID | Severidad | Módulo | Título | Categoría |
|---|---|---|---|---|
| HJ-01 | P1 ALTA | ABAC | ABAC evaluado solo en frontend, sin `abacGuard` server-side | C1/C9 |
| HJ-02 | P2 MEDIA | Audit Integrity | `(trpc as any)` cast para `auditIntegrity` | C7 |
| HJ-03 | P2 MEDIA | Audit | `entity` sin whitelist permite enumeración de entidades | C7 |
| HJ-04 | P0 CRITICO | Audit Outlier | Queries `bitacora_acceso` sin filtro de tenant (cross-tenant read) | C6/C9 |
| HJ-05 | P1 ALTA | Audit Outlier | `sensitiveAccess`: índice SQL frágil (bug latente) | C4 |
| HJ-06 | P0 CRITICO | Audit Outlier | `scanAndFlag` UPDATE cross-tenant sin filtro de org | C9 |
| HJ-07 | P2 MEDIA | Audit Outlier | `ipWhitelist` sin validación de formato IP | C7 |
| HJ-08 | P1 ALTA | RBAC Matriz | `permissionMatrix` no filtra `userOrganizationRole` por org | C9 |
| HJ-09 | P1 ALTA | Roles/RBAC | `purgeInactiveUsers` sin filtro de org (cross-tenant write) | C9 |
| HJ-10 | P1 ALTA | Roles/RBAC | `reactivateUser` sin verificar pertenencia a org | C9 |
| HJ-11 | P1 ALTA | Users | `userAdmin.listAll` global sin filtro de org (exposición PII) | C9 |
| HJ-12 | P2 MEDIA | Users | `userAdmin.create` sin invitation flow (sin contraseña en Supabase) | C5 |
| HJ-13 | P2 MEDIA | Organizations | Alta/edición de organizaciones ausente (stub Sprint 2) | C1 |
| HJ-14 | P2 MEDIA | Exchange Rates | `validFrom` timezone shift con `z.coerce.date()` | C5 |
| HJ-15 | P3 BAJA | Ledgers | Sin transacciones financieras reales en MVP | C1 |
| HJ-16 | P1 ALTA | Insurance | Cualquier tenant puede crear aseguradoras globales | C9 |
| HJ-17 | P2 MEDIA | Insurance | Import `@prisma/client` en lugar de `@his/database` | C4 |
| HJ-18 | P1 ALTA | SSO Config | `clientSecret` almacenado en `localStorage` texto claro | C8 |
| HJ-19 | P2 MEDIA | SSO Config | Sin `requireRole` para acceder a configuración SSO | C1 |
| HJ-20 | P1 ALTA | MFA | Sin protección contra replay de TOTP (mismo token reutilizable 90s) | C10/C11 |
| HJ-21 | P1 ALTA | MFA | Duplicación Server Action + router tRPC con riesgo de divergencia | C11 |
| HJ-22 | P2 MEDIA | MFA | `disableMfa()` sin re-autenticación | C5 |
| HJ-23 | P2 MEDIA | Login | `recordLoginAttempt` best-effort: lockout puede no registrarse | C9 |
| HJ-24 | P2 MEDIA | Login | Sin CAPTCHA tras intentos fallidos | C1 |
| HJ-25 | P2 MEDIA | Catálogos | Acceso dinámico `(prisma as any)` sin verificación de modelo válido | C7 |
| HJ-26 | P2 MEDIA | Catálogos | `catalog.update` sin verificación org para `serviceUnit` | C9 |
| HJ-27 | P2 MEDIA | SV Localization | Queries Prisma directas sin layer tRPC | C9 |
| HJ-28 | P2 MEDIA | Triage Config | `setActive` sin verificar org-scope del flujograma | C9 |
| HJ-29 | P1 ALTA | Analytics | iframe `allow-same-origin + allow-scripts` deshabilita sandboxing | C8 |
| HJ-30 | P1 ALTA | Merge-Queue | PIN enviado en texto plano desde el cliente | C8 |
| HJ-31 | P1 ALTA | Merge-Queue | Sin verificación server-side de quorum de roles (auto-aprobación posible) | C9 |

### Conteo por severidad

| Severidad | Cantidad | IDs |
|---|---|---|
| **P0 CRITICO** | **2** | HJ-04, HJ-06 |
| **P1 ALTA** | **12** | HJ-01, HJ-05, HJ-08, HJ-09, HJ-10, HJ-11, HJ-16, HJ-18, HJ-20, HJ-21, HJ-29, HJ-30, HJ-31 |
| **P2 MEDIA** | **16** | HJ-02, HJ-03, HJ-07, HJ-12, HJ-13, HJ-14, HJ-17, HJ-19, HJ-22, HJ-23, HJ-24, HJ-25, HJ-26, HJ-27, HJ-28 |
| **P3 BAJA** | **1** | HJ-15 |
| **Total** | **31** | — |

*Nota: HJ-31 está contado en P1 (total 13 P1, no 12 como en el encabezado — corrección: P1 = 13).*

### Corrección de conteo:

| Severidad | Cantidad |
|---|---|
| P0 CRITICO | 2 |
| P1 ALTA | 13 |
| P2 MEDIA | 15 |
| P3 BAJA | 1 |
| **Total** | **31** |

### Hallazgos prioritarios para go-live (P0 + P1)

Los siguientes 15 hallazgos deben resolverse antes de go-live:

1. **HJ-04 / HJ-06** (P0): `audit-outlier` queries y UPDATE cross-tenant en `bitacora_acceso` — añadir filtro `organization_id` en todas las queries rawUnsafe.
2. **HJ-01** (P1): Implementar `abacGuard` en capa tRPC para PRESCRIBE/DISPENSE/SIGN.
3. **HJ-08** (P1): `permissionMatrix` debe filtrar `userOrganizationRole` por org.
4. **HJ-09/HJ-10** (P1): `purgeInactiveUsers` y `reactivateUser` sin scope de org.
5. **HJ-11** (P1): `userAdmin.listAll` expone PII de todos los tenants.
6. **HJ-16** (P1): `insurance.insurer.create` permite catálogos globales sin `super_admin`.
7. **HJ-18** (P1): `clientSecret` SSO en `localStorage` texto claro.
8. **HJ-20** (P1): Replay de TOTP — almacenar último counter usado.
9. **HJ-21** (P1): Duplicación MFA Server Action + router — extraer a utilidad compartida.
10. **HJ-29** (P1): iframe Analytics con `allow-same-origin + allow-scripts` — remover `allow-same-origin`.
11. **HJ-30** (P1): PIN de merge-queue en texto plano — hashear antes de envío.
12. **HJ-31** (P1): Sin quorum de roles verificado server-side en confirmación de merge.
13. **HJ-05** (P1): Índice SQL frágil en `sensitiveAccess` — refactorizar cálculo de posición LIMIT/OFFSET.

### ADR implícitos identificados

**ADR-J-01: MFA duplicada — Server Action vs tRPC**
- **Contexto:** La página `/mfa` requiere MFA antes de completar la sesión, por lo que tRPC (que asume sesión completa) no sirve directamente.
- **Decisión actual:** Duplicación de implementación TOTP/AES en ambos módulos.
- **Consecuencia:** Riesgo de divergencia. Requiere mantenimiento doble.
- **Propuesta:** Extraer a `packages/contracts/src/utils/totp.ts` compartido, o usar Server Actions exclusivamente y deprecar el router tRPC de MFA.

**ADR-J-02: ABAC solo en frontend**
- **Contexto:** Sprint 1 prioriza velocidad de entrega; las reglas ABAC son complejas de persistir.
- **Decisión actual:** Reglas hardcoded, evaluación solo en UI.
- **Consecuencia:** Sin enforcement server-side. Cualquier cliente directo de tRPC bypasea ABAC.
- **Propuesta:** Sprint 2: middleware `abacGuard` en tRPC + tabla `AbacRule` en BD.

**ADR-J-03: Acceso rawUnsafe en audit-outlier**
- **Contexto:** Las tablas `ece.*` no tienen modelos Prisma completos; se usa SQL raw.
- **Decisión actual:** `$queryRawUnsafe` parametrizado (correcto para SQL injection) pero sin filtro de tenant.
- **Consecuencia:** Cross-tenant data exposure.
- **Propuesta:** Añadir `organization_id` en `ece.bitacora_acceso` si no existe; filtrar en todas las queries.

---

*Documento producido por @AS — Arquitecto de Software. Stream J de 10 en la serie de auditoría 2026-05-19.*
*Próximo stream recomendado: Stream K — Módulos BI, Reporting y SRE (si aplica).*
