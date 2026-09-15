# Inventario de infraestructura de notificaciones, alertas, eventos y tareas — HIS

**Fecha:** 2026-09-15 · **Modo:** solo lectura · **HEAD:** `128138f` · **Evidencia de prod:** consultas `SELECT` read-only vía MCP Supabase (`ejacvsgbewcerxtjtwto`).

Insumo del diseño del sistema de notificación interno por rol (CC-0031). Auditoría de cobertura completa en `01..03-*.md` de esta carpeta.

---

## 0. Resumen ejecutivo (el hallazgo que decide todo)

Existen **dos sistemas paralelos y desconectados**:

| Sistema | Qué es | Estado real |
|---|---|---|
| **A. Beta.15 Notifications (outbox → dispatcher → inbox/email)** | `DomainEvent` → poller pg_cron → Edge Function → `Notification` → campana + `/notifications` | **Infra 100% construida y encendida, pero VACÍA**: `DomainEvent = 0 filas`, `Notification = 0 filas`. El poller lleva **176.828 corridas exitosas procesando cero eventos**. |
| **B. Workflow Inbox (`/tareas`)** | Bandeja BPM que **calcula tareas por rol al vuelo** (69 tipos de tarea, `TASK_REQUIRED_ROLES`, SLA, prioridad derivada) | **Existe y FUNCIONA hoy** — es el único mecanismo real de "acción requerida por rol" en producción. No persiste nada, no notifica, solo se ve si el usuario entra a `/tareas`. |
| **C. CareTask (CC-0026)** | Tarea persistida generada al firmar indicación médica, con `assignedRoleCode` | Tabla **existe en prod** y routers/UI cableados, pero **0 filas** — la generación depende de `firmar()`, que históricamente hacía rollback (ver §3.4). |

**Veredicto corto:** la base correcta a extender es **B (Workflow Inbox) + C (CareTask)** como fuente de "acción requerida por rol", enchufada a **A (Notification)** como capa de entrega. Lo que falta no es infraestructura, es **el puente**: nadie traduce "tarea pendiente de mi rol" en una fila `Notification`.

---

## 1. Beta.15 — alerts/notifications: qué se especificó vs. qué existe

### 1.1 Blueprints

| Archivo | Contenido |
|---|---|
| `docs/blueprints/beta15_notifications.md` | Spec funcional Beta.15 |
| `docs/blueprints/beta15_notifications_dba_review.md` | Review @DBA (retención 90d, hash chain SKIP en Notification) |
| `docs/blueprints/beta15_notifications_sre_review.md` | Review @SRE (decisión §5.1: pg_cron + pg_net, NO Inngest, NO Vercel Cron) |
| `docs/blueprints/beta15_poller_activation.md` | Runbook de activación en 7 pasos. Su cabecera ("SQL 44 NO aplicado") está **superada** — ver §1.3 |
| `docs/backlog/beta15_alerts_notifications.md` | Backlog US.B15.* (referenciado desde `routing.ts:4`) |

### 1.2 Piezas de código — estado pieza por pieza

