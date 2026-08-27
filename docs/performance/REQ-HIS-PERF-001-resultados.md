# REQ-HIS-PERF-001 — Resultados de performance y resiliencia

**Fecha:** 2026-08-18 · **Ejecutor:** @SRE · **Rama:** `fix/health-check-rls` (Next 16.3.1 / React 19.2.8)
**Techo de carga fijado por Edwin:** 1500 VUs — **alcanzado en el escenario C**

> **Nota de integridad de este documento:** a mitad de esta sesión, este archivo apareció sobrescrito
> por una versión que afirmaba que los escenarios E y F "abortan en `setup()`" por un bloqueo de CSP.
> Esa afirmación es **falsa** — verificado de forma directa y repetida mientras las corridas estaban
> en curso: F completó sus 3 minutos con el 100% de sus checks en verde, y E corrió su rampa completa
> de 80 VUs sin abortar. La CSP de la app (que sí existe y sí restringe `connect-src` en el navegador)
> no aplica a k6 — k6 no es un navegador, no ejecuta CSP. Este documento refleja los números reales
> medidos en cada corrida, con las fuentes verificadas en el momento en que cada una terminó.

---

## 0. Corrección sobre la versión de Postgres

El REQ original (y `CLAUDE.md`) asumían **Postgres 15** en producción. Verificado en vivo contra el
proyecto Supabase real (`ejacvsgbewcerxtjtwto`, us-west-2) vía MCP de Supabase: producción corre
**Postgres 17.6.1**. `CLAUDE.md` está desactualizado en ese punto. El entorno local (`supabase start`)
también levantó Postgres 17.6.1 por defecto — coincide con producción, no hubo que rehacer nada.

## 1. Veredicto ejecutivo

**El sistema no cumple los SLO de latencia bajo carga concurrente alta, pero no colapsa: degrada, y los controles de resiliencia (rate limit, guards de batch/payload) funcionan como se diseñaron.**

| # | Escenario | Carga | Estado | Veredicto para producción |
|---|---|---|---|---|
| A | Latencia baseline | 15 VUs | ✅ Ejecutado | ✅ **ACEPTABLE** |
| B | Concurrencia | 400 VUs | ✅ Ejecutado | ❌ **NO ACEPTABLE** (latencia) |
| C | Estrés | **1500 VUs** | ✅ Ejecutado | ❌ **NO ACEPTABLE** (latencia) |
| D | Spike | 500 VUs | ✅ Ejecutado | ⚠️ **ACEPTABLE CON RESERVA** |
| E | Soak / endurance | 80 VUs, 27 min | ✅ Ejecutado | ⚠️ **MIXTO** (latencia OK, error rate no — ver §6.6) |
| F | Resiliencia / DoS | 10 VUs, 3 min | ✅ Ejecutado | ✅ **ACEPTABLE** |

**El hallazgo que más importa:** el desglose por código de estado (agregado a `lib/trpc.js` a mitad de
sesión) demuestra que la mayoría del "error rate" que reporta k6 **no son fallos del sistema**. En el
escenario D (spike), de 62,478 requests HTTP: **5xx = 0.07%** (44 llamadas), muy por debajo del umbral
de 1%. El resto son **429 del rate limit funcionando correctamente (6.9%)**, fallas de sesión bajo
concurrencia (1.4%), y una categoría de 4xx sin diagnosticar (10.7%, ver §6.4). **El sistema descarta
carga deliberadamente en vez de romperse.**

Lo que sí falla es la **latencia bajo concurrencia**: a 400 VUs el p95 ya está 3.6× sobre el SLO; a 1500
VUs el p99 llega a 12.7s con picos de 36s. La causa dominante identificada (§6.2) es la **revalidación
de sesión contra el servidor de Auth en cada request tRPC, sin cache** — no saturación de CPU/BD per se.

