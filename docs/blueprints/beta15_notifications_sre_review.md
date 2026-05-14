# @SRE — Review de Infraestructura Beta.15: Alerts & Notifications

- **Owner:** @SRE (Site Reliability Engineer, Inversiones Avante)
- **Fecha:** 2026-05-14
- **Revisión sobre:** `docs/blueprints/beta15_notifications.md` + `docs/adr/0008-beta15-notifications-outbox.md`
- **DBA review base:** `docs/blueprints/beta15_notifications_dba_review.md`
- **Proyecto Supabase:** `ejacvsgbewcerxtjtwto` (Oregon, `aws-1-us-west-2`)
- **PostgreSQL:** 17.6 (aarch64, GCC 15.2.0)

---

## Veredicto

> **APROBADO CON CONDICIONES.**
>
> Las dos extensiones requeridas (`pg_cron` v1.6.4, `pg_net` v0.20.0) están disponibles en el catálogo del proyecto y ya figuran en `shared_preload_libraries` — solo falta ejecutar `CREATE EXTENSION`. No hay bloqueo de plan (ambas están habilitadas en el tier actual). El sistema de Edge Functions no tiene ninguna desplegada aún. La cuenta Resend y el dominio sender requieren decisión explícita de Edwin antes del spike US.B15.1.1. La variable de entorno GUC `app.notifications_dispatch_url` no está configurada (verificado en vivo). El enum `AuditAction` no contiene `OUTBOX_POLLER_FAIL` ni `SYSTEM_ERROR` — se debe resolver antes del sprint. Lista completa de condiciones en §10.

---

## S1. Estado verificado de extensiones (queries en vivo)

Queries ejecutadas contra `ejacvsgbewcerxtjtwto.supabase.co` durante esta revisión.

### S1.1 Extensiones instaladas actualmente

```
extname              extversion  schema
-------------------  ----------  ----------
citext               1.6         extensions
pg_stat_statements   1.11        extensions
pg_trgm              1.6         extensions
pgcrypto             1.3         extensions
plpgsql              1.0         pg_catalog
supabase_vault       0.3.1       vault
uuid-ossp            1.1         extensions
```

`pg_cron` y `pg_net` **no están instaladas** (installed_version IS NULL en ambas).

### S1.2 Extensiones disponibles y relevantes para Beta.15

```
name      default_version  installed_version  resultado
--------  ---------------  -----------------  ---------
http      1.6              NULL               NO se usa (pg_net es preferido en Supabase)
pg_cron   1.6.4            NULL               REQUERIDA — no instalada aun
pg_net    0.20.0           NULL               REQUERIDA — no instalada aun
```

### S1.3 Hallazgo clave: pg_cron y pg_net ya estan en shared_preload_libraries

```sql
shared_preload_libraries =
  'pg_stat_statements, pgaudit, plpgsql, plpgsql_check,
   pg_cron, pg_net, pgsodium, auto_explain, pg_tle,
   plan_filter, supabase_vault'
```

**Implicacion:** ambas extensiones estan preloadeadas a nivel de servidor. El `CREATE EXTENSION` es un simple DDL, no requiere restart ni accion en el Dashboard de Supabase distinta de ejecutar la sentencia. No hay bloqueo de plan.

### S1.4 GUC app.* — ninguno configurado

Query `SELECT name, setting FROM pg_settings WHERE name LIKE 'app.%'` devolvio 0 rows.

Los GUC `app.notifications_dispatch_url` y `app.service_role_key` que requiere `notifications.process_outbox_batch()` no existen. **Tarea @SRE antes del sprint.**

### S1.5 Schemas presentes

Solo existen `public` y `audit`. Los schemas `cron`, `net` y `notifications` no existen — se crean al ejecutar `CREATE EXTENSION` (cron, net) y en la migration SQL 42 (notifications — solo funciones).

### S1.6 Edge Functions desplegadas

```
(ninguna)
```

La funcion `notifications-dispatch` no existe aun. Deploy pendiente por @SRE.

### S1.7 AuditAction enum — valores actuales

```
CREATE, READ, UPDATE, DELETE, PRINT, EXPORT,
SIGN, VOID, LOGIN, LOGOUT, BREAK_GLASS
```

`OUTBOX_POLLER_FAIL` **no existe**. `SYSTEM_ERROR` tampoco. El bloque `EXCEPTION` de la funcion `notifications.process_outbox_batch()` (DBA review §S4.5) que hace INSERT en AuditLog debe usar un valor existente o requerir migration de enum. Ver condicion C4 en §10.

---

## S2. pg_cron — analisis completo

### S2.1 Disponibilidad y habilitacion

- **Estado:** available v1.6.4, preloaded, NO instalado.
- **Plan:** sin bloqueo. El tier actual (verificado por presencia de `pg_cron` en `shared_preload_libraries`) lo soporta.
- **Costo de upgrade por pg_cron:** $0 — no se requiere upgrade de plan.

