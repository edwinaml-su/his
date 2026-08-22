# ADR 0022 — Espacio de identificadores de establecimiento en `ece.*` (P0-5)

- **Estado:** Propuesto — requiere sign-off de @DBA (migración de datos) + @Dev (30+ call sites) +
  @QAF (regresión) + @Orq antes de ejecutar
- **Fecha:** 2026-08-22
- **Decisores:** @AS (proponente, este documento), pendiente @DBA, @Dev, @QAF, @Orq
- **Fase:** Evaluación de arquitectura — defecto estructural P0-5 verificado contra producción
- **Dependencias:**
  - ADR 0011 — Motor de workflow ECE data-driven
  - ADR 0012 — Estrategia RLS ECE (`withTenantContext`)
  - ADR 0020 (`0020-proveedor-auth-postgres-portable.md`, no confundir con la entrada de memoria
    "ADR 0020 — contexto ECE gobierna documento_instancia" — esa policy `confidencial_read` ya está
    en prod y se verificó de nuevo en este documento sin cambios)
  - `apps/web/src/lib/auth/session.ts` (`getTenantContext`)
  - `packages/trpc/src/rls-context.ts` (`withTenantContext`, GUC `app.current_org_id`/HIS estándar —
    **no** el afectado por este ADR)
  - `packages/trpc/src/workflow/context.ts` (`applyWorkflowContext`/`withWorkflowContext`)
  - `packages/trpc/src/ece/rls-context.ts` (`withEceContext`)
  - `packages/trpc/src/lib/ece-hooks.ts` (`resolveEceEstablecimientoId`, `hookEceEpisodioAfterAdmit`)
  - `packages/database/sql/62_ece_07_rls.sql`, `62b_ece_context_helpers.sql`,
    `65_ece_rls_hardening.sql`, `113_verbal_order.sql`, `147_who_checklist_rls_insert_check.sql`

---

## Contexto

El motor ECE aplica RLS multi-tenant vía `SET LOCAL "app.ece_establecimiento_id"` (o, en algunos
routers legacy, `withEceContext` → `ece.set_ece_context()`), leído por las policies de `ece.*` a
través de `ece.current_establecimiento_id()` / `ece.current_establecimiento_id_safe()`. El supuesto
de diseño es que existe **un solo espacio de identificador de establecimiento**. Verificación de hoy
contra producción (`ejacvsgbewcerxtjtwto`, vía `psql` con `DIRECT_URL` de `.env.local` de la raíz)
muestra que existen **dos espacios incompatibles** conviviendo bajo el mismo nombre de columna
(`establecimiento_id`) y, peor, bajo el mismo GUC:

1. **Espacio A — `public."Establishment".id`**: usado por `ece.paciente.establecimiento_id`
   (`FOREIGN KEY (establecimiento_id) REFERENCES "Establishment"(id)`, verificado por
   `pg_get_constraintdef`).
2. **Espacio B — `ece.establecimiento.id`**: usado por las demás 15 tablas `ece.*` que tienen
   `establecimiento_id` con FK formal (`episodio_atencion`, `personal_salud`, `orden_ingreso`,
   `fall_event`, `sala_qx`, `servicio`, `asignacion_rol`, `bitacora_acceso`,
   `devolucion_inventario`, `farmacovigilancia_incident`, `gs1_epcis_event`,
   `gs1_epcis_patient_event`, `gs1_gsrn`, `rectificacion`, `rri` ×2,
   `tipo_documento_establecimiento`), más 3 tablas sin FK formal pero con RLS que asume el mismo
   espacio (`certificado_incapacidad`, `documento_asociado`, `gs1_gln`).

`apps/web/src/lib/auth/session.ts` (`getTenantContext`) resuelve `establishmentId` **exclusivamente**
del Espacio A (`prisma.establishment.findMany`, línea 92 — modelo Prisma `Establishment` = tabla
`public."Establishment"`). Ese único valor se propaga sin transformar a **más de 35 call sites** en
`packages/trpc/src/routers/**` que arman el objeto `EceContext`/`WorkflowContextOptions` con
`establecimientoId: ctx.tenant.establishmentId` y lo pasan a `withWorkflowContext`/`withEceContext`,
que lo setea tal cual en `app.ece_establecimiento_id`.

**Efecto medido:** el Espacio A GUC solo coincide con `ece.paciente` (y, por join transitivo, con
`ece.documento_instancia`). Para las 15+ tablas del Espacio B, el GUC nunca coincide — devuelven 0
filas bajo demote, no por diseño de aislamiento sino por un identificador que no existe en el espacio
que la policy compara.

---

## 1. Censo completo — todas las tablas `ece.*` con columna de establecimiento

