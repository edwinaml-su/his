# Remediación OWASP Top 10:2025 — HIS Avante

**Fecha:** 2026-08-17 · **Rama:** `feat/owasp-2025-hardening` · **Base:** `main` @ `ebce058`
**Auditoría previa:** [`2026-05-30_pentest_owasp_static.md`](2026-05-30_pentest_owasp_static.md) (Top 10 **2021**)

---

## 1. Por qué cambia la referencia

La edición vigente del estándar es **OWASP Top 10:2025** (owasp.org/Top10/2025/). Reordena
las categorías de 2021 y añade dos:

| 2025 | Categoría | Relación con 2021 |
|---|---|---|
| A01 | Broken Access Control | = A01:2021 |
| A02 | Security Misconfiguration | ↑ desde A05:2021 |
| A03 | **Software Supply Chain Failures** | **NUEVA** — amplía A06:2021 (Vulnerable & Outdated Components) a integridad de build, lockfiles, SBOM y procedencia |
| A04 | Cryptographic Failures | ↓ desde A02:2021 |
| A05 | Injection | ↓ desde A03:2021 |
| A06 | Insecure Design | = A04:2021 |
| A07 | Authentication Failures | = A07:2021 |
| A08 | Software or Data Integrity Failures | = A08:2021 |
| A09 | Security Logging and **Alerting** Failures | = A09:2021 (añade alerting) |
| A10 | **Mishandling of Exceptional Conditions** | **NUEVA** — manejo de errores, fail-safe defaults, fuga de detalle interno. SSRF (A10:2021) se absorbe en A01/A06 |

Este documento reaudita el HIS contra la lista 2025 y registra la remediación aplicada.

---

## 2. Estado por categoría

| 2025 | Antes (30-may) | Ahora | Evidencia |
|---|---|---|---|
| A01 Broken Access Control | 🟡 | 🟢 | `withTenantContext` en los 3 routers PHI que faltaban + gate de borde del batch tRPC |
| A02 Security Misconfiguration | 🔴→🟢 | 🟢 | Headers/CSP ya cerrados en Beta.21; SQL 196 cierra las RPC SECDEF expuestas a `anon` |
| A03 Software Supply Chain | 🟡 | 🟢 | **1 sola vulnerabilidad en producción** (`expr-eval`, sin fix upstream, mitigada — ver §6 H7). Next 16.3.1 + React 19.2.8 cierran los ~21 advisories de Next 14. SBOM + verificación de firmas en CI |
| A04 Cryptographic Failures | 🟢 | 🟢 | argon2, Vault MFA portal, sin secretos en repo (sin cambios) |
| A05 Injection | 🟡 | 🟢 | Renderer del chat endurecido + allowlist en el motor de fórmulas |
| A06 Insecure Design | 🟡 | 🟢 | Rate limit global en `/api/trpc` — con cupo por procedure y tope de batch (ver §6, H1) |
| A07 Authentication Failures | 🟡 | 🟢 | Enforcement MFA (apagado por defecto) + protección de contraseñas filtradas |
| A08 Data Integrity | 🟢 | 🟢 | Cadena SHA-256 intacta; sin UPDATE/DELETE a `audit_log` desde la app |
| A09 Logging and Alerting | 🟡 | 🟢 | Redacción de PHI en logs + auditoría del historial de IA |
| A10 Mishandling of Exceptional Conditions | — | 🟢 | Middleware fail-closed; errores sin detalle interno al cliente |

---

## 3. Detalle de la remediación

### A01 — Broken Access Control

**Hallazgo (P1/P2, mayo):** `workflow-inbox`, `nutrition` y `census` leían/escribían PHI con el
rol Postgres de Supabase, que tiene `BYPASSRLS`. El aislamiento multi-tenant dependía sólo del
filtro JS `organizationId`; RLS de BD no se evaluaba.

**Aplicado** — commit `fbe6722`:

- `workflow-inbox.router.ts` (8 procedures, ~30 `$queryRawUnsafe` sobre schema `ece`),
  `nutrition.router.ts` (14 procedures) y `census.router.ts` (4 procedures) corren dentro de
  `withTenantContext` → `SET LOCAL ROLE authenticated` + GUC de tenant.
- `withTenantContext` acepta `timeout`/`maxWait`: `miBandeja` hace 30+ queries por request y
  con el default de Prisma (5 s) la transacción abortaba a mitad de bandeja.
- `nutrition.order.create` pasa de dos transacciones a una: validaciones, `create` y evento de
  dominio ven las mismas filas. **Corrección (H6, revisión @QA):** unificar en una transacción
  NO cierra un TOCTOU por sí solo — `withTenantContext` no fija `isolationLevel` (queda en READ
  COMMITTED) y `assertEnteralParenteralExclusivity` seguía siendo un `findFirst` sin bloqueo; dos
  `order.create` concurrentes para el mismo encounter podían leer "sin conflicto" ambos y crear
  una orden ENTERAL y una PARENTERAL simultáneas. El cierre real es un `SELECT ... FOR UPDATE`
  sobre la fila del encounter antes del chequeo de exclusividad (`lockEncounterRow` en
  `nutrition.router.ts`), que serializa a las transacciones concurrentes. Un constraint de BD
  sería más barato — queda propuesto para @DBA, no aplicado en este PR.
- Regresión de seguridad en `workflow-inbox.rls.test.ts`: cada procedure debe abrir transacción
  y demotar el rol antes de tocar PHI.

**Preflight verificado contra producción:** `authenticated` tiene `SELECT` en todas las tablas
implicadas y todas tienen policies (los únicos objetos sin policy son las 4 tablas `secuencia_*`
y `RateLimitHit`, deny-all a propósito).

**Residual cerrado** — commit `9b3931e`: el gate de borde de `/api/trpc` comparaba prefijos sobre
la ruta completa, pero `httpBatchLink` codifica el batch como `/api/trpc/proc1,proc2`. Bastaba
poner un procedure público de primero (`/api/trpc/locale.x,patient.list`) para que **todo** el
batch pasara el middleware. `isPublicTrpcPath()` parsea el batch y exige que *todos* sean
públicos; URI malformada → no público.

### A02 — Security Misconfiguration

**SQL 196** (aplicado a producción): 8 funciones `SECURITY DEFINER` eran invocables por `anon`
vía `/rest/v1/rpc/<fn>` con la anon key pública. La más grave, `get_portal_mfa_secret`, devuelve
el secreto TOTP del portal **en claro**.

| Función | anon | authenticated | Motivo |
|---|---|---|---|
| `get_portal_mfa_secret`, `set_portal_mfa_secret_vault` | revocado | revocado | la app las llama con el rol base, sin demote |
| `cleanup_rate_limit_hits`, `(fn_)expire_pharmacy_reservations` | revocado | revocado | sin call sites en la app (cron/service_role) |
| `fn_next_{cuenta,expediente,no_identificado,solicitud_imagen}` | revocado | **conservado** | la app las invoca con el `tx` demotado de `withTenantContext` |
| `current_portal_account` | revocado | **conservado** | la evalúan las policies RLS del portal |

También `gs1.set_updated_at` recibe `SET search_path` (último advisor 0011 pendiente).

**Advisors tras aplicar:** 0 de tipo `anon_security_definer_function_executable`, 0 de
`function_search_path_mutable`. Quedan 5 WARN `authenticated_security_definer` (aceptados y
justificados arriba) y 5 INFO `rls_enabled_no_policy` (deny-all deliberado).

### A03 — Software Supply Chain Failures (categoría nueva)

Era la peor del proyecto: **88 vulnerabilidades (6 críticas, 24 high)**, y el gate semanal
`npm audit --omit=dev --audit-level=high` llevaba tiempo en rojo.

