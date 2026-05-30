# Infra Security Audit — HIS Avante
**Fecha:** 2026-05-30 | **Auditor:** @SRE | **Scope:** Vercel + Supabase + GitHub Actions + monorepo

---

## 1. Secrets Management

**Hallazgos**:
- **[P2]** `.env` y `packages/database/.env` presentes en disco con credenciales reales (DATABASE_URL + password en texto claro). No tracked por git (`.gitignore` correcto), pero existen en el worktree local — riesgo si se accede al host. Evidencia: `C:\proyecto\HIS\.env:3`, `packages/database/.env:3`. Remediation: rotar passwords post-lectura; usar `op run` o 1Password CLI para no materializar en disco.
- **[P2]** `apps/web/.env.local` contiene `SUPABASE_SERVICE_ROLE_KEY` y `AUTH_SECRET` en texto claro en disco de desarrollo. No tracked por git — riesgo de exposición vía backup de disco/IDsync. Remediation: misma mitigación anterior; considerar `.env.local` en `.gitattributes` con `export-ignore`.
- **[P3]** `.gitignore` raíz no cubre `packages/database/.env` explícitamente — solo la raíz `.env`. El glob actual `!.env.example` permite `.env` en subdirectorios si el sub-paquete no tiene su propio `.gitignore`. Evidencia: `C:\proyecto\HIS\.gitignore:16-19`. Remediation: agregar `**/.env` al `.gitignore` raíz.
- **[P3]** Secrets de workflows (`DATABASE_URL`, `DIRECT_URL`, `BACKUP_DRILL_DATABASE_URL`, `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SLACK_WEBHOOK_URL`, `SLACK_WEBHOOK_DR`) referenciados correctamente vía `${{ secrets.X }}` — no hardcodeados. Sin evidencia de leak en logs (CI usa valores dummy explícitos). Estado parcialmente correcto.
- **[P3]** `GITLEAKS_LICENSE` referenciado en `security.yml:52` pero probablemente vacío (uso personal/OSS no requiere licencia). Gitleaks falla silenciosamente si el token es inválido. Remediation: remover referencia si el repo es privado sin licencia comercial, o confirmar que `GITLEAKS_LICENSE` está seteado.

**Estado**: AMARILLO

---

## 2. CI/CD Hardening

**Hallazgos**:
- **[P1]** Ninguno de los 8 workflows tiene bloque `permissions:` a nivel de job excepto `security.yml` y `compliance.yml`. Los 6 restantes (`ci.yml`, `e2e.yml`, `a11y.yml`, `db-migrate.yml`, `perf.yml`, `perf-k6.yml`, `e2e-smoke.yml`, `backup-drill.yml`) heredan el permiso default de GitHub Actions que es `contents: write` + `packages: write` + `id-token: none` dependiendo del plan. Evidencia: ausencia de `permissions:` en `ci.yml`, `e2e.yml`, `backup-drill.yml`. Remediation: agregar `permissions: contents: read` al menos en todos los workflows que no escriben releases.
- **[P1]** Sin `pull_request_target` en ningún workflow — correcto. Sin riesgo de checkout malicioso de PR externo.
- **[P1]** Branch protection en `main` deshabilitada (confirmado en `CLAUDE.md`). Un push directo a `main` no pasa por CI. Riesgo: deploy de código no revisado. Remediation inmediata: habilitar branch protection en GitHub Settings con `Require status checks` (ci.yml) + `Require pull request reviews: 1`. En repo privado con plan Free esto requiere GitHub Pro — alternativa: regla de CODEOWNERS + merge queue manual.
- **[P2]** Actions sin SHA pinning — todos los workflows usan `@v4` / `@v2` / `@v1.26.0` en lugar de SHA commit fijo. Superficie: `actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4`, `gitleaks/gitleaks-action@v2`, `slackapi/slack-github-action@v1.26.0`. Supply chain risk si el tag es redirigido. Remediation: pin a SHA con comentario de versión (ej. `actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af68 # v4.2.2`).
- **[P2]** `db-migrate.yml` requiere GitHub Environments (`environment: ${{ inputs.environment }}`). Si los environments `preview/staging/production` no tienen `required reviewers` configurados en GitHub Settings, el approval gate no existe y cualquiera con `workflow_dispatch` puede correr migraciones a producción sin aprobación.
- **[P3]** `backup-drill.yml` no tiene bloque `permissions:` — hereda defaults. El dump de producción se sube como artifact con `retention-days: 7`. El artifact contiene PII. Remediation: limitar retención a 1 día o cifrar el dump antes del upload.
- **[P3]** No hay `CODEOWNERS` ni `dependabot.yml` en `.github/`. Riesgo: PRs de bots de seguridad no tienen reviewer automático asignado.

