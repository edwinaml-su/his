# PREOP — Valoración Preoperatoria (Lista de Verificación Preoperatoria)

## Metadata

- **codigo**: `PREOP_CHECK` (catálogo `ece.tipo_documento`; alta inicial en `packages/database/sql/67_preop_checklist.sql` líneas 81–91).
- **nombre**: Lista de Verificación Preoperatoria — incluye valoración pre-anestésica con clasificación ASA, ayuno verificado, alergias, marcación de sitio y prerrequisitos NTEC del acto quirúrgico.
- **modalidad**: `QUIRURGICO` (seed: `hospitalario` — `tabla_datos = 'ece.preop_checklist'`, `modalidad = 'hospitalario'`). El TDR §13.2 trata "Pre-operatorio" como bloque del módulo Salas de Operaciones (TDR §13). En la práctica también aplica a quirúrgico ambulatorio (cirugía menor con sedación) — el seed actual no lo discrimina, queda subsumido en `hospitalario`.
- **NTEC artículo**: **Art. 28 NTEC** — Lista de Verificación Preoperatoria (Acuerdo n.° 1616 MINSAL, D.O. T.444 N°158, 30/05/2024; reforma D.O. n.°55 T.450, 19/03/2026). Referencias adicionales: Art. 23 lit. a.4 (firma electrónica simple por documento clínico), Art. 39 (consentimiento informado — dependencia bloqueante de PREOP en la práctica clínica), Art. 40 (inmutabilidad post-firma), Arts. 55–56 (metadatos obligatorios y retención 10 años). Norma base referenciada en `67_preop_checklist.sql` línea 4 y en `COMMENT ON TABLE` línea 71.
- **modulo_his_target**: `/ece/cirugia/preop` (listado) + `/ece/cirugia/preop/nueva` (creación) + `/ece/cirugia/preop/[id]` (detalle con firma PIN). **Ruta real en código**: `apps/web/src/app/(clinical)/ece/quirofano/preop/` — el path del briefing menciona `/ece/cirugia/preop` pero el árbol implementado es `/ece/quirofano/preop`. PENDIENTE — validar con @UIUX si se renombra a `/ece/cirugia/preop` o se mantiene `/ece/quirofano/preop` (decisión cosmética; mantener una sola convención para el módulo de salas).
- **tabla_datos**: `ece.preop_checklist` (Prisma `EcePreopChecklist` — `packages/database/prisma/schema.prisma` líneas 5582–5593). DDL real en `67_preop_checklist.sql` líneas 18–52.
- **inmutable**: `true` post-firma del MC anestesiólogo. Hace cumplir el trigger `ece.preop_checklist_immutable` (función en `67_preop_checklist.sql` líneas 152–166, trigger líneas 168–173) — cualquier UPDATE sobre columnas clínicas con `firmado_en IS NOT NULL` lanza excepción `restrict_violation` con texto explícito referenciando Art. 28 NTEC. El seed del catálogo declara `inmutable = true` (línea 88).
- **tipo_registro**: `OBLIGATORIO` para todo acto quirúrgico programado (electivo y urgente). Clasificación NTEC: `transaccional` en seed `67_preop_checklist.sql` línea 86 — discrepancia con el patrón de docs inmutables (CONS_INF, ACTO_QX, EPICRISIS, CERT_DEF usan `historico`). Ver §Drift conocido §5.

---

## Propósito normativo

El **Art. 28 NTEC** exige una **lista de verificación preoperatoria** firmada antes de iniciar cualquier acto quirúrgico, como mecanismo de seguridad clínica que asegura que (a) el paciente ha cumplido ayuno, (b) las alergias y medicación crónica (anticoagulantes, marcapasos, prótesis) están registradas y mitigadas, (c) el sitio quirúrgico está correctamente identificado y marcado, (d) el consentimiento informado quirúrgico (`CONS_INF` subtipo `CONS_QX`) está firmado, y (e) el riesgo anestésico (clasificación **ASA I–V**) ha sido evaluado y registrado por el médico anestesiólogo responsable.

La PREOP **complementa** —y no sustituye— al WHO Surgical Safety Checklist (`WHO_CHK`): la PREOP es la valoración **pre-fecha / pre-traslado al área quirúrgica** que ocurre en consulta pre-anestésica o en sala (NTEC + buena práctica nacional MINSAL), mientras que el WHO checklist son las **tres pausas intraoperatorias** (sign-in / time-out / sign-out — OMS 2009, ver `WHO_CHECK.md`). El TDR §13.2 separa explícitamente "Pre-operatorio" (TDR §13.2) de "Lista de Verificación de Cirugía Segura OMS" (TDR §13.3).