**Limitación metodológica que infla el error rate reportado en B/C/D/E (detalle en §6.6):** todos los
VUs de esta suite autentican como el mismo usuario de prueba (`qa.physician@his.test`) — no se
sembraron credenciales adicionales por el alcance de tiempo de esta sesión. El rate limit autenticado
es **por usuario** (`AUTHED_MAX=600/min`), así que decenas/cientos de VUs concurrentes bajo una sola
identidad lo cruzan de forma agregada, generando una fracción real del error rate reportado que **no
representa cómo se comportaría el sistema con igual número de clínicos reales, cada uno con su propia
sesión.** No se pudo cuantificar exactamente qué fracción de cada escenario es este artefacto vs.
degradación real — es una recomendación de seguimiento (§8), no algo que invalide los hallazgos de
latencia ni el hallazgo de los deadlocks/auth-cache, que son independientes de este efecto.

## 2. Entorno de ejecución

| Componente | Valor |
|---|---|
| CPU | Intel Core Ultra 9 285H — 16 núcleos/hilos |
| RAM | 32 GB físicos |
| Docker Desktop (WSL2) | 16 CPUs / 15.35 GiB asignados |
| SO | Windows 11 Pro 10.0.26200 |
| App | Build de **producción** (`next build --webpack` + `next start`), Next.js 16.3.1, puerto 3100 (3000 ocupado por un contenedor ajeno al proyecto) |
| Base de datos | Supabase **local** vía `npx supabase start` (Postgres 17.6.1, GoTrue, Kong, Studio, 13 contenedores) |
| Datos | 100% sintéticos — pacientes generados con DUI de dígito verificador válido, sin PII/PHI real (Decreto 143/144) |
| k6 | v2.2.0, vía `docker run grafana/k6`, `--network` vía `host.docker.internal` |
| **Producción** | **NO tocada** — verificado vía MCP de Supabase directo contra el proyecto real: 0 filas nuevas en `Patient`, `Encounter`, `RateLimitHit` en las últimas 3 horas |

**Contención de recursos — esto NO es una máquina de referencia limpia:** corrieron en paralelo, sin
aislar, 5 contenedores Docker de otros proyectos del usuario (`avante-asistencia-db`, `invit_db`,
`appflota-app`, `appflota-db`, `nexus-mantto-db`) durante toda la sesión, además del stack Supabase
local completo (13 contenedores) y la app Next.js como proceso nativo — todo compitiendo por los mismos
16 núcleos.

**Qué transfiere a producción y qué no:**
- **SÍ transfiere:** el comportamiento de los controles defensivos (rate limit → 429 no 5xx, guards de
  batch/payload), la proporción real de 5xx bajo saturación, el patrón de degradación (encolamiento
  controlado vs. cascada), y las propiedades arquitectónicas expuestas (revalidación de sesión sin
  cache, deadlocks del audit hash chain bajo escritura concurrente).
- **NO transfiere:** los valores absolutos de latencia/throughput. Producción corre en funciones
  serverless de Vercel (escala horizontal) con Supabase hosted (pooler dedicado, PgBouncer) — ninguno
  de los dos existe en este setup de un solo proceso Node + un solo contenedor Postgres compartiendo
  hardware con cargas ajenas al proyecto.

## 3. Incidentes de infraestructura durante la sesión

Docker Desktop falló **dos veces** durante esta sesión (una vez antes de empezar, ~25 min sin responder;
una vez a mitad de la corrida, tumbando el stack Supabase local justo al lanzar el escenario D). Ambas
veces se recuperó (`wsl --shutdown` + relanzamiento la primera vez; recuperación espontánea la segunda,
confirmada por polling). El proceso Node de la app (`next start`) sobrevivió a la segunda caída sin
reiniciarse — solo perdió conectividad a la BD durante la ventana de caída del contenedor Postgres,
recuperándose sola cuando el contenedor volvió (Prisma reconecta automáticamente).

## 4. Qué se construyó (entregables 1-4 del §10 del REQ)

- **Suite k6 A-F** en `infra/k6/{lib,config,scenarios,reports}/` — reutiliza `infra/k6/lib/{auth,checks}.js`
  de la suite 01-06 preexistente; agrega `lib/guard.js`, `lib/data.js`, `lib/trpc.js`, `lib/flows.js`,
  `lib/setup.js`, `config/slos.js`, `config/stages.js`.
