# @DBA — Review técnica del blueprint Beta.15

- **Owner:** @DBA (Data Architect / DBA, Inversiones Avante)
- **Fecha:** 2026-05-14
- **Revisión sobre:** [`docs/blueprints/beta15_notifications.md`](beta15_notifications.md) §3.5, §4, §6, §7
- **ADR base:** [`docs/adr/0008-beta15-notifications-outbox.md`](../adr/0008-beta15-notifications-outbox.md)
- **Backlog:** [`docs/backlog/beta15_alerts_notifications.md`](../backlog/beta15_alerts_notifications.md)

---

## Veredicto

> **APROBADO con cambios menores.**
>
> Sign-off contingente a que @SRE confirme habilitación de `pg_cron` y `pg_net` en el proyecto Supabase HIS (ambas extensiones *available* en el catálogo pero `installed_version IS NULL` — ver §S1 de este doc). El blueprint asume `extensions.http_post`, que NO existe en este proyecto y debe reemplazarse por `net.http_post` (pg_net) — ver §S4.

Cambios obligatorios antes del spike US.B15.1.1 listados en §X. Ninguno bloqueante para la arquitectura general; todos son ajustes puntuales de tipos, schemas, extensiones e idempotencia.

---

## S1. Estado actual de la BD relevante para Beta.15

Verificado contra `ejacvsgbewcerxtjtwto.supabase.co`:

| Objeto | Estado | Implicación |
|---|---|---|
| Schema `public` | ✅ existe | Beta.15 puede colocar tablas aquí. |
| Schema `audit` | ✅ existe + Prisma `schemas = ["public","audit"]` | Audit chain reusable. |
| Schema `notifications` | ❌ no existe | Decisión §3 de este review: NO lo creamos en Beta.15. |
| Extension `pg_cron` | ⚠️ available v1.6.4, **NO instalada** | @SRE blocker — `CREATE EXTENSION pg_cron;` requerido. |
| Extension `pg_net` | ⚠️ available v0.20.0, **NO instalada** | @SRE blocker — `CREATE EXTENSION pg_net;` requerido. Provee `net.http_post`. |
| Extension `http` | ⚠️ available v1.6, **NO instalada** | NO la usaremos (preferimos pg_net en Supabase). |
| Extension `uuid-ossp` | ✅ instalada en `extensions` | OK para `gen_random_uuid()` vía `extensions.gen_random_uuid()`. Mejor: `pgcrypto.gen_random_uuid()` (también en `extensions`). |
| Función `public.current_org_id()` | ✅ existe (STABLE, lee GUC + JWT) | Reutilizar en políticas. |
| Función `public.current_user_id()` | ✅ existe | Reutilizar en políticas. |
| Función `public.set_tenant_context()` | ✅ existe | El router ya lo invoca. |
| Función `audit.fn_audit_row()` | ✅ existe (SQL 02) | Trigger genérico per-tabla. |
| Función `audit.fn_audit_log_chain()` | ✅ existe (SQL 05) | Hash chain SHA-256 sobre `audit.AuditLog`. Cada INSERT en AuditLog crea eslabón. |

**Conclusión:** la mayoría de primitivas existen. Faltan **2 extensiones** y **1 grant pattern** para la Edge Function (§S4).

---

## S2. Feedback puntual sobre los 4 schemas Prisma

### S2.1 `DomainEvent` (blueprint §4.2)

**Cambios obligatorios:**

| # | Campo | Blueprint actual | Recomendado @DBA | Razón |
|---|---|---|---|---|
| 1 | `lastError` | `String? @db.Text` | `String? @db.VarChar(2000)` | Edge Function ya trunca a 2000 chars. `Text` no agrega valor y permite registros de varios MB por payload exception traces. |
| 2 | `aggregateType` | `String @db.VarChar(60)` | `String @db.VarChar(60)` ✓ | OK — el modelo más largo (`MedicationAdministration` = 25 chars) cabe con margen. |
| 3 | `eventType` | `String @db.VarChar(80)` | `String @db.VarChar(80)` ✓ | OK — patrón `<domain>.<noun>` cabe con margen para futuro. |
| 4 | Sin `payloadHash` | — | **AÑADIR** `payloadHash String? @db.VarChar(64)` | Defensa futura contra "router re-emite mismo evento por bug". Beta.15 lo deja nullable; Beta.16 puede enforcear `UNIQUE(payloadHash, aggregateId)` con datos reales. **Costo:** 64 bytes/row × 730k rows/año = 47 MB. Aceptable. |
| 5 | Sin relation a `emittedById` | `emittedById String? @db.Uuid` (FK suelto) | Añadir relation explícita `emittedBy User? @relation("DomainEventEmitter", ...)` | Prisma necesita la relation declarada para autocompletes y queries con `include`. Sin esto, queda como `@db.Uuid` huérfano. |
| 6 | Sin `correlationId` | — | **NO añadir** en Beta.15 | Tentación de añadir para trazabilidad cross-request. Defiere a Beta.16 cuando entren múltiples eventos por request HTTP. |

**Schema definitivo propuesto:**