Cubre el riesgo médico-legal de eventos adversos pre-evitables: cancelación quirúrgica por ayuno incumplido, anestesia general con anticoagulación no suspendida, cirugía en sitio incorrecto (wrong-site surgery), reacción alérgica medicamentosa por alergia no registrada, y descompensación intra-operatoria por ASA sub-clasificado. La firma del **médico anestesiólogo** sobre la PREOP es la garantía formal de que el paciente está **apto para anestesia** y que el equipo quirúrgico ha verificado los prerrequisitos NTEC.

---

## Dependencias (depende_de)

Documentos que DEBEN existir y estar firmados antes de crear / firmar este:

- **`FICHA_ID`** (Ficha de Identificación del paciente) — raíz del expediente. Implícito vía el episodio.
- **`HIST_CLIN`** (Historia Clínica) — la valoración pre-anestésica integra antecedentes patológicos personales y familiares de la HC. En urgencia abreviada admite HC abreviada o "Hoja de Atención de Emergencia" (`ATN_EMERG`).
- **`HOJA_ING`** (Hoja de Ingreso) — episodio hospitalario abierto. El INSERT en `preop_checklist` requiere `episodio_hospitalario_id NOT NULL` (DDL línea 26–27), por lo tanto sin episodio hospitalario abierto el motor falla.
- **`CONS_INF`** subtipo `CONS_QX` (Consentimiento Informado Quirúrgico — Art. 39 NTEC) — **debe** estar firmado **antes** de que el equipo traslade al paciente al área quirúrgica. La columna `consentimiento_firmado BOOLEAN` (DDL línea 39) **es el reflejo en la PREOP de la firma del `CONS_INF`** — la PREOP no firma el consentimiento, lo verifica.
- **Programación de cirugía** (`PROG_QX` o equivalente — `ece.orden_ingreso` + `ece.reserva_sala_qx` creadas por `eceBridgeCirugiaRouter.programarCirugia`) — el bridge crea la `preop_checklist` **automáticamente** como parte de la transacción de programación (paso 5 del bridge, `bridge-cirugia.router.ts` líneas 338–393). El briefing menciona `PROG_QX` como código de dependencia; el catálogo actual no tiene un `tipo_documento` con código `PROG_QX` — la programación se materializa como tablas operativas (`orden_ingreso`, `reserva_sala_qx`), no como tipo de documento NTEC. PENDIENTE — validar con @AS si se introduce `PROG_QX` como tipo de documento formal.

Recomendados (no bloqueantes):

- `SOL_EST` / `RES_EST` — exámenes pre-operatorios solicitados y resultados disponibles: hemograma completo, pruebas de coagulación, glicemia, creatinina, EKG si ≥40 años o cardiopatía conocida, Rx tórax si patología pulmonar (TDR §13.2 "Lista de exámenes pre-operatorios completos"). La PREOP no obliga FK a `RES_EST` en BD — la verificación es funcional (cumplimiento del checklist), no estructural.
- `IND_MED` previas relevantes — anticoagulación crónica, antiagregantes, hipoglicemiantes orales, antihipertensivos. La columna `anticoagulantes BOOLEAN` (DDL línea 35) captura la presencia de tratamiento anticoagulante crónico.

---

## Obligatoriedad

| Contexto | ¿Obligatorio? | Norma de referencia |
|---|---|---|
| QUIRURGICO electivo programado | **SI siempre** (Art. 28 NTEC bloqueante; sin PREOP firmada el acto quirúrgico no se autoriza) | NTEC Art. 28 + TDR §13.2 |
| QUIRURGICO urgente | **SI con documentación abreviada** (en urgencia vital el equipo registra valoración mínima ASA + ayuno conocido + alergias conocidas + consentimiento de urgencia documentado; el resto se rellena post-acto si procede) | NTEC Art. 28 — práctica clínica admitida en urgencia |
| QUIRURGICO ambulatorio menor con sedación | **SI** (TDR §13.5 "Recuperación Post-Anestésica" supone valoración pre-anestésica previa) | NTEC Art. 28 + TDR §13.2 |
| Procedimiento ambulatorio sin anestesia/sedación | **NO** (no requiere valoración anestésica formal; solo `CONS_INF` cuando aplique) | — |
| Cesárea y obstetricia quirúrgica | **SI** (cesárea es acto quirúrgico — aplica Art. 28; en obstétrico de urgencia, abreviada) | NTEC Art. 28 + TDR §17 Obstetricia |
| Reintervención inmediata (re-laparotomía urgente) | **SI con documentación abreviada** (queda registro de continuidad del acto previo + reevaluación ASA al momento) | Buena práctica nacional |

