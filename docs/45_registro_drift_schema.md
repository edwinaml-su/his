# 45 — Registro de drift schema.prisma ↔ BD (R09 Code Castle)

> Cierra R09 del assessment Code Castle («Divergencias de schema y generaciones
> arquitectónicas», riesgo Alto). Gate de cierre: política escrita + censo real
> de lo que vive solo en SQL, con su justificación. Producido por @DBA.
>
> Método: introspección directa de producción (`ejacvsgbewcerxtjtwto`) vía
> `psql` en modo `default_transaction_read_only=on`, comparada contra
> `packages/database/prisma/schema.prisma` (8030 líneas, 249 modelos) mediante
> un extractor propio (no `prisma db pull`, que reescribiría el schema). Censo
> hecho el 2026-08-22. Cero escrituras a la BD, cero cambios a schema.prisma o
> SQL — ver §6 para cómo reproducirlo.

---

## 1. Por qué existe este documento

El flujo de este proyecto es **deliberadamente** `schema.prisma` + SQL
numerados en `packages/database/sql/` (ver CLAUDE.md §Layout monorepo). Eso
es correcto para RLS, triggers, funciones SECURITY DEFINER, particionamiento
y cosas que Prisma no expresa bien. El costo es que **nadie llevaba el
registro** de qué tablas/columnas divergen entre BD y Prisma, ni por qué. Con
243 archivos SQL y 249 modelos Prisma, el drift dejó de ser "un par de casos
conocidos" (`ServicePriceList`, `ece.*`) y pasó a ser un espacio de ~240
divergencias reales, algunas de ellas bugs activos en producción (§4).

## 2. Política

**Es legítimo que una tabla/columna viva solo en SQL cuando:**

1. Es infraestructura de Postgres que Prisma no modela: funciones,
   triggers, políticas RLS, materialized views, schemas de solo-función
   (`accounting`, `notifications` — ver §5.3), extensiones de particionamiento.
2. Es el schema `ece.*` completo — motor de workflow data-driven (CLAUDE.md
   §Motor de workflow ECE). La mayoría de escritura a `ece.*` pasa por
   `$queryRaw`/`$executeRaw` con SQL explícito, no por el cliente tipado — ver
   §4.3 para por qué eso importa.
3. Tablas de secuencia/contador (`secuencia_*`), logs de sync con sistemas
   externos (`OdooSyncLog`, `offline_sync_log`), o tablas de soporte a un
   proceso batch/cron que no necesita el cliente tipado de Prisma para nada.
4. Capas BI/analíticas de solo lectura (`analytics.*` matviews) — @DA/@BID
   son dueños de ese layer, no @DBA, y Prisma no debe modelarlo (ver
   `docs/04_modelo_datos.md`).

**Cuándo NO es legítimo — y qué hacer en el mismo PR:**

- Si una tabla/columna SQL-only es leída o escrita por código de aplicación
  **a través del cliente tipado de Prisma** (`ctx.prisma.<modelo>.find/create/
  update`, no `$queryRaw`), el modelo Prisma **debe** reflejar exactamente
  esas columnas antes de mergear. Un campo Prisma que no tiene columna real es
  una excepción de Postgres esperando a ocurrir (§4 tiene 6 casos ya
  ocurriendo).
- Si un archivo SQL numerado declara una columna en su `CREATE TABLE`/`ALTER
  TABLE` (ej. `95_f2_s15_d_audit_rbac.sql` línea 21, `outlierAlertEnabled`) el
  autor del PR es responsable de **verificar que se aplicó** a prod antes de
  cerrar el PR — un archivo en el repo no es evidencia de que corrió (ver
  §4.4, es exactamente lo que falló ahí).
- Toda tabla SQL-only nueva en `public` (fuera de `ece.*`) debe:
  - Tener un comentario de una línea en el archivo SQL que la crea explicando
    **por qué** no es un modelo Prisma (patrón ya usado en
    `195b_gs1_recepcion_mercancia_ddl.sql`).
  - Agregarse a la tabla de §5.1 de este documento **en el mismo PR**.
- Toda tabla que YA no tiene código de aplicación referenciándola (huérfana,
  0 filas) es candidata a DROP, no a quedar indefinidamente en el limbo —
  repórtese, no se acumula silenciosamente (ver §5.1, columna "0 filas").

## 3. Resultado agregado

