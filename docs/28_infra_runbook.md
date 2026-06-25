# 28 — Runbook de Infraestructura (IaC + Operación)

**Proyecto:** HIS Multipaís — Inversiones Avante
**Autor:** @SRE — Site Reliability Engineer
**Versión:** 1.0 — 2026-05-16 (Wave SRE · Fase 6)
**Complementa:** `docs/15_production_runbook.md` (deploy + rollback), `docs/17_hipercuidado_runbook.md` (post go-live).

> Este documento cubre la **infraestructura como código** (Terraform, K8s, Docker) y los procedimientos operativos de la capa de plataforma. Para incidentes de aplicación y rollback Vercel ver `docs/15_production_runbook.md`.

---

## 1. Topología actual (MVP)

```
Internet
   │
   ▼
Cloudflare DNS (Free, 100% SLA)
   │
   ├──► Vercel (Edge + Node runtime)
   │      └── apps/web (Next.js 14 + tRPC v11)
   │            ├── /api/health          → healthcheck
   │            ├── /api/metrics         → Prometheus scrape endpoint
   │            └── /api/trpc/*         → routers (45+)
   │
   ├──► Supabase (sa-east-1 / Sao Paulo)
   │      ├── Postgres 15 (RLS + audit chain)
   │      ├── Auth (JWT, RLS claims)
   │      └── Storage (patient-documents — privado)
   │
   ├──► Sentry (us-east-1) — Errors + APM
   ├──► Resend — Email transaccional (notificaciones, alertas clínicas)
   └──► UptimeRobot — probe externo cada 60s desde 3 regiones

Opciones futuras (Fase 7 / self-host):
   ├──► K8s (EKS/GKE/on-prem) — manifests en infra/k8s/
   └──► Prometheus + Grafana — alertas en infra/observability/
```

| Componente | Proveedor | Plan | SLA vendor | Región |
|---|---|---|---|---|
| Compute | Vercel | Pro | 99.99% | iad1 (auto) |
| Postgres + Auth | Supabase | Pro ($25/mes) | 99.9% | sa-east-1 |
| DNS | Cloudflare | Free | 100% | Global |
| Errors/APM | Sentry | Team | 99.95% | us-east-1 |
| Email | Resend | Pro | 99.9% | us-east-1 |
| Uptime probe | UptimeRobot | Free | n/a | Multi-región |

---

## 2. SLOs propuestos (operacionales)

Referencia completa en `docs/13_slos_kpis.md`. Resumen operativo:

| SLO | SLI | Target | Alert | Fuente |
|---|---|---|---|---|
| SLO-1 Disponibilidad | Uptime `/api/health` | 99.5% / 30d | < 99.0% en 1h | UptimeRobot |
| SLO-2 Latencia health | p95 `/api/health` | < 500ms | > 700ms / 15min | Vercel Analytics |
| SLO-3 Latencia mutations | p95 tRPC mutations | < 1500ms | > 2000ms / 15min | Sentry transactions |
| SLO-4 Error rate | 5xx / total requests | < 0.5% / 28d | > 1.0% / 5min | Sentry + Vercel |
| SLO-8 RPO | Min desde último backup | ≤ 15 min | > 30 min sin backup | Supabase WAL |
| SLO-9 RTO | Horas para restaurar | ≤ 4 h | DR drill > 6h | Runbook execution log |

**Error budget policy:**
- Consumo > 50% → revisión en comité semanal.
- Consumo > 80% → freeze de releases de bajo impacto.
- Consumo > 100% → postmortem obligatorio + sprint dedicado.

---

## 3. Deploy a producción (vía Vercel — flujo MVP)

> Flujo completo en `docs/15_production_runbook.md §4`. Resumen:

```
PR con CI verde → Squash merge a main → Vercel auto-deploy (~4 min)
   └── Si hay migración SQL:
         workflow_dispatch db-migrate.yml (required reviewer) → prisma migrate deploy
```

**Verificación post-deploy:**
```bash
curl -s https://sv.avante-his.com/api/health | jq .
# Esperado: { "status": "ok", "checks": { "db": { "status": "ok" } } }
```