> El catálogo actual sembra `modalidad = 'hospitalario'`; quirúrgico ambulatorio queda subsumido. PENDIENTE — evaluar si se desdobla a `modalidad = 'quirurgico'` cuando se introduzca un enum dedicado para tipo de modalidad.

---

## Roles firmantes

| Rol | Acción | Momento | Mecanismo |
|---|---|---|---|
| **ANESTESIOLOGO** (rol `MC` o `ESP` según especialidad — anestesiología generalmente `ESP`) | **Valoración ASA + verificación de checklist + FIRMA** (firma electrónica simple con PIN) | Pre-fecha (consulta pre-anestésica) o pre-acto inmediato (urgencia) | **PIN argon2id** contra `ece.firma_electronica` — lockout 5 intentos; lockwall en el router `eceCirugiaPreop.firmar` |
| **MEDICO_TRATANTE / CIRUJANO** (rol `MC` o `ESP`) | Llena historia + indica procedimiento + verifica sitio marcado | Pre-fecha / al programar la cirugía | Llenado del checklist; el `bridge-cirugia` crea el borrador con `registrado_por = cirujano` (paso 5c del bridge) |
| **ENFERMERIA_QUIROFANO / CIRCULANTE** (rol `ENF`) | Apoyo en verificación material (ayuno, retiro de prótesis, marcaje sitio, etiquetado paciente) | Pre-traslado a sala | Sin firma electrónica formal — registro de tareas en la columna correspondiente (`retiro_protesis`, `identificacion_paciente_verificada`) |
| **DIR** (Dirección del establecimiento) | Validación (transición universal `firmado → validado` cuando aplique) | Post-firma del anestesiólogo | Sin PIN |

> El seed `63_ece_08_seed.sql` no tiene bloque específico de roles para `PREOP_CHECK` — la asignación efectiva de roles depende del seed del catálogo de la versión sembrada. PENDIENTE — verificar que el seed actualizado introduzca filas en `ece.documento_rol` para `PREOP_CHECK` con: `ANESTESIOLOGO` (alias del rol `MC` o `ESP`) como `LLENA + RESPONSABLE + FIRMA`, `CIRUJANO` como `LLENA`, `ENF` como `LLENA` (sin FIRMA).

---

## Campos obligatorios

Mapeados a columnas de `ece.preop_checklist` (DDL `67_preop_checklist.sql` líneas 18–52):

### Ítems clínicos del checklist (NTEC Art. 28 mínimo)

- `ayuno_horas` — `SMALLINT CHECK (BETWEEN 0 AND 24)`. Horas confirmadas de ayuno al momento de la valoración. **Buena práctica**: **8 horas para sólidos**, **6 horas para lácteos y comida ligera**, **2 horas para líquidos claros** (no leche). El CHECK admite 0–24 pero la validación de criterio (8h sólidos / 2h líquidos) es responsabilidad de la UI / contrato Zod, no del CHECK constraint.
- `marcapasos` — `BOOLEAN`. Portador de marcapasos / dispositivo cardíaco implantado (afecta uso de electrobisturí monopolar y RM).
- `alergias` — `TEXT`. Alergias medicamentosas conocidas (especialmente antibióticos, AINE, látex, contraste yodado, anestésicos locales y bloqueadores neuromusculares).
- `anticoagulantes` — `BOOLEAN`. Tratamiento anticoagulante crónico activo (warfarina, DOAC, heparinas, antiagregantes plaquetarios) — gatilla protocolo de suspensión/puenteo.
- `retiro_protesis` — `BOOLEAN`. Confirmación de retiro de prótesis dentales, lentes de contacto, joyas, esmalte, audífonos. Necesario para intubación segura y monitoreo de SpO₂.
- `identificacion_paciente_verificada` — `BOOLEAN`. Verificación activa de identidad (brazalete + nombre + fecha de nacimiento). Reduce error de paciente equivocado.
- `sitio_marcado` — `BOOLEAN`. Marcaje físico del sitio quirúrgico **por el cirujano**, con marcador indeleble y con el paciente despierto/consciente. Estándar de seguridad — wrong-site surgery prevention (TDR §13.2 "Marcaje del sitio quirúrgico").
- `consentimiento_firmado` — `BOOLEAN`. **Reflejo** de que el `CONS_INF` subtipo `CONS_QX` está firmado por paciente + cirujano (doble firma Art. 39). No es la firma misma, es la verificación.
- `riesgo_anestesico_asa` — `SMALLINT CHECK (BETWEEN 1 AND 5)`. **Clasificación ASA de la American Society of Anesthesiologists** — escala estandarizada de riesgo anestésico:
    - **I**: paciente sano, sin enfermedad sistémica.
    - **II**: enfermedad sistémica leve (HTA controlada, DM2 sin lesión de órgano blanco, tabaquismo).
    - **III**: enfermedad sistémica grave que limita actividad pero no incapacitante (DM2 con lesión, IAM/ACV > 3 meses, EPOC moderado).
    - **IV**: enfermedad sistémica grave con amenaza constante para la vida (IAM/ACV reciente, sepsis, insuficiencia cardíaca aguda).
    - **V**: paciente moribundo que no se espera sobreviva ≥24h con o sin cirugía.
    - El briefing menciona `(I|II|III|IV|V|VI)` — **ASA VI** (paciente con muerte cerebral declarada para procuración de órganos) **no está en el CHECK actual** (`BETWEEN 1 AND 5`). PENDIENTE — validar con @AE/@DBA si se amplía el CHECK a 1–6 cuando aplique procuración (caso ASA E — emergencia — tampoco se modela como dígito separado en BD; se documenta en `alergias` o en `analisis` clínico).