**Estado**: ROJO

---

## 3. Vercel Hardening

**Hallazgos**:
- **[P2]** CSP (Content-Security-Policy) ausente en `vercel.json` y en `next.config.mjs`. Los headers presentes son: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `HSTS`. CSP es el header de mayor impacto para mitigar XSS en una app hospitalaria con PHI. Evidencia: `vercel.json:14-25`. Remediation: agregar CSP modo report-only primero, luego enforce con `script-src 'self' 'nonce-{NONCE}'`.
- **[P2]** `next.config.mjs` no define `images.remotePatterns` — si alguna ruta usa `<Image src={externalUrl}>`, Next.js usará el default permisivo o fallará en runtime. Confirmar que no hay imágenes externas sin whitelist explícita.
- **[P3]** `experimental.viewTransition: true` — flag experimental activo en producción. Bajo riesgo pero potencial de comportamiento inesperado en actualizaciones de Next.js. Monitorear changelog.
- **[P3]** `eslint: { ignoreDuringBuilds: true }` — lint no bloquea build. Si se introduce código con vulnerabilidades detectables por ESLint security plugins, el build pasa. Remediation: re-habilitar en build o mantener el CI lint gate como único gate.
- **[P0-operativo]** Vercel Deployment Protection (password) activa en previews por defecto en plan Pro — verificar que los previews de feature branches no exponen datos reales de Supabase prod. Los workflows E2E apuntan a BD efímera en CI, pero el preview deployment de Vercel puede apuntar a Supabase prod si `NEXT_PUBLIC_SUPABASE_URL` está en scope `Preview`.

**Estado**: AMARILLO

---

## 4. Supabase Hardening

**Hallazgos**:
- **[P1]** Sin IP allowlist en Supabase (no hay evidencia de configuración en ningún doc ni runbook). La connection string de Postgres es accesible desde cualquier IP con las credenciales. En plan Pro, Supabase permite Network Restrictions. Remediation: habilitar en Dashboard → Settings → Network → Restrict connections to Vercel IPs + GitHub Actions egress IPs.
- **[P2]** No hay Edge Functions desplegadas (confirmado via MCP: `{"functions":[]}`). Sin superficie de ataque serverless. Estado positivo.
- **[P2]** Storage buckets: sin evidencia de configuración. Si hay buckets para adjuntos clínicos, confirmar que no son `public` — deben ser `private` con signed URLs. Un solo bucket público con PHI sería P0. El route `signed-url/route.ts` sugiere uso de signed URLs, lo cual es correcto.
- **[P3]** `SUPABASE_JWT_SECRET` debe coincidir entre Supabase y Vercel env. Si divergen, los JWTs de Supabase Auth no pasan validación en tRPC. El runbook §7 documenta que es "solo si compromiso" — correcto, pero verificar que está seteado en Vercel Production scope.
- **[P3]** Realtime channels: sin evidencia de auth gates en código auditado. Si se usan canales Realtime para notificaciones clínicas, deben tener RLS policies que limiten suscripción por `organization_id`. Requiere revisión adicional.

**Estado**: AMARILLO

---

## 5. Observabilidad y Alertas

