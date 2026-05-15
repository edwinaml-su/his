# Beta.15 — Activation Runbook: Outbox Poller (US.B15.1.3)

> **Owner:** @SRE + @Edwin
> **Estado al cierre 2026-05-15:** SQL 44 listo en repo, **NO aplicado** a Supabase remoto. Las extensiones `pg_cron` y `pg_net` están disponibles en `shared_preload_libraries` pero `installed_version IS NULL` — requieren activación manual desde Dashboard.
> **Decisión §5.1 vinculante (2026-05-14):** `pg_cron + pg_net`, NO Inngest, NO Vercel Cron.

---

## 0. TL;DR — orden de pasos

| # | Paso | Quién | Reversible |
|---|------|-------|------------|
| 1 | Habilitar `pg_cron` + `pg_net` en Supabase Dashboard | @Edwin | Sí (Disable) |
| 2 | Aplicar SQL 44 via MCP `apply_migration` o SQL Editor | @SRE | Sí (unschedule + DROP FUNCTION) |
| 3 | Configurar GUC `app.notifications_dispatch_url` | @SRE | Sí (`RESET`) |
| 4 | Configurar GUC `app.service_role_key` | @SRE | Sí (`RESET`) |
| 5 | Deploy Edge Function `notifications-dispatch` | @SRE | Sí (delete function) |
| 6 | Smoke verification (SQL 44 `__tests__`) | @SRE | n/a |
| 7 | Observar `cron.job_run_details` ×5 min | @SRE | n/a |

**Punto de no retorno:** ninguno. Cada paso es reversible.

---

## 1. Habilitar extensiones (Dashboard)

1. Login en https://supabase.com/dashboard/project/ejacvsgbewcerxtjtwto
2. **Database → Extensions**.
3. Buscar `pg_cron` → toggle **Enable** → schema sugerido `extensions`.
4. Buscar `pg_net` → toggle **Enable** → schema sugerido `extensions`.
5. Verificar en SQL Editor:
   ```sql
   SELECT extname, extversion FROM pg_extension WHERE extname IN ('pg_cron','pg_net');
   ```
   Esperado: 2 filas, ambas con `extversion` no null.

**Por qué Dashboard y no SQL:** el rol del MCP/Supabase JS no tiene `SUPERUSER`, así que `CREATE EXTENSION` falla. El Dashboard lo ejecuta como rol elevado interno.

---

## 2. Aplicar SQL 44

### Opción A (recomendada) — MCP `apply_migration`

Desde Claude Code o cualquier cliente MCP con el toolset Supabase:

```
mcp__supabase__apply_migration({
  name: '44_notifications_outbox_poller',
  query: <contenido de packages/database/sql/44_notifications_outbox_poller.sql>
})
```

### Opción B — SQL Editor manual

1. Abrir **Database → SQL Editor**.
2. Pegar contenido completo de `packages/database/sql/44_notifications_outbox_poller.sql`.
3. **Run**. Esperado: sin errores; `NOTICE` opcional del bloque DO.

> **Nota:** el SQL es idempotente — re-aplicarlo no rompe nada (las `CREATE EXTENSION IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION` y bloque DO de `cron.unschedule + schedule` lo garantizan).

---

## 3. Configurar GUCs (`app.notifications_dispatch_url`, `app.service_role_key`)

Estos parámetros viven a nivel de base de datos y los lee el poller via `current_setting('app.X', true)`.

```sql
-- 3.1 — URL de la Edge Function dispatcher.
ALTER DATABASE postgres
  SET app.notifications_dispatch_url = 'https://ejacvsgbewcerxtjtwto.supabase.co/functions/v1/notifications-dispatch';

-- 3.2 — service_role JWT. NUNCA committear este valor al repo.
--      Tomar el valor de Supabase Dashboard → Settings → API → service_role secret.
ALTER DATABASE postgres
  SET app.service_role_key = '<pegar-jwt-aqui>';
```

> **Por qué `ALTER DATABASE` y no `SET`:** `SET` es per-session; `ALTER DATABASE` persiste y aplica a futuras sesiones (incluyendo el background worker de pg_cron).

> **Cuándo aplica el cambio:** el GUC se lee con `current_setting()` en cada llamada a la función, así que el siguiente tick del cron lo recoge sin reload. No requiere `pg_reload_conf()`.

### 3.3 — Verificar
```sql
SELECT name, CASE WHEN length(setting)>0 THEN '<set>' ELSE '<empty>' END AS state
  FROM pg_settings
 WHERE name IN ('app.notifications_dispatch_url','app.service_role_key');
```
Esperado: 2 filas, ambas `<set>`.

---

## 4. Deploy Edge Function `notifications-dispatch`