Verificado con `information_schema.columns` + `information_schema.table_constraints` +
`pg_get_constraintdef` (no se asumió de memoria ni de nombres de archivo SQL). Conteo de filas por
`SELECT count(*)` directo contra cada tabla, 2026-08-22.

| Tabla | Columna | FK apunta a | Espacio | Filas en prod |
|---|---|---|---|---|
| `ece.paciente` | `establecimiento_id` | `public."Establishment"(id)` | **A** | **127** |
| `ece.episodio_atencion` | `establecimiento_id` | `ece.establecimiento(id)` | **B** | **30** |
| `ece.establecimiento` | (es la propia tabla puente, ver §2) | — | — | 1 |
| `ece.personal_salud` | `establecimiento_id` | `ece.establecimiento(id)` | B | 0 |
| `ece.orden_ingreso` | `establecimiento_id` | `ece.establecimiento(id)` | B | 0 |
| `ece.fall_event` | `establecimiento_id` | `ece.establecimiento(id)` | B | 0 |
| `ece.sala_qx` | `establecimiento_id` | `ece.establecimiento(id)` | B | 0 |
| `ece.servicio` | `establecimiento_id` | `ece.establecimiento(id)` | B | 0 |
| `ece.asignacion_rol` | `establecimiento_id` | `ece.establecimiento(id)` | B | 0 |
| `ece.bitacora_acceso` | `establecimiento_id` | `ece.establecimiento(id)` | B | 0 |
| `ece.devolucion_inventario` | `establecimiento_id` | `ece.establecimiento(id)` | B | 0 |
| `ece.farmacovigilancia_incident` | `establecimiento_id` | `ece.establecimiento(id)` | B | 0 |
| `ece.gs1_epcis_event` | `establecimiento_id` | `ece.establecimiento(id)` | B | 0 |
| `ece.gs1_epcis_patient_event` | `establecimiento_id` | `ece.establecimiento(id)` | B | 0 |
| `ece.gs1_gsrn` | `establecimiento_id` | `ece.establecimiento(id)` | B | 0 |
| `ece.rectificacion` | `establecimiento_id` | `ece.establecimiento(id)` | B | 0 |
| `ece.rri` | `establecimiento_origen_id` + `establecimiento_destino_id` | `ece.establecimiento(id)` ×2 | B | 0 |
| `ece.tipo_documento_establecimiento` | `establecimiento_id` | `ece.establecimiento(id)` | B | 0 |
| `ece.certificado_incapacidad` | `establecimiento_id` | **sin FK formal** — RLS usa `ece.current_establecimiento_id()` | B (por RLS, sin integridad referencial) | 0 |
| `ece.documento_asociado` | `establecimiento_id` | **sin FK formal** — RLS usa `ece.current_establecimiento_id()` | B (por RLS, sin integridad referencial) | 0 |
| `ece.gs1_gln` | `establecimiento_id` | **sin FK formal** — RLS usa `ece.current_establecimiento_id_safe()` | B (por RLS, sin integridad referencial) | 0 |
| `ece.comite_minuta` | `establecimiento_id` | **sin FK, y su RLS ni siquiera usa esta columna** — la policy `comite_minuta_tenant` filtra por `organization_id = current_setting('app.current_org_id')`, el GUC de `withTenantContext` (HIS estándar), no el de ECE | N/A — columna huérfana de facto | 0 |

**Hallazgo adicional no pedido explícitamente pero relevante:** 3 tablas (`certificado_incapacidad`,
`documento_asociado`, `gs1_gln`) tienen `establecimiento_id` **sin constraint FK formal** — su
alineación al Espacio B se infiere solo de la policy RLS, no de integridad referencial declarada. No
es la causa del bug de este ADR (su RLS ya apunta al espacio correcto), pero es deuda de esquema
adyacente: nada impide hoy un `INSERT` con un UUID que no exista en `ece.establecimiento`.
`ece.comite_minuta` es un caso aparte: su columna `establecimiento_id` no participa en RLS en
absoluto — se señala para que no se confunda con el resto del censo, pero queda fuera del alcance de
este ADR (su tenant-scoping ya funciona correctamente vía `organization_id`).

**Total con datos reales en juego: 2 tablas — `ece.paciente` (127) y `ece.episodio_atencion` (30).**
El resto está en 0 filas, igual que en ADR 0021 — esto es una decisión de arquitectura sobre código
antes de operación real para esas 21 tablas, pero **no** para `paciente`/`episodio_atencion`, que sí
tienen datos vivos y por tanto sí exigen un paso de migración, no solo un cambio de código.

---

## 2. El puente ya existe — `ece.establecimiento.establishment_id`