| | BD (prod) | schema.prisma | Solo en BD | Solo en Prisma (drift inverso) |
|---|---:|---:|---:|---:|
| Tablas `public` | 184 | 159 | **27** | **0** |
| Tablas `ece` | 109 | 89 | 22 (por diseño, agregado) | **3** (anómalo — ver §5.2) |
| Tablas `audit` | 1 | 1 | 0 | 0 |
| Modelos con columnas divergentes | — | — | 30 columnas "solo BD" en 10 modelos | **122 campos "solo Prisma"** (ghost fields) en 41 modelos |

De los 122 campos "solo Prisma", **6 están activamente en uso por código de
producción y romperán en runtime** (§4). El resto (~110) es un patrón
sistémico concentrado en ~35 modelos `Ece*` cuyo shape nunca se sincronizó
tras crearse la tabla real por SQL (§4.3) — mitigado hoy solo porque casi
todo el código de `ece.*` bypasea el cliente tipado.

Otros schemas de Postgres (`accounting`, `analytics`, `notifications`, `gs1`,
`cron`) no son drift de aplicación: son namespaces de solo-función/matview
(§5.3), excepto `gs1.recepcion_mercancia`, ya documentado como hallazgo
colateral en `195b_gs1_recepcion_mercancia_ddl.sql`.

---

## 4. Divergencias peligrosas — bugs activos, no documentación

Estas seis son código de producción seleccionando o escribiendo columnas que
**no existen en la BD**. Confirmado por introspección directa
(`information_schema.columns`), no por lectura del código solamente.

### 4.1 `ClinicalNote.editHistory` — notas clínicas (SOAP/evolución)

- **Modelo:** `schema.prisma:2547` — `editHistory Json?` (sin `@map`, sin
  columna `editHistory` en `public."ClinicalNote"`).
- **Uso real:** `packages/trpc/src/routers/ehr-notes.router.ts`
  - línea 100 y 137: `create`/`addendum` escriben `editHistory: [historyEntry]`.
  - línea 157: `select: { ..., editHistory: true, ... }` antes de un `update`.
  - línea 169/173: lee `note.editHistory`, arma el historial nuevo y lo
    reescribe.
- **Efecto:** crear, addendar o editar una nota clínica lanza `column
  "editHistory" of relation "ClinicalNote" does not exist`. Esto es el
  módulo de evolución médica — alto tráfico.
- **Clasificación:** (c) accidental — el campo se agregó al modelo (o se dejó
  de un rediseño) sin la migración SQL correspondiente.

### 4.2 `DietPlan.allergens` — verificación de alérgenos en plan dietético

- **Modelo:** `schema.prisma:3868` — `allergens String[] @default([])`, sin
  columna real en `public."DietPlan"`.
- **Uso real:** `packages/trpc/src/routers/nutrition.router.ts:222-228` —
  `prisma.dietPlan.findFirst({ ..., select: { allergens: true } })`, resultado
  usado para cruzar contra alergias registradas del paciente y bloquear un
  plan incompatible.
- **Efecto:** la verificación de seguridad alimentaria (choque
  alérgeno-paciente) lanza excepción en vez de ejecutarse. Riesgo clínico, no
  solo técnico.
- **Clasificación:** (c) accidental.

### 4.3 `PharmacyReservation.cancelMotivo` + `.updatedAt` — reservas de dispensación

- **Modelo:** `schema.prisma:2172,2174` — `cancelMotivo String? @db.Text` y
  `updatedAt DateTime @updatedAt`. Ninguna de las dos columnas existe en
  `public."PharmacyReservation"`.
- **Uso real:** `packages/trpc/src/routers/pharmacy-dispensation.router.ts:226-232`
  — `cancel` hace `tx.pharmacyReservation.update({ data: { status:
  "CANCELLED", cancelMotivo: input.motivo } })`.
- **Efecto agravado:** `@updatedAt` hace que Prisma inserte `updatedAt = now()`
  en **todo** `UPDATE` sobre este modelo automáticamente, exista o no en el
  `data` explícito. Es decir: no solo falla el cancel — **cualquier** update
  futuro a `PharmacyReservation` (incluyendo uno que no toque `cancelMotivo`)
  fallaría igual, porque Prisma añade `updatedAt` al `SET` sin que el
  desarrollador lo pida.
- **Clasificación:** (c) accidental.

### 4.4 `AuditDashboardConfig.outlierAlertEnabled` — config del dashboard de auditoría

