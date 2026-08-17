# Runbook: Despliegue OWASP Top 10:2025 — HIS Multipaís

Nivel: SRE / Dev lead
Refs: `docs/audit/2026-08-17_owasp_2025_remediacion.md`, `docs/15_production_runbook.md`, OWASP Top 10:2025

---

## 0. Contexto

Rama `feat/owasp-2025-hardening`, **8 commits** sobre `main` (`ebce058`), remediación completa del
re-audit OWASP Top 10:2025. Detalle técnico y evidencia por categoría en el informe de auditoría;
este documento es el **cómo desplegar**, no el qué ni el por qué.

**SQL 196 (A02) y 197 (A09) ya están aplicados en producción.** Este deploy es solo código —
no hay migración pendiente. Los 8 commits, en orden:

| # | Commit | Categoría | Archivos clave |
|---|---|---|---|
| 1 | `fbe6722` | A01 Broken Access Control | `workflow-inbox.router.ts`, `nutrition.router.ts`, `census.router.ts`, `rls-context.ts` |
| 2 | `6143285` | A02 Security Misconfiguration | `sql/196_owasp2025_a02_secdef_hardening.sql` (ya en prod) |
| 3 | `ec7a23a` | A03 Software Supply Chain | `package.json`/`package-lock.json` (88→39 vulns), `formula/engine.ts` |
| 4 | `e4f5984` | A05 Injection (chat) | `chat-widget.tsx` |
| 5 | `7bffa14` | A06 Insecure Design | `rate-limit-global.ts`, `[trpc]/route.ts` |
| 6 | `9b3931e` | A09/A10 Logging+Alerting / Exceptional Conditions | `middleware.ts`, `trpc-public.ts`, `log-redact.ts`, `sql/197_owasp2025_a09_chat_audit.sql` (ya en prod) |
| 7 | `66fb6fc` | A07 Authentication Failures | `mfa-session.ts`, `mfa-guard.ts`, `actions/mfa.ts`, `trpc.ts`, layouts `(admin)`/`(clinical)` |
| 8 | `5c042a1` | docs | informe de auditoría + `STATUS.md` |

---

## 1. Precondiciones

### 1.1 Variables de entorno nuevas

| Variable | Requerida | Default si ausente | Efecto |
|---|---|---|---|
| `MFA_REQUIRED_ROLE_CODES` | **No** | vacía → enforcement MFA **apagado** (comportamiento idéntico al actual) | CSV de códigos de rol (ej. `DIR,ARCH,ADMIN`) que deben pasar TOTP para entrar |
| `MFA_SESSION_SECRET` | Solo si se usa la anterior | vacía → si `MFA_REQUIRED_ROLE_CODES` tiene valor, la política queda `misconfigured` y **deniega** (fail-closed) | HMAC de la cookie de sesión MFA, mín. 32 caracteres |