Verificado por `\d ece.establecimiento`: la tabla **ya tiene** una columna puente
`establishment_id uuid`, con FK real:

```
"establecimiento_establishment_id_fkey" FOREIGN KEY (establishment_id)
  REFERENCES "Establishment"(id) ON DELETE SET NULL
```

Población verificada:

| | Total filas `ece.establecimiento` | Con puente (`establishment_id` no nulo) | Sin puente |
|---|---|---|---|
| | 1 | **1** | 0 |

```
id                                   | codigo  | nombre                                    | establishment_id
ae27feb8-3a43-4723-ac5b-e5d3eb576709 | EST-001 | Hospital Avante Central — Sede Principal | 68c496a8-5755-4e90-ab45-a872c36f9ce1
```

`public."Establishment"` tiene también **1 fila** (`68c496a8-...`), y no hay duplicados de
`establishment_id` en el puente (`GROUP BY ... HAVING count(*) > 1` → 0 filas). El mapeo es **1:1 y
100% completo hoy**.

**Esto es la decisión clave del documento:** el puente no es un diseño propuesto — ya existe en
producción, está completo, y ya hay **precedente de uso real en código**. La función
`resolveEceEstablecimientoId(tx, publicEstablishmentId)` (`packages/trpc/src/lib/ece-hooks.ts:221`)
hace exactamente `SELECT id FROM ece.establecimiento WHERE establishment_id = $1` y ya la usan **7
routers**: `bedside.router.ts`, `indicaciones-medicas.router.ts`, `encounter-discharge.router.ts`,
`encounter-transfer.router.ts`, `encounter.router.ts` (hook de admisión), `gs1-gln-hierarchy.router.ts`,
`gs1-patient-trace.router.ts`. Estos 7 routers **ya resuelven correctamente** el Espacio B antes de
escribir/leer — el patrón correcto ya está construido y probado, simplemente no se aplicó de forma
consistente en el resto del código ECE.

Consecuencia directa: esto **no es un problema de migración de datos en el sentido caro** — es un
problema de **resolución inconsistente** en la capa de contexto, con un único punto de dato
desalineado (`ece.paciente`, 127 filas, un solo establecimiento en juego).

---

## 3. Cómo se arma hoy `ctx.tenant.establishmentId` y dónde se setea el GUC

**Origen (`apps/web/src/lib/auth/session.ts`, función `getTenantContext`, línea 92):**

```ts
let establishments = await prisma.establishment.findMany({
  where: { organizationId: chosen.organizationId, active: true },
  orderBy: { code: "asc" },
});
...
const establishmentId =
  establishments.find((e) => e.id === estabCookie)?.id ?? establishments[0]?.id;
```

`prisma.establishment` es el modelo Prisma sobre `public."Establishment"` — **Espacio A**, sin
ninguna transformación. Este valor entra a `TenantContext.establishmentId` y de ahí a `ctx.tenant` en
cada router tRPC.

**Consumo — dos mecanismos paralelos, ambos alimentados sin resolver:**

1. `packages/trpc/src/workflow/context.ts` (`applyWorkflowContext`) — `SET LOCAL
   "app.ece_establecimiento_id" = '<valor>'`. Usado por ~30 routers vía el patrón
   `establecimientoId: ctx.tenant.establishmentId` construido inline en cada router (ver lista completa
   en §4).
2. `packages/trpc/src/ece/rls-context.ts` (`withEceContext`) — llama
   `ece.set_ece_context(personalId, establecimientoId)`, misma función SQL, mismo GUC final. Usado por
   los 7 routers que **sí** resuelven primero con `resolveEceEstablecimientoId` (correctos) y por
   algunos que no.

Ambos mecanismos setean el **mismo GUC** (`app.ece_establecimiento_id`), leído por
`ece.current_establecimiento_id()` / `ece.current_establecimiento_id_safe()`
(`packages/database/sql/62b_ece_context_helpers.sql`, `65_ece_rls_hardening.sql`). No hay
distinción de espacio a nivel de GUC — es un solo nombre, una sola columna de settings de Postgres,
para dos espacios de identificador incompatibles.

**Nota de higiene de comentarios (no funcional, pero señal de la confusión que causó el bug):** el
docstring de cabecera de `workflow/context.ts` (línea 6) dice `app.establecimiento_id` — el nombre
**sin** el prefijo `ece_` — mientras el código real (línea 61) sí usa `app.ece_establecimiento_id`. Es
exactamente el mismo tipo de error de nombre de GUC que produjo el hallazgo del §5 (`verbal_order`
usa literalmente el nombre sin prefijo, en código real, no solo en un comentario).

---

