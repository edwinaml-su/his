# Beta.15 — Alerts & Notifications Backlog

**Owner:** @PO (Chief Product Officer, Inversiones Avante)
**Stream:** Beta.15+ alerts/notifications
**Fecha:** 2026-05-14
**Estado:** Backlog inicial — pendiente refinement con @AS / @DBA
**Predecesor:** v0.2.0-phase2-skeletons (Beta layer 1 hardening completo)

---

## 1. Visión de producto

> Convertir las alertas clínicas detectadas en los routers de dominio (LASA, vital signs fuera de rango, valores críticos de laboratorio, alergias, missed doses) en **notificaciones accionables y auditables** que lleguen al rol clínico apropiado por el canal correcto, con preferencias granulares y trazabilidad completa.

**Outcomes esperables (3 meses post-release):**

- **OB1 — Reducción del tiempo medio de respuesta a alerta crítica** de "indeterminado" a `< 5 min` (medible por timestamp `alert_fired_at` → `notification_acknowledged_at`).
- **OB2 — Cobertura de eventos críticos**: ≥ 80% de los disparos de alertas Layer 1 producen al menos una notificación entregada (no swallowed by silent error).
- **OB3 — Alert fatigue control**: tasa de `mark_as_read` sin acción siguiente < 30% (señala que los umbrales/canales están bien calibrados).
- **OB4 — Audit compliance**: 100% de notificaciones tienen trazabilidad completa en `AuditLog` (qué evento, a quién, vía qué canal, status final).

---

## 2. Definition of Ready (DoR)

Una user story está lista para sprint cuando:

- [ ] AC Gherkin redactados en es-SV con escenarios happy + edge + error.
- [ ] @AS aprobó el approach técnico (al menos diagrama de secuencia esbozado).
- [ ] @DBA validó shape de schema (si aplica).
- [ ] Story points estimados por team consensus (planning poker).
- [ ] Dependencies upstream identificadas y desbloqueadas.
- [ ] Métricas de éxito definidas (cómo sabremos que la US cumplió).

## 3. Definition of Done (DoD)

Una user story se cierra cuando:

- [ ] Código mergeado en `main` vía PR + CI verde (typecheck + lint + test + build).
- [ ] Tests unitarios + 1 integration test mínimo (router → outbox → notification).
- [ ] Storybook actualizado si introduce UI nueva (si aplica).
- [ ] Documentación: comentario en código + sección en `docs/` si cambia arquitectura.
- [ ] Audit log verificado: el evento genera entrada en `AuditLog`.
- [ ] Demoeable en staging por @PO.

---

## 4. Épicas y user stories

### Épica E.B15.1 — Event Outbox + Domain Events (infraestructura base)

**Goal:** Desacoplar los routers del transporte de notificaciones mediante un outbox transaccional. Cualquier router puede emitir un evento de dominio sin saber quién (ni cómo) se entera.

**WSJF score:** Cost of delay = ALTO (bloquea a todas las demás épicas). Tamaño = MEDIO. **WSJF ≈ 8 (top priority).**

---

#### US.B15.1.1 — Tabla `DomainEvent` (outbox) + emisión transaccional

**Como** desarrollador del HIS
**quiero** una tabla `DomainEvent` que registre cualquier evento de dominio dentro de la misma transacción que lo originó
**para que** la entrega de notificaciones sea consistente con la mutación que las causó (no se pierdan eventos por crash entre commit y publish).

**AC (Gherkin es-SV):**

```gherkin
Escenario: emisión exitosa dentro de transacción
  Dado un router que crea una receta médica
  Cuando se completa la transacción de creación
  Entonces existe un registro en "DomainEvent" con eventType="prescription.created"
  Y el "payload" JSON contiene prescriptionId, organizationId, prescriberId
  Y el campo "publishedAt" es NULL

Escenario: rollback por error
  Dado un router que crea una receta médica
  Cuando la transacción falla por violación de constraint
  Entonces no existe ningún registro en "DomainEvent" para esa receta
  Y no se dispara ninguna notificación

Escenario: multi-tenancy
  Dado un usuario del tenant A emite un evento
  Cuando un usuario del tenant B consulta "DomainEvent"
  Entonces NO ve el evento del tenant A (RLS enforced)
```