Stub provisto en `supabase/functions/notifications-dispatch/index.ts`. Track B (US.B15.2.x) reemplazará la implementación con el dispatcher real (`packages/infrastructure/src/notifications/dispatcher.ts`).

```bash
supabase functions deploy notifications-dispatch --project-ref ejacvsgbewcerxtjtwto
```

Verificar:
```bash
curl -X POST 'https://ejacvsgbewcerxtjtwto.supabase.co/functions/v1/notifications-dispatch' \
  -H 'Authorization: Bearer <anon-or-service>' \
  -H 'Content-Type: application/json' \
  -d '{"eventId":"00000000-0000-0000-0000-000000000000"}'
```
Esperado: `{"ok":true}`.

---

## 5. Smoke verification

Correr `packages/database/sql/__tests__/44_poller_smoke.sql` en SQL Editor. Cada bloque devuelve la salida esperada o documenta el problema.

Si Smoke 4 falla con 0 filas → repetir paso 3.
Si Smoke 5 falla → repetir paso 1.
Si Smoke 2 falla → repetir paso 2.

---

## 6. Observabilidad (primeros 5 minutos post-activación)

```sql
-- Últimas ejecuciones del cron (hasta 10).
SELECT runid, job_pid, status, return_message, start_time, end_time
  FROM cron.job_run_details
 WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname='notifications-poll-outbox')
 ORDER BY start_time DESC
 LIMIT 10;

-- Respuestas HTTP recientes de pg_net (success vs error).
-- Nota: pg_net crea su propio schema `net` independiente del WITH SCHEMA elegido.
SELECT id, created, status_code, content_type, error_msg
  FROM net._http_response
 ORDER BY created DESC
 LIMIT 20;
```

Si todas las filas en `cron.job_run_details` muestran `status='succeeded'` y `net._http_response` muestra `status_code IN (200,202)`, el poller está sano.

---

## 7. Rollback / pausa

```sql
-- Pausar el job (no lo borra; reanudable con cron.alter_job activar).
SELECT cron.unschedule('notifications-poll-outbox');

-- Reanudar (re-aplicar SQL 44 o ejecutar manualmente):
SELECT cron.schedule(
  'notifications-poll-outbox',
  '*/1 * * * *',
  $$SELECT notifications.process_outbox_batch(50);$$
);

-- Rollback completo (función + columnas operacionales):
DROP FUNCTION IF EXISTS notifications.process_outbox_batch(INT);
ALTER TABLE public."DomainEvent" DROP COLUMN IF EXISTS "lastAttemptAt";
ALTER TABLE public."DomainEvent" DROP COLUMN IF EXISTS "lastNetRequestId";
-- lastError no se borra (vive en schema.prisma).
```

---

## 8. Latencia — workaround 1 min vs objetivo 30 s

**Limitación:** `pg_cron` min interval = 1 min (limitación nativa de la sintaxis cron `*/1`).

**Workaround actual (Wave 1):** un único job cada minuto procesa hasta 50 eventos por tick. P95 latencia esperada ≈ **30–90 s** (peor caso = evento emitido justo después del último tick).

**Workarounds NO implementados (decisión consciente):**

- **Dos jobs offset 30s:** requiere `pg_sleep(30)` dentro del segundo job — desaconsejado (bloquea worker pg_cron, riesgo de overlap).
- **Tick cada 30s via Inngest:** fuera de scope §5.1 (Inngest descartado).

**Plan Wave 2:** si tras una semana en staging la métrica P95 `(now() - occurredAt)` para `publishedAt IS NOT NULL` supera **90s**, reabrir decisión §5.1 (probablemente Inngest scheduled).

---

## 9. TODOs pendientes (no-bloqueantes)

- [ ] **Track B:** reemplazar Edge Function stub con dispatcher TS real (US.B15.2.x).
- [ ] **PR separado:** sync de `lastAttemptAt` + `lastNetRequestId` al `schema.prisma` (cosmético — no afecta a tipos generados de tRPC).
- [ ] **Wave 2:** Grafana dashboard con `cron.job_run_details` + DLQ count + P95 latency.

---

## 10. Refs

- `packages/database/sql/44_notifications_outbox_poller.sql` — la migración.
- `packages/database/sql/__tests__/44_poller_smoke.sql` — verificación.
- `supabase/functions/notifications-dispatch/index.ts` — Edge Function stub.
- `docs/blueprints/beta15_notifications_sre_review.md` §S1, §S2, §S5 — análisis pg_cron.
- `docs/blueprints/beta15_notifications_dba_review.md` §S4, §S5 — backoff + concurrency.
- `docs/blueprints/beta15_notifications.md` §5.1 — decisión vinculante.
