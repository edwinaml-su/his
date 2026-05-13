# Runbook Técnico de Cutover — HIS Avante Wave 1

**Owner:** @SRE Lead (responsible) · @PO + Clinical Lead (informed)
**Versión:** 1.0 · 2026-05-13
**Estado:** Diseño (NO ejecutable hasta cierre de Bloque 1)
**Ventana objetivo:** Sábado T+0, 02:00–04:00 hora El Salvador (UTC-6)
**Duración total target:** 2 horas
**Producción objetivo:** Vercel + Supabase `sa-east-1`

> Este runbook contiene los comandos exactos del cutover, secuencia,
> validaciones intermedias, rollback y métricas SLO target.
> Complementa `docs/23_golive_plan.md` (plan estratégico) y `docs/18_golive_checklist.md` (checklist).

---

## 1. Pre-condiciones de ejecución

Antes de ejecutar este runbook, validar que TODO lo siguiente es verdadero:

1. Bloque 1 manual de Edwin completado: credenciales rotadas, branch protection activa, Vercel env poblado.
2. `git status` en `main` → working tree clean.
3. CI verde en `main` (último commit con todos los checks pasados).
4. Dry-run ejecutado T-3d sin incidentes mayores.
5. Backup pre-cutover etiquetado `pre-golive-final` existe.
6. War room activo con: @SRE on-call, @SRE backup, @DBA, @PO, Clinical Lead, 1 super-usuario por servicio.
7. Personal de turno noche informado y disponible para validación clínica T+1:30.
8. Modo papel preparado (formularios pre-impresos, sellos, lapiceros).

## 2. Pre-deploy checks (T-30 min antes de T+0)

```bash
# 2.1 Verificar estado main
git fetch origin
git checkout main
git pull --ff-only origin main
git log -1 --format='%H %s'

# 2.2 Verificar CI último commit
gh run list --branch main --limit 1
# Esperado: "completed success" en última corrida

# 2.3 Verificar Vercel env variables presentes
vercel env ls production
# Esperado: lista incluye DATABASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_ROLE_KEY, NEXTAUTH_SECRET, AUDIT_HASH_SECRET,
# SENTRY_DSN, SENTRY_AUTH_TOKEN, NEXT_PUBLIC_*

# 2.4 Verificar Supabase advisors sin CRITICAL
# (vía MCP supabase__get_advisors en su defecto vía dashboard)

# 2.5 Verificar Sentry stage recibiendo eventos
curl -s https://stage.avante-his.com/api/health-debug/sentry-test
# Esperado: 200 OK con event_id devuelto, confirmar en dashboard Sentry

# 2.6 Verificar Better Uptime stage en UP
curl -s https://betteruptime.com/api/v2/monitors | jq '.data[] | select(.attributes.url | contains("stage"))'

# 2.7 Ejecutar smoke gated production-readiness
pnpm --filter @his/web test:smoke:production-readiness
```

**Gate:** todos los checks deben pasar. Si alguno falla, NO proceder y escalar a @SRE Lead.

## 3. Backup final pre-cutover (T+0:00 → T+0:05)

```bash
# 3.1 Activar maintenance mode
vercel env add MAINTENANCE_MODE production
# Valor: true
vercel env add MAINTENANCE_BANNER_MSG production
# Valor: "Sistema en mantenimiento programado. Reapertura 04:00. Usar formularios papel."

# 3.2 Trigger Supabase backup manual + tag
# (vía dashboard o CLI; documentar manifest_id)
supabase db backup create --project-ref <prod-ref> --label pre-golive-final
# Validar:
supabase db backup list --project-ref <prod-ref> | head -3

# 3.3 Snapshot último DEPLOYMENT_ID READY (para rollback)
vercel inspect <prod-deployment-url> --format json | jq '.id' > /tmp/pre-golive-deployment-id.txt
cat /tmp/pre-golive-deployment-id.txt
# Guardar en sobre cerrado en war room
```

