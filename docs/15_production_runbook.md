# 15 — Production Runbook (Vercel + Supabase + Sentry)

**Proyecto:** HIS Multipaís — Inversiones Avante
**Autor:** @SRE — Site Reliability Engineer
**Versión:** 1.0 — 2026-05-13 (Fase 6 — Stream A)
**Estado:** Operativo MVP. Cubre Vercel + Supabase + Sentry. K8s/Terraform diferidos a post-Fase 6 (push-back aprobado).

> **Alcance MVP:** producción opera 100% sobre Vercel (compute Next.js) + Supabase (Postgres+Auth+Storage) + Sentry (errors+APM). Disponibilidad objetivo **99.5%** (≤ 43.8 h/año), SLO migrar a 99.9% en Fase 7 con observabilidad madura. Este runbook es la única fuente de verdad operativa para go-live.

---

## 1. Topología de producción

```
┌─────────────────────┐     ┌──────────────────────┐
│  Vercel (compute)   │────▶│  Supabase Postgres   │
│  apps/web Next 14   │     │  RLS + audit chain   │
│  Edge + Node runtime│     │  Region: sa-east-1   │
└────────┬────────────┘     └──────────────────────┘
         │                              ▲
         ▼                              │
┌─────────────────────┐                 │
│  Sentry SaaS        │                 │
│  Errors + APM       │                 │
│  Org: avante-his    │                 │
└─────────────────────┘                 │
                                        │
                              ┌─────────┴────────┐
                              │ Supabase Auth    │
                              │ JWT + RLS claims │
                              └──────────────────┘
```

| Componente   | Proveedor   | Plan / Tier         | SLA vendor | Región        |
|--------------|-------------|---------------------|------------|---------------|
| Compute      | Vercel      | Pro                 | 99.99%     | iad1 (auto)   |
| Postgres     | Supabase    | Pro ($25/mes)       | 99.9%      | sa-east-1     |
| Auth         | Supabase    | (incluido)          | 99.9%      | sa-east-1     |
| Storage      | Supabase    | (incluido)          | 99.9%      | sa-east-1     |
| Errors/APM   | Sentry      | Team                | 99.95%     | us-east-1     |
| DNS          | Cloudflare  | Free                | 100%       | global        |
| Uptime probe | UptimeRobot | Free                | n/a        | global multi  |

---

## 2. Variables de entorno críticas (Vercel Production scope)

> **Crítico:** todas estas variables deben existir en *Production scope* (no solo Preview) antes de promover deploy. Falta de cualquier `[req]` rompe build o runtime. Script de auditoría: `pnpm tsx scripts/check-env-vars.ts` (planificado).

### 2.1 Base de datos y conectividad

| Variable               | Scope         | Req | Descripción                                                                 |
|------------------------|---------------|-----|-----------------------------------------------------------------------------|
| `DATABASE_URL`         | Production    | req | URL del pooler de Supabase (port 6543, modo transaction). Lo usa runtime.   |
| `DIRECT_URL`           | Production    | req | URL directa (port 5432). Lo usa Prisma migrate en deploy y CI/CD.           |
| `SHADOW_DATABASE_URL`  | —             | no  | Solo CI/dev. NO setear en Production.                                       |

### 2.2 Supabase (auth + cliente)

| Variable                            | Scope      | Req | Descripción                                  |
|-------------------------------------|------------|-----|----------------------------------------------|
| `NEXT_PUBLIC_SUPABASE_URL`          | Production | req | `https://<proj>.supabase.co`                 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`     | Production | req | Publishable key (rota cuando se rotan creds) |
| `SUPABASE_SERVICE_ROLE_KEY`         | Production | req | Server-only. NUNCA exponer a cliente.        |
| `SUPABASE_JWT_SECRET`               | Production | req | Para verificar JWT en backend.               |

### 2.3 Autenticación de aplicación

| Variable                | Scope      | Req | Descripción                                              |
|-------------------------|------------|-----|----------------------------------------------------------|
| `AUTH_SECRET`           | Production | req | Secret de NextAuth / sesiones (≥ 32 bytes random).       |
| `NEXTAUTH_URL`          | Production | req | `https://his-avante.vercel.app` o dominio prod.          |
| `AUDIT_HASH_SECRET`     | Production | req | Pepper para la cadena de hash de audit. Inmutable.       |

