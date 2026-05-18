# 05 — Monitoring Setup Go-Live

HIS Multipaís Avante — Configuración operativa de observabilidad pre-producción.

---

## 1. Vercel Analytics y Web Vitals (RUM)

### Activación

Vercel Analytics está incluido en el plan Pro. Activar desde el dashboard del proyecto:

```
Vercel Dashboard → HIS → Analytics → Enable
```

### Web Vitals tracking

Agregar en `apps/web/src/app/layout.tsx` (no modifica este PR — referencia para @Dev):

```tsx
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';

// dentro del body:
<Analytics />
<SpeedInsights />
```

Paquetes requeridos: `@vercel/analytics`, `@vercel/speed-insights` (ya en devDependencies si se usan).

### Métricas RUM monitoreadas

| Métrica | Umbral bueno | Umbral malo |
|---|---|---|
| LCP (Largest Contentful Paint) | < 2.5s | > 4s |
| FID / INP | < 100ms | > 300ms |
| CLS | < 0.1 | > 0.25 |
| TTFB | < 800ms | > 1800ms |

Alertas: configurar en Vercel → Monitoring → Alerts con umbrales anteriores. Canal: Slack `#his-ops`.

---

## 2. Supabase Logs — Queries lentas y RLS denials

### Slow query log (> 1s)

Desde Supabase Dashboard → Logs Explorer → Postgres:

```sql
select
  t,
  event_message,
  (metadata->>'query') as query,
  (metadata->>'duration')::float as duration_ms
from postgres_logs
where
  metadata->>'error_severity' = 'LOG'
  and (metadata->>'duration')::float > 1000
order by t desc
limit 50;
```

Guardar como view "Slow Queries > 1s" en el Log Explorer para acceso rápido.

### Conexiones activas

```sql
select count(*), state, wait_event_type
from pg_stat_activity
where datname = current_database()
group by state, wait_event_type
order by count desc;
```

Umbral de alerta: > 80 conexiones activas simultáneas (el pool PgBouncer de Supabase por defecto es 100).

### RLS denials

Las políticas RLS que rechazan acceso no generan entradas automáticas. Para detectar accesos rechazados, revisar:

```sql
-- En supabase_auth.audit_log_entries: intentos de acceso fallidos
select id, created_at, payload->>'action' as action, ip_address
from auth.audit_log_entries
where payload->>'action' = 'token_refreshed'
  and created_at > now() - interval '1 hour'
order by created_at desc;
```

Para bypass de RLS (BYPASSRLS activado inesperadamente), revisar `pg_roles`:

```sql
select rolname, rolbypassrls
from pg_roles
where rolbypassrls = true;
-- Esperado: solo postgres, service_role
```

---

## 3. Cron semanal — Supabase Advisors

### Script

`scripts/check-supabase-advisors.mjs` — ejecuta checks de performance + security vía Supabase Management API.

### Configuración GitHub Actions

Crear `.github/workflows/supabase-advisors.yml`:

```yaml
name: supabase-advisors

on:
  schedule:
    - cron: '0 8 * * 1'   # Lunes 08:00 UTC
  workflow_dispatch:

jobs:
  advisors:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Check Supabase Advisors
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
          SUPABASE_PROJECT_REF: ejacvsgbewcerxtjtwto
        run: node scripts/check-supabase-advisors.mjs
        continue-on-error: false   # falla el job si exit code != 0
```

### Exit codes

| Código | Significado | Acción |
|---|---|---|
| 0 | Sin issues | Ninguna |
| 1 | WARN advisors | Revisar en próxima ventana de mantenimiento |
| 2 | CRITICAL advisors | Crear ticket urgente + mitigar antes de siguiente deploy |

### Alert si CRITICAL > 0

El job fallido activa notificación por email a los maintainers del repo. Para Slack, agregar en el step:

```yaml
      - name: Slack alert on failure
        if: failure()
        uses: slackapi/slack-github-action@v1
        with:
          payload: '{"text":"CRITICAL: Supabase advisors detectaron issues en HIS. Revisar Actions."}'
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_OPS_WEBHOOK }}
```

---

## 4. Health endpoint `/api/health`

### Implementación

`apps/web/src/app/api/health/route.ts` — invoca `runHealthChecks()` de `@his/infrastructure/observability/health-check`.

### Checks

| Check | Qué verifica | Fallo |
|---|---|---|
| `db` | `SELECT 1` contra Postgres via Prisma | Timeout 4s o error de conexión |
| `auth` | `NEXTAUTH_SECRET` o `SUPABASE_JWT_SECRET` presente | Variable ausente |
| `rls` | `SET LOCAL "app.current_org_id"` + `current_setting` en transacción | GUC no funciona o tx falla |
| `supabase` | `GET /auth/v1/health` (HTTP 200) | Timeout 5s o HTTP != 200 |