- **MoSCoW:** Must
- **Story points:** 5
- **Dependencies:** ninguna (es la base)
- **Notas técnicas:** schema mínimo: `id`, `organizationId`, `eventType` (text), `aggregateType`, `aggregateId`, `payload` (JSONB), `occurredAt`, `publishedAt`, `attempts`, `lastError`. RLS por `organizationId`. Index parcial `WHERE publishedAt IS NULL` para el poller.

---

#### US.B15.1.2 — Helper `emitDomainEvent()` con tipos TypeScript

**Como** desarrollador del router de cualquier módulo
**quiero** un helper tipado `emitDomainEvent({ eventType, aggregateType, aggregateId, payload })`
**para** emitir eventos sin escribir SQL crudo y con autocomplete del eventType (union string literal).

**AC:**

```gherkin
Escenario: emisión tipada exitosa
  Dado un router que ejecuta dentro de Prisma transaction
  Cuando llama "await emitDomainEvent(tx, { eventType: 'vital.critical', aggregateType: 'InpatientVitals', aggregateId: vitals.id, payload: {...} })"
  Entonces el helper inserta una fila en "DomainEvent" usando "tx" (no crea nueva conexión)
  Y el TypeScript rechaza eventType="invalid" en compile-time

Escenario: emisión fuera de transacción
  Dado un código que llama emitDomainEvent sin pasar "tx"
  Cuando se ejecuta
  Entonces lanza error explicito "emitDomainEvent requires a Prisma transaction client"
```

- **MoSCoW:** Must
- **Story points:** 3
- **Dependencies:** US.B15.1.1
- **Notas:** Catálogo inicial de eventTypes: `vital.critical`, `lab.criticalValue`, `drug.interaction`, `allergy.mismatch`, `prescription.created`, `med.missed`, `coverage.expired`. Vivirá en `packages/contracts/src/events/`.

---

#### US.B15.1.3 — Worker poller que mueve outbox → notification pipeline

**Como** operador del sistema
**quiero** un worker que cada ≤ 30 s lea eventos `publishedAt IS NULL` de `DomainEvent`, los procese (despache notificaciones) y marque `publishedAt = now()`
**para que** las notificaciones lleguen en tiempo cuasi-real sin acoplar la transacción del router.

**AC:**

```gherkin
Escenario: poller procesa eventos pendientes
  Dado 3 eventos en "DomainEvent" con publishedAt = NULL
  Cuando el worker ejecuta su tick
  Entonces los 3 eventos pasan al notification dispatcher
  Y al terminar, "publishedAt" se actualiza a NOW() en cada uno

Escenario: retry con back-off en fallo transitorio
  Dado un evento cuyo dispatcher falla con "ECONNRESET" (transitorio)
  Cuando el worker termina su tick
  Entonces "publishedAt" sigue NULL
  Y "attempts" se incrementa en 1
  Y "lastError" almacena el stack reciente
  Y el siguiente tick lo reintenta (back-off exponencial: 30s, 1m, 5m, 30m, max 6 reintentos)

Escenario: dead-letter tras 6 fallos
  Dado un evento con attempts = 6
  Cuando el worker hace tick
  Entonces el evento NO se reintenta
  Y emite un log estructurado con level=ERROR y eventId
  Y se incrementa la métrica "outbox.deadletter.count"
```

- **MoSCoW:** Must
- **Story points:** 5
- **Dependencies:** US.B15.1.1, US.B15.2.3 (dispatcher)
- **Notas:** Decisión pendiente entre Inngest, Vercel Cron, pg_cron (Supabase) o Node.js cron interno — ver §5 trade-off 1.

---

#### US.B15.1.4 — Integración audit log con outbox

**Como** auditor de cumplimiento
**quiero** que cada inserción/publicación de evento aparezca en `AuditLog` con hash chain
**para** trazar fin a fin desde que el clínico actuó hasta que el receptor recibió la notificación.

**AC:**

