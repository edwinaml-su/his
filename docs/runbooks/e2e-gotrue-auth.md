# Runbook: GoTrue real en el stack E2E — estado y bloqueo pendiente

Nivel: SRE / QA
Refs: PR #541, `.github/workflows/e2e-smoke.yml`, `.github/workflows/e2e.yml`, `docker-compose.test.yml`

---

## Por qué existe esto

El gate `Playwright Smoke (@smoke)` llevaba 10/10 runs cancelados por timeout de 20m, en silencio (sin evidencia en el log). Causa raíz original: **todas** las specs `@smoke` (77 tests) pasan por `login()` (`apps/web/e2e/_helpers/auth.ts`), que depende de Supabase Auth real vía `supabase.auth.signInWithPassword()` — pero `NEXT_PUBLIC_SUPABASE_URL` en CI apuntaba a un host inexistente (`e2e-dummy.supabase.co`) y `packages/database/scripts/seed-test-users.mjs` (crea los usuarios `qa.*@his.test`) nunca se invocaba en ningún workflow.

Esta sesión levantó GoTrue (el mismo backend de auth que usa Supabase real) en el stack de test Docker Compose de CI, de punta a punta. **El stack ahora levanta healthy** — postgres + GoTrue + un gateway nginx, los tres verdes en runs reales de CI. Lo que queda: un error 500 al primer intento real de crear un usuario de test, sin diagnosticar todavía, y las 77 specs que nunca corrieron contra un ambiente funcional.