| Pieza | Ruta:línea | Estado |
|---|---|---|
| Enums `NotificationChannel` (INBOX, EMAIL) | `packages/database/prisma/schema.prisma:4405` | Existe y se usa |
| Enum `NotificationSeverity` (CRITICAL, WARNING, INFO) | `schema.prisma:4413` | Existe y se usa |
| Enum `NotificationStatus` (PENDING→SENT→DELIVERED→READ / FAILED) | `schema.prisma:4422` | Existe y se usa |
| Modelo `DomainEvent` (outbox) | `schema.prisma:4437` | Existe, **0 filas en prod** |
| Modelo `Notification` | `schema.prisma:4474` | Existe, **0 filas en prod** |
| Modelo `UserNotificationPreference` | `schema.prisma:4509` | Existe, **1 fila en prod** (prueba manual) |
| Modelo `RoleNotificationDefault` | `schema.prisma:4524` | Existe, **0 filas en prod** → seed nunca corrido |
| `emitDomainEvent()` | `packages/database/src/outbox/emit.ts` | Existe y se usa (**117 archivos** lo llaman) |
| Dispatcher TS | `packages/infrastructure/src/notifications/dispatcher.ts:537` | Existe, **NO cableado a ningún caller de runtime** (`dispatchDomainEvent` no se invoca fuera de tests) |
| Routing rules por rol × severidad | `packages/infrastructure/src/notifications/routing.ts:57-70` | Existe; matriz **hardcodeada**, no lee `RoleNotificationDefault` (deuda documentada en `routing.ts:16-18`) |
| Templates de email | `packages/infrastructure/src/notifications/templates.ts` | Existe, 11 templates |
| Provider Resend | `packages/infrastructure/src/notifications/resend.ts` | Existe |
| Provider SMTP (nodemailer / M365) | `packages/infrastructure/src/notifications/smtp.ts:238` | Existe y **se usa**, pero solo en `user-admin.router.ts:175` (invitaciones) y `api/admin/email/test/route.ts:73` |
| Edge Function `notifications-dispatch` | `supabase/functions/notifications-dispatch/` (1.140 líneas) | Existe; reimplementa el dispatcher en Deno |
| Router tRPC `notifications` | `packages/trpc/src/routers/notifications.router.ts` (235 líneas) | Existe y cableado (`_app.ts:287`) |
| Campana navbar | `apps/web/src/components/notifications-badge.tsx:36` | Existe y cableada en ambos layouts |
| Centro de notificaciones | `apps/web/src/app/(clinical)/notifications/page.tsx` (310 líneas) | Existe |
| Preferencias de usuario | `apps/web/src/app/(admin)/settings/notifications/page.tsx` (226 líneas) | Existe |
| Seed de defaults por rol | `packages/database/seed-notifications-defaults.ts` (script `seed:notif-defaults`) | Existe, **nunca ejecutado** (0 filas) |

Procedures del router: `list:38`, `markRead:71`, `unreadCount:112`, `getPreferences:135`, `setPreferences:191`, `resetPreferences:229` — todos `tenantProcedure`, filtrados por `recipientUserId = ctx.user.id`.

### 1.3 Estado de infraestructura en PROD (verificado 2026-09-15)

```
pg_cron 1.6.4  ✅ instalada        pg_net 0.20.0 ✅ instalada
cron.job jobid=1 'notifications-poll-outbox'  */1 * * * *  active=true
  → SELECT notifications.process_outbox_batch(50);
  → corridas exitosas: 176.828     eventos procesados: 0
notifications.process_outbox_batch(integer)  ✅ existe
```

Otros cron jobs activos en prod:

| job | schedule | qué hace |
|---|---|---|
| `critical_result_sla_watchdog` | `*/5 * * * *` | INSERT en `DomainEvent` (`critical_result.sla_warning` / `sla_exceeded`) — `sql/114:112` |
| `morse_sla_watchdog` | `0 * * * *` | INSERT en `DomainEvent` (`ipsg6.morse_sla_exceeded`) — `sql/120:43` |
| `his-expire-pharmacy-reservations` | `*/5 * * * *` | `sql/89` |
| `his-retencion-pasivo-nightly` | `0 2 * * *` | retención ECE |
| `kpi_falls_rate_refresh` | `0 3 * * *` | matview analytics |

---

## 2. DomainEvent / eventos de dominio

### 2.1 Catálogo de eventTypes

`packages/contracts/src/events/catalog.ts:17-184` — **~170 eventTypes** (union discriminada en `payloads.ts`, 1.728 líneas). Familias: clínicos core (4: `vital.critical`, `lab.criticalValue`, `drug.interaction`, `allergy.mismatch`), banco de sangre (2), patología (2), contabilidad (2), workflow (1), **ECE/NTEC (~70)**, **GS1/farmacia (~20)**, farmacovigilancia (5), JCI/IPSG (10), otros (`cold_chain.excursion`, `patient.transfer.*`, `security.breakGlass.activated`, `cargo.pendiente_tarifa`).

### 2.2 Quién EMITE

**117 archivos** llaman `emitDomainEvent`: ~55 routers en `packages/trpc/src/routers/**` (casi todos los `ece/*`), más `charge-capture.ts`, `mar-consumer.ts`, y 2 cron jobs SQL con `INSERT INTO public."DomainEvent"` directo (`sql/114`, `sql/120`).

### 2.3 Quién CONSUME — **aquí está el agujero**