```gherkin
Escenario: insertar evento genera AuditLog
  Dado un router que emite "prescription.created"
  Cuando se commitea la transacción
  Entonces existe una fila en AuditLog con action="DOMAIN_EVENT_EMITTED" y entityId=eventId
  Y el hash chain incluye el nuevo registro

Escenario: publicar evento genera AuditLog
  Dado un evento que el worker procesa
  Cuando "publishedAt" se actualiza
  Entonces existe AuditLog action="DOMAIN_EVENT_PUBLISHED" con duración (occurredAt → publishedAt)
```

- **MoSCoW:** Should
- **Story points:** 2
- **Dependencies:** US.B15.1.1, US.B15.1.3
- **Notas:** Reutiliza `audit.fn_audit_log_chain()` existente. Sin policy nueva.

---

### Épica E.B15.2 — Notification Engine + Email Provider

**Goal:** Dispatcher que matchea eventos a destinatarios y los entrega por canal, comenzando con email (Resend).

**WSJF score:** Cost of delay = ALTO (es lo que produce valor visible). Tamaño = ALTO. **WSJF ≈ 6.**

---

#### US.B15.2.1 — Tabla `Notification` (envelope persistente)

**Como** sistema
**quiero** registrar cada notificación generada como una fila en `Notification` (con estado: PENDING → SENT → DELIVERED → READ | FAILED)
**para** poder mostrar inbox, reintentar fallos y auditar entrega.

**AC:**

```gherkin
Escenario: notificación creada del evento
  Dado un evento "vital.critical" procesado por el dispatcher
  Cuando se identifica al médico tratante como recipient
  Entonces existe una fila en "Notification" con channel="INBOX", status="PENDING"
  Y otra fila con channel="EMAIL", status="PENDING" si el médico tiene email habilitado para CRITICAL

Escenario: status transitions
  Dado una notificación con status="PENDING"
  Cuando el provider responde 200 OK del envío
  Entonces status pasa a "SENT" y "sentAt" registra timestamp
  Cuando el usuario abre el inbox y la lee
  Entonces status pasa a "READ" y "readAt" registra timestamp

Escenario: multi-tenant aislado
  Dado dos tenants con notificaciones
  Cuando un usuario del tenant A consulta su inbox
  Entonces solo ve "Notification" con organizationId = A (RLS enforced)
```

- **MoSCoW:** Must
- **Story points:** 5
- **Dependencies:** US.B15.1.1
- **Notas:** Schema: `id`, `organizationId`, `recipientUserId`, `eventId` (FK DomainEvent), `channel` enum, `severity` enum, `subject`, `body`, `status` enum, `sentAt`, `deliveredAt`, `readAt`, `failedAt`, `failureReason`, `metadata` JSONB, `createdAt`, `updatedAt`. RLS por `organizationId`. Index `(recipientUserId, status, createdAt DESC)` para inbox.

---

#### US.B15.2.2 — Adapter de proveedor email (Resend)

**Como** sistema
**quiero** un adapter `EmailProvider` con implementación `ResendProvider`
**para** enviar emails sin acoplarme al SDK de Resend (poder cambiar a SES, SMTP, etc., después).

**AC:**

```gherkin
Escenario: envío exitoso
  Dado un payload {to, from, subject, html, text}
  Cuando el adapter ejecuta "send()"
  Entonces llama Resend API con auth desde RESEND_API_KEY env
  Y devuelve { providerMessageId, status: "SENT" }

Escenario: error retornable
  Dado un fallo HTTP 5xx de Resend
  Cuando el adapter ejecuta "send()"
  Entonces lanza "TransientProviderError" (el worker la captura y reintenta)

Escenario: error permanente
  Dado un fallo HTTP 4xx con motivo "invalid email"
  Cuando el adapter ejecuta "send()"
  Entonces lanza "PermanentProviderError" (el worker la marca como FAILED sin reintentar)
```

- **MoSCoW:** Must
- **Story points:** 3
- **Dependencies:** US.B15.2.1
- **Notas:** Wrapper en `packages/notifications/src/providers/resend.ts`. Interface compartida `EmailProvider` para futuros SES/SMTP. Variable env `RESEND_API_KEY` (ya placeholder en `.env.example`). Sender por default: `NOTIFICATIONS_FROM_EMAIL`.

---