- `via_aerea_evaluacion` — **AUSENTE en BD**. El briefing pide capturar Mallampati I–IV y distancia tiromentoniana. La DDL actual **no tiene columna específica**; queda como observación clínica libre dentro del flujo o se subsume en `alergias`/notas. PENDIENTE — agregar columna `via_aerea_evaluacion JSONB` con `{ mallampati: 'I'|'II'|'III'|'IV', tiromentoniana_cm: number, dificultad_prevista: boolean }`.
- `examenes_solicitados` — **AUSENTE en BD**. El briefing pide link a `RES_EST` (hemograma, química, EKG si ≥40 años). La DDL actual no tiene FK ni JSONB de exámenes. PENDIENTE — agregar columna `examenes_solicitados JSONB` con array de `solicitud_estudio_id` y `resultado_estudio_id` referenciados, o documentar como FK 1:N en tabla auxiliar.
- `patologias_previas_relevantes` — **AUSENTE en BD**. Idem; la valoración pre-anestésica registra HTA, DM, EPOC, cardiopatía, hepatopatía, nefropatía. PENDIENTE — agregar campo o subsumir en HC referenciada (`HIST_CLIN`).
- `premedicacion_indicada` — **AUSENTE en BD**. El briefing la pide; sin columna específica hoy. PENDIENTE.
- `consentimiento_anestesia_explicado` — **AUSENTE como columna distinta de `consentimiento_firmado`**. En sistemas NTEC más maduros se separa consentimiento quirúrgico de consentimiento anestésico (Art. 39 admite ambos como independientes); el modelo actual los unifica. PENDIENTE — separar en `consentimiento_qx_firmado` y `consentimiento_anestesico_firmado` si la NTEC lo exige independientemente.

### Trazabilidad y workflow

- `id` — uuid PK (gen_random_uuid).
- `instancia_id` — uuid NOT NULL FK a `ece.documento_instancia(id)`. **Crítico**: el bridge crea la instancia antes del INSERT a `preop_checklist` (HE-11 corrigió: ver §Drift). Hace cumplir el motor de workflow ECE.
- `episodio_hospitalario_id` — uuid NOT NULL FK a `ece.episodio_hospitalario(episodio_id)`. Vincula la PREOP al episodio hospitalario que la programación quirúrgica abrió.
- `estado_registro` — `TEXT NOT NULL DEFAULT 'vigente' CHECK IN ('vigente','rectificado')`. Estado de **versión del registro** (vigente vs rectificado por adendum/rectificación Art. 42), **no** el estado del workflow ECE. El estado del workflow vive en `documento_instancia.estado_actual_id`.
- `firmado_por` — uuid FK `ece.personal_salud(id)` (nullable hasta firma). Anestesiólogo que firmó.
- `firmado_en` — timestamptz (nullable hasta firma). Marca temporal de la firma; **gatilla la inmutabilidad** del trigger (línea 158: `IF OLD.firmado_en IS NOT NULL THEN RAISE EXCEPTION`).
- `registrado_por` — uuid NOT NULL FK `ece.personal_salud(id)`. Quién creó el borrador (típicamente el cirujano al programar via bridge, o el anestesiólogo al iniciar la valoración).
- `registrado_en` — timestamptz NOT NULL DEFAULT now(). Metadato obligatorio Art. 55 — nivel segundo.

### Firma electrónica (Art. 23 lit. a.4)

La firma del anestesiólogo se materializa en dos cosas:
- Registro en `ece.firma_electronica` (referenciada por `documento_instancia_historial.firma_id` en la transición `firmar`).
- Setear `firmado_por` + `firmado_en` en la fila de `preop_checklist`.

El router `eceCirugiaPreop.firmar` (referenciado en audit HE-11 y `apps/web/src/app/(clinical)/ece/quirofano/preop/[id]/page.tsx:55–64`) valida PIN con argon2id antes de hacer ambas cosas en una sola transacción.

