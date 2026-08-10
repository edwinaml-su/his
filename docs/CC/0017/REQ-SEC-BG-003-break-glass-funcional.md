# REQ-SEC-BG-003 — Break-glass funcional: elevación real + auditoría de uso + notificación (Fase 3)

| Campo | Valor |
|---|---|
| Control de cambios | **CC-0017** |
| Fecha | 2026-08-10 |
| Solicitante | Edwin Martínez (Inversiones Avante) — auditoría interna |
| Rama | `feat/cc-0017-f3-break-glass` |
| SQL | Ninguno nuevo — las policies RLS que respetan `is_break_glass()` ya existen desde US-1.7/US-1.8 (`packages/database/sql/01_rls_policies.sql` y afines). No se aplicó SQL a prod en esta fase. |
| Alcance | Fase 3 de 3 del roadmap de `REQ-SEC-RBAC-001` (§9): **RLS elevation + auditoría + notificación**, NO bypass de `requireRole`/`requirePermission` — ver §7 (alcance NO cubierto) |

## 1. Qué existía antes de esta fase (auditoría confirmada)

`apps/web/src/app/actions/break-glass.ts` + `packages/trpc/src/routers/break-glass.router.ts` (US-2.7, Sprint 2) ya hacían, al activar break-glass:

- Escribían `AuditLog(action=BREAK_GLASS, severity=HIGH, notify_chief=true)` inmutable.
- Exigían justificación clínica ≥20 caracteres + checkbox de ack de notificación al jefe.
- Seteaban una cookie httpOnly `his.break_glass` (TTL 1h) con `{ patientId, justification, activatedAt }`.

**Pero no elevaba nada.** La cookie pretendía activar `app.is_break_glass=true` en RLS, pero absolutamente nada la leía. `applyTenantContext(..., { breakGlass: true })` (`packages/trpc/src/rls-context.ts`) sólo se usaba en tests (`rls-isolation.test.ts` Test 4). El email al jefe de servicio era un TODO literal (`notify_chief: true` en `afterJson`, sin consumidor). No existía ningún indicador visual de que el modo emergencia estuviera activo.

## 2. Mecanismo: cookie → contexto → elevación real

### 2.1 Única lectura de la cookie: `getTenantContext()`

`apps/web/src/lib/auth/session.ts` (`getTenantContext()`, la única función que arma `TenantContext` server-side, invocada desde `apps/web/src/app/api/trpc/[trpc]/route.ts` en cada request) ahora lee la cookie `his.break_glass` **una sola vez por request** y la valida con una función pura extraída a `apps/web/src/lib/auth/break-glass-cookie.ts` (`parseBreakGlassCookie`, sin I/O — separada justamente para poder testearla sin mockear Supabase/Prisma/`next/headers`).

Fail-safe por construcción: cualquier cookie ausente, con JSON corrupto, con campos faltantes/mal tipados, o **expirada** (TTL 1h desde `activatedAt`) → `parseBreakGlassCookie` retorna `null` → `TenantContext.breakGlass` queda `false` (comportamiento idéntico al de hoy, sin cambios).

`TenantContext` (`packages/contracts/src/types/index.ts`) gana dos campos **opcionales**:

```ts
breakGlass?: boolean;
breakGlassSession?: { patientId; justification; activatedAt; expiresAt };
```

Opcionales — no requeridos — deliberadamente: así los ~50 call sites existentes de `withTenantContext(prisma, ctx.tenant, ...)` y los fixtures de test (`MOCK_TENANT` en `@his/test-utils`) que construyen un `TenantContext` sin este campo siguen compilando y comportándose igual, sin tocarlos.

### 2.2 `withTenantContext` hereda el flag automáticamente

`packages/trpc/src/rls-context.ts` — `applyTenantContext`/`withTenantContext` ahora aceptan `tenant.breakGlass` como parte del tipo del segundo argumento (`Pick<TenantContext, "userId" | "organizationId" | "breakGlass">`). La resolución del flag efectivo es:

```ts
const effectiveBreakGlass = options.breakGlass ?? tenant.breakGlass ?? false;
```

`options.breakGlass` explícito (usado hoy sólo por tests, p.ej. `rls-isolation.test.ts` Test 4) gana; si se omite, se hereda de `tenant.breakGlass`. Esto significa que **ningún call site existente tuvo que tocarse**: en cuanto `ctx.tenant.breakGlass === true` (porque `getTenantContext()` validó la cookie), cualquier router que ya llame `withTenantContext(ctx.prisma, ctx.tenant, ...)` — el patrón documentado en `CLAUDE.md` §RLS — eleva automáticamente. Sin cookie válida, `tenant.breakGlass` es `undefined` → `?? false` → SQL idéntico al de antes (`SELECT set_tenant_context(..., false)`).