- **SQL declarado pero no aplicado:** `packages/database/sql/95_f2_s15_d_audit_rbac.sql:21`
  declara `"outlierAlertEnabled" BOOLEAN NOT NULL DEFAULT true` en el
  `CREATE TABLE`. La columna **no existe** en prod — verificado con
  `information_schema.columns` sobre `public."AuditDashboardConfig"` (solo 7
  columnas: `id, organizationId, ipWhitelist, horarioClinicoInicio,
  horarioClinicoFin, createdAt, updatedAt`).
- **Uso real:** `packages/trpc/src/routers/audit-outlier.router.ts` — usa
  `$queryRaw`/`$executeRawUnsafe` (no el cliente tipado) pero **con la
  columna hardcodeada en el SQL** (líneas 127, 449, 455, 461): `getConfig` y
  `upsertConfig` referencian `"outlierAlertEnabled"` directamente.
- **Efecto:** cargar o guardar la configuración del dashboard de auditoría
  (pantalla admin de seguridad) lanza `column "outlierAlertEnabled" does not
  exist`. Este caso es distinto a los anteriores: no es un campo Prisma sin
  sincronizar, es **un archivo SQL numerado cuyo contenido nunca se aplicó a
  producción** — la prueba viva de por qué la política (§2) exige verificar
  aplicación, no solo la existencia del archivo.
- **Clasificación:** (b) deliberada pero mal ejecutada — el archivo SQL
  documenta la intención correctamente; falló el paso de aplicarlo (o se
  aplicó una versión anterior del archivo antes de que se le agregara esta
  columna).

### 4.5 `EcePaciente` — 4 campos activos en deduplicación de pacientes

- **Modelo:** `EcePaciente` (`ece.paciente`) declara `primerNombre
  String? @map("primer_nombre")`, `primerApellido`, `segundoApellido`,
  `fechaNacimiento` (y además `segundoNombre`, `sexo`,
  `documentoNoPresentado`, no usados). Ninguna de esas 7 columnas existe en
  `ece.paciente` — la tabla real solo tiene identificadores
  (`nui`,`cun`,`dui`,`carnet_minoridad`,`pasaporte`), no demografía; nombre y
  fecha de nacimiento viven en `public."Patient"` vía `public_patient_id`.
- **Uso real:** `packages/trpc/src/routers/patient-dedup.router.ts:292-328`
  (`findPotentialDuplicates`, US.F2.7.40) — **selecciona explícitamente**
  `primerNombre, primerApellido, segundoApellido, fechaNacimiento` de
  `ctx.prisma.ecePaciente.findUnique/findMany` para puntuar duplicados por
  similitud Jaro-Winkler.
- **Efecto:** la detección de pacientes duplicados (feature de calidad de
  datos / MDM) falla en cada invocación.
- **Nota:** esto es el único punto donde el patrón sistémico de §4.6 (modelos
  `Ece*` con shape genérico nunca sincronizado) se cruza con código que sí
  usa el cliente tipado — por eso es el único de esos ~35 modelos que rompe
  hoy en vez de quedar dormido.
- **Clasificación:** (c) accidental.

### 4.6 Patrón sistémico — ~35 modelos `Ece*` con shape nunca sincronizado (dormido, no activo)

Además de EcePaciente (§4.5), otros ~34 modelos `Ece*` (p.ej.
`EceHistoriaClinica`, `EceWhoChecklist`, `EceRegistroAnestesico`,
`EceUrpaRecovery`, `EcePartogramaRegistro`, `EceAtencionRecienNacido`,
`EceReanimacionNeonatal`, `EceGs1Gln/Sscc/Gsrn/Giai`,
`EceRecepcionMercancia`, `EceTransferenciaInventario`,
`EcePreparacionUnidosis`, `EceDevolucionInventario`,
`EceInventoryThreshold`, `EceColdChainLectura/Alerta/ConfigEquipo`,
`EceBitacoraAcceso`, `EceRectificacion`, `EceCertificadoIncapacidad`,
`EcePersonalSalud`, `EceAsignacionRol`, `EceEpisodioHospitalario`, …)
declaran campos genéricos (`data`/`datos Json?`, `estado_registro`,
`paciente_id`, `episodio_id`, `instancia_id`, `registrado_en`) que **no
corresponden a las columnas reales** de sus tablas. Ejemplo verificado:
`ece.who_checklist` tiene `fase_sign_in/fase_time_out/fase_sign_out jsonb` +
`estado` + `acto_quirurgico_id`; el modelo Prisma `EceWhoChecklist` declara
`datos Json?`, `estado_registro`, `episodio_id`, `instancia_id` — ninguno de
los cuatro existe.