## 4. Reproducción — la evidencia del encargo, verificada de nuevo en esta sesión

```sql
BEGIN;
SET LOCAL "app.ece_establecimiento_id" = '68c496a8-5755-4e90-ab45-a872c36f9ce1';  -- Espacio A (Establishment.id, lo que manda la app hoy)
SET LOCAL ROLE authenticated;
SELECT 'paciente' t, count(*) FROM ece.paciente
UNION ALL SELECT 'episodio_atencion', count(*) FROM ece.episodio_atencion;
ROLLBACK;
--  paciente          | 127
--  episodio_atencion |   0

BEGIN;
SET LOCAL "app.ece_establecimiento_id" = 'ae27feb8-3a43-4723-ac5b-e5d3eb576709';  -- Espacio B (ece.establecimiento.id)
SET LOCAL ROLE authenticated;
SELECT 'paciente' t, count(*) FROM ece.paciente
UNION ALL SELECT 'episodio_atencion', count(*) FROM ece.episodio_atencion;
ROLLBACK;
--  paciente          |   0
--  episodio_atencion |  30
```

Confirmado byte a byte contra el encargo: **ningún valor único de GUC satisface ambas tablas
simultáneamente** — no es un bug de "valor incorrecto", es un bug de "un solo GUC para dos espacios".

**Matiz que el encargo no capturó y que cambia el diseño de la solución:** `ece.documento_instancia`
(0 filas hoy, pero es la tabla central del motor de 31 tipos de documento NTEC) **no tiene columna
`establecimiento_id` propia** — su tenant-scoping (`documento_instancia_tenant_select/insert/update`,
verificado por `pg_get_expr(polqual, ...)`) hace `JOIN ece.paciente p ON p.id = documento_instancia.paciente_id
WHERE p.establecimiento_id = ece.current_establecimiento_id_safe()`. Como `ece.paciente.establecimiento_id`
vive en el **Espacio A**, esta policy hoy **solo funciona con el valor que la app ya manda**
(`ctx.tenant.establishmentId`, Espacio A) — es la única pieza del motor de workflow para la que el
comportamiento actual (antes de cualquier fix) es el correcto, no un defecto. Esto importa
directamente para las opciones de la sección siguiente: cualquier fix que mueva el GUC al Espacio B
sin también migrar `ece.paciente` **rompe** `documento_instancia` (y con él, los 31 tipos de
documento NTEC) al mismo tiempo que arregla `episodio_atencion`.

---

## 5. Las dos policies con GUC fantasma

Verificado con `pg_policy` + `pg_get_expr`, no de memoria:

**`ece.verbal_order`** (0 filas en prod) — **las 3 policies** (`select`, `insert`, `update`) usan
`current_setting('app.establecimiento_id', true)` — **sin el prefijo `ece_`**. Grep confirma que este
GUC nunca se setea en ningún archivo del repo (ni SQL ni TS) — es un nombre que nadie escribe, solo se
lee. Bajo demote, `current_setting(..., true)` devuelve `NULL`, y `establecimiento_id::text = NULL` es
siempre `false` → **deny-all** en las 3 operaciones. Adicionalmente, el propio router
`verbal-order.router.ts` (líneas 256, 324, 432) hace sus propios `$queryRaw` con el mismo
`current_setting('app.establecimiento_id', true)` **a nivel de aplicación** (no solo en RLS) — el bug
está duplicado en la capa de router y en la capa de política, con el mismo nombre equivocado en ambas,
lo que sugiere que quien escribió el router copió el nombre incorrecto de un lado a otro en vez de
verificarlo contra `62b_ece_context_helpers.sql`.

**`ece.who_checklist`** (0 filas en prod) — **mixto, no las 3 policies por igual**:
- `who_checklist_select` y `who_checklist_update` usan `ece.current_establecimiento_id()` — el helper
  correcto, GUC correcto (`app.ece_establecimiento_id`). Estas dos **funcionan** en cuanto al nombre de
  GUC (siguen sujetas al bug de espacio del §1 si `personal_salud`/`episodio_atencion` están en juego,
  pero el nombre del GUC en sí no es el problema aquí).
- `who_checklist_insert` (`packages/database/sql/147_who_checklist_rls_insert_check.sql:54`) usa
  `current_setting('app.current_estab_id', true)::uuid` — un **tercer** nombre de GUC, distinto tanto
  del correcto (`app.ece_establecimiento_id`) como del roto de `verbal_order`
  (`app.establecimiento_id`). Nadie en el repo setea `app.current_estab_id`. Efecto: **deny-all solo
  en INSERT** — el WHO Surgical Safety Checklist no se puede crear bajo RLS hoy, aunque sí se podría
  leer/actualizar si existiera una fila.