### Campos de contingencia (F2-S15 Stream A — registro retroactivo en papel)

No están presentes hoy en `ece.preop_checklist` (la DDL del archivo `67_preop_checklist.sql` no incluye `digitado_retroactivamente`, `timestamp_real_papel`, `contingencia_evento_id`). PENDIENTE — agregar coherentemente con `historia_clinica` y `evolucion_medica` si la PREOP también debe poder digitarse retroactivamente en contingencia (caída del sistema, cirugía de emergencia con expediente en papel).

---

## Estados (flujo_estado)

Sembrados por el bloque DO de `63_ece_08_seed.sql` (líneas 122–) que itera sobre todo `tipo_documento` y aplica el patrón base + variantes según `inmutable` y `necesita_certificacion`.

`PREOP_CHECK` es **inmutable** (`inmutable=true` en seed `67_preop_checklist.sql` línea 88) — por la regla del seed (líneas 119–120: *"Docs inmutables (CONS_INF, ACTO_QX, EPICRISIS, CERT_DEF, DOC_OBST): omiten el estado 'en_revision' ya que no admiten edición post-firma"*) el flujo es:

```
borrador  (inicial)
   │
   │ (anestesiólogo ejecuta 'firmar' con PIN argon2id)
   ▼
firmado   ← INMUTABLE post-firma (Art. 28 + Art. 40 NTEC; trigger trg_preop_immutable enforce)
   │
   │ (DIR ejecuta 'validar' — opcional, no certificación)
   ▼
validado  (final)

# Rama universal
borrador → anulado (DIR ejecuta 'anular' con firma)
```

> `PREOP_CHECK` **no requiere certificación** de Dirección (no está en la lista `FICHA_ID | EPICRISIS | CERT_DEF` del seed línea 132). El estado terminal es `validado`. En la práctica, muchos establecimientos validan automáticamente con la firma del anestesiólogo (el equipo de QA puede mapear `firmado` como el estado de "listo para acto quirúrgico").

> El documento `ece.preop_checklist` tiene **dos estados separados** que pueden des-sincronizarse:
> 1. `documento_instancia.estado_actual_id` (gobernado por el motor de workflow ECE — `borrador | firmado | validado | anulado`).
> 2. `preop_checklist.estado_registro` (gobernado por la columna nativa — `vigente | rectificado`).
>
> Son ortogonales: `estado_registro` indica versión (Art. 42 rectificación trazable), no el avance de firma. Una PREOP firmada y validada puede pasar a `estado_registro = 'rectificado'` si se emite una versión nueva por adendum.

---

## Transiciones (flujo_transicion)

Las transiciones específicas para `PREOP_CHECK` no se ven explícitamente en el extracto sembrado de `63_ece_08_seed.sql` (el archivo siembra explícitamente `EVOL_MED`, `ACTO_QX`, etc.). Por el patrón sembrado para documentos inmutables (Art. 28 + Art. 40), las transiciones esperadas son:

| origen | destino | acción | rol_autoriza | requiere_firma | condición funcional |
|---|---|---|---|---|---|
| `borrador` | `firmado` | `firmar` | **ANESTESIOLOGO** (rol `MC` o `ESP`) | **SI** (PIN argon2id) | Checklist completo con ASA registrado (`riesgo_anestesico_asa NOT NULL`), ayuno verificado, consentimiento_firmado=true, sitio_marcado=true |
| `firmado` | `validado` | `validar` | **DIR** | NO | Transición universal post-firma; opcional |
| `borrador` | `anulado` | `anular` | **DIR** | SI | Transición universal — anulación con causa documentada |

Transiciones bloqueadas (no sembradas y enforced por trigger):

- `firmado → borrador` — rollback post-firma **prohibido** por el trigger `trg_preop_immutable` (DDL línea 168–173).
- `firmado → en_revision` — no existe estado `en_revision` para docs inmutables (regla seed línea 119–120).
- `validado → *` — terminal salvo anulación administrativa con autorización DIR.

PENDIENTE — verificar que el seed actualizado introduzca explícitamente las filas `('PREOP_CHECK', 'firmar', 'borrador', 'firmado', 'MC' o 'ESP', true)` y `('PREOP_CHECK', 'validar', 'firmado', 'validado', 'DIR', false)` en `ece.flujo_transicion`. Si no están sembradas, el router `eceCirugiaPreop.firmar` no podrá ejecutar la transición vía el motor (caería en branch de fallback).

---

## Eventos de dominio

Convención: `ece.<codigo_documento_minuscula>.<accion>`. Payload obligatorio incluye `organization_id`, `establishment_id`, `paciente_id`, `episodio_hospitalario_id`, `instancia_id`, `actor_id`, `timestamp`.