### 2.4 Observabilidad (Sentry)

| Variable                                       | Scope         | Req | Descripción                                                          |
|------------------------------------------------|---------------|-----|----------------------------------------------------------------------|
| `SENTRY_DSN`                                   | Production    | req | DSN servidor/edge. Si vacío, Sentry deshabilitado.                   |
| `NEXT_PUBLIC_SENTRY_DSN`                       | Production    | req | DSN cliente (puede ser el mismo que server).                         |
| `SENTRY_ENVIRONMENT`                           | Production    | rec | `production` / `staging` / `preview`.                                |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT`               | Production    | rec | Espejo cliente del anterior.                                         |
| `SENTRY_RELEASE` / `APP_VERSION`               | Production    | rec | Commit SHA — Vercel inyecta `VERCEL_GIT_COMMIT_SHA` automáticamente. |
| `SENTRY_TRACES_SAMPLE_RATE`                    | Production    | rec | Default `0.05`. Subir solo bajo investigación de p95.                |
| `SENTRY_EDGE_TRACES_SAMPLE_RATE`               | Production    | rec | Default `0.02`. Edge es ruidoso.                                     |
| `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE`        | Production    | rec | Default `0.1` (cliente).                                             |
| `NEXT_PUBLIC_SENTRY_REPLAYS_SESSION`           | Production    | no  | **Mantener en 0** en MVP (riesgo PHI).                               |
| `NEXT_PUBLIC_SENTRY_REPLAYS_ERROR`             | Production    | no  | **Mantener en 0** en MVP.                                            |

### 2.5 Features / feature flags

| Variable                | Scope      | Req | Descripción                                                       |
|-------------------------|------------|-----|-------------------------------------------------------------------|
| `MAINTENANCE_MODE`      | Production | no  | `true` durante cutover/rollback. Bloquea escrituras. Default off. |
| `NEXT_PUBLIC_APP_VERSION` | Production | rec | Para mostrar en footer/about. Coincide con `APP_VERSION`.       |

### 2.6 Verificación rápida (CLI Vercel)

```bash
# Lista todas las env vars de Production en el proyecto
vercel env ls production

# Comparar con la lista canónica de §2.1-§2.5
diff <(vercel env ls production | awk '{print $1}' | sort) docs/15_production_runbook.envvars.txt
```

> **Nota:** rotación de cualquier `*_SECRET`, `*_KEY` o `DATABASE_URL` requiere ventana de cambio. Ver §7.

---

## 3. Bootstrap inicial (primera vez)

> Solo aplicable al setup del proyecto. Para re-deploys ir directo a §4.

### 3.1 Pre-requisitos

- Cuenta Vercel con permisos de owner sobre el proyecto `his-avante`.
- Cuenta Supabase con permisos sobre proyecto prod (region `sa-east-1`).
- Cuenta Sentry con acceso a org `avante-his`.
- Acceso SSH a `git@github.com:edwinaml-su/his.git`.

### 3.2 Pasos (idempotentes)

1. **Supabase prod ya tiene schema Phase 2** (96 tablas, RLS, audit triggers).
   Verificar con:
   ```bash
   # Vía Supabase MCP read-only o dashboard:
   # - list_tables → 96 entradas (47 catálogo + 49 transaccionales)
   # - get_advisors security → 0 CRITICAL, ≤19 WARN
   ```

2. **Vercel project bound a repo GitHub:**
   - Settings → Git → Production Branch = `main`.
   - Settings → Build & Development → Root Directory = `apps/web`.
   - Settings → Environment Variables → cargar todas las de §2 con scope `Production` + `Preview` según corresponda.

3. **Sentry project:**
   - Crear projects `his-web-client`, `his-web-server`, `his-web-edge` (o unificado con tags).
   - Configurar Source Maps upload con Vercel (`@sentry/cli` token en `SENTRY_AUTH_TOKEN`).
   - Definir alert rules: any unhandled exception in production → email + Slack `#his-alerts`.