#### US.B15.2.3 — Dispatcher: evento → recipients → channels → notifications

**Como** sistema
**quiero** un dispatcher que tome un `DomainEvent`, determine los destinatarios (basado en `aggregateType` + reglas de negocio + preferences del usuario) y cree filas `Notification` para cada canal aplicable
**para** centralizar la lógica de "quién se entera de qué".

**AC:**

```gherkin
Escenario: evento vital.critical despacha al médico tratante
  Dado un evento "vital.critical" con payload { admissionId, patientId, vitalsId }
  Cuando el dispatcher lo procesa
  Entonces obtiene el "attendingId" de "InpatientAdmission"
  Y crea Notification(recipient=attendingId, channel=INBOX, severity=CRITICAL)
  Y si attending tiene EMAIL habilitado para CRITICAL, crea otra Notification(channel=EMAIL)

Escenario: evento lab.criticalValue despacha al prescriberId
  Dado un evento "lab.criticalValue" con payload { orderItemId, prescriberId }
  Cuando el dispatcher lo procesa
  Entonces crea Notification para prescriberId con severity=CRITICAL

Escenario: preferencias del usuario bloquean canal
  Dado un usuario que deshabilitó EMAIL para WARNING
  Cuando llega un evento con severity=WARNING dirigido a él
  Entonces NO se crea Notification con channel=EMAIL
  Pero SÍ se crea con channel=INBOX (siempre obligatorio para CRITICAL/WARNING)

Escenario: idempotencia
  Dado un evento que ya fue dispatchado (publishedAt != NULL)
  Cuando el worker lo reintenta por error de red
  Entonces el dispatcher detecta dedup key (eventId) y NO duplica Notifications
```

- **MoSCoW:** Must
- **Story points:** 8
- **Dependencies:** US.B15.2.1, US.B15.3.3 (preferences shape)
- **Notas:** Esta es la pieza con más lógica de negocio. Tabla de "routing rules" hardcoded en código (`packages/notifications/src/routing.ts`) inicialmente; futuro: configurable por tenant. Severity matrix por defecto en §6.

---

#### US.B15.2.4 — Plantillas email (HTML + texto plano) por eventType

**Como** receptor médico
**quiero** que los emails sean legibles, con asunto claro y un CTA al inbox
**para** poder priorizar y actuar sin abrir múltiples sistemas.

**AC:**

```gherkin
Escenario: plantilla vital.critical
  Dado un evento "vital.critical"
  Cuando se genera el email
  Entonces el subject incluye nombre del paciente y signo vital fuera de rango
  Y el body HTML muestra: paciente, signo, valor, rango normal, timestamp, link al expediente
  Y el body texto plano contiene la misma info (fallback)

Escenario: branding consistente
  Dado cualquier email generado
  Entonces incluye logo HIS-Multipais en header
  Y footer con: "Inversiones Avante — HIS Multipaís" + link "unsubscribe (preferences)"
```

- **MoSCoW:** Should
- **Story points:** 5
- **Dependencies:** US.B15.2.2
- **Notas:** Usar React Email (`@react-email/components`) para HTML; conversion automática a texto plano. 4 plantillas iniciales: `vital.critical`, `lab.criticalValue`, `drug.interaction`, `allergy.mismatch`. Storybook con preview.

---

### Épica E.B15.3 — Inbox UI + User Preferences

**Goal:** UI para que los usuarios reciban, lean y configuren sus notificaciones.

**WSJF score:** Cost of delay = MEDIO (puede operar email-only al inicio). Tamaño = MEDIO. **WSJF ≈ 4.**

---

#### US.B15.3.1 — Página `/notifications` con inbox personal

**Como** clínico autenticado
**quiero** una página `/notifications` que liste mis notificaciones más recientes
**para** revisar y marcar como leídas las que ya atendí.

**AC:**

