# Observabilidad — HIS Multipaís

**Stack MVP actual:** Vercel Analytics + Sentry + UptimeRobot (externo).
**Stack objetivo (Fase 7 / K8s):** Prometheus + Grafana + Loki + Tempo (OpenTelemetry).

---

## Archivos

| Archivo | Descripción |
|---|---|
| `grafana-dashboard-api-latency.json` | Dashboard Grafana — RED metrics + SLO gauges |
| `prometheus-alerts.yaml` | PrometheusRule — alertas SLO-1/2/3/4 + seguridad |

---

## Importar dashboard a Grafana

**Grafana Cloud (managed):**
1. Abrir Grafana → Dashboards → Import.
2. Upload `grafana-dashboard-api-latency.json`.
3. Seleccionar datasource Prometheus en el dropdown `DS_PROMETHEUS`.
4. Clic Import.

**Grafana self-hosted con provisioning:**
```bash
cp infra/observability/grafana-dashboard-api-latency.json \
   /etc/grafana/provisioning/dashboards/his-api-latency.json
# Reiniciar Grafana o esperar el intervalo de scan (default: 10s)
```

---

## Aplicar alertas Prometheus

**Con Prometheus Operator (K8s):**
```bash
kubectl apply -f infra/observability/prometheus-alerts.yaml
# Verificar que el PrometheusRule fue detectado:
kubectl get prometheusrule -n his-avante
```

**Prometheus self-hosted (sin Operator):**
1. Copiar el contenido del bloque `spec.groups` al archivo `rules/his-avante.yml`.
2. Recargar config: `curl -X POST http://localhost:9090/-/reload`.

**Grafana Managed Alerting:**
1. Grafana → Alerting → Alert rules → Import.
2. Pegar las reglas del bloque `spec.groups` adaptadas al formato Grafana (ver docs Grafana Alerting).

---

## Métricas custom requeridas en `/api/metrics`

Las alertas y el dashboard asumen estas métricas en el endpoint Prometheus (`apps/web/src/app/api/metrics/route.ts`):

| Métrica | Tipo | Labels | Ya existe |
|---|---|---|---|
| `his_http_requests_total` | Counter | `status` | No (TODO Sprint 6) |
| `his_db_latency_ms` | Histogram | — | Parcial (gauge en MVP) |
| `his_db_up` | Gauge | — | Sí |
| `his_supabase_up` | Gauge | — | Sí |
| `his_trpc_mutation_duration_ms` | Histogram | `procedure` | No (TODO Sprint 6) |
| `his_rls_bypass_attempts_total` | Counter | — | No (TODO Sprint 6) |
| `his_auth_failures_total` | Counter | — | No (TODO Sprint 6) |

Las métricas "No" deben implementarse en Sprint 6 para que las alertas sean funcionales.
Mientras tanto, las alertas se pueden evaluar manualmente contra Sentry + Vercel Analytics.

---

## Integracion con notificaciones

Configurar en Grafana → Alerting → Contact points:

| Canal | Condicion |
|---|---|
| Slack `#his-alerts` | Todos los severity: warning + critical |
| Email `oncall@avante.com` | severity: critical |
| PagerDuty / WhatsApp (via webhook) | severity: critical en horario nocturno |

---

## DORA metrics (referencia)

Calcular mensualmente vía GitHub Actions / Vercel Analytics:

| Métrica DORA | Fuente | Target HIS |
|---|---|---|
| Deployment frequency | GitHub releases / Vercel deploys | Semanal → Diaria en Fase 7 |
| Lead time for changes | PR open → merge → deploy | < 2 días |
| Change failure rate | Rollbacks / total deploys | < 5% |
| MTTR | Incident open → resolved | < 1h (P1), < 4h (P2) |