### S2.2 Comando de habilitacion

Ejecutar desde SQL Editor de Supabase Dashboard o via `mcp__supabase__execute_sql` en modo write:

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron SCHEMA cron;
```

Despues de ejecutar, verificar:

```sql
SELECT extname, extversion, extnamespace::regnamespace AS schema
FROM pg_extension WHERE extname = 'pg_cron';
-- Esperado: pg_cron | 1.6.4 | cron
```

### S2.3 Soporte de seconds-cron (cron de 6 campos)

**Hallazgo: NO confirmable por query directa, pero probable que NO este habilitado.**

Razon: el soporte de 6 campos (segundos) requiere que pg_cron sea compilado con el flag `--with-cron-seconds`. La version 1.6.x de pg_cron en Supabase usa la build estandar de Supabase, que NO habilita seconds-cron por defecto segun la documentacion oficial de Supabase (pg_cron en Supabase solo soporta 5-field cron expressions).

**Impacto en latencia:** el schedule `*/30 * * * * *` del blueprint (§6.2) NO funcionara. El fallback obligatorio es `* * * * *` (cada 1 minuto).

| Escenario | Schedule | Latencia P95 | Limite aceptable Beta.15 |
|---|---|---|---|
| 6-field (si disponible) | `*/30 * * * * *` | ~90s | Optimo |
| 5-field (fallback real) | `* * * * *` | ~180s | Aceptable — confirmado por @PO/ADR |

El ADR 0008 §Consecuencias documenta explicitamente que 180s es aceptable si seconds-cron no esta disponible. **No es bloqueante.**

**Como verificar post-enable:**

```sql
-- Intentar schedule con 6 campos; si falla con error de parsing, no hay soporte
SELECT cron.schedule('test-seconds', '*/30 * * * * *', 'SELECT 1');
-- Si da error: usar 5-field
-- Limpiar:
SELECT cron.unschedule('test-seconds');
```

**Verificacion post-enable de schedules activos:**

```sql
SELECT jobid, jobname, schedule, command, active
FROM cron.job ORDER BY jobid;
```

### S2.4 Grants requeridos post-CREATE EXTENSION

```sql
-- El role postgres ya tiene acceso; confirmar que el schema cron es visible:
GRANT USAGE ON SCHEMA cron TO postgres;
-- pg_cron ejecuta jobs como role 'postgres' por defecto en Supabase
```

### S2.5 Schedule recomendado (fallback a 5-field)

```sql
-- Job principal (poller outbox)
SELECT cron.schedule(
  'notifications-outbox-poller',
  '* * * * *',   -- cada 1 minuto (5-field, fallback seguro)
  $$ SELECT notifications.process_outbox_batch(100) $$
);

-- Job de purga (retención 90 dias)
SELECT cron.schedule(
  'notifications-purge-read-older-90d',
  '0 3 * * *',   -- 03:00 UTC diario
  $$ DELETE FROM public."Notification"
     WHERE status = 'READ' AND "readAt" < NOW() - INTERVAL '90 days' $$
);
```

**Importante:** ejecutar estos SELECT solo despues de que @Dev haya mergeado el PR con la funcion `notifications.process_outbox_batch` y la tabla `Notification`. No activar el schedule antes — el cron intentara ejecutar la funcion ausente y fallara.

---

## S3. pg_net — analisis completo

### S3.1 Disponibilidad y habilitacion

- **Estado:** available v0.20.0, preloaded, NO instalado.
- **Plan:** sin bloqueo (mismo razonamiento que pg_cron — ambas en shared_preload_libraries).
- **Costo:** $0.

### S3.2 Comando de habilitacion

```sql
CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA net;
```

Verificar post-enable:

```sql
SELECT extname, extversion, extnamespace::regnamespace AS schema
FROM pg_extension WHERE extname = 'pg_net';
-- Esperado: pg_net | 0.20.0 | net