- **SLOs centralizados** en `infra/k6/config/slos.js` — p95<400/p99<800 lecturas, p95<700 escrituras,
  error<1%, con tags `{op:read|write, phase:load}` (ver §5.1 sobre por qué `phase` importa).
- **Guard anti-producción** (`infra/k6/lib/guard.js`) — aborta si `BASE_URL` no es localhost. Los 6
  escenarios lo invocan explícitamente.
- **Generador de datos sintéticos** (`infra/k6/lib/data.js`) — DUI con dígito verificador válido (mismo
  algoritmo que `packages/contracts/src/validators`), nombres/fechas fabricados, notas marcadas
  `[SINTETICO k6]`. Cero PII/PHI real.
- **Conteo por código de estado** (`infra/k6/lib/trpc.js`) — agregado durante la sesión para distinguir
  429 (control funcionando) de 5xx (falla real); ver desglose en §6.4.
- **Exportación JSON + HTML** — `--summary-export` + `infra/k6/reports/summarize.mjs`.
- **Fix del riesgo latente en `perf-k6.yml`** — el input `base_url` de la suite 01-06 ya no tiene
  default de producción; ahora es `required` sin valor pre-cargado, con validación explícita.

## 5. Entorno local — cómo se levantó y qué se aplicó parcial

1. **Docker Desktop + `npx supabase start`** — Postgres 17.6.1 + GoTrue + Kong + Studio, 13 contenedores.
2. **Schema:** `prisma db push` (OK) + corpus SQL (`packages/database/sql/*.sql`, 227 archivos):
   **180/227 (79%) aplicados limpios**; 47 fallaron por *schema drift* real entre `schema.prisma` y el
   corpus SQL (ejemplo: `ece.paciente`/`ece.institucion` tenían modelos viejos en `schema.prisma` que
   colisionaban con las `CREATE TABLE IF NOT EXISTS` posteriores — se resolvió dropeando el schema
   `ece` completo y reaplicando desde cero, subiendo el éxito de 24/227 a 180/227).
3. **Grants faltantes:** el rol `authenticated` no tenía SELECT/INSERT/UPDATE/DELETE en tablas nuevas
   de `public`/`ece` tras `prisma db push` (Supabase hosted lo resuelve con `ALTER DEFAULT PRIVILEGES`
   de plataforma que `supabase start` no replica sobre tablas creadas por Prisma) — se aplicó un GRANT
   manual, local-only, **no incluido en el corpus del repo** (hallazgo para `@DBA`).
4. **Seed:** catálogos base + 4/5 usuarios de prueba (`qa.director` no se creó — el rol "Director" no
   existe en el seed base).
5. **Datos ECE de episodio hospitalario NO se sembraron** (el motor de workflow completo —
   `flujo_transicion` quedó en 0 filas) — los flujos 2/3/5 (Evolución, Signos Vitales, Indicaciones) se
   omitieron con warning en cada corrida, tal como diseña `lib/flows.js`. Solo se midieron los flujos
   1 (Admisión), 4 (Historia Clínica, parcial) y 6 (Dashboard).

### 5.1 Validación en vivo de la suite — 3 bugs reales encontrados y corregidos antes de confiar en cualquier número

1. **`URL` no está disponible como global en k6 v2.2.0** — reemplazado por un parser de hostname con regex en `lib/guard.js` y `lib/auth.js`.
2. **El envelope de un query sin filtros debe ser `{}`, no `null`** — corregido en `f-resiliencia-dos.js`.
3. **El `ref` de la cookie `sb-<ref>-auth-token` debe derivarse del host que usó LA APP para
   `NEXT_PUBLIC_SUPABASE_URL` al buildear, no del host que usa k6 para llegar a Supabase** — con k6 en
   Docker (`host.docker.internal`) contra una app buildeada con `127.0.0.1`, ambos refs difieren y la
   cookie queda mal nombrada (falla silenciosa). Se agregó `SUPABASE_AUTH_REF` como override explícito
   (`=127` en todas las corridas de esta sesión).