## 4. Migración de datos legacy (T+0:05 → T+0:45)

```bash
# 4.1 Verificar script migración ya validado en dry-run T-3d
ls -la packages/database/scripts/migrate-legacy/
# Esperado: scripts existen, idempotentes, con --dry-run flag

# 4.2 Ejecutar migración en dry-run primero (5 min)
NODE_ENV=production DATABASE_URL=$PROD_DB_URL \
  pnpm --filter @his/database migrate:legacy -- --dry-run > /tmp/migrate-dry-run.log
tail -50 /tmp/migrate-dry-run.log
# Validar: 0 errores, conteos esperados

# 4.3 Ejecutar migración real
NODE_ENV=production DATABASE_URL=$PROD_DB_URL \
  pnpm --filter @his/database migrate:legacy > /tmp/migrate-real.log
tail -50 /tmp/migrate-real.log
# Validar: success, sin warnings rojos
```

### 4.1 Validación de conteos vs origen

```sql
-- Ejecutar en Supabase SQL Editor
-- Comparar contra dump del sistema legacy

SELECT 'patient' as entity, COUNT(*) FROM public.patient
UNION ALL
SELECT 'encounter', COUNT(*) FROM public.encounter
UNION ALL
SELECT 'user', COUNT(*) FROM public."user"
UNION ALL
SELECT 'organization', COUNT(*) FROM public.organization
UNION ALL
SELECT 'establishment', COUNT(*) FROM public.establishment;
```

**Gate:** conteos coinciden con origen ±0 (cero discrepancias permitidas). Si difiere, ABORTAR y rollback.

## 5. Promoción del deploy (T+1:00 → T+1:10)

```bash
# 5.1 Identificar último deployment READY en preview
vercel ls --prod=false | head -5

# 5.2 Promote a producción
vercel promote <preview-deployment-id> --prod
# Validar mensaje: "Deployment promoted to production"

# 5.3 Verificar nuevo deployment activo
vercel inspect $(vercel ls --prod=true | head -2 | tail -1 | awk '{print $1}')
# Esperado: state=READY, target=production

# 5.4 Cache purge CDN
vercel domains inspect app.avante-his.com
# Si hay CDN externo: trigger purge correspondiente
```

## 6. DNS warm-up + smoke (T+1:10 → T+1:30)

```bash
# 6.1 Warm-up múltiples regiones
for region in us-east-1 us-west-2 sa-east-1; do
  echo "=== $region ==="
  curl -s -w "%{http_code} %{time_total}s\n" -o /dev/null \
    https://app.avante-his.com/api/health
done
# Esperado: 200 en todas, < 2s

# 6.2 Smoke automatizado
SMOKE_BASE_URL=https://app.avante-his.com \
  pnpm --filter @his/web test:smoke:production
# Esperado: 12 endpoints críticos 200 OK

# 6.3 Verificar audit chain intacta
curl -s https://app.avante-his.com/api/admin/audit/verify-chain \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
# Esperado: { "intact": true, "last_verified": "<timestamp>" }
```

## 7. Apertura a usuarios (T+1:45 → T+2:00)

```bash
# 7.1 Desactivar maintenance mode
vercel env rm MAINTENANCE_MODE production --yes
vercel env rm MAINTENANCE_BANNER_MSG production --yes

# 7.2 Forzar redeploy para tomar nuevas env vars
vercel redeploy --prod

# 7.3 Verificar apertura
curl -I https://app.avante-his.com/
# Esperado: 200 OK, sin header MAINTENANCE-MODE

# 7.4 Smoke clínico guiado (manual con super-usuario)
# - Admisión: 1 paciente real
# - Triage: 1 caso ESI-3
# - CPOE: 1 prescripción simple
# - LIS: 1 orden de hemograma
# Tiempo target: 10 min
```

## 8. Post-deploy validación (T+2:00 → T+3:00)

### 8.1 Sentry funcional

