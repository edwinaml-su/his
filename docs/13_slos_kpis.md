# 13 — SLOs, SLIs y KPIs Clínicos del HIS

**Proyecto:** HIS Multipaís — Inversiones Avante
**Autor:** @SRE — Site Reliability Engineer (Equipo Papa, Sprint 5)
**Versión:** 1.0 — 2026-04-30
**Estado:** Activo desde MVP. Revisión mensual del error budget.

> **Push-back declarado:** El TDR §29.2 pide 99.9% de disponibilidad. Para MVP comprometemos
> **99.5%** hasta tener observabilidad madura, runbooks probados y al menos un postmortem
> real (alineado con `docs/08_devops.md` §1). El target sube a 99.9% al cerrar Fase 7.

---

## 1. Marco de referencia

Seguimos la nomenclatura SRE estándar (Google SRE Workbook):

- **SLI** (Service Level Indicator): métrica concreta y medible (e.g. p95 latency).
- **SLO** (Service Level Objective): objetivo cuantitativo sobre un SLI (e.g. p95 < 500 ms).
- **SLA**: contractual, externo. En MVP **no** firmamos SLA con el cliente — el SLO es interno.
- **Error budget**: 1 − SLO. Cuánto incumplimiento podemos absorber antes de pausar feature work.

**Ventana estándar:** 28 días rolling, salvo SLOs de continuidad (RPO/RTO) y disponibilidad
(30 días por el ciclo mensual del proveedor de uptime).

**Política de error budget:**
- Consumo > 50% → revisar incidentes recientes en el comité semanal.
- Consumo > 80% → freeze de releases de bajo impacto, foco en estabilidad.
- Consumo > 100% (breach) → postmortem obligatorio + sprint dedicado a mitigación.

---

## 2. Catálogo de SLOs (MVP)

### 2.1 SLO-1 · Disponibilidad de la aplicación
| Campo | Valor |
|---|---|
| **SLI** | % de checks de uptime exitosos sobre `/api/health` (probe externo cada 60s). |
| **Target** | 99.5% (≤ 21h45m de downtime / 30d) |
| **Error budget** | 0.5% mensual |
| **Ventana** | 30 días rolling |
| **Alert threshold** | < 99.0% en 1h de ventana, page on-call |
| **Fuente** | Better Uptime / Vercel uptime API (Sprint 6) — MVP: mock |
| **Justificación** | Equipo pequeño + sin runbooks probados. 99.9% requiere multi-región y probado DR. Subir a 99.9% al cerrar Fase 7. |

### 2.2 SLO-2 · p95 latencia `/api/health`
| Campo | Valor |
|---|---|
| **SLI** | Percentil 95 del tiempo de respuesta del endpoint `/api/health`. |
| **Target** | < 500 ms |
| **Error budget** | 28 días con > 5% requests fuera de target |
| **Ventana** | 28 días rolling |
| **Alert threshold** | p95 > 700 ms durante 15 min consecutivos |
| **Fuente** | Vercel Analytics (Sprint 6) — MVP: mock |
| **Justificación** | Healthcheck es proxy de salud BD + Supabase Auth. Latencia degradada precede caídas. |

### 2.3 SLO-3 · p95 latencia mutations tRPC
| Campo | Valor |
|---|---|
| **SLI** | Percentil 95 del tiempo de respuesta de procedimientos `mutation` (admisión, triage, vitales). |
| **Target** | < 1500 ms |
| **Error budget** | 5% de mutations sobre target en 28d |
| **Ventana** | 28 días rolling |
| **Alert threshold** | p95 > 2000 ms durante 15 min consecutivos |
| **Fuente** | Sentry transactions filtrando `op = http.server` y route `/api/trpc/*` (POST) |
| **Justificación** | Workflow clínico: admitir, triagear, registrar signos vitales no debe sentirse lento. Bottleneck más probable: RLS + multi-tenant joins. |

### 2.4 SLO-4 · Tasa de error 5xx
| Campo | Valor |
|---|---|
| **SLI** | (Eventos Sentry status ≥ 500) / (total requests excluyendo `/api/health`). |
| **Target** | < 0.5% |
| **Error budget** | 0.5% × total requests del mes |
| **Ventana** | 28 días rolling |
| **Alert threshold** | > 1.0% en 15 min, page on-call |
| **Fuente** | Sentry API + Vercel logs |
| **Justificación** | 0.5% es agresivo para HIS clínico. 5xx en escritura puede traducirse en doble admisión / paciente perdido. |