## 3. Alcance REAL de la elevación (qué policies se relajan)

**Esto es SELECT-only, no MODIFY.** Las policies `tenant_isolation_modify` (`FOR ALL ... USING (organizationId = current_org_id())`) NO incluyen `is_break_glass()` — un usuario en modo emergencia sigue sin poder escribir fuera de su organización.

Y **es cross-organización, no sólo cross-establecimiento** dentro de la misma org: el patrón repetido en `01_rls_policies.sql` y en los SQL de hardening por dominio es:

```sql
USING ("organizationId" = public.current_org_id() OR public.is_break_glass())
```

Cuando `is_break_glass()` es `true`, la condición completa es `true` para CUALQUIER fila, sin importar `organizationId` — no hay un segundo filtro que acote a la organización activa del usuario ni al paciente declarado en la cookie. Tablas con esta policy (confirmado por grep sobre `packages/database/sql/`):

- **Núcleo** (`01_rls_policies.sql`): `Establishment`, `Ledger`, `ServiceUnit`, `Bed`, `Patient`, `Encounter`, `TriageLevel`, `TriageFlowchart`, `TriageEvaluation`, `Role`, `UserOrganizationRole`. Además, `patient_soft_delete` (policy RESTRICTIVE) permite ver pacientes con `deletedAt IS NOT NULL` bajo break-glass.
- **Auth/audit** (`06_rls_auth_audit.sql`): `audit.AuditLog` (SELECT), `Session`/`UserCredential` (variantes con `AND is_break_glass()` acotado por `userId`/`organizationId` en algunos casos — ver el SQL exacto por tabla).
- **Por dominio** (mismo patrón, un archivo por módulo): `OutpatientAppointment` (08), `LabOrder` (10), `ClinicalNote` (11), `InpatientAdmission` (12), `EmergencyVisit` (13), `SurgeryCase` (14), `MedicationAdministration` (15), `ImagingOrder` (16, 192), `PatientCoverage`/`AuthorizationRequest`/insurance genérica (17), `StockLot`/`StockMovement`/inventory genérica (18), `BiomedicalEquipment` (19), `RespiratoryOrder` (20), `DietPlan`/`NutritionAssessment`/`NutritionOrder` (21), `Prescription` (09), catálogo CPT (183), pathology (46), ronda/`RondaSession` (34), `UserServiceUnitAssignment` (60).

**No existe un GUC de acotamiento por paciente.** El GUC que setea `set_tenant_context(userId, orgId, breakGlass)` no incluye el `patientId` declarado en la activación — las policies RLS no lo conocen. Esto es una limitación deliberada de esta fase, no un bug: las policies RLS existentes (US-1.7/US-1.8, pre-CC-0017) fueron diseñadas así, y **no se tocó SQL en esta fase** (fuera de scope explícito de la tarea: "NO apliques SQL a prod"). Si se requiere acotar la elevación al paciente declarado, es un cambio de policies (nuevo SQL, numerar 196+) que queda fuera de este entregable — documentado aquí como gap conocido, no silenciado.

**Lo que SÍ acota el uso real**: la auditoría (§4) registra, para cada request bajo break-glass, el `patientId` que el usuario declaró al activar — aunque la policy técnica permita ver cualquier paciente, cualquier acceso queda atribuido y trazable contra la justificación declarada. El control es de **auditoría posterior**, no de **prevención técnica** por paciente — consistente con el patrón break-glass estándar en sistemas clínicos (HIPAA/HITECH): se confía y se verifica, no se bloquea.

## 4. Auditoría de cada acceso bajo break-glass

Postgres no soporta triggers `BEFORE SELECT` — el trigger genérico de auditoría (`audit.fn_audit_row()`, `02_audit_triggers.sql`) sólo cubre INSERT/UPDATE/DELETE. El propio comentario del SQL ya lo señalaba: *"El control de break-glass en lecturas (SELECT) se hace desde la capa de aplicación (middleware) que setea app.justification antes del query"* — pero ese middleware nunca se implementó hasta ahora.

`packages/trpc/src/trpc.ts` — `tenantProcedure` (la base de la que heredan `requireRole`/`requirePermission`, es decir **todo** procedure tenant-scoped) ahora, tras ejecutar la request:

```ts
const result = await next({ ctx: { ...ctx, tenant } });
if (tenant.breakGlass && result.ok) {
  await auditBreakGlassAccess(ctx, { path, type });
}
```

Escribe una fila en `audit.AuditLog` con `action=READ`, `entity=BreakGlassAccess`, `entityId=<patientId declarado en la cookie>`, `justification="break-glass activo: <type> <path>"`, `afterJson={ path, type, patientIdDeclarado }`. Esto audita **cada invocación tRPC** (no cada query SQL individual dentro de un procedure) mientras la sesión break-glass esté activa — limitación práctica aceptada: dado que break-glass es raro (TTL 1h, requiere justificación explícita) y el volumen de invocaciones por sesión es bajo, auditar a nivel de procedure da trazabilidad suficiente sin instrumentar cada query.

**Best-effort deliberado**: si el INSERT de auditoría falla (`try/catch`, `console.error`, no re-throw), la respuesta al cliente NO se bloquea. El acceso de emergencia ya quedó auditado en la activación (`break-glass.router.ts`/`break-glass.ts` §5); un fallo transitorio en este registro puntual de "uso" no debe impedir la atención clínica — la disponibilidad del acceso de emergencia prevalece sobre la completitud de este log secundario.

## 5. Notificación al jefe de servicio (TODO cerrado)

**No existe rol "jefe de servicio" seedeado** en el catálogo `Role` (confirmado: `seed.ts` sólo siembra `ADMIN`, `PHYSICIAN`, `NURSE`, `ADMISSION_CLERK`, `TRIAGE_NURSE`, `PHARMACIST`; ningún SQL de specialized roles agrega uno). Tampoco existe un campo `headUserId`/`serviceHeadId` en `ServiceUnit`. Por eso el fallback documentado en la tarea original ("degradar a admin/DIR de la org") es en realidad la **única** ruta viable hoy, no un fallback secundario.

Se conectó al **outbox existente** (Beta.15: `DomainEvent` + `dispatcher.ts`), NO un email ad-hoc:

1. Nuevo `eventType` `security.breakGlass.activated` (`packages/contracts/src/events/catalog.ts` + `payloads.ts` — schema `securityBreakGlassActivatedPayloadSchema`, discriminated union).
2. Al activar break-glass (`break-glass.ts` Server Action Y `break-glass.router.ts` — ambos paths de activación, UI y externo/tests), tras el `AuditLog(action=BREAK_GLASS)` existente, se llama `emitDomainEvent(prisma, {...})` — best-effort, `try/catch` con `console.error`, no bloquea la activación (ya exitosa).
3. `packages/infrastructure/src/notifications/dispatcher.ts` — nuevo resolver `resolveSecurityBreakGlassActivated`: busca `UserOrganizationRole` vigentes con `role.code IN (DIR, DIRECTOR, MEDICAL_DIRECTOR, ADMIN)` en la organización del evento, notifica a **todos** los que encuentre (severity `CRITICAL`, canal INBOX + EMAIL si hay `emailProvider` configurado).
4. Nuevo template `buildSecurityBreakGlassActivatedTemplate` (`templates.ts`) — **deliberadamente NO incluye el `patientId` ni datos identificativos del paciente** en el cuerpo del correo (sólo justificación + fecha de vencimiento + id de auditoría): evita filtrar PHI a un canal (email) menos controlado que el HIS. El destinatario revisa el detalle completo en el módulo de Auditoría.

**Canal real**: fila `Notification` (INBOX, consumida por `notificationsRouter`/`NotificationsBadge`, ya visible en el shell) + `DomainEvent` en el outbox para dispatch EMAIL si el poller `pg_cron`/`pg_net` (`44_notifications_outbox_poller.sql`) está activado en el proyecto Supabase — igual que el resto de eventTypes existentes (`vital.critical`, `lab.criticalValue`, etc.), cuyo estado de activación en prod es independiente de esta entrega. Si no hay ningún `DIR`/`ADMIN`/`MEDICAL_DIRECTOR` con membresía vigente en la organización, el dispatcher reporta `skippedReason: "no-recipient"` — el evento y el audit log de activación quedan igualmente registrados (§4 del `emitDomainEvent`, que además audita su propia emisión).

## 6. UI — indicador "break-glass ACTIVO"

No existía ningún indicador antes de esta fase (`BreakGlassButton`/`BreakGlassModal` ya existían de US-2.7 pero no estaban cableados en ninguna página, y no había banner de sesión activa).