- **`ece.preop.creado`** — emitido **implícitamente** por el bridge `eceBridgeCirugiaRouter.programarCirugia` paso 5 + 8 (evento de dominio `ece.cirugia.programada` que incluye `preOpId` en el payload — ver `bridge-cirugia.router.ts:442–463`). PENDIENTE — decidir si se emite también un evento granular `ece.preop_check.creado` independiente del evento agregado `ece.cirugia.programada`, o se subsume.
- **`ece.preop.firmada`** — equivalente a `workflow.transitionExecuted` con `tipoDocumentoCodigo='PREOP_CHECK'` y `accion='firmar'`. Payload: `{ instanceId, fromStateId, toStateId: 'firmado', accion: 'firmar', byUserId: anestesiologoId, firmaId, asa: number, episodioHospitalarioId, timestamp }`.
- **`ece.preop.validada`** — `workflow.transitionExecuted` con `accion='validar'`. Payload similar con `toStateId: 'validado'`.
- **`ece.preop.anulada`** — `workflow.transitionExecuted` con `accion='anular'`. Payload incluye `motivo` y `autorizado_por_dir_id`.
- **`ece.preop.rectificada`** — Art. 42 NTEC: emisión de versión nueva (`estado_registro = 'rectificado'` en el original + INSERT de una nueva fila vigente). PENDIENTE — modelar y verificar emisión vía outbox.

> Los eventos se emiten vía `emitDomainEvent(tx, {...})` dentro del callback de `withWorkflowContext` (patrón canónico del proyecto). El módulo `eceWhoChecklistRouter` violó este patrón con un `emitOutbox` local — la PREOP debe mantenerse fiel al `emitDomainEvent` canónico (audit HE-15 / HE-16 advierten sobre el riesgo de variantes locales).

---

## Drift conocido (audit)

### 1. HE-11 — P0 BLOQUEANTE corregido en S4 — Bridge insertaba en columnas inexistentes

**Origen**: `docs/audit/2026-05-19_audit_stream_e_quirofano.md` líneas 257–265.

El bridge `bridge-cirugia.router.ts:339-360` insertaba en `ece.preop_checklist` usando columnas inexistentes: `orden_id`, `episodio_id`, `paciente_id`, `estado`, `creado_por`, `creado_en`. La tabla real tiene `instancia_id`, `episodio_hospitalario_id`, `registrado_por`, `registrado_en`. El INSERT fallaba con `42703: column "orden_id" of relation "preop_checklist" does not exist` causando rollback total de la programación quirúrgica.

**Corregido en S4** (líneas 338–393 de `bridge-cirugia.router.ts`): el bridge ahora:
1. Resuelve el tipo de documento `PREOP_CHECK` y su estado inicial (paso 5a).
2. Crea `documento_instancia` con `(tipo_documento_id, episodio_id, paciente_id, estado_actual_id, creado_por)` (paso 5b).
3. Inserta en `preop_checklist` con columnas reales: `(instancia_id, episodio_hospitalario_id, registrado_por)` (paso 5c).

**Riesgo residual**: PENDIENTE — verificar que la corrección incluyó también los tests del router (`packages/trpc/src/routers/ece/__tests__/bridge-cirugia.router.test.ts`) cubriendo el flujo end-to-end. El audit HE-14 advierte que los tests del router `preop-checklist` solo validan schemas Zod, no comportamiento del router.

### 2. HE-12 — P1 ALTO — RLS INSERT sin `WITH CHECK`

**Origen**: `docs/audit/2026-05-19_audit_stream_e_quirofano.md` líneas 267–272.

La política `preop_insert_by_estab` tiene `cmd=INSERT` y `qual=null`. En PostgreSQL, `qual=null` para INSERT significa que **no hay restricción `WITH CHECK`** — cualquier fila puede insertarse independientemente del establecimiento. El SQL DDL `67_preop_checklist.sql` líneas 116–129 muestra la policy correcta en código, pero la BD en producción tenía la policy sin `WITH CHECK`.

**Pendiente**: verificar que se haya re-aplicado la DDL con `apply_migration` o se haya emitido un migration de corrección (`ALTER POLICY` o `DROP/CREATE`).

**Riesgo go-live**: un usuario autenticado de establecimiento A podría insertar una PREOP referenciando un `episodio_hospitalario` de establecimiento B.

### 3. HE-13 — P1 ALTO — `episodio_hospitalario_id` confundido con `episodio_atencion.id` en `documento_instancia`

**Origen**: `docs/audit/2026-05-19_audit_stream_e_quirofano.md` líneas 274–283.

