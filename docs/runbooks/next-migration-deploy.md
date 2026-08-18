# Runbook: Migración Next 14 → 15 → 16 (React 18 → 19) — HIS Multipaís

Nivel: SRE / Dev lead
Refs: `docs/15_production_runbook.md`, `docs/runbooks/owasp-2025-deploy.md` (mismo formato), `docs/runbooks/csp.md`, CLAUDE.md §Gotchas (incidente Next 16 `headers()` async, revertido)

---

## 0. Contexto

Rama `feat/next16-migration`. Objetivo: `next` 14.2.18 → 15.5.23 → 16.3.1, `react`/`react-dom` 18.3.1 → 19.x.

**Esta ola (@SRE) es solo infra/CI — preparación, no el bump de dependencias.** Lo ya aplicado en
este commit:

| Cambio | Archivos |
|---|---|
| Node `20` → `24` en todos los workflows que arrancan Node (alinea con `engines.node: "24.x"` de `package.json` raíz, nunca aplicado en CI hasta ahora) | `ci.yml`, `e2e.yml`, `e2e-smoke.yml`, `a11y.yml`, `perf.yml`, `security.yml` (2 jobs), `compliance.yml`, `security-alerts.yml`, `db-migrate.yml` |
| `ARG NODE_VERSION=20-alpine` → `24-alpine` | `Dockerfile` |
| Comentario de versión runtime | `infra/k8s/base/deployment-web.yaml` |
| Dependabot: grupo `next-ecosystem` admite minor+patch (el ignore global de majors sigue bloqueando 16→17/19→20) | `.github/dependabot.yml` |

**Node 24 no es opcional:** Next 16 exige Node ≥20.9; el repo ya declaraba `24.x` en `engines` desde
antes de esta rama — CI corriendo en `20` era drift preexistente, esta migración solo lo hizo visible.

El bump real de `next`/`react`/`react-dom`/`eslint-config-next` (código en `apps/web/`) es trabajo de
@Dev, **no** de esta ola. Lo que sigue es la guía de despliegue para cuando ese PR esté listo.

---

## 1. Impacto en el pipeline — qué se rompe y corrección

| Archivo/área | Qué se rompe con Next 15/16 | Corrección |
|---|---|---|
| `ci.yml`/`e2e*.yml`/`a11y.yml`/`perf.yml`/`security*.yml`/`compliance.yml`/`db-migrate.yml` | Node `20` no viola el mínimo (`setup-node` resuelve `20` a la última `20.x`, que ya es ≥20.9), pero diverge de `engines.node: "24.x"` — riesgo de "funciona en CI, falla en local/Vercel" si algún dev tiene Node 24 con una API distinta | **Aplicado esta ola:** Node `24` en todos. |
| `vercel.json` `installCommand` | Sin cambio — `npm ci && npm run -w @his/database generate` sigue siendo correcto; el `prisma generate` no depende de la versión de Next | Ninguna. Verificar en Vercel Dashboard → Settings → Node.js Version que esté en `24.x` (o `Auto`, que lee `engines.node`) — **acción UI de Avante, no de código**. |
| `Dockerfile` | `ARG NODE_VERSION=20-alpine` por debajo del `engines.node` declarado | **Aplicado esta ola:** `24-alpine`. Ruta de standalone (`.next/standalone/apps/web/server.js`) no cambia de formato en 15/16 — sigue espejando la raíz del monorepo vía `outputFileTracingRoot`. |
| `apps/web/next.config.mjs` (fuera de scope de esta ola, **de @Dev**) | En Next 15 `experimental.outputFileTracingRoot` y `experimental.serverComponentsExternalPackages` se mueven a top-level (`outputFileTracingRoot`, `serverExternalPackages`). Si no se actualiza, el build probablemente sigue funcionando con warning de deprecación, pero **verificar explícitamente que `.next/standalone` sigue generándose completo** (sin esto el `COPY` del Dockerfile copia un standalone roto y el contenedor arranca sin las deps de `@his/*`). | @Dev debe correr `npm run build` local + inspeccionar `apps/web/.next/standalone/apps/web/server.js` antes de abrir el PR. |
| `apps/web/src/middleware.ts` (fuera de scope, **de @Dev**, pero **CRÍTICO para @SRE monitorear**) | Next 16 deprecia `middleware.ts`/`export function middleware` en favor de `proxy.ts`/`export function proxy`. El runtime pasa de **Edge a Node.js** (ya no configurable) — afecta cold starts y es la respuesta de Next a CVE-2025-29927 (bypass de auth en Middleware bajo Edge). Codemod: `npx @next/codemod@canary middleware-to-proxy`. | Este archivo es el que implementa el fail-closed de A09/A10 (Beta.23 OWASP) — login personal y portal. Un fallo en la migración no rompe el build, rompe **auth silenciosamente**. Ver §3 checklist UAT. |
| `release-image.yml` | Sin cambio de workflow — construye con el `Dockerfile` ya actualizado. El job corre en cada PR (`pull_request:`) sin publicar, así que valida el build Docker de la migración **antes** del merge, gratis. | Ninguna acción; confirmar que el job pasa en el PR de @Dev. |
| `security.yml` | `npm audit --omit=dev --audit-level=high` está en rojo **a propósito** por CVEs de Next 14 (comentario ya en el workflow, línea ~40) | Tras el bump real, confirmar que el job vuelve a verde — si sigue rojo, son vulns nuevas de otras deps, no las que motivaron el rojo actual. No se toca el workflow para esto (es autocorrectivo). |