| Acción | Efecto |
|---|---|
| `npm audit fix` (no-breaking) | ws, nanoid, js-yaml, brace-expansion, http-proxy-middleware, extract-zip, puppeteer, lighthouse, ip-address |
| `jspdf` 2.5.2 → 4.2.1 | 12 advisories, 1 crítica (inyección de objetos PDF, ejecución de JS vía AcroForm/addJS). El repo sólo genera documento + tablas |
| `nodemailer` 6.10 → 9.0.5 | 8 advisories (inyección de comandos SMTP por CRLF, TLS sin validar en OAuth2, SSRF vía `raw`) |
| `@cubejs-backend/*` fuera del árbol | 1 crítica + 13 high. Toda versión publicada arrastra `decompress`/`extract-zip`/`request` sin fix. `packages/bi` es config-only: nadie lo importa, no hay job de CI, no se despliega. Se instalan bajo demanda (documentado en su README) |
| `expr-eval` — **sin fix upstream** | Ver abajo (A05) |
| SBOM CycloneDX en CI | Inventario de dependencias directas y transitivas, artefacto 90 días |
| `npm audit signatures` en CI | Verifica firmas del registry contra el lockfile |

**Resultado: 39 vulnerabilidades totales, 26 en dependencias de producción, 0 críticas en
producción.**

> **CERRADO el mismo día.** Lo anterior era: "el proyecto corre Next 14, con ~21 advisories
> corregidos en la línea 15.5.x — es la mayor exposición de cadena de suministro". La migración
> se ejecutó por etapas verificadas (14.2.35 → 15.5.23 + React 19.2.8 → 16.3.1), cada una con
> `scripts/verify-migration.sh` en PASS: typecheck, lint, 5.570 tests, build y diff de tipos de
> ruta contra baseline. **La auditoría de dependencias de producción pasó de 26 vulnerabilidades
> (5 high) a 1** — `expr-eval`, sin fix upstream y ya mitigada. Detalle en §7.

Resto de mayores no tomados, por política de `dependabot.yml` (`ignore: semver-major`):
`vitest`/`@vitest/coverage-v8` 4 (dev, 2 críticas), `@sentry/nextjs` 10, `eslint-config-next` 16.

### A05 — Injection

**Chat widget** (commit `e4f5984`): `renderMarkdown` alimenta un `dangerouslySetInnerHTML` con
texto del modelo, que puede citar chunks de BD vía RAG. El pipeline escapaba primero y por eso
no era explotable, pero no había red de seguridad ante futuras transformaciones:

- `escapeHtml` extraído y ampliado (comilla simple incluida).
- Invariante de salida: si tras las transformaciones aparece un tag fuera de la allowlist
  (`a/strong/em/code/ol/ul/li`) se devuelve el texto escapado.
- Los enlaces protocol-relative (`//evil.com`) ya no se linkifican: parecían internos y
  navegaban fuera del dominio.
- 20 tests, 14 de ellos con payloads XSS verificados **sobre el DOM resultante**, no sobre el
  string (una aserción sobre el string da falsos positivos con el texto ya escapado).

**Motor de fórmulas clínicas** (commit `9604242`): `expr-eval` está sin mantenimiento y arrastra
dos advisories sin fix en ninguna versión publicada — prototype pollution
(`GHSA-8gw3-rxh4-v6jx`) y funciones sin restringir en `evaluate` (`GHSA-jc85-fpwf-qm7x`). La
expresión **no es código**: es dato editable desde `/calculadoras` y persistido en
`ece.calculadora_version`. Mitigación en dos capas, sin cambiar la semántica clínica:

1. Allowlist sintáctica (números, identificadores, operadores, paréntesis, comas; sin corchetes,
   sin comillas, sin `__proto__`/`constructor`/`prototype`), aplicada al guardar y al evaluar.
2. Scope con prototipo nulo.