-- Confirmar que net.http_post existe:
SELECT proname, nspname
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE nspname = 'net' AND proname LIKE 'http%'
ORDER BY proname;
```

### S3.3 Diferencia critica con el blueprint: semantica ASINCRONA

El blueprint §6.1 usa `extensions.http_post` (no existe en este proyecto — confirmado en DBA review §S4.2). El reemplazo correcto es `net.http_post`, pero con una diferencia de semantica importante:

- `net.http_post` es **asincrono**: encola la request y devuelve un `request_id` inmediatamente. La Edge Function se invoca en background.
- La funcion `notifications.process_outbox_batch()` NO puede esperar la respuesta de la Edge Function en la misma ejecucion.
- La Edge Function es responsable de actualizar `DomainEvent.publishedAt` y `attempts` de forma autonoma.

**Esto es arquitecturalmente correcto** para el patron outbox. No se requiere cambio de diseno, solo confirmar que el codigo de la Edge Function siempre actualice el estado en DB antes de retornar.

**Tabla de respuestas `net._http_response`** (tabla interna de pg_net):

```sql
-- Para debugging post-deploy: ver las ultimas N requests HTTP
SELECT id, status_code, content_type, content, error_msg
FROM net._http_response
ORDER BY id DESC
LIMIT 20;
```

Util para diagnosticar si la Edge Function retorna errores HTTP (5xx) sin que el log de pg_cron lo muestre.

### S3.4 Rate limits de pg_net

pg_net v0.20.0 usa un background worker con concurrencia configurable (por defecto 200 conexiones simultaneas). Para el volumen de Beta.15 (1 request/minuto en steady state, picos de 1 request/30s si se habilita seconds-cron) esta lejos de cualquier limite.

---

## S4. Cuenta Resend para emails

### S4.1 Estado actual

No existe cuenta Resend provisionada para Inversiones Avante. **TO DECIDE: Edwin debe confirmar si ya tienen cuenta o crear una nueva.**

### S4.2 Pasos de creacion (si no existe cuenta)

1. Ir a `https://resend.com` y crear cuenta con email corporativo `emartinez@complejoavante.com` (o cuenta de servicio `his-sre@complejoavante.com`).
2. Seleccionar plan **Free** para comenzar (3,000 emails/mes, sin costo).
3. Si el volumen supera 3,000/mes: upgrade a **Pro** ($20/mes, 50,000 emails/mes). Ver estimacion en §8.

### S4.3 Dominio sender — TO DECIDE

El blueprint propone `notifications@his.avante.example` — este dominio no es real. Segun la memoria de sesion, Avante usa `complejoavante.com`.

**Opciones:**

| Opcion | Sender | Requiere |
|---|---|---|
| A (recomendada) | `notifications@his.complejoavante.com` | Subdominio dedicado para HIS. DNS records en proveedor del dominio. |
| B | `his-notifications@complejoavante.com` | Solo records en el dominio raiz. Mas simple. |

**TO DECIDE: Edwin confirma dominio a usar (A o B).**

### S4.4 DNS records requeridos para verificacion en Resend

Una vez elegido el dominio, Resend provee los valores exactos en su dashboard (Settings → Domains → Add Domain). Los tipos de records a agregar son:

```
# DKIM (DomainKeys Identified Mail) — 2 registros TXT
Tipo: TXT
Host: resend._domainkey.<tu-dominio>
Valor: [proporcionado por Resend — contiene clave publica RSA]

# SPF (Sender Policy Framework)
Tipo: TXT
Host: @  (o el subdominio elegido)
Valor: "v=spf1 include:amazonses.com ~all"

# DMARC (Domain-based Message Authentication)
Tipo: TXT
Host: _dmarc.<tu-dominio>
Valor: "v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@complejoavante.com"
```

La propagacion DNS puede tardar hasta 72h. **Iniciar antes del Sprint 1 para no bloquear US.B15.2.2.**

### S4.5 API Key — emision y scope

En Resend Dashboard → API Keys → Create API Key:

- **Nombre:** `his-notifications-prod`
- **Permission:** `Sending access` UNICAMENTE — NO otorgar `Full access` ni `Domains access`.
- **Domain:** restringir al dominio verificado en §4.4.

Guardar el valor del API Key en el momento de creacion (Resend no lo muestra de nuevo).

**ADVERTENCIA:** no pegar el valor en ningun archivo, commit, ni documento. Solo en los destinos de secrets listados en §5.

### S4.6 Webhook events (Beta.16 — fuera de alcance Beta.15)

Para tracking de delivery/bounce/complaint configurar en Beta.16:
- URL: `https://<vercel-app>/api/webhooks/resend`
- Events: `email.delivered`, `email.bounced`, `email.complained`

No configurar en Beta.15. La metrica de delivery en Beta.15 se infiere por `Notification.status = SENT` (envio exitoso a Resend) sin confirmacion de entrega final.

---

## S5. Edge Function `notifications-dispatch`

### S5.1 Estado actual

Cero Edge Functions desplegadas en el proyecto (verificado con `list_edge_functions` — retorna array vacio).

### S5.2 Decision de region

Conflicto identificado en el prompt: el proyecto Supabase HIS esta en `aws-1-us-west-2` (Oregon); Vercel puede estar en `iad1` (us-east-1) u otra region.

**Recomendacion SRE: desplegar la Edge Function en la misma region que la BD (Oregon / us-west-2).**

Justificacion:

| Flujo | Frecuencia | Round-trip si mismo region | Round-trip si region diferente |
|---|---|---|---|
| `pg_cron → net.http_post → Edge Function` | 1/min (o 2/min con seconds-cron) | ~2-5ms (intra-AWS us-west-2) | ~60-80ms (cross-region us-west-2 → us-east-1) |
| `Edge Function → BD Supabase (SELECT/UPDATE)` | N queries/invocacion (N=batch_size) | ~2-5ms | ~60-80ms por query |
| `Vercel → tRPC → BD` | por request usuario | paga round-trip una sola vez | no cambia con decision de EF |

El cuello de botella real es Edge Function ↔ BD, que ocurre N veces por invocacion con el batch de 100 eventos. Colocar la Edge Function en Oregon elimina ese overhead para las operaciones de alta frecuencia.

**La latencia adicional Vercel → Edge Function** (si Vercel esta en us-east-1) solo ocurre en llamadas directas de UI a la EF, lo cual no aplica en Beta.15 (la EF solo la invoca pg_cron, no la UI).

### S5.3 Comando de deploy

```bash
# Requiere Supabase CLI instalado y autenticado
supabase functions deploy notifications-dispatch \
  --project-ref ejacvsgbewcerxtjtwto

# Si el archivo aun no existe, crear primero:
# supabase/functions/notifications-dispatch/index.ts
```

Verificar post-deploy:

```bash
supabase functions list --project-ref ejacvsgbewcerxtjtwto
```

### S5.4 Autenticacion — JWT obligatorio

La Edge Function DEBE usar `SUPABASE_SERVICE_ROLE_KEY` para autenticarse contra la BD, NO el anon key.

Razon: la EF necesita hacer UPDATE en `DomainEvent` (marcando `publishedAt`) e INSERT en `Notification`. Estas operaciones requieren bypassear RLS (service_role no tiene restricciones de RLS por default en Supabase).

**Verificacion en codigo de la EF:**

```ts
// CORRECTO
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

// INCORRECTO — anon key no puede hacer UPDATE a DomainEvent ni INSERT a Notification
// const supabase = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!)
```

### S5.5 Consideraciones de cold start

Deno (runtime de Edge Functions Supabase) tiene cold start tipico de 300ms-2s dependiendo del tamano del bundle. Con batch de 100 eventos y Resend SDK liviano, el cold start se amortiza en cada invocacion del minuto.

**Mitigacion:** el timeout de Edge Functions en Supabase es 60s por defecto. Con batch 100 y ~100ms/evento (query BD + Resend call), el tiempo total estimado es ~10s — bien dentro del limite. Si el P95 supera 30s (metrica §6), reducir batch a 50.

---

## S6. Secrets management

### S6.1 Variables requeridas — mapa completo

| Variable | Destino | Quien configura | Cuando |
|---|---|---|---|
| `app.notifications_dispatch_url` | GUC PostgreSQL (ALTER DATABASE) | @SRE | Antes de activar cron.schedule() |
| `app.service_role_key` | GUC PostgreSQL (ALTER DATABASE) | @SRE | Antes de activar cron.schedule() |
| `RESEND_API_KEY` | Supabase Edge Function secrets | @SRE | Antes de deploy EF |
| `SUPABASE_URL` | Supabase Edge Function (automatica) | Supabase injected | Automatico |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Edge Function (automatica) | Supabase injected | Automatico |
| `RESEND_API_KEY` | Vercel env (server-side) | @SRE | Antes de US.B15.2.2 |
| `NOTIFICATIONS_FROM_EMAIL` | Vercel env (server-side) | @SRE | Antes de US.B15.2.2 |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel env (ya existe) | ya configurado | — |

**Nota:** `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` son inyectadas automaticamente en Edge Functions por Supabase — no requieren accion manual para la EF.

### S6.2 Configurar GUC para pg_cron

```sql
-- Ejecutar desde SQL Editor con role postgres (no anon/authenticated)
ALTER DATABASE postgres
  SET app.notifications_dispatch_url = 'https://ejacvsgbewcerxtjtwto.supabase.co/functions/v1/notifications-dispatch';

ALTER DATABASE postgres
  SET app.service_role_key = '<SUPABASE_SERVICE_ROLE_KEY_PLACEHOLDER>';
```

**ADVERTENCIA: reemplazar `<SUPABASE_SERVICE_ROLE_KEY_PLACEHOLDER>` con el valor real. NUNCA commitear el valor real a Git ni a este documento.**

El valor estara disponible inmediatamente para sesiones nuevas. Para la sesion actual de pg_cron, reiniciar el proceso o esperar al proximo tick.

### S6.3 Secrets en Edge Function

```bash
supabase secrets set \
  RESEND_API_KEY=<PLACEHOLDER> \
  --project-ref ejacvsgbewcerxtjtwto

# Verificar (muestra nombres, no valores):
supabase secrets list --project-ref ejacvsgbewcerxtjtwto
```

### S6.4 Variables en Vercel

Configurar desde Vercel Dashboard → Project → Settings → Environment Variables, o via CLI:

```bash
vercel env add RESEND_API_KEY production
vercel env add NOTIFICATIONS_FROM_EMAIL production
# NOTIFICATIONS_FROM_EMAIL value ejemplo: notifications@his.complejoavante.com
```

### S6.5 ADVERTENCIA CRITICA — no pegar secrets en ningun documento

Ninguno de los valores reales de API keys, service_role_key ni tokens debe aparecer en archivos del repo, mensajes de commit, ni PRs. Usar siempre placeholders como `<RESEND_API_KEY>` o `<SERVICE_ROLE_KEY>`.

---

## S7. Observabilidad

### S7.1 Metricas a monitorear

| Metrica | Query / Fuente | Umbral de alerta | Frecuencia de muestreo |
|---|---|---|---|
| Queue lag (eventos pendientes) | `SELECT count(*) FROM "DomainEvent" WHERE "publishedAt" IS NULL AND attempts < 6` | > 5,000 por mas de 10 min | 1 min |
| Dead-letter count | `SELECT count(*) FROM "DomainEvent" WHERE attempts >= 6 AND "publishedAt" IS NULL` | > 0.5% del total de eventos | 5 min |
| Dead-letter absoluto | misma query — count() | > 50 eventos acumulados sin resolver | 1 hora |
| EF invocation duration P95 | Supabase Dashboard → Edge Functions → Metrics | > 30s | por invocacion |
| EF error rate | Supabase Dashboard → Edge Functions → Logs | > 5% de invocaciones con status 5xx | 5 min |
| pg_net requests pendientes | `SELECT count(*) FROM net._http_response WHERE error_msg IS NOT NULL` | > 10 errores recientes | 5 min |
| Notification delivery rate | `count(*) WHERE status='SENT' / count(*) WHERE status IN ('SENT','FAILED')` | < 98% en ventana de 1h | 15 min |

### S7.2 Alertas SLO Beta.15

```
SLO-1: Queue lag < 5,000 eventos pendientes en cualquier ventana de 10 min
  → Alerta si: count(DomainEvent WHERE publishedAt IS NULL) > 5,000 por > 10 min
  → Severidad: WARNING en 2,500 / CRITICAL en 5,000
  → Runbook: verificar pg_cron activo, Edge Function respondiendo, Resend sin rate limit

SLO-2: Dead-letter < 0.5% del total de eventos emitidos
  → Alerta si: count(attempts >= 6 AND publishedAt IS NULL) / count(*) > 0.005
  → Severidad: CRITICAL inmediato (puede indicar bug en payload o EF caida)
  → Runbook: revisar lastError de las rows afectadas, relanzar manualmente si payload valido

SLO-3: Edge Function P95 duration < 30s
  → Fuente: Supabase Dashboard (no hay Prometheus directo en Free/Pro tier sin exportador custom)
  → Si P95 > 30s: reducir batch_size de 100 a 50 via cron.schedule update
  → Si P95 > 50s: investigar queries lentas o Resend timeout
```

### S7.3 Queries de monitoreo operacional (runbook)

```sql
-- Estado actual del outbox (ejecutar desde SQL Editor)
SELECT
  count(*) FILTER (WHERE "publishedAt" IS NULL AND attempts = 0)  AS "pendiente_nuevo",
  count(*) FILTER (WHERE "publishedAt" IS NULL AND attempts > 0)  AS "en_reintento",
  count(*) FILTER (WHERE "publishedAt" IS NULL AND attempts >= 6) AS "dead_letter",
  count(*) FILTER (WHERE "publishedAt" IS NOT NULL)               AS "publicado",
  count(*)                                                         AS "total"
FROM public."DomainEvent";

-- Ultimos 20 eventos dead-letter (para diagnóstico)
SELECT id, "eventType", "aggregateType", attempts, "lastError", "occurredAt"
FROM public."DomainEvent"
WHERE attempts >= 6 AND "publishedAt" IS NULL
ORDER BY "occurredAt" DESC
LIMIT 20;

-- Jobs activos de pg_cron
SELECT jobid, jobname, schedule, active, jobname
FROM cron.job;

-- Historial de ejecuciones recientes de pg_cron
SELECT jobid, start_time, end_time, return_message, status
FROM cron.job_run_details
WHERE jobname = 'notifications-outbox-poller'
ORDER BY start_time DESC
LIMIT 20;
```

### S7.4 Dashboard placeholder

Los dashboards de Grafana/Supabase para Beta.15 se documentaran en `docs/observability/beta15_dashboards.md` una vez que las tablas esten en produccion y haya datos reales. No crear el archivo antes del merge del spike US.B15.1.1.

Los paneles minimos a crear en ese documento:

- Panel 1: Queue lag timeseries (1h sliding window)
- Panel 2: Dead-letter gauge + trend
- Panel 3: EF invocation duration P50/P95/P99
- Panel 4: Notification delivery funnel (PENDING → SENT → DELIVERED → READ)
- Panel 5: Events por eventType (breakdown)

