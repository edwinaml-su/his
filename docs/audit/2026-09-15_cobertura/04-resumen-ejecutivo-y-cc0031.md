# Auditoría de cobertura 2026-09-15 — Resumen ejecutivo consolidado + diseño CC-0031

**Insumos:** `00-inventario-infra-notificaciones.md` (infra), `01-admision-emergencia-hosp-quirofano.md`, `02-hc-farmacia-lab-imagen.md`, `03-facturacion-admin-seguridad.md` (auditorías por módulo, con evidencia archivo:línea). Método: 3 auditores independientes + 1 inventario de infraestructura, solo lectura de código + `SELECT` contra prod.

---

## 1. Resumen ejecutivo (10 viñetas)

1. **El sistema de notificación interno que pidió la dirección NO existe funcionalmente** — pero su infraestructura sí: outbox `DomainEvent` + poller pg_cron activo (176.828 corridas) + modelo `Notification` + campana + `/notifications` están construidos y VACÍOS (0 filas). El gap es el puente, no la plomería (00 §0).
2. **Solo 4 de ~170 tipos de evento llegan hoy a alguien** (`vital.critical`, `lab.criticalValue`, `drug.interaction`, `allergy.mismatch`, vía Edge Function); el dispatcher TS de 13 casos es huérfano (0 callers). Ningún evento de admisión, triage, censo, quirófano, ECE, GS1 o facturación notifica a nadie (02 P0-1, corrige el conteo de 01).
3. **La matriz "acción requerida por rol" YA existe y funciona**: Workflow Inbox `/tareas` con 69 tipos de tarea × roles (`TASK_REQUIRED_ROLES`) × SLA (`TASK_SLA_MINUTES`) — pero es efímera, invisible fuera de `/tareas` y la campana del navbar siempre marca 0 (00 §4).
4. **~30 códigos de rol referenciados por tareas no existen en `public."Role"`** (14 filas reales): `MC, ENF, PHARM, LAB_TECHNICIAN, RAD_TECHNICIAN, FACTURACION, CALIDAD, BODEGA…` — esas tareas nunca le aparecen a nadie (00 §5.1).
5. **Seguridad P0 — escalación de privilegios self-service**: `rbac.router` y `user-admin.router` permiten a CUALQUIER usuario del tenant crear/otorgarse roles y permisos sin gate ni auditoría en el hash chain (03 P0-1/2/3). Es el hallazgo más grave de la auditoría.
6. **RLS bypass estructural en el frente clínico**: `encounter.router` (admisión/camas) no usa `withTenantContext` en ninguna procedure, y 6 routers ECE dependen de `withWorkflowContext`, un stub sin `SET LOCAL` (01 P0-1/2, confirmado en 02 P0-7).
7. **Gates clínicos bypaseables**: egreso físico CC-0027 evitable vía `inpatient.discharge`; acta quirúrgica firmable sin consentimiento informado verificado; el cargo C3-2 de quirófano solo se genera por la vía legacy, no por la NTEC (01 P0-3/4/5).
8. **Laboratorio/Imágenes**: el circuito de valor crítico con SLA y read-back (`critical-result.router`) nunca se invoca desde LIS; el ciclo post-solicitud de imágenes (programar→dictar→firmar) no tiene UI ni roles; `lis.router` no exige rol en todo el ciclo (02 P0-2/3/4).
9. **Farmacia**: reserva caducada (4h) deja stock descontado y cargo `VIGENTE` huérfanos, invisible en conciliación (02 P0-6). Lo remediado en Olas 1-4b + CC-0030 (cargos, 2-eyes, entrega parcial) está confirmado cerrado en el camino real.
10. **Riesgo residual dominante**: procesos que dependen de que alguien "entre a ver" (tableros, conciliación, bandeja) sin empuje activo ni escalamiento — exactamente lo que CC-0031 debe cerrar.

## 2. Corrección de estado (verificada hoy contra prod)

- `sql/213` (dual-context del outbox): **las policies de `public."DomainEvent"` en prod YA usan `current_org_id_or_ece_context()`** (verificado por `pg_policy`, 2026-09-15). La cabecera del archivo está desactualizada. El outbox en 0 se explica por (a) dispatcher que descarta ~166 tipos y (b) bajo volumen real de flujos ECE en prod — no por RLS. CC-0031 debe incluir prueba de humo de emisión end-to-end.

## 3. Backlog P0 consolidado (dedupe 01+02+03)