Validado contra las **176 versiones de fórmula en producción**: ninguna usa caracteres fuera de
la allowlist (charset real: `_ - , : ? . ( ) * / ^ + < = >`).

### A06 — Insecure Design

Rate limit global en `/api/trpc` (commit `7bffa14`), con dos regímenes por coste y modelo de
amenaza:

- **Sin sesión** → ventana compartida en Postgres (`RateLimitHit`) por IP, 60/min. Es la
  superficie pre-auth y un atacante distribuido debe verse frenado globalmente.
- **Con sesión** → ventana en memoria del proceso por usuario, 600/min. La app hace decenas de
  llamadas tRPC por pantalla; dos queries extra por request duplicarían la carga de BD del
  sistema. Es un tope anti-bucle, no una cuota de negocio.
- Falla **abierto** si el store revienta: un rate limiter no puede tumbar la atención clínica.

### A07 — Authentication Failures

El TOTP de personal ya existía (`/mfa/enroll`, `/mfa`, backup codes, `User.mfaEnabled`) pero
**nadie lo exigía**: `verifyMfa` marcaba la BD y devolvía ok sin dejar rastro en la sesión, y
ningún gate mandaba a `/mfa`. Commit `66fb6fc`:

- Marca de sesión **firmada** (HMAC-SHA256, ligada al `userId`, TTL 12 h). Una cookie httpOnly
  sin firmar sería trivial de falsificar con curl usando la contraseña robada — justo el
  escenario que MFA cubre.
- Gate en los layouts `(clinical)`/`(admin)` → redirect a `/mfa`, y gate en `tenantProcedure`
  vía `ctx.mfaSatisfied` → el dato tampoco sale por la API, no sólo la página.
- Política por entorno `MFA_REQUIRED_ROLE_CODES` (CSV de roles). **Vacía = apagado**, que es el
  default: cero cambio de comportamiento hasta que Avante enrole a los usuarios privilegiados.
  Roles configurados sin `MFA_SESSION_SECRET` válido → deniega (fail-closed).
- Protección de contraseñas filtradas (HaveIBeenPwned) **activada** en el proyecto Supabase de
  producción.

> **Pendiente de Avante:** enrolar DIR/ARCH/ADMIN en `/mfa/enroll`, definir
> `MFA_SESSION_SECRET` en Vercel y recién entonces poblar `MFA_REQUIRED_ROLE_CODES`. Activarlo
> antes del enrolamiento deja a esos usuarios fuera.

### A09 — Security Logging and Alerting Failures

- `redactPhi()` para `console.*`: uuid, DUI, NIT, email y correlativos largos. Cableado en el
  `onError` de tRPC (que antes loggeaba el objeto de error completo, con el input de la llamada)
  y en el log del middleware.
- **SQL 197** (aplicado a producción): triggers de auditoría en `chat_session` y `chat_message`.
  El historial del copiloto son consultas clínicas de personal identificado con contexto de
  paciente y fuentes RAG; no entraba en la cadena SHA-256. `audit.fn_audit_row` ahora resuelve
  también columnas snake_case — las tablas creadas a mano quedaban con `organizationId NULL` en
  la auditoría.
- `chat_knowledge_chunk` **no** se audita: es el índice de conocimiento de la app (sin PHI de
  paciente) y se regenera por lotes.

### A10 — Mishandling of Exceptional Conditions (categoría nueva)

El catch-all del middleware degradaba a `NextResponse.next()` ante **cualquier** error: un fallo
del gate de borde dejaba pasar requests a rutas protegidas sin evaluar sesión (fail-open).
Ahora falla **cerrado**: las rutas públicas se siguen sirviendo, las protegidas van a `/login`
(o `/portal/login` si venían del portal).

Los errores al cliente ya no arrastran detalle interno: `TRPCError` con mensaje de negocio, y el
detalle correlacionable va al log redactado + Sentry (que tiene el filtro de PII de Beta.22).