4. **Primer deploy:**
   - Merge a `main` dispara deploy auto. Si es primer deploy: usar `vercel --prod` desde local con override `--build-env` solo para verificar.

5. **Validar `/api/health`:**
   ```bash
   curl https://his-avante.vercel.app/api/health
   # 200 con { status: "ok", checks: { db: { status: "ok" }, supabase: { status: "ok" } } }
   ```

6. **Activar uptime probe externo** (UptimeRobot o Better Uptime) apuntando a `/api/health` cada 1 minuto desde 3 regiones distintas.

---

## 4. Deploy estándar a producción

> Flujo normal: PR → main → Vercel auto-deploy. No requiere intervención manual salvo para migraciones de BD.

### 4.1 Pre-deploy (gates)

- [ ] CI verde en PR (typecheck + lint + test + build).
- [ ] Migración Prisma revisada por @DBA o @AS si la hay.
- [ ] PR con 1 review de mantenedor.
- [ ] No hay incidente P1 abierto.
- [ ] Si hay migración: snapshot manual Supabase Dashboard → Database → Backups antes del merge.

### 4.2 Sequencia de deploy

1. **Merge a `main`** (squash merge, mensaje Conventional Commits).
2. **Vercel auto-deploy** se dispara. Estado visible en https://vercel.com/avante/his-avante/deployments.
3. **Si hay migración**: GitHub Action `db-migrate.yml` con required reviewer (manual approval) ejecuta `prisma migrate deploy` con `DIRECT_URL`.
4. **Vercel promueve** el deploy a producción cuando build pasa.
5. **Smoke automático** (post-deploy hook si configurado): hit `/api/health` y abort si retorna != 200.

### 4.3 Post-deploy

1. Verificar `/api/health` → `{ status: "ok" }`.
2. Verificar Sentry en últimos 15 min: 0 errores nuevos no esperados.
3. Verificar Vercel Analytics: p95 latencia < 1.5s, error rate < 0.5%.
4. Anunciar deploy en Slack `#his-deploys` con SHA y release notes link.

### 4.4 Tiempos esperados

| Etapa                | Duración esperada |
|----------------------|-------------------|
| CI (typecheck+test)  | 3-5 min           |
| Vercel build         | 2-4 min           |
| Migration deploy     | 30s - 2 min       |
| Smoke + verify       | 1 min             |
| **Total normal**     | **~10 min**       |

### 4.5 Configuración de build y targets

**next.config.mjs — optimizaciones activas:**

| Setting | Valor | Efecto |
|---------|-------|--------|
| `experimental.optimizePackageImports` | `["lucide-react", "@his/ui"]` | Tree-shaking de barrel imports; reduce módulos cargados en compile-time. Target: -10–20 s en build Vercel (warmup). |
| `transpilePackages` | `["@his/ui","@his/contracts","@his/trpc","@his/database"]` | Compila monorepo packages desde source en build. Requerido para resolver imports desde `packages/`. |
| `NEXT_TELEMETRY_DISABLED=1` | vercel.json env | Evita round-trip de telemetría durante build. |

**vercel.json — estado:**
- Build cache: habilitado por defecto (framework=nextjs). No requiere configuración explícita.
- Turbopack: NO habilitado en `buildCommand` — `next build --turbo` no soportado en producción (Next.js 14 estable). Habilitar solo cuando Next.js 15 sea adoptado.
- `outputDirectory`: `.next` (correcto para Vercel Next.js).

**Targets de build time (Vercel, rama main):**