---

## S8. Costos estimados incrementales Beta.15

### S8.1 Desglose por servicio

| Servicio | Escenario MVP (200 alertas/dia/estab × 10 estab) | Escenario escala (5x) |
|---|---|---|
| **Resend** | 2,000 alertas/dia × 50% EMAIL × 1.5 recipients avg = ~1,500 emails/dia = **45,000/mes**. Free tier = 3,000/mes. **Requiere Pro = $20/mes** | 225,000 emails/mes → Pro tier $20/mes (50k incluidos) + $0.80 por 1,000 adicionales = **~$196/mes** |
| **Supabase pg_cron** | $0 — incluido en tier actual | $0 |
| **Supabase pg_net** | $0 — incluido en tier actual | $0 |
| **Supabase Edge Functions** | 1 invocacion/min × 60min × 24h × 30d = **43,200 invocaciones/mes**. Free tier = 500,000 invocaciones. **$0** | 86,400 inv/mes (con seconds-cron) — aun dentro de 500k free. **$0** |
| **Vercel** | Sin cambio — la EF corre en Supabase, no en Vercel | $0 adicional |
| **Supabase plan upgrade** | NO requerido — pg_cron y pg_net disponibles en tier actual | $0 |

**Nota sobre Resend:** el calculo asume que el 50% de las alertas genera EMAIL (las otras son solo INBOX). Si la tasa real es diferente, escalar proporcionalmente.

### S8.2 Resumen de costo incremental mensual

| Escenario | Costo adicional/mes |
|---|---|
| **Dia 1 — MVP (< 3k emails/mes)** | $0 (Free tier Resend cubre) |
| **MVP pleno (200/dia/estab × 10)** | ~$20/mes (Resend Pro) |
| **Escala 5x** | ~$196/mes (Resend) |
| **Supabase plan** | $0 adicional en cualquier escenario |

**Rango mensual Beta.15: $0 - $20/mes** durante los primeros 3 meses de operacion. Escala lineal con volumen de email, no con usuarios.

---

## S9. Riesgos operacionales

| # | Riesgo | Probabilidad | Impacto | Mitigacion |
|---|---|---|---|---|
| **SRE-R1** | **Edge Function cold start > 2s** en primera invocacion despues de inactividad prolongada. Deno mantiene el runtime caliente mientras hay invocaciones frecuentes (1/min en Beta.15), pero si hay periodos de baja actividad (ej. madrugada sin alertas), el primer tick post-inactividad pagara cold start. | MEDIA | BAJO | El batch de 100 eventos amortiza el cold start en la primera invocacion. Dado que el cron corre cada minuto (o cada 30s), el runtime raramente se enfria. Si P95 nocturno > 3s, evaluar warm-up ping en cron.schedule separado (`SELECT 1` a la EF cada 5 minutos — Beta.16). |
| **SRE-R2** | **pg_cron failover en HA: el scheduler vive en el servidor primario.** Si Supabase ejecuta un failover al replica (ej. por mantenimiento o falla), `pg_cron` se detiene hasta que el nuevo primario este activo. Los eventos quedan en queue hasta que el cron se reactiva. | BAJA | MEDIO | `DomainEvent` con `publishedAt IS NULL` sobrevive el failover (durabilidad garantizada por outbox). Los eventos se procesan en el proximo tick post-failover. Latencia adicional = tiempo de failover Supabase (tipicamente 60-120s). Documentar en runbook: "si hay alertas de queue lag > 5,000 verificar primero si hubo failover en Supabase Dashboard → Reports → Uptime". |
| **SRE-R3** | **Resend rate limits por segundo.** El plan Pro tiene un limite de envio de ~10 requests/segundo. Si la Edge Function procesa 100 eventos y todos generan EMAIL, hace 100 llamadas a Resend en rapida sucesion — puede dar 429 TooManyRequests. | MEDIA | MEDIO | Implementar delay entre llamadas a Resend en la Edge Function: procesar secuencialmente (no Promise.all) con await para cada email. Batch de 100 eventos a 1 email cada ~10ms = 1s total para el peor caso. Si Resend da 429, el dispatcher debe tratarlo como `TransientProviderError` → `attempts++` → reintento en proximo tick. |
| **SRE-R4** | **GUC `app.service_role_key` expuesto en pg_settings.** La service_role_key guardada como GUC de PostgreSQL es visible para cualquier usuario con acceso a `pg_settings` (role pg_monitor o superuser). En Supabase, esto incluye cualquier usuario con acceso al Dashboard SQL Editor. | MEDIA | ALTO | (a) El valor en GUC es legible por roles elevados — aceptable si el acceso al SQL Editor esta restringido a @SRE y @Dev senior. (b) Alternativa mas segura: usar `vault.secrets` de Supabase Vault (extension `supabase_vault` ya instalada v0.3.1) para almacenar la key y leerla desde la funcion via `vault.decrypted_secrets`. Recomendacion: implementar via Vault en Sprint 1 si el equipo tiene capacidad; si no, GUC como primera iteracion con acceso restringido al SQL Editor. |
| **SRE-R5** | **Enum `AuditAction` sin valor `OUTBOX_POLLER_FAIL`.** La funcion `notifications.process_outbox_batch` (DBA review §S4.5) requiere un valor de enum para el bloque EXCEPTION. Los valores actuales son: `CREATE, READ, UPDATE, DELETE, PRINT, EXPORT, SIGN, VOID, LOGIN, LOGOUT, BREAK_GLASS`. Ninguno aplica semanticamente. | ALTA (es certeza) | MEDIO | Dos opciones: (a) Agregar `OUTBOX_POLLER_FAIL` al enum via migration separada (requiere dos transacciones segun leccion Beta.6/POST_OP), (b) Cambiar el bloque EXCEPTION para usar `UPDATE` o `CREATE` con justification descriptivo — menos semantico pero operacional. Recomendacion: opcion (b) para evitar la complejidad de ALTER TYPE en Sprint 1; crear issue para opcion (a) en Beta.16 junto con limpieza de enum. Ver condicion C4 en §10. |