---

## 4. Verificación

| Gate | Resultado |
|---|---|
| `npm run typecheck` | 7/7 workspaces verdes |
| `npm run test` | 5/5 workspaces; **3.536 tests** (2.891 trpc + 630 web + 154 infrastructure, +85 nuevos) |
| `npm run build` | verde |
| Advisors Supabase (security) | 0 ERROR, 0 WARN de SECDEF-anon / search_path |
| `npm audit` | 39 total · 26 en prod · **0 críticas en prod** |
| `npm audit --omit=dev --audit-level=high` | **rojo** — por Next 14 (ver A03) |

**Tests nuevos:** `workflow-inbox.rls.test.ts` (4), `engine-security.test.ts` (8),
`chat-widget-markdown.test.ts` (20), `rate-limit-global.test.ts` (6), `log-redact.test.ts` (7),
`mfa-session.test.ts` (15) + helper `installTenantContextMock`.

---

## 5. Acciones pendientes de Avante

| # | Acción | Dónde | Tipo |
|---|---|---|---|
| 1 | **Migración a Next 15.5.x** (~21 advisories, varios high) | sprint dedicado + UAT | Ingeniería |
| 2 | Enrolar DIR/ARCH/ADMIN en `/mfa/enroll`, definir `MFA_SESSION_SECRET`, activar `MFA_REQUIRED_ROLE_CODES` | Vercel + operación | Operación |
| 3 | Subir `password_min_length` (hoy **6**) y exigir clases de caracteres | Supabase → Auth settings | Config UI |
| 4 | Activar `SENTRY_DSN` en prod + DPA con Sentry (alerting de A09) | Vercel + legal | Config UI |
| 5 | Pentest externo activo (ZAP/Burp) — el gate `US-21-E2` nunca se ejecutó | `docs/pentest/` | Contratación |
| 6 | Reevaluar `expr-eval`: si aparece fork mantenido, migrar y quitar la allowlist | backlog | Ingeniería |

---

## 6. Ciclo de revisión SDLC (2026-08-17, post-remediación)

La remediación se sometió al ciclo completo con @AE (gobernanza), @AS (arquitectura
adversarial), @QA (calidad), @QAF (BDD), @PO (backlog) y @SRE (entrega). **Dos hallazgos P1
invalidaban controles que las §2-§3 daban por cerrados** — corregidos en `c440473`:

| # | Hallazgo | Cierre |
|---|---|---|
| H1 **P1** | El rate limit contaba 1 request HTTP = 1 hit, pero `httpBatchLink` empaqueta N procedures en un POST: un batch de 200 mutations ×60/min pasaba el límite de 60/min. El control A06 quedaba neutralizado por el propio transporte. | Cupo por procedure (`count`) + `TRPC_MAX_BATCH_SIZE=20` con 413 antes de tocar sesión/BD. Parser compartido con el gate de borde para que no diverjan. |
| H2 **P1** | `miBandeja` retenía una conexión del pool (~15 en session mode) hasta 20 s con ~30 queries, y la página hacía `refetchOnWindowFocus`: un cambio de turno reproducía el `EMAXCONNSESSION` ya sufrido. | 6 bloques cortos (5-8 s) con el mapeo JS fuera de transacción; `contadorBadge` 20 s→5 s; `refetchOnWindowFocus` desactivado en esa query. |
| H3 P2 | La marca de sesión MFA sobrevivía al logout y al reset de contraseña (estación clínica compartida). | Se limpia en logout manual, logout por inactividad y reset de contraseña. |
| H4 P2 | El gate de MFA fallaba **abierto**: `mfaSatisfied === undefined` significaba "no bloquear", y un server action tenant-scoped que no lo evaluara bypaseaba la política en silencio. | Con la política activa, `undefined` + tenant presente ahora deniega. |
| H5 P2 | El bucket anónimo se armaba con `x-forwarded-for`, que el cliente puede controlar: rotándolo se evadía el límite pre-auth. | `x-vercel-forwarded-for` → `x-real-ip` → `x-forwarded-for`. |
| H6 P2 | Afirmación falsa en §3 A01 (corregida allí). | `SELECT ... FOR UPDATE` sobre el encounter. |
| H7 | La allowlist de fórmulas filtraba caracteres pero no **nombres de función**: los built-ins de `expr-eval` fuera de `FUNCTION_NAMES` pasaban — que es justo GHSA-jc85-fpwf-qm7x. | Allowlist de funciones. Verificado contra las 176 fórmulas de producción: usan 8, todas permitidas. |
| H8 | **LOPD (@AE):** el trigger de SQL 197 copiaba el prompt clínico y la respuesta del modelo a `AuditLog`, inmutable 10 años — incoherente con haber redactado PHI de los logs de consola en el mismo lote. | **SQL 198** (aplicado): trigger dedicado que audita metadatos (longitud, conteos, flags), no contenido. Residual: `chat_session.feedback_comment` sigue con el trigger genérico. |