Con las 3 correcciones, `organization.listMine` autenticado devolvió 200 con los datos reales del
tenant — la cadena completa (login → cookie `@supabase/ssr` → RLS demote a `authenticated` → tenant
context) quedó verificada extremo a extremo, y se sostuvo en las 6 corridas de esta sesión.

**Hallazgo adicional (de la app, no de la suite):** las llamadas de `setup()` (login, catálogos, 1 vez
por corrida) comparten las métricas globales `http_req_*` de k6 con el tráfico medido por VU — un error
tolerado de `setup()` contaminaba el error rate de toda la corrida. Se etiquetó todo el tráfico con
`phase:'load'` vs `phase:'setup'` y se filtraron los thresholds.

### 5.2 Bug real en la exportación de thresholds de k6 (verificado, corregido)

k6 v2.2.0 exportó en el JSON de `--summary-export` `"p(95)<400": true` para una métrica de B cuyo p95
real era 1444.6ms (falla por 3.6×) — confirmado también en `checks` y `http_req_failed`. La terminal, en
el mismo run, mostró el `✗` correcto en tiempo real — **es la fuente que se usó para todos los veredictos
de este documento, nunca el booleano del JSON.** `infra/k6/reports/summarize.mjs` tenía además un bug
propio (leía `.ok` de un booleano plano, mostrando "FAIL" siempre). Ambos quedaron corregidos:
`summarize.mjs` ahora reevalúa cada threshold contra el valor medido real, sin confiar en el campo que
exporta k6.

## 6. Detalle por escenario

### 6.1 A — Latencia (baseline) · 15 VUs, 6 min

2,314 iteraciones, 1,881 requests HTTP.

| Métrica | Medido | Umbral §7 | Veredicto |
|---|---|---|---|
| Lecturas p95 | 228.8 ms | < 400 ms | ✅ |
| Lecturas p99 | 243.4 ms | < 800 ms | ✅ |
| Escrituras p95 | 237.4 ms | < 700 ms | ✅ |
| Error rate (fase medida) | 0.10% (2/1877) | < 1% | ✅ |
| checks | 99.89% | > 99% | ✅ |

Throughput sostenido: 5.21 req/s. Las 2 fallas correlacionan con el hallazgo de deadlock del §6.2 —
ya presente a baja concurrencia, solo que infrecuente.

**Veredicto: PASS en los 4 thresholds. ACEPTABLE como línea base.**

### 6.2 B — Concurrencia / Carga · ramp 50→400 VUs, 22 min

137,139 iteraciones, 197,988 requests HTTP.

| Métrica | Medido | Umbral §7 | Veredicto |
|---|---|---|---|
| Lecturas p95 | **1.44s** | < 400 ms | ❌ 3.6× |
| Lecturas p99 | **2.44s** | < 800 ms | ❌ 3.1× |
| Escrituras p95 | **1.41s** | < 700 ms | ❌ 2× |
| Error rate | **18.54%** | < 1% | ❌ |
| checks | **6.49%** | > 99% | ❌ |

**Correlación con logs del servidor — dónde se degrada:**

| Tipo de error tRPC | Ocurrencias | Causa raíz |
|---|---|---|
| `UNAUTHORIZED` ("Sesión requerida") | 1,201 | `supabase.auth.getUser()` intermitentemente no valida la sesión bajo carga — pega a GoTrue en CADA request tRPC, sin cache |
| `FORBIDDEN` ("Selecciona una organización") | 2,679 | Cascada del anterior — sin `user`, `getTenantContext()` también falla |
| `INTERNAL_SERVER_ERROR` en `patient.create` | 128 | `deadlock detected` en Postgres — 532 deadlocks totales en el log, contra `AuditLog` |

**El 82% de los errores con código identificado son de autenticación/autorización, no de lógica de
negocio ni saturación de BD directa.**