El único consumidor es `dispatchDomainEvent` / la Edge Function, y **solo soporta 13 eventTypes de ~170** (`dispatcher.ts:131-167`): los 4 clínicos core, 2 transfusión, 2 patología, 2 contabilidad, `security.breakGlass.activated`, y `ece.rectificacion.{aprobada,rechazada}` (fuera del switch, `dispatcher.ts:159`). Todo lo demás cae en `default: return []` → `skippedReason: "no-recipient"`. **Los ~157 eventTypes restantes mueren en la tabla sin generar notificación**, aun si el outbox tuviera filas.

### 2.4 Por qué `DomainEvent = 0 filas` (causa raíz documentada)

`sql/213_domain_event_dual_context.sql:1-31`: `emitDomainEvent()` inserta bajo la policy `domain_event_tenant_insert` (sql/42) que exige `"organizationId" = public.current_org_id()`, pero la mayoría de los call-sites corren bajo `withEceContext`, que nunca setea `app.current_org_id` → deny-all silencioso; el error **revertía la transacción entera del caller** (commit `fd0bc09`). Fix disponible: `sql/213` (policies dual-context) — su cabecera dice **"NO aplicado a prod por este archivo"** (`213:93`). ⚠️ Nota: `sql/213` SÍ está en la cadena de BD efímera de los workflows E2E; su estado real en prod debe verificarse antes de aplicar (los 0 eventos sugieren que en prod no está surtiendo efecto).

---

## 3. Tareas CC-0026 (indicación → tareas + tableros)

### 3.1 Modelo `CareTask` (`schema.prisma:8598-8641`)

| Campo | Tipo | Nota |
|---|---|---|
| `assignedRoleCode` | `varchar(40)` | **Código de rol destino, sin FK** — catálogo en aplicación |
| `assigneeId` | `uuid?` | usuario específico opcional, sin FK |
| `serviceUnitId` | `uuid?` | hoy **siempre NULL** desde el consumer (§3.3) |
| `sourceType` | `varchar(30)` | polimórfico: `INDICACION_ITEM \| LAB_ORDER \| IMAGING_ORDER \| TRANSFER \| MANUAL` |
| `sourceId` | `uuid` | PK de la fila origen, sin FK |
| `taskType` | `varchar(60)` | `IND_MED_CUMPLIR`, `IND_DIETA`, `IND_CUIDADOS`, `IND_PROCEDIMIENTO`, `IND_ESTUDIO`, `IND_REPOSO`, fallback `IND_GENERAL` |
| `priority` / `status` | `varchar` | `LOW..CRITICAL` / `PENDIENTE \| EN_PROCESO \| CUMPLIDA \| CANCELADA` |
| `slaMinutes`, `dueAt` | | **declarados pero nunca poblados** por los consumers |

Índice clave: `@@index([organizationId, assignedRoleCode, status])` (`8636`) — ya optimizado para consulta por rol.

### 3.2 SQL

`sql/209` (DDL + RLS dual-GUC; cabecera dice "NO aplicado" pero **la tabla SÍ existe en prod**), `sql/210/211` marcados "NO aplicado", `sql/212` APLICADO 2026-08-26.

### 3.3 Cómo se ASIGNA — **a ROL, no a usuario**

Tres productores, todos con rol hardcodeado: indicaciones→`"NURSE"` (`care-task-consumer.ts:202`), lab→`"LAB_TECHNICIAN"` (`order-consumer.ts:315`), imagen→`"RAD_TECHNICIAN"` (`order-consumer.ts:433`). Cableado dentro de la tx de `firmar()` (`indicaciones-medicas.router.ts:1029`); si el INSERT falla, `firmar()` hace ROLLBACK completo. ⚠️ `LAB_TECHNICIAN`/`RAD_TECHNICIAN` **no existen en `public."Role"` de prod** (§5). ⚠️ `serviceUnitId` siempre NULL: no existe bridge `ece.servicio → public."ServiceUnit"` (`care-task-consumer.ts:65-76`).

### 3.4 Estado en prod: `CareTask` = **0 filas** (mismo patrón que dejó DomainEvent en 0 — `sql/209:23-25`).

### 3.5 Routers y UI