```prisma
model DomainEvent {
  id             String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  organizationId String    @db.Uuid
  eventType      String    @db.VarChar(80)
  aggregateType  String    @db.VarChar(60)
  aggregateId    String    @db.Uuid
  payload        Json
  payloadHash    String?   @db.VarChar(64) /// SHA-256 hex; opcional Beta.15, futuro dedup.
  occurredAt     DateTime  @default(now()) @db.Timestamptz()
  publishedAt    DateTime? @db.Timestamptz()
  attempts       Int       @default(0)
  lastError      String?   @db.VarChar(2000)
  emittedById    String?   @db.Uuid

  organization Organization  @relation(fields: [organizationId], references: [id], onDelete: Restrict)
  emittedBy    User?         @relation("DomainEventEmitter", fields: [emittedById], references: [id], onDelete: SetNull)
  notifications Notification[]

  @@index([organizationId, eventType])
  @@index([occurredAt])
  @@index([aggregateType, aggregateId])
  @@schema("public")
}
```

**Indexes añadidos vs blueprint:**

- `@@index([aggregateType, aggregateId])` — soporta queries forenses tipo "qué eventos generó la admisión X". Costo bajo (relativo a las 2 columnas), valor alto en debugging post-incidente.

**El index parcial `WHERE publishedAt IS NULL` se aplica en SQL crudo (Prisma no lo soporta declarativamente).** Ver §S4 abajo.

### S2.2 `Notification` (blueprint §4.3)

**Cambios obligatorios:**

| # | Campo | Blueprint actual | Recomendado @DBA | Razón |
|---|---|---|---|---|
| 1 | `body` | `String @db.Text` | `String @db.VarChar(5000)` | Matches Zod schema (`.max(5000)`) y bounded. Más predictible para storage planning. |
| 2 | `failureReason` | `String? @db.Text` | `String? @db.VarChar(2000)` | Mismo argumento que `lastError` de DomainEvent. |
| 3 | `metadata` | `Json?` | `Json?` ✓ | OK — sin GIN index hasta que surface query pattern real (defer). |
| 4 | `providerMessageId` | `String? @db.VarChar(120)` | `String? @db.VarChar(120)` ✓ | OK. Resend IDs son ULIDs ~26 chars; 120 da margen para otros providers. |
| 5 | Falta index para badge unread | — | **AÑADIR** `@@index([recipientUserId, status])` (sin createdAt) **+** filtrar partial `WHERE status IN ('PENDING','SENT')` en SQL crudo | El badge navbar hace `count(*) WHERE recipientUserId=? AND status IN ('PENDING','SENT')`. El index `(recipientUserId, status, createdAt DESC)` propuesto sirve para inbox listing (queries ordenadas) pero un partial dedicado es más pequeño y rápido para el badge. **Decisión:** partial index aparte en SQL crudo. |
| 6 | Sin `acknowledgedAt` para OB1 | — | **NO añadir** Beta.15 | El OB1 del backlog mide `alert_fired_at → notification_acknowledged_at`. `readAt` cumple ese rol. No agregar columna duplicada. |

**Indexes finales propuestos** (3 + partial):

```prisma
@@unique([eventId, recipientUserId, channel])                           // idempotencia
@@index([recipientUserId, status, createdAt(sort: Desc)])              // inbox listing
@@index([organizationId, status])                                       // admin/analytics
```

**+ partial index en SQL crudo:**

```sql
CREATE INDEX IF NOT EXISTS ix_notification_unread_per_user
  ON public."Notification" ("recipientUserId")
  WHERE status IN ('PENDING','SENT');
```

### S2.3 `UserNotificationPreference` (blueprint §4.4)

**Cambio obligatorio: usar composite PK en lugar de surrogate `id` + UNIQUE.**

```prisma
model UserNotificationPreference {
  userId    String                @db.Uuid
  severity  NotificationSeverity
  channel   NotificationChannel
  enabled   Boolean               @default(true)
  updatedAt DateTime              @updatedAt @db.Timestamptz()

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([userId, severity, channel])
  @@schema("public")
}
```

**Razón:** la tupla `(userId, severity, channel)` es naturalmente única (3 enums chicos + 1 user). Un surrogate `id` UUID añade:
- 16 bytes/row
- 1 índice extra (B-tree sobre `id`)
- 0 valor en queries (jamás se busca por `id` solo)

Con ~10 prefs × N usuarios = decenas a cientos de miles de rows máx, los ahorros son modestos pero el modelo es más limpio.

### S2.4 `RoleNotificationDefault` (blueprint §4.5)

**Mismo cambio: composite PK.**

```prisma
model RoleNotificationDefault {
  roleId   String                @db.Uuid
  severity NotificationSeverity
  channel  NotificationChannel
  enabled  Boolean

  role Role @relation(fields: [roleId], references: [id], onDelete: Cascade)

  @@id([roleId, severity, channel])
  @@schema("public")
}
```

Tabla mínima ~ 4 roles × 3 severities × 2 channels = 24 rows. Cualquier index secundario es overkill.