### 2.5 SLO-5 · Tasa de override de triage *(KPI clínico)*
| Campo | Valor |
|---|---|
| **SLI** | (Triages con override del ESI sugerido) / (total triages completados). |
| **Target** | < 10% |
| **Error budget** | N/A (es KPI calidad — no error budget puro) |
| **Ventana** | 28 días rolling |
| **Alert threshold** | > 15% sostenido 7 días → revisar reglas de triage con clínicos |
| **Fuente** | Tabla `triage_event` + flag `wasOverride` |
| **Justificación** | Si > 10%, las reglas no reflejan la realidad clínica — bug de modelo, no de plataforma. |

### 2.6 SLO-6 · Tiempo de admisión paciente conocido *(KPI clínico)*
| Campo | Valor |
|---|---|
| **SLI** | Mediana de minutos desde inicio admisión hasta confirmación, cuando MPI hit-rate = match. |
| **Target** | ≤ 3 min |
| **Error budget** | N/A (KPI proceso) |
| **Ventana** | 28 días rolling |
| **Alert threshold** | mediana > 5 min sostenida 3 días |
| **Fuente** | `admission_event` start/end timestamps + flag `mpiMatched` |
| **Justificación** | Clínico AE: paciente recurrente NO debe esperar. Tiempo > 3 min sugiere fricción UI o problema de búsqueda. |

### 2.7 SLO-7 · p95 búsqueda MPI
| Campo | Valor |
|---|---|
| **SLI** | Percentil 95 del tiempo de búsqueda determinística + fuzzy en Master Patient Index. |
| **Target** | < 300 ms |
| **Error budget** | 5% de búsquedas sobre target en 28d |
| **Ventana** | 28 días rolling |
| **Alert threshold** | p95 > 500 ms durante 15 min |
| **Fuente** | Custom span `mpi.search` en Sentry tracing |
| **Justificación** | UX crítico: el clínico escribe DUI y espera resultado. > 300 ms se siente "lag". |

### 2.8 SLO-8 · RPO (Recovery Point Objective)
| Campo | Valor |
|---|---|
| **SLI** | Minutos transcurridos entre el último backup exitoso y el momento actual. |
| **Target** | ≤ 15 min |
| **Error budget** | N/A (objetivo de continuidad) |
| **Ventana** | Continuo (snapshot horario) |
| **Alert threshold** | > 30 min sin backup exitoso |
| **Fuente** | Supabase WAL + nightly logical dump (ver `docs/08_devops.md` §6) |
| **Justificación** | Datos clínicos: pérdida > 15 min implica re-captura manual de signos vitales y notas. |

### 2.9 SLO-9 · RTO (Recovery Time Objective)
| Campo | Valor |
|---|---|
| **SLI** | Horas para restaurar servicio tras incidente catastrófico (medido en último DR drill). |
| **Target** | ≤ 4 h |
| **Error budget** | N/A |
| **Ventana** | 90 días (DR drill trimestral) |
| **Alert threshold** | DR drill que falle > 6h dispara revisión arquitectónica |
| **Fuente** | DR runbook execution log |
| **Justificación** | Hospital con backup en papel puede operar 4h. Más allá riesgo clínico significativo. |

---

## 3. Dashboard `/slos`

Vista admin renderiza tarjetas por SLO mostrando: target, valor actual, % error budget
consumido, ventana, fuente, status (verde/amarillo/rojo).

- **Ruta:** `/slos` (grupo `(admin)`, requiere sesión + rol admin/SRE).
- **Componentes:** `apps/web/src/app/(admin)/slos/page.tsx` + `slo-card.tsx`.
- **Lógica de cálculo:** `apps/web/src/lib/observability/slo-checks.ts`.
- **Estado MVP:** valores **mock** con números realistas. La estructura ya está lista
  para reemplazar cada `getXxxSlo()` por una llamada a su fuente real.