**No hay Docker local disponible en esta máquina** (`dockerDesktopLinuxEngine` no responde) durante toda la sesión. Todo lo de abajo se verificó empujando commits a la rama `fix/cicd-docker-hardening` (PR #541 abierto) y leyendo los runs reales de GitHub Actions con `gh run view <id> --log` / `--log-failed`. Quien retome esto sin Docker local tiene que seguir el mismo patrón: commit → push a esa rama → `gh run list --branch fix/cicd-docker-hardening` → leer logs.

---

## 1. Qué quedó funcionando (verificado en CI real)

### Stack (`docker-compose.test.yml`)

Tres servicios, en este orden de arranque (`depends_on` + `condition: service_healthy`):

1. **`postgres-test`** (`postgres:15-alpine`) — sin cambios de fondo, pero ahora monta `scripts/gotrue-test-init.sql` como `/docker-entrypoint-initdb.d/00-gotrue-test-init.sql` (corre en cada boot porque el data dir es `tmpfs`). Ese script:
   - `CREATE SCHEMA IF NOT EXISTS auth;` — GoTrue **no** crea su propio schema, sus migraciones asumen que ya existe (confirmado con el error real de CI y con `hack/init_postgres.sql` del propio repo `supabase/auth`, que hace lo mismo antes de levantar GoTrue).
   - `CREATE ROLE postgres;` (idempotente, sin LOGIN) — la migración `20240612123726_enable_rls_update_grants.up.sql` de GoTrue hace `grant select ... to postgres` con el nombre de rol **hardcodeado**, no templado. Nuestro Postgres usa `POSTGRES_USER=his` (no se cambia, para no romper `DATABASE_URL` de Prisma/seed en el resto del stack) — sin este rol, esa migración habría fallado un paso más adelante.

2. **`gotrue`** (`supabase/gotrue:v2.189.0`, pin verificado en Docker Hub) — conecta a `postgres-test:5432/his_e2e` con `GOTRUE_DB_NAMESPACE=auth`, `sslmode=disable`. **No publica puerto al host** — solo se alcanza dentro de la red del compose, en `gotrue:9999`, vía el gateway (ver abajo). Variables JWT (`GOTRUE_JWT_SECRET`, `GOTRUE_JWT_AUD`, etc.) verificadas una por una contra `internal/conf/configuration.go` del repo `supabase/auth` — no adivinadas.

3. **`gotrue-gateway`** (`nginx:1.27.4-alpine`, pin verificado) — **necesario porque GoTrue no implementa el prefijo `/auth/v1`**. Confirmado leyendo `internal/api/api.go` de `supabase/auth`: todas las rutas (`/admin/users`, `/token`, `/user`, `/health`, etc.) están montadas en la raíz del router. El prefijo `/auth/v1` es una convención de **Kong** (el API gateway del stack de self-hosting completo de Supabase) — este stack de test nunca tuvo Kong. Tanto `seed-test-users.mjs` como el propio `@supabase/supabase-js`/`@supabase/ssr` que usa la app arman siempre `${url}/auth/v1/...`, así que sin este gateway ambos reciben 404 directo de GoTrue.
   - Config: `scripts/gotrue-test-gateway.conf`, montado `:ro` en `/etc/nginx/conf.d/default.conf`. Único rewrite: `location /auth/v1/ { proxy_pass http://gotrue:9999/; }` (el trailing slash en ambos lados es lo que recorta el prefijo).
   - Publica el puerto **9999 del host** — el mismo que usa `NEXT_PUBLIC_SUPABASE_URL=http://localhost:9999`, sin cambios respecto a antes.
   - `listen 9999;` **y** `listen [::]:9999;` explícitos — el healthcheck (`wget http://localhost:9999/...`) resuelve `localhost` a `::1` (IPv6) primero dentro del contenedor, y `listen 9999;` a secas solo bindea IPv4. El script de entrada de la imagen oficial que normalmente agrega el listener IPv6 automáticamente (`10-listen-on-ipv6-by-default.sh`) solo parchea un `default.conf` que sea *bit-a-bit* el de fábrica (verificado por checksum contra el paquete apk) — el nuestro es custom, nunca lo iba a tocar, con o sin `:ro`. Por eso el listener dual-stack está explícito en el `.conf`, no depende de ese script.

### JWTs de test (`scripts/gotrue-test-jwt.mjs`)

Genera `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` como JWT HS256 puro (`node:crypto`, sin depender de una librería nueva) firmados con `GOTRUE_JWT_SECRET` — la MISMA env var que consume el contenedor `gotrue` (interpolación de shell `${GOTRUE_JWT_SECRET}` en el compose, con fallback local para reproducción manual). Un solo secreto, sin duplicación ni riesgo de desincronía.

### `seed-test-users.mjs` (única excepción al alcance original — autorizada explícitamente)

El script conecta con `pg` usando `ssl: { rejectUnauthorized: false }` **hardcodeado** — correcto contra Supabase real (que exige TLS) pero fatal contra un Postgres de test sin TLS (node-postgres no hace fallback a plaintext, aborta con "The server does not support SSL connections"). Fix aplicado: derivar la necesidad de SSL de la propia `DIRECT_URL` (`localhost`/`127.0.0.1` o `sslmode=disable` explícito → sin SSL; cualquier otro host, Supabase real incluido → SSL como antes). Sin env var nueva, sin cambiar el comportamiento contra producción.

### Workflows (`e2e-smoke.yml`, `e2e.yml`)

Orden de steps relevante: Checkout → Setup Node → **Generar API keys de test (GoTrue)** → **Boot test stack** → **Dump logs del stack (si el boot falló)** [`if: failure()`] → Install deps → Install Playwright browsers → Generate Prisma client → Sync schema (`prisma db push`) → Seed minimal data (`db:seed`, `continue-on-error: true`) → **Seed usuarios de test E2E (GoTrue)** (sin `continue-on-error` — a propósito, ver §3) → Build app → Run Smoke E2E → Upload report → Tear down stack.

`timeout-minutes` de `e2e-smoke.yml` está en **20** (lo subí desde el 15 que había dejado @QA como circuit-breaker de fast-fail — ese cálculo asumía que el login siempre fallaba rápido; ya no aplica una vez que el stack funciona de verdad).

### Cómo reproducir localmente (con Docker funcionando)

```bash
export GOTRUE_JWT_SECRET=e2e-gotrue-test-secret-do-not-use-in-prod-only
docker compose -f docker-compose.test.yml up -d --wait

export NEXT_PUBLIC_SUPABASE_URL=http://localhost:9999
export NEXT_PUBLIC_SUPABASE_ANON_KEY=$(node scripts/gotrue-test-jwt.mjs anon)
export SUPABASE_SERVICE_ROLE_KEY=$(node scripts/gotrue-test-jwt.mjs service_role)
export DATABASE_URL=postgresql://his:his@localhost:5432/his_e2e?schema=public
export DIRECT_URL=postgresql://his:his@localhost:5432/his_e2e?schema=public

npx prisma generate --schema=packages/database/prisma/schema.prisma
npx prisma db push --schema=packages/database/prisma/schema.prisma --skip-generate --accept-data-loss
npm run db:seed
node packages/database/scripts/seed-test-users.mjs   # <- acá es donde falla hoy, ver §2

docker compose -f docker-compose.test.yml down -v
```

---

## 2. El bloqueo actual: 500 al crear el primer usuario

`seed-test-users.mjs` llega hasta el primer `POST /auth/v1/admin/users` (proxeado a `gotrue:9999/admin/users`) para `qa.admin@his.test` y recibe:

```
Error inesperado 500: {"code":500,"error_code":"unexpected_failure",
  "msg":"Database error checking email","error_id":"c8a9dcf7-27f2-4179-af40-85f7d92d56e9"}
```

Esto **ya es progreso real**: la request llega a GoTrue (no más 404), GoTrue le habla a Postgres (no es un error de conexión) — el fallo es en una query puntual.

### Rastreado hasta acá (código de GoTrue, sin ejecutar nada)

- El mensaje sale de `internal/api/admin.go`, en el handler de creación de usuario, envolviendo el error de `models.IsDuplicatedEmail(...)` (`internal/api/apierrors.NewInternalServerError("Database error checking email").WithInternalError(err)`).
- `IsDuplicatedEmail` (`internal/models/user.go`) hace, vía el ORM `pop`: `tx.Eager().Q().Where("email = ?", strings.ToLower(email)).All(&identities)` — un `SELECT` sobre `auth.identities` filtrando por la columna `email`.
- Esa columna **no existe en la tabla base** (`migrations/20210909172000_create_identities_table.up.sql` no la tiene) — la agrega una migración posterior, `20221215195800_add_identities_email_column.up.sql`, como columna **generada**: `email text generated always as (lower(identity_data->>'email')) stored`, más un índice `identities_email_idx`. Sin extensiones (no usa `citext`, no usa `pgcrypto` para esto — confirmado buscando `citext`/`CREATE EXTENSION` en las 70 migraciones de `supabase/auth`: cero resultados).

### Por qué esto NO es (probablemente) el mismo tipo de causa que las anteriores

El contenedor `gotrue` pasó su healthcheck en el run donde ocurrió este 500 — y el arranque de GoTrue es **secuencial y bloqueante**: corre las 70 migraciones primero, recién después levanta el servidor HTTP (`/health` incluido). Si alguna migración hubiera fallado (por ejemplo, por depender de algo que no existe), el proceso habría salido con `level:fatal` y el contenedor habría quedado `Exited`, no `healthy` — exactamente el patrón que ya vimos dos veces esta sesión (schema `auth` faltante, rol `postgres` faltante). Que haya llegado a healthy es evidencia razonablemente fuerte de que **las 70 migraciones corrieron sin error SQL**, incluida la que crea la columna generada `email`.

Eso deja la sospecha en un fallo **en tiempo de ejecución** de esa query puntual, no en el schema en sí.

### Hipótesis, en el orden en que las revisaría

1. **Orden de arranque: `prisma db push` corre DESPUÉS de que GoTrue ya migró y quedó healthy.** Reviso `packages/database/prisma/schema.prisma`:
   - `schemas = ["public", "audit", "ece"]` — **`auth` NO está en la lista**. El `db push` de Prisma con `multiSchema` solo reconcilia los schemas listados explícitamente; no debería tocar tablas de `auth` en absoluto. Esto le resta fuerza a la hipótesis de "Prisma pisó el schema de GoTrue" como causa directa — probablemente **no** es esto, pero no lo descarté al 100% (no until until llegué a ver el error de Postgres subyacente).
   - Sí hay un detalle real: `extensions = [pgcrypto, citext, uuid_ossp(map: "uuid-ossp"), pg_trgm]` con `previewFeatures = ["postgresqlExtensions"]` — el `db push` instala estas 4 extensiones a nivel de base de datos, **después** de que GoTrue ya arrancó. No tengo un mecanismo concreto de por qué instalar `citext`/`pgcrypto`/etc. rompería un `SELECT` sobre una columna generada de texto plano sin esas extensiones — pero es la diferencia de orden más concreta que encontré entre "GoTrue arranca solo" (funciona, según los logs que sí vimos) y "GoTrue arranca + más tarde Prisma toca la base de datos" (el escenario real donde aparece el 500). Vale la pena descartarlo con evidencia real antes que nada más, porque es barato de probar: correr `seed-test-users.mjs` INMEDIATAMENTE después de que GoTrue esté healthy, ANTES de los steps de Prisma, y ver si el 500 desaparece.

2. **RLS en `auth.identities`**: la misma migración que crea el rol `postgres` (`20240612123726_enable_rls_update_grants.up.sql`) hace `alter table auth.identities enable row level security` + el grant a `postgres`. Lo reviso y lo descarto como causa de un *error* (a diferencia de *filas vacías*): el rol `his` es el dueño de la tabla (la creó él mismo, vía el script de init), y Postgres no aplica RLS al dueño de la tabla salvo que se use `FORCE ROW LEVEL SECURITY` (que esta migración no usa). Como GoTrue conecta siempre como `his`, RLS no debería estar filtrando ni rompiendo nada acá. Lo dejo documentado para que nadie lo re-investigue de cero.

3. **Algo más mundano**: ¿el error real de Postgres detrás de `err` es simplemente un typo/columna/tipo que sí depende de algo del entorno (por ejemplo, `text_pattern_ops` en el índice `identities_email_idx` — requiere el operador class de C locale, y el Postgres del contenedor logueó `WARNING: no usable system locales were found` al arrancar, ver logs de `postgres-test` en runs anteriores)? Esto es especulativo — no lo verifiqué — pero el warning de locale SÍ apareció en los logs reales de CI y podría ser relevante para un índice que depende de `text_pattern_ops`.

### Lo que haría YO, en orden, para cerrar esto (no lo hice — presupuesto agotado)

1. Capturar el log real de `gotrue` para ESTE request específico (ver §4 — nunca lo capturé, es el gap más importante).
2. Con el log en mano, probar la hipótesis del orden de arranque (mover el seed de usuarios a correr antes de los steps de Prisma, o después pero sin que hayan corrido las extensiones — un experimento de 1 línea en el workflow).
3. Si el error de Postgres subyacente apunta a `text_pattern_ops`/locale, probar fijando `POSTGRES_INITDB_ARGS: --locale=C` (o `en_US.UTF-8` completo) en `postgres-test`.

---

## 2b. Continuación 2026-08-22 — causa raíz identificada (sin Docker local, otra vez)

**Docker Desktop está roto en esta máquina, por una razón distinta y no relacionada con este stack.** Al intentar levantarlo para reproducir el 500 en vivo, crashea sistemáticamente con:

```
starting services: initializing Inference manager: listening on unix://C:/Users/.../AppData/Local/Docker/run/dockerInference:
remove C:/Users/.../AppData/Local/Docker/run/dockerInference: The file cannot be accessed by the system.
(listener: The filename, directory name, or volume label syntax is incorrect.)
```

`C:\...\AppData\Local\Docker\run\` contenía sockets AF_UNIX (reparse points de Windows) de una corrida previa, corruptos — ni `Remove-Item -Force` ni `del /f /a` pueden borrarlos ("El sistema no tiene acceso al archivo"), pero `Rename-Item` sobre el directorio padre sí funciona (evidencia: ya había carpetas `run.roto-*` de intentos anteriores — el propio Docker Desktop reconoce este patrón). Renombrar `run/` y reiniciar Docker Desktop **recrea el mismo socket corrupto de nuevo en segundos** — el bug se reproduce en la creación, no es un archivo residual. Es un problema del Inference manager (Model Runner) de Docker Desktop 4.79.0 con AF_UNIX en Windows, ajeno por completo a `docker-compose.test.yml`/GoTrue. Edwin lo está resolviendo aparte. Quien retome esto: no pierdas tiempo en `run.roto`/reinstalar — es infra de Docker Desktop, no del proyecto.

**Por eso lo de abajo es 100% análisis de código — CERO verificación en vivo.** Nivel de confianza alto (la cadena de evidencia es completa y viene de fuentes primarias: el código fuente real de `supabase/auth` en el tag que usa la imagen pineada, sus propios scripts de bootstrap, y los tests oficiales de `pgx`), pero sigue siendo una hipótesis hasta que alguien la corra contra un Postgres real.

### La causa raíz: falta `search_path` en la conexión de GoTrue

Cadena de evidencia (todo vía `gh api repos/supabase/auth/contents/...`, código fuente real, no memoria):

1. `internal/api/admin.go:415` — el 500 sale de envolver el error de `models.IsDuplicatedEmail(...)`.
2. `internal/models/user.go` (`IsDuplicatedEmail`) — la query real es `tx.Eager().Q().Where("email = ?", ...).All(&identities)`.
3. `internal/models/identity.go` — `func (Identity) TableName() string { return "identities" }` — **sin calificar de schema**, literal `"identities"`, no `"auth.identities"`.
4. `internal/storage/dial.go` (`DialContext`/`newConnectionDetails`/`applyDBDriver`) — arma la conexión pgx pasando `config.DB.URL` tal cual. **Nunca** setea `search_path`, `Options["Namespace"]` ni nada de schema en la conexión de runtime.
5. Búsqueda de `search_path` en **todo** el repo `supabase/auth` (`gh api "search/code?q=search_path+repo:supabase/auth"`): únicos 2 resultados en todo el repo, y ambos son scripts de bootstrap de Postgres para dev/test — `init_postgres.sh` y `hack/init_postgres.sql` — **nunca** en código Go.
6. Esos dos scripts oficiales hacen, textual:
   ```sql
   CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION supabase_auth_admin;
   ALTER USER supabase_auth_admin SET search_path = 'auth';
   ```
   La migración SÍ funciona sin esto porque el runner de migraciones arma el SQL con el schema calificado a mano vía plantilla Go (`{{ index .Options "Namespace" }}.identities` → `auth.identities`, texto literal antes de ejecutar). Pero las queries de runtime del ORM `pop` (paso 2-3 arriba) NUNCA pasan por esa plantilla — dependen 100% de que el **rol de Postgres** que usa la conexión tenga su propio `search_path` apuntando a `auth`.

`scripts/gotrue-test-init.sql` (de la sesión anterior) crea el schema `auth` y el rol `postgres` de bypass para los GRANT — pero **nunca** hace el equivalente al `ALTER USER ... SET search_path`. El rol real que usa GoTrue (`his`, vía `GOTRUE_DB_DATABASE_URL`) se queda con el `search_path` default de Postgres (`"$user", public`). Resultado: cualquier query sin calificar contra `identities`/`users`/etc. busca en `public` (donde Prisma tiene sus tablas `PascalCase` con comillas — nada que se llame `identities` en minúscula) y falla con `relation "identities" does not exist` — que GoTrue envuelve en el genérico "Database error checking email" antes de devolverlo al cliente. Esto explica exactamente la paradoja que dejó pendiente la sesión anterior (§2, punto "Por qué esto NO es..."): las migraciones pasan (SQL calificado a mano) pero la primera query real de runtime (sin calificar) revienta.

### El fix aplicado (en `docker-compose.test.yml`, servicio `gotrue`)

```
GOTRUE_DB_DATABASE_URL: postgres://his:his@postgres-test:5432/his_e2e?sslmode=disable&search_path=auth
```

Se agregó `&search_path=auth` a la URL. `pgx` (el driver que usa `pop` v5 para Postgres — confirmado en `dial.go`: `driver = "pgx"`) soporta `search_path` como parámetro de conexión de primera clase — no hace falta la sintaxis `options=-c ...`. Evidencia: el test oficial `pgconn/config_test.go` de `jackc/pgx` (caso `"database url everything"`) parsea `postgres://.../mydb?sslmode=disable&search_path=myschema` directo a `RuntimeParams["search_path"] = "myschema"`.

**Por qué así y no `ALTER ROLE his SET search_path = 'auth'` en el SQL de init** (que sería el equivalente más literal al script oficial de GoTrue): el rol `his` es compartido con Prisma, `seed-test-users.mjs` y `db:seed` en el resto del stack — un `ALTER ROLE` persistente le cambiaría el `search_path` por defecto a TODAS las conexiones futuras de ese rol, no solo a las de GoTrue. El parámetro `search_path` en la URL de conexión es un `RuntimeParam` que pgx manda en el mensaje de *startup* — aplica SOLO a las sesiones que abre GoTrue con esa URL puntual, cero blast radius sobre el resto del stack. No hace falta agregar `public` al `search_path`: Postgres 13+ resuelve `gen_random_uuid()` (la única función de extensión que tocan las migraciones de GoTrue, confirmado por `gh api "search/code?q=gen_random_uuid+repo:supabase/auth"` cruzado con `pgcrypto`/`uuid-ossp` — cero resultados) vía `pg_catalog`, que Postgres busca siempre implícito sin importar el `search_path`.

### Qué falta para cerrar esto de verdad

1. **Correrlo.** En cuanto Docker Desktop funcione en algún runner (local o CI): `docker compose -f docker-compose.test.yml up -d --wait && node packages/database/scripts/seed-test-users.mjs` (variables de entorno en §1 de este runbook). Si el análisis es correcto, `qa.admin@his.test` se crea y el script sigue con los otros 4 usuarios sin el 500.
2. Si por algún motivo SIGUE fallando, el siguiente paso es exactamente el que la sesión anterior nunca pudo dar: capturar el log real de `gotrue` (`docker compose -f docker-compose.test.yml logs gotrue`) en el momento del 500 — ahora los workflows `e2e-smoke.yml`/`e2e.yml` tienen un segundo step de diagnóstico (`Dump logs del stack (si algo posterior al boot falló)`, agregado en esta sesión, `if: failure()` justo antes de "Upload Playwright report") que cubre exactamente este caso — el gap que dejó documentado el §4 original de este runbook, que antes solo capturaba logs si "Boot test stack" mismo fallaba.
3. Una vez que `qa.admin@his.test` se cree, seguir con las 5 hipótesis/pasos restantes del §3 de abajo (specs `@smoke` nunca corridas).

---

## 3. Aviso: el gate seguirá rojo aun después de resolver el 500

Cerrar el 500 hace que **el primer** `qa.admin@his.test` se cree. Pero:

- Las **77 specs `@smoke`** nunca corrieron contra un GoTrue real — literalmente nunca, en la historia del repo (el bug original las dejaba fallando en `login()` desde el primer segundo). Es altamente probable que, una vez que `login()` funcione, aparezcan fallos de producto reales: selectors desactualizados, timing, roles (`qa.physician`/`qa.nurse`/`qa.director`) que no resuelven bien contra el `Role` sembrado (el propio script advierte y continúa si `Role.name` no matchea — ver comentario en `seed-test-users.mjs`), gaps de RLS para usuarios recién creados, etc.
- Esto **no es una regresión de esta sesión** — es la primera vez que hay señal real sobre el estado de esas specs. Diagnosticarlas es un trabajo aparte, del tamaño de un sprint de QA, no de esta tanda de SRE.
- Recomendación: una vez cerrado el 500, correr el smoke suite completo, capturar la lista real de specs rojas, y triarlas como un backlog separado — no tratar de resolverlo todo en el mismo PR que arregla la infraestructura.

---

## 4. Lo que nunca verifiqué (gaps explícitos)

- **Docker local nunca funcionó**, ni en esta sesión ni en la anterior — dos intentos independientes, dos máquinas/momentos distintos, mismo resultado (aunque por causas distintas: la sesión original nunca tuvo el daemon disponible; esta sesión sí lo tenía instalado pero Docker Desktop 4.79.0 crashea al arrancar por un socket AF_UNIX corrupto de su propio Inference manager — ver §2b, ajeno a este proyecto). El patrón de trabajo sigue siendo commit → push → leer logs de CI real (`gh run view <id> --log` / `--log-failed`), o esperar a que Docker Desktop quede sano en esta máquina.
- **El log interno de GoTrue para el 500 nunca se capturó — sigue sin capturarse.** La hipótesis de §2b (falta `search_path=auth` en `GOTRUE_DB_DATABASE_URL`) se armó 100% leyendo el código fuente real de `supabase/auth` + los tests de `pgx`, sin ver un solo log de un contenedor `gotrue` real corriendo. Es la pieza de evidencia más importante que falta. El gap del step de diagnóstico que solo cubría un fallo del propio "Boot test stack" (no de steps posteriores) **ya se cerró en esta sesión**: `e2e-smoke.yml`/`e2e.yml` tienen ahora un segundo step "Dump logs del stack (si algo posterior al boot falló)" (`if: failure()`, justo antes de "Upload Playwright report") que si el fix de `search_path` no alcanza, va a mostrar el log real de GoTrue en el próximo run de CI que falle.
- **El fix de `search_path=auth` en `docker-compose.test.yml` está sin correr ni una sola vez** — ni local ni en CI. Es una hipótesis de alta confianza (cadena de evidencia completa en fuentes primarias, ver §2b) pero sigue siendo una hipótesis.
- **Ninguna de las 77 specs `@smoke` llegó a ejecutarse** — todas quedan `skipped` porque el seed de usuarios falla antes de "Build app"/"Run Smoke E2E".
- **No confirmé** si `GOTRUE_MAILER_AUTOCONFIRM=true` alcanza para el flujo completo de login (`signInWithPassword`) — solo se llegó hasta el paso de creación de usuario, nunca a un login real.
- **`a11y.yml` no se tocó** — sigue usando `NEXT_PUBLIC_SUPABASE_URL=https://ci-dummy.supabase.co` y degradando con gracia (salta specs con `role`, ver `HAS_REAL_SUPABASE` en `apps/web/e2e/dod/a11y-baseline.spec.ts`). Cablearlo al GoTrue real quedaría como mejora futura opcional, no bloqueante — no colgaba, a diferencia del bug original de `e2e-smoke.yml`.

---

## 5. Commits de esta sesión (rama `fix/cicd-docker-hardening`)

| Commit | Qué hace |
|---|---|
| `982aa26` | Instrumenta `e2e-smoke.yml`/`e2e.yml`: step "Dump logs del stack" (`if: failure()`) tras "Boot test stack". |
| `1753caa` | `scripts/gotrue-test-init.sql` (nuevo) + mount en `docker-compose.test.yml`: crea schema `auth` + rol `postgres`. |
| `22a1bd3` | `packages/database/scripts/seed-test-users.mjs`: deriva necesidad de SSL de la URL (localhost/sslmode=disable) en vez de exigirlo siempre. |
| `18e0abc` | `scripts/gotrue-test-gateway.conf` (nuevo) + servicio `gotrue-gateway` en `docker-compose.test.yml`: nginx traduce `/auth/v1/*` → raíz de GoTrue. |
| `6de1f2b` | Agrega logs de `gotrue-gateway` + `docker inspect --format {{json .State.Health}}` al step de diagnóstico existente. |
| `6156f6a` | `gotrue-gateway` (nginx) agrega `listen [::]:9999;` — el healthcheck fallaba por IPv6. |

Todos con evidencia real de un run de CI fallando ANTES del commit y (salvo el bloqueo actual del §2) pasando después. Ningún fix de esta lista fue especulativo — cada uno resolvió exactamente el error que aparecía en el log del run anterior.

---

## 6. Continuación 2026-08-24 — el 500 de §2b se cerró solo; nueva causa raíz: CORS `apikey` (run 32588358301, @QA)

El fix de `search_path=auth` del §2b **sí funcionó** (nunca se documentó el cierre porque el `strict mode violation` de otro bug tapaba todo — ver PR #560). Evidencia del run 32588358301 (commit 21ef9bb, YA incluye #560): los tres servicios booteados healthy, `seed-test-users.mjs` completó sin el 500 ("Seed usuarios de test E2E (GoTrue)" en verde), y `strict mode violation` desapareció del log (0 ocurrencias, contra 72 antes). Progreso real.

Pero la suite completa dio **25 failed / 1 passed / 1 flaky / 459 did not run**, el 100% de los fallos con el mismo error:

```
Error: login("admin") no redirigió tras 10000ms.
Mensaje de error visible: Cuenta bloqueada hasta las 11:59 a. m.. Intenta de nuevo en N minutos.
```

### Se descartó la hipótesis "el lockout cuenta logins exitosos"

`apps/web/src/app/actions/login-policy.ts#recordLoginAttempt` resetea `failedAttempts`/`lockedUntil` en cada llamada con `success: true` (línea 135-144) — código correcto, un login real exitoso SIEMPRE limpia el contador. Esto por sí solo no explicaba el bloqueo, así que había que probar la hipótesis contraria: algo hacía fallar el login DE VERDAD, y el lockout (funcionando como diseñado) solo amplificaba el daño.

### Evidencia que decide entre las dos hipótesis: `results.xml` del reporte de Playwright

`gh run download 32588358301` + grep sobre `playwright-report/results.xml` mostró el mensaje real ANTES del primer bloqueo:

```
Mensaje de error visible: Failed to fetch. Causa original: page.waitForURL: Timeout 10000ms exceeded.
```

`"Failed to fetch"` es el `TypeError` que revienta `fetch()` en el navegador cuando una request se bloquea en el cliente (CORS, DNS, conexión rechazada) — **nunca** es el texto de un 400/401 real de GoTrue (esos vienen como `Invalid login credentials`, JSON parseado por `supabase-js`). Cruzando esto con el dump de logs del gateway (`docker compose logs gotrue-gateway --tail=200`, step "Dump logs del stack (si algo posterior al boot falló)"): **10 líneas `OPTIONS /auth/v1/token?grant_type=password` con `204`, CERO líneas `POST /auth/v1/token`** en toda la ventana del run. El preflight CORS se completaba; el POST real nunca salía del navegador.

### Causa raíz confirmada contra el código fuente real (mismo patrón de evidencia que §2b — `gh api`/`curl` contra los tags pineados, no memoria)

1. `supabase-js@2.58.0` (`SupabaseClient.ts#_initSupabaseAuthClient`, línea ~324): TODO cliente de auth se construye con `authHeaders = { Authorization: 'Bearer ' + anonKey, apikey: anonKey }`, mergeado en `this.headers` de `GoTrueClient` — **cada** llamada a `signInWithPassword` manda el header `apikey`, sin excepción, sin flag para desactivarlo.
2. `supabase/auth` (GoTrue) `v2.189.0`, `internal/api/api.go` línea 451-455: el CORS handler (`github.com/rs/cors`) se arma con `AllowedHeaders: globalConfig.CORS.AllAllowedHeaders([]string{"Accept", "Authorization", "Content-Type", "X-Client-IP", "X-Client-Info", audHeaderName, useCookieHeader, APIVersionHeaderName})` — **`apikey` no está en esa lista por defecto.**
3. `internal/conf/configuration.go` línea 415-434: `CORSConfiguration.AllowedHeaders` (env `GOTRUE_CORS_ALLOWED_HEADERS`, vía `envconfig.Process("gotrue", ...)` línea 1049) se **suma** al default (`AllAllowedHeaders`), no lo reemplaza — y `docker-compose.test.yml` nunca la seteaba.
4. Resultado: el navegador manda el preflight `OPTIONS` con `Access-Control-Request-Headers: apikey,...`; GoTrue responde `204` pero su `Access-Control-Allow-Headers` no incluye `apikey`; el navegador, por spec CORS, **bloquea el envío del POST real** sin loggear nada server-side. `signInWithPassword` rechaza la promesa con `TypeError: Failed to fetch`. `login-policy.ts` registra esto como fallo real (correctamente — SÍ fue un fallo real) y a la 5ª vez bloquea la cuenta 15 min. Como la causa persiste, se re-bloquea en bucle durante toda la corrida (de ahí los tres `lockedUntil` distintos vistos en el log: 11:59, 12:10, 12:15 — no es un solo lock decayendo, son bloqueos sucesivos).

**Veredicto: hipótesis (B).** El lockout de `login-policy.ts` no tiene ningún defecto — hizo exactamente lo que debía con 5 fallos reales consecutivos. La causa real es un gap de configuración CORS del stack de test (`docker-compose.test.yml`), sin relación con producción (Supabase real hospeda GoTrue detrás de Kong, que sí trae `apikey` preconfigurado en su CORS).

### Fix aplicado

`docker-compose.test.yml`, servicio `gotrue`: se agregó `GOTRUE_CORS_ALLOWED_HEADERS: apikey`. Además, `e2e.yml` y `e2e-smoke.yml` ganaron un step nuevo "Verificar CORS de GoTrue (apikey) — fail-fast" inmediatamente después de "Boot test stack": un preflight `curl -X OPTIONS` contra `/auth/v1/token` que falla el job en segundos si `apikey` no aparece en `Access-Control-Allow-Headers`, en vez de quemar ~19 minutos de suite completa para llegar al mismo diagnóstico. Comentarios inline en ambos archivos documentan la cadena de evidencia completa para quien lo vea sin este runbook.

### Qué falta para cerrar esto de verdad

- **Sin verificar en vivo** — Docker Desktop sigue roto en esta máquina (mismo problema del §2b, no relacionado con el proyecto). El fix se armó 100% contra el código fuente real de `supabase-js` y `supabase/auth` en los tags exactos que usa este repo, con la misma disciplina de evidencia que cerró el §2b — pero como aquel, sigue siendo una hipótesis de alta confianza hasta que corra en CI real.
- Si el fix es correcto, el próximo run de `e2e.yml`/`e2e-smoke.yml` debería completar `login()` real y avanzar a las 459 specs que nunca llegaron a correr — momento en el que, tal como anticipa el §3 de este runbook, es esperable ver fallos de producto reales (selectors, timing, roles) que hasta ahora nunca tuvieron la oportunidad de aparecer.
- Si el preflight check nuevo falla en CI real con un `Access-Control-Allow-Headers` que SÍ incluye `apikey` pero el POST real sigue sin llegar, el siguiente sospechoso es `Access-Control-Allow-Methods` (no incluye `OPTIONS` en la lista de `api.go` línea 452 — pero `rs/cors` maneja preflight aparte del middleware normal, así que no debería importar; queda como hipótesis de repuesto, no verificada).