Nuevo `apps/web/src/components/break-glass-banner.tsx` (`BreakGlassBanner`) — banner rojo persistente (patrón visual análogo a `AllergyAlert` de `@his/ui`, pero a nivel de sesión completa, no de paciente), montado en `AppShell` (`apps/web/src/components/app-shell.tsx`, justo debajo del header, visible en TODAS las páginas mientras la sesión esté activa) vía el nuevo prop `breakGlass={tenant?.breakGlassSession ?? null}` pasado desde ambos layouts autenticados (`(clinical)/layout.tsx` y `(admin)/layout.tsx`).

Muestra: justificación declarada + countdown en vivo hasta `expiresAt` (actualizado cada segundo) + botón "Desactivar". El botón llama a `clearBreakGlass()` (Server Action, actualizada en esta fase): lee el `patientId` de la cookie **antes** de borrarla, escribe un `AuditLog(action=UPDATE, entity=BreakGlassAccess, justification="Break-glass desactivado manualmente por el usuario.")` (best-effort, no bloquea el borrado de la cookie si falla), borra la cookie, y hace `router.refresh()`.

## 7. Alcance NO cubierto (límites explícitos)

- **No eleva `requireRole`/`requirePermission`** (autorización RBAC de CC-0017 Fase 1). Break-glass en esta fase es exclusivamente elevación de **visibilidad RLS** (SELECT en Postgres). Un usuario sin el rol requerido por `requireRole(["PHYSICIAN"])` sigue recibiendo `FORBIDDEN` aunque tenga break-glass activo — el gate de autorización de aplicación y el gate de RLS son capas independientes, y esta entrega sólo cablea la segunda. `REQ-SEC-RBAC-001` §9 dejó esta pregunta abierta ("¿bypass total en requireRole?") — la respuesta de esta fase es **no**, deliberadamente: mezclar "puedo ver esta fila en Postgres" con "tengo el rol de negocio para ejecutar esta acción" ampliaría el radio de un break-glass mucho más allá de lectura de emergencia (p.ej. permitiría firmar documentos clínicos sin ser MC). Si se requiere en el futuro, es una decisión de producto explícita, no una consecuencia automática de esta fase.
- **No acota la elevación al paciente declarado** (§3) — es org-wide en las tablas listadas, no patient-scoped. Requiere nuevo SQL de policies (fuera de este entregable).
- **No escribe SQL nuevo a prod.** Las policies que hacen la elevación real ya existían (US-1.7/US-1.8). Esta fase sólo conecta la cookie → `TenantContext` → `withTenantContext` → GUC ya soportado.
- **Notificación best-effort, no garantizada.** Si el outbox (`pg_cron`/`pg_net`) no está activo en el proyecto Supabase, la notificación EMAIL no sale — el `DomainEvent` queda emitido (auditable) pero sin dispatch. Esto es idéntico al comportamiento de todos los demás `eventType` del sistema (Beta.15), no una regresión introducida aquí.

## 8. Tests

| Archivo | Qué prueba |
|---|---|
| `apps/web/src/lib/auth/__tests__/break-glass-cookie.test.ts` | `parseBreakGlassCookie` — fail-safe: ausente/vacía/JSON corrupto/campos faltantes/fecha inválida/expirada (incluye borde exacto TTL) → `null`; cookie vigente → sesión con `expiresAt` futuro. |
| `packages/trpc/src/__tests__/rls-context-breakglass.test.ts` | `applyTenantContext`/`withTenantContext` — `tenant.breakGlass` ausente/false → GUC `false` (fail-safe); `true` → GUC `true` SIN pasar `options.breakGlass`; `options.breakGlass` explícito gana sobre `tenant.breakGlass`. |
| `packages/trpc/src/__tests__/tenant-procedure-breakglass-audit.test.ts` | `tenantProcedure` — sin `breakGlass`/`false` → NO audita (fail-safe, idéntico a hoy); `true` → audita `action=READ, entity=BreakGlassAccess`; procedure que lanza error → NO audita; fallo del audit log → no rompe la respuesta. |
| `packages/trpc/src/routers/__tests__/break-glass.router.test.ts` | `activate` encola `security.breakGlass.activated` vía `emitDomainEvent`; fallo del outbox no bloquea la activación. |
| `packages/infrastructure/src/notifications/__tests__/dispatcher-routing.test.ts` (bloque nuevo) | Resuelve DIR/ADMIN/MEDICAL_DIRECTOR vigentes → notifica CRITICAL a todos; sin ninguno → `no-recipient` (no bloquea break-glass); el email NO incluye el `patientId` (PHI). |
| `apps/web/src/app/actions/__tests__/break-glass.test.ts` | `clearBreakGlass` — cookie válida → audita el cierre + borra cookie; sin cookie → no audita (fail-safe); fallo del audit → best-effort, igual borra la cookie. |
| `apps/web/src/components/__tests__/break-glass-banner.test.tsx` | Sin sesión → no renderiza nada; con sesión → muestra aviso + justificación + botón; click en Desactivar → llama `clearBreakGlass()` + `router.refresh()`. |
| `apps/web/src/components/__tests__/app-shell.test.tsx` | Regresión: AppShell ahora monta `BreakGlassBanner`, que importa el Server Action `break-glass.ts` (Prisma real + `cache()` de RSC no disponibles en jsdom/Vitest) — se mockeó `@/app/actions/break-glass` explícitamente (mismo patrón que el mock de tRPC ya existente en este archivo). |