```gherkin
Escenario: listado por defecto
  Dado un usuario autenticado en su tenant
  Cuando visita "/notifications"
  Entonces ve una tabla con sus notificaciones ordenadas por createdAt DESC
  Y cada fila muestra: severity badge, subject, fecha relativa, status (PENDING/SENT/READ)
  Y solo ve las suyas (recipientUserId = currentUserId)

Escenario: marcar como leída
  Dado una notificación con status="SENT"
  Cuando el usuario hace click en "Marcar leída"
  Entonces status pasa a "READ"
  Y "readAt" registra timestamp
  Y el badge unread del navbar disminuye en 1

Escenario: paginación
  Dado un usuario con > 50 notificaciones
  Cuando entra a "/notifications"
  Entonces ve las primeras 25 y un botón "Cargar más"
  Y al hacer click ve las siguientes 25
```

- **MoSCoW:** Must
- **Story points:** 5
- **Dependencies:** US.B15.2.1
- **Notas:** Server Component + Server Action para mark-as-read. UI con `<Alert />` + tabla shadcn existente. Filtros básicos por severity (CRITICAL/WARNING/INFO).

---

#### US.B15.3.2 — Badge de unread en navbar

**Como** clínico
**quiero** ver un contador de notificaciones sin leer en el navbar global
**para** no tener que entrar a `/notifications` para saber si hay novedades.

**AC:**

```gherkin
Escenario: contador con unread > 0
  Dado un usuario con 3 notificaciones status="SENT"
  Cuando carga cualquier página
  Entonces el icono de campana muestra badge "3"

Escenario: contador en cero
  Dado un usuario sin notificaciones SENT
  Cuando carga cualquier página
  Entonces el icono de campana NO muestra badge
```

- **MoSCoW:** Should
- **Story points:** 3
- **Dependencies:** US.B15.3.1
- **Notas:** Server Component con cache de 30s (no real-time en MVP — eso es Beta.18). Tooltip con últimas 3 al hover.

---

#### US.B15.3.3 — Página `/settings/notifications` con preferencias

**Como** clínico
**quiero** configurar qué canales recibo por nivel de severidad
**para** evitar alert fatigue sin perderme lo crítico.

**AC:**

```gherkin
Escenario: configuración por defecto del rol
  Dado un usuario con rol "Doctor" que NUNCA ha configurado preferencias
  Cuando visita "/settings/notifications"
  Entonces ve los defaults del rol Doctor (ver §6 matriz):
    CRITICAL → EMAIL + INBOX (forzado, no editable)
    WARNING  → EMAIL + INBOX
    INFO     → INBOX

Escenario: edición de preferencias
  Dado un usuario que desactiva "EMAIL" para WARNING
  Cuando guarda
  Entonces "UserNotificationPreference" guarda { userId, severity:WARNING, channel:EMAIL, enabled:false }
  Y los siguientes eventos WARNING NO generan email para ese usuario

Escenario: CRITICAL no se puede desactivar
  Dado un usuario que intenta desactivar EMAIL para CRITICAL
  Cuando hace toggle off
  Entonces el toggle vuelve a true automáticamente
  Y se muestra mensaje: "Las alertas CRITICAL no se pueden desactivar por política de cumplimiento"
```

- **MoSCoW:** Should
- **Story points:** 5
- **Dependencies:** US.B15.2.3 (dispatcher debe leer preferences)
- **Notas:** Tabla nueva `UserNotificationPreference` (userId, severity, channel, enabled). UPSERT por (userId, severity, channel). UI con switches shadcn.

---

#### US.B15.3.4 — Defaults razonables por rol

**Como** PO
**quiero** que cuando un usuario nuevo se cree, hereden los defaults de su rol
**para** no requerir setup manual antes de recibir alertas.

**AC:**

```gherkin
Escenario: usuario nuevo Doctor
  Dado se crea un usuario con rol "Doctor"
  Cuando el dispatcher procesa un evento dirigido a él
  Entonces aplica defaults Doctor (sin pasar por preferences)

Escenario: usuario nuevo Enfermería
  Dado se crea un usuario con rol "Nurse"
  Cuando el dispatcher procesa un evento dirigido a él
  Entonces aplica defaults Nurse
```

- **MoSCoW:** Should
- **Story points:** 3
- **Dependencies:** US.B15.3.3
- **Notas:** Tabla `RoleNotificationDefault` (role, severity, channel, enabled). Seed inicial en §6.

---

### Épica E.B15.4 — Conexión de alertas clínicas piloto (smoke value)

