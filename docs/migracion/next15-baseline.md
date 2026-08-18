# Baseline pre-migración Next 14 → 15 → 16 (React 18 → 19)

> Generado por @QA, 2026-08-17, rama `feat/owasp-2025-hardening`, commit `ebce058`.
> Reproducible con `scripts/verify-migration.sh baseline` (ver abajo). Este documento es la
> línea base contra la que cada etapa de la migración se compara — no impresiones, evidencia.

## 0. Entorno de la corrida

| | |
|---|---|
| Node | v24.14.0 |
| npm | 11.9.0 |
| Next.js (instalado) | 14.2.35 (rango `^14.2.18`) |
| React / react-dom | 18.3.1 |
| @testing-library/react | 16.1.0 (ya soporta React 19 vía peerDeps `^18 \|\| ^19` — **no requiere bump** en el salto 18→19) |
| jsdom | 25.0.1 |
| vitest | 2.1.9 (rango `^2.1.8`) |
| Turbo | 2.9.16 |
| OS | Windows 11, Git Bash |

## 1. Typecheck — VERDE

```
npm run typecheck  → 7/7 workspaces OK (FULL TURBO, cache), 377ms
```
Workspaces: `@his/test-utils @his/ui @his/contracts @his/infrastructure @his/database @his/trpc @his/web`.

## 2. Lint — VERDE (0 errores)

```
npm run lint → 7/7 tasks OK, 10.8s, 0 cache
```
4 warnings preexistentes (no bloqueantes, no tocar en esta ola):
- `src/components/scanner/barcode-scanner.tsx:122` — `'e' is defined but never used`
- `src/components/triage-timer.tsx:93` — `'tick' is assigned a value but never used`
- `src/hooks/use-gs1-scanner.ts:4` — `'Gs1Data' is defined but never used`
- `src/lib/gs1/__tests__/parse-ai.test.ts:78` — `'raw' is assigned a value but never used`

## 3. Tests — VERDE, conteo exacto por workspace

| workspace | test files | tests | skipped | duración |
|---|---:|---:|---:|---:|
| `@his/infrastructure` | 9 | 159 | 0 | 3.46s |
| `@his/database` | 7 | 97 | 0 | 0.79s |
| `@his/contracts` | 45 | 1732 | 0 | 7.72s |
| `@his/web` | 62 | 678 | 0 | 12.97s |
| `@his/trpc` | 202 (194 passed) | 2928 (2904 passed) | 24 | 16.31s |
| **Total** | **325 archivos** | **5594 tests** | **24** | — |

`npm run test` (turbo, con cache) → 5/5 tasks OK, 582ms FULL TURBO (todo cache hit — la corrida real sin cache tardó ~41s agregando las duraciones por workspace de arriba).

`@his/bi` y `@his/ui` no tienen suite de tests propia (pasan por `passWithNoTests` / no aplican).

## 4. Build — VERDE

```
npm run build → @his/web:build OK, 1m17s (0 cache)
```
Warning preexistente (no bloqueante, no relacionado a la migración):
`⚠ Invalid next.config.mjs options: Unrecognized key(s) in object: 'viewTransition' at "experimental"`.

**First Load JS compartido:** `87.8 kB` (`chunks/1528-*.js` 31.9 kB + `chunks/1dd3208c-*.js` 53.6 kB + otros 2.3 kB).
**Middleware:** `81.5 kB`.

### 4.1 Tabla de tipos de ruta — conteo (LA SEÑAL MÁS IMPORTANTE)

| símbolo | tipo | cantidad |
|---|---|---:|
| `○` | Static (prerendered) | **20** |
| `●` | SSG (`generateStaticParams`) | **1** (`/analytics/[kpi]`, 5 params conocidos: K-CLI-01/02/03 + 2 más) |
| `ƒ` | Dynamic (server-rendered on demand) | **292** |
| **Total entradas de ruta** | | **313** |

Páginas HTML generadas en el paso "Generating static pages": **235/235**.

**Rutas `○` Static (las 20 — cualquier cambio a `ƒ` post-migración es regresión a investigar):**
`/`, `/_not-found`, `/login`, `/mfa`, `/mfa/enroll`, `/mi-expediente`, `/portal/citas`, `/portal/dashboard`, `/portal/login`, `/portal/recetas`, `/portal/register`, `/portal/resultados`, `/portal/settings/mfa`, `/portal/vacunacion`, `/portal/verify`, `/recover`, `/recover/reset`, `/signup`, `/solicitudes-arco`, `/sso`.

