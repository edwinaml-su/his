# Runbook: Reconstrucción de la base de datos fuera de Supabase

Nivel: @DBA / SRE / Dev lead
Refs: `CLAUDE.md` (§ contrato RLS, § gotchas), `docs/04_modelo_datos.md`, `docs/12_rls_validation.md`,
`docs/15_production_runbook.md`, `packages/database/scripts/reconstruct-schema.mjs`

---

## 0. Qué es esto y qué NO es

Esto **no es una migración**. Es la respuesta a una pregunta más incómoda: *si hoy tuviéramos que
reconstruir esta base de datos en un Postgres que no es Supabase (RDS, Cloud SQL, on-prem) — ya sea
por DR real o por decisión de portar la plataforma — ¿existe un procedimiento reproducible y
verificado para hacerlo?*

Antes de este documento, la respuesta honesta era: **no.** El estado de Postgres vive en 227 archivos
SQL numerados en `packages/database/sql/` aplicados a mano contra Supabase durante meses, sin tabla de
control de aplicados, con colisiones de numeración documentadas (ver §1) y con drift conocido pero
nunca cuantificado contra `schema.prisma`. Este runbook y el script que lo acompaña
(`packages/database/scripts/reconstruct-schema.mjs`) cierran la brecha de **capacidad** — que el
procedimiento exista y esté probado — no ejecutan ninguna migración real. **Nada de este trabajo tocó
la base de datos de producción** (`ejacvsgbewcerxtjtwto`); todo se corrió y verificó contra un Postgres
local efímero.

**Sé honesto contigo mismo antes de usar esto en un día malo:** la reconstrucción probada en §5 aplica
limpio el **66% del corpus (150/227)**. El 34% restante falla, por razones que van desde "es basura
legada que debería borrarse" hasta "hay una tabla en producción sin ningún DDL de origen en este repo".
Este documento no promete una reconstrucción de un solo comando — promete decirte, con evidencia,
exactamente dónde se rompe y por qué.

---

## 1. Diagnóstico cuantificado del corpus SQL

Escaneo completo de `packages/database/sql/*.sql` (no muestreado salvo donde se indica), worktree
`chore/db-migration-baseline` sobre `origin/main` @ `23fbb04`.

| Métrica | Valor |
|---|---|
| Archivos `.sql` | **227** (más `__tests__/` que no son SQL) |
| Rango de numeración | `01_` a `198_` |
| Números de prefijo únicos usados | ~140 |
| Números de prefijo con **más de un archivo** | 25 |
| — de esos, progresión legítima con sufijo de letra (`30a`/`30b`, `72`/`72b`, `186a`/`186b`) | 3 grupos |
| — de esos, **archivos de temas distintos compartiendo el mismo número**, sin señal de orden entre ellos más que el alfabético del nombre | **22 grupos, ~50 archivos** (`25`,`26`,`27`,`28`,`32`,`34`,`56`,`57`,`58`,`59`,`60`,`61`,`95`,`96`,`97`,`98`,`99`,`100`,`127`,`128`,`185`,`196`) |
| Colisión documentada por control-de-cambios (`185`/`186` entre dos CCs distintos) | Confirmada — ver `project_his_cc0008b_2026-07-27` en memoria de sesión |
| `CREATE [OR REPLACE] FUNCTION` totales | 160 (161 detectados por grep crudo) |
| — `SECURITY DEFINER` | 34 |
| — de esas, con `SET search_path` explícito | 27/34 |
| — de esas, **sin** `SET search_path` (gap de seguridad activo) | **7/34**: `ece.fn_assert_wristband_gsrn` (111), `ece.fn_check_dedup_nui_dui` (58), `ece.fn_check_dir_certificar` (62), `ece.fn_gs1_epcis_event_immutable` (94), `public.current_portal_account` (52), `ece.set_ece_context` (62), `public.expire_pharmacy_reservations` (89) |
| `CREATE TRIGGER` totales | 129 detectados (121 parseados con tabla destino, 94% cobertura) |
| Tablas distintas con ≥1 trigger | 87 |
| `model` en `schema.prisma` | 249 (81 mapeados a `@@schema("ece")`) |
| Tablas `CREATE TABLE` en el corpus SQL (todas) | 163 únicas — 98 en `ece.*`, 4 en `analytics.*`, 61 en `public`/sin prefijo |
| Tablas `public` creadas por SQL **sin** model Prisma equivalente (drift confirmado) | **14**: `NpsResponse`, `PerformanceSample`, `ServicePriceList`, `ServicePriceListItem`, `SrsFabricante`, `SrsFormaFarmaceutica`, `SrsPresentacion`, `SrsPrincipioActivo`, `SrsRegistroCache`, `WorkflowTaskAction`, `secuencia_cuenta`, `secuencia_expediente`, `secuencia_no_identificado`, `secuencia_solicitud_imagen` |
| Columnas `srs*` de `135_srs_registro_sanitario.sql` faltantes en `model Drug` | 19/19 (0% cobertura) — el hallazgo de mayor volumen de drift por columnas |
| Tabla activa en producción **sin CREATE TABLE en ningún archivo del corpus** | `public.chat_session` (y `chat_message`) — ver §5.4 |

**Lectura del hallazgo de numeración:** la premisa "el orden numérico determina el orden de aplicación"
es falsa para al menos 22 números de prefijo. El caso extremo es `99_*` — **14 archivos** distintos
comparten ese número; 12 de ellos se commitearon el mismo día (2026-05-19), casi seguro por streams
paralelos de agentes en la misma wave, y el orden alfabético entre ellos es un artefacto del nombre de
archivo, no una decisión de dependencia real. No hay forma de recuperar el orden real de aplicación en
producción a partir del repo — no existe tabla de control de aplicados en Supabase para este corpus.

**Nota de alcance sobre `ALTER TABLE ADD COLUMN`:** se muestrearon los archivos que `CLAUDE.md` nombra
explícitamente (`25`/`26`/`27`/`28`_hardening(_v2), `30`/`30a`/`30b`, `32`_emar_hardening(_v2)) —
contra lo que sugiere el texto de `CLAUDE.md`, esos 4 primeros grupos **no usan `ADD COLUMN`** (son
índices/constraints/triggers); `30` y `32` sí, y sus 17 columnas están cubiertas en `schema.prisma`
(0% drift ahí). El drift real de columnas está concentrado en `135_srs_registro_sanitario.sql` (19/19
columnas `srs*` faltantes en `model Drug`) y, según la prueba de reconstrucción de §5, en varias
columnas de tablas `ece.*` que el corpus asume presentes pero que `schema.prisma` no modela
(`organization_id` en `ece.institucion`, `his_user_id` en `ece.personal_salud`,
`public_patient_id` en `ece.paciente`, `establecimiento_id` en varias, entre otras — lista completa en
§5.2).

---

## 2. Estrategia de baseline: por qué NO es Prisma-migrate

Las tres opciones evaluadas, con el criterio de que **RLS, triggers, la cadena de hash de auditoría,
funciones `SECURITY DEFINER` y el motor de workflow ECE no los genera Prisma** — son SQL a mano, y lo
van a seguir siendo:

### 2.1 Descartada: baseline Prisma (`migrate diff` → `0_init` → `migrate resolve --applied`)

Esto convertiría a Prisma en la fuente de verdad de aquí en adelante, con `prisma migrate dev/deploy`
generando migraciones versionadas. **La descarto** por tres razones concretas, no por dogma:

1. **No modela la mayoría del objeto real de la BD.** De 227 archivos SQL, la porción que Prisma
   *podría* haber generado (CREATE TABLE/ALTER TABLE ADD COLUMN puros) es una fracción — RLS
   (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + `CREATE POLICY`), 129 triggers, 34 funciones
   `SECURITY DEFINER`, el motor ECE (triggers + funciones `STABLE`), no tienen representación en el
   DSL de Prisma. Un baseline Prisma dejaría esa mayoría del estado real **fuera** de la herramienta
   que se supone es la fuente de verdad — contradicción de origen.
2. **El equipo ya trabaja con SQL numerado, con una razón deliberada documentada** (`CLAUDE.md`: "Sin
   carpeta `prisma/migrations`... Es deliberado"). Forzar Prisma migrate como fuente de verdad
   requeriría además meter TODO el SQL no-tabular (RLS/triggers/SECDEF/ECE) dentro de migraciones
   Prisma como SQL crudo (`prisma migrate dev --create-only` + edición manual) — en la práctica, eso
   es exactamente el mismo SQL a mano que ya existe, solo que ahora también hay que mantener el diff
   contra un `migrations/` que Prisma valida por checksum. Se gana el tooling de Prisma (`migrate
   status`, `migrate resolve`) pero se paga con fricción en cada release: los archivos SQL fuera de
   Prisma seguirían necesitando su propio mecanismo de aplicación/registro de todos modos.
3. **El baseline en sí mismo requeriría introspectar la BD de producción** (`prisma db pull` o
   `migrate diff --from-url <prod> --to-empty`) para capturar el estado real — algo que esta tarea
   tiene prohibido hacer contra prod, y que además **no cerraría** el drift ya cuantificado en §1 (las
   14 tablas y las columnas `srs*` seguirían sin modelo Prisma a menos que alguien las agregue a mano
   al `schema.prisma` de todos modos, en cuyo punto ya se hizo el trabajo real sin necesitar el
   baseline).

**Conclusión: Prisma sigue como generador de tipos + `db push` para el subconjunto tabular que sí
modela** (250 models). Nunca como ejecutor de migraciones contra prod — eso ya está prohibido en
`CLAUDE.md` y esta evaluación lo confirma, no lo cambia.

### 2.2 Descartada (por ahora): dump estructural versionado como artefacto de referencia

Un `pg_dump --schema-only` congelado periódicamente (ej. post-release) es barato y da un snapshot real
verificable — pero es un **artefacto de lectura**, no un procedimiento de reconstrucción: no dice en
qué orden aplicar nada nuevo, no tiene idempotencia, y un dump de un estado con drift desconocido
simplemente congela el drift sin resolverlo. Lo recomiendo como **complemento** (§8), no como
estrategia principal.

### 2.3 Elegida: runner idempotente propio sobre el corpus SQL numerado existente

`packages/database/scripts/reconstruct-schema.mjs` (nuevo, este PR). Aplica los 227 archivos en el
orden canónico ya establecido por el repo (`sort -V`, el mismo que usa
`scripts/apply-local-sql.sh` — ver nota de diseño en el propio script sobre por qué se delega a `sort
-V` del SO en vez de reimplementar version-sort en JS: un primer intento con
`String.localeCompare(numeric:true)` dio un **orden distinto** al de `sort -V` para pares como
`25_inpatient_hardening.sql` vs `25_inpatient_hardening_v2.sql` — tener dos algoritmos de "orden
natural" compitiendo en el mismo repo sería peor que el problema original).

Encima del orden, agrega lo que el flujo actual no tiene:

- **Tabla de control** `public._sql_baseline_applied` (filename + checksum SHA-256 + timestamp) —
  reintentar el runner no reaplica lo ya aplicado, y detecta si un archivo "ya aplicado" cambió de
  contenido desde entonces (`WARN`, no bloquea, pero avisa).
- **Para en el primer error** por default (modo real de reconstrucción) — no sigue escribiendo sobre
  un estado roto. `--continue-on-error` es solo para diagnóstico exhaustivo (así se generó §5).
- **Guard anti-prod** idéntico al de `scripts/apply-local-sql.sh` (rechaza URLs que contengan
  `ejacvsgbewcerxtjtwto`, `supabase.co` o `complejoavante`).

Esto **no** reemplaza `prisma db push`/`generate` para el subconjunto que Prisma sí modela — los usa
como fase previa (§4). Es deliberadamente el mecanismo más simple que cierra la brecha real (orden
determinístico + idempotencia + diagnóstico), sin introducir una herramienta nueva (dbmate, Flyway,
node-pg-migrate) que el equipo tendría que aprender para un corpus que ya existe y funciona en
producción tal cual está.

---

## 3. Prerrequisitos — qué es de Supabase y qué es portable

> **Nota de autoría (2026-08-19, @AT):** esta sección se reescribió y se amplió a partir de una
> evaluación dedicada a las 6 dependencias reales de plataforma (extensiones/schema `extensions`,
> `pg_cron`, schema `auth`/GoTrue, Vault, roles, `extensions.crypt`). Los hallazgos de §3.1–§3.4 están
> **verificados**, no solo leídos: introspección real de extensiones instaladas en prod
> (`ejacvsgbewcerxtjtwto`, vía `mcp__supabase__list_extensions`, solo lectura) + una prueba end-to-end
> contra un Postgres 18.4 nativo efímero (`scoop`, sin Docker — Docker seguía caído en esta sesión) que
> reproduce RLS multi-tenant completo **sin que exista el schema `auth` en absoluto**. El resto del
> documento (§0, §1, §2, §4, §5, §6, §7, §8, secciones de otros dos agentes en la misma tarea) no se
> tocó — solo esta sección.

### 3.0 Resumen ejecutivo (antes de entrar al detalle)

El runbook original trataba `auth.*`/GoTrue como "el gap más grande, sin sustituto". Eso **sobre-estima
el problema real**. Desagregando qué depende de qué:

| Depende de Supabase de verdad | Sustituto | Costo/riesgo |
|---|---|---|
| Roles `anon`/`authenticated`/`service_role` + `bi_reader` (propio) | `CREATE ROLE` una vez por cluster | **Ninguno** — probado |
| Schema `extensions` + `pgcrypto`/`citext`/`uuid-ossp`/`pg_trgm`/`pg_stat_statements` | `CREATE SCHEMA` + `CREATE EXTENSION` (contrib estándar) | **Ninguno** — probado |
| **RLS multi-tenant en sí** (`current_org_id()`, `withTenantContext`, políticas) | Nada — **ya no depende de `auth.*`** | **Ninguno** — probado, ver §3.3.1 |
| `pg_net` (HTTP async desde Postgres, usado por el poller de outbox) | No es contrib; no está en RDS/Cloud SQL; requiere compilar/instalar el proyecto `supabase/pg_net` o rediseñar sin él | Medio — ver §3.2 |
| `pg_cron` (15 jobs reales en 4 archivos) | Scheduler externo (K8s CronJob / GH Actions schedule) llamando un endpoint interno | Bajo-medio — ver §3.2 |
| Supabase Edge Function `notifications-dispatch` (destino del poller de outbox) | Cualquier endpoint HTTP interno (ya existe el patrón de router tRPC) | Bajo — ver §3.2 |
| Supabase Vault (`vault.*`, pgsodium) | Cifrado app-layer AES-256-GCM (ya existe como fallback, hay que promoverlo a único) | Bajo — ver §3.4 |
| **Login/sesión real** (`supabase.auth.signInWithPassword`, SSO Azure, MFA, `resetPassword` admin) | GoTrue self-hosted (stack de E2E, con brecha de madurez — ver §3.3.2/3.3.3) o reescritura a un proveedor propio | **Alto** — la única decisión de arquitectura real que queda abierta |

La distinción que importa: **"RLS deja de aplicar sin Supabase" es falso** — se probó lo contrario en
§3.3.1. Lo que sí es cierto es que **el login deja de funcionar** sin un backend compatible con
`supabase-js`, porque 17 archivos de `apps/web` llaman `supabase.auth.*` directamente. Son dos
problemas de tamaño muy distinto que el documento original mezclaba en una sola fila de tabla.

---

### 3.1 (A1) Schema `extensions` y extensiones — verificado, sin gap real

Introspección real de prod (`ejacvsgbewcerxtjtwto`, Postgres 17.6.1, solo lectura vía
`mcp__supabase__list_extensions`): de ~80 extensiones *disponibles* en la imagen de Supabase, las
**instaladas** son 10: `pgcrypto`, `pg_net`, `plpgsql` (siempre presente), `vector` (pgvector 0.8.0),
`supabase_vault`, `pg_cron`, `uuid-ossp`, `citext`, `pg_trgm`, `pg_stat_statements`. De esas, **6 viven
en el schema `extensions`** (`pgcrypto`, `pg_net`, `uuid-ossp`, `citext`, `pg_trgm`,
`pg_stat_statements`) y **3 no** (`pg_cron` → `pg_catalog`, `supabase_vault` → schema propio `vault`,
`plpgsql` → `pg_catalog` siempre).

Prueba local (Postgres 18.4 nativo, sin Docker, sin nada de Supabase instalado):

```sql
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto           WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS citext             WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp"        WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm            WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;
```

**Aplicó limpio, las 5 quedaron en `extensions`** (`pg_stat_statements` no está en `24_security_hardening.sql`
pero se agregó a la prueba porque Prisma no la declara y sin embargo vive ahí en prod — dato nuevo, no
estaba en el diagnóstico original). Estas 5 son contrib estándar — vienen con **cualquier** distribución
de Postgres (apt/yum, la imagen oficial de Docker, RDS, Cloud SQL, y hasta el build de Windows de scoop
usado en esta prueba). Cero riesgo, cero costo. `24_security_hardening.sql` solo necesita que exista el
schema antes de aplicarse — un `CREATE SCHEMA IF NOT EXISTS extensions;` al inicio del procedimiento de
reconstrucción (§4) es suficiente; no hace falta editar el archivo.

**`pg_net` y `pg_cron` NO son contrib** — se confirmó negativamente: en el Postgres 18.4 nativo de la
prueba, `SELECT * FROM pg_available_extensions WHERE name IN ('pg_cron','pg_net','vector','supabase_vault')`
devuelve **cero filas** para las 4. No es una cuestión de dónde crear el schema — son extensiones que
Supabase compila y empaqueta para su propia imagen; fuera de esa imagen hay que compilarlas o usar un
Postgres que ya las incluya (ver §3.2 y §3.4). Esto es una corrección al diagnóstico original, que
trataba "extensiones" como una sola fila homogénea.

---

### 3.2 (A2) `pg_cron` — 4 archivos, **15 jobs reales** (no 6), dos dependencias adicionales ocultas

Los 4 archivos (`44`, `51`, `89`, `120`) registran, contados uno por uno en el código:

| Archivo | Jobs `cron.schedule(...)` | Qué hace | Cadencia |
|---|---|---|---|
| `44_notifications_outbox_poller.sql` | 1 (`notifications-poll-outbox`) | Lee `DomainEvent` sin publicar (`publishedAt IS NULL`), llama vía **`pg_net`** (`net.http_post`) a una **Supabase Edge Function** (`app.notifications_dispatch_url`) con backoff exponencial (`FOR UPDATE SKIP LOCKED`) | cada 1 min |
| `51_bi_pg_cron_refresh.sql` | 12 (`bi_refresh_dim_*` ×6, `bi_refresh_fact_*` ×5, `bi_purge_refresh_log` ×1) | `REFRESH MATERIALIZED VIEW CONCURRENTLY` de las matviews de `analytics.*` (BI) con logging en `analytics.bi_refresh_log`; el job de purga borra logs >90 días | diario 03:00–03:15 UTC (dims SCD1), horario (dims frecuentes + facts clínicos), cada 4h (facts financieros), semanal (purga) |
| `89_pharmacy_reservation_expire_cron.sql` | 1 (`his-expire-pharmacy-reservations`) | Expira `PharmacyReservation` vencidas y encola notificación al farmacéutico | cada 5 min |
| `120_morse_sla_watchdog.sql` | 1 (`morse_sla_watchdog`) | JCI IPSG.6 — emite `DomainEvent` si un episodio hospitalario activo lleva >12h sin reevaluación de escala Morse | cada hora |

**Total: 15**, no 6 — el número "6 jobs" del encargo original subestima el corpus real (probablemente
contaba archivos, no `cron.schedule()` calls; el propio runbook original también decía "6 archivos" en
un punto y "6 jobs" en otro, mezclando ambos). Los 12 jobs de `51` son el volumen dominante pero también
el más simple de migrar: son *puro scheduling* sobre una función SQL ya existente
(`analytics.fn_refresh_matview`), sin dependencias de red.

**Hallazgo no capturado en el diagnóstico original:** `44` no depende solo de `pg_cron` — depende
**además** de `pg_net` (extensión de HTTP asíncrono, tampoco contrib — ver §3.1) y de una **Supabase Edge
Function** (`notifications-dispatch`, runtime Deno propietario de Supabase, no existe fuera de la
plataforma). Migrar ese job específico no es "cambiar el scheduler" — es rediseñar el mecanismo de
disparo completo.

**Decisión recomendada (@AT, Well-Architected: *Operational Excellence* + *Reliability* — evitar un
componente de infraestructura que no está disponible de forma uniforme entre RDS/Cloud SQL/on-prem):**

1. **`51` (12 jobs de refresh BI) y `89`/`120` (2 jobs de dominio)** → mover a **scheduler externo**
   llamando un endpoint HTTP interno (K8s `CronJob` si el target es K8s; `workflow_dispatch`/schedule de
   GitHub Actions si se prefiere reusar el patrón que el repo ya tiene en `db-migrate.yml`). Estos 14
   jobs son triviales de portar: cada uno ya es una llamada a una función SQL única
   (`analytics.fn_refresh_matview`, `public.expire_pharmacy_reservations`, el `INSERT` del watchdog) —
   el endpoint solo necesita ejecutar `SELECT <función>()` con el rol correcto. Costo: bajo (una función
   Edge/Lambda/CronJob delgada por job, o un único endpoint parametrizado).
2. **`44` (outbox poller)** → **no reemplazar pg_net + Edge Function 1:1**. Reemplazar el patrón entero
   por un worker HTTP normal (K8s `CronJob` o proceso long-running) que hace el `SELECT ... FOR UPDATE
   SKIP LOCKED` vía conexión Postgres normal (no `pg_net`) y llama al endpoint de notificaciones
   directamente desde el propio worker — es estrictamente más simple que reproducir `pg_net` fuera de
   Supabase, y el proyecto ya tiene el precedente arquitectónico (ADR 0008, outbox pattern) sin atarlo a
   `pg_net` específicamente en su diseño conceptual, solo en la implementación SQL actual.
3. **No vale la pena instalar `pg_cron` compilado a mano en RDS/on-prem** solo para estos 15 jobs —
   RDS sí lo soporta (parameter group `shared_preload_libraries=pg_cron` desde Postgres 12), pero
   Cloud SQL no, y on-prem requiere compilar y mantener el `.so` — un costo operativo recurrente
   (parchear con cada minor de Postgres) por un beneficio que un `CronJob` de K8s da gratis y sin
   atar el destino de la migración a "debe ser RDS". Este punto **queda abierto para @SRE/@BID** (dueños
   operacionales de los jobs) — no lo decido unilateralmente, ver ADR 0020 (§3.3.3) para el paralelo con
   la decisión de auth.

---

### 3.3 (A3) Schema `auth`/GoTrue — el gap se reduce, pero no desaparece

#### 3.3.1 Lo que se pensaba que dependía de `auth.*` y **no depende** (probado)

`docs/runbooks/e2e-gotrue-auth.md` ya documenta que `withTenantContext`
(`packages/trpc/src/rls-context.ts`) setea GUCs (`app.current_user_id`/`app.current_org_id`) en vez de
depender de `auth.jwt()`. Lo que el runbook original **no verificaba** es si eso es cierto en la
práctica o si sigue habiendo una dependencia indirecta. Se probó de punta a punta:

1. Postgres 18.4 nativo, **sin crear el schema `auth` en ningún momento** (`SELECT nspname FROM
   pg_namespace WHERE nspname = 'auth'` devuelve 0 filas durante toda la prueba).
2. Se aplicaron únicamente las funciones helper reales de `04_rls_session_helpers.sql`
   (`current_org_id()`, `set_tenant_context()`) y una tabla `Patient` con la misma política RLS que usa
   el proyecto (`organizationId = public.current_org_id()`).
3. `SELECT public.set_tenant_context(...)` + `SET LOCAL ROLE authenticated` dentro de una transacción,
   exactamente el patrón de `applyTenantContext()` → **RLS filtró correctamente por organización**
   (1 fila visible de Org A con contexto Org A, 1 fila de Org B con contexto Org B, cero cross-tenant
   leak) sin que `auth.*` existiera.

**Conclusión dura:** la ruta de producción real (`withTenantContext`, usada en ~150+ call sites de
routers tRPC) **no tiene ninguna dependencia runtime de GoTrue/`auth.*`**. La fila única que el runbook
original dedicaba a "`auth.*`: no hay sustituto, gap más grande" describía un problema más grande del
que existe.

#### 3.3.2 Lo que sí depende de `auth.*` — acotado a 6 FK + 17 call sites de `supabase-js`

**A nivel SQL**, de los 8 archivos que matchean `auth\.(uid|jwt|users|identities)`, **solo 6 tienen una
dependencia real** (los otros 2 son comentarios: `01_rls_policies.sql:3` menciona `auth.jwt()` en un
comentario de intención, no en código; `62_ece_07_rls.sql:75` nombra una columna `auth_user_id` con un
comentario, no una FK). Los 6 reales son, en todos los casos, **una FK `REFERENCES auth.users(id)`**,
nunca una llamada a `auth.uid()`/`auth.jwt()` en lógica de policy o de función:

| Archivo | Columna | Semántica |
|---|---|---|
| `119_fall_event.sql:69` | `reportado_por` | quién reportó la caída (JCI IPSG.6) |
| `57_ece_02_seguridad.sql:41` | `ece.personal_salud.auth_user_id` (FK opcional) | vínculo directorio de personal ↔ cuenta Supabase |
| `78_proceso_b_transfers.sql:35,37` | `registrado_por`, `verificado_por` | trazabilidad GS1 de transferencias |
| `83_inventory_thresholds.sql:31` | `configurado_por` | quién configuró el umbral de inventario |
| `99_certificado_defuncion_workflow.sql:13` | `medico_firmante_id` | firmante del certificado de defunción |
| (`80_proceso_f_devoluciones.sql:47`) | `created_by` | **ya no tiene FK explícita** — el propio comentario del archivo dice "no FK explícita para evitar cross-schema", confirmando que el equipo ya identificó y evitó este problema una vez |

**Sustituto probado:** apuntar la FK a `public."User"(id)` en vez de `auth.users(id)`. Se probó (mismo
Postgres 18.4, sin `auth.*`): `CREATE TABLE fall_event_test (... reportado_por uuid REFERENCES
public."User"(id) ...)` — aplica limpio, mismo comportamiento (`ON DELETE SET NULL`/`RESTRICT` no cambia
de semántica). Esto **no es un cambio de arquitectura** — es una sustitución de columna referenciada, 6
archivos, bajo riesgo. La razón por la que **no lo hice** en este sprint: estos 6 archivos ya están
aplicados contra prod (Supabase real, con `auth.users` vivo) — reescribir el archivo numerado
existente rompería la disciplina "forward-only" del corpus (§2.3) y generaría drift entre lo aplicado
en prod y lo que el archivo dice. El camino correcto es un **archivo nuevo, numerado, que se aplique
condicionalmente** (o vive en un overlay `sql/portable/` separado que sustituye estos 6 `ALTER
TABLE ... DROP CONSTRAINT / ADD CONSTRAINT ... REFERENCES public."User"(id)` solo cuando el target no es
Supabase) — no lo escribí porque toca la disciplina de numeración que dos agentes en paralelo (categorías
C/E y D) también están tocando esta misma tarea; lo dejo como recomendación concreta, no como archivo
nuevo, para no colisionar.

**A nivel aplicación**, la dependencia real de GoTrue está en:

- **17 archivos de `apps/web`/`packages/trpc`** llaman `supabase.auth.*` directamente (`getUser`,
  `getSession`, `signInWithPassword` vía los helpers de `apps/web/src/lib/supabase/{client,middleware}.ts`
  y `apps/web/src/lib/auth/session.ts`, más flujos de MFA/SSO/recovery/idle-monitor). **Esto es lo que
  realmente no funciona sin un backend compatible con `supabase-js`** — no RLS.
- `packages/trpc/src/routers/user-admin.router.ts` (`resetPassword`, ~línea 471): hace `$queryRaw`
  contra `auth.users`/`auth.identities` directamente (no vía `supabase-js`) para setear
  `encrypted_password` con `extensions.crypt(...)` y asegurar una identidad `email`. Depende de:
  (a) la tabla `auth.users` de GoTrue existiendo con ese schema exacto, (b) `extensions.crypt`/`gen_salt`
  (pgcrypto — portable, ver §3.1). Fuera de Supabase esto se reescribe contra la tabla de usuarios del
  proveedor de auth que se elija — no hay forma de portarlo 1:1 sin decidir primero el proveedor.

#### 3.3.3 Veredicto sobre reusar el stack GoTrue de E2E para producción

El stack de `docker-compose.test.yml` (postgres + `supabase/gotrue:v2.189.0` + gateway nginx que
traduce `/auth/v1/*`) es **el punto de partida correcto, no un stack de producción**. Es el mismo
binario que corre en Supabase real — reusarlo evita reescribir los 17 call sites de `supabase-js` y el
flujo de SSO/MFA, que es exactamente el trabajo caro que un reemplazo (NextAuth/Auth.js) sí exigiría.
Lo reutilizable de verdad:

- El **bootstrap de schema** (`scripts/gotrue-test-init.sql`: `CREATE SCHEMA auth` + `CREATE ROLE
  postgres`) — investigado contra el código real de `supabase/auth`, no adivinado. Aplica igual en
  cualquier Postgres.
- El **gateway `/auth/v1/*` → raíz** (`scripts/gotrue-test-gateway.conf`) — necesario porque
  `supabase-js` siempre arma esa ruta y GoTrue no la entiende sin Kong. Portable tal cual.
- Las **variables de configuración de GoTrue** (`GOTRUE_JWT_*`, `GOTRUE_DB_*`) — verificadas contra
  `internal/conf/configuration.go` del repo real, no inventadas.

Lo que le falta para ser producción — ninguno de estos puntos es opcional, y ninguno se cerró en esta
sesión (Docker seguía caído; solo se pudo verificar la parte de schema/roles contra Postgres nativo,
sin GoTrue):

1. **El bloqueo abierto documentado en `e2e-gotrue-auth.md` §2**: `500 Database error checking email` al
   crear el primer usuario vía `POST /admin/users`. Sin resolver esto, el stack no crea usuarios — es
   un bloqueo de funcionalidad básica, no de hardening. Las hipótesis documentadas (orden de arranque
   Prisma vs GoTrue, locale `text_pattern_ops`) no se investigaron más en esta sesión — sigue siendo el
   primer paso de cualquiera que retome esto.
2. **Persistencia real.** El compose de test usa `tmpfs` (se destruye el data dir al bajar el stack) —
   deliberado para CI, catastrófico para prod. Prod necesita volumen persistente + backup/PITR del
   propio Postgres que aloja `auth.*` (puede ser el mismo cluster que aloja `public`/`ece`, ya que GoTrue
   solo necesita su propio schema en la misma base).
3. **Gestión de secretos.** `GOTRUE_JWT_SECRET` tiene un default hardcodeado en el compose
   ("`e2e-gotrue-test-secret-do-not-use-in-prod-only`" — el propio nombre lo dice). Prod necesita el
   secreto en un secret manager (K8s `Secret`/Vault externo/SSM), rotación, y el mismo secreto
   sincronizado con `NEXT_PUBLIC_SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` que hoy Vercel inyecta
   como env vars de Supabase real.
4. **Correo real.** `GOTRUE_MAILER_AUTOCONFIRM=true` autoconfirma todo email en el stack de test — en
   prod hace falta un SMTP real (`GOTRUE_SMTP_*`) para magic-link, recovery, invitaciones — ninguna de
   esas variables está en el compose actual.
5. **HA / disponibilidad.** El compose de test es un único contenedor de GoTrue sin réplicas, sin
   health-based failover, sin balanceo. Si GoTrue es el único backend de login, es un **punto único de
   falla para toda la aplicación** (nadie inicia sesión sin él) — en Supabase managed esto lo resuelve la
   plataforma; self-hosted es responsabilidad de @SRE (réplicas + readiness probes + `PodDisruptionBudget`
   si el target es K8s).
6. **`service_role`/RLS con JWT real.** Como se probó en §3.3.1, RLS **no** necesita que GoTrue emita el
   JWT — pero **la sesión de usuario en el navegador sí** (`supabase.auth.getUser()` valida el JWT
   contra el `GOTRUE_JWT_SECRET`). Falta verificar en runtime real (no se pudo, sin Docker) que un login
   completo (`signInWithPassword` → cookie de sesión → `getUser()` en el middleware) funciona end-to-end
   contra GoTrue self-hosted — el stack de E2E nunca llegó a probar esto (bloqueado en el punto 1).
7. **Superficie de parcheo propia.** Operar GoTrue self-hosted significa que el equipo pasa a ser
   responsable de sus CVEs y de sus upgrades — hoy Supabase lo hace de forma transparente. Es un costo
   operativo permanente, no un costo de una sola vez.

**Veredicto (@AT):** reusar GoTrue **es la opción correcta si el objetivo es portar el motor de datos sin
reescribir la capa de auth** — evita el mayor costo de ingeniería (17 call sites + SSO + MFA). Pero
**"reutilizable" no significa "listo"**: hay un bloqueo funcional sin diagnosticar y 6 brechas de
madurez de producción (persistencia, secretos, correo, HA, verificación end-to-end, parcheo) que
representan más trabajo que el stack de test en sí. Ver ADR 0020 para el marco de decisión completo
(incluye la alternativa B: reescribir contra un proveedor propio) — **esta es la decisión de arquitectura
que queda abierta para Edwin/@AS**, no algo que este runbook cierre.

Referencia ejecutable: `infra/docker/auth-portable/docker-compose.yml` (nuevo, este PR) — es el mismo
stack de `docker-compose.test.yml` con las brechas 2-4 marcadas explícitamente como
`# TODO producción` en el propio archivo (persistencia, secretos, SMTP), **no** una solución a los 7
puntos de arriba. No se pudo levantar ni probar (Docker caído en esta máquina, igual que en el resto de
la sesión) — se declara así, sin maquillar el estado.

---

### 3.4 (A4) Vault, `service_role`/`authenticated`/`anon`, `extensions.crypt`

**Roles.** Verificado (Postgres 18.4 nativo): `CREATE ROLE anon NOLOGIN`, `CREATE ROLE authenticated
NOLOGIN`, `CREATE ROLE service_role NOLOGIN BYPASSRLS` aplican sin fricción — son primitivas de Postgres,
no de Supabase. El único rol **adicional** que el corpus crea (fuera de los 3 de Supabase) es
`bi_reader` (`48_bi_analytics_schema.sql`) — también un `CREATE ROLE` plano, cero dependencia de
plataforma. No hay más roles Supabase-específicos en el corpus (`service_role` es el único con
`BYPASSRLS`; no hay uso de roles reservados como `supabase_admin`/`supabase_auth_admin` en el código de
aplicación, solo en la infraestructura interna de GoTrue).

**Supabase Vault.** Confirmado con `pg_available_extensions` en Postgres 18.4 nativo: `supabase_vault`
no está disponible (0 filas). A diferencia de `pgcrypto`/`citext`/etc., Vault no es "una extensión que
falta instalar" — es una extensión que depende de `pgsodium` (bindings de libsodium) **y** de gestión de
claves a nivel de proyecto que Supabase resuelve en su control plane (la clave raíz de cifrado de
`pgsodium` no vive en una tabla portable). Aunque el código fuente de Vault/pgsodium es público,
replicar su modelo de gestión de claves fuera de Supabase es un proyecto en sí mismo, no una instalación
de paquete — por eso §5.3 del runbook ya documentaba que `161_portal_mfa_secret_encryption.sql` "aplica
OK" pero fallaría en runtime. **Sustituto recomendado (ya semi-implementado):** el propio archivo 161
documenta la estrategia doble capa — AES-256-GCM app-layer (`PortalAccount.mfaSecret`, ya activo, key en
`PORTAL_SECRET`/`AUTH_SECRET`) es el mecanismo actual y el fallback documentado en `CLAUDE.md` §"Patrones
de seguridad establecidos". Fuera de Supabase, promover ese fallback a **único** mecanismo (retirar la
rama Vault de `get_portal_mfa_secret`/`set_portal_mfa_secret_vault`, o dejarla como no-op que siempre
retorna vía la rama app-layer) cierra el gap sin trabajo nuevo — es una decisión de "dejar de intentar
usar Vault", no de construir un reemplazo.

**`extensions.crypt`/`extensions.gen_salt` (bcrypt).** Portable — es `pgcrypto`, contrib estándar,
probado en §3.1. El único uso productivo (`user-admin.router.ts` `resetPassword`) no depende del
algoritmo sino de la tabla `auth.users` que recibe el hash — ver §3.3.2. Una vez resuelto el proveedor de
auth (GoTrue self-hosted o reemplazo), este punto se resuelve solo (bcrypt vía pgcrypto contra la tabla
de usuarios que corresponda).

**Resumen A4:** de las 4 sub-dependencias de este punto, **3 son triviales y probadas** (roles,
`bi_reader`, `pgcrypto`/`crypt`). **Vault es la única con costo real** — pero el costo es cero si se
decide (como recomiendo) no perseguir un sustituto de Vault y en cambio consolidar en el mecanismo
app-layer que el proyecto ya usa como fallback desde el día uno.

---

## 4. Procedimiento de reconstrucción desde cero

**Dos fases, en este orden.** La fase 1 no es opcional — 01_rls_policies.sql (el primer archivo del
corpus) ya asume que existen tablas como `UserOrganizationRole`; el corpus SQL numerado es *hardening
sobre* el schema base, no un CREATE TABLE de todo desde cero.

### 4.1 Fase 1 — Prisma crea el subconjunto tabular

```bash
cd packages/database
DATABASE_URL="postgresql://<user>:<pass>@<host>:<port>/<db_vacia>" \
DIRECT_URL="postgresql://<user>:<pass>@<host>:<port>/<db_vacia>" \
  npx prisma db push --skip-generate
```

Precondición: los 3 roles de §3 deben existir **antes** de este paso (varias tablas tienen `GRANT`
implícitos o políticas que Prisma no toca, pero algunos triggers de fase 2 sí los requieren
presentes).

```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
```

Verificado (§5): en Postgres 16.14 local, `db push` limpio tarda **~3-5 segundos** y no produce
ningún error — el subconjunto que Prisma modela (250 tablas) es internamente consistente.

### 4.2 Fase 2 — corpus SQL numerado (RLS, triggers, motor ECE, hardening)

```bash
cd packages/database
DATABASE_URL="postgresql://<user>:<pass>@<host>:<port>/<db_vacia>" \
  node scripts/reconstruct-schema.mjs
```

Sin flags, para en el primer error (comportamiento correcto para una reconstrucción real — no seguir
escribiendo sobre un estado que ya se sabe roto). Opciones de diagnóstico:

- `--dry-run` — imprime el orden calculado sin conectarse a nada.
- `--continue-on-error` — sigue aplicando el resto y da un resumen completo al final (así se generó
  §5; **no usar en una reconstrucción real**, solo para inventariar fallos).
- `--only=archivo1.sql,archivo2.sql` — reproducir un fallo puntual sin correr todo el corpus.
- `--stop-after=N` — bisección manual.

**Con el estado actual del corpus (§5), esto NO termina en éxito sobre una base 100% ajena a
Supabase** — se detiene en el primer archivo Supabase-only o legado que encuentre en el orden canónico
(el primero es `24_security_hardening.sql`, por el schema `extensions` faltante). Para reproducir el
resultado completo de §5 hace falta `--continue-on-error` más los 3 roles de §3.1 — no hace falta un
stack Supabase local (`supabase start`); de hecho, probarlo así ocultaría exactamente los gaps que
importan para una migración real fuera de la plataforma (ver nota en §5.0).

---

## 5. Resultado real de la prueba de reconstrucción

### 5.0 Entorno de la prueba

Docker Desktop estaba instalado pero no respondió de forma utilizable dentro del tiempo de esta sesión
(`docker ps`/`docker compose up` colgaban repetidamente pese a que el binario respondía a `--version`).
En su lugar se usó un **Postgres 16.14 nativo ya corriendo localmente** (rol `postgres` superusuario,
sin bases de datos previas del proyecto) como la "Postgres local efímera" que pide el alcance de esta
tarea — es una variante aceptable de lo que ofrece `docker-compose.test.yml` (Postgres 15-alpine): más
nueva en versión menor, sin extensiones ni schemas de Supabase, exactamente la propiedad que importa
para esta prueba (aislar qué tan portable es el corpus). Se creó una base `his_baseline_test` nueva por
cada corrida, sin reusar estado. **Nunca se tocó el proyecto Supabase real** (guard del script +
verificación manual de la cadena de conexión en cada comando).

Esto es deliberadamente **más estricto** que la prueba previa conocida (ver `docs/performance/REQ-HIS-PERF-001-resultados.md`
§5, sesión de perf testing anterior, no relacionada con esta tarea): esa sesión usó `supabase start`
completo (Postgres 17.6.1 + GoTrue + Kong + Vault, 13 contenedores) y reportó **180/227 (79%)
aplicados limpio** tras resolver un conflicto de schema `ece` — un resultado mejor que el de aquí
porque ese entorno **sí** tenía `auth.*`/Vault/extensions disponibles. La prueba de este runbook usa
Postgres puro a propósito, porque el escenario que le importa a este documento es *"¿qué pasa si NO
hay Supabase"* — el escenario de esa sesión anterior (Supabase local) no responde esa pregunta.

### 5.1 Resultado

**Fase 1 (Prisma db push): OK, sin errores.**

**Fase 2 (227 archivos SQL, orden canónico `sort -V`, `--continue-on-error` para inventariar todo):**

| | Cantidad | % |
|---|---|---|
| Aplicados OK | 150 | 66% |
| Fallidos | 77 | 34% |

### 5.2 Los 77 fallos, categorizados

| Categoría | Archivos | Causa raíz | Acción recomendada |
|---|---|---|---|
| **A — Dependencia real de plataforma Supabase** | 6: `24`, `44`, `51`, `89`, `119`, `120` | Schema `extensions` (24), schema `auth` (119), extensión `pg_cron` no disponible (44, 51, 89, 120) | Ver sustitutos en §3. No es un bug del archivo — es exactamente el gap que este runbook documenta. |
| **B — Legado muerto, nunca reescrito** | 6: `25_inpatient_hardening.sql`, `26_pharmacy_hardening.sql`, `27_lis_hardening.sql`, `28_emergency_hardening.sql`, `30_surgery_hardening.sql`, `32_emar_hardening.sql` | Los 4 primeros referencian tablas en **snake_case** (`public.inpatient_vitals`, `public.drug`, `public.lab_test`, `public.emergency_visit`) que **nunca existieron** bajo la convención PascalCase de Prisma — fueron reemplazados por sus siblings `_v2` (que sí aplican OK). `30_surgery_hardening.sql` colisiona con un `ALTER TYPE ... ADD VALUE 'POST_OP'` que ya aplicaron `30a`/`30b` (el propio split documentado en `CLAUDE.md` implica que `30` es el predecesor que `30a`+`30b` reemplazaron, sin borrarlo). | **Candidatos a borrar del repo** (o mover a un directorio `sql/_legacy/` explícitamente excluido del runner) — no aportan nada y siempre van a fallar, en cualquier Postgres, Supabase incluido. Confirmar con quien tenga contexto histórico antes de borrar (podría haber una razón para conservarlos como referencia). |
| **C — Bug real, independiente del entorno** | 5: `46`, `95`, `114`, `129`, `138` | `138_workflow_task_action.sql` usa `///` como comentario (sintaxis TSDoc, inválida en SQL — solo `--` y `/* */` son comentarios válidos). `129_his_operating_cost.sql` crea `TYPE his_cost_category` sin comillas (Postgres lo guarda en minúscula) pero la columna del model Prisma `HisOperatingCost.category` espera el tipo `"HisCostCategory"` (Prisma cita todo — son dos tipos ENUM distintos, no el mismo con distinto casing). `46`, `95`, `114` son errores de sintaxis puntuales (identificador entre comillas mal cerrado / palabra reservada) — ver `scratch-run4.log` guardado en este PR para el mensaje exacto. | Bugs reales para @Dev/@DBA — no relacionados con portabilidad. Ninguno de estos 5 archivos puede haber aplicado limpio nunca, en ningún Postgres, tal como están commiteados hoy. |
| **D — Cascada por drift `schema.prisma` ↔ SQL evolutivo en `ece.*`** | ~59 | El root real es un puñado de columnas/funciones que el corpus SQL asume presentes en tablas `ece.*` que **sí están modeladas en Prisma** (81 models con `@@schema("ece")`) pero cuyo snapshot en `schema.prisma` quedó desactualizado: `organization_id` falta en `ece.institucion` (root de la cascada `56`→`65`), `his_user_id` en `ece.personal_salud`, `public_patient_id` en `ece.paciente`, `establecimiento_id` en varias tablas, y funciones helper faltantes (`ece.current_establecimiento_id()`, `ece.current_establecimiento_id_safe()`, `ece.set_ece_context()`, `ece._doc()`, `audit.fn_audit_log_insert()`). Cada una de estas ~7 raíces cascada a entre 2 y 15 archivos downstream que dependen de la columna/función. | **Este es el hallazgo central de la tarea.** El supuesto de que "`ece.*` es SQL-only, sin riesgo de drift con Prisma" (con el que arrancó el diagnóstico de §1) es **incorrecto** — `ece.*` está parcialmente en Prisma (81 de 98 tablas) y ese subconjunto sí puede — y de hecho ya — divergir. Cerrar esto requiere una pasada de reconciliación real entre `schema.prisma` y el estado vivo de `ece.*` en producción (introspección de prod, fuera del alcance permitido de esta tarea — ver §7). |
| **E — Tabla activa sin CREATE TABLE en ningún archivo del corpus** | `156`, `197`, `198` (los 3 referencian `public.chat_session`/`chat_message`) | **Confirmado**: ningún archivo de los 227 crea `chat_session` ni `chat_message`. La tabla se usa activamente (`packages/trpc/src/routers/chat-analytics.router.ts` hace `SELECT ... FROM public.chat_session` con SQL crudo) y `docs/runbooks/owasp-2025-deploy.md` la referencia como ya existente en prod. No hay `model` Prisma con ese nombre tampoco. | **Gap de origen de datos, no de orden.** Esta tabla se creó en producción por una vía que no está en el repo (¿migración manual vía SQL Editor sin guardar el archivo? ¿otra herramienta, ej. un SDK de chat con su propia migración?). Sin ese DDL, **no es posible reconstruir esta tabla desde cero** — es el ejemplo más concreto de por qué la premisa "227 archivos = estado completo de la BD" es falsa. Requiere que alguien con acceso a prod extraiga el DDL real (`\d+ chat_session` o `pg_dump --schema-only -t chat_session`) y lo agregue al corpus con su propio número. |

### 5.3 Hallazgo de falso positivo — Vault

`161_portal_mfa_secret_encryption.sql` (crea las funciones que llaman `vault.create_secret` /
`vault.decrypted_secrets`) **reportó OK** en la prueba, pese a que el schema `vault` no existe en este
Postgres. Razón: son cuerpos `plpgsql` — Postgres no valida que los objetos referenciados dentro de un
`CREATE FUNCTION ... LANGUAGE plpgsql` existan al momento de crear la función, solo al *ejecutarla*.
**Una reconstrucción "exitosa" en este sentido no garantiza que las funciones dependientes de Vault
funcionen** — hay que probarlas en runtime aparte (ver checklist de verificación, §6).

### 5.4 Log completo

El log crudo de la corrida (`--continue-on-error`, 227 líneas + resumen) se generó como
`scratch-run4.log` durante esta sesión (no incluido en el commit — es un artefacto de una corrida
puntual, no una fuente de verdad; regenerarlo con el comando de §4.2 da el mismo resultado porque el
runner es determinístico sobre un corpus sin cambios).

---

## 6. Verificación post-migración

Checklist mínimo antes de dar por buena una reconstrucción (real, no la prueba de diagnóstico):

- [ ] `SELECT count(*) FROM public._sql_baseline_applied` == número de archivos en `packages/database/sql/*.sql` que se esperaba aplicar.
- [ ] `SELECT relname FROM pg_class WHERE relrowsecurity AND relnamespace = 'public'::regnamespace` — comparar contra la lista esperada de tablas con RLS (`docs/12_rls_validation.md`).
- [ ] Cadena de hash de auditoría: insertar una fila de prueba en una tabla auditada, confirmar que `audit.audit_log` recibió un registro con `chain_hash = sha256(prev_hash || payload_hash)` correcto (el router `auditIntegrityRouter` ya tiene la lógica de verificación — correrla contra la BD nueva).
- [ ] Motor ECE: `SELECT count(*) FROM ece.tipo_documento` (esperado 31+), `SELECT count(*) FROM ece.flujo_transicion` (esperado 120+) — si están en 0, el seed de `63_ece_08_seed.sql` no corrió (ver §5.2 categoría D, es cascada).
- [ ] **Probar en runtime**, no solo confirmar que existen, las funciones `SECURITY DEFINER` que tocan Vault/auth (`get_portal_mfa_secret`, `set_portal_mfa_secret_vault`) — van a fallar si no se resolvió el gap de §3 (Vault fuera de Supabase).
- [ ] `withTenantContext` end-to-end: una query real con `SET LOCAL app.current_org_id` + `SET LOCAL ROLE authenticated`, confirmar que RLS filtra correctamente (test ya existe en la suite de integración — correrla contra la BD nueva, no solo contra Supabase).
- [ ] Validadores SV: correr `packages/contracts/src/validators/__tests__/` contra la nueva instancia si hay lógica espejada en SQL (`03_validations_sv.sql`) para confirmar paridad TS↔SQL.
- [ ] Extensiones esperadas presentes: `SELECT extname FROM pg_extension` — comparar contra `pgcrypto, citext, uuid-ossp, pg_trgm` como mínimo (más `pg_cron`/`pg_net` si se optó por proveerlos fuera de Supabase).

## 7. Rollback

Para la reconstrucción local/de prueba: no hay nada que revertir — es una base de datos efímera,
se destruye (`DROP DATABASE`).

Para un ejercicio de reconstrucción real contra un Postgres nuevo (ej. como parte de un DR real o de
una migración): **el rollback es no promover el Postgres nuevo** — el runner nunca toca la fuente
(Supabase sigue intacto mientras se reconstruye en destino). Si el runner falla a mitad de camino:

1. No hay necesidad de "deshacer" nada en la fuente — nunca se tocó.
2. En el destino, el estado parcial queda tal como lo dejó el archivo que falló — la tabla de control
   `_sql_baseline_applied` dice exactamente qué se aplicó y qué no. `DROP DATABASE` + volver a
   empezar es más simple que intentar reparar in-place, dado que la mayoría de los `CREATE TABLE`
   ya usan `IF NOT EXISTS` (idempotentes) pero no todos los `ALTER`/`CREATE POLICY` lo son.
3. Si el problema fue un archivo puntual (categoría B o C de §5.2), corregirlo, y usar
   `--only=<archivo>.sql` para reintentarlo sin repetir todo el corpus (los ya aplicados están
   marcados en la tabla de control, así que un rerun completo también saltaría los que ya pasaron —
   pero `--only` es más rápido para bisección).

**No existe hoy un procedimiento de rollback para producción** (revertir un archivo SQL numerado ya
aplicado contra Supabase) — cada archivo del corpus es forward-only, ninguno trae su `DOWN`/reversa.
Eso es una decisión preexistente del proyecto, no algo que este runbook introduce ni resuelve.

## 8. Recomendación para `.github/workflows/db-migrate.yml` (para consolidar con @SRE)

**No se tocó ese archivo** — está fuera de mi alcance en esta tarea (otro agente lo está llevando a
fail-fast en paralelo). Recomendación para cuando se consolide:

- El workflow hoy corre `prisma migrate deploy` contra una carpeta `prisma/migrations/` que **no
  existe** — eso confirma en CI lo que este runbook confirma manualmente: no hay ruta de migración
  automatizada real hoy.
- **No** cambiarlo para que corra `prisma migrate deploy` de verdad — la estrategia elegida en §2 no
  usa Prisma migrate como ejecutor.
- Si se quiere un job de CI que *sí* verifique reconstructibilidad de forma continua (recomendado,
  no implementado en esta tarea): un job que levante el mismo `docker-compose.test.yml` que ya usa
  el E2E, corra `prisma db push` + `node packages/database/scripts/reconstruct-schema.mjs` con
  `--continue-on-error`, y falle si el conteo de fallos crece respecto al baseline de este documento
  (150/227) — así una regresión nueva (alguien rompe un archivo aplicable) se detecta en el PR, sin
  bloquear con el 34% de fallos ya conocidos y categorizados en §5.2 hasta que se cierren
  deliberadamente uno por uno.
- Complementar con un `pg_dump --schema-only` versionado (§2.2) generado por ese mismo job, como
  artefacto de CI descargable — da un snapshot de referencia real sin comprometerse a que sea la
  fuente de verdad.

## 9. Gaps abiertos — qué requiere autorización del usuario

Ninguno de estos se cerró en esta tarea porque cerrarlos requiere, como mínimo, uno de: escribir en
producción, tomar una decisión de arquitectura que compromete meses de trabajo futuro, o acceso a
información que no está en el repo.

1. **`auth.*`/GoTrue no tiene sustituto implementado** (§3) — el gap más grande. Decidir un proveedor
   de auth alternativo es una decisión de @AS/@AT, con impacto directo en `withTenantContext` y en
   cada router que hoy asume sesión Supabase. Requiere sprint dedicado, no un fix de esta tarea.
2. **Drift `ece.*` real y sin cuantificar al 100%** (§5.2 categoría D) — para cerrarlo de verdad hace
   falta introspectar el `ece.*` de producción (`prisma db pull` contra Supabase, o
   `mcp__supabase__list_tables` schema por schema) y reconciliar contra `schema.prisma` columna por
   columna. Esto es lectura, no escritura — pero está fuera del alcance que se me dio para esta tarea
   (enfoque en construir sin tocar prod). Es el siguiente paso lógico y **requiere autorización
   explícita** solo si se decide corregir `schema.prisma` en base a lo encontrado (eso sí es una
   escritura al repo, no a prod — bajo riesgo, pero cambia el contrato que usa @Dev a diario).
3. **`public.chat_session`/`chat_message` sin DDL de origen** (§5.2 categoría E) — cerrarlo requiere
   que alguien con acceso de lectura a prod extraiga el DDL real y lo agregue al corpus. Puramente
   lectura (`pg_dump --schema-only -t chat_session -t chat_message`), bajo riesgo, pero toca prod
   aunque sea solo para leer — pedir autorización explícita antes de correrlo, por disciplina, aunque
   la restricción de esta tarea ya permitía lectura.
4. **6 archivos legado candidatos a borrar** (§5.2 categoría B) — borrar código del repo es reversible
   vía git, pero quiero confirmación de que no hay una razón histórica para conservarlos (ej. como
   referencia de una migración de datos que ya corrió una vez en prod y nunca se va a repetir).
5. **`pg_cron` → scheduler externo** (§3) — decisión de bajo riesgo técnico pero cambia el modelo
   operativo de 6 jobs recurrentes; no la tomé unilateralmente porque afecta a @SRE/@BID directamente
   (dueños de esos jobs).

---

## Apéndice — archivos de este PR

- `packages/database/scripts/reconstruct-schema.mjs` — runner de reconstrucción (nuevo).
- `docs/runbooks/db-reconstruccion-fuera-de-supabase.md` — este documento.
- Pointer agregado en `docs/04_modelo_datos.md` (no se duplica contenido).
