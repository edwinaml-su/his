# E2E Runbook — HIS Multipaís

Guía operativa para correr, debuggear y mantener los tests E2E de Playwright.

---

## Ejecución local

### Suite completa (~76 specs, ~38 min)

```bash
npm run test:e2e
```

Requiere la BD efímera corriendo (`docker compose -f docker-compose.test.yml up -d --wait`).

### Solo specs @smoke (~15 specs, <10 min)

```bash
E2E_GREP=@smoke npm run test:e2e
```

Equivalente a lo que corre el workflow `e2e-smoke.yml` en cada PR.

### Un solo spec o test

```bash
npx playwright test e2e/auth.spec.ts --headed
npx playwright test -g "@smoke - Autenticación"
```

### Rerun de fallidos

```bash
npx playwright test --last-failed
```

---

## Debuggear flakiness

### Ver trace y video de un fallo

Los artefactos se guardan en `apps/web/test-results/` cuando un test falla.

```bash
npx playwright show-trace apps/web/test-results/<test-name>/trace.zip
```

El config (`playwright.config.ts`) usa:
- `trace: "on-first-retry"` — genera trace en el primer retry.
- `video: "retain-on-failure"` — video guardado solo en fallos.
- `screenshot: "only-on-failure"` — screenshot guardado solo en fallos.

### UI interactiva para explorar

```bash
npx playwright test --ui
```

### Headed (ver el browser)

```bash
npx playwright test e2e/auth.spec.ts --headed --slow-mo 500
```

### Inspector paso a paso

```bash
PWDEBUG=1 npx playwright test e2e/auth.spec.ts
```

---

## Política de retries

| Suite | Retries CI | Retries local |
|---|---|---|
| Smoke (@smoke) | 1 | 0 |
| Full (nightly) | 2 | 0 |

Los retries cubren fallos transitorios de red o lentitud del runner.
Un test que falla 2+ veces consecutivas es candidato a debug, no a más retries.

---

## Specs @smoke — por qué cada uno está ahí

| Spec | Razón |
|---|---|
| `auth.spec.ts` | Login es el prerequisito de todo — si falla, todo falla |
| `smoke-g0.spec.ts` | Recorre las 4 rutas críticas post-login sin assertions frágiles |
| `smoke-production.spec.ts` | Healthcheck del deployment real (solo con `PROD_SMOKE=1`) |
| `admission-discharge.spec.ts` | ADT (Admisión-Traslado-Alta) es el flujo hospitalario core |
| `triage-manchester.spec.ts` | Manchester es el triage de emergencias — P0 regulatorio |
| `bed-map.spec.ts` | El mapa de camas es la vista de estado del hospital |
| `patient-mpi.spec.ts` | Registro y búsqueda de paciente — todo parte del MPI |
| `fase2/bedside-flow.spec.ts` | BCMA: 5 correctos en administración de medicamentos |
| `fase2/bedside-hard-stops.spec.ts` | Hard stops BCMA son safety crítica (paciente erróneo, vencido, etc.) |
| `fase2/firma-workflow-gate.spec.ts` | Firma electrónica NTEC Art. 23 — gate de workflow clínico |
| `pin-lockout.spec.ts` | Bloqueo PIN tras fallos — seguridad de firma electrónica |
| `portal-arco.spec.ts` | Portal LGPDP — cumplimiento legal de derechos ARCO |
| `audit-trail.spec.ts` | Hash chain de auditoría — inmutabilidad TDR §6.3 |
| `who-checklist.spec.ts` | WHO Surgical Safety Checklist — seguridad quirúrgica |
| `ece/ece-rls-cross-tenant.spec.ts` | RLS multi-tenant — aislamiento de datos por organización |

---

## CI/CD

| Workflow | Trigger | Set de tests |
|---|---|---|
| `e2e-smoke.yml` | PR a main/develop | Solo @smoke (~15 specs, <10 min) |
| `e2e.yml` | Nightly 06:00 UTC + manual | Suite completa (~76 specs, ~38 min) |

### Configurar E2E_GREP localmente en PowerShell

```powershell
$env:E2E_GREP = "@smoke"; npm run test:e2e
```

---

## Usuarios de test

Sembrados por `packages/database/scripts/seed-test-users.mjs`:

| Email | Password | Rol |
|---|---|---|
| `qa.admin@his.test` | `TestPass123!` | ADMIN |
| `qa.triagist@his.test` | `TestPass123!` | TRIAGIST |
| `qa.physician@his.test` | `TestPass123!` | PHYSICIAN (MC) |
| `qa.nurse@his.test` | `TestPass123!` | NURSE (ENF) |
| `qa.director@his.test` | `TestPass123!` | DIRECTOR (DIR) |

---

## Variables de entorno relevantes

| Variable | Propósito |
|---|---|
| `E2E_GREP` | Filtro de tags (e.g. `@smoke`) |
| `E2E_BASE_URL` | URL base (default `http://localhost:3000`) |
| `PROD_SMOKE` | `1` para activar `smoke-production.spec.ts` contra Vercel |
| `SKIP_E2E_BEDSIDE` | `1` omite suite bedside-flow si no hay servidor disponible |
| `SKIP_E2E_BEDSIDE_HS` | `1` omite suite bedside-hard-stops |
| `SKIP_E2E_FASE2` | `1` omite suite firma-workflow-gate |
| `FEATURE_SCOPE_SIDEBAR` | `0` desactiva tests de scope sidebar |