### 3.1 Roadmap integración real (Sprint 6)
| SLO | Fuente final | Endpoint |
|---|---|---|
| 1 | Better Uptime API | `GET /api/v2/monitors/:id/sla` |
| 2, 3, 7 | Vercel Analytics | `GET /v1/analytics/insights/...` |
| 4 | Sentry Stats API | `GET /api/0/projects/:org/:proj/stats_v2/` |
| 5, 6 | DB query interna | view materializada `mv_clinical_kpis` (refresh 5 min) |
| 8, 9 | Supabase API + runbook | `pg_stat_archiver` + log de drills |

---

## 4. Observabilidad — Sentry sampling (US-8.2)

### 4.1 Decisiones de sampling de transactions

Implementadas en `apps/web/sentry.shared.ts` vía `tracesSampler(samplingContext)`:

| Categoría de ruta | `tracesSampleRate` | Justificación |
|---|---|---|
| `/api/health` | **0.0** | Alto volumen (60 req/min de probes), señal nula. Ya excluido de transactions vía `beforeSendTransaction` adicionalmente. |
| `/api/metrics` | **0.0** | Scraping Prometheus, ruido puro. |
| `/_next/static/*`, `*.{js,css,woff2,png,svg,...}` | **0.0** | Assets estáticos servidos por CDN, irrelevantes para SLOs de app. |
| `/api/trpc/*` POST (mutations) | **1.0** | Toda escritura es crítica clínicamente. Performance + correctness. |
| `/api/trpc/*` GET (queries) | **0.1** | Alto volumen pero p95 estimable con 10% sample. |
| Resto (páginas, auth, etc.) | **0.5** | Balance señal/cuota razonable en MVP. |

`profilesSampleRate` = **0.0** → sin profiling en MVP (Hobby plan no lo incluye y no
queremos cargar el bundle del profiler en cliente).

`parentSampled` se respeta cuando viene de upstream — si el padre fue muestreado,
el hijo lo es; si no, no — mantener trazas completas o vacías, nunca parciales.

### 4.2 Filtros adicionales en `beforeSend`

`scrubAndFilterEvent` (extiende `scrubEvent`) descarta eventos cuyo mensaje matchea:

- `ResizeObserver loop limit exceeded` — bug benigno del browser.
- `Non-Error promise rejection captured` — falsos positivos de libs terceras.
- `Failed to fetch` / `NetworkError when attempting to fetch resource` / `Load failed`
  — transients de conectividad offline; los reintenta el cliente, no aporta acción.
- `AbortError: The operation was aborted` — navegaciones cancelas (usuario clickeó).

### 4.3 Endpoint Prometheus `/api/metrics`

Stub MVP en `apps/web/src/app/api/metrics/route.ts` expone:

- `his_uptime_seconds{env, version}` — uptime del proceso runtime.
- `his_db_latency_ms` — latencia del último `SELECT 1` contra la BD.
- `his_db_up` — 1/0 según último probe.
- `his_supabase_latency_ms` — latencia healthcheck Supabase Auth.
- `his_supabase_up` — 1/0 según último probe.
- `his_build_info{env, version}` — siempre 1, datos en labels (patrón Prometheus estándar).

**Content-Type:** `text/plain; version=0.0.4; charset=utf-8` — compatible Prometheus.

**TODO Sprint 6:** integración con un agente real (Grafana Agent / OTel collector).
Métricas RED por handler tRPC, histogramas de latencia, counters de mutations por tabla.

---

## 5. Reportes y revisión

- **Diario (automático):** snapshot del dashboard `/slos` enviado a `#sre-his` por bot.
- **Semanal:** comité ops revisa breach o warning. Owner: @SRE.
- **Mensual:** revisión de error budget consumido por SLO. Owner: @SRE + @PO.
- **Trimestral:** revisión de targets — ¿siguen siendo apropiados? Owner: @AE + @SRE.
- **Tras incidente:** postmortem obligatorio si breach > 100% del error budget.

---

## 6. Referencias cruzadas

- `docs/08_devops.md` — runbooks, branching, RPO/RTO operativo.
- `docs/02_arquitectura_software.md` §29 — restricciones de TDR.
- `apps/web/sentry.shared.ts` — implementación `tracesSampler` y filtros.
- `apps/web/src/lib/observability/slo-checks.ts` — funciones SLI puras.
- `apps/web/src/app/(admin)/slos/page.tsx` — dashboard.
- `apps/web/src/app/api/metrics/route.ts` — endpoint Prometheus.