**Goal:** Conectar 3-4 fuentes de alerta existentes al outbox para validar end-to-end.

**WSJF score:** Cost of delay = MEDIO. Tamaño = MEDIO. **WSJF ≈ 5.**

---

#### US.B15.4.1 — Wiring: vital signs out of range → `vital.critical`

**Como** sistema
**quiero** que cuando el motor `vital-alerts.ts` o el trigger `fn_respiratory_critical_alert` detecten un valor fuera de rango, emitan un `DomainEvent vital.critical`
**para** que el médico tratante reciba la notificación.

**AC:**

```gherkin
Escenario: vital crítico en inpatient
  Dado un POST a "/api/inpatient/vitals" con SPO2=82
  Cuando se commitea la transacción
  Entonces existe DomainEvent eventType="vital.critical" con payload {admissionId, vitalsId, alerts: [...]}
  Y dentro de 60s el médico tratante tiene Notification status="SENT"

Escenario: vital crítico en respiratory
  Dado un update en VentilatorSession que dispara fn_respiratory_critical_alert
  Cuando el trigger marca "alertFiredAt"
  Entonces el trigger inserta DomainEvent "vital.critical" en la misma transacción
  Y el flujo de notificación procede igual
```

- **MoSCoW:** Must
- **Story points:** 5
- **Dependencies:** US.B15.1.2, US.B15.2.3
- **Notas:** Dos puntos de wiring: (a) router inpatient en `packages/trpc/src/routers/inpatient.router.ts`; (b) modificar `fn_respiratory_critical_alert` para INSERT en `DomainEvent` (SQL 42 o v3 del 36). Migration adicional incluida.

---

#### US.B15.4.2 — Wiring: critical lab value → `lab.criticalValue`

**Como** sistema
**quiero** que cuando un `LabResult` se inserte con `flag IN ('CRITICAL_LOW', 'CRITICAL_HIGH')`, emita `DomainEvent lab.criticalValue`
**para** que el médico prescriptor (`LabOrder.prescriberId`) reciba notificación inmediata.

**AC:**

```gherkin
Escenario: resultado crítico
  Dado un POST a "/api/lis/results" con flag="CRITICAL_HIGH"
  Cuando se commitea la transacción
  Entonces existe DomainEvent eventType="lab.criticalValue"
  Y el payload incluye {orderItemId, testCode, value, normalRange, prescriberId}
  Y el prescriberId recibe Notification status="SENT"

Escenario: resultado normal NO dispara
  Dado un POST con flag="NORMAL"
  Cuando se commitea
  Entonces NO existe DomainEvent
```

- **MoSCoW:** Must
- **Story points:** 5
- **Dependencies:** US.B15.1.2, US.B15.2.3
- **Notas:** Wiring en `packages/trpc/src/routers/lis.router.ts` (ver comentario Wave 2 ya presente).

---

#### US.B15.4.3 — Wiring: drug interaction + allergy mismatch → `drug.interaction` / `allergy.mismatch`

**Como** sistema
**quiero** que cuando un router de farmacia/eMAR detecte LASA o conflicto con `PatientAllergy`, emita el evento correspondiente
**para** que el farmacéutico y/o el médico prescriptor sean notificados.

**AC:**

```gherkin
Escenario: drug interaction detectada
  Dado un POST a "/api/pharmacy/prescriptions" con un drug que tiene interaction con drug ya prescrito
  Cuando el router detecta el conflicto
  Entonces emite DomainEvent "drug.interaction" con payload {prescriptionId, conflictingDrugIds}
  Y el farmacéutico de la org Y el prescriberId reciben Notification

Escenario: allergy mismatch eMAR
  Dado un intento de administrar un drug a un paciente con allergyId que matchea
  Cuando el router detecta el match
  Entonces emite DomainEvent "allergy.mismatch"
  Y la administración SE BLOQUEA hasta override explícito
  Y el médico prescriptor + farmacéutico reciben Notification CRITICAL
```

- **MoSCoW:** Should
- **Story points:** 5
- **Dependencies:** US.B15.1.2, US.B15.2.3
- **Notas:** Routers `pharmacy.router.ts` + `emar.router.ts`. Las detecciones lógicas ya existen, solo falta emit. Override flow es Beta.16 (out of scope).