Validados como sólidos por @AS: `isPublicTrpcPath` y el fail-closed del middleware, el renderer
del chat (probó breakout de atributos, inyección de tags y ReDoS) y el escape de prototipo del
motor de fórmulas.

**Cobertura añadida (@QA):** 51 tests en 9 archivos — el gate de MFA en `tenantProcedure` y
`middleware.ts` no tenían ninguno. **BDD (@QAF):** 17 escenarios en
`tests/features/02-seguridad/`. **Entrega (@SRE):** `docs/runbooks/owasp-2025-deploy.md` con
rollback por control. **Backlog (@PO):** `docs/backlog/beta23_owasp2025_residual_risks.md`.

### Hallazgos operativos del ciclo (no cerrados aquí)

1. **El repositorio no tiene ningún secret de GitHub Actions** (`total_count: 0`). El alerting de
   A09 queda cableado pero **inerte**, y `db-migrate`, `backup-drill`, `perf` y `perf-k6` llevan
   tiempo referenciando secrets inexistentes.
2. `npm run test:coverage` (agregado raíz) está roto de antes: el proyecto raíz glob-ea los tests
   de `apps/web` sin su ambiente jsdom ni el alias `@/`. El gate real de CI —
   `npx turbo run test -- --coverage` — está verde con 5.570 tests.
3. `docs/15_production_runbook.md` §14.5 consulta una columna `chainHash` inexistente
   (el schema usa `signatureHash`/`prevHash`). CLAUDE.md repite el mismo error.

---

## 7. Migración Next 14 → 16 (cierre de A03)

Ejecutada el mismo día, por etapas verificadas, en la rama `feat/next16-migration`.
**14.2.35 → 15.5.23 (+ React 18.3.1 → 19.2.8) → 16.3.1.** Nunca de un salto: el salto directo
14→16 es exactamente lo que rompió el build en Beta.22.

**Resultado en cadena de suministro:** dependencias de producción **de 26 vulnerabilidades
(5 high) a 1** — `expr-eval`, sin fix upstream, mitigada por allowlist (§6 H7).

### Arnés de verificación