### Respuesta

```json
{
  "status": "ok",
  "version": "abc1234",
  "uptimeSec": 3600,
  "timestamp": "2026-05-18T10:00:00.000Z",
  "checks": {
    "db": "ok",
    "auth": "ok",
    "rls": "ok",
    "supabase": { "status": "ok", "latencyMs": 45 }
  }
}
```

HTTP 200 si `status = ok | degraded`, HTTP 503 si `status = down`.

### Monitoreo externo

Configurar en Better Uptime / UptimeRobot:

- URL: `https://his.complejoavante.com/api/health`
- Intervalo: 1 minuto
- Alert on: HTTP != 200 por 2 checks consecutivos
- Canal: `#his-ops` + email on-call

---

## 5. Audit Hash Chain — Verificación nocturna

### Qué es

Toda escritura a tablas auditadas genera entrada en `audit.audit_log` con `chain_hash = SHA-256(prev_hash || payload_hash)`. Una ruptura en la cadena indica manipulación.

### Query de verificación

```sql
-- Verificar cadena por tabla (últimas 24h)
with ordered as (
  select
    id,
    table_name,
    chain_hash,
    prev_hash,
    payload_hash,
    created_at,
    lag(chain_hash) over (partition by table_name order by created_at) as expected_prev
  from audit.audit_log
  where created_at > now() - interval '24 hours'
),
broken as (
  select *
  from ordered
  where expected_prev is not null
    and prev_hash != expected_prev
)
select count(*) as broken_links from broken;
-- Esperado: 0
```

### Script nocturno

Incorporar en un GitHub Actions nightly (`schedule: '0 2 * * *'`):

```yaml
      - name: Audit hash chain check
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
        run: |
          node -e "
          const { Client } = require('pg');
          const client = new Client({ connectionString: process.env.DATABASE_URL });
          client.connect().then(async () => {
            const { rows } = await client.query(\`
              WITH ordered AS (
                SELECT chain_hash, prev_hash, created_at,
                  LAG(chain_hash) OVER (PARTITION BY table_name ORDER BY created_at) AS expected_prev
                FROM audit.audit_log
                WHERE created_at > now() - interval '24 hours'
              ),
              broken AS (SELECT * FROM ordered WHERE expected_prev IS NOT NULL AND prev_hash != expected_prev)
              SELECT COUNT(*)::int AS broken FROM broken
            \`);
            const broken = rows[0].broken;
            if (broken > 0) {
              console.error('AUDIT CHAIN BROKEN: ' + broken + ' links');
              process.exit(2);
            }
            console.log('Audit chain OK');
            process.exit(0);
          }).catch(e => { console.error(e.message); process.exit(2); });
          "
```

Alert si el job falla: mismo webhook Slack `#his-ops`.

---

## 6. SLOs definidos

| SLO | Métrica | Objetivo | Medición |
|---|---|---|---|
| Bedside 5 Correctos | P95 latencia endpoint validación | < 200ms | Vercel Analytics / custom metric |
| tRPC mutations | P95 latencia (create/update) | < 500ms | Vercel Speed Insights + logs |
| Vercel build | Duración build en CI | < 5 min | GitHub Actions job duration |
| Audit log writes | P95 latencia INSERT audit_log | < 100ms | Supabase Logs → postgres_logs |
| Disponibilidad | HTTP 200 en /api/health | 99.5% mensual | Better Uptime |

### Error budgets (30 días)

| SLO | 99.5% budget | Burn rate alert |
|---|---|---|
| Disponibilidad | 3.6 horas downtime/mes | Alert si > 36 min en 1h |
| Bedside < 200ms | 0.5% requests sobre umbral | Alert si > 2% en 5 min |
| tRPC < 500ms | 0.5% mutations sobre umbral | Alert si > 2% en 5 min |

### Dashboard Grafana / Vercel

Para el período pre-Grafana (solo Vercel + Supabase):
- Vercel → Analytics: Web Vitals + RUM
- Vercel → Functions: duración promedio por ruta
- Supabase → Reports: query performance, connection counts
- GitHub Actions: historial de health checks + advisors

Cuando se implemente Prometheus/Grafana (Fase BI), migrar SLO tracking a recording rules + alertmanager.

---

## 7. DORA Metrics — baseline go-live

| Métrica DORA | Objetivo MVP | Cómo medir |
|---|---|---|
| Deployment Frequency | 1/semana | GitHub Actions: `deploy-production` job count |
| Lead Time for Changes | < 3 días PR → prod | GitHub: PR merge time + Vercel deploy time |
| Change Failure Rate | < 10% | deploys que generan hotfix o rollback / total deploys |
| MTTR | < 4h | desde alert en #his-ops hasta health check verde |

Baseline a revisar en primera retrospectiva post go-live (30 días).