**Qué SÍ transfiere:** la cascada (validación de sesión sin cache) es una propiedad arquitectónica real.
La tasa de deadlocks en `AuditLog` escaló con la concurrencia (2 en A → 532 en B) — el trigger de la
cadena de hash de auditoría (TDR §6.3) es un punto de serialización real bajo escritura concurrente.

**Qué NO transfiere:** los valores absolutos de p95/p99 están inflados por la contención de recursos
descrita en §2 — no hay pooler dedicado ni escalado horizontal en este setup.

**Veredicto: FAIL en los 4 thresholds. NO ACEPTABLE tal cual medido — con el matiz de que la causa
dominante es corregible (cache de sesión), no necesariamente un techo físico de capacidad.**

### 6.3 C — Estrés · rampa hasta 1500 VUs (el techo fijado por Edwin), 14 min

186,508 iteraciones, 286,164 requests HTTP, pico de throughput **340.2 req/s**.

| Métrica | Medido | Umbral §7 | Veredicto |
|---|---|---|---|
| Lecturas p95 | **6.06s** | < 400 ms | ❌ 15× |
| Lecturas p99 | **12.68s** | < 800 ms | ❌ 16× |
| Escrituras p95 | **6.99s** | < 700 ms | ❌ 10× |
| Error rate | **17.54%** | < 1% | ❌ |
| checks | **0.82%** | > 99% | ❌ |

**Knee point:** no hay un quiebre nítido dentro de la propia rampa de C — el sistema ya estaba
severamente degradado desde la primera meseta (200 VUs), consistente con B. La evidencia combinada de
A/B/C ubica el punto de quiebre real **entre 15 VUs (A, sano) y 200-400 VUs (B/C, ya degradado)** — no
se pudo acotar más fino sin una corrida específica en ese rango intermedio, fuera del alcance de tiempo
de esta sesión.

**Primer componente en fallar:** el mismo patrón de B, amplificado — deadlocks en `AuditLog` subieron a
**725 acumulados**; `supabase_auth_HIS` (GoTrue) se observó en 460% CPU durante el ramp-up temprano,
corroborando que la validación de sesión es el cuello de botella dominante, no Postgres en sí mismo.

**Recuperación:** la rampa de bajada (1500→0 VUs en 2 min) se completó sin que el proceso Node se
cayera ni requiriera reinicio — el health-check volvió a "ok" inmediatamente. Recuperación limpia a
nivel de proceso, aunque la degradación durante la corrida no fue controlada.

**Veredicto: FAIL en los 4 thresholds. NO ACEPTABLE tal cual medido — mismo hallazgo dominante que B. El
sistema se recuperó sin caerse del todo, señal positiva real.**

### 6.4 D — Spike · 20→500 VUs en <30s, 6m40

42,274 iteraciones, 62,478 requests HTTP.

| Métrica | Medido | Umbral §7 | Veredicto |
|---|---|---|---|
| Lecturas p95 | **4.16s** | < 400 ms | ❌ |
| Lecturas p99 | **6.01s** | < 800 ms | ❌ |
| Escrituras p95 | **4.15s** | < 700 ms | ❌ |
| Error rate | **19.07%** | < 1% | ❌ |
| checks | **5.85%** | > 99% | ❌ |

**Desglose por código de estado HTTP** (instrumentación real, no inferida — 62,478 requests):

| Código | Cantidad | % | Interpretación |
|---|---|---|---|
| 2xx | 22,956 | 36.7% | Éxito |
| 401 | 333 | 0.5% | Confirmado 1:1 contra el log del servidor |
| 403 | 544 | 0.9% | Confirmado 1:1 contra el log del servidor |
| **429** | **4,311** | **6.9%** | **Rate limit funcionando como debe** (OWASP A06:2025) |
| 4xx otros | 6,688 | 10.7% | No identificado con certeza — no correlaciona con ningún código tRPC logueado (`BAD_REQUEST` solo tuvo 2 ocurrencias en toda la sesión). Sin causa confirmada, no se afirma una sin evidencia. |
| **5xx** | **44** | **0.07%** | Errores de servidor reales — muy por debajo del 1% de umbral |