```bash
# Forzar evento de test
curl -X POST https://app.avante-his.com/api/admin/health-debug/sentry-test \
  -H "Authorization: Bearer $ADMIN_TOKEN"
# Validar en dashboard Sentry: evento aparece en proyecto his-web con env=production
```

### 8.2 Better Uptime monitores

- `app.avante-his.com/api/health` — UP desde 3 regiones
- `app.avante-his.com/api/metrics` — UP
- `status.avante-his.com` — accesible públicamente
- Webhook → Slack `#sre-his` recibió alerta de prueba

### 8.3 Vercel Analytics + Speed Insights

- Web Vitals reportando LCP, FID, CLS
- Speed Insights mostrando p95 por ruta
- VERCEL_API_TOKEN scope `read:analytics` confirmado

## 9. Métricas SLO target Wave 1 MVP

| SLO ID | Métrica | Target Wave 1 | Cómo se mide |
|---|---|---|---|
| SLO-1 | Disponibilidad app | ≥ 99.5% mensual | Better Uptime + Sentry uptime |
| SLO-2 | Latencia p95 mutations tRPC | ≤ 500ms | Sentry Performance op:http.server |
| SLO-3 | Latencia p95 queries tRPC | ≤ 300ms | Sentry Performance |
| SLO-4 | Tasa de error 5xx | ≤ 0.5% requests | Sentry + Vercel logs |
| SLO-5 | Audit chain integrity check | 100% pasa diario | Cron `audit-integrity-check` |
| SLO-6 | Time to ack critical lab value | < 30 min p95 | LIS `critical_value_notification` |
| SLO-7 | Backup success rate | 100% diarios | Supabase backups |
| SLO-8 | PITR recovery time | < 4h drill | Drill trimestral |
| SLO-9 | Pen-test critical findings | 0 abiertos | Auditoría trimestral |
| SLO-Echo-1 | Webhook outbox lag p95 | < 60s | DomainEvent `processedAt - createdAt` |
| SLO-Echo-2 | CronJob success rate | ≥ 99% | `cron_run` success/total |
| SLO-MVP-12 | Login success rate | ≥ 99% | NextAuth events |

Detalle en `docs/13_slos_kpis.md`.

## 10. Sentry alerts threshold setup

5 alertas mínimas Wave 1 (ver `docs/sdlc/wave2-slo-wiring-plan.md` §5):

### 10.1 SLO-1 disponibilidad fast burn

```yaml
trigger: error_rate > 5% por 1h
window: 1h
notify: PagerDuty + Slack #sre-his
severity: SEV1
```

### 10.2 SLO-1 disponibilidad slow burn

```yaml
trigger: error_rate > 1% por 6h sostenido
window: 6h
notify: Slack #sre-his
severity: SEV2
```

### 10.3 SLO-3 latencia queries fast burn

```yaml
trigger: p95 > 1000ms por 1h
window: 1h
notify: Slack #sre-his
severity: SEV2
```

### 10.4 SLO-4 error rate fast burn

```yaml
trigger: 5xx_rate > 5% por 15min
window: 15min
notify: PagerDuty + Slack #sre-his
severity: SEV1
```

### 10.5 SLO-Echo-1 outbox lag

```yaml
trigger: max_lag > 5min por 30min
window: 30min
notify: Slack #sre-his
severity: SEV3
```

Cada alerta se testea con disparo manual en T-1d.

## 11. Rollback procedure

### 11.1 Cuándo activar rollback

Cualquiera de:

- SEV1 confirmado > 30 min sin remedio.
- Smoke clínico falla en T+1:30 con datos comprometidos.
- Audit chain ROTA detectada por verify post-deploy.
- Validación de conteos T+0:45 con discrepancia > 0.
- 2 de 3 leads (PO, SRE, Clinical Lead) deciden rollback.

### 11.2 Procedimiento