En `preop-checklist.router.ts:413-420`, el INSERT a `ece.documento_instancia.episodio_id` usa `input.episodioHospitalarioId`. Pero `documento_instancia.episodio_id` es FK a `ece.episodio_atencion.id`, no a `ece.episodio_hospitalario.id`. Aunque `episodio_hospitalario.episodio_id` (la PK del hospitalario) referencia al atencion, son IDs distintos en general.

**Pendiente**: verificar que el router resuelva el `episodio_atencion.id` correcto a partir del `episodio_hospitalario_id` antes de insertar en `documento_instancia`. La recomendación del audit es hacer `SELECT episodio_id FROM ece.episodio_hospitalario WHERE episodio_id = $1` para obtener el ID del atencion.

### 4. HE-14 — P2 MEDIO — Tests del router solo validan schemas

**Origen**: `docs/audit/2026-05-19_audit_stream_e_quirofano.md` líneas 285–290.

`preop-checklist.router.test.ts` solo tiene tests de schemas Zod definidos localmente en el propio test (no importados del router). No cubre comportamiento del router en CREATE, UPDATE post-firma, firmar, ni casos de error (episodio no encontrado, tipo no configurado, PIN incorrecto).

**Pendiente**: añadir tests con `mockDeep<PrismaClient>()` para los 4 flujos principales + casos de error. Es el módulo con mayor complejidad transaccional del Stream E.

### 5. `tipo_registro = 'transaccional'` para documento inmutable

El seed (`67_preop_checklist.sql` línea 86) declara `tipo_registro = 'transaccional'`, pero `inmutable = true` (línea 88). En la convención NTEC, documentos inmutables (`CONS_INF`, `ACTO_QX`, `EPICRISIS`, `CERT_DEF`, `DOC_OBST`) son `tipo_registro = 'historico'`. La discrepancia puede ser intencional (la PREOP no es un documento histórico clínico estricto, sino un checklist operativo del acto), pero rompe el patrón.

**Pendiente**: PENDIENTE — validar con @AE / @PO si se ajusta `PREOP_CHECK` a `historico` para consistencia, o si se documenta explícitamente el patrón "checklist operativo inmutable" como categoría distinta.

### 6. Campos del briefing **no presentes en BD**

Listados en `Campos obligatorios` arriba: `via_aerea_evaluacion`, `examenes_solicitados`, `patologias_previas_relevantes`, `premedicacion_indicada`, `consentimiento_anestesia_explicado` (separado de `consentimiento_firmado`). El DDL `67_preop_checklist.sql` cubre el mínimo del Art. 28 NTEC pero no los campos extendidos que TDR §13.2 y buena práctica anestesiológica exigen.

**Pendiente**: priorizar con @AS / @DBA cuáles agregar como columnas nativas y cuáles modelar como JSONB.

### 7. ASA VI no soportado en CHECK constraint

El `CHECK (riesgo_anestesico_asa BETWEEN 1 AND 5)` (línea 40) excluye ASA VI (paciente con muerte cerebral declarada para procuración de órganos). Aunque ASA VI es raro en sistemas no especializados en trasplante, formalmente la escala ASA tiene 6 grados. Para hospitales que hacen procuración, esto es bloqueante.

**Pendiente**: validar con @AE si el complejo hospitalario AVANTE requiere ASA VI (alcance del proyecto incluye trasplante / procuración?). Si sí, `ALTER TABLE ... DROP CONSTRAINT ... ADD CONSTRAINT ... CHECK (... BETWEEN 1 AND 6)`. Idem para ASA modificador `E` (emergencia) — se modela como booleano separado, no como dígito.

### 8. Path UI `/ece/cirugia/preop` vs `/ece/quirofano/preop`

El briefing menciona `/ece/cirugia/preop`. El árbol real implementado es `apps/web/src/app/(clinical)/ece/quirofano/preop/`. Idem para WHO. PENDIENTE — decidir nomenclatura única (cirugía vs quirófano) y unificar sidebar + rutas + tests E2E.

---

## Descripción markdown rica

La **Lista de Verificación Preoperatoria (PREOP_CHECK)** es el documento clínico que certifica que un paciente está apto para ser sometido a un acto quirúrgico bajo anestesia, conforme al **Art. 28 de la Norma Técnica del Expediente Clínico Electrónico** (Acuerdo n.° 1616 MINSAL, El Salvador). Su firma es un **bloqueo formal**: sin PREOP firmada por anestesiólogo, el acto quirúrgico (`ACTO_QX`) no se autoriza y la cirugía no debe iniciarse. La PREOP es la valoración **pre-fecha o pre-traslado** del paciente al área quirúrgica — distinta y complementaria del **WHO Surgical Safety Checklist** (`WHO_CHK`), que son las tres pausas intraoperatorias dentro de sala (sign-in / time-out / sign-out, OMS 2009).