**No hace falta tocar Vercel env vars para este deploy.** Ambas quedan sin definir — el cero-cambio-de-comportamiento
es intencional (ver `docs/audit/2026-08-17_owasp_2025_remediacion.md` §Acciones pendientes #2). Activarlas es
una decisión operativa posterior (enrolar DIR/ARCH/ADMIN en `/mfa/enroll` primero).

### 1.2 Gates pre-deploy (además de los de `docs/15_production_runbook.md` §9)

- [ ] CI verde en el PR (typecheck + lint + test + build) — 5/5 workspaces, ~3.536 tests.
- [ ] Confirmar que SQL 196 y 197 están aplicados en el proyecto Supabase de producción:
  ```sql
  -- 196: sin anon/authenticated en get_portal_mfa_secret
  SELECT proacl FROM pg_proc WHERE proname = 'get_portal_mfa_secret';
  -- 197: triggers de auditoría en chat
  SELECT tgname FROM pg_trigger
   WHERE tgrelid = 'public.chat_message'::regclass AND NOT tgisinternal;
  -- esperado: trg_audit_chat_message presente
  ```
  Si cualquiera de las dos falta, **no mergear** — el código de esta rama asume que ya corrieron
  (ninguno de los 8 commits vuelve a aplicarlas).
- [ ] `MFA_REQUIRED_ROLE_CODES` NO está seteada en Vercel Production (o está vacía). Si alguien la
  configuró por error antes de enrolar usuarios, este deploy los deja fuera del sistema.
- [ ] Sin incidente P1/P2 abierto (regla estándar, `docs/15_production_runbook.md` §4.1).

---

## 2. Orden de despliegue

No hay pasos especiales de secuencia — es un merge normal a `main` (squash, Conventional Commits),
Vercel auto-deploy. La única razón para llamarlo "orden" es que la BD **ya** está adelantada al
código (SQL 196/197 en prod desde antes de este deploy); no hay ventana de incompatibilidad porque
ambos cambios de esquema son aditivos/restrictivos sobre superficie que el código actual (main) no
usaba (RPCs sin call site, o triggers que solo agregan filas a `audit.AuditLog`).

1. Merge del PR a `main`.
2. Vercel auto-deploy (build ~2-4 min, ver `docs/15_production_runbook.md` §4.4).
3. Smoke automático `/api/health` (existente, sin cambios en esta rama).
4. Verificación por control — **§3 de este documento**, no el smoke genérico.
5. Monitoreo reforzado 2 h — **§4**.

---

## 3. Verificación post-deploy por control

Ejecutar **todos** en los primeros 30 min. No son opcionales — dos de los ocho commits tocan rutas
que, si fallan silenciosamente, vacían pantallas críticas sin lanzar ningún error 5xx.

### A01 — `withTenantContext` en workflow-inbox / nutrition / census (`fbe6722`)

**Riesgo específico:** el rol se demota a `authenticated` dentro de la transacción. Si a alguna
organización le falta una policy RLS o un grant, la query no falla — **devuelve 0 filas**. Antes,
con el rol `BYPASSRLS`, siempre devolvía datos.

```bash
# Como usuario clínico con bandeja/censo/nutrición conocidos NO vacíos:
# 1. Entrar a la pantalla de bandeja de trabajo (workflowInbox.miBandeja) y confirmar
#    que la lista NO está vacía.
# 2. Repetir para censo y para nutrición (pantallas que consumen census.router / nutrition.router).
```

```sql
-- En Supabase SQL Editor (rol admin, bypassa RLS a propósito para esta comparación):
-- confirmar que SÍ hay filas pendientes para al menos una organización activa.
SELECT count(*) FROM ece.documento_instancia WHERE estado_actual IN ('borrador','en_revision');
```

Si la pantalla de la app muestra 0 pero esta query muestra >0 para la misma organización: **RLS
está bloqueando el rol `authenticated`**, no que no haya datos. Revisar advisors de Supabase
(`get_advisors` security) por `rls_enabled_no_policy` en las tablas involucradas.

```bash
# Buscar timeouts de transacción en los logs de Vercel de los primeros 30 min
# (miBandeja hace ~30 queries dentro de una sola transacción — el timeout se subió
# explícitamente en esta rama, pero si el valor no alcanza en producción real):
vercel logs his-avante --since=30m | grep -iE "transaction.*(closed|timeout)|P2028"
```

### A02 — GRANT/REVOKE en funciones SECDEF (`6143285`, SQL ya en prod)

```sql
-- 0 filas esperadas (sin anon ni authenticated de más):
SELECT proname, proacl FROM pg_proc
 WHERE proname IN ('get_portal_mfa_secret','set_portal_mfa_secret_vault',
                    'cleanup_rate_limit_hits','expire_pharmacy_reservations',
                    'fn_expire_pharmacy_reservations');
```

Flujo funcional: crear un paciente de prueba y confirmar que el expediente se genera sin error
`42501 insufficient privilege` (usa `fn_next_expediente`, que conserva EXECUTE para `authenticated`
vía `withTenantContext`).

### A03 — Supply chain (`ec7a23a`)

No hay verificación runtime específica — es un cambio de dependencias + CI. Confirmar:
- Build de Vercel exitoso (si `jspdf` 4.2.1 o `nodemailer` 9.0.5 rompieran algo, sería en build o
  en el primer uso — ver abajo).
- **Generar un PDF** (cualquier reporte/documento que use `jspdf`) y **enviar un correo de prueba**
  (recuperación de contraseña o notificación) en los primeros 30 min. Son los dos paquetes con
  bump mayor de esta rama (`jspdf` 2.5.2→4.2.1, `nodemailer` 6.10→9.0.5).
- Motor de fórmulas: abrir `/calculadoras`, ejecutar una fórmula clínica existente, confirmar que
  el resultado es un número (no `NaN`). `NaN` en una fórmula que antes funcionaba significa que su
  expresión persistida cae fuera de la nueva allowlist de caracteres — improbable (las 176
  fórmulas de producción se validaron contra la allowlist antes de mergear) pero es la señal
  exacta a buscar.

### A05 — Renderer de markdown del chat (`e4f5984`)

Abrir el chat asistente, enviar/recibir un mensaje con formato (negrita, lista, un link interno).
Confirmar que renderiza igual que antes (negrita, listas, links clicables). Enviar un mensaje que
contenga `<script>alert(1)</script>` o `[x](//evil.com)` y confirmar que aparece como texto plano
o que el link NO navega fuera del dominio.

### A06 — Rate limit global en `/api/trpc` (`7bffa14`)

Los umbrales son altos a propósito (600/min por usuario autenticado, 60/min por IP anónima) — un
usuario legítimo **no debería** tocarlos nunca. Verificar que NO disparan con uso normal:

```bash
# Cualquier 429 en los primeros 30 min es sospechoso — el umbral es alto y el sistema
# recién arranca (no hay "ráfaga de bienvenida" legítima que lo justifique).
vercel logs his-avante --since=30m | grep "429\|Demasiadas solicitudes"
```

Si aparece para un usuario/IP real (no un script de prueba): revisar si es un loop de polling
(dashboard, censo) haciendo más de 600 llamadas/min — sería un bug de UI a corregir, no bajar el
umbral primero.

### A07 — Enforcement MFA (`66fb6fc`) — **apagado por defecto, verificar que sigue apagado**

```bash
# Debe ser CERO en los primeros 30 min — MFA_REQUIRED_ROLE_CODES no está configurada.
vercel logs his-avante --since=30m | grep "Verificación de segundo factor requerida"
```

Cualquier aparición de ese mensaje (código `FORBIDDEN` en `tenantProcedure`) con la política
supuestamente apagada es un **P1**: alguien quedó bloqueado sin haber sido enrolado. Ver §5.

Login normal: entrar con un usuario cualquiera y confirmar que **no** redirige a `/mfa` (a menos
que ya tuviera `mfaEnabled` y la política esté encendida, lo cual no debería estar pasando en este
deploy).

### A09/A10 — Middleware fail-closed + logs sin PHI + auditoría del chat (`9b3931e`)

**Login y portal.** El cambio de mayor riesgo de esta rama: cualquier error no atrapado en el
middleware ahora redirige a `/login` (o `/portal/login`) en vez de dejar pasar la request. Probar
explícitamente:

```bash
# Login de personal
curl -I https://his-avante.vercel.app/dashboard   # sin cookie → 307 a /login, no 200 ni 500
# Portal de pacientes
curl -I https://his-avante.vercel.app/portal/dashboard  # sin cookie → redirect a /portal/login
```

Luego, con sesión real (browser): login completo de personal y login del portal (magic-link o
TOTP), confirmar que ambos flujos completan sin loop de redirect.

```bash
# El middleware solo cae al catch en errores genuinos (parsing de cookie Edge, etc.) —
# si aparece con frecuencia es indicio de que el fail-closed está enmascarando un bug real.
vercel logs his-avante --since=30m | grep "\[middleware\] error no atrapado"
```

**Chat sigue renderizando** (cubre A05 y A09 a la vez — el widget consume el router de chat):
abrir el chat, hacer una pregunta, confirmar respuesta normal, sin error de consola.

**Triggers de auditoría del chat escriben:**

```sql
-- Enviar un mensaje de chat de prueba, luego:
SELECT entity, "entityId", "organizationId", "occurredAt"
FROM audit."AuditLog"
WHERE entity IN ('chat_session','chat_message')
ORDER BY "occurredAt" DESC LIMIT 5;
-- Esperado: filas nuevas con organizationId NO NULL (el fallback snake_case de
-- fn_audit_row es justamente para que esto no salga NULL en tablas creadas a mano).
```

Si `organizationId` sale `NULL`: el fallback snake_case→camelCase de `fn_audit_row` no está
aplicando — revisar que SQL 197 realmente se ejecutó (paso §1.2) y no una versión previa de la
función.

---

## 4. Señales de alarma — primeras 2 horas

Cadencia: cada 15 min primera hora, cada 30 min segunda hora (más agresivo que el `docs/15
_production_runbook.md` §14.6 estándar, por el cambio en middleware).

| Señal | Umbral de alarma | Umbral de abortar (rollback) |
|---|---|---|
| Error rate global | >0.3% en 5 min | **>1% sostenido 5 min** (regla estándar §5.1) |
| `[middleware] error no atrapado` en logs | 1 ocurrencia → investigar | **>10 en 15 min** → aplicar forward-fix §5.4 |
| `429` / `Demasiadas solicitudes` con usuario real | 1 ocurrencia → investigar | **>3 usuarios distintos en 15 min** → forward-fix §5.5 |
| `FORBIDDEN ... segundo factor` con política supuestamente apagada | **1 sola ocurrencia** | **Inmediato — P1**, ver §5.6 |
| Bandeja/censo/nutrición vacíos para org con datos conocidos | 1 caso confirmado → investigar | **Confirmado en producción real (no solo QA)** → rollback aplicación §6 (docs/15 §5) |
| Enlaces rotos en cadena de auditoría (`prevHash`/`signatureHash`, ver §6 abajo) | **>0** | **Inmediato — P1**, no es negociable |
| PDF o email no se genera/envía | 1 caso → investigar | Confirmado → pin de dependencia §5.3 |

Fuentes: Vercel Analytics + `vercel logs`, Sentry (si `SENTRY_DSN` está activo), y el workflow
`security-alerts.yml` (§6) corrido manualmente (`workflow_dispatch`) al inicio y al final de la
ventana de 2 h.

---

## 5. Rollback por control (no del PR entero)

**Antes que nada:** este es un branch apilado — 3 commits (`7bffa14`, `9b3931e`, `66fb6fc`) tocan
el mismo archivo (`apps/web/src/app/api/trpc/[trpc]/route.ts`), y `ec7a23a`/`e4f5984`/`7bffa14`
tocan `package-lock.json`. **`git revert <sha>` de un commit intermedio con commits posteriores
que tocan el mismo archivo puede fallar con conflictos** o, peor, aplicar limpio pero dejar el
archivo en un estado no probado. Por eso cada control abajo trae **el forward-fix concreto**
(qué comentar/ajustar) como primera opción — es más rápido y predecible en una ventana de
incidente que resolver conflictos de revert a las 2 AM. `git revert` limpio solo está garantizado
para el commit que es el **último** en tocar sus archivos (ver columna "Revert limpio").

| # | Control | Revert limpio | Forward-fix (recomendado en incidente) | Qué queda expuesto |
|---|---|---|---|---|
| 1 | A01 `fbe6722` | **Sí** (nada después toca `rls-context.ts`/los 3 routers) | — | Tenant isolation de workflow-inbox/nutrition/census vuelve a depender solo del filtro JS `organizationId` (rol `BYPASSRLS`) — RLS de BD deja de evaluarse en esas 3 rutas. Es exactamente el hallazgo original de A01. |
| 2 | A02 SQL 196 | N/A (ya en prod, no es un commit de app) | Ver §5.1 abajo (GRANT inverso) | `anon` vuelve a poder invocar `get_portal_mfa_secret` (secreto TOTP del portal **en claro**) vía `/rest/v1/rpc/`. **Prácticamente nunca justificado** — ver nota. |
| 3 | A03 `ec7a23a` | Sí (nada después toca `package.json`/`engine.ts`) pero **NO revertir el commit completo** | Pin de la dependencia puntual que rompió (§5.3) | Revertir el commit entero reabre 49 vulnerabilidades ya cerradas (jspdf/nodemailer/etc.) para arreglar un problema de una sola librería — desproporcionado. |
| 4 | A05 `e4f5984` | Sí (nada después toca `chat-widget.tsx`) | — | El chat vuelve a tener el `escapeHtml` sin comilla simple y sin invariante de salida; no hay CVE conocido explotable hoy (era defensa en profundidad), pero se pierde. |
| 5 | A06 `7bffa14` | **No** (`route.ts` editado después por `9b3931e` y `66fb6fc`) | Comentar el bloque `if (!verdict.ok) { return ...429 }` en `route.ts`, **o** subir `ANON_MAX`/`AUTHED_MAX` en `rate-limit-global.ts` a un valor no operante (ej. `999999`) | Cualquier cliente puede llamar `/api/trpc/*` en bucle sin freno — reabre A06. |
| 6 | A09/A10 `9b3931e` | Parcial — `middleware.ts` es exclusivo de este commit (revert limpio); `route.ts`/SQL 197 no | Middleware: cambiar el `catch` de vuelta a `return NextResponse.next({ request })` (fail-open) — ver snippet abajo | Fail-open del middleware: un error no atrapado vuelve a dejar pasar requests a rutas protegidas sin evaluar sesión — es el hallazgo A10 original. |
| 7 | A07 `66fb6fc` | Sí, pero **no hace falta**: ya está apagado (`MFA_REQUIRED_ROLE_CODES` vacía) | Confirmar que la env var no está seteada; si lo está por error, `vercel env rm MFA_REQUIRED_ROLE_CODES production && vercel --prod` | Ninguno — es el estado por defecto. |

### 5.1 Rollback de SQL 196 (GRANT inverso)

**Nota:** esto reabre el hallazgo de mayor severidad del re-audit (secreto TOTP del portal legible
por `anon`). Solo ejecutar si un flujo legítimo de la app se rompió por esto y no hay forma más
rápida de repararlo (ej. un call site no detectado que sí necesitaba el grant a `authenticated`).

```sql
GRANT EXECUTE ON FUNCTION public.get_portal_mfa_secret(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_portal_mfa_secret_vault(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_rate_limit_hits() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_pharmacy_reservations() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_expire_pharmacy_reservations() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_next_cuenta(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.fn_next_expediente(char, char) TO anon;
GRANT EXECUTE ON FUNCTION public.fn_next_no_identificado(uuid, date) TO anon;
GRANT EXECUTE ON FUNCTION public.fn_next_solicitud_imagen(uuid, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.current_portal_account() TO anon;
```

### 5.2 Rollback de SQL 197

Solo quitar los triggers — `audit.fn_audit_row()` queda igual (el fallback snake_case es aditivo,
no rompe nada si se deja sin uso):

```sql
DROP TRIGGER IF EXISTS trg_audit_chat_session ON public.chat_session;
DROP TRIGGER IF EXISTS trg_audit_chat_message ON public.chat_message;
```

### 5.3 Pin de dependencia puntual (A03)

```bash
# Ejemplo si jspdf 4.2.1 rompe generación de PDF:
npm install jspdf@2.5.2 -w apps/web   # o el workspace que lo consuma
git add package.json package-lock.json
git commit -m "fix: pin jspdf a 2.5.2 — 4.2.1 rompe <describir> en producción"
```

### 5.4 Forward-fix de middleware (A09/A10) — fail-open temporal

En `apps/web/src/middleware.ts`, función `middleware()`, dentro del `catch`:

```diff
-    const isPortalPublic = PORTAL_PUBLIC_PATHS.some(...);
-    if (isPublicPath(pathname) || isPortalPublic) {
-      return NextResponse.next({ request });
-    }
-    const url = request.nextUrl.clone();
-    url.pathname = pathname.startsWith("/portal/") ? "/portal/login" : "/login";
-    url.searchParams.set("redirect", pathname);
-    return NextResponse.redirect(url);
+    // ROLLBACK TEMPORAL — reabre A10 (fail-open). Quitar en cuanto se entienda
+    // la causa raíz del error no atrapado. Ticket: <link>.
+    return NextResponse.next({ request });
```

Marcar con comentario explícito y un ticket de seguimiento — este es un parche de incidente, no
un estado final.

### 5.5 Forward-fix de rate limit (A06)

```diff
// apps/web/src/lib/trpc/rate-limit-global.ts
-const AUTHED_MAX = 600;
-const ANON_MAX = 60;
+const AUTHED_MAX = 6000;  // ROLLBACK TEMPORAL — investigar por qué 600 no alcanzaba
+const ANON_MAX = 600;
```

Preferible a comentar el bloque en `route.ts`: mantiene el control activo (con margen) en vez de
apagarlo del todo.

### 5.6 MFA FORBIDDEN inesperado (A07) — P1 inmediato

```bash
vercel env ls production | grep MFA_REQUIRED_ROLE_CODES
# Si tiene valor y NO se pretendía activar el enforcement todavía:
vercel env rm MFA_REQUIRED_ROLE_CODES production
vercel --prod
```

No requiere tocar código — es exactamente el kill-switch para el que se diseñó la variable.

### 5.7 Rollback total (última instancia)

Si varios controles fallan a la vez o la causa no es clara: `vercel promote <deploy-anterior>` por
`docs/15_production_runbook.md` §5. Nota: si ya se hizo login con MFA marcado o se generaron filas
de auditoría del chat, esos datos son válidos y no requieren limpieza — ambos cambios son aditivos.

---

## 6. Alerting — OWASP A09:2025 (Security Logging **and Alerting** Failures)

La categoría 2025 agrega "Alerting" al nombre porque tener logs y auditoría no basta si nadie los
mira hasta que alguien pregunta. Antes de esta rama: teníamos `redactPhi`, la cadena SHA-256 y
Sentry cableado (pero `SENTRY_DSN` **no está activo** en producción — acción pendiente #4 del
informe de auditoría, fuera del control de @SRE, requiere DPA con Sentry). Esta sección cierra la
pieza de alerting con lo que **no depende de esa activación**.

### 6.1 Qué se implementó hoy (sin depender de `SENTRY_DSN`)

`.github/workflows/security-alerts.yml` (nuevo) — corre cada 4 h + `workflow_dispatch` manual:

- **Job `supabase-advisors`**: ejecuta `scripts/check-supabase-advisors.mjs` (existía desde
  2026-05-18, nunca estuvo cableado a un workflow — este PR cierra ese hueco). Si hay un advisor
  `CRITICAL`, abre/actualiza un GitHub Issue con label `security-alert` y notifica a Slack si
  `SLACK_WEBHOOK_URL` está configurado (mismo patrón que `backup-drill.yml`).
- **Job `db-signals`**: dos consultas SQL directas contra `DIRECT_URL` (el mismo secret que ya usa
  `db-migrate.yml` — no se creó un secret nuevo para no fragmentar credenciales en un job de solo
  lectura):
  - Enlaces rotos de la cadena de auditoría (24 h) → falla el job si hay ≥1 (P1).
  - Cubetas de `RateLimitHit` cerca del tope (5 min) → anotación informativa, no falla el job.

**Prerrequisito para que `supabase-advisors` corra:** agregar los secrets `SUPABASE_ACCESS_TOKEN`
y `SUPABASE_PROJECT_REF` al repo (Settings → Secrets → Actions). Sin ellos el job emite un
`::warning::` y no ejecuta el chequeo — no falla el workflow, pero el control queda inerte. Esto es
trabajo de Avante (requiere un token de la cuenta Supabase), no algo que @SRE pueda resolver desde
el código.

`DIRECT_URL` para `db-signals` **ya existe** como secret (lo usa `db-migrate.yml`) — ese job corre
sin configuración adicional.

`.github/workflows/security.yml` — se reordenó `npm audit signatures` **antes** de
`npm audit --omit=dev --audit-level=high`: ese segundo paso está en rojo a propósito (Next 14, ver
informe de auditoría §3 A03) y con el orden anterior la verificación de firmas nunca llegaba a
ejecutarse (un step fallido detiene los siguientes en el mismo job). Sin cambio de umbral, solo de
orden — el job sigue en rojo por la misma razón de siempre, pero ahora la verificación de firmas
sí corre en cada ejecución.

### 6.2 Tabla de alertas — mínimas de seguridad

| # | Señal | Umbral | Destino | Acción |
|---|---|---|---|---|
| 1 | Advisor Supabase `security` en `CRITICAL` | ≥1 | GitHub Issue (`security-alert`, `P1`) + Slack si hay webhook | SRE Lead escala inmediato, no se considera el sistema estable hasta resolver (`docs/15` §14.2) |
| 2 | Enlaces rotos en cadena de auditoría (24 h) | >0 | Falla `db-signals` (rojo en Actions) + Slack si hay webhook | P1 inmediato — posible manipulación de datos, ver `docs/15_production_runbook.md` §6 |
| 3 | Cubetas de rate limit anónimo cerca del tope repetidamente (5 min) | ≥55 hits / cubeta (de un máx. de 60) | `::warning::` en el run + artifact `rate-limit-spike-report` | Investigar la IP/bucket; **no** es un P1 por sí solo — es la única señal indirecta disponible sin instrumentar la app (la tabla no registra los rechazos, solo los hits aceptados) |
| 4 | `429` para un usuario **autenticado** real (no anónimo) | ≥1 en producción | `vercel logs` (§4 de este doc) — no automatizado hoy | Si se repite, revisar si es loop de polling de UI, no bajar el umbral primero |
| 5 | `FORBIDDEN` por MFA con `MFA_REQUIRED_ROLE_CODES` vacía | ≥1 | `[tRPC] FORBIDDEN` en logs de Vercel (§4) — no automatizado hoy | P1 — variable de entorno mal configurada, ver §5.6 |
| 6 | Fallo del middleware (`[middleware] error no atrapado`) | >10 en 15 min | `vercel logs` (§4) — no automatizado hoy | Investigar causa; si persiste, forward-fix §5.4 |
| 7 | `npm audit signatures` falla en `security.yml` | Job rojo | GitHub Actions UI (no hay notificación push hoy) | Paquete con firma no verificada — tratar como posible compromiso de supply chain, no como falso positivo por default |

**Filas 4, 5 y 6 quedan especificadas pero NO automatizadas** — requieren correlacionar texto de
log de Vercel, que no es consultable vía API sin un log drain configurado (Vercel Log Drains, o
activar `SENTRY_DSN` con `captureConsoleIntegration`). Ninguna de las dos requiere trabajo de
@Dev; son configuración de plataforma. Recomendación: si Avante activa `SENTRY_DSN` (acción
pendiente #4 del informe), cablear alert rules de Sentry para las filas 4-6 directamente sobre los
mensajes ya redactados que la app emite (`redactPhi`), en vez de construir un log drain aparte.

### 6.3 Por qué no más automatización hoy

Un log drain o un consumer de Vercel Analytics API para las filas 4-6 es factible pero es una
pieza nueva de infraestructura (credenciales, retención, otro punto de fallo) para una condición
que hoy tiene probabilidad casi nula de dispararse (MFA apagado, rate limit con margen amplio). Es
mejor gastar ese esfuerzo cuando `SENTRY_DSN` se active — Sentry ya tiene el pipeline de
`beforeSend`/scrubbing construido (Beta.22) y las alert rules son configuración, no código nuevo.
Ver `docs/runbooks/sentry.md` §6 para las alertas ya documentadas ahí (error rate, performance,
CSP) — las filas 4-6 de esta tabla se agregarían al mismo lugar.

---

## 7. Referencias

- `docs/audit/2026-08-17_owasp_2025_remediacion.md` — qué se encontró y por qué cada fix es como es.
- `docs/15_production_runbook.md` — runbook general de producción (rollback de aplicación/BD, rotación de credenciales, escalation).
- `docs/runbooks/csp.md`, `docs/runbooks/sentry.md` — runbooks hermanos, mismo formato.
- `.github/workflows/security.yml`, `.github/workflows/security-alerts.yml` — CI/alerting de seguridad.
- `packages/database/sql/196_owasp2025_a02_secdef_hardening.sql`, `197_owasp2025_a09_chat_audit.sql`.