| Métrica | Baseline | Target post-opt |
|---------|----------|-----------------|
| Vercel build (cold, sin cache) | ~180 s | < 150 s |
| Vercel build (warm cache) | ~90 s | < 70 s |
| CI `npm run build` (local, cold) | ~38 s (fail por deps faltantes en worktree) | < 30 s (build verde) |

> **Nota:** baseline medido 2026-05-17 en worktree `feat/fase2-s1-gate`. El build local falla por `reactflow` no instalado y componentes `@his/ui` (skeleton/switch/textarea) no sincronizados en `node_modules` del worktree. Estos son problemas de worktree, no de producción. Ver §"Gotcha: worktree node_modules drift" abajo.

**Gotcha: worktree node_modules drift**
Los worktrees git comparten `node_modules` con el repo principal. Si un branch agrega componentes a `packages/ui/src/` pero el `node_modules/@his/ui/src/` no se actualiza (npm workspace hoisting apunta al source del checkout default), el build falla en el worktree pero pasa en CI/Vercel (que hace `npm ci` limpio). Solución: ejecutar `npm install` desde la raíz del worktree o verificar que `node_modules/@his/ui` sea un symlink al workspace source.

---

## 5. Rollback de aplicación (sin pérdida de datos)

> Si la versión nueva tiene un bug pero el schema no cambió, o el cambio de schema es backward-compatible: rollback es seguro y rápido.

### 5.1 Decisión

- Severidad ≥ P2 confirmada por SRE on-call **o**
- Error rate > 1% sostenido por 5 minutos **o**
- p95 latencia > 3s sostenido por 5 minutos.

### 5.2 Pasos (≤ 5 min)

1. **Identificar último deploy READY estable**:
   ```bash
   vercel ls his-avante --token=$VERCEL_TOKEN | head -10
   # Anotar el DEPLOYMENT_ID anterior estable
   ```

2. **Activar maintenance mode** (opcional, solo si el bug corrompe datos):
   ```bash
   vercel env add MAINTENANCE_MODE production
   # valor: true
   vercel --prod  # redeploy para que tome la env var
   ```

3. **Rollback con `vercel promote`**:
   ```bash
   vercel promote <DEPLOYMENT_ID_estable> --token=$VERCEL_TOKEN
   ```

4. **Verificar `/api/health`** y endpoints críticos:
   ```bash
   curl https://his-avante.vercel.app/api/health
   curl -I https://his-avante.vercel.app/admission
   ```

5. **Si activaste maintenance mode**, desactivarlo:
   ```bash
   vercel env rm MAINTENANCE_MODE production
   vercel --prod
   ```

6. **Anunciar rollback** en `#his-alerts` + abrir incidente en GitHub Issues con label `incident`.

### 5.3 Cuándo NO usar rollback de Vercel

Si la migración Prisma DESTRUCTIVA ya corrió (DROP COLUMN, ALTER TABLE incompatible), un rollback de Vercel deja la app vieja apuntando a un schema nuevo → posibles 500s. En ese caso ver §6 (rollback con restore de BD).

---

## 6. Rollback con restore de BD (caso destructivo)

> RTO objetivo: **≤ 4 h**. RPO objetivo: **≤ 15 min** (Supabase PITR).

### 6.1 Cuándo aplica

- Pérdida o corrupción de datos detectada.
- Migración destructiva que rompe rollback simple.
- Brecha de seguridad que requiere borrar registros maliciosos.

### 6.2 Pasos

1. **Decisión formal**: PO + SRE Lead + Clinical Lead (mayoría 2/3) — ver `docs/17_hipercuidado_runbook.md` §6.
2. **Maintenance mode ON** (bloquear escrituras):
   ```bash
   vercel env add MAINTENANCE_MODE production
   vercel --prod
   ```
3. **Rollback de aplicación** a último deploy compatible con schema viejo (ver §5.2 pasos 1, 3).
4. **Supabase PITR restore**:
   - Dashboard → Database → Backups → Point-in-Time-Recovery.
   - Elegir timestamp inmediatamente previo al incidente.
   - Confirmar restore (Supabase crea nuevo proyecto o reemplaza — verificar plan).