**Hallazgos**:
- **[P1]** Sentry referenciado en `docs/15_production_runbook.md` (DSN documentado como env var requerida) pero sin evidencia de `instrumentation.ts`, `sentry.client.config.ts` o `sentry.server.config.ts` en `apps/web/src/`. Si Sentry no está inicializado, los errores de producción son silenciosos. Remediation: verificar que los archivos de config Sentry existen y que `SENTRY_DSN` está seteado en Vercel.
- **[P2]** Logger estructurado (Pino) implementado con `redact` paths completos para PII/PHI (`email`, `dui`, `diagnosis`, `labResult`, etc.). Buena cobertura. Evidencia: `packages/infrastructure/src/observability/logger.ts`. Estado positivo.
- **[P2]** Health check implementado en `packages/infrastructure/src/observability/health-check.ts` con checks de DB, auth y RLS. Sin evidencia de endpoint `/api/health` en el router — confirmar que está expuesto en `apps/web/src/app/api/health/route.ts`.
- **[P2]** No hay alertas definidas para anomalías: intentos de login fallidos en bulk, exports masivos de pacientes, ruptura de audit chain. UptimeRobot cubre disponibilidad pero no detección de anomalías. Remediation: Sentry alerts por evento + regla SQL nocturna sobre `audit.audit_log` para bulk operations.
- **[P3]** SLO declarado: 99.5% (MVP). Medición: Vercel Analytics + UptimeRobot. Sin error budget tracking automatizado. Remediation Beta.21: job de SLO check con reporte a Slack semanal.

**Estado**: AMARILLO

---

## 6. Backup / DR

**Hallazgos**:
- **[P2]** Supabase Pro incluye PITR con retención de 7 días. RPO declarado ≤ 15 min, RTO ≤ 4 h. `backup-drill.yml` implementa `pg_dump` + restore a BD efímera con verificación de audit chain. Estado positivo estructuralmente.
- **[P2]** `BACKUP_DRILL_DATABASE_URL` es un secret separado de `DATABASE_URL` — correcto para evitar que el drill corra contra prod accidentalmente. Sin embargo no hay evidencia de que el drill se haya ejecutado (ningún artefacto en `backups/` directory). Remediation: ejecutar drill mensualmente y documentar resultado en `docs/incidents/drill-YYYYMM.md`.
- **[P2]** `DIRECT_URL` referenciado en runbook como "stale" (CLAUDE.md memory). Si `DIRECT_URL` apunta a host diferente a `DATABASE_URL`, las migraciones con `prisma migrate deploy` irán a la BD incorrecta. Remediation urgente: verificar paridad entre `DATABASE_URL` y `DIRECT_URL` en Vercel Production scope.
- **[P3]** Dump artifact en `backup-drill.yml` tiene `retention-days: 7` y comentario explícito de PII. Sin cifrado del dump antes del upload. Evidencia: `backup-drill.yml:130-136`. Remediation: cifrar con `gpg --symmetric` antes de upload, o reducir retención a 1 día.

**Estado**: AMARILLO

---

## 7. Network Security

**Hallazgos**:
- **[P1]** Sin IP allowlist en Supabase Postgres (duplicado del punto 4 por impacto). La BD directa (port 5432) acepta conexiones desde cualquier IP con credenciales válidas.
- **[P2]** Sin VPN ni private link entre Vercel y Supabase. La conexión usa PgBouncer pooler (port 6543) sobre internet público con TLS (`sslmode=require` en DIRECT_URL). Aceptable para Supabase Pro en sa-east-1 pero no óptimo para datos PHI. Remediation post-MVP: Supabase PrivateLink (Enterprise) o Vercel Network egress IP allowlist.
- **[P3]** Egress de GitHub Actions hacia Supabase durante `backup-drill.yml`: el runner descarga el dump completo en su filesystem efímero. Los IPs de GitHub Actions son públicos y no allowlisteables de forma granular. Si se habilita IP allowlist en Supabase, el drill debe usar un runner self-hosted en red allowlisteada o bypass temporal.
- **[P3]** Cloudflare en DNS (Free plan). Sin WAF activo. Considera activar Cloudflare WAF con managed ruleset OWASP para mitigar ataques a nivel HTTP antes de llegar a Vercel.

**Estado**: ROJO

---

## 8. Compliance Ops