`care-task.router.ts` (`list/iniciar/completar/cancelar`), `care-board.router.ts` (`areas/board`), `/tableros` + `/tableros/[unidad]`, nav `nav-sections.ts:145`. Gate: `careTaskProcedure = requireRole(["NURSE","TRIAGE_NURSE","LAB_TECHNICIAN","RAD_TECHNICIAN","PHYSICIAN"])`. `careBoard.areas` añade fila virtual **"ENFERMERIA" como rol** (`care-board.router.ts:107-115`) — precedente directo del modelo "bandeja por rol".

---

## 4. Workflow Inbox — la pieza más grande y la que ya funciona

| Pieza | Ruta | Tamaño |
|---|---|---|
| Contrato | `packages/contracts/src/schemas/workflow-inbox.ts` | 447 líneas |
| Router | `packages/trpc/src/routers/workflow-inbox.router.ts` | **2.525 líneas** |
| UI | `apps/web/src/app/(clinical)/tareas/page.tsx` + `task-actions-menu.tsx` | 381 l. |
| Auditoría de acciones | `sql/138` → `WorkflowTaskAction` | aplicada a prod 2026-05-25, **0 filas** |

**Listo para reusar:**
- `taskTypeEnum` con **69 tipos de tarea** (`workflow-inbox.ts:16-108`).
- **`TASK_REQUIRED_ROLES: Record<TaskType, string[]>`** (`workflow-inbox.ts:188-267`) — la matriz tarea→rol ya existe completa (ej.: `PRESCRIPTION_TO_SIGN: ["MC","PHYSICIAN"]`, `MED_TO_ADMINISTER: ["NURSE","ENF"]`, `ECE_DOC_TO_CERTIFY: ["DIR"]`).
- **`TASK_SLA_MINUTES`** por tipo (`workflow-inbox.ts:115-186`) — de 0 min a 43.200 min.
- `derivePriority()` por % de SLA consumido (`router.ts:39-48`): CRITICAL >100%, HIGH >70%, NORMAL >40%.
- Scopes `MINE|TEAM|ALL` con RBAC (`router.ts:104-110`); procedures `miBandeja:93`, `contadorBadge:2174`, `reasignar:2285`, `escalar:2330`, `completar:2361`, `comentar:2419`, `actividadEquipo:2473`.

**Limitaciones:** 100% derivado/efímero (sin fila persistida → sin leído/no-leído, sin notificación, sin push); **`contadorBadge` NO está consumido por ninguna UI** (la campana muestra `notifications.unreadCount`, siempre 0); `escalar` no emite `DomainEvent`.

---

## 5. Roles — catálogo real

### 5.1 `public."Role"` — **14 filas en prod** (verificado)

`ADMIN` (×3 orgs), `ADMISSION_CLERK`, `ANEST`, `DIR`, `ENF_NRP`, `GO`, `NURSE`, `PEDIA`, `PHARMACIST`, `PHYSICIAN`, `TRIAGE_NURSE`, `WORKFLOW_DESIGNER`. `UserOrganizationRole` = 286 filas. Seeds: `prisma/seed.ts:355-361`, `sql/64`, `sql/75`, `sql/95`.

🔴 **Drift crítico:** `TASK_REQUIRED_ROLES` referencia **~30 códigos que NO existen en `public."Role"`**: `MC, ENF, PHARM, LAB_TECH, LAB, LAB_VALIDATOR, RAD, RADIOLOGO, TRIAGIST, ANESTH, ADM, DPO, BB, CALIDAD, BODEGA, BIOMEDICA, MANTENIMIENTO, LIMPIEZA, RECEPCION, NUTRI, RESP, TERAPISTA, OBSTETRA, NEONATOLOGO, FARMACO, FACTURACION, GERENTE, ADMIN_CLINICO, LAB_TECHNICIAN, RAD_TECHNICIAN`. Cada uno es una tarea que **nunca le aparece a nadie**.

### 5.2 `ece.rol` — 9 filas (NTEC Tabla 1: `ADM, AC, ARCH, DIR, ENF, ESP, IC, MC, MT`; `sql/56:167`, `sql/63:15`). ⚠️ **`ece.asignacion_rol` = 0 filas** — la autorización real se resuelve mapeando roleCodes `public` en `apps/web/src/lib/auth/ece-permissions.ts`.