| # | Brecha | Fuente | Dueño propuesto |
|---|---|---|---|
| C1 | Escalación de privilegios RBAC/user-admin sin gates + sin auditoría hash chain | 03 P0-1/2/3 | CC-0032 (seguridad, URGENTE) |
| C2 | RLS bypass: `encounter.router` + stub `withWorkflowContext` en 6 routers ECE | 01 P0-1/2, 02 P0-7 | CC-0033 (RLS) |
| C3 | **Sistema de notificación interno por rol** (puente tareas→Notification, resolver por rol, campana, escalamiento) | 00 §10, 01 P0-8, 02 P0-1 | **CC-0031 (este pedido)** |
| C4 | Roles faltantes/alias (~30 códigos huérfanos) — prerequisito de C3 | 00 §5.1, 01/03 | CC-0031 fase 0 |
| C5 | Gate egreso físico bypaseable + acta sin consentimiento + cargo quirófano vía NTEC | 01 P0-3/4/5 | CC-0034 |
| C6 | Valor crítico LIS sin invocar + imágenes sin ciclo UI/roles + lis sin requireRole | 02 P0-2/3/4/5 | CC-0035 |
| C7 | Reserva EXPIRED deja stock/cargo huérfanos | 02 P0-6 | fix corto (farmacia) |
| C8 | Watchdog SLA de triage Manchester inexistente | 01 P0-6 | entra como tipo de tarea en CC-0031 |

P1/P2 completos con criterios de aceptación: ver secciones 6 de `01/02/03-*.md`.

---

## 4. Diseño CC-0031 — Notificaciones internas por rol (v1)

**Principio:** extender, no duplicar (00 §10). Fuente de verdad de "acción requerida" = Workflow Inbox (69 tipos × rol × SLA) + `CareTask`; capa de entrega = outbox `DomainEvent` → `Notification` → campana/`/notifications`; roles = `public."Role"` + `RoleCodeAlias` + herencia + `UserServiceUnitAssignment`.

### Fase 0 — Roles (prerequisito, SQL nuevo)
- Poblar `RoleCodeAlias` para los códigos huérfanos que son sinónimos (`MC→PHYSICIAN`, `ENF→NURSE`, `PHARM→PHARMACIST`, `TRIAGIST→TRIAGE_NURSE`, `ADM→ADMISSION_CLERK`…) y crear las filas `Role` que son roles reales nuevos (`LAB_TECHNICIAN`, `RAD_TECHNICIAN`, `FACTURACION`, `CALIDAD`, `BODEGA`, `GERENTE`, `ADMIN_CLINICO`…), inactivables por org.
- Criterio: toda entrada de `TASK_REQUIRED_ROLES` resuelve a ≥1 rol existente vía alias/herencia.

### Fase 1 — Puente tarea→notificación (corazón)
- Nuevo eventType `task.action_required` (+ `task.sla_warning`, `task.sla_exceeded`, `task.escalated`) en `payloads.ts` (⚠️ hotspot: merge secuencial) con payload `{taskType, sourceType, sourceId, assignedRoleCode, establishmentId?, serviceUnitId?, dueAt?, url}`.
- Emisión: (a) `care-task-consumer`/`order-consumer` emiten al crear `CareTask`; (b) emisores puntuales en los flujos de mayor valor del Inbox (receta firmada→farmacia, resultado por validar→validador, documento ECE por firmar→firmante, cuenta PENDIENTE_TARIFA→facturación — este evento ya se emite y hoy se pierde).
- **Resolver genérico por rol** en la Edge Function + dispatcher TS: generalizar `resolveSecurityBreakGlassActivated` (UserOrganizationRole vigente + `distinct userId` + expansión alias/herencia + filtro establecimiento/unidad si viene en payload). Config severidad×canal desde `RoleNotificationDefault` (correr `seed:notif-defaults`; `routing.ts` pasa a leer BD).
- Anti-saturación: idempotencia ya existente (`@@unique([eventId, recipientUserId, channel])`) + agrupación por (taskType, destinatario) en ventana.

### Fase 2 — Visibilidad
- Campana = `notifications.unreadCount` + `workflowInbox.contadorBadge` (hoy huérfano), con desglose al abrir; deep-link a `/tareas` y `/notifications`.
- Acuse: `markRead` ya existe; toda notificación de acción requerida enlaza la tarea origen.

### Fase 3 — SLA y escalamiento
- Poblar `CareTask.slaMinutes`/`dueAt` desde `TASK_SLA_MINUTES`; cron `caretask_sla_watchdog` (patrón sql/114/120) emite `task.sla_warning` (70%) y `task.sla_exceeded` (100%) al rol superior (matriz de escalamiento por taskType: `NURSE→ADMIN_CLINICO`, `PHYSICIAN→DIR`, `FACTURACION→GERENTE`…).
- `workflowInbox.escalar` emite `task.escalated`.

### Fuera de alcance v1
Push/SMS/WhatsApp/realtime (polling 30 s se mantiene), deduplicación de silos de alertas (P3), email masivo (INBOX primero; EMAIL solo CRITICAL vía routing existente).

### Criterios de aceptación (verificables)
1. Firmar una indicación crea `CareTask` + fila `DomainEvent` + N filas `Notification` (una por usuario vigente del rol destino en la org) — test de integración.
2. La campana de un usuario NURSE muestra >0 tras la firma, sin entrar a `/tareas`.
3. `cargo.pendiente_tarifa` genera notificación al rol FACTURACION (hoy se pierde).
4. Tarea vencida genera `task.sla_exceeded` al rol de escalamiento (test con reloj simulado del watchdog).
5. Todo envío queda en `Notification` con status forward-only (trazabilidad; retención 90d ya definida).
6. Cero duplicados por reejecución del poller (idempotencia por unique existente).