### S2.5 Validación de `DomainEvent.payload` JSONB en BD

**Recomendación:** NO añadir CHECK constraint complejo a nivel BD.

Razón:
- Validación canónica vive en TS (`packages/contracts/src/events/payloads.ts` con discriminated union Zod).
- Un CHECK con `jsonb_path_match` sería rígido y complicaría evolución del payload.
- Single point of validation: `emitDomainEvent(tx, dto)` valida con Zod **antes** del INSERT.

**Excepción razonable:** un CHECK trivial garantizando que payload es un objeto (no array/scalar), para detectar bugs groseros:

```sql
ALTER TABLE public."DomainEvent"
  ADD CONSTRAINT domain_event_payload_is_object_chk
  CHECK (jsonb_typeof(payload) = 'object');
```

Costo ~ 0 (1 nanosegundo per INSERT). Beneficio: detecta `INSERT ... VALUES ('[]'::jsonb)` defensivamente.

---

## S3. Schema strategy — `public` vs `notifications` dedicado

**Recomendación: TODAS las 4 tablas en `public`.**

Trade-off analizado:

| Criterio | `public` | `notifications` schema |
|---|---|---|
| Aislamiento privilegios | medio (vía RLS) | alto (GRANT a nivel schema) |
| Migración Prisma | sin cambio | añadir `"notifications"` a `schemas = [...]` |
| Audit triggers reutilizables | sí (mismo schema que SQL 22) | sí pero requiere SQL 22 con array por schema |
| Consultas cross-schema | ninguno | algunas (router emite en `public.DomainEvent` desde `notifications.*`) |
| Pattern existente HIS | tablas clínicas en `public`; auditoría en `audit` | rompería expectativa (todo dato de negocio = public) |

Beta.15 NO maneja secretos ni datos exclusivamente de infra. Los eventos contienen información clínica del tenant que ya vive en `public` (vital signs, lab results). Aislar a schema separado no agrega valor real y aumenta fricción operacional.

**Si Beta.18+ introduce eventos de sistema (login, audit-meta, etc.), reconsiderar.**

---

## S4. Función `notifications.process_outbox_batch` — review puntual

### S4.1 Schema de la función — corrección obligatoria

Sin schema `notifications` (decisión §S3), la función vive en `public` o `audit`. **Recomendación: schema dedicado de funciones `notifications` (solo funciones, no tablas).** Esto sí amerita aislamiento porque la función opera con `SECURITY DEFINER` (privilegio elevado).

```sql
CREATE SCHEMA IF NOT EXISTS notifications;
GRANT USAGE ON SCHEMA notifications TO authenticated, service_role;
-- NO grant a anon (no debería invocar el poller).
```

La función queda como `notifications.process_outbox_batch(...)` pero las tablas siguen en `public`. Patrón equivalente a `audit.fn_audit_row()` que vive en schema `audit` pero escribe en `audit."AuditLog"` (misma schema en ese caso, pero el patrón vale).

### S4.2 `extensions.http_post` → `net.http_post` (pg_net)

**El blueprint usa `extensions.http_post` que NO existe en este Supabase.** Reemplazar:

```sql
-- ANTES (no funciona):
SELECT extensions.http_post(url := ..., body := ..., headers := ...);

-- DESPUÉS (pg_net, requiere CREATE EXTENSION):
SELECT net.http_post(
  url := current_setting('app.notifications_dispatch_url'),
  body := jsonb_build_object('eventIds', array_agg(batch.id)),
  headers := jsonb_build_object(
    'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
    'Content-Type', 'application/json'
  )
);
```

**Importante diferencia semántica:** `net.http_post` es **asíncrono** (encola la request, devuelve request_id de inmediato). El poller NO espera la respuesta. Esto es OK para Beta.15 porque:
1. La Edge Function actualiza `DomainEvent.publishedAt` y `attempts` por su cuenta tras procesar.
2. Si la HTTP request falla en red, los eventos quedan con `publishedAt IS NULL` y el próximo tick los reintenta.

Para observabilidad, opcionalmente registrar el `request_id` en una tabla `notifications.dispatch_log` (defer Beta.16; Beta.15 confía en logs de pg_net en `net._http_response`).

### S4.3 `pg_try_advisory_xact_lock(7311500)` — derivación determinística

Reemplazar la "magic number" por una derivación reproducible:

```sql
-- Hash determinista del nombre del lock (BIGINT)
-- → siempre el mismo entre deploys, fácil de buscar en pg_locks.
DECLARE
  v_lock_id BIGINT := ('x' || md5('beta15.notifications.outbox.poller'))::bit(64)::bigint;
BEGIN
  IF NOT pg_try_advisory_xact_lock(v_lock_id) THEN
    RAISE NOTICE 'process_outbox_batch: another poller is running, skipping tick';
    RETURN;
  END IF;
  ...
```

Documentado en comentario header del archivo para que @SRE encuentre el lock en `pg_locks` durante debugging.

### S4.4 `SECURITY DEFINER` + grants

Patrón correcto. Setup completo:

```sql
CREATE OR REPLACE FUNCTION notifications.process_outbox_batch(p_limit INT DEFAULT 100)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER       -- ejecuta con role 'postgres' (owner)
SET search_path = ''   -- patrón obligatorio del SQL 24
AS $$ ... $$;

-- Solo postgres (= cron job runner) puede invocarla.
REVOKE ALL ON FUNCTION notifications.process_outbox_batch(INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION notifications.process_outbox_batch(INT) TO postgres;
```

El usuario `cron` que ejecuta `pg_cron` tareas usa role postgres por defecto en Supabase, así que el GRANT es trivial.

### S4.5 Manejo de errores

El pseudocódigo del blueprint solo `RAISE NOTICE`. Esto pierde fallos silenciosamente. Añadir:

```sql
EXCEPTION
  WHEN OTHERS THEN
    -- No queremos que la función pete y mate el cron schedule.
    INSERT INTO audit."AuditLog" (action, entity, justification, occurredAt)
    VALUES ('OUTBOX_POLLER_FAIL', 'DomainEvent',
            format('SQLSTATE=%s msg=%s', SQLSTATE, SQLERRM),
            NOW());
    RAISE WARNING 'process_outbox_batch failed: % %', SQLSTATE, SQLERRM;
```

Razón: si una excepción no manejada surge dentro de la función pg_cron, depending on the pg_cron version puede detener el job_run en `cron.job_run_details` con status `failed`, y el siguiente tick puede o no continuar. Capturar + log + advertencia mantiene el cron vivo.

### S4.6 Esquema definitivo de la función — pseudocódigo afinado

Va en `packages/database/sql/42_notifications_outbox.sql`. NO lo escribo completo aquí (corresponde al spike US.B15.1.1); solo señalo los cambios respecto al §6.1 del blueprint:

```sql
CREATE OR REPLACE FUNCTION notifications.process_outbox_batch(p_limit INT DEFAULT 100)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lock_id  BIGINT := ('x' || md5('beta15.notifications.outbox.poller'))::bit(64)::bigint;
  v_event_ids UUID[];
BEGIN
  IF NOT pg_try_advisory_xact_lock(v_lock_id) THEN
    RAISE NOTICE 'process_outbox_batch: another poller is running, skipping tick';
    RETURN;
  END IF;

  SELECT array_agg(de.id)
  INTO   v_event_ids
  FROM (
    SELECT id FROM public."DomainEvent"
    WHERE "publishedAt" IS NULL
      AND attempts < 6
    ORDER BY "occurredAt" ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ) de;

  IF v_event_ids IS NULL OR array_length(v_event_ids, 1) IS NULL THEN
    RETURN;  -- nada por hacer
  END IF;

  -- Encola la HTTP request (asíncrona vía pg_net).
  PERFORM net.http_post(
    url     := current_setting('app.notifications_dispatch_url', true),
    body    := jsonb_build_object('eventIds', v_event_ids),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.service_role_key', true),
      'Content-Type',  'application/json'
    )
  );

  RAISE NOTICE 'process_outbox_batch: dispatched % events', array_length(v_event_ids, 1);
EXCEPTION
  WHEN OTHERS THEN
    INSERT INTO audit."AuditLog" (action, entity, justification, "occurredAt")
    VALUES ('OUTBOX_POLLER_FAIL'::"AuditAction", 'DomainEvent',
            format('SQLSTATE=%s msg=%s', SQLSTATE, SQLERRM), NOW());
    RAISE WARNING 'process_outbox_batch failed: % %', SQLSTATE, SQLERRM;
END;
$$;
```

> Nota: `'OUTBOX_POLLER_FAIL'` requiere añadir el valor al enum `AuditAction` (otra mordida del POST_OP problem). Alternativa: usar valor existente como `'SYSTEM_ERROR'` o `'JOB_FAIL'` si existe. @Dev valida durante spike y reporta.

---

## S5. RLS policies — propuestas concretas

**Convención del HIS:** patrón `_global_or_tenant_select` (cuando aplica catálogo global) + `_tenant_modify` (escritura tenant-scoped) — ver SQL 41 (LIS new tables).

### S5.1 `DomainEvent`

```sql
ALTER TABLE public."DomainEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DomainEvent" FORCE ROW LEVEL SECURITY; -- aplica también al owner

-- SELECT: solo tenant. service_role bypasea por default.
DROP POLICY IF EXISTS domain_event_tenant_select ON public."DomainEvent";
CREATE POLICY domain_event_tenant_select
  ON public."DomainEvent"
  FOR SELECT
  TO authenticated
  USING ("organizationId" = current_org_id());

-- INSERT: routers en tenant context (Prisma → role authenticated con set_tenant_context).
DROP POLICY IF EXISTS domain_event_tenant_insert ON public."DomainEvent";
CREATE POLICY domain_event_tenant_insert
  ON public."DomainEvent"
  FOR INSERT
  TO authenticated
  WITH CHECK ("organizationId" = current_org_id());

-- UPDATE: solo service_role (Edge Function que marca publishedAt, attempts, lastError).
DROP POLICY IF EXISTS domain_event_service_update ON public."DomainEvent";
CREATE POLICY domain_event_service_update
  ON public."DomainEvent"
  FOR UPDATE
  TO service_role
  USING (true) WITH CHECK (true);

-- DELETE: nunca para authenticated. service_role solo si TTL purge se añade después.
-- (sin policy DELETE = bloqueado por default).
```