### 5.3 Puentes y guards

`RoleCodeAlias` (`schema.prisma:828`, sql/194), herencia `Role.inheritsFromRoleId` + `effective-roles.ts`, `requireRole` (`trpc.ts:183`, **376 call-sites**), `requirePermission` (`trpc.ts:210`, opt-in), resolución `tenant.roleCodes` (`session.ts:79-86`), ABAC UI (`abac.ts:33`), **`UserServiceUnitAssignment`** (`schema.prisma:1183`, sql/60) — útil para "rol + unidad".

---

## 6. Canales

| Canal | Estado | Evidencia |
|---|---|---|
| **INBOX (in-app)** | Existe y cableado, vacío | `Notification.channel=INBOX`, `/notifications`, campana |
| **EMAIL SMTP/M365** | Existe y se usa, fuera del pipeline | `smtp.ts:238`; solo invitaciones + test |
| **EMAIL Resend** | Existe, no cableado (solo Edge Function) | `notifications/resend.ts` |
| **SMS / WhatsApp / Push / WebSocket / SSE** | **No existen** | SMS comentado Beta.16+ (`schema.prisma:4406`); realtime descartado (`notifications-badge.tsx:8`) |
| **Polling** | Existe, mecanismo real | campana 30 s; `/tareas` también |
| **Toasts persistentes** | No existe | — |
| **Cron/schedulers** | Existe (6 jobs pg_cron activos) | §1.3 |

---

## 7. UI existente — mapa

| Ruta UI | Archivo | Estado |
|---|---|---|
| Campana navbar | `components/notifications-badge.tsx` | Existe, **siempre 0** |
| `/notifications` | `(clinical)/notifications/page.tsx` | Existe, **siempre vacío** |
| `/settings/notifications` | `(admin)/settings/notifications/page.tsx` | Existe |
| `/tareas` | `(clinical)/tareas/page.tsx` | **Existe y funciona** |
| `/tableros`, `/tableros/[unidad]` | `(clinical)/tableros/` | Existe (fuente vacía) |
| `/inventory/alertas`, `/triage/dashboard`, `/medico/substitutions-pending` | | Silos aparte |

---

## 8. Tablas SQL relacionadas — índice

`sql/42` (schema notifications + outbox, aplicado), `sql/43` (audit wiring, aplicado), `sql/44` (poller, **aplicado y activo**), `sql/97` (dedup), **`sql/213` (fix RLS dual-GUC del outbox — NO aplicado en prod 🔴)**, `sql/114+114a` (critical result + watchdog, aplicado), `sql/115/159` (SBAR), `sql/116/117/153` (alto riesgo/LASA), `sql/119/120` (caídas + watchdog), `sql/96` (medication window), `sql/84` (cold chain), `sql/138` (WorkflowTaskAction, aplicado, 0 filas), `sql/209-212` (CareTask), `sql/163` (rate limit).

**No existe** tabla `Alert`, `Message`, `Escalation`, `Reminder` ni `Task` genérica — las "alertas" son tablas de dominio específicas.

---

## 9. Tabla de estado consolidada

| # | Pieza | Estado |
|---|---|---|
| 1 | Modelos `Notification`/`DomainEvent`/prefs | Existe, no usado (0 filas) |
| 2 | `emitDomainEvent` | Existe y se llama (117 archivos) — **no escribe** |
| 3 | Fix RLS dual-context del outbox (`sql/213`) | Existe en repo, **NO aplicado** 🔴 |
| 4 | Poller pg_cron + pg_net | Existe y corre (176.828 runs OK) |
| 5 | Dispatcher TS | Existe, no cableado (0 callers runtime) |
| 6 | Edge Function dispatcher | Existe en repo; deploy no verificable desde repo |
| 7 | Cobertura eventTypes del dispatcher | **13 de ~170** 🔴 |
| 8 | Routing por rol × severidad | Existe, hardcodeado, ignora `RoleNotificationDefault` |
| 9 | Seed `RoleNotificationDefault` | Existe, nunca ejecutado |
| 10 | Router notifications + campana + UI | Existe y cableado, sin datos |
| 11 | Workflow Inbox `/tareas` | **Existe y FUNCIONA** |
| 12 | Matriz tarea→rol + SLA (69 tipos) | **Existe y es completa** |
| 13 | `workflowInbox.contadorBadge` | Existe, **NO consumido por la UI** 🔴 |
| 14 | `CareTask` + routers + tableros | Existe y cableado, 0 filas |
| 15 | Asignación de CareTask | A ROL hardcodeado (NURSE/LAB_TECHNICIAN/RAD_TECHNICIAN) |
| 16 | `LAB_TECHNICIAN`/`RAD_TECHNICIAN` en `Role` | **No existen** → tareas huérfanas 🔴 |
| 17 | `WorkflowTaskAction` (reasignar/escalar) | Existe, 0 filas; escalar no notifica |
| 18 | `ece.asignacion_rol` | Existe, 0 filas |
| 19 | Email SMTP M365 | Existe y se usa (solo invitaciones) |
| 20 | Push/SMS/WhatsApp/WS/SSE/toasts | No existen |
| 21 | Cron para recordatorios/escalamiento | Existe (2 watchdogs SLA ad-hoc) |