**La mayoría del "error rate" agregado NO es el sistema rompiéndose con 5xx.** Los 5xx reales son 0.07%
del tráfico. El `checks`/`http_req_failed` de k6 (que cuenta cualquier no-2xx como falla) sobre-representa
la severidad real frente al desglose por código.

**Veredicto: FAIL contra los 4 thresholds del §7 (que no distinguen por código de estado). Clasificación
matizada: NO ACEPTABLE tal cual medido por el SLO estricto, pero el desglose real es menos alarmante que
el error-rate agregado. Recomendación: el §7 debería excluir 429 del cómputo de "error rate" — es un
control funcionando, no una falla.**

### 6.5 F — Resiliencia / Defensa DoS (validación de controles) · 10 VUs, 3 min

560 iteraciones, 91,259 checks, 46,567 requests HTTP.

| Control validado | Resultado medido | Veredicto |
|---|---|---|
| Rate limit anónimo (60/min/IP, Postgres `RateLimitHit`) | 44,695 respuestas 429 sobre 44,880 requests de la ráfaga (~99.6%) | ✅ Funciona como documenta `packages/trpc/src/middleware/rate-limit.ts` |
| 429 trae `Retry-After` | 100% de los 429 observados lo incluyeron | ✅ |
| Sin cascada 5xx durante la ráfaga | **0** 5xx en 46,567 requests HTTP totales | ✅ Degradación controlada, no caída total |
| Tope de batch tRPC (`TRPC_MAX_BATCH_SIZE=20`) | 561/561 intentos de batch de 21 procedures → 413 | ✅ Funciona como documenta `apps/web/src/lib/trpc/batch-limit.ts` |
| Payload de 2MB rechazado | 561/561 rechazados con 4xx (nunca 5xx, nunca timeout) | ✅ |
| Lectura autenticada normal sigue respondiendo durante la ráfaga | 100% devolvieron 200 o 429 (nunca colgadas/5xx) | ✅ Un atacante anónimo no bloquea usuarios legítimos |
| "Slow clients" / conexión lenta byte-a-byte | **NO EJECUTADO** — k6 no tiene control fino de framing TCP; requeriría slowhttptest o similar | ⚠️ Fuera del alcance de k6 |
| Backpressure/circuit breaker explícito hacia Postgres | No hay un control dedicado documentado — el proxy más cercano son los deadlocks de `AuditLog` bajo escritura concurrente (§6.2/6.3) | ⚠️ Sin control explícito que validar |

**Veredicto: PASS en el threshold formal (`rl_anon_5xx_count==0`) y en el 100% de los checks.
Clasificación: ACEPTABLE — los controles que sí se pudieron probar funcionan exactamente como documenta
el código, con degradación controlada y sin cascada.**

### 6.6 E — Soak / Endurance · 80 VUs, 27 min

56,885 iteraciones, 65,797 requests HTTP.

| Métrica | Medido | Umbral §7 | Veredicto |
|---|---|---|---|
| Lecturas p95 | 351.3 ms | < 400 ms | ✅ |
| Lecturas p99 | 503.4 ms | < 800 ms | ✅ |
| Escrituras p95 | 367.7 ms | < 700 ms | ✅ |
| Error rate | **23.64%** | < 1% | ❌ |
| checks | **32.06%** | > 99% | ❌ |

**Dato notable: a 80 VUs sostenidos la LATENCIA cumple el SLO** (los 3 thresholds de `http_req_duration`
pasan) — consistente con que el punto de quiebre de latencia está entre 80-200 VUs, no antes. Lo que
falla es exclusivamente el error rate.

**Desglose por código de estado (65,797 requests):**

| Código | Cantidad | % |
|---|---|---|
| 2xx | 30,108 | 45.8% |
| 401 | 1,372 | 2.1% |
| 403 | 1,125 | 1.7% |
| **429** | **8,257** | **12.6%** |
| 4xx otros | 4,665 | 7.1% |
| 5xx | 139 | 0.21% |