Estos dos hallazgos son independientes del bug de espacio (§1) — son errores de **nombre** de GUC, no
de **espacio** de identificador — pero comparten la misma causa raíz de fondo: no hay un único punto
de verdad para "cómo se llama el GUC de establecimiento en ECE", y cada archivo lo reinventó.

---

## Opciones consideradas

### Opción (a) — Migrar `ece.paciente` al Espacio B (`ece.establecimiento`)

`ALTER TABLE ece.paciente DROP CONSTRAINT paciente_establecimiento_id_fkey`, `UPDATE ece.paciente SET
establecimiento_id = 'ae27feb8-...' WHERE establecimiento_id = '68c496a8-...'` (127 filas, un único
`UPDATE` porque hoy solo hay un establecimiento en juego — verificado §2), `ADD CONSTRAINT ...
REFERENCES ece.establecimiento(id)`. `documento_instancia_tenant_*` no requiere cambio de policy —
sigue haciendo el mismo `JOIN ece.paciente`, pero ahora compara contra el espacio correcto de forma
transitiva.

**Costo:** Bajo para el dato (1 `UPDATE`, 127 filas, un solo valor porque hay un solo establecimiento
en prod). Medio para el código: los ~30 routers que hoy pasan `ctx.tenant.establishmentId` en crudo
siguen mal — **esta opción por sí sola no arregla nada del lado de código**, solo re-alinea
`ece.paciente`/`documento_instancia` al mismo espacio que ya usan las otras 15 tablas. Debe combinarse
con (b) para que el fix sea completo.

**Riesgo:** Bajo hoy (1 establecimiento, mapeo 1:1 verificado). El riesgo crece con el tiempo: si se
provisiona un segundo `Establishment` antes de ejecutar este ADR, la migración deja de ser "un valor"
y pasa a ser "N valores, uno por establecimiento con datos" — sigue siendo mecánica pero ya no es
trivial de verificar a ojo.

**Qué se rompe:** nada, siempre que se ejecute junto con (b). Ejecutada sola, no rompe nada adicional
pero tampoco arregla el defecto reportado (los routers de `episodio_atencion` etc. seguirían recibiendo
el valor sin resolver).

### Opción (b) — Resolver el id correcto en el contexto, sin migrar datos

Centralizar la resolución en un solo punto — la función ya existe
(`resolveEceEstablecimientoId`) — en vez de que cada uno de los ~30 routers construya
`establecimientoId: ctx.tenant.establishmentId` a mano. La forma más robusta es mover la resolución
**una capa arriba**, a `getTenantContext` (`apps/web/src/lib/auth/session.ts`) o a un wrapper común de
`withWorkflowContext`/`withEceContext`, de modo que ningún router nuevo pueda repetir el error por
no saber que existen dos espacios.

**Costo:** Medio — no toca SQL/datos, pero exige tocar cada uno de los ~30 call sites (o, mejor,
refactorizar `applyWorkflowContext`/`withEceContext` para que acepten `publicEstablishmentId` y
resuelvan internamente, eliminando la posibilidad de que un router pase el valor crudo). La segunda
forma es más segura pero toca la firma de dos helpers usados transversalmente — requiere que @Dev
revise los ~37 call sites totales (30 rotos + 7 ya correctos) para no duplicar la resolución en los 7
que ya la hacen manualmente.

**Riesgo:** Medio-bajo si se hace en el helper central (un solo lugar que arreglar, imposible de
olvidar en el próximo router). Alto si se hace router por router (fácil que quede uno sin tocar —
exactamente el patrón que ya produjo este bug: 7 routers lo hacen bien, ~30 no).

**Qué se rompe sin (a):** `ece.paciente`/`documento_instancia` — si el contexto pasa a resolver
siempre al Espacio B, `ece.paciente.establecimiento_id` (Espacio A) deja de coincidir con el GUC y las
127 filas de paciente (+ los 31 tipos de documento NTEC que dependen de `documento_instancia`) se
vuelven ilegibles bajo demote. **(b) sin (a) es una regresión, no un fix** — invierte qué tablas
funcionan sin arreglar el problema de fondo.

### Opción (c) — Dos GUCs distintos, uno por espacio

Mantener `ece.paciente` en el Espacio A tal cual está. Introducir un segundo GUC
(`app.public_establishment_id` o reusar el ya existente `app.current_org_id`-style de
`withTenantContext` si aplica) para las tablas del Espacio A, y dejar `app.ece_establecimiento_id`
exclusivamente para el Espacio B. Cada router setea ambos valores al abrir su transacción de contexto
ECE.