---

## 5. Trade-offs / decisiones pendientes para stakeholder

> **DECISIONES ADOPTADAS 2026-05-14 por Edwin Martinez (defaults @PO aceptados sin objeción clínica adicional).** Validación con médico SV diferida a sprint de UAT pre-release.
>
> Resumen vinculante:
> - **§5.1 Outbox poller:** **pg_cron** (Supabase nativo, gratis). Migración a Inngest evaluada en Beta.18+.
> - **§5.2 Default email Doctor:** **Opción B** (CRITICAL + WARNING vía email; INFO solo inbox). Modo concentración diferido a Beta.16.
> - **§5.3 Retención inbox:** **90 días en `Notification`** + **AuditLog forever**. Job pg_cron diario para purga.
> - **§5.4 `allergy.mismatch`:** **NO bloquea administración en Beta.15** — solo emite evento + notifica. Workflow break-the-glass es Beta.16.

### 5.1 — Stack del outbox poller: Inngest vs pg_cron vs Vercel Cron

| Opción | Costo | Observabilidad | Retry/DLQ | Setup |
|---|---|---|---|---|
| **Inngest** | $20/mes startup tier | Dashboard nativo, traces | Built-in con UI | Requiere account + integration |
| **pg_cron (Supabase)** | Gratis (incluido) | Solo via logs SQL | Manual via función | 1 línea SQL — fácil |
| **Vercel Cron** | Incluido en Pro | Logs Vercel básicos | Manual | 1 archivo route handler |
| **Node.js cron interno** | Gratis | Solo logs app | Manual | Frágil si hay múltiples instancias |

**Recomendación @PO:** **pg_cron primero** para Beta.15 (zero costo extra, ya tenemos Supabase). Migrar a **Inngest** en Beta.18+ cuando WebSocket real-time entre y necesitemos workers más sofisticados.

**Decisión requerida:** ¿OK con pg_cron MVP o el negocio prefiere Inngest desde día 1 por observabilidad?

---

### 5.2 — Severidad mínima por defecto para Doctor email

¿Default Doctor recibe email para qué severities?

- **Opción A (estricta):** Email solo para CRITICAL. WARNING y INFO solo inbox.
  - **Pro:** evita fatigue, doctor ve email = urgente.
  - **Contra:** doctor puede perder WARNINGs importantes si no abre inbox.
- **Opción B (default propuesto):** Email para CRITICAL + WARNING. INFO solo inbox.
  - **Pro:** balance razonable, WARNING captura cosas como LASA detectada que el doctor debería revisar.
  - **Contra:** ~10-30 emails/día por doctor en pico = posible fatigue.
- **Opción C (laxa):** Email para todo.
  - Garantía de fatigue. Descartada.

**Recomendación @PO:** **Opción B**. Y exponer en `/settings/notifications` un toggle "modo concentración" que el doctor activa durante consulta para escalar todo a inbox (no email durante 2h).

**Decisión requerida:** ¿Opción A o B como default? ¿Modo concentración en Beta.15 o lo dejamos para Beta.16?

---

### 5.3 — Retención de notificaciones leídas en inbox

¿Cuánto tiempo mantenemos filas en `Notification` con status="READ"?

- **30 días:** UX limpio, storage bajo, pero compliance puede pedir más.
- **90 días:** Balance común en SaaS.
- **Indefinido:** Compliance feliz, pero inbox se vuelve inusable y costoso.

**Recomendación @PO:** **90 días en Notification (UX)** + **mirror permanente en AuditLog (compliance forever)**. Job pg_cron diario que purga `Notification` con status="READ" y `readAt < now() - 90 days`.

**Decisión requerida:** ¿OK con 90 días + AuditLog forever? ¿O compliance El Salvador exige algo distinto (Ley Protección Datos Personales SV → retención específica para registros de notificación a profesional médico)?

---

### 5.4 — Severity de allergy.mismatch: bloqueante o solo aviso

El AC US.B15.4.3 propone que `allergy.mismatch` **bloquea la administración** hasta override. Esto cambia comportamiento clínico actual.