```bash
# 11.2.1 Activar maintenance mode inmediato
vercel env add MAINTENANCE_MODE production
# Valor: true
vercel env add MAINTENANCE_BANNER_MSG production
# Valor: "Rollback en curso. Usar formularios papel."
vercel redeploy --prod

# 11.2.2 Revertir Vercel a deployment pre-cutover
PREV_DEPLOY=$(cat /tmp/pre-golive-deployment-id.txt)
vercel rollback $PREV_DEPLOY --prod
# Validar: el deployment activo es el previo

# 11.2.3 Restaurar Supabase desde backup pre-golive-final
# (vía dashboard, requiere confirmación dual)
# Tiempo target restore: < 30 min para BD < 50GB

# 11.2.4 Verificar conteos post-restore vs pre-cutover
# (mismas queries de §4.1)

# 11.2.5 Desactivar maintenance mode
vercel env rm MAINTENANCE_MODE production --yes
vercel env rm MAINTENANCE_BANNER_MSG production --yes
vercel redeploy --prod

# 11.2.6 Comunicar a stakeholders (plantilla T+0 rollback)
# Email + WhatsApp directiva: "Rollback ejecutado por <razón>. Sistema operativo en versión anterior."
```

### 11.3 Después del rollback

- War room queda activo 6h adicionales.
- Postmortem ejecutivo en T+24h con root cause y plan de remediación.
- Replanificación de Go-Live para siguiente sábado (T+7) si root cause se remedia, T+14 si no.

## 12. Incident response runbook reference

Para incidentes durante hipercuidado (T+0 a T+14d), aplicar el runbook completo en `docs/17_hipercuidado_runbook.md`.

Resumen de SEV:

- **SEV1:** Sistema caído o datos comprometidos → PagerDuty + WhatsApp directiva inmediato.
- **SEV2:** Funcionalidad crítica degradada (login, CPOE, eMAR) → Slack #sre-his + on-call response < 15 min.
- **SEV3:** Funcionalidad no-crítica degradada → ticket Linear, response < 4h.
- **SEV4:** Bug menor o cosmético → ticket Linear, response NB business day.

## 13. Comandos rápidos para war room (cheat sheet)

```bash
# Estado deploy actual
vercel ls --prod=true | head -3

# Logs en vivo
vercel logs --follow

# Métricas DB
supabase db inspect --project-ref <prod-ref>

# Verificar audit chain manual
psql $DATABASE_URL -c "SELECT public.fn_verify_audit_chain(NOW() - INTERVAL '1 hour', NOW());"

# Conteo de errores última hora
psql $DATABASE_URL -c "SELECT count(*) FROM public.domain_event WHERE event_type LIKE '%Error%' AND created_at > NOW() - INTERVAL '1 hour';"

# Conteo de logins última hora
psql $DATABASE_URL -c "SELECT count(*) FROM public.audit_log WHERE entity = 'User' AND action = 'LOGIN' AND created_at > NOW() - INTERVAL '1 hour';"
```

## 14. Post-mortem template (si aplica)

Si hay incidente SEV1/SEV2 durante el cutover, post-mortem dentro de 48h con:

1. Resumen ejecutivo (1 párrafo)
2. Timeline de eventos
3. Impacto (usuarios afectados, tiempo, datos)
4. Root cause analysis (5-whys)
5. Lo que funcionó bien
6. Lo que no funcionó
7. Acciones de remediación con owner + deadline
8. Lecciones para próximo Go-Live

Plantilla: `docs/sdlc/templates/postmortem-template.md` (a crear T-7d).

## 15. Anexos

- `docs/18_golive_checklist.md` — checklist tick-by-tick
- `docs/23_golive_plan.md` — plan estratégico
- `docs/15_production_runbook.md` — runbook producción general
- `docs/17_hipercuidado_runbook.md` — runbook 14d hipercuidado
- `docs/22_smoke_production.md` — suite smoke Playwright
- `scripts/golive-checklist.sh` — script automatizado

---

**Owner final:** @SRE Lead. Aprueba ejecución: @PO + Clinical Lead + @SRE Lead (unanimidad).