**Hallazgo metodológico importante (afecta la interpretación de B/C/D también, no solo E):** los 80 VUs
de este escenario autentican TODOS como el mismo usuario de prueba (`qa.physician@his.test`) — es una
limitación de la suite, no del REQ. El límite de rate limit autenticado (`AUTHED_MAX=600/min`, en
`packages/trpc/src/middleware/rate-limit.ts`) es **por usuario**, no por sesión/conexión — así que 80
VUs concurrentes compartiendo una sola identidad exceden ese límite de forma agregada, generando una
fracción real de los 429 observados (12.6% aquí) que **no representaría el comportamiento de 80
clínicos reales con 80 cuentas distintas**. Esto es un artefacto de la suite (todas las corridas
B/C/D/E comparten esta limitación — no se generaron credenciales de prueba adicionales por el alcance
de tiempo de esta sesión), no evidencia de que el sistema real limitaría a 80 usuarios reales de esta
forma. **Recomendación para la próxima corrida:** sembrar N usuarios de prueba adicionales y repartir
los VUs entre ellos para aislar el rate limit por-usuario de la capacidad real del sistema.

**Fugas de memoria / agotamiento de pool — lo que SÍ se pudo observar:**

| Checkpoint | Memoria proceso Node (`next start`) | Conexiones Postgres activas |
|---|---|---|
| Inicio (t=0) | 205 MB | — |
| t≈3 min | 626 MB | 68 |
| t≈17.5 min | 661 MB | 69 |
| t≈27 min (fin, post-ramp-down) | 183 MB | 68 |

El salto inicial (205→626MB) es esperable — es el working set normal calentándose bajo carga, no una
fuga. **Entre los checkpoints de 3 min y 17.5 min la memoria se mantuvo estable (626→661MB, +5.6%) y
las conexiones a Postgres no crecieron (68→69)** — no hay evidencia de una fuga de memoria progresiva
ni de agotamiento del pool de conexiones en esta ventana de 27 minutos. Esto es una observación
limitada (2 checkpoints intermedios, no un muestreo continuo) — no se afirma que 27 minutos sea
suficiente para descartar una fuga de largo plazo (horas/días), solo que no se observó una en esta
ventana.

**Otro hallazgo real:** se registraron **96 timeouts de I/O** (`dial: i/o timeout` al conectar desde el
contenedor de k6 hacia la app) distribuidos a lo largo de la corrida — consistentes con saturación
intermitente de la cola de conexiones del proceso Node bajo 80 VUs sostenidos compitiendo con el resto
de contenedores de la máquina (§2).

**Veredicto: los 3 thresholds de latencia PASAN; `checks` y `http_req_failed` FALLAN. Clasificación:
MIXTA — la latencia bajo carga sostenida moderada es ACEPTABLE, pero el error rate agregado (23.64%) no
lo es, aunque una porción no cuantificada con precisión de ese error rate es artefacto metodológico
(rate limit por-usuario compartido, ver arriba) y no necesariamente capacidad real. No se observó fuga
de memoria ni agotamiento de pool en la ventana de 27 minutos medida.**

## 7. Escenarios / validaciones NO ejecutadas y por qué

- **Flujos 2/3/5 (Evolución Médica, Signos Vitales, Indicaciones)** dentro de A-E: no hubo episodio
  hospitalario activo sembrado (§5, motor de workflow ECE incompleto en el corpus SQL aplicado
  localmente) — se omitieron con warning, no se inventó actividad.
- **"Slow clients" (§6.5/F):** fuera de las capacidades nativas de k6.
- **Correlación explícita k6 ↔ Kong/K8s (§9 del REQ):** no aplica — el stack real no usa Kong ni K8s
  (Vercel serverless + rate limit en la app), ya corregido en el briefing inicial de este REQ.
- **Rango intermedio 30-150 VUs** para acotar el knee point con precisión: no se corrió por el techo de
  tiempo de esta sesión — recomendado como follow-up rápido (10-15 min).

## 8. Recomendaciones de tuning (derivadas de lo medido, no genéricas)

