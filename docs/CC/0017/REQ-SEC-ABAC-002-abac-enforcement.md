# REQ-SEC-ABAC-002 — ABAC persistente + enforcement real en tRPC (CC-0017 Fase 2)

**Fecha:** 2026-08-08
**Rama:** `feat/cc-0017-f2-abac` (independiente de `feat/cc-0017-rbac-parametrizable` / F1 — PR #528, no mergeado al momento de esta fase; no se depende de sus tablas).
**Relacionado:** F1 — RBAC parametrizable (`docs/CC/0017/REQ-SEC-RBAC-001-rbac-parametrizable.md`, PR #528).

---

## 1. Qué había (auditoría de partida)

- `apps/web/src/lib/auth/abac.ts` — 5 funciones puras (`canAccessPatient`,
  `canPrescribe`, `canDispense`, `canAccessService`, `canSign`) con lógica
  **hardcoded** en TypeScript, más un array `MVP_ABAC_RULES` que las
  documenta en forma de tabla.
- `/abac` (`apps/web/src/app/(admin)/abac/page.tsx`) — vista **solo lectura**
  de `MVP_ABAC_RULES`. Banner explícito: "MVP … Sprint 2: persistencia +
  middleware abacGuard".
- **Enforcement CERO en backend.** Grep confirmado (repo completo, sin
  `node_modules`): las 5 funciones `canX` **no se invocan desde ningún
  router `packages/trpc`, ni desde ninguna página de `apps/web` fuera de sus
  propios tests** (`apps/web/src/lib/auth/__tests__/abac.test.ts`). Es UI
  defensiva sin ningún caller real — evadible directamente llamando al
  endpoint tRPC.
- Atributos modelados: rol, `organizationId`, `user.active`,
  `patient.hasActiveTriage`. `canAccessService` es `return true` (TODO
  explícito). Sin horario, sin servicio real, sin establecimiento.

## 2. Qué queda (Fase 2)

### 2.1 Modelo persistido — `AbacRule`

- SQL `packages/database/sql/195_cc0017_f2_abac.sql` (**NO aplicado a
  prod** por este agente — @Orq/@DBA decide el momento).
- Tabla `public."AbacRule"`: `organizationId`, `recurso`, `accion`,
  `effect` (ALLOW/DENY, reusa el enum `PermissionEffect` ya existente),
  `prioridad`, `descripcion`, `condiciones` (JSONB, array de predicados),
  `active`, auditoría (`createdAt/By`, `updatedAt/By`). RLS tenant (mismo
  patrón que `TipoCuenta`, SQL 191). Índice `(organizationId, recurso,
  accion, active)`.
- Modelo Prisma agregado en `packages/database/prisma/schema.prisma`
  (relación `Organization.abacRules`). `npm run -w @his/database generate`
  ejecutado — client regenerado sin errores.
- Seed idempotente: traduce las 7 filas de `MVP_ABAC_RULES` a `AbacRule`
  por organización real (excluye `RLS-Test%`) — ver mapeo completo en el
  comentario de cabecera del SQL 195. El estado inicial post-aplicación
  reproduce el comportamiento MVP documentado hoy, ahora editable.

### 2.2 Motor — `packages/trpc/src/abac/`

- `motor.ts`:
  - `evaluarCondiciones(condiciones, atributos)` — puro, AND de predicados.
  - `resolverDecision(reglas, atributos)` — puro, aplica precedencia.
  - `evaluarAbac(prisma, tenant, {recurso, accion, atributos})` — única
    función que toca BD (vía `withTenantContext`, contrato RLS obligatorio
    del proyecto — NO se bypassea).
- `guard.ts`: `abacGuard(recurso, accion, extractAtributos?)` — helper
  construido con `t.middleware()` (exportado como `middleware` desde
  `trpc.ts`), encadenable con `.use()` sobre CUALQUIER procedure. Si
  `ctx.tenant` es `null` (ej. `protectedProcedure` sin org seleccionada),
  se salta la evaluación — fail-safe ALLOW.
- `atributos.ts`: `atributosDesdeContexto(tenant)` deriva rol,
  establecimiento, servicio (asignaciones Nivel A) y hora actual
  (`America/El_Salvador`, timezone fija del proyecto) del `TenantContext`.
- **Precedencia** (idéntica en motor y documentada en el SQL):
  1. Sin regla que matchee → **ALLOW fail-safe**. Igual que F1: el default
     nunca bloquea lo que hoy funciona.
  2. Si ≥1 regla matcheada es DENY → **DENY**, sin importar prioridad.
  3. Entre reglas del mismo efecto, gana la de mayor `prioridad`
     (desempate para saber qué `matchedRuleId`/`reason` reportar).

### 2.3 Atributos soportados

| Atributo | Tipo runtime | Origen por defecto | Operadores válidos |
|---|---|---|---|
| `rol` | `string[]` | `ctx.tenant.roleCodes` | IGUAL, DIFERENTE, EN, NO_EN |
| `establecimiento` | `string` | `ctx.tenant.establishmentId` | IGUAL, DIFERENTE, EN, NO_EN |
| `servicio` | `string[]` | `ctx.tenant.assignedServiceUnitCodes` (override vía `extractAtributos`) | EN, NO_EN |
| `horario` | mapea a `horaActual` (`"HH:MM"`) | reloj del servidor, tz fija | ENTRE_HORAS (rango `{desde,hasta}`, soporta wrap de medianoche) |
| `pacienteConTriaje` | `boolean` | provisto por el caller (`extractAtributos`) | ES_VERDADERO, ES_FALSO |
| `usuarioActivo` | `boolean` | `true` por defecto (ver nota abajo) | ES_VERDADERO, ES_FALSO |
| `esPropioPaciente` | `boolean` | provisto por el caller | ES_VERDADERO, ES_FALSO |

Nota `usuarioActivo`: se asume `true` porque llegar a `protectedProcedure`/
`tenantProcedure` ya implica que `getTenantContext` resolvió una membresía
vigente (`packages/database` filtra por `validFrom/validTo`); no hay un
booleano `User.active` propagado al `TenantContext` hoy. Un caller que
necesite el valor real de BD puede sobreescribirlo vía `extractAtributos`.

### 2.4 Enforcement de prueba de concepto (3 puntos, NO los ~99 routers)

| Router / procedure | Recurso/Acción | Cómo se cableó |
|---|---|---|
| `packages/trpc/src/routers/ece/indicaciones-medicas.router.ts` → `create` | `prescription`/`prescribe` | `.use(abacGuard(...))` encadenado tras `physicianProcedure.input(createSchema)` (canPrescribe) |
| `packages/trpc/src/routers/pharmacy-dispensation.router.ts` → `reserveItem` | `dispensation`/`dispense` | `.use(abacGuard(...))` tras `requireRole(["PHARM","ADMIN"]).input(...)` (canDispense) |
| `packages/trpc/src/routers/firma-electronica.router.ts` → `confirm` | `signature`/`sign` | llamada **inline** a `evaluarAbac` dentro del handler (NO `.use()`) porque `confirm` es `protectedProcedure` — no todo caller de firma tiene org seleccionada; con `ctx.tenant` ausente se salta la evaluación (canSign) |

Verificado con tests: con las reglas seed (ALLOW por rol, réplica del MVP)
el comportamiento es idéntico al actual; agregar una `AbacRule` DENY nueva
sí bloquea (`packages/trpc/src/abac/__tests__/guard.test.ts`).

### 2.5 UI `/abac` — de solo lectura a CRUD

- Router `packages/trpc/src/routers/abac.router.ts`: `list`, `get`
  (`tenantProcedure`), `create`/`update`/`setActive`/`delete`
  (`requireRole(["ADMIN","DIR","super_admin","admin_clinico"])` — cubre
  ambas familias de código de rol vigentes hoy en el repo, ver §3).
- `apps/web/src/app/(admin)/abac/page.tsx`: tabla con filtro
  recurso/acción/activas, alta/edición vía Dialog
  (`abac-form.tsx` + editor de condiciones `abac-condition-editor.tsx`),
  activar/desactivar, eliminar. Banner actualizado: ya no dice "solo
  lectura"; explica que el enforcement real cubre 3 puntos (§2.4).

## 3. Mapeo `MVP_ABAC_RULES` → `AbacRule` (seed SQL 195)

| id MVP | recurso/accion | condiciones AbacRule |
|---|---|---|
| `patient-read-admin` | `patient`/`access` | `rol EN [super_admin, admin_clinico]` |
| `patient-read-clinical` | `patient`/`access` | `rol EN [medico, enfermeria]` |
| `patient-read-triage` | `patient`/`access` | `rol EN [triador]` AND `pacienteConTriaje ES_VERDADERO` |
| `patient-prescribe` | `prescription`/`prescribe` | `rol EN [medico]` |
| `patient-dispense` | `dispensation`/`dispense` | `rol EN [farmaceutico]` |
| `patient-sign` | `signature`/`sign` | `rol EN [medico]` |
| `service-access-org-mvp` | `service`/`access` | `rol EN [super_admin, admin_clinico, medico, enfermeria, triador]` |

`sameOrg` (match de `organizationId`) **no** se modela como condición —
el motor ya carga las reglas SCOPED a `tenant.organizationId` (`where` +
RLS), así que el aislamiento por organización es estructural, no una
condición de la lista.

## 4. Qué se descopeó explícitamente (push-back documentado)

**Migrar las 5 funciones `canX` de `apps/web/src/lib/auth/abac.ts` para que
"consulten las reglas persistidas"** — descopeado con intención, no
olvidado:

1. Grep confirma que las 5 funciones **no tienen ningún caller real** hoy
   (solo su propio archivo de test). Convertirlas a consultar BD (async)
   no cambia el comportamiento de ninguna pantalla existente — no hay
   pantalla que las use.
2. Su firma es **síncrona** (`(user, patient): boolean`) y corren
   client-side potencialmente (`/abac` las importaba). Consultar BD real
   requeriría romper esa firma a `Promise<boolean>` y tocar callers —
   que no existen — puramente especulativo (viola "simplicidad primero" /
   `careful-coding`).
3. El **enforcement real** (lo que efectivamente protege datos) vive en
   `evaluarAbac`/`abacGuard`, cableado en 3 procedures reales de tRPC
   (§2.4) — eso es lo que importa desde el punto de vista de seguridad, y
   está completo, testeado y verificado fail-safe.

**Compromiso:** las 5 funciones quedan **sin modificar** (mismo
comportamiento, mismos 2717+ tests preexistentes verdes). Si en el futuro
aparece un caller real client-side que necesite decisiones ABAC antes del
round-trip al servidor, ese caller debería consumir `trpc.abac.list` +
evaluar client-side con una copia del motor (o simplemente confiar en el
servidor y mostrar/ocultar UI de forma optimista) — no reintroducir lógica
hardcoded paralela.

## 5. Migración masiva de enforcement (fuera de alcance F2)

Los ~99 routers restantes NO consultan `AbacRule`. Expandir `abacGuard` a
más recursos es trabajo **incremental**: cada procedure que se cablee debe
decidir explícitamente qué atributos extra pasar vía `extractAtributos`
(ej. `esPropioPaciente`, `pacienteConTriaje` requieren una query previa del
recurso). No se automatiza porque el riesgo de fail-safe incorrecto
(bloquear algo que hoy funciona) es alto sin revisar caso por caso — mismo
principio que F1 aplicó a `requirePermission`.

## 6. Verificación

- `npm run typecheck` (turbo, 7 workspaces) — **verde**.
- `npm run test` — **verde**: `@his/contracts`, `@his/database`,
  `@his/infrastructure`, `@his/trpc` (2799 tests, incluye 48 nuevos de
  ABAC), `@his/web` (583 tests) — sin regresiones.
- `npm run lint` — verde (solo warnings preexistentes no relacionados).
- Fail-safe confirmado por test: `resolverDecision([], atributos)` →
  `{allowed:true, matchedRuleId:"fail-safe-allow"}`
  (`packages/trpc/src/abac/__tests__/motor.test.ts`); `abacGuard` sin
  `ctx.tenant` no llama ni siquiera a `AbacRule.findMany`
  (`packages/trpc/src/abac/__tests__/guard.test.ts`).
- **NO se aplicó SQL a Supabase prod.** Orden de aplicación cuando se
  autorice: `195_cc0017_f2_abac.sql` (independiente — no depende del SQL
  194 de F1, que tampoco está aplicado).

## 7. Archivos

- `packages/database/sql/195_cc0017_f2_abac.sql`
- `packages/database/prisma/schema.prisma` (modelo `AbacRule` + relación `Organization.abacRules`)
- `packages/contracts/src/schemas/abac.ts` (extendido: `AbacRecurso`, `AbacAccion`, `AbacEffect`, `AbacAtributoNombre`, `AbacOperador`, `AbacCondicion`, `AbacRuleRecord`, inputs CRUD)
- `packages/trpc/src/abac/{types,motor,atributos,guard,index}.ts` + `__tests__/{motor,guard}.test.ts`
- `packages/trpc/src/routers/abac.router.ts` + `__tests__/abac.router.test.ts`
- `packages/trpc/src/routers/_app.ts` (registro `abac: abacRouter`)
- `packages/trpc/src/trpc.ts` (export `middleware = t.middleware`)
- `packages/trpc/src/routers/ece/indicaciones-medicas.router.ts` (abacGuard en `create`)
- `packages/trpc/src/routers/pharmacy-dispensation.router.ts` (abacGuard en `reserveItem`)
- `packages/trpc/src/routers/firma-electronica.router.ts` (evaluarAbac inline en `confirm`)
- `apps/web/src/app/(admin)/abac/{page,abac-form,abac-condition-editor}.tsx`