**Hallazgos**:
- **[P2]** Retención 10 años de `audit.audit_log` (TDR §6.3): documentada en runbook y con hash chain implementada. Sin embargo no hay política de lifecycle/archivado en Supabase para mover registros antiguos a cold storage. Supabase Pro no tiene archivado automático por tabla. Remediation: job semestral que exporta registros >5 años a S3 Glacier + referencia cruzada desde `audit_log`.
- **[P2]** GDPR/LOPD right-to-erasure: sin procedure de borrado de paciente en código auditado (`grep` sin resultados en routers tRPC). El modelo de datos tiene `Patient` con FK en múltiples tablas — un borrado en cascada requiere coordinación con audit chain (borrar registros de audit rompe la cadena). Remediation: implementar pseudonimización en lugar de borrado hard-delete, con procedure documentado.
- **[P3]** PII en logs: Pino redact cubre campos conocidos pero no cubre casos donde el desarrollador pasa un objeto PHI completo como contexto (ej. `logger.info(patient, 'creado')`). Sin lint rule que lo detecte. Remediation: ESLint custom rule o documentación en CLAUDE.md.

**Estado**: AMARILLO

---

## 9. Dependency Hardening

**Hallazgos**:
- **[P1]** Sin `dependabot.yml` ni `renovate.json` en el repo. Las dependencias no se actualizan automáticamente. `security.yml` corre `npm audit --omit=dev --audit-level=high` semanalmente — es el único gate. Sin PRs automáticos de parches de seguridad. Evidencia: `.github/` solo contiene `workflows/`. Remediation: crear `.github/dependabot.yml` con schedule semanal para `npm` + `github-actions`.
- **[P2]** `npm audit` configurado con `--audit-level=high` — no detecta `moderate` o `low` vulnerabilidades. Para PHI/PII, considerar `--audit-level=moderate`.
- **[P3]** `package-lock.json` presente (confirmado por `installCommand: npm ci` en `vercel.json`). `npm ci` verifica lockfile integrity en cada install. Estado positivo.
- **[P3]** `slackapi/slack-github-action@v1.26.0` y `gitleaks/gitleaks-action@v2` son Actions de terceros sin SHA pinning. Mayor riesgo que Actions de `actions/` porque son mantenidas por terceros.

**Estado**: ROJO

---

## 10. Incident Response

**Hallazgos**:
- **[P2]** `docs/15_production_runbook.md` y `docs/17_hipercuidado_runbook.md` cubren: escalación L1/L2/L3, SLAs de respuesta (P1 < 15 min), rollback Vercel, restore Supabase PITR, rotación de credenciales, matriz de comunicación. Cobertura buena.
- **[P2]** On-call rotation definida en `docs/17_hipercuidado_runbook.md` para hipercuidado post go-live (2 SRE + 2 Dev, turnos 12h). Sin evidencia de rotación BAU post-hipercuidado (día 15+). Remediation: definir schedule BAU en PagerDuty u OpsGenie antes de T+14.
- **[P2]** Sin postmortem template en `docs/`. El runbook menciona "post-mortem blameless en T+24h" pero no hay template estructurado. Remediation: crear `docs/templates/postmortem.md` con secciones: timeline, root cause, impacto, acciones correctivas, lessons learned.
- **[P3]** `scripts/golive-checklist.sh` referenciado en runbook pero sin evidencia de existencia. Remediation: crear o marcar como pendiente explícitamente.

**Estado**: AMARILLO

---

## Resumen Ejecutivo