**Smoke automático (planificado):** hook post-deploy Vercel que llama `/api/health` y aborta si falla.

---

## 4. Aplicar migraciones SQL

Las migraciones del HIS son archivos SQL numerados en `packages/database/sql/`, aplicados vía Supabase MCP o SQL Editor — **no** `prisma migrate dev` contra producción.

### 4.1 Flujo estándar (Supabase MCP)

```bash
# Desde el agente con acceso al MCP configurado:
mcp__supabase__apply_migration
  name: "XX_descripcion"
  query: "<contenido del archivo sql>"
```

### 4.2 Flujo alternativo (Supabase SQL Editor)

1. Abrir `supabase.com/dashboard → SQL Editor`.
2. Pegar contenido de `packages/database/sql/XX_nombre.sql`.
3. Ejecutar. Si hay error: no reintentes — analiza el error primero.

### 4.3 Rollback de migración

No existe "rollback automático" de SQL. Para revertir:

1. Escribir el SQL inverso (ALTER TABLE, DROP COLUMN, etc.) como un nuevo archivo: `packages/database/sql/XX_rollback_descripcion.sql`.
2. Aplicar el reverse SQL vía MCP o SQL Editor.
3. Documentar en el commit y en `docs/incidents/`.

> **REGLA:** nunca aplicar DROP sin snapshot PITR previo. Verificar backup en Supabase Dashboard → Database → Backups antes de DDL destructivo.

---

## 5. Rotación de secrets

| Secret | Cadencia | Procedimiento |
|---|---|---|
| `AUTH_SECRET` | 6 meses | 1. `openssl rand -base64 32` → 2. Actualizar Vercel env → 3. Redeploy → 4. Verificar `/api/health`. Invalida sesiones activas. |
| `SUPABASE_SERVICE_ROLE_KEY` | 6 meses | Supabase Dashboard → API → Reset. Actualizar Vercel. Redeploy. |
| `SUPABASE_JWT_SECRET` | Solo si compromiso | Ventana de mantenimiento 30 min. Invalida todos los JWTs. |
| `DATABASE_URL` password | 12 meses | Supabase → Database → Reset password. Actualizar Vercel + `DIRECT_URL`. |
| `AUDIT_HASH_SECRET` | NUNCA | Inmutable. Rotarlo rompe la verificación de la cadena criptográfica histórica. Solo si breach documentado y postmortem aprobado. |
| `SENTRY_AUTH_TOKEN` | 12 meses | Sentry → Auth Tokens → Revoke + Create. Actualizar GitHub Secrets + Vercel. |
| Tokens TF (`TF_VAR_*`) | 12 meses | Revocar en Vercel/Supabase/GitHub → Crear nuevo → Actualizar en TF Cloud o GitHub Env. |

**Procedimiento estándar (no destructivo):**
1. Generar nueva credencial.
2. Actualizar destino (Vercel env, GitHub secret, etc.).
3. Trigger redeploy o apply.
4. Verificar que funciona.
5. Revocar la vieja **después** de confirmar.
6. Documentar en `docs/security/credential-rotation-log.md`.

---

## 6. Incidente: 5xx spike

**Trigger:** error rate > 1% por 5 minutos (alerta `HIS5xxSpikeP2` en Prometheus / Sentry).

### Diagnóstico (< 5 min)

1. Verificar `/api/health`:
   ```bash
   curl -s https://sv.avante-his.com/api/health | jq .
   ```
2. Si falla: verificar Vercel Dashboard → Deployments → ver logs del último deploy.
3. Verificar Supabase Dashboard → Database → CPU/Connections. ¿Pico de conexiones?
4. Verificar Sentry → Issues nuevas en los últimos 15 min → agrupar por módulo.
5. Verificar si coincide con un deploy reciente (Vercel → deployments timestamps).

### Acciones

| Causa raíz probable | Acción |
|---|---|
| Bug en deploy reciente | Rollback Vercel: `vercel promote <DEPLOYMENT_ID>` |
| DB saturada / lock | Ver §7 (DB lock) |
| Supabase degraded | Ver https://status.supabase.com → activar maintenance mode si persiste |
| Spike de tráfico | Vercel escala automático — esperar 2 min; si persiste, contact Vercel support |
| Migration rota schema | Ver §4.3 (rollback migración) + §6 doc 15 (rollback BD) |