`FORCE ROW LEVEL SECURITY` es importante: la función `notifications.process_outbox_batch` corre como `SECURITY DEFINER` con role postgres (owner). Sin `FORCE`, el owner bypasea RLS — y queremos que sí respete las policies cuando lee (aunque al ser service-level está OK que vea todo). El uso es opcional pero recomendado para defensa en profundidad.

### S5.2 `Notification`

```sql
ALTER TABLE public."Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Notification" FORCE ROW LEVEL SECURITY;

-- SELECT: solo el destinatario ve sus notificaciones. Admin org NO ve PHI ajeno.
DROP POLICY IF EXISTS notification_recipient_select ON public."Notification";
CREATE POLICY notification_recipient_select
  ON public."Notification"
  FOR SELECT
  TO authenticated
  USING (
    "recipientUserId" = current_user_id()
    AND "organizationId" = current_org_id()
  );

-- INSERT: solo service_role (Edge Function dispatcher).
DROP POLICY IF EXISTS notification_service_insert ON public."Notification";
CREATE POLICY notification_service_insert
  ON public."Notification"
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- UPDATE: el recipient marca su propia notificación como READ.
-- Service_role actualiza status del dispatcher.
DROP POLICY IF EXISTS notification_recipient_mark_read ON public."Notification";
CREATE POLICY notification_recipient_mark_read
  ON public."Notification"
  FOR UPDATE
  TO authenticated
  USING ("recipientUserId" = current_user_id())
  WITH CHECK ("recipientUserId" = current_user_id());

DROP POLICY IF EXISTS notification_service_update ON public."Notification";
CREATE POLICY notification_service_update
  ON public."Notification"
  FOR UPDATE
  TO service_role
  USING (true) WITH CHECK (true);
```

**Defensa adicional contra UPDATE malicioso del recipient:** un trigger `BEFORE UPDATE` que rechace cambios fuera de la transición `status → READ` + `readAt = NOW()` cuando el actor es `authenticated`:

```sql
CREATE OR REPLACE FUNCTION public.fn_notification_recipient_update_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('role') = 'service_role' THEN RETURN NEW; END IF;

  -- Recipient solo puede cambiar status (SENT→READ) y readAt.
  IF (OLD."recipientUserId" <> NEW."recipientUserId")
     OR (OLD."organizationId" <> NEW."organizationId")
     OR (OLD."subject" IS DISTINCT FROM NEW."subject")
     OR (OLD."body" IS DISTINCT FROM NEW."body")
     OR (OLD."channel" <> NEW."channel")
     OR (OLD."severity" <> NEW."severity")
     OR (OLD."eventId" <> NEW."eventId")
  THEN
    RAISE EXCEPTION 'Recipient may only mark notification as READ';
  END IF;

  IF NOT (OLD.status IN ('SENT','DELIVERED') AND NEW.status = 'READ') THEN
    RAISE EXCEPTION 'Invalid status transition by recipient: % → %', OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notification_recipient_guard ON public."Notification";
CREATE TRIGGER trg_notification_recipient_guard
  BEFORE UPDATE ON public."Notification"
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_notification_recipient_update_guard();
```

(El trigger se salta a sí mismo cuando role = service_role.)

### S5.3 `UserNotificationPreference`

```sql
ALTER TABLE public."UserNotificationPreference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."UserNotificationPreference" FORCE ROW LEVEL SECURITY;

-- SELECT + ALL: self-only. service_role bypasea para dispatcher.
DROP POLICY IF EXISTS user_notif_pref_self ON public."UserNotificationPreference";
CREATE POLICY user_notif_pref_self
  ON public."UserNotificationPreference"
  FOR ALL
  TO authenticated
  USING ("userId" = current_user_id())
  WITH CHECK ("userId" = current_user_id());

-- service_role lee desde Edge Function (dispatcher) — sin policy explícita porque bypassea.
```

### S5.4 `RoleNotificationDefault`

```sql
ALTER TABLE public."RoleNotificationDefault" ENABLE ROW LEVEL SECURITY;

-- SELECT: cualquier authenticated dentro del tenant. Sin filtro por tenant
-- porque es catálogo global de defaults (no PHI, no PII).
DROP POLICY IF EXISTS role_notif_default_read ON public."RoleNotificationDefault";
CREATE POLICY role_notif_default_read
  ON public."RoleNotificationDefault"
  FOR SELECT
  TO authenticated
  USING (true);

-- INSERT/UPDATE/DELETE: solo service_role (seeds + migrations).
DROP POLICY IF EXISTS role_notif_default_service_write ON public."RoleNotificationDefault";
CREATE POLICY role_notif_default_service_write
  ON public."RoleNotificationDefault"
  FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
```

### S5.5 Edge Function bypass