| # | Categoria              | Estado   | P0 | P1 | P2 | P3 |
|---|------------------------|----------|----|----|----|----|
| 1 | Secrets Management     | AMARILLO |  0 |  0 |  2 |  3 |
| 2 | CI/CD Hardening        | ROJO     |  0 |  3 |  2 |  2 |
| 3 | Vercel Hardening       | AMARILLO |  0 |  0 |  3 |  2 |
| 4 | Supabase Hardening     | AMARILLO |  0 |  1 |  2 |  2 |
| 5 | Observabilidad         | AMARILLO |  0 |  1 |  3 |  1 |
| 6 | Backup / DR            | AMARILLO |  0 |  0 |  3 |  1 |
| 7 | Network Security       | ROJO     |  0 |  1 |  1 |  2 |
| 8 | Compliance Ops         | AMARILLO |  0 |  0 |  2 |  1 |
| 9 | Dependency Hardening   | ROJO     |  0 |  1 |  1 |  2 |
|10 | Incident Response      | AMARILLO |  0 |  0 |  3 |  1 |
|   | **TOTAL**              |          |  0 |  7 |  22|  17|

**0 P0 de infra. 7 P1 que deben cerrarse antes de pentest externo.**

---

## Top 10 Hallazgos P1 Infra

1. **Branch protection deshabilitada en `main`** — push directo sin CI ni review. Riesgo de deploy de código malicioso o accidental.
2. **Sin IP allowlist en Supabase Postgres** — BD directa accesible desde internet con credenciales comprometidas.
3. **Permissions default en 8/10 workflows** — `contents: write` heredado puede ser explotado en workflow comprometido para modificar el repo.
4. **Sentry probablemente no inicializado** — errores silenciosos en producción. PHI expuesta o bugs en runtime sin visibilidad.
5. **Sin dependabot / renovate** — vulnerabilidades en dependencias no parchadas automáticamente.
6. **Actions de terceros sin SHA pinning** (`gitleaks@v2`, `slackapi@v1.26.0`) — supply chain attack vector.
7. **Red puramente pública** entre Vercel y Supabase sin Private Link ni WAF — PHI en tránsito sobre internet público.
8. **GitHub Environments sin `required reviewers` verificados** — `db-migrate.yml` puede ejecutarse a producción sin approval real.
9. **CSP ausente** — XSS en app con PHI sin mitigación de headers. Cualquier XSS exitoso puede exfiltrar tokens de sesión.
10. **Dump de DR con PII sin cifrar** como GitHub Actions artifact con retención de 7 días.

---

## Plan Hardening Beta.21

### Sprint 1 — Inmediato (bloquea pentest)

| Tarea | Archivo | Owner |
|---|---|---|
| Habilitar branch protection en `main` con `required status checks: ci` | GitHub Settings | @SRE |
| Agregar `permissions: contents: read` a ci.yml, e2e.yml, a11y.yml, backup-drill.yml | `.github/workflows/*.yml` | @SRE |
| Crear `.github/dependabot.yml` (npm + github-actions, schedule: weekly) | `.github/dependabot.yml` | @SRE |
| Pin Actions a SHA en security.yml y todos los workflows críticos | `.github/workflows/` | @SRE |
| Verificar y agregar `required reviewers` a GitHub Environments production/staging | GitHub Settings | @SRE |
| Agregar CSP header en modo report-only a `vercel.json` | `vercel.json` | @Dev |
| Habilitar Supabase Network Restrictions — allowlist Vercel IPs + GitHub Actions | Supabase Dashboard | @SRE |

### Sprint 2 — Antes de go-live

| Tarea | Owner |
|---|---|
| Inicializar Sentry (`sentry.client.config.ts`, `sentry.server.config.ts`, `instrumentation.ts`) | @Dev |
| Cifrar dump en `backup-drill.yml` con GPG antes de upload artifact | @SRE |
| Ejecutar primer DR drill completo (`full-drill` mode) y documentar resultado | @SRE |
| Crear postmortem template `docs/templates/postmortem.md` | @SRE |
| Definir on-call schedule BAU (PagerDuty/OpsGenie) para post-hipercuidado T+14 | @PO + @SRE |
| Agregar `**/.env` a `.gitignore` raíz | @SRE |
| Definir procedure pseudonimización paciente para GDPR erasure | @DBA + @AS |

### Sprint 3 — Beta.21 hardening completo