⚠️ `/login` y `/portal/*` estáticas son exactamente las rutas del incidente `#440` (`docs/runbooks/csp.md`) — hidratación bajo CSP rota cuando una página estática pierde el nonce/script inline. **Si alguna de estas 20 pasa a `ƒ` (o viceversa) durante la migración, es la primera señal a triangular con UAT manual en browser real**, no solo con el diff de este arnés.

**Rutas más pesadas (First Load JS, top 6 — vigilar regresión de bundle):**

| ruta | Size | First Load JS |
|---|---:|---:|
| `/workflow-designer/[codigo]/editar` | 167 kB | **299 kB** |
| `/workflow-designer/[codigo]` | 114 kB | **245 kB** |
| `/ece/historia-clinica/nueva` | 18.4 kB | **245 kB** |
| `/catalogs/laboratorio` | 5.49 kB | **245 kB** |
| `/countries` | 6.8 kB | 223 kB |
| `/ece/orden-ingreso/nuevo` | 6.71 kB | 222 kB |

Tabla completa de las 313 rutas (símbolo, tamaño, First Load JS) capturada en el log crudo del build baseline — regenerar con `scripts/verify-migration.sh baseline` en cada etapa; el script hace el diff automático de símbolo por ruta contra este documento (sección 4.1).

## 5. Riesgo de tests bajo React 19 + Next 15/16

### 5.1 Superficie tocada (62 archivos de test en `@his/web`)

| patrón | archivos | riesgo |
|---|---:|---|
| Importan `@testing-library/react` | 31 | Bajo — ya en RTL 16.1.0, peer-compatible con React 19. |
| Usan `act(`/`renderHook`/`waitFor`/`fireEvent` | 26 | Medio — React 19 cambió el comportamiento de `act()` en algunos edge cases async (warnings nuevos si falta `await`); revisar si aparecen warnings `An update to X was not wrapped in act(...)`. |
| Hacen `cleanup()` explícito vía `afterEach` | 31 (todos los que importan RTL lo hacen explícito, no dependen de auto-cleanup de vitest globals) | Bajo — el patrón ya es defensivo, no depende de `globals: true`. |
| `vi.mock("next/navigation", ...)` | 11 | Medio — mockean `useRouter`/`useSearchParams`/`usePathname`. Next 15 no cambia esta API en cliente; riesgo real es si algún componente empieza a usar `useParams` sin mockear. |
| Importan/mockean `next/headers` | 1 test (`mfa-guard.test.ts`) mockea `cookies()` como función **síncrona** (`cookies: () => ({ get: mockCookieGet })`) | **Alto** — ver 5.2. |

### 5.2 Hallazgo crítico: `cookies()`/`headers()` síncronos (bloqueante para 15→16)

**Esto ya rompió una vez** (ver CLAUDE.md, gotcha "nonce-based CSP" — el intento previo de subir a Next 16 falló por `headers()` volviéndose `Promise<ReadonlyHeaders>`). `cookies()` tiene el mismo cambio. Grep sobre producción encontró **12 call-sites síncronos** que romperán en build (no en runtime silencioso — TypeScript lo marca, pero solo si el código realmente actualiza los tipos de `next`):

- `apps/web/src/lib/auth/mfa-guard.ts:23`
- `apps/web/src/lib/supabase/server.ts:12`
- `apps/web/src/app/actions/break-glass.ts:149,175,176`
- `apps/web/src/app/actions/mfa.ts:418,561`
- `apps/web/src/app/actions/set-active-orgs.ts:48`
- `apps/web/src/app/actions/set-active-roles.ts:40`
- `apps/web/src/app/actions/set-establishment.ts:62`
- `apps/web/src/app/actions/set-organization.ts:59`
- `apps/web/src/app/api/trpc/[trpc]/route.ts:82`

Todos requieren `await cookies()`. El test `mfa-guard.test.ts` seguirá pasando igual (`await` sobre un valor no-Promise se resuelve trivialmente), pero **no detecta la regresión** — si `mfa-guard.ts` se actualiza a `await cookies()` sin que el mock cambie de forma, el test da falso verde mientras el código real puede fallar por otras razones de tipos. Al tocar estos 9 archivos en la etapa 14→15, actualiza el mock de `mfa-guard.test.ts` a devolver una promesa (`cookies: () => Promise.resolve({ get: mockCookieGet })`) para que el test ejerza la ruta real `await`.

### 5.3 Archivos de test en riesgo, ordenados por probabilidad de romper