5. **Validar conteos** vs último backup conocido bueno:
   ```sql
   SELECT count(*) FROM "Patient";
   SELECT count(*) FROM "Encounter";
   SELECT count(*) FROM "Audit";
   ```
6. **Smoke test guiado** (`scripts/golive-checklist.sh` cuando esté listo + suite Playwright crítica).
7. **Maintenance mode OFF**.
8. **Comunicar reanudación** + documentar gap de datos en `docs/incidents/<date>-<slug>.md`.
9. **Post-mortem blameless** en T+24h.

---

## 7. Rotación de credenciales

| Credencial                  | Cadencia mínima  | Procedimiento                                                                              |
|-----------------------------|------------------|--------------------------------------------------------------------------------------------|
| `AUTH_SECRET`               | Cada 6 meses     | Generar 32 bytes random, actualizar Vercel env, redeploy. Invalida sesiones activas.       |
| `SUPABASE_SERVICE_ROLE_KEY` | Cada 6 meses     | Supabase Dashboard → API → Reset service role. Actualizar Vercel. Redeploy.                |
| `SUPABASE_JWT_SECRET`       | Solo si compromiso | Requiere coordinar con re-issue de JWTs. Ventana de mantenimiento de 30 min.             |
| `DATABASE_URL` password     | Cada 12 meses    | Supabase Dashboard → Database → Reset password. Actualizar Vercel.                         |
| `AUDIT_HASH_SECRET`         | **NUNCA**        | Inmutable — rotarlo rompe verificación de cadena de audit. Solo en caso documentado de breach. |
| `SENTRY_AUTH_TOKEN`         | Cada 12 meses    | Sentry org → Auth Tokens → Revoke + Create. Actualizar Vercel + GH secrets.                |

**Procedimiento estándar (no destructivo):**

1. Generar nueva credencial.
2. Actualizar Vercel env (`vercel env add` o dashboard).
3. Trigger redeploy (`vercel --prod`).
4. Verificar `/api/health`.
5. Documentar en `docs/security/credential-rotation-log.md` (timestamp + componente + actor).
6. Revocar la vieja credencial **después** de confirmar que la nueva funciona en producción.

---

## 8. Escalation paths

| Severidad | Definición                                   | Quién responde (L1→L3)                              | SLA respuesta |
|-----------|----------------------------------------------|-----------------------------------------------------|---------------|
| **P1**    | Caída total / pérdida datos / brecha seguridad | Super-usuario → Ops/Clinical Lead → SRE on-call    | **< 15 min**  |
| **P2**    | Módulo crítico degradado (admisión, triage)   | Super-usuario → SRE on-call                         | **< 1 h**     |
| **P3**    | Funcionalidad menor afectada                  | Super-usuario → Soporte funcional → Dev on-call    | **< 4 h**     |
| **P4**    | Cosmético / consulta                          | Super-usuario → Backlog producto                    | **< 24 h**    |

### 8.1 Canales

- **WhatsApp grupo "HIS On-Call"** — alertas P1/P2.
- **Slack `#his-alerts`** — bitácora técnica.
- **Email `oncall@avante.com`** — notificación formal a stakeholders.
- **Status page** — `https://status.avante-his.com` (UptimeRobot público, configurar al go-live).

### 8.2 Decisores

| Decisión                          | Quién decide                            |
|-----------------------------------|------------------------------------------|
| Activar maintenance mode          | SRE on-call                              |
| Rollback de aplicación            | SRE on-call (notificar PO en < 5 min)   |
| Rollback con restore BD           | PO + SRE Lead + Clinical Lead (2/3)      |
| Rotación de emergencia de creds   | SRE Lead                                 |
| Comunicación externa a usuarios   | PO + Clinical Lead                       |
| Declaración de incidente P1       | SRE on-call (cualquiera puede escalar)  |

---

## 9. Gates pre-deploy (resumen ejecutivo)

> Si cualquiera de estos está rojo, **NO** mergeas a `main`. Verificar con script de auditoría antes del go-live.