**Costo:** Medio-alto. No requiere migración de datos, pero perpetúa dos espacios a mantener
indefinidamente — cada tabla `ece.*` nueva requiere una decisión consciente de qué GUC usar, y nada en
el esquema fuerza esa decisión a ser correcta (el propio origen de este bug). Requiere tocar los mismos
~30 call sites que (b) para setear el segundo GUC, más el trabajo adicional de introducir y documentar
el GUC nuevo.

**Riesgo:** Alto a mediano plazo — no resuelve la causa raíz (falta de una única fuente de verdad de
identificador de establecimiento dentro de `ece.*`), solo la parchea con más superficie de
configuración. Es exactamente el patrón que ya produjo los 2 GUCs fantasma del §5: cuantos más nombres
de GUC coexisten, más fácil que un archivo nuevo use el que no es.

**Qué se rompe:** nada de forma inmediata, pero dificulta declarar reglas simples tipo "todas las
tablas de `ece.*` usan `app.ece_establecimiento_id`" — la excepción de `ece.paciente` queda como caso
especial permanente que cualquier desarrollador nuevo debe recordar.

**No recomendada como solución permanente** — es el plan de contingencia si (a) resulta bloqueada por
algo no descubierto en esta auditoría (ver Riesgos).

---

## Recomendación

**(a) + (b) combinadas: migrar `ece.paciente` al Espacio B y centralizar la resolución del contexto.**
No son alternativas — son las dos mitades del mismo fix. Ejecutadas juntas, `ece.establecimiento.id`
pasa a ser el único espacio de identificador dentro de `ece.*`, consistente con las 15+2 tablas que ya
lo usan hoy y con la convención de nombre (`app.ece_establecimiento_id`, prefijo `ece_` explícito para
distinguirlo del GUC de `withTenantContext`).

**Por qué no (c):** con el puente 100% poblado y 1:1 (§2), y con precedente de código ya funcionando
(`resolveEceEstablecimientoId`, 7 routers), no hay ninguna razón de costo que justifique mantener dos
espacios a perpetuidad. (c) es la salida cuando falta uno de esos dos hechos — aquí están los dos.

**Por qué combinar y no elegir solo una:** (a) sin (b) dejaría el código igual de roto para
`episodio_atencion`/`personal_salud`/etc. (b) sin (a) invierte la rotura hacia `paciente`/
`documento_instancia` — que es la tabla más crítica del motor de 31 documentos NTEC (ADR 0011). Ninguna
mitad por sí sola cierra el hallazgo P0-5.

### Plan de migración

1. **@DBA** — verificar de nuevo el conteo de `Establishment`/`ece.establecimiento` inmediatamente
   antes de ejecutar (puede haber cambiado desde esta auditoría — ver Riesgos). Si sigue siendo 1:1,
   ejecutar en una transacción:
   ```sql
   BEGIN;
   ALTER TABLE ece.paciente DROP CONSTRAINT paciente_establecimiento_id_fkey;
   UPDATE ece.paciente p
     SET establecimiento_id = e.id
     FROM ece.establecimiento e
     WHERE e.establishment_id = p.establecimiento_id;
   -- Verificación dentro de la misma tx: 0 filas sin resolver.
   SELECT count(*) FROM ece.paciente p
     WHERE NOT EXISTS (SELECT 1 FROM ece.establecimiento e WHERE e.id = p.establecimiento_id);
   ALTER TABLE ece.paciente
     ADD CONSTRAINT paciente_establecimiento_id_fkey
     FOREIGN KEY (establecimiento_id) REFERENCES ece.establecimiento(id)
     ON UPDATE CASCADE ON DELETE RESTRICT;
   COMMIT;  -- solo si la verificación dio 0
   ```
   Si algún `Establishment` no tiene fila puente en `ece.establecimiento` (verificar con
   `LEFT JOIN`), **no** ejecutar — crear primero la fila puente (paso 0, ver Riesgos) o el `UPDATE`
   dejará pacientes huérfanos de establecimiento.
2. **@Dev** — refactorizar `applyWorkflowContext` (`packages/trpc/src/workflow/context.ts`) y
   `withEceContext` (`packages/trpc/src/ece/rls-context.ts`) para que acepten
   `publicEstablishmentId` (el valor de `ctx.tenant.establishmentId`, Espacio A) y resuelvan
   internamente con `resolveEceEstablecimientoId` antes de setear el GUC — en vez de exigir que cada
   router ya traiga el valor correcto. Esto colapsa los ~30 call sites rotos y los 7 correctos a un
   solo patrón, sin que cada router deba saber que existen dos espacios.