---

## 2. Dependabot — por qué no se quita el `ignore` global

El `ignore: version-update:semver-major` global (`.github/dependabot.yml`) es lo que impidió que
Dependabot repitiera el incidente Beta.22 (`next 14→16` automático simultáneo con `typescript 5→6`,
`vitest 2→4`, `@prisma/client 5→7`). Esta migración es **manual precisamente porque** ese ignore
existe — quitarlo no "limpia deuda", reabre el mecanismo que causó el incidente para **todas** las
dependencias del monorepo, no solo `next`. Se mantiene sin cambios.

Lo que sí se actualizó: el grupo `next-ecosystem` pasó de agrupar solo `patch` a `minor + patch` —
una vez estable en Next 16.x, los ajustes dentro del mismo major (16.3→16.4) se agrupan en un solo PR
en vez de generar ruido individual, igual que ya hace `dev-tools`. El bloqueo de majors (16→17,
19→20) sigue intacto.

---

## 3. Plan de despliegue por etapas

1. @Dev abre PR con el bump real (`package.json`/`package-lock.json`, codemod middleware→proxy,
   fixes de `next.config.mjs`, `headers()`/`cookies()` async donde aplique).
2. CI verde (`ci.yml`, ya en Node 24) + `release-image.yml` construye la imagen Docker sin publicar.
3. Vercel genera **Preview** automático del PR — **no mergear a `main` sin probar el Preview primero**.
4. **UAT manual en browser real sobre el Preview URL** (checklist abajo) — obligatorio. Lección
   #440 (CLAUDE.md): build verde + axe verde **no** detectan hidratación rota; axe inspecciona el DOM
   SSR que carga igual aunque el cliente esté roto.
5. Merge a `main` → Vercel Production auto-deploy (~2-4 min).
6. Monitoreo reforzado 2 h (§4).

### Checklist UAT manual (Preview, antes de merge)

- [ ] DevTools Console limpia de `Hydration failed`, `Text content does not match`, `Minified React
      error #418/419/425` en: `/dashboard`, `/triage`, `/ece/historia-clinica/nueva`,
      `workflowInbox` (bandeja), `/lis/orders`.
- [ ] Login de personal (`/login`) y portal (`/portal/login`) completan **sin loop de redirect** —
      valida que `proxy.ts` (o `middleware.ts` si @Dev no migró aún) sigue evaluando sesión.
- [ ] Ningún `Refused to execute inline script` en consola (confirmaría que la CSP con
      `'unsafe-inline'` sigue siendo compatible con la hidratación — ver §4 CSP).
- [ ] Server Actions críticas responden: break-glass, MFA enroll/verify, envío de chat.
- [ ] `/api/health` responde 200 con `APP_VERSION` = SHA del Preview.
- [ ] Una ruta con datos dinámicos por usuario (censo, bandeja) NO se sirve cacheada/stale entre
      dos usuarios distintos (riesgo si algo quedó marcado estático que debía ser dinámico).

---

## 4. Señales de alarma — primeras 2 horas (post-merge a producción)

Cadencia: cada 15 min primera hora, cada 30 min segunda hora (mismo criterio que
`docs/runbooks/owasp-2025-deploy.md` §4, agresivo porque toca middleware/proxy y rendering).

| Señal | Umbral de alarma | Umbral de abortar (rollback) |
|---|---|---|
| Error rate global | >0.3% en 5 min | **>1% sostenido 5 min** |
| `Hydration failed` / errores React minificados reportados por usuarios o Sentry (si `SENTRY_DSN` activo) | 1 ocurrencia → investigar | **Confirmado en producción real, no solo un usuario** → rollback |
| 500/502 en rutas que antes eran estáticas | 1 ocurrencia → investigar | **Sostenido** → rollback |
| Latencia p95 en rutas protegidas por `proxy.ts`/`middleware.ts` (runtime nodejs vs edge) | +50% vs baseline pre-migración | **+100% sostenido 15 min** → rollback (cold starts de runtime nodejs) |
| Loop de redirect en `/login` o `/portal/login` | 1 ocurrencia → investigar | **Inmediato — P1** (reabre A10 si el fail-closed quedó roto) |
| `release-image.yml` (`main`, post-merge) falla al publicar | 1 ocurrencia | Bloquea la ruta K8s/on-prem, no bloquea Vercel — investigar sin urgencia P1 |

