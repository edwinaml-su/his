# 40 — Performance Testing k6: Runbook

> Área: QA Performance | Estado: activo | Actualizado: 2026-05-29

---

## ¿Qué es k6 y por qué lo usamos?

k6 es una herramienta de performance testing open-source de Grafana Labs. Lo usamos para detectar regresiones de latencia en los endpoints críticos del HIS antes de que impacten a los usuarios. El objetivo es identificar degradaciones, no romper el sistema — los VUs y duraciones son conservadores por diseño.

---

## Requisitos previos

- **Local:** Docker Desktop instalado y corriendo.
- **CI:** ninguno adicional — el workflow `perf-k6.yml` instala k6 vía apt.
- **Credenciales:** variables de entorno definidas (ver sección Credenciales).

---

## Credenciales requeridas

Nunca se hardcodean en los scripts. Se pasan via env vars:

| Variable           | Descripción                                    | Ejemplo                                  |
|--------------------|------------------------------------------------|------------------------------------------|
| `K6_USER_EMAIL`    | Email del usuario de prueba                    | `qa.admin@his.test`                      |
| `K6_USER_PASSWORD` | Password del usuario de prueba                 | `TestPass123!`                           |
| `SUPABASE_URL`     | URL base de Supabase                           | `https://ejacvsgbewcerxtjtwto.supabase.co` |
| `SUPABASE_ANON_KEY`| Anon key pública de Supabase                   | `eyJ...` (desde Supabase dashboard)      |
| `BASE_URL`         | URL target de la app                           | `https://his.complejoavante.com`         |

En CI estos valores vienen de los secrets del repo: `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

---

## Cómo correr local (Docker)

```bash
# 1. Exportar credenciales (una sola vez en la sesión)
export K6_USER_EMAIL="qa.admin@his.test"
export K6_USER_PASSWORD="TestPass123!"
export SUPABASE_URL="https://ejacvsgbewcerxtjtwto.supabase.co"
export SUPABASE_ANON_KEY="eyJ..."

# 2. Correr un scenario
./scripts/run-k6.sh smoke

# 3. Con URL personalizada (ej. Vercel preview)
BASE_URL=https://his-pr-123.vercel.app ./scripts/run-k6.sh triage

# 4. Sobreescribir VUs y duración
VUS=2 DURATION=15s ./scripts/run-k6.sh auth
```

---

## Cómo correr en CI (GitHub Actions)

1. Ir a **Actions** → **Performance k6** en el repo.
2. Click **Run workflow**.
3. Completar los inputs:
   - `base_url`: URL target. Default: producción. Cambiar a URL de Vercel preview para PRs.
   - `scenario`: seleccionar de la lista o `all`.
   - `vus`: VUs (default del script si se deja vacío).
   - `duration`: duración (default del script si se deja vacío).
4. Los resultados se suben como artefacto `k6-results-<scenario>-<run_id>`.

---

## Scenarios disponibles

| # | Nombre | Script | VUs | Duración | Hot path |
|---|--------|--------|-----|----------|----------|
| 01 | smoke | `01-smoke.js` | 1 | 30s | `/` y `/login` |
| 02 | auth | `02-auth-baseline.js` | 5 | 1m | Supabase Auth login |
| 03 | triage | `03-triage-queue.js` | 10 | 2m | `triage.listPending` |
| 04 | bed-map | `04-bed-map-read.js` | 20 | 2m | `bed.getMap` |
| 05 | bcma | `05-bcma-validate.js` | 10 | 2m | `bedside.validate5Correctos` |
| 06 | portal | `06-portal-paciente.js` | 5 | 2m | `portal.labResults.list` |

---

## Thresholds y qué significan

| Threshold | Valor | Significado |
|-----------|-------|-------------|
| `http_req_duration p(95)` | < 1500ms (general), < 800ms (auth) | El 95% de los requests deben completar bajo ese tiempo |
| `http_req_duration p(99)` | < 3000ms | El 99% bajo 3s — detecta outliers |
| `http_req_failed rate` | < 1% | Menos del 1% de requests pueden fallar (error de red o status >= 400) |
| `checks rate` | > 99% | Más del 99% de las verificaciones de negocio deben pasar |

Si **cualquier threshold se incumple**, el workflow falla y GitHub Actions reporta el run como failure.

---

## Cómo interpretar el output de k6

```
✓ status 200 (100%)
✓ sin error tRPC (100%)

http_req_duration.............: avg=234ms  min=102ms  med=198ms  max=1.2s  p(90)=389ms  p(95)=512ms
http_req_failed...............: 0.00%  ✓ 0  ✗ 0
checks........................: 100.00% ✓ 840  ✗ 0
```

- **p(95) y p(99)**: los percentiles más importantes. Un spike en p(99) puede indicar queries lentas esporádicas.
- **http_req_failed 0%**: sin errores de red ni HTTP 4xx/5xx.
- **checks 100%**: toda la lógica de negocio validada correctamente.

Los artefactos `k6-summary.json` contienen los valores numéricos crudos para comparación histórica.

---

## Cuándo correr cada scenario

| Scenario | Cuándo correrlo | URL recomendada |
|----------|-----------------|-----------------|
| smoke | Antes de cualquier otro scenario; pre-merge crítico | Vercel preview del PR |
| auth | Nightly contra staging cuando exista | Staging |
| triage | Nightly o pre-release | Staging |
| bed-map | Pre-release (alta carga de lectura) | Staging |
| bcma | **Obligatorio pre-release** — SLO clínico crítico | Staging |
| portal | Nightly una vez portal esté en UAT | Staging |
| all | Release candidates — antes de go-live | Staging |

**Regla**: nunca correr `all` contra producción sin autorización explícita del responsable de operaciones.

---

## Política de regresión

1. Si un threshold falla en **una sola ejecución** → investigar, puede ser ruido puntual.
2. Si un threshold falla en **dos ejecuciones consecutivas** del mismo scenario → bug de performance. Abrir issue con label `perf-regression`, severidad según endpoint:
   - `bedside.validate5Correctos` o `triage.listPending` → **P1** (afecta flujo clínico).
   - `bed.getMap` → **P2**.
   - auth baseline → **P2**.
   - smoke → **P0** (la app no responde).
3. El bug bloquea el merge del PR causante si se identifica en `git bisect`.

---

## Backlog y próximos pasos

- [ ] Staging dedicado (Vercel + Supabase branch) para correr nightly automático.
- [ ] Scenario de carga `07-concurrent-admits.js` — 50 VUs admisiones simultáneas.
- [ ] Scenario de stress ramp-up `08-stress.js` — rampa de 1 a 100 VUs en 10 min.
- [ ] Integración con Grafana Cloud k6 para métricas históricas y tendencias.
- [ ] Alert automático en Slack si p95 supera threshold por 2 runs via cron nightly.