Prueba de elevación efectiva contra una policy real (`is_break_glass()` en Postgres) **ya existía** y no se tocó: `packages/trpc/src/__tests__/rls-isolation.test.ts` Test 4 ("Break-glass permite cross-org"), gateada por `RUN_RLS_TESTS=1` contra una BD de test real.

## 9. Verificación

- `npm run typecheck` (raíz, turbo, 7 workspaces): **verde**.
- `npm run -w @his/contracts test`: 45 archivos, 1732 tests — verde.
- `npm run -w @his/trpc test`: 185 archivos, 2805 tests (24 skipped) — verde, incluye los 12 tests nuevos de esta fase.
- `npm run -w @his/infrastructure test`: 8 archivos, 146 tests — verde, incluye los 3 tests nuevos del dispatcher.
- `npm run -w @his/database test`: 7 archivos, 97 tests — verde (sin cambios de esta fase).
- `npm run -w @his/web test`: 54 archivos, 597 tests — verde, incluye los 14 tests nuevos de esta fase + el fix del mock en `app-shell.test.tsx`.
- `npm run lint` (raíz, turbo): 7/7 tareas exitosas, sin errores nuevos (warnings pre-existentes no relacionados, no tocados).

## 10. Archivos tocados

**Nuevos:**
- `apps/web/src/lib/auth/break-glass-cookie.ts` — `parseBreakGlassCookie` puro.
- `apps/web/src/components/break-glass-banner.tsx` — `BreakGlassBanner`.
- `apps/web/src/lib/auth/__tests__/break-glass-cookie.test.ts`
- `apps/web/src/app/actions/__tests__/break-glass.test.ts`
- `apps/web/src/components/__tests__/break-glass-banner.test.tsx`
- `packages/trpc/src/__tests__/rls-context-breakglass.test.ts`
- `packages/trpc/src/__tests__/tenant-procedure-breakglass-audit.test.ts`
- `packages/trpc/src/routers/__tests__/break-glass.router.test.ts`
- `docs/CC/0017/REQ-SEC-BG-003-break-glass-funcional.md` (este archivo)

**Modificados:**
- `packages/contracts/src/types/index.ts` — `TenantContext.breakGlass`/`breakGlassSession` (opcionales).
- `apps/web/src/lib/auth/session.ts` — `getTenantContext()` lee la cookie vía `parseBreakGlassCookie`.
- `packages/trpc/src/rls-context.ts` — `applyTenantContext`/`withTenantContext` heredan `tenant.breakGlass`.
- `packages/trpc/src/trpc.ts` — `tenantProcedure` audita accesos bajo break-glass.
- `packages/contracts/src/events/catalog.ts` + `payloads.ts` — nuevo `eventType` `security.breakGlass.activated`.
- `packages/infrastructure/src/notifications/dispatcher.ts` + `templates.ts` — resolver + template del nuevo eventType.
- `apps/web/src/app/actions/break-glass.ts` — encola notificación al activar; `clearBreakGlass` audita el cierre.
- `packages/trpc/src/routers/break-glass.router.ts` — encola notificación al activar.
- `apps/web/src/components/app-shell.tsx` + `apps/web/src/app/(clinical)/layout.tsx` + `apps/web/src/app/(admin)/layout.tsx` — cablean `BreakGlassBanner`.
- `apps/web/src/components/__tests__/app-shell.test.tsx` — mock del Server Action (regresión detectada y corregida en esta fase).
- `apps/web/vitest.config.ts` — alias `@his/contracts/events` (faltaba; expuesto por la nueva cadena de imports de `AppShell` → `break-glass.ts` → `@his/database` → `emit.ts` → `@his/contracts/events`).
