# 22 — Smoke Production Tests

**Proyecto:** HIS Multipaís — Inversiones Avante
**Autor:** @QA — QA Automation (SDET)
**Versión:** 1.0 — 2026-05-13 (Fase 6 — Stream F)

> Suite Playwright contra deployment de producción. NO autentica, NO escribe, solo verifica que endpoints públicos y rutas auth-protected renderizan sin 5xx.

---

## 1. Cuándo correr

| Momento                                  | Frecuencia      | Quién         |
|------------------------------------------|-----------------|---------------|
| Post-deploy a producción (manual)        | Cada deploy     | SRE on-call   |
| Pre go-live como gate de verificación    | T+0 (cutover)   | SRE + QA Lead |
| Tras rollback como verificación retorno  | T+0 incidente   | SRE on-call   |
| Hipercuidado diario T+1 a T+14           | 1x/día          | SRE on-call   |
| Cron de monitoreo (post Fase 7)          | Cada hora       | GitHub Action |

> **No correr en CI normal**. Está gated por `PROD_SMOKE=1` para evitar ejecución accidental contra `localhost:3000`.

---

## 2. Cómo correr (manual)

### 2.1 Setup local

```bash
cd apps/web
npm install   # o pnpm install
npx playwright install chromium
```

### 2.2 Ejecutar contra producción

```bash
cd apps/web

PROD_SMOKE=1 \
E2E_BASE_URL=https://his-avante.vercel.app \
  npx playwright test --config=playwright.config.prod.ts
```

Salida esperada (deployment sano):

```
Running 5 tests using 1 worker

  ✓  1) Healthcheck /api/health retorna 200 con db+supabase OK (1.2s)
  ✓  2) Login page renderiza sin error 5xx (0.8s)
  ✓  3) /admission redirige a login (auth-protected) sin 5xx (0.6s)
  ✓  4) /triage redirige a login (auth-protected) sin 5xx (0.6s)
  ✓  5) /outpatient (Phase 2) redirige a login (auth-protected) sin 5xx (0.7s)

  5 passed (4.3s)
```

### 2.3 Ejecutar contra staging

```bash
PROD_SMOKE=1 \
E2E_BASE_URL=https://staging.avante-his.com \
  npx playwright test --config=playwright.config.prod.ts
```

---

## 3. Qué verifica cada test

| # | Test                                          | Qué valida                                                            |
|---|-----------------------------------------------|-----------------------------------------------------------------------|
| 1 | Healthcheck `/api/health`                     | DB Supabase + Auth Supabase ambos `status: ok`. 503 → falla explícito.|
| 2 | `/login` renderiza                            | < 500, body no contiene "Internal Server Error", al menos 1 input.    |
| 3 | `/admission` (auth-protected)                 | < 500, redirige a login O renderiza la ruta. No 5xx ni Application error.|
| 4 | `/triage` (auth-protected)                    | Igual que admission.                                                   |
| 5 | `/outpatient` (Phase 2)                       | Igual + verifica que NO retorna 404 (la ruta Phase 2 está deployeada).|

---

## 4. Lectura de fallos

### 4.1 Healthcheck 503

```
Error: Health 503: db=down supabase=ok
```

Implica:
- `db.status=down` → Supabase Postgres no responde → escalar P1.
- `supabase.status=down` → Auth no responde → P1.

Acción inmediata: ver `docs/15_production_runbook.md` §8 (escalation).

### 4.2 Login render falla

```
Error: expect(received).not.toMatch(expected)
Internal Server Error
```

Implica: el deploy se rompió. Acción: rollback con `vercel promote` (ver `docs/15_production_runbook.md` §5).

### 4.3 Outpatient retorna 404

Implica: Phase 2 routes no están en el deploy (build outdated o rootDirectory mal configurado). Acción: verificar último deploy READY en Vercel + redeploy desde commit Phase 2 conocido bueno.

---

## 5. Limitaciones conocidas

- **NO testea flujos autenticados**. Por diseño: no creamos usuarios contra prod ni mantenemos credenciales de test en producción.
- **NO valida correctness funcional**. Solo "no 5xx + ruta deployeada". Validación funcional vive en UAT manual (`docs/uat/phase2_uat_scenarios.md`).
- **NO mide performance**. Para p95/p99 ver Vercel Analytics.
- **Tolera 1 retry** por fallo transitorio (red, cold start Vercel). Más allá de eso = fallo real.

---

## 6. Próximos pasos (post Fase 6)

- [ ] GitHub Action `smoke-prod.yml` programada cada hora (post Fase 7 con observabilidad madura).
- [ ] Integración con alertas Sentry: fallo → issue automático.
- [ ] Extensión a flujos autenticados con cuenta `e2e@avante.local` (cuenta dedicada, no clínica) — diferido a Fase 7.

---

## 7. Referencias

- `apps/web/e2e/smoke-production.spec.ts` — spec.
- `apps/web/playwright.config.prod.ts` — config gated.
- `docs/15_production_runbook.md` — runbook ops Vercel+Supabase+Sentry.
- `docs/18_golive_checklist.md` — gate de verificación cutover.
- `docs/09_estrategia_pruebas.md` — pirámide de pruebas general.

---

## 8. Firmas

- [x] **@QA** — QA Automation — Specs + config + doc redactados — 2026-05-13.
- [ ] **@SRE** — Validar primera ejecución contra prod post-merge.
- [ ] **@Orq** — Recomendar inclusión en gate G6.