El núcleo clínico es la **clasificación ASA** (American Society of Anesthesiologists, escala I–V que ordena el riesgo anestésico según el estado físico basal del paciente; ASA VI existe para procuración pero no está soportada en el CHECK constraint actual del HIS — ver Drift §7). De la ASA se derivan decisiones críticas: tipo de anestesia, técnica de inducción, monitoreo invasivo intraoperatorio, requerimiento de UCI post-operatoria, autorización quirúrgica condicionada (ASA III/IV/V pueden requerir comité o consulta interdisciplinaria pre-acto). Además de la ASA, la PREOP verifica el cumplimiento de ítems críticos NTEC: **ayuno** (8h sólidos / 2h líquidos — el incumplimiento es causa común de cancelación quirúrgica por riesgo de broncoaspiración), **alergias medicamentosas** conocidas (antibióticos, AINE, látex, contraste yodado, anestésicos), **anticoagulación crónica** (warfarina, DOAC, antiagregantes — gatilla protocolo de suspensión o puenteo), **marcaje del sitio quirúrgico** por el cirujano con paciente despierto (prevención wrong-site surgery), **identificación activa del paciente** (brazalete + dos identificadores), **retiro de prótesis** (dentales, lentes, audífonos, joyas), y la **verificación de que el consentimiento informado quirúrgico** (`CONS_INF` subtipo `CONS_QX`) ya está firmado con doble firma paciente+cirujano (Art. 39 NTEC).

**Post-firma del anestesiólogo, la PREOP es estrictamente inmutable** por Art. 28 + Art. 40 NTEC, hecho cumplir por el trigger PostgreSQL `trg_preop_immutable`: cualquier UPDATE sobre columnas clínicas con `firmado_en IS NOT NULL` lanza excepción `restrict_violation` referenciando explícitamente el artículo. Correcciones admisibles son únicamente: (a) **adendum** — nuevo documento PREOP vinculado al original con la corrección clínica, sin mutar el original; (b) **rectificación trazable** (Art. 42 NTEC) marcando `estado_registro = 'rectificado'` en el original y emitiendo una fila nueva vigente, con registro completo en `documento_instancia_historial` (append-only, ≥2 años retención + 10 años total). La revocación post-firma no aplica — una vez firmada, la PREOP queda como evidencia del estado preoperatorio del paciente al momento de la valoración, aun si la cirugía se cancela; en ese caso el flujo terminal alternativo es `anulado` con autorización DIR, registrando la causa de cancelación.

La PREOP **no sustituye** la valoración intra-operatoria continua del anestesiólogo (registro anestésico `REG_ANEST` durante el acto) ni el WHO checklist (`WHO_CHK` — tres pausas dentro de sala). La cadena documental quirúrgica completa es: `HOJA_ING` (admisión hospitalaria) → `CONS_INF + CONS_QX` (doble firma paciente+cirujano) → `PREOP_CHECK` (anestesiólogo apto) → `WHO_CHK Sign-In` (pre-anestesia, dentro de sala) → `WHO_CHK Time-Out` (pre-incisión) → `ACTO_QX` (descripción operatoria firmada por cirujano) + `REG_ANEST` (transanestésico firmado por anestesiólogo) → `WHO_CHK Sign-Out` (post-cierre) → `URPA` (recuperación post-anestésica) → `NOTA_OP` (reporte operatorio en máximo 24h) → `EPICRISIS` (egreso). La PREOP es el primer bloqueante de esa cadena.

**Errores comunes a evitar**:
- Firmar la PREOP sin haber verificado el sitio marcado (la verificación es del cirujano, no del anestesiólogo — pero el anestesiólogo no firma si el ítem no está confirmado).
- Asignar ASA II a un paciente con HTA mal controlada o DM2 con lesión de órgano blanco (corresponde ASA III).
- Olvidar registrar anticoagulación crónica activa — gatilla suspensión 5–7 días pre-acto (warfarina) o puenteo con heparina; sin registro, el riesgo de sangrado intraoperatorio aumenta drásticamente.
- Firmar la PREOP cuando el `CONS_INF` aún no está firmado — orden inverso al normativo (Art. 39 + Art. 28).
- Capturar el ayuno en horas exactas sin distinguir sólidos vs líquidos — el riesgo anestésico es función del tipo de ingesta, no solo del tiempo total.
- Editar la PREOP firmada en lugar de emitir adendum o rectificación trazable (Art. 42).
- Confundir el path UI: en este HIS el árbol real es `/ece/quirofano/preop` aunque el briefing y algunas docs mencionan `/ece/cirugia/preop` — verificar con CLAUDE.md §"Adecuar legacy vs duplicar" antes de crear una segunda ruta.