La Edge Function se autentica como **service_role** (JWT con `role: 'service_role'` firmado por Supabase). En PostgREST + Supabase RLS:

- `service_role` **bypasea RLS por default** en TODAS las tablas.
- `FORCE ROW LEVEL SECURITY` se aplica al **table owner** (role `postgres`), NO a `service_role`.
- Por tanto el dispatcher (Edge Function) puede INSERT/UPDATE en `Notification` y `DomainEvent` sin issues.

**Verificación necesaria por @SRE:** confirmar que la Edge Function `notifications-dispatch` use el JWT `SUPABASE_SERVICE_ROLE_KEY` (NO el anon key). Documentar en runbook.

---

## S6. Estrategia de migración — recomendación final

**Approach mixto, en orden estricto:**

| Paso | Herramienta | Contenido |
|---|---|---|
| 1 | `prisma migrate dev` (PR de spike) | Modelos `DomainEvent`, `Notification`, `UserNotificationPreference`, `RoleNotificationDefault` + 3 enums + relations en `User`, `Organization`, `Role`. Genera migration SQL automático. |
| 2 | `packages/database/sql/42_notifications_outbox.sql` (mismo PR) | Schema `notifications` (solo funciones), función `notifications.process_outbox_batch`, partial indexes, CHECK `payload_is_object_chk`, policy RLS de las 4 tablas, trigger guard de Notification, `notifications.purge_read_after_90d()`. |
| 3 | `packages/database/sql/43_notifications_audit_wiring.sql` (mismo PR) | Wire de audit triggers (extiende SQL 22 array). |
| 4 | Seed JS (mismo PR) | Insertar 24 rows en `RoleNotificationDefault` (4 roles × 3 severities × 2 channels). |
| 5 | @SRE deploy (post-merge) | `CREATE EXTENSION pg_cron, pg_net;` + `cron.schedule()` calls + secrets injection (`ALTER DATABASE ... SET app.X = ...`). |

**Por qué este orden:**
- Lección PR #46: NO meter columnas/tablas vía SQL crudo que Prisma desconozca. Por eso paso 1 = `prisma migrate`.
- RLS, partial indexes, funciones, triggers complejos NO los soporta Prisma → SQL crudo, pero **derivable y idempotente** (igual que SQL 24-41 existentes).
- Las extensiones `pg_cron` y `pg_net` requieren acción manual desde Dashboard en Supabase (no DDL desde tabla normal) → @SRE.
- Seeds de defaults via JS para que `prisma db seed` los pueda re-ejecutar en staging/dev.

---

## S7. Performance + capacity planning

### S7.1 `DomainEvent` — proyección 1 año

Asumimos volumen MVP: **2,000 eventos/día/HIS** (10 establecimientos × 200/día baseline).

| Métrica | Cálculo | Resultado |
|---|---|---|
| Rows/año | 2,000 × 365 | **730,000** |
| Tamaño promedio de fila | UUID×3 (48 B) + ts×2 (16 B) + ints (4 B) + payload JSON (~500 B avg con whitespace) + texts (~50 B) | **~600 bytes/row** |
| Tabla heap/año | 730,000 × 600 | **~440 MB/año** |
| Índices (3 B-tree + 1 partial) | ~30% overhead | **~130 MB/año** |
| **Total disco/año** | | **~570 MB/año** |

Picos de tenant ruidoso (5k/día/establecimiento × 10) = 18.25M rows/año = ~11 GB/año. Aún manejable en una instancia Supabase Pro.

**Particionamiento:** NO en Beta.15. Trigger para introducirlo: cuando la tabla supere **5 GB** o queries `WHERE occurredAt > now() - 7 days` empiecen a tomar > 500ms. Estimación: ~12-18 meses de operación normal antes de necesidad.

**Cuando llegue:** RANGE partitioning mensual por `occurredAt`, con detach de particiones > 12 meses a `domain_event_archive` (sin RLS, sin índices). Patrón estándar.

### S7.2 `Notification` — proyección 1 año

Asumimos: **1 evento → 1.5 notifications avg** (INBOX siempre + EMAIL ~50% del tiempo).

| Métrica | Cálculo | Resultado |
|---|---|---|
| Rows generadas/año | 730,000 × 1.5 | **1.1M rows/año** |
| Tamaño promedio de fila | UUIDs×3 (48 B) + enums×3 (12 B) + ts×5 (40 B) + body VARCHAR avg ~1KB + texts | **~1.2 KB/row** |
| Steady state con purge 90d | ~1.1M × (90/365) | **~270k rows** |
| Disco steady state | 270k × 1.2 KB + índices | **~400 MB** |

Steady state. Sin particionamiento. Purga `pg_cron` 03:00 UTC diaria mantiene la tabla acotada.

### S7.3 VACUUM/ANALYZE policy

`DomainEvent` es **append-mostly** con **update-de-1-row-tras-publish**:

- `attempts` y `publishedAt` se actualizan en cada evento → modesto update churn.
- Autovacuum default es OK pero recomendamos `autovacuum_vacuum_scale_factor = 0.05` (default 0.2) para esta tabla específica, para mantener el partial index `WHERE publishedAt IS NULL` sin bloat:

```sql
ALTER TABLE public."DomainEvent" SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.05
);
```

`Notification` es **high churn de status** (PENDING → SENT → READ):

```sql
ALTER TABLE public."Notification" SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.05,
  fillfactor = 80  -- deja espacio para HOT updates
);
```

Recomendable un `REINDEX CONCURRENTLY` mensual via cron sobre el partial index `ix_notification_unread_per_user` para combatir bloat.

---

## S8. Hash chain audit — recomendación

`audit.fn_audit_log_chain()` corre como trigger AFTER INSERT sobre `audit.AuditLog`, computando `signatureHash = SHA-256(id|prevHash|action|entity|...)`. Esto **serializa todos los INSERTs en AuditLog** (cada uno depende del hash del anterior).

**Pregunta:** ¿`DomainEvent` y `Notification` deben entrar a la hash chain?

| Opción | Pros | Contras |
|---|---|---|
| **A) Incluir todo (DomainEvent + Notification CRUD)** | Forense completo "quién vio qué alerta". | +8k AuditLog rows/día solo de notifications. Hash chain serialization → throughput máximo de inserts ≈ 50/s. |
| **B) Excluir Notification, incluir DomainEvent** | Auditoría del emit (cuál router emitió qué) sin volumen excesivo. | No tenemos record de "doctor X marcó leído notificación Y" en chain (sí en NotificationCRUD pero sin tamper-proof). |
| **C) Excluir ambos** | Throughput máximo. | Cumplimiento Ley Protección Datos SV puede pedir audit explícito de comunicaciones a profesionales médicos. |

**Recomendación: B con asterisco.**

- `DomainEvent` → audit trigger generic SQL 22 (incluye hash chain). ~2k rows/día adicionales, throughput aceptable.
- `Notification` → audit trigger generic, **pero excluir del hash chain** mediante check en `audit.fn_audit_log_chain()` que skip si `entity = 'Notification'`. Conserva audit estándar (qué cambió, cuándo, por quién) sin throughput penalty.

Implementación: la chain function ya recibe `entity`; añadir `IF entity = 'Notification' THEN RETURN NEW;` antes del compute. Documentar en SQL 42.

**Alternativa pragmática:** si @AE/Legal Avante insiste en hash chain para Notification también, aceptar el costo (~5k chain entries/día) y monitorear. Es ~ 60/s en pico, manejable.

---

## S9. Riesgos DB no mencionados en el blueprint (5)

| # | Riesgo | Probabilidad | Severidad | Mitigación |
|---|---|---|---|---|
| **DBA-R1** | **Long-running routers (>30s) sostienen lock implícito en `DomainEvent` row insertada** porque la tx no commitea. El poller hace `SELECT FOR UPDATE SKIP LOCKED` que **skipea** la row → la deja pendiente para siguiente tick. Si el router crashea, la tx rollbackea, el evento no existe (OK). Pero si la transacción dura legítimamente mucho, hay desfase entre `occurredAt` (definido al BEGIN) y "actualmente visible para poller". | BAJA | BAJO | Documentar en helper `emitDomainEvent`: invocar **al final** de la transacción del router, después de todas las mutaciones críticas. La penalty de latencia adicional es < 100ms typical. |
| **DBA-R2** | **PHI en `DomainEvent.payload` (vital signs, lab values con patientId)**. Si RLS falla por bug o policy mal escrita, hay cross-tenant leak. La Ley Protección Datos SV exige notificación de incidente y posible multa. | MEDIA | ALTO | (a) Test RLS isolation específico para DomainEvent en `rls-isolation.test.ts`. (b) `FORCE ROW LEVEL SECURITY` (incluye owner). (c) Considerar payload **redacted** para INFO severity (substituir patientId por hash). Defer (c) a Beta.16 con criterios de PHI minimization. |
| **DBA-R3** | **Deadlock entre router (INSERT DomainEvent) y dispatcher (UPDATE DomainEvent)**. PostgreSQL detecta y aborta una transacción. Si pasa, el router pierde su mutación + el evento. | BAJA | MEDIO | `FOR UPDATE SKIP LOCKED` en el poller previene esto: skipea rows con lock en lugar de esperar. **Mantener** esta pattern. Test integración con scenario de concurrencia (vitest + 2 connections paralelas). |
| **DBA-R4** | **Bloat de `Notification.status` index** por high churn (PENDING → SENT → READ → eventual delete). El partial `ix_notification_unread_per_user` recibe muchos updates que pueden generar fragmentación. | MEDIA | MEDIO | `fillfactor = 80` en la tabla; `REINDEX CONCURRENTLY` mensual del partial index; monitor de `pg_stat_user_indexes.idx_blks_hit/read` ratio. |
| **DBA-R5** | **JSONB query cost si dispatcher filtra por contenido del payload** (ej. `WHERE payload->>'severity' = 'CRITICAL'` para fallback rules). Sin GIN index, full scan. | BAJA (no es el patrón) | MEDIO | El dispatcher resuelve recipients leyendo **campos relacionales** (`InpatientAdmission.attendingId`), no del payload. Mantener disciplina: payload es **side data** para email rendering, NUNCA para routing. Si surface uso de payload en query → añadir GIN selectivo. |

