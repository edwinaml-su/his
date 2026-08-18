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

| Objeto | ¿Lo requiere Postgres estándar? | ¿Qué hace falta fuera de Supabase? |
|---|---|---|
| Roles `authenticated`, `anon`, `service_role` | No — son solo roles de Postgres (`CREATE ROLE ... NOLOGIN`, `service_role` con `BYPASSRLS`) | Crearlos a mano una vez por cluster. 73/30/9 archivos del corpus referencian `authenticated`/`service_role`/`anon` respectivamente — sin los 3 roles, la fase RLS del corpus falla desde el primer archivo. |
| Extensiones `pgcrypto`, `citext`, `uuid-ossp`, `pg_trgm` | Sí, son contrib estándar de Postgres | Nada especial — `CREATE EXTENSION IF NOT EXISTS` funciona igual en RDS/Cloud SQL/on-prem. |
| Schema `extensions` | **No** — es una convención de organización de Supabase (mueve extensiones fuera de `public` por higiene) | `24_security_hardening.sql` asume que el schema `extensions` ya existe (lo provee la plataforma Supabase). Fuera de Supabase: `CREATE SCHEMA IF NOT EXISTS extensions;` antes de aplicar ese archivo, o editar el archivo para no mover las extensiones. |
| Schema/funciones `auth.*` (`auth.uid()`, `auth.jwt()`, `auth.users`, `auth.identities`) | **No** — es el schema que gestiona GoTrue (el servicio de Auth de Supabase) | **No hay sustituto directo out-of-the-box.** 9 archivos referencian `auth.*` directamente. El diseño del proyecto ya mitiga la mayor parte de esto — `withTenantContext` (`packages/trpc/src/rls-context.ts`) hace `SET LOCAL app.current_user_id/org_id` y las políticas RLS (`01_rls_policies.sql`) leen primero `current_setting('request.jwt.claim.*')` con fallback — pero los **9 archivos que llaman `auth.*` directamente** (ej. `119_fall_event.sql`, `24_security_hardening.sql`) necesitan reescritura para no depender de GoTrue. Fuera de Supabase hace falta un proveedor de auth propio (ej. NextAuth/Auth.js contra la misma tabla `User`) que resuelva `org_id`/`user_id` en los mismos GUCs que ya usa `withTenantContext` — el patrón de sesión ya es portable, lo que no es portable es la fuente (GoTrue). |
| Supabase Vault (`vault.create_secret`, `vault.decrypted_secrets`, `vault.secrets`) | **No** — extensión propietaria de Supabase | `161_portal_mfa_secret_encryption.sql` y `196_owasp2025_a02_secdef_hardening.sql` la usan para el TOTP secret de portal (`PortalAccount`). **Hallazgo importante (§5.3): estos archivos "aplican OK" en una reconstrucción fuera de Supabase** porque las llamadas a `vault.*` viven dentro de cuerpos `plpgsql` que Postgres no valida en `CREATE FUNCTION` — el error solo aparece en **runtime**, al ejecutar la función. Sustituto fuera de Supabase: cifrado a nivel de aplicación (AES) — el propio router ya tiene un *fallback* app-layer para cuentas pre-Vault (`CLAUDE.md` § patrones de seguridad), habría que promoverlo a mecanismo único. |
| `extensions.crypt` / `extensions.gen_salt` (bcrypt vía pgcrypto) | Sí, si se crea `pgcrypto` en un schema propio — el algoritmo es estándar | El único uso productivo detectado es en `packages/trpc/src/routers/user-admin.router.ts:471` (`resetPassword`, escribe a `auth.users.encrypted_password`) — que de por sí **depende de la tabla `auth.users` de GoTrue**, no solo de `pgcrypto`. Fuera de Supabase, ese flujo de reset debe reescribirse contra la tabla de usuarios del proveedor de auth que se elija. |
| `pg_cron` | **No en RDS/Cloud SQL estándar** (RDS lo soporta desde Postgres 12+ con flag habilitado; Cloud SQL no lo soporta; on-prem requiere compilar la extensión) | 6 archivos lo requieren (`44`, `51`, `89`, `120`, y el poller de notificaciones). Sustituto portable: mover esos jobs a un scheduler externo (cron de K8s / GitHub Actions schedule / Vercel Cron) que llame un endpoint interno — patrón que el proyecto **ya usa en otros lados** (`db-migrate.yml` es `workflow_dispatch`; hay precedente de jobs por HTTP). |
| Schema `analytics` / `accounting` | No son de Supabase — son schemas propios del proyecto (BI, finance) | Ninguno — se crean igual en cualquier Postgres. Aparecen como fallo en la prueba de §5 solo porque son consecuencia en cascada de otro archivo que falló antes en la misma corrida (ver §5.2), no por dependencia de plataforma. |

**Resumen de honestidad:** de las 6 categorías realmente Supabase-only (roles, schema `extensions`,
`auth.*`, Vault, `pg_cron`, y el flujo de reset de password que depende de `auth.users`), **4 tienen
sustituto documentado y portable** (roles, schema `extensions`, `pg_cron`→scheduler externo, Vault→AES
app-layer ya semi-existente). **`auth.*`/GoTrue no tiene sustituto implementado hoy** — es el gap real
más grande de todos, y requeriría escoger e implementar un proveedor de auth alternativo antes de que
una migración fuera de Supabase sea viable. Eso es trabajo de arquitectura (@AS/@AT), no algo que este
runbook pueda resolver con SQL.

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