---

## 7. Incidente: DB lock / degradación Postgres

**Síntomas:** timeout en queries, Supabase Dashboard CPU > 90%, `pg_stat_activity` llena.

### Diagnóstico

```sql
-- Conexiones activas por estado
SELECT state, count(*) FROM pg_stat_activity GROUP BY state;

-- Queries bloqueadas o lentas (> 5 s)
SELECT pid, now() - query_start AS duration, query, state
  FROM pg_stat_activity
 WHERE state != 'idle'
   AND now() - query_start > interval '5 seconds'
 ORDER BY duration DESC
 LIMIT 20;

-- Locks activos
SELECT locktype, relation::regclass, mode, granted, pid
  FROM pg_locks
 WHERE NOT granted;
```

Ejecutar vía Supabase SQL Editor o `mcp__supabase__execute_sql`.

### Acciones

```sql
-- Cancelar query pesada (no destructivo)
SELECT pg_cancel_backend(<pid>);

-- Terminar conexión si pg_cancel no funciona (destructivo — usar con cuidado)
SELECT pg_terminate_backend(<pid>);
```

Si el pool está agotado: verificar Supabase → Database → Connection pooling → ajustar `pool_size` temporalmente desde dashboard.

---

## 8. Incidente: dispatcher backlog alto (> 100 eventos sin publicar)

**Síntomas:** notificaciones/alertas clínicas no llegan. Tabla `notification_event` con `published_at IS NULL`.

### Diagnóstico

```sql
SELECT count(*) AS pending
  FROM "notification_event"
 WHERE published_at IS NULL
   AND created_at < now() - interval '5 minutes';
```

### Acciones

1. Verificar pg_cron job del poller: `SELECT * FROM cron.job WHERE jobname = 'notification-poller';`
2. Si el job está deshabilitado: `SELECT cron.resume_job('notification-poller');`
3. Si hay error en el dispatcher: revisar logs de Supabase Edge Function o del worker correspondiente.
4. Fallback manual: ejecutar SQL directo para publicar los eventos pendientes (runbook específico en `docs/15_production_runbook.md §6`).

---

## 9. Incidente: email provider down (Resend)

**Síntomas:** notificaciones por email no llegan. Logs muestran `RESEND_SEND_FAILED`.

1. Verificar https://resend.com/status.
2. Si Resend está down: los eventos quedan en cola (tabla `notification_event`) — **no se pierden**.
3. Cuando Resend se recupere, el poller reintenta automáticamente (configurado con `retry_count`).
4. Si > 4 horas de outage: considerar proveedor fallback (SES directo) — requiere PR separado.
5. Comunicar a usuarios via WhatsApp grupo "HIS On-Call" que las notificaciones por email están demoradas.

---

## 10. Terraform — operación (Fase 7)

> Los archivos están en `infra/terraform/`. En MVP no está activo — ver `infra/terraform/README.md`.

### Comandos esenciales

```bash
cd infra/terraform

# Init (descarga providers, configura backend)
terraform init

# Plan contra producción
terraform plan -var-file=envs/production.tfvars

# Importar recursos existentes (primera vez)
terraform import module.vercel.vercel_project.his <VERCEL_PROJECT_ID>
terraform import module.supabase.supabase_project.his <SUPABASE_PROJECT_ID>

# Apply (requiere aprobación manual en pipeline, o confirmación interactiva)
terraform apply -var-file=envs/production.tfvars

# Ver outputs
terraform output
```

### Cuándo usar Terraform vs manual

| Operación | Via Terraform | Manual |
|---|---|---|
| Crear proyecto Vercel nuevo | Sí | No (drift) |
| Agregar env var en Vercel | Sí | OK en emergencia (luego sincronizar) |
| Rotación de secret | Manual primero, luego `terraform apply` para sync | OK |
| Crear proyecto Supabase nuevo | Sí | Solo si TF no está configurado |
| Aplicar SQL/RLS | NUNCA — TF no gestiona schema | Siempre via MCP/SQL Editor |
| Branch protection GitHub | Sí | No (drift) |