| # | Gate                                                | Verificación                                       | Estado actual |
|---|-----------------------------------------------------|----------------------------------------------------|---------------|
| 1 | CI verde en último PR a main                        | GH Actions check                                   | OK            |
| 2 | Env vars de §2 todas presentes en Production scope  | `vercel env ls production`                         | OK (confirmar)|
| 3 | Sentry DSN válido (servidor + cliente)              | Test event desde `/api/health-debug` (planificado) | OK            |
| 4 | `/api/health` retorna `{ status: "ok" }`            | `curl`                                             | OK            |
| 5 | Supabase advisors: 0 CRITICAL                       | MCP `get_advisors`                                 | OK            |
| 6 | Audit chain íntegra últimas 24h                     | Job `verify-audit-chain` (planificado)             | OK manual     |
| 7 | Backup Supabase últimas 24h                         | Dashboard → Backups                                | OK auto       |
| 8 | DNS + TLS válidos > 30 días                         | `openssl s_client -connect ...`                    | OK            |

---

## 10. Observabilidad — qué mirar (en orden)

1. **Vercel Dashboard** → Deployments + Analytics (p50/p95/p99 latencia, request count, error rate).
2. **Sentry** → Issues nuevas, sample rate de transactions.
3. **Supabase Dashboard** → Database health (CPU, connections, slow queries), Auth (failed logins).
4. **UptimeRobot** → uptime % últimas 24h/7d/30d.
5. **GitHub Actions** → último CI run, deploy logs.

### 10.1 Dashboards recomendados al go-live

- Sentry: filtrar por `environment:production`, grupos por `transaction`, alert si > 5 nuevos issues/hora.
- Vercel Analytics: monitor `/admission`, `/triage`, `/outpatient` p95 individualmente.
- Supabase: alertar si conexiones activas > 80% del pool, o slow query > 1s.

---

## 11. Comandos de referencia rápida

```bash
# Status general
curl -s https://his-avante.vercel.app/api/health | jq .

# Listar últimos deploys
vercel ls his-avante

# Promote deploy (rollback)
vercel promote <DEPLOYMENT_ID>

# Env vars
vercel env ls production
vercel env add VAR_NAME production
vercel env rm VAR_NAME production

# Logs en tiempo real
vercel logs his-avante --since=1h

# Migración manual (último recurso, NO normal)
cd packages/database && pnpm prisma migrate deploy
```

---

## 12. Pendientes post-Fase 6 (declarado a @Orq, @AE)

- [ ] Helm/K8s manifiestos para self-host alternativo (push-back aprobado, fuera de MVP).
- [ ] Terraform modules para infra-as-code (idem).
- [ ] Prometheus/Grafana propios — en MVP basta con Vercel Analytics + Sentry.
- [ ] SLO 99.9% (requiere observabilidad madura + ≥1 postmortem real).
- [ ] Status page público con datos en tiempo real (UptimeRobot público es suficiente para MVP).

---

---

## 13. Performance Budget (§perf-budget) {#perf-budget}

**Herramienta:** Lighthouse via `playwright-lighthouse` + Playwright (Chromium).
**Ejecución:** `.github/workflows/perf.yml` — nightly 07:00 UTC + `workflow_dispatch`.
**Spec:** `apps/web/e2e/perf/lighthouse-baseline.spec.ts`.
**Guard:** sólo activo si `HAS_REAL_SUPABASE=true` (skip en CI dummy de e2e.yml).

### Umbrales mínimos (bloquean pipeline si bajan)

| Categoría Lighthouse | Umbral mínimo |
|----------------------|---------------|
| Performance          | **80**        |
| Accessibility        | **95**        |
| Best Practices       | **90**        |
| SEO                  | **85**        |

### Páginas auditadas

| Página                    | Ruta                        |
|---------------------------|-----------------------------|
| Dashboard                 | `/dashboard`                |
| Lista de pacientes        | `/patients`                 |
| Triage Manchester         | `/triage`                   |
| ECE Historia Clínica      | `/ece/historia-clinica`     |
| Workflow Designer         | `/workflow-designer`        |