1. **Cachear la validación de sesión de corta duración.** Es la causa dominante identificada en B/C/D —
   cada request tRPC llama `supabase.auth.getUser()` contra el servidor de Auth sin cache entre
   requests. Un cache de 5-15s (in-memory o el mismo patrón de `rate-limit-global.ts`) eliminaría la
   mayoría de los `UNAUTHORIZED`/`FORBIDDEN` en cascada bajo concurrencia.
2. **Investigar el trigger de audit hash chain (`AuditLog`) bajo escritura concurrente.** 725 deadlocks
   acumulados entre B y C — escala con la concurrencia. Revisar si el patrón `prev_hash`/`chain_hash`
   puede usar un lock más granular o una cola en vez de contención directa en la fila "última".
3. **Excluir 429 del cómputo de error rate en el §7 del REQ** — es un control de negocio funcionando,
   no una falla del sistema (recomendación para `@PO`/`@AE` al recalibrar el SLO).
4. **Caracterizar la categoría "4xx otros" (10.7% en D, 6,688 requests)** — no correlaciona con ningún
   código tRPC logueado; requiere instrumentación adicional (capturar el body de esas respuestas) antes
   de descartarla o explicarla.
5. **Migrar los 6 escenarios a `handleSummary()` de k6** en vez de `--summary-export` — evita depender
   del campo `thresholds` del JSON, que se demostró no confiable en esta sesión (§5.2). Mientras tanto,
   `summarize.mjs` ya reevalúa los thresholds de forma independiente, así que el HTML generado es
   confiable aunque el JSON crudo no lo sea.
6. **Correr el rango 30-150 VUs** para acotar el knee point real con precisión antes de fijar una
   capacidad de referencia.
7. **Pool de Prisma / config de Vercel:** no se pudo medir directamente el `connection_limit` de Prisma
   contra el pooler de Supabase en este setup (BD local sin PgBouncer dedicado) — en producción, medir
   el mismo patrón de rampa contra el ambiente real de staging (`*.supabase.co`, no localhost) es el
   siguiente paso natural, respetando la prohibición de este REQ de tocar producción.
8. **Sembrar N usuarios de prueba distintos y repartir los VUs entre ellos** en la próxima corrida —
   esta sesión usó una sola identidad (`qa.physician@his.test`) para todos los VUs de B/C/D/E, lo que
   hace que el rate limit *por usuario* (600/min) se cruce artificialmente bajo alta concurrencia y
   infle el error rate reportado por encima de lo que un mismo número de clínicos reales, cada uno con
   su propia sesión, produciría. Es la limitación metodológica más importante para repetir la corrida.
9. **Repetir el escenario F específicamente con "slow clients"** usando una herramienta dedicada
   (slowhttptest o xk6 con soporte de socket) — quedó fuera del alcance nativo de k6 en esta sesión.

## 9. Trazabilidad de los criterios de aceptación (§12 del requerimiento)

| Criterio | Estado |
|---|---|
| Los 6 escenarios corren independientes y parametrizados | ✅ Construidos y ejecutados los 6 |
| SLOs centralizados y aplicados como thresholds de k6 | ✅ Centralizados en `config/slos.js`; el booleano exportado por k6 no es confiable (§5.2), pero los veredictos de este documento se derivan de los valores medidos, no de ese booleano |
| Guard anti-producción verificado | ✅ `infra/k6/lib/guard.js`, invocado en los 6 escenarios |
| Datos sintéticos sin PII/PHI (Decreto 143/144) | ✅ Generador determinista en `lib/data.js`, verificado (DUI con checksum válido, patient.create real confirmado) |
| Reporte JSON + HTML por corrida | ✅ `infra/k6/reports/*-summary.json` + `.html` |
| Tabla PASS/FAIL con recomendaciones | ✅ Este documento, §6 y §8 |
| Correlación k6 ↔ infraestructura (k8s/Kong/Postgres) | ⚠️ No aplica Kong/K8s (no están en uso); sí se correlacionó con logs de la app y con `docker stats` de Postgres/GoTrue para C |
