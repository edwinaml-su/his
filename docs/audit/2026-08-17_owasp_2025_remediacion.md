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
| A03 Software Supply Chain | 🟡 | 🟡 | 88→39 vulns, 0 críticas en prod, SBOM + verificación de firmas. **Queda Next 14** |
| A04 Cryptographic Failures | 🟢 | 🟢 | argon2, Vault MFA portal, sin secretos en repo (sin cambios) |
| A05 Injection | 🟡 | 🟢 | Renderer del chat endurecido + allowlist en el motor de fórmulas |
| A06 Insecure Design | 🟡 | 🟢 | Rate limit global en `/api/trpc` |
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

> **Abierto — decisión de Avante:** el proyecto corre **Next 14**, con ~21 advisories corregidos
> en la línea 15.5.x (SSRF en Server Actions y rewrites, cache poisoning, bypass de
> middleware/proxy, XSS con nonces CSP, varios DoS). Es hoy la mayor exposición de cadena de
> suministro y no se toca aquí: 14→15 es una migración con su propio UAT, y ya hubo un incidente
> por un salto 14→16 automático (Beta.22, revertido). **Recomendación: sprint dedicado a Next
> 15.5.x.** Mientras tanto el gate semanal seguirá en rojo — es la señal correcta, no se bajó el
> umbral para pintarlo verde.

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

*Análisis estático + verificación contra la instancia de producción (advisors, grants, datos de
fórmulas). No sustituye un pentest activo.*