**Por qué no está en la lista de bugs activos:** confirmado por grep
sistemático (`prisma\.ece[A-Z]\w*\.(findMany|findFirst|...)` /
`tx\.ece[A-Z]\w*\....`) que el cliente tipado de Prisma sobre `ece.*` se usa
**solo** en 4 modelos: `EceCatalogoCpt`, `EcePaciente`, `EcePatientMerge`,
`EcePlantillaTexto` (routers `cpt.router.ts`, `patient-dedup.router.ts`,
`plantilla-texto.router.ts`, `workflow-inbox.router.ts`). Todo lo demás
(historia clínica, triaje, atención de emergencia, indicaciones, evolución,
consentimientos, RRI, orden de ingreso, hoja de ingreso, acto quirúrgico,
epicrisis, WHO checklist, registro anestésico, URPA, partograma, atención de
recién nacido, GS1, inventario, cadena de frío...) usa `$queryRaw`/`Prisma.sql`
con columnas explícitas — el ejemplo en `historia-clinica.router.ts:832-850`
lista 19 columnas reales en el `INSERT`, ninguna llamada `data` ni
`paciente_id`.

**Riesgo:** dormido pero real. Cualquier desarrollador nuevo que razonablemente
asuma "esto es un modelo Prisma, uso `.findMany()`" en lugar de leer el
router existente y copiar el patrón `$queryRaw` va a reproducir el bug de
§4.5. Es deuda de higiene de schema, no solo de documentación.