| Tarea | Owner |
|---|---|
| CSP enforce con nonce (requiere refactor de inline scripts si existen) | @Dev |
| Alertas Sentry: failed logins bulk + exports masivos de pacientes | @Dev |
| Agregar Cloudflare WAF (managed ruleset OWASP) al DNS existente | @SRE |
| Lifecycle policy audit_log: export a S3 Glacier para registros >5 años | @SRE + @DBA |
| Nuevo workflow `slo-report.yml`: job semanal que calcula error budget y reporta a Slack | @SRE |
| Actualizar `npm audit --audit-level=moderate` en `security.yml` | @SRE |

---

## Postura ante Pentest Externo (Black Box)

**Falta para soportar un Black Box pentest profesional:**

| Item | Estado actual | Requerido |
|---|---|---|
| CSP header | AUSENTE | Obligatorio — sin CSP cualquier XSS encontrado es automáticamente P0 |
| Branch protection | AUSENTE | Debe estar activa antes del pentest — o el pentester puede hacer push a main como hallazgo trivial |
| IP allowlist Supabase | AUSENTE | Sin esto el pentester con credenciales comprometidas llega directo a la BD |
| Sentry activo | NO VERIFICADO | Sin APM no hay trazabilidad de los requests del pentester ni baseline de errores |
| Scope document | PENDIENTE | Definir: URLs en scope, credentials de prueba (rol mínimo), ventana horaria, exclusiones (UptimeRobot probes) |
| Pre-pentest snapshot | PENDIENTE | Backup Supabase antes de que inicien para poder comparar estado post-test |
| Bug bounty disclosure policy | AUSENTE | `/.well-known/security.txt` con contacto de respuesta |

**Estimado para estar "pentest-ready":** cerrar los 7 P1 + agregar CSP + `security.txt`. Tiempo estimado: 2 sprints de una semana. Con eso el Black Box encontrará la superficie real de la aplicación sin hallazgos triviales de configuración que contaminen el reporte.

---

## Sprint 2 Infra — Estado de Cierre (2026-05-30)

Fixes aplicados via PR que NO requerían intervención manual del owner:

| Fix | Hallazgo | PR | Estado |
|---|---|---|---|
| C1 — Dependabot config (npm + github-actions, weekly) | §9 P1 infra-P1-5 | [#384](https://github.com/edwinaml-su/his/pull/384) | MERGEADO |
| C2 — security.txt RFC 9116 + SECURITY.md | Postura pentest / infra-P1-B | [#385](https://github.com/edwinaml-su/his/pull/385) | MERGEADO |
| C3 — Permisos explícitos en 8 workflows (contenidos:read scope mínimo) | §2 P1 infra-P1-3 | [#402](https://github.com/edwinaml-su/his/pull/402) | ABIERTO |
| C4 — SHA pinning actions de terceros (gitleaks@v2, slackapi@v3.0.3) | §9 P3 infra-P1-6 | [#404](https://github.com/edwinaml-su/his/pull/404) | ABIERTO |

**Nota C4:** Al momento de crear la PR, Dependabot (activado por C1/#384) ya había actualizado automáticamente `slackapi/slack-github-action` de `v1.26.0` a `v3.0.3` (PR #388) y las actions oficiales de `actions/*` a versiones mayores (#389, #390, #391). C4 agrega el SHA commit inmutable como capa adicional de supply chain defense para los 2 actions de terceros restantes.

### TODOs que requieren intervención manual del owner (NO automatizables via PR)

| TODO | Dónde | Impacto si no se hace |
|---|---|---|
| Habilitar branch protection en `main` con required status checks CI + 1 review | GitHub Settings → Branches | Push directo a main sin CI — deploy de código no revisado |
| Configurar `required reviewers` en GitHub Environments `preview/staging/production` | GitHub Settings → Environments | `db-migrate.yml` puede correr contra producción sin approval real |
| Habilitar Network Restrictions en Supabase (allowlist Vercel IPs + GitHub Actions egress) | Supabase Dashboard → Settings → Network | BD Postgres directa accesible desde cualquier IP con credenciales comprometidas |
| Verificar/inicializar Sentry (`SENTRY_DSN` en Vercel + archivos config) | Vercel Environment Variables | Errores de producción silenciosos — PHI expuesta sin visibilidad |