3. **@Dev** — actualizar los ~30 routers listados en §4 para dejar de resolver manualmente (si algunos
   ya lo hacían bien, verificar que no queden resolviendo dos veces). Corregir también los casos de
   fallback `tenant.establishmentId ?? tenant.organizationId` (`obstetricia.router.ts`,
   `registro-anestesico.router.ts`, `registro-enfermeria.router.ts`, `sala-expulsion.router.ts`,
   `valoracion-inicial-enfermeria.router.ts`) y el caso `farmacovigilancia.router.ts:290` que pasa
   `ctx.tenant.organizationId` (un tercer espacio, ni A ni B) como `establecimientoId` — hallazgos
   colaterales de la misma auditoría, mismo código, mismo PR.
4. **@Dev** — corregir los 2 GUC fantasma del §5: `verbal-order.router.ts` (3 policies SQL +
   3 `$queryRaw` en el router, cambiar `app.establecimiento_id` → `app.ece_establecimiento_id`) y
   `147_who_checklist_rls_insert_check.sql` (`app.current_estab_id` →
   `ece.current_establecimiento_id()`, alineando con `select`/`update` de la misma tabla).
5. **@Dev** — corregir el docstring de `workflow/context.ts` línea 6 (`app.establecimiento_id` →
   `app.ece_establecimiento_id`) — housekeeping menor, mismo PR.
6. **@QAF/@QA** — regresión dirigida: lectura de expediente de paciente (127 filas reales), lectura de
   episodios de atención (30 filas reales), creación de un `documento_instancia` de cualquier tipo
   NTEC (hoy en 0 filas — primera vez que se prueba con el fix), y los flujos de `verbal_order`/
   `who_checklist` end-to-end.

### Verificación de que quedó bien

Antes del fix (reproducido en §4): con el GUC seteado al valor que la app manda hoy
(`ctx.tenant.establishmentId`, Espacio A), `SELECT count(*) FROM ece.episodio_atencion` bajo demote
da **0**. Después del fix (ambos pasos ejecutados), la misma sesión de aplicación real (login normal,
sin manipular GUC a mano) debe devolver **30** — y `SELECT count(*) FROM ece.paciente` en la misma
sesión debe seguir devolviendo **127** (no debe regresar a 0). Ambos números en la misma sesión,
simultáneamente, es la prueba de que el fix unificó el espacio en vez de solo trasladar el bug.

---

## Riesgos y fuera de alcance

- **Ventana de validez de "1:1, un solo establecimiento".** Igual que ADR 0021, esta auditoría es
  válida al 2026-08-22. Si se provisiona un segundo `Establishment`/`ece.establecimiento` antes de
  ejecutar el plan, repetir §1/§2 antes de correr el `UPDATE` del paso 1 — la premisa de "un solo
  valor a migrar" puede dejar de sostenerse.
- **Fila puente faltante para un `Establishment` nuevo — gap operacional real, no solo hipotético.**
  Se verificó (grep) que **no existe ningún hook** que cree automáticamente la fila
  `ece.establecimiento` (con su `establishment_id` puente) al crear un `public."Establishment"` nuevo.
  Hoy es inofensivo (1 establecimiento, ya con puente). En cuanto se provisione un segundo
  establecimiento sin ese paso manual, `resolveEceEstablecimientoId` devuelve `null` para él y **todo**
  el módulo ECE queda inoperante para ese establecimiento — no es un caso extremo, es el flujo de
  alta de un hospital nuevo. Recomendado como seguimiento (no ejecutado en este ADR): un hook
  simétrico a `hookEcePacienteAfterCreate` que corra al crear `Establishment`.
- **Eje de identidad de persona (`User` ↔ `ece.personal_salud`, R03) — fuera de alcance de este
  documento por instrucción explícita.** Se observó en el camino, sin resolverlo: `personal_salud`
  vive en el Espacio B (`FK → ece.establecimiento`, consistente con el fix de este ADR), pero **no**
  se auditó si el `personal_id`/`ece_personal_id` que la app resuelve para ese mismo GUC tiene un
  problema de espacio análogo del lado de identidad de usuario — corresponde al equipo paralelo
  trabajando ese eje.
- **`ece.comite_minuta.establecimiento_id`** existe como columna pero no participa en su propia RLS
  (usa `organization_id` de `withTenantContext` en su lugar) — no es parte del defecto P0-5, se señala
  para que no se confunda con el resto del censo del §1, y queda fuera de alcance.
- **3 tablas sin FK formal en su columna `establecimiento_id`** (`certificado_incapacidad`,
  `documento_asociado`, `gs1_gln`, §1) — deuda de esquema adyacente, su RLS ya apunta al espacio
  correcto (B) así que no bloquean este fix, pero deberían recibir la FK faltante en un PR de
  hardening separado.