**Clasificación:** (c) accidental, agravado por antigüedad — parece originarse
en el seed inicial del motor de workflow (Fase 2, PR #212, 2026-05-22), donde
se crearon modelos Prisma placeholder para los 31 `tipo_documento` antes de
que cada tabla física recibiera su diseño real de columnas, y nunca se
volvió a sincronizar.

---

## 5. Registro completo

### 5.1 Tablas `public` que existen en BD y NO en Prisma (27)

| Tabla | Archivo SQL de origen | Filas (prod) | Código la referencia | Clasificación |
|---|---|---:|---|---|
| `ServiceCategory` | `133_service_price_list_tarifario.sql`, `204_cc0021_motor_reglas_precios.sql` | activo | sí (motor de precios CC-0015/CC-0021) | (a) deliberada — capa de reglas de precios réplica de Odoo, ya conocida |
| `ServicePriceList` | ídem | activo | sí | (a) deliberada |
| `ServicePriceListItem` | ídem | activo | sí | (a) deliberada |
| `ServicePriceRule` | `204_cc0021_motor_reglas_precios.sql` | activo | sí | (a) deliberada |
| `SrsFabricante` | `135_srs_registro_sanitario.sql` | activo | sí (integración SRS El Salvador) | (a) deliberada |
| `SrsFormaFarmaceutica` | ídem | activo | sí | (a) deliberada |
| `SrsPresentacion` | ídem | activo | sí | (a) deliberada |
| `SrsPrincipioActivo` | ídem | activo | sí | (a) deliberada |
| `SrsRegistroCache` | ídem | activo | sí | (a) deliberada |
| `CatalogoInsumo` | **ninguno encontrado en el corpus** | 0 | no | (b) origen desconocido — sin SQL fuente ni código; investigar antes de decidir drop vs. modelar |
| `CatalogoMedicamento` | **ninguno encontrado** | 0 | no | (b) origen desconocido, mismo caso |
| `NpsResponse` | `130_performance_sample_and_nps.sql` | **0** | no — sin referencias en `packages/` | (b) deliberada (SQL documentado) pero sin router que la consuma todavía; feature de encuestas NPS aparentemente sin terminar de cablear |
| `PerformanceSample` | `130_performance_sample_and_nps.sql` | 910 (activo) | sí (perf.yml / k6) | (a) deliberada |
| `OdooSyncLog` | **ninguno encontrado** | 0 | no | (c) huérfana — probable scaffolding de la Wave 12 de escritura a Odoo, cancelada por el usuario (ver memoria `project_his_odoo_readonly_2026-05-25`); candidata a DROP o a documentar+cerrar la decisión |
| `OdooSyncMapping` | **ninguno encontrado** | 0 | no | (c) huérfana, mismo caso |
| `WorkflowTaskAction` | `138_workflow_task_action.sql` | activo | sí | (a) deliberada |
| `chat_knowledge_chunk` | `150a_chat_knowledge_chunk_ddl.sql` | activo | sí | (a) deliberada |
| `chat_message` | `150_chat_tables_ddl.sql` | activo | sí | (a) deliberada |
| `chat_session` | `150_chat_tables_ddl.sql` | activo | sí | (a) deliberada |
| `offline_sync_log` | **ninguno encontrado** | — | sí, `apps/web/src/app/api/sync/replay/route.ts` | (b) deliberada y en uso, pero sin archivo SQL versionado — cerrar el gap documental |
| `secuencia_cuenta` | `178_cc0002_cuenta_servicio.sql` | activo | sí (numeración CC-0002/CC-0014) | (a) deliberada |
| `secuencia_expediente` | `176_cc0002_expediente.sql` | activo | sí | (a) deliberada |
| `secuencia_no_identificado` | `187_cc0008b_sangre_no_identificado.sql` | activo | sí | (a) deliberada |
| `secuencia_solicitud_imagen` | `192_cc0016_modulo_imagenes.sql` | activo | sí | (a) deliberada |
| `surgical_form_submission` | **ninguno encontrado** | 0 | no | (b) origen desconocido, 0 filas — investigar |

**Resumen 5.1:** 19 de 27 (70%) son deliberadas y documentables con una línea
(las de precios, SRS, chat, secuencias, NPS/perf). 6 son de **origen
desconocido** — sin archivo SQL en el corpus y sin código que las use, todas
con 0 filas (`CatalogoInsumo`, `CatalogoMedicamento`, `OdooSyncLog`,
`OdooSyncMapping`, `surgical_form_submission`) o con código pero sin SQL
versionado (`offline_sync_log`). Ninguna es peligrosa (0 filas o ya
funcionando), pero rompen la trazabilidad — el mandato de "todo termina en
GitHub" (preferencia de Edwin) no se cumplió para estas 6.

### 5.2 `ece.*` — agregado + 3 anomalías

Por diseño, **89 de 109 tablas ece están en Prisma** (ver §4.6 para la
salvedad de que el *shape* de muchos de esos 89 no es confiable); las 22
restantes son extensiones legítimas del motor de workflow / GS1 / seguridad
clínica (`workflow_draft`, `workflow_plantilla`, `lasa_pair`,
`pediatric_max_dose`, `fall_event`, `verbal_order`,
`critical_result_notification`, `epcis_event*`, `tipo_documento_establecimiento`,
etc.) — no se listan tabla por tabla por instrucción explícita del encargo.

Anomalías reales (drift inverso — Prisma declara algo que la BD no tiene):

| Modelo Prisma | Tabla esperada | Estado real en BD | Clasificación |
|---|---|---|---|
| `EceBitacoraAuditoria` | `ece.bitacora_auditoria` | **No existe en ningún schema.** Sin archivo SQL que la cree. | (c) modelo nunca materializado — código muerto en schema.prisma, sin uso en la app (grep confirma cero referencias a `eceBitacoraAuditoria`) |
| `EceSupresion` | `ece.supresion` | **No existe en ningún schema.** Sin archivo SQL. | (c) mismo caso, cero referencias en código |
| `EceDocumentoObstetrico` | `ece.documento_obstetrico` (singular) | La tabla real es `ece.documentos_obstetricos` (**plural**) — creada en `docs/flujos` + SQL correspondiente. Nombre no coincide. | (c) drift de nombre — el modelo es inutilizable tal cual (`prisma.eceDocumentoObstetrico.findMany()` fallaría con "relation does not exist"); sin referencias en código hoy |

Los tres modelos comparten un rasgo tranquilizador: **cero uso en código**
(`grep` sobre `packages/` y `apps/` no encuentra `eceBitacoraAuditoria`,
`eceSupresion` ni `eceDocumentoObstetrico`). Son deuda de schema, no bugs
activos — pero cualquiera de los tres explota apenas alguien intente usarlos
asumiendo que "está en Prisma" == "funciona".

### 5.3 Otros namespaces de Postgres (no son drift de aplicación)

| Schema | Contenido | Rol |
|---|---|---|
| `accounting` | Solo funciones `SECURITY DEFINER` (Beta.18 contabilidad). Las tablas (`Account`, `JournalEntry`, etc.) viven en `public` y sí están en Prisma. | (a) deliberado — aislamiento de privilegios, documentado en `47_accounting_hardening.sql` |
| `notifications` | Solo funciones `SECURITY DEFINER` del outbox (Beta.15). Tablas en `public`. | (a) deliberado, documentado en `42_notifications_outbox.sql` |
| `analytics` | 1 matview (`kpi_falls_rate_monthly`). Capa Gold de BI, dueño @DA/@BID. | (a) deliberado, fuera del alcance de Prisma por diseño (`docs/04_modelo_datos.md`) |
| `gs1` | 1 tabla: `gs1.recepcion_mercancia`. **Ya documentada como hallazgo colateral** en `195b_gs1_recepcion_mercancia_ddl.sql` (líneas 27-32): coexiste con `ece.recepcion_mercancia`, distinto grano de tenancy (`organization_id` vs `establecimiento_id`), no son duplicado exacto. 0 filas en ambas. | (b) deliberada pero pendiente de decisión de consolidación — ya señalada, no se repite el análisis aquí |
| `cron` | `job`, `job_run_details` — tablas internas de la extensión `pg_cron`. | No es drift — infraestructura de la extensión, no de la aplicación |

### 5.4 Columnas "solo BD" en modelos que sí existen en Prisma (30 columnas, 10 modelos)

| Modelo | Columnas en BD ausentes de Prisma | Origen | Clasificación |
|---|---|---|---|
| `Drug` | 19 columnas `srs*` (`srsRegistroSanitario`, `srsTitular`, `srsCategoria`, …) | Integración SRS (`135_srs_registro_sanitario.sql`) | (b) deliberada, mencionada en CLAUDE.md §Gotchas pero nunca cerrada — sincronizar `schema.prisma` |
| `Prescription` | `costCenterId` | Beta.18 contabilidad/costos | (b) deliberada, sincronizar |
| `MedicationDispense` | `costCenterId` | ídem | (b) deliberada, sincronizar |
| `ImagingOrder` | `acquiredAt` | — | (b) verificar origen y sincronizar (columna nullable, sin riesgo inmediato) |
| `JournalEntry` | `chainPrevHash`, `chainHash` | Hash chain de auditoría contable, `47_accounting_hardening.sql` §3 (extiende `05_audit_hash_chain.sql`) | (a) deliberada — extensión del patrón de cadena de hash del §Audit hash chain de CLAUDE.md |
| `EceDocumentoInstancia` | `confidencial` | ADR 0020 (contexto ECE gobierna `documento_instancia`) | (a) deliberada y documentada en ADR 0020 |
| `BiomedicalEquipment` | `giai_code`, `gln_ubicacion_actual` | `82_equipment_gs1_extension.sql` | (a) deliberada, en uso vía `as any` en `services-equipment.router.ts:270,300,308` porque el modelo Prisma nunca las declaró — cerrar sincronizando el modelo para eliminar los `as any` |
| `BiomedicalEquipment` | `giaiCode`, `glnUbicacionActual` (camelCase, **duplicadas** de las anteriores) | **Sin archivo SQL en el corpus** — no `82_equipment_gs1_extension.sql` ni ningún otro las crea | (c) accidental — columnas huérfanas, sin uso en código (confirmado por grep), probablemente de un `prisma db push` puntual contra prod que el proyecto luego abandonó a favor de SQL numerado. Candidatas a `DROP COLUMN` tras confirmar 0 dependientes |

### 5.5 Campos "solo Prisma" (ghost fields) — 122 en 41 modelos

Ya cubiertos en detalle: 6 activos y peligrosos en §4.1-4.5, ~110 dormidos
en el patrón sistémico de §4.6 (ver ahí la lista de modelos), 3 modelos
enteros nunca materializados en §5.2. No se repite la enumeración columna por
columna aquí — está en `column_diff.json` generado durante este censo (no
versionado; regenerable con el script de §6).

---

## 6. Cómo mantener esto — propuesta de chequeo automatizable

**No implementado en este PR** (fuera de alcance — @DBA solo escribe el
registro). Propuesta concreta para que @Dev/@SRE lo cablee:

1. **Script `packages/database/scripts/schema-drift-check.mjs`** (Node, sin
   dependencias nuevas — el mismo patrón que usé para este censo):
   - Conecta a la BD con `DIRECT_URL`, en modo solo-lectura
     (`SET default_transaction_read_only = on` a nivel de sesión, no confiar
     solo en permisos de rol).
   - Introspecta `information_schema.tables`/`columns` para `public` + `ece`
     + `audit`.
   - Parsea `schema.prisma` (regex por bloques `model { }`, igual que el
     extractor usado en este censo — no requiere el motor de Prisma).
   - Compara tabla por tabla, columna por columna (usando `@map`/`@@map`
     cuando existen).
   - Sale con **exit code 1** si aparece:
     - una tabla o columna en Prisma que no existe en BD (**bloqueante
       siempre** — esto es exactamente lo que causó los 6 bugs de §4), o
     - una tabla nueva en BD (`public`, no `ece`) que no está ni en Prisma ni
       en la tabla de excepciones documentadas (`docs/45_registro_drift_schema.md`
       §5.1, o un archivo YAML de excepciones que este documento referencie).
   - Para `ece.*`: solo falla en el primer caso (Prisma-sin-columna-real) —
     el segundo caso (tabla nueva solo-BD) es la norma ahí, no se audita
     tabla por tabla.
2. **Wiring en CI:** un job nuevo (o un step dentro de `ci.yml`) que corra el
   script contra un branch de staging de Supabase (no contra prod en cada PR
   — costo/latencia). Alternativa más barata: correrlo **nightly** contra
   prod real (mismo patrón que `compliance.yml`/`backup-drill.yml`), y que
   falle abriendo un issue en vez de bloquear un PR — el drift no aparece por
   PR individual, aparece por acumulación entre releases.
3. **Gate de PR liviano (sin BD):** un lint de `schema.prisma` que impida
   mergear un modelo con un campo `Json?` sin comentario Y sin `@map` cuando
   el nombre del campo es genérico (`data`, `datos`, `payload`) — hubiera
   atajado el patrón de §4.6 en su origen (PR #212).
4. Este documento (`docs/45_registro_drift_schema.md`) es la fuente de
   verdad de las **excepciones aceptadas** (columna "Clasificación" = (a) o
   (b) con justificación) — el script solo debe fallar sobre lo que no está
   aquí, no sobre todo el drift legítimo por diseño.

---

## 7. Próximos pasos priorizados (para @Orq / @Dev)

1. **P0 — los 6 bugs activos de §4.1-4.5.** Cada uno es una corrección de
   una línea en `schema.prisma` (agregar la columna real si existe con otro
   nombre) o una migración SQL de una columna (si de verdad falta, como
   `outlierAlertEnabled`). Ninguno requiere rediseño.
2. **P1 — `AuditDashboardConfig` (§4.4): confirmar si `95_f2_s15_d_audit_rbac.sql`
   se aplicó completo a prod.** Si otras columnas de ese mismo archivo también
   fallaron, el radio de impacto es mayor que una sola columna.
3. **P1 — sincronizar `schema.prisma` con las 30 columnas de §5.4** (bajo
   riesgo, alto valor: elimina los `as any` en `services-equipment.router.ts`
   y cierra el gap de `Drug.srs*` que CLAUDE.md ya señala como pendiente).
4. **P2 — investigar y resolver las 6 tablas de origen desconocido en §5.1**
   (`CatalogoInsumo`, `CatalogoMedicamento`, `OdooSyncLog`, `OdooSyncMapping`,
   `surgical_form_submission`, `offline_sync_log`): documentar origen o
   `DROP` las de 0 filas sin código.
5. **P2 — decidir sobre los 3 modelos `Ece*` nunca materializados (§5.2):**
   eliminarlos de `schema.prisma` si no hay plan de implementarlos, o crear
   la tabla real si sí lo hay.
6. **P3 — el patrón sistémico de §4.6 (~34 modelos):** no es urgente porque
   está dormido, pero es la exposición más grande. Recomendación: en vez de
   corregir campo por campo, marcar esos modelos con un comentario
   `/// ⚠️ shape no verificado — el código usa $queryRaw, no el cliente
   tipado; ver docs/45_registro_drift_schema.md §4.6` hasta que se
   resincronicen de a uno según se vayan tocando esos routers.
7. **P3 — implementar el chequeo automatizable de §6** para que R09 no se
   vuelva a abrir.