Fuentes: Vercel Analytics + `vercel logs`, Sentry si `SENTRY_DSN` activo (pendiente de Avante, ver §5).

---

## 5. Rollback

**Método principal (Vercel):** `vercel promote <deploy-anterior>` — instantáneo, sin rebuild, deploys
inmutables. Igual que `docs/15_production_runbook.md` §5.

**Ruta K8s/Docker (si está en uso):** el tag `latest` en GHCR apunta al último build de `main`;
volver al tag `sha-<commit-anterior>` conocido bueno en `infra/k8s/base/deployment-web.yaml` (o
`kubectl set image`) y `kubectl rollout undo` si ya se aplicó.

**Si el rollback es por middleware/proxy roto** y no hay tiempo de investigar la causa: no hay
forward-fix seguro para auth — usar rollback completo, no parchear en caliente (a diferencia del
patrón de `owasp-2025-deploy.md` §5 con forward-fixes por control, aquí el archivo es único y
central).

---

## 6. CSP — veredicto sobre nonce (con evidencia, no bloquea esta migración)

**Pregunta:** ¿Next 15/16 abre la puerta a nonce-based CSP (remover `'unsafe-inline'` de
`script-src`), dado que el intento anterior (incidente #440, revertido) falló porque Next 14 solo
inyecta el nonce en páginas con render dinámico, no en las prerenderizadas?

**Evidencia (documentación oficial Next.js, guía CSP + discusión #80997 del repo vercel/next.js,
2026):** la limitación es **arquitectónica, no de versión**. El nonce lo genera el middleware/proxy
por request; una página estática se renderiza una sola vez en build time, así que no puede llevar un
nonce que cambia por request — sigue siendo así en Next 15 y 16. Nonce-based CSP **sigue exigiendo
`dynamic rendering`** (o forzar cada página a `force-dynamic`, lo que mata el prerender y el cacheo
en edge/CDN). Next 16 además renombra `middleware.ts`→`proxy.ts` y fuerza el runtime a `nodejs`
(antes edge), lo cual no cambia esta restricción de rendering, solo el runtime que la ejecuta.

**Veredicto: mantener el baseline actual** (`script-src 'self' 'unsafe-inline'` estático en
`next.config.mjs`, HSTS + `frame-ancestors 'none'` + `object-src 'none'` dando el grueso del valor de
seguridad — como ya documenta `docs/runbooks/csp.md`). Forzar `dynamic rendering` global para
habilitar nonce en una app clínica con docenas de rutas mayormente estáticas/ISR no es un tradeoff
razonable solo por este framework bump.

**Nota para backlog (no ejecutar en esta migración):** Next 15+ ofrece SRI (Subresource Integrity)
experimental para App Router como alternativa "static-friendly" a nonce — no requiere dynamic
rendering. Es experimental y un cambio de superficie distinto (integridad de recursos, no bloqueo de
inline scripts); evaluar en un sprint de hardening dedicado, no como parte de este bump de framework.

---

## 7. Secrets de Actions

El upgrade de framework en sí **no añade secrets nuevos** — no hay integración externa nueva, es un
bump de `next`/`react`. Nota independiente (no bloqueante para este deploy, ya detectada antes de
esta rama): el repo tiene 0 secrets configurados en Settings → Secrets → Actions, lo que deja inertes
`perf.yml` (`E2E_ADMIN_EMAIL/PASSWORD`, `NEXT_PUBLIC_SUPABASE_*`) y el job `supabase-advisors` de
`security-alerts.yml` (`SUPABASE_ACCESS_TOKEN`). Ninguno de los dos bloquea el deploy de Next 16 —
ambos ya estaban inertes antes de esta migración — pero significa que el Lighthouse nightly y el
advisor check no van a correr realmente sobre el Preview/Production de esta migración hasta que
Avante configure esos secrets. Es trabajo de Avante (credenciales), no de @SRE.

---

## 8. Referencias

- `docs/15_production_runbook.md` — rollback general, escalation.
- `docs/runbooks/owasp-2025-deploy.md` — mismo formato, precedente de despliegue por control.
- `docs/runbooks/csp.md` — estado actual y rollback de CSP.
- CLAUDE.md §Gotchas — incidente Next 16 `headers()` async revertido (nonce CSP), lección #440.