---

## 11. Kubernetes — operación (Fase 7 / self-hosted)

> Manifests en `infra/k8s/`. Ver `infra/k8s/README.md` para prerequisitos.

```bash
# Aplicar producción
kubectl apply -k infra/k8s/overlays/prod --dry-run=client   # primero dry-run
kubectl apply -k infra/k8s/overlays/prod

# Rolling restart (nueva imagen)
kubectl rollout restart deployment/his-web -n his-avante
kubectl rollout status deployment/his-web -n his-avante

# Escalar manualmente (temporal, HPA lo revertirá)
kubectl scale deployment/his-web --replicas=5 -n his-avante

# Ver logs últimas 1h
kubectl logs -n his-avante -l app.kubernetes.io/name=his-web --since=1h --tail=200

# Maintenance mode ON en K8s
kubectl patch configmap his-web-config -n his-avante \
  --type=merge -p '{"data":{"MAINTENANCE_MODE":"true"}}'
kubectl rollout restart deployment/his-web -n his-avante
```

---

## 12. DORA metrics — baseline

Medir mensualmente. Referencia: `infra/observability/README.md`.

| Métrica | Fuente | Baseline MVP | Target Fase 7 |
|---|---|---|---|
| Deployment frequency | Vercel deploys a producción | Semanal | Diaria |
| Lead time for changes | PR open → deploy producción | < 2 días | < 4 horas |
| Change failure rate | Rollbacks / total deploys | < 10% | < 5% |
| MTTR | Incident open → resolved (P1) | < 4 h | < 1 h |

---

## 13. Oncall y escalación

| Severidad | Quién responde | SLA respuesta | Canal |
|---|---|---|---|
| P1 (caída total / datos / breach) | SRE on-call + Dev on-call | < 15 min | WhatsApp "HIS On-Call" + Slack `#his-alerts` |
| P2 (módulo crítico degradado) | SRE on-call | < 1 h | Slack `#his-alerts` |
| P3 (funcionalidad menor) | Dev on-call | < 4 h | Slack `#his-alerts` |
| P4 (cosmético / consulta) | Backlog producto | < 24 h | GitHub Issues |

**Rotación oncall (placeholder):**
- Semana 1: Edwin Martinez (@emartinez)
- Semana 2: [por asignar]
- Escalación L3: SRE Lead → `oncall@avante.com`

---

## 14. Pendientes Fase 7

- [ ] Activar Terraform: importar recursos MVP + `terraform plan` verde + habilitar pipeline `terraform.yml`.
- [ ] Implementar External Secrets Operator en K8s (si se activa self-hosted).
- [ ] Implementar métricas custom faltantes en `/api/metrics` (ver `infra/observability/README.md §Métricas`).
- [ ] Configurar Grafana Cloud / self-hosted con el dashboard `grafana-dashboard-api-latency.json`.
- [ ] Aplicar PrometheusRule `prometheus-alerts.yaml` cuando Prometheus esté activo.
- [ ] Configurar contact points (Slack + email) en Grafana Alerting.
- [ ] Primer DR drill documentado (verificar RTO ≤ 4h — SLO-9).
- [ ] Pipeline `terraform.yml`: plan automático en PR + apply manual en merge.

---

## 15. Referencias cruzadas

| Doc | Contenido |
|---|---|
| `docs/13_slos_kpis.md` | Catálogo completo de SLOs/SLIs |
| `docs/15_production_runbook.md` | Deploy, rollback Vercel, rotación creds detallada |
| `docs/17_hipercuidado_runbook.md` | Operación 14 días post go-live |
| `docs/18_golive_checklist.md` | Gates pre go-live |
| `infra/terraform/README.md` | IaC Terraform — init/plan/apply |
| `infra/k8s/README.md` | K8s manifests — prerequisitos y comandos |
| `infra/observability/README.md` | Grafana + Prometheus — importar y configurar |
| `Dockerfile` (raíz) + `.github/workflows/release-image.yml` | Imagen multi-stage Next.js + build/push a GHCR |