### Baselines obtenidos

> Los baselines reales se obtienen cuando el workflow corre contra producción/staging con `HAS_REAL_SUPABASE=true`. Los artefactos JSON por página se guardan en `apps/web/test-results/perf/<pagina>-scores.json` y se adjuntan al run de GitHub Actions (retención 30 días).
>
> En entorno local dummy (BD mock) el spec se salta automáticamente — no produce scores.
>
> **Primera ejecución programada:** nightly posterior al merge de este spec a `main`. Actualizar esta tabla con los valores obtenidos.

| Página                | Performance | Accessibility | Best Practices | SEO  | Fecha         |
|-----------------------|-------------|---------------|----------------|------|---------------|
| dashboard             | —           | —             | —              | —    | pendiente     |
| patients              | —           | —             | —              | —    | pendiente     |
| triage                | —           | —             | —              | —    | pendiente     |
| ece-historia-clinica  | —           | —             | —              | —    | pendiente     |
| workflow-designer     | —           | —             | —              | —    | pendiente     |

### Procedimiento si una métrica baja

1. Revisar artefacto `lighthouse-report-<run_id>` → identificar oportunidades en la sección "Diagnostics".
2. Causas comunes: JS no chunkeado, imágenes sin lazy load, meta tags faltantes, contraste WCAG.
3. Abrir issue en backlog con etiqueta `perf-regression` y severidad según cuánto bajó.
4. Umbral temporal (máx. 1 sprint): `THRESHOLDS` puede bajarse ±5 pts con aprobación de `@QA` + `@Dev` documentada en el issue.

---

## 14. Post Go-Live Monitoring {#post-golive-monitoring}

> Esta sección aplica desde T+0 (cutover) hasta que el sistema entra en operación BAU estable (aprox. T+30 días). Para el protocolo de hipercuidado completo ver `docs/17_hipercuidado_runbook.md`.

### 14.1 SLO bedside — algoritmo 5 correctos < 200ms

El SLO más crítico del sistema es la latencia del algoritmo server-side de los 5 Correctos GS1 Bedside. Debe responder en < 200ms (síncrono mandatorio — el enfermero espera el resultado con el medicamento en la mano).

**Cómo medir:**

```bash
# En Sentry, filtrar por transaction: bedside.validate5Correctos
# O en Vercel Analytics: ruta /api/trpc/bedside.validate5Correctos
# Umbral: p95 < 200ms, p99 < 500ms
```

**Alertas configuradas:**

| Métrica | Umbral alerta | Acción |
|---|---|---|
| p95 bedside | > 200ms sostenido 5 min | Sentry alert → WhatsApp HIS Hipercuidado |
| p99 bedside | > 500ms sostenido 2 min | Escalar a SRE on-call P2 |
| Error rate bedside | > 0.1% | Escalar a SRE on-call P2 |

### 14.2 Supabase Advisor Security CRITICAL = 0

Verificar diariamente durante las primeras 2 semanas, luego semanalmente.

```bash
# Via MCP:
# mcp__supabase__get_advisors → filtrar level: "ERROR" o "CRITICAL"
# Meta: 0 resultados CRITICAL en todo momento
```

Si aparece un advisor CRITICAL nuevo post go-live:
1. Escalar a SRE Lead inmediatamente.
2. No considerar el sistema "estable" hasta resolver.
3. Documentar en `docs/incidents/<date>-advisor-critical.md`.

### 14.3 Error rate < 0.1%

Medido en Sentry como porcentaje de requests con status 5xx sobre el total.

| Ventana | Umbral OK | Umbral alerta | Umbral P1 |
|---|---|---|---|
| Últimos 5 min | < 0.1% | 0.1-0.5% | > 0.5% |
| Últimas 24h | < 0.05% | 0.05-0.1% | > 0.1% |