---

## S10. Deployment pipeline — pasos previos al spike US.B15.1.1

Orden estricto basado en dependencias verificadas. Paralelismo indicado.

### S10.1 Fase @SRE pre-spike (puede ejecutarse en paralelo con @Dev Sprint 1)

```
Paso 1 (inmediato — @SRE solo):
  a. Crear cuenta Resend + verificar dominio sender
     → Tiempo estimado: 30 min creacion + hasta 72h propagacion DNS
     → BLOQUEANTE para US.B15.2.2 (ResendEmailProvider)

Paso 2 (en paralelo con DNS propagation):
  a. CREATE EXTENSION IF NOT EXISTS pg_cron SCHEMA cron;
  b. CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA net;
  c. Verificar con queries de §S2.2 y §S3.2
  d. Probar soporte seconds-cron (§S2.3) y documentar resultado

Paso 3 (despues de Paso 2):
  a. Emitir API Key Resend (scope Send-only, dominio restringido)
  b. SET secrets en Supabase Edge Functions: RESEND_API_KEY
  c. SET vars en Vercel: RESEND_API_KEY, NOTIFICATIONS_FROM_EMAIL
  d. NO configurar GUC aun (esperar a que la funcion SQL exista)

Paso 4 (despues de que @Dev mergee PR US.B15.1.1):
  a. ALTER DATABASE SET app.notifications_dispatch_url = '...'
  b. ALTER DATABASE SET app.service_role_key = '...'
  c. Deploy Edge Function placeholder (supabase functions deploy)
  d. Activar schedules pg_cron (SELECT cron.schedule(...))
  e. Verificar con cron.job_run_details que el primer tick corre sin error
```

### S10.2 Rollback plan — como desactivar el cron en produccion si algo falla

```sql
-- Desactivar el job sin eliminarlo (preserva la definicion)
UPDATE cron.job SET active = false WHERE jobname = 'notifications-outbox-poller';

-- Verificar que este inactivo:
SELECT jobname, active FROM cron.job WHERE jobname = 'notifications-outbox-poller';

-- Si se quiere eliminar permanentemente:
SELECT cron.unschedule('notifications-outbox-poller');

-- Para reactivar:
UPDATE cron.job SET active = true WHERE jobname = 'notifications-outbox-poller';
```

El rollback no afecta los eventos ya en queue (`DomainEvent` con `publishedAt IS NULL`). Al reactivar, el poller los procesa normalmente.

### S10.3 Smoke test post-activacion

```sql
-- 1. Insertar evento de prueba manualmente (staging solo)
INSERT INTO public."DomainEvent" (
  "organizationId", "eventType", "aggregateType", "aggregateId", payload, "occurredAt"
) VALUES (
  '<ORGANIZATION_ID_STAGING>',
  'vital.critical',
  'InpatientVitals',
  gen_random_uuid(),
  '{"admissionId": "00000000-0000-0000-0000-000000000001",
    "patientId": "00000000-0000-0000-0000-000000000002",
    "vitalsId": "00000000-0000-0000-0000-000000000003",
    "alerts": [{"parameter": "SPO2", "value": 82, "severity": "CRITICAL", "message": "SPO2 critico"}]}'::jsonb,
  NOW()
);

-- 2. Esperar 1-2 minutos (un tick de pg_cron)

-- 3. Verificar que publishedAt se actualizó
SELECT id, "eventType", "publishedAt", attempts, "lastError"
FROM public."DomainEvent"
WHERE "eventType" = 'vital.critical'
ORDER BY "occurredAt" DESC LIMIT 5;

-- 4. Verificar que se crearon Notification rows
SELECT id, channel, status, "sentAt"
FROM public."Notification"
WHERE "eventId" = '<EVENT_ID_DEL_PASO_1>';
```