- **Pro:** safety first, evita errores serios.
- **Contra:** workflow de override (justificación + 2 firmas + audit) no está spec'd en Beta.15. Si lo bloqueamos sin override → enfermería atascada.

**Recomendación @PO:** Por Beta.15 emitir el evento + notificación, pero **NO bloquear** la administración. Bloqueo + override = épica separada Beta.16 (workflow de "break the glass" para alergias confirmadas).

**Decisión requerida:** ¿Confirmamos que Beta.15 solo notifica sin bloquear? Necesita validación clínica.

---

## 6. Severity matrix por rol (defaults propuestos)

> Sujeto a §5.2.

| Rol | CRITICAL | WARNING | INFO |
|---|---|---|---|
| **Doctor (médico tratante / prescriptor)** | EMAIL + INBOX | EMAIL + INBOX | INBOX |
| **Nurse (enfermería)** | EMAIL + INBOX | INBOX | INBOX |
| **Pharmacist (farmacéutico)** | EMAIL + INBOX | EMAIL + INBOX | INBOX |
| **Admin Org** | EMAIL + INBOX | INBOX | (off) |

**Reglas duras (no editables):**
- CRITICAL siempre dispara INBOX para el target del evento.
- CRITICAL siempre dispara EMAIL si el usuario tiene email verificado.
- INFO nunca dispara EMAIL (por defecto; editable opt-in).

---

## 7. Métricas de éxito post-release

- **Latencia P95 emit → email delivered:** < 90 segundos.
- **Tasa de delivery exitoso email:** ≥ 98% (Resend webhook delivered).
- **Tasa de eventos dead-letter:** < 0.5%.
- **Tasa de read sobre SENT** (engagement): ≥ 60% en 24h para CRITICAL, ≥ 30% para WARNING.
- **Tickets de soporte "no me llegó la alerta":** descenso vs baseline (necesita medir baseline primero).

---

## 8. Dependencias upstream / out of scope

**Bloqueado por (debe resolverse antes):**
- US.B15.1.3 (poller) depende de decisión §5.1.
- US.B15.3.3 (preferences) depende de decisión §5.2.

**Bloquea (qué espera por Beta.15):**
- Beta.16 (push móvil + break-glass workflows).
- Beta.17 (WhatsApp Business para alertas a pacientes).
- Beta.18 (real-time via SSE/WebSocket).
- Stream BI: dashboards podrán consumir `DomainEvent` para analítica.

**Out of scope explícito:**
- Push móvil (FCM/APNS).
- WhatsApp Business API.
- WebSocket / SSE para badge real-time.
- Escalation policies / on-call rotations.
- Templates configurables por tenant.
- Multi-idioma de plantillas (es-SV solo).

---

## 9. Resumen de capacidad (informativa, no compromete sprint)

| Épica | Stories | Story Points |
|---|---|---|
| E.B15.1 Event Outbox | 4 | 15 |
| E.B15.2 Notification Engine | 4 | 21 |
| E.B15.3 Inbox UI + Preferences | 4 | 16 |
| E.B15.4 Wiring piloto | 3 | 15 |
| **TOTAL Beta.15** | **15** | **67** |

Con velocity histórica del team (~20-25 pts/sprint), **Beta.15 estimado en 3 sprints** (~6 semanas) asumiendo decisiones §5 resueltas en sprint 0 de Beta.15.

---

## 10. Próximos pasos sugeridos

1. **@Orq** convoca decisión sobre §5.1-§5.4 (idealmente con un médico clínico SV) — 1 sesión 30 min.
2. **@AS** toma este backlog + decisiones y produce blueprint técnico en `docs/blueprints/beta15_notifications.md` (1 sprint preparatorio).
3. **@DBA** valida schemas propuestos (`DomainEvent`, `Notification`, `UserNotificationPreference`, `RoleNotificationDefault`) y produce ADR de outbox pattern.
4. **@PO + @AE** refinan WSJF en ceremonia de planning. Posible re-priorización dependiendo de stream BI.
5. **@Dev** abre primer PR con US.B15.1.1 (`DomainEvent` schema) como spike técnico.

---

**Fin del backlog Beta.15.**