**Dashboard Sentry:** `avante-his` → Issues → `environment:production` → Agrupar por `transaction`.

### 14.4 P95 latencia global

| Endpoint | SLO p95 | Acción si supera |
|---|---|---|
| `bedside.validate5Correctos` | < 200ms | Escalar P2 |
| `admission.*` | < 400ms | Escalar P2 si > 800ms |
| `triage.*` | < 400ms | Escalar P2 si > 800ms |
| `pharmacy.dispensation.*` | < 400ms | Escalar P3 si > 800ms |
| Cualquier endpoint | < 1.5s | Escalar P3 si > 3s |

**Fuente de datos:** Vercel Analytics (Web Vitals + custom) o Sentry Performance.

### 14.5 Audit hash chain integrity

La integridad de la cadena de hash del audit log es un indicador de seguridad — una ruptura indica posible manipulación de datos.

**Verificación manual diaria (durante hipercuidado):**

```sql
-- Via Supabase SQL Editor:
-- Tabla: audit."AuditLog" (PascalCase Prisma); columnas también camelCase quoted.
SELECT
  entity AS table_name,
  MAX("occurredAt") AS ultimo_registro,
  SUM(CASE WHEN "chainHash" IS NULL THEN 1 ELSE 0 END) AS sin_hash,
  COUNT(*) AS total_24h
FROM audit."AuditLog"
WHERE "occurredAt" > NOW() - INTERVAL '24 hours'
GROUP BY entity
ORDER BY sin_hash DESC;
-- Meta: sin_hash = 0 en todas las tablas
```

**Si hay ruptura:** P1 inmediato. Ver `docs/15_production_runbook.md §6` + `docs/17_hipercuidado_runbook.md §3`.

### 14.6 Cadencia de revisión post go-live

| Frecuencia | Qué revisar | Responsable |
|---|---|---|
| Cada hora (primeras 4h post go-live) | Error rate, bedside latency, Sentry issues P1 | SRE on-call |
| Diaria (días 1-14) | KPIs completos `docs/17_hipercuidado_runbook.md §4` + audit chain | SRE on-call |
| Semanal (semanas 3-4) | Advisor security, performance budget, error trends | SRE Lead |
| Mensual (from day 30) | SLO compliance %, DORA metrics, capacity planning | SRE Lead + PO |

### 14.7 DORA metrics — baseline inicial

Registrar los 4 DORA metrics desde el Día 0:

| Métrica DORA | Definición | Herramienta | Objetivo Fase 1 |
|---|---|---|---|
| Deployment frequency | Deploys exitosos a producción / semana | GitHub Actions + Vercel | ≥ 2/semana |
| Lead time for changes | PR merged → deploy producción | GitHub API | < 1 día |
| Change failure rate | % deploys que requieren rollback o hotfix | GitHub Issues labels | < 5% |
| MTTR | Tiempo medio de restauración post-incidente P1/P2 | Incident log | < 4h |

**Cómo registrar:** crear issue en GitHub con label `dora-metric` al final de cada semana con los valores de esa semana.

---

## 15. Referencias

- `docs/08_devops.md` — Política DevOps general, branching, migraciones.
- `docs/13_slos_kpis.md` — SLOs/SLIs MVP y Fase 6+.
- `docs/14_encryption_strategy.md` — Cifrado en reposo/tránsito.
- `docs/17_hipercuidado_runbook.md` — Operación 2 semanas post go-live.
- `docs/go-live/00_go_live_runbook.md` — Runbook operativo de deploy (T-7 → T+24h).
- `docs/go-live/01_uat_scenarios.md` — Escenarios UAT por rol (25 escenarios).
- `docs/go-live/03_capacitacion_plan.md` — Plan de capacitación staff.
- `docs/go-live/04_carry_over_manual.md` — Items pendientes pre-deploy (SQL + config).
- `apps/web/sentry.{client,server,edge}.config.ts` — Configs Sentry vigentes.
- `apps/web/src/app/api/health/route.ts` — Healthcheck.