`scripts/verify-migration.sh` corre typecheck, lint, tests, build y —lo más importante— un
**diff del tipo de renderizado de las 313 rutas** contra un baseline capturado antes de tocar
nada (`docs/migracion/next15-baseline.md`). Ese diff es el detector de regresión silenciosa: en
este repo ya hubo una app con build verde, axe verde e hidratación muerta bajo CSP (#440).

### Fallos silenciosos encontrados (ninguno detectable por build ni typecheck)

| # | Hallazgo | Por qué importaba |
|---|---|---|
| 1 | **Dos copias de React en el árbol.** `apps/web` resolvía 19.2.8 pero la raíz mantenía 18.3.1, anclada por `lucide-react@0.460` (su peer acepta `^19.0.0-rc`, NO la 19 estable). | `packages/ui` se transpila dentro del bundle de la app: habría corrido con React 18 mientras la app usaba 19 → *Invalid hook call* en producción. Cerrado con `lucide-react ^0.500` + anclaje explícito en la raíz + `overrides`. |
| 2 | **Lo mismo en los tipos**: `@types/react` 18.3.28 en la raíz (peer opcional de una transitiva de Radix) contra 19.2.18 en los workspaces. | 296 errores `TS2786` "cannot be used as a JSX component". Tras anclar: 3. |
| 3 | **`router.push()` dentro del updater de `setState`** (`patients/new`). Los updaters deben ser puros —React puede re-ejecutarlos— y dejó de dispararse de forma fiable. | Defecto REAL de producto que React 19 destapó: el paciente quedaba atrapado en el panel de éxito sin ir a orientación táctil. Con React 18 funcionaba por casualidad. |
| 4 | El codemod dejó `UnsafeUnwrappedCookies` en `mfa-guard.ts` y `actions/mfa.ts`: preserva acceso síncrono con un cast. | Funciona en 15 y **desaparece en 16**. Siendo el gate de MFA, se resolvió de raíz (async + `await cookies()`), no se dejó como deuda. |
| 5 | Envolver `render()` en `act()` hace que React 19 **difiera el montaje**: el `capturedOnSuccess?.()` siguiente quedaba `undefined` → no-op silencioso. | El test parecía fallar por timers falsos; la causa era otra. Sin entenderlo se habría "arreglado" el test enmascarando el defecto nº 3. |

### Cambios de comportamiento aceptados

- `/analytics/[kpi]`: de ● (SSG) a ƒ (dinámica). **No es regresión** — la página declara
  `generateStaticParams` pero su layout `(admin)` llama `getCurrentUser()` → `cookies()`, que
  fuerza render dinámico de todo el segmento. Nunca se prerenderizó de verdad; Next 15 la
  etiquetaba mal. Las otras 292 rutas bajo esos layouts ya eran ƒ por lo mismo, y **las 20
  estáticas —incluidas `/login` y las 9 del portal— siguen estáticas**.
- 4 anclas `<a href>` a rutas internas convertidas a `<Link>` (dashboard, admisión, bedside,
  censo): errores reales que `next lint` no reportaba y que causaban recarga completa de página.

### Fuera de alcance, deliberadamente

| Qué | Por qué |
|---|---|
| `middleware.ts` → `proxy.ts` | Next 16 acepta el nombre viejo (deprecado; el build ya lo reporta como "Proxy"). El rename cambia el runtime de Edge a **Node** y toca el gate fail-closed de A10 — merece etapa propia con verificación propia, no ir de polizón en el bump. |
| ESLint 9 + flat config | `eslint-config-next@16` exige ESLint ≥9, pero **no es requisito del framework**: lo que Next 16 elimina es el comando `next lint`, no el formato de config. Arrastraría a `packages/ui` por el hoisting. Config propuesta guardada en `docs/migracion/`. |
| `@trpc/*` RC → estable | La 11.18 exige TypeScript ≥5.7.2 (el repo está en 5.6.3): arrastraría un bump de TS sobre ~160 routers. |
| `reactflow` → `@xyflow/react` | Paquete abandonado (última publicación 2024-06) con peer permisivo; instala con React 19 pero nunca se probó contra él. Riesgo acotado al grafo del workflow-designer. |

### Pendiente

**UAT manual en browser real** — es el único gate que queda y no lo cubre ninguna prueba
automática: consola sin errores de hidratación ni `Refused to execute inline script`, y los 6
flujos sin cobertura que identificó @QA (login, portal, `/tareas`, Server Actions de
organización/roles, streaming del chat).

---

*Análisis estático + verificación contra la instancia de producción (advisors, grants, datos de
fórmulas). No sustituye un pentest activo.*