---

## S10. Cambios mínimos requeridos (handoff a @Dev)

Antes del spike US.B15.1.1, el blueprint debe actualizarse con estos cambios. Path:línea referenciados a `docs/blueprints/beta15_notifications.md`:

1. **§4.2 `DomainEvent`** → reemplazar `lastError String? @db.Text` por `String? @db.VarChar(2000)`. Añadir `payloadHash String? @db.VarChar(64)` después de `payload`. Añadir relation `emittedBy User? @relation("DomainEventEmitter", fields: [emittedById], references: [id], onDelete: SetNull)`. Añadir `@@index([aggregateType, aggregateId])`.
2. **§4.3 `Notification`** → `body String @db.VarChar(5000)` (no Text), `failureReason String? @db.VarChar(2000)`.
3. **§4.4 `UserNotificationPreference`** → composite PK `@@id([userId, severity, channel])`, eliminar `id` y `@@unique`.
4. **§4.5 `RoleNotificationDefault`** → composite PK `@@id([roleId, severity, channel])`, eliminar `id` y `@@unique`.
5. **§6.1 función SQL** → reemplazar `extensions.http_post` por `net.http_post` (pg_net). Reemplazar magic number `7311500` por derivación md5. Añadir bloque `EXCEPTION WHEN OTHERS`. Ubicar función en schema `notifications` (a crearse). Verificar disponibilidad de `'OUTBOX_POLLER_FAIL'` en enum `AuditAction` (probablemente faltante).
6. **§S nuevo en blueprint** → añadir referencia a `_dba_review.md` y declarar las 5 RLS policies + 1 trigger guard de Notification como artefactos del spike.
7. **§13 checklist pre-construcción** → añadir bullet: "@SRE confirma `pg_cron` y `pg_net` instaladas (`SELECT extname FROM pg_extension WHERE extname IN ('pg_cron','pg_net')`)".
8. **Decisión §S3** — confirmar en ADR 0008 el approach `public` tables + `notifications` schema solo para funciones.

---

## S11. Cómo paralelizar @SRE mientras @Dev arranca

Trabajo @SRE no bloquea @Dev en Sprint 1 si separamos:

- **Sprint 1 paralelo a @SRE:**
  - @Dev abre PR US.B15.1.1 con `prisma migrate dev` (Paso 1 + 2 del §S6), incluyendo SQL 42 con la función definida pero **el `cron.schedule()` comentado** (espera @SRE). El test E2E de spike usa un trigger manual: `SELECT notifications.process_outbox_batch(100);` invocado desde un test Vitest con role postgres.
  - @SRE en paralelo: `CREATE EXTENSION pg_cron;`, `CREATE EXTENSION pg_net;`, configurar `ALTER DATABASE ... SET app.notifications_dispatch_url`, deploy Edge Function `notifications-dispatch` placeholder.
- **Sprint 2:** uncommenting `cron.schedule()` cuando @SRE confirme y la Edge Function esté live.

Esto evita el bloqueo serial @SRE → @Dev y mantiene velocity del Sprint 1.

---

## Resumen ≤ 200 palabras

> **APROBADO con cambios menores.** El blueprint Beta.15 es arquitecturalmente sólido y respeta convenciones del HIS. Sin embargo identifico **8 ajustes obligatorios** antes del spike:
>
> **Tipos/schemas:** `lastError` y `failureReason` → VARCHAR bounded; `body` Notification → VARCHAR(5000); añadir `payloadHash` (defensa futura); `UserNotificationPreference` y `RoleNotificationDefault` → composite PK (sin surrogate UUID).
>
> **Infra crítica:** `extensions.http_post` **no existe** en este Supabase — reemplazar por `net.http_post` (pg_net). Magic number del advisory lock → derivar con md5. Manejo de excepciones añadido en la función outbox.
>
> **Schema strategy:** tablas en `public` (no schema dedicado); **schema `notifications` solo para funciones** (SECURITY DEFINER aislado).
>
> **Migración:** Prisma migrate (modelos) + SQL crudo (RLS + funciones + partial indexes + audit wiring) + seeds JS para `RoleNotificationDefault`. Aplicar en este orden estricto para evitar drift PR #46.
>
> **Performance:** ~570 MB/año DomainEvent + ~400 MB steady-state Notification. Particionamiento NO en Beta.15; trigger ~12-18 meses.
>
> **Riesgos nuevos (5):** PHI leak en payload, deadlock router↔dispatcher, bloat de status index, long-running routers, JSONB query cost.
>
> **Bloqueo @SRE:** `pg_cron` y `pg_net` available pero NO instaladas en Supabase HIS. Habilitar antes del spike.
>
> Sign-off final tras incorporar los 8 ajustes y validación @SRE. Estimación: 2-3h trabajo @Dev para incorporar todo al PR US.B15.1.1.