1. `apps/web/src/lib/auth/__tests__/mfa-guard.test.ts` — mock de `cookies()` síncrono, arriba.
2. `apps/web/src/app/actions/__tests__/break-glass.test.ts` — ejercita `cookies()` de `break-glass.ts` (3 call-sites).
3. `apps/web/src/__tests__/middleware.test.ts` — el middleware usa `updateSession`/Supabase SSR sobre `NextRequest`; Next 15 no cambia el runtime Edge pero si `@supabase/ssr` bump acompaña la migración, revisar cookies API ahí también.
4. `apps/web/src/app/(auth)/login/__tests__/page.test.tsx` — mockea `next/navigation` + `next/font/google`; Next 15 no rompe `next/font` pero es el test más grande (7 tests, componente con más superficie).
5. `apps/web/src/app/(clinical)/ece/evolucion/nueva/__tests__/evolucion-page.test.tsx` y `.../antecedentes-section.test.tsx` — mayor uso de `act()`/`waitFor` anidados (reducers + modales); más expuestos a warnings nuevos de `act()` en React 19.
6. Los 26 archivos con `fireEvent`/`waitFor` en general — no se espera que rompan, pero son los primeros donde aparecerán warnings de consola nuevos (`act(...)`) que vale la pena tratar como señal, no como ruido.

Ningún archivo usa `react-dom/test-utils` directamente (import legacy de `act` que Next 19/RTL 16 desaprueban) — búsqueda específica no encontró coincidencias.

## 6. Flujos críticos SIN test automatizado (exigen UAT manual en cada etapa)

Ninguno de estos tiene cobertura Vitest de componente NI Playwright E2E — o la tiene parcial. Priorizados por lo que la migración puede romper en silencio:

| flujo | cobertura hoy | qué puede romper 14→15→16 |
|---|---|---|
| **Login (Supabase SSR + cookies)** | Vitest de UI (`login/__tests__/page.test.tsx`, mockea todo) + E2E `auth.spec.ts` (AUTH-01..04, corre nightly, no en cada PR). **Sin cobertura de la interacción real cookies↔middleware bajo Next 15/16.** | `cookies()` async (§5.2), posible cambio de `@supabase/ssr` en paralelo, y el precedente #440 (hidratación estática rota bajo CSP) — `/login` es ruta `○` Static. |
| **Portal del paciente** (`/portal/*`) | Solo `portal-arco.spec.ts` (solicitudes ARCO). **Sin E2E de `/portal/login`, `/portal/verify`, `/portal/dashboard`.** 9 de las 20 rutas estáticas son del portal. | Mismo riesgo de hidratación estática que login; auth propia por cookie `his.portal.session`, gateada en middleware — revisar `redirect()` de `next/navigation` si cambia de comportamiento. |
| **Middleware fail-closed** | `middleware.test.ts` (4 tests) — cubre el catch-all pero no corre contra un servidor Next real. | El middleware es Edge runtime; Next 15/16 cambia matchers/edge APIs en algunas versiones. Verificar que el fail-closed (línea 93 `middleware.ts`) sigue redirigiendo a `/login` y no degrada a pass-through. |
| **`/tareas` (bandeja)** | **Cero tests** — ni Vitest ni E2E encontrado (`task-actions-menu.tsx` no tiene `__tests__/`). | Es Server Component + Server Actions; cualquier cambio de comportamiento de `revalidatePath`/`redirect` en Server Actions bajo Next 15/16 no tiene red de seguridad. |
| **Formularios clínicos con Server Actions** (`break-glass.ts`, `mfa.ts`, `set-establishment.ts`, etc.) | Vitest solo para `break-glass.ts` (3 tests, mock parcial). Los demás actions (`mfa.ts`, `set-organization.ts`, `set-active-orgs.ts`, `set-active-roles.ts`) **sin test unitario**. | Mismo `cookies()` async (§5.2) — estos son los 9 archivos de la lista de arriba. |
| **Chat (streaming)** (`/api/chat`, `route.ts`) | **Cero tests** de streaming — `chat-widget-markdown.test.ts` prueba solo el parseo de markdown, no el streaming HTTP real. Sin E2E. | Route Handlers con `ReadableStream`/SSE son sensibles a cambios de runtime (Edge vs Node) entre versiones de Next; validar manualmente que el streaming no se buferee entero antes de mostrar texto. |

**Acción QA recomendada antes de avanzar a 15→16:** UAT manual (checklist corto, no automatizado en esta ola) de estos 6 flujos en cada etapa, con consola del navegador abierta verificando ausencia de `Refused to execute inline script` (lección #440) y de errores de hidratación.

## 7. Cómo se regeneró este baseline

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```
Logs crudos (build/test/typecheck/lint) archivados en el scratchpad de la sesión que generó este documento; no se versionan. `scripts/verify-migration.sh` reproduce los mismos 4 pasos y compara automáticamente la tabla de §4.1 contra el output vigente.