- **No se ejecuta ningún cambio de código ni de base de datos en este documento** — es un ADR de
  diseño. Todo lo mostrado en el plan de migración (SQL, refactor de helpers) es la propuesta para el
  PR de implementación de @Dev/@DBA, no algo aplicado en esta sesión.

---

## Qué se verificó vs. qué se asumió

**Verificado (SELECT de solo lectura + lectura de código, esta sesión, no de memoria):**
- Las 21 tablas del censo del §1, su columna, su FK (o ausencia) y su conteo de filas — vía
  `information_schema.columns`, `information_schema.table_constraints`, `pg_get_constraintdef`,
  `SELECT count(*)` directo por tabla.
- Población y unicidad del puente `ece.establecimiento.establishment_id` (§2) —
  1 fila, 100% poblada, sin duplicados.
- Reproducción exacta del defecto reportado (§4) — simulación de sesión con `BEGIN; SET LOCAL ...;
  SET LOCAL ROLE authenticated; ...; ROLLBACK;` contra el proyecto real, dos veces (Espacio A y
  Espacio B), confirmando los números exactos del encargo (127/0 y 0/30).
- Las 4 policies de `verbal_order`/`who_checklist` y sus nombres de GUC exactos, vía `pg_policy` +
  `pg_get_expr` — no se infirió del nombre del archivo SQL.
- Los ~37 call sites (30 rotos + 7 correctos) que arman `establecimientoId` para
  `withWorkflowContext`/`withEceContext`, vía grep dirigido sobre `packages/trpc/src/routers/**`.
- El origen exacto de `ctx.tenant.establishmentId` en `apps/web/src/lib/auth/session.ts` — lectura
  completa del archivo, no solo el nombre del campo.
- La existencia y el comportamiento de `resolveEceEstablecimientoId` — lectura completa de
  `ece-hooks.ts`, confirmando que ya resuelve el puente correctamente y que 7 routers ya la usan.
- Que `ece.documento_instancia` no tiene columna `establecimiento_id` propia y que su tenant-scoping
  depende transitivamente del espacio de `ece.paciente` — verificado con `pg_policy` sobre
  `documento_instancia`, no asumido del nombre de la tabla.
- Ausencia de cualquier hook que cree `ece.establecimiento` al crear `public."Establishment"` — grep
  dirigido, sin resultados.

**Asumido / no verificado en esta sesión (declarado explícitamente):**
- Que el eje de identidad de persona (`personal_salud`/`User`, R03) no tiene un problema de espacio
  análogo — no se auditó a propósito, es responsabilidad del equipo paralelo indicado por el encargo.
- Que ningún otro archivo SQL fuera de los 20 grep-eados en `packages/database/sql/` referencia un
  nombre de GUC de establecimiento adicional a los 3 encontrados (`app.ece_establecimiento_id`
  correcto, `app.establecimiento_id` y `app.current_estab_id` fantasma) — el grep cubrió el patrón
  `establecimiento_id`/`estab_id` pero un nombre completamente distinto no coincidiría con esa
  búsqueda. Recomendado que @Dev repita un grep de `current_setting\(` sin filtro de patrón antes de
  cerrar el PR de implementación.
- El comportamiento exacto de `ece.set_ece_context()` bajo concurrencia/pooling (PgBouncer,
  `DATABASE_URL` con `pgbouncer=true`) — la verificación de este ADR se hizo contra `DIRECT_URL`
  (conexión directa, sin pooler), consistente con el patrón ya establecido en ADR 0021 para este tipo
  de verificación, pero no se probó específicamente bajo el pooler de sesión que usa la app en runtime.

---

## Referencias

- `apps/web/src/lib/auth/session.ts`
- `packages/trpc/src/workflow/context.ts`
- `packages/trpc/src/ece/rls-context.ts`
- `packages/trpc/src/lib/ece-hooks.ts`
- `packages/trpc/src/routers/ece/verbal-order.router.ts`
- `packages/database/sql/62_ece_07_rls.sql`
- `packages/database/sql/62b_ece_context_helpers.sql`
- `packages/database/sql/65_ece_rls_hardening.sql`
- `packages/database/sql/113_verbal_order.sql`
- `packages/database/sql/147_who_checklist_rls_insert_check.sql`
- ADR 0011 — Motor de workflow ECE data-driven
- ADR 0012 — Estrategia RLS ECE
- ADR 0021 — Fuente de verdad del proceso quirúrgico (precedente metodológico: censo de filas contra
  producción antes de decidir, mismo día, mismo patrón de verificación)
- CLAUDE.md §"Contrato RLS — léase antes de tocar routers Prisma"