---

## S11. AuditAction enum — decision requerida

**Verificado:** los valores actuales del enum `AuditAction` son:
`CREATE, READ, UPDATE, DELETE, PRINT, EXPORT, SIGN, VOID, LOGIN, LOGOUT, BREAK_GLASS`

La funcion `notifications.process_outbox_batch()` necesita registrar fallos del poller en `audit.AuditLog`. Sin un valor semanticamente correcto, hay dos caminos:

**Opcion A (recomendada para Sprint 1):** Usar `action = 'CREATE'` con `entity = 'OutboxPollerFail'` y `justification = format('SQLSTATE=%s msg=%s', SQLSTATE, SQLERRM)`. Operacionalmente funcional, semanticamente impreciso.

**Opcion B (preferida largo plazo):** Agregar `OUTBOX_POLLER_FAIL` via migration de dos transacciones. Complejidad media dado el precedente Beta.6/POST_OP. Diferir a Beta.16.

**TO DECIDE: @Dev confirma opcion A para Sprint 1 durante el spike US.B15.1.1.** Si opta por B, coordinar con @SRE la migration de enum antes de deployar la funcion.

---

## S12. Sign-off SRE

**Veredicto: APROBADO CON CONDICIONES**

### Condiciones obligatorias antes del merge de US.B15.1.1

| ID | Condicion | Owner | Bloqueante para |
|---|---|---|---|
| **C1** | `CREATE EXTENSION pg_cron SCHEMA cron` + `CREATE EXTENSION pg_net SCHEMA net` ejecutados y verificados en el proyecto Supabase HIS | @SRE | Spike US.B15.1.1 (funcion SQL 42) |
| **C2** | TO DECIDE: Edwin confirma dominio sender Resend (`his.complejoavante.com` o `complejoavante.com`). Iniciar verificacion DNS inmediatamente despues. | Edwin + @SRE | US.B15.2.2 (ResendEmailProvider) |
| **C3** | GUC `app.notifications_dispatch_url` y `app.service_role_key` configurados via `ALTER DATABASE` en staging antes de activar `cron.schedule()` | @SRE | US.B15.1.3 (worker poller) |
| **C4** | @Dev decide en spike US.B15.1.1 el valor de `AuditAction` a usar en el bloque EXCEPTION de `notifications.process_outbox_batch` (opcion A = `CREATE` + entity descriptivo) | @Dev | SQL 42 compila sin error |
| **C5** | API Key Resend emitida con scope `Send-only` y almacenada en Supabase secrets + Vercel env. Valor nunca en codigo ni documentos. | @SRE | US.B15.2.2 |
| **C6** | Edge Function `notifications-dispatch` placeholder deployada (puede retornar 200 sin procesar) para que los GUC tengan URL valida desde el primer tick | @SRE | US.B15.1.3 |

### Condiciones deseables (no bloqueantes para Sprint 1)

| ID | Condicion | Owner | Cuando |
|---|---|---|---|
| **D1** | Verificar soporte seconds-cron (`*/30 * * * * *`) post-enable y documentar resultado. Si no hay soporte confirmar 5-field fallback con @PO. | @SRE | Paso 2 del plan |
| **D2** | Evaluar Supabase Vault (`vault.secrets` ya instalado v0.3.1) vs GUC para `app.service_role_key`. Vault es mas seguro pero requiere mas setup. | @SRE | Sprint 2 |
| **D3** | Configurar alertas de queue lag y dead-letter en Supabase Dashboard una vez que las tablas existan en staging. | @SRE | Post-merge PR US.B15.1.1 |

### Lo que esta BIEN y no requiere cambio

- La arquitectura outbox + pg_cron + Edge Function es correcta y alineada con el stack Supabase.
- `net.http_post` (pg_net asincrono) es el reemplazo correcto para `extensions.http_post` — la semantica asincrona es arquitecturalmente compatible.
- El patron de costo es optimo: $0 incremental en infra Supabase, $20/mes en Resend en el escenario MVP pleno.
- Las 43,200 invocaciones/mes de Edge Function estan dentro del free tier de Supabase (limite 500k/mes) — sin costo adicional.
- La region de Edge Function en Oregon (misma que BD) es la decision correcta para minimizar latencia pg_cron → EF → BD.
- El rollback es simple y no destructivo (`UPDATE cron.job SET active = false`).
- El enum `AuditAction` existente (`BREAK_GLASS` recien introducido en Beta.14) confirma el precedente de extender el enum cuando es necesario — pero la opcion pragmatica A para Sprint 1 es valida.

---

**Fin del SRE review Beta.15.**