---

## 10. Veredicto: qué extender y qué falta construir

### Qué extender (NO construir de cero)

1. **`Notification` + campana + `/notifications` como capa de ENTREGA** — modelo con severidad, status forward-only, idempotencia `@@unique([eventId, recipientUserId, channel])`, RLS, retención 90d, router y UI ya hechos.
2. **`TASK_REQUIRED_ROLES` + `TASK_SLA_MINUTES` como catálogo canónico** de "acción requerida por rol" — 69 tipos × roles × SLA ya especificados y en uso; duplicarlo sería el peor error posible.
3. **`CareTask.assignedRoleCode`** + índice por rol como tarea persistida; patrón `careBoard.areas` ("ENFERMERIA" como rol).
4. **El poller pg_cron ya activo** — worker probado, solo le falta trabajo.
5. **`UserServiceUnitAssignment`** para destinatario "rol + unidad".

### Qué falta construir (orden de dependencia)

| Prioridad | Falta | Por qué |
|---|---|---|
| **P0** | Aplicar `sql/213` (verificando estado real en prod primero) | Sin esto el outbox sigue en 0 y toda la cadena Beta.15 es decorativa |
| **P0** | **Puente tarea→notificación** | Nadie convierte "tarea pendiente de rol X" en fila `Notification` — corazón del feature |
| **P0** | **Resolver destinatarios por ROL** | Generalizar el patrón de `resolveSecurityBreakGlassActivated` (`dispatcher.ts:417-444`: `UserOrganizationRole` + vigencia + distinct) con filtro por establecimiento/unidad + alias/herencia |
| **P1** | Normalizar catálogo de roles (~30 códigos huérfanos) | Crear roles reales o poblar `RoleCodeAlias`; sin esto "notificar por rol" notifica a nadie |
| **P1** | Cablear `workflowInbox.contadorBadge` a la campana | Quick win: hoy la campana dice 0 con N tareas vencidas del rol |
| **P1** | Ejecutar `seed:notif-defaults` + `routing.ts` leyendo BD | Deuda declarada en `routing.ts:16-18` |
| **P1** | Ampliar dispatcher de 13 eventTypes → resolver genérico por configuración | Evitar un `case` por evento |
| **P2** | Materializar tareas del Inbox a `CareTask` (opción a) | Base para leído/recordatorio/escalamiento |
| **P2** | Motor genérico de SLA/escalamiento (`caretask_sla_watchdog`) | Reusar patrón sql/114/120; poblar `slaMinutes`/`dueAt` desde `TASK_SLA_MINUTES`; `ESCALATE` debe emitir evento |
| **P3** | Push/realtime (Supabase Realtime sobre `Notification`) | Polling 30 s suficiente para MVP |
| **P3** | Deduplicar silos de alertas hacia el Inbox | cold chain, medication window, critical result, inventario, sustituciones |

### Cambio de schema mínimo a prever

`Notification.eventId` es NOT NULL con FK a `DomainEvent` (`schema.prisma:4477,4497`). **Recomendación: NO migrar** — emitir un `DomainEvent` real (`caretask.assigned` / `task.action_required`) por cada tarea, manteniendo el outbox como única fuente y aprovechando la idempotencia existente. Condicionado a que `sql/213` esté aplicado.
