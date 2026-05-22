# CONS_QX — Consentimiento Quirúrgico

## Metadata

- **codigo**: `CONS_QX`
- **nombre**: Consentimiento Informado Quirúrgico (con anexo anestésico).
- **modalidad**: `QUIRURGICO` (cirugía mayor electiva y de urgencia; cirugía menor con sedación; cirugía ambulatoria mayor — TDR §13, NTEC §3.13 "Documentos del Acto Quirúrgico"). No aplica fuera de contexto quirúrgico — para hospitalización sin cirugía usar `CONS_INF` subtipo `HOSPITALIZACION`; para acto anestésico independiente usar `CONS_INF` subtipo `ANESTESICO`.
- **NTEC artículo**: **Art. 39 NTEC** (doble firma — paciente/representante + médico cirujano informante), **Art. 40 NTEC** (inmutabilidad post-firma). Acuerdo n.° 1616 MINSAL (D.O. T.444 N°158, 22/08/2024; reforma D.O. n.°55 T.450, 19/03/2026). Anexo anestésico responde a la misma base normativa (Art. 39) + TDR §13.2 "Consentimiento informado quirúrgico y anestésico".
- **modulo_his_target**: `/ece/consentimiento` (listado con filtro `tipo=QUIRURGICO`) + `/ece/consentimiento/nuevo` (wizard 3 pasos, opción "Quirúrgico" en step 1) + `/ece/consentimiento/[id]` (detalle).
- **tabla_datos**: `ece.consentimiento_informado` (cabecera con `tipo='quirurgico'`) **+** `ece.consentimiento_quirurgico` (tabla satélite 1:1 vía `consentimiento_id`, archivo `99_consentimiento_quirurgico.sql`).
- **inmutable**: `true` post-firma del MC. Trigger `ece.fn_bloquea_mutacion_consentimiento` (archivo `99_consentimiento_doble_firma_workflow.sql`) bloquea UPDATE/DELETE cuando `estado IN ('firmado','revocado')` con excepción `mutacion_no_permitida`. La tabla satélite `ece.consentimiento_quirurgico` no admite UPDATE/DELETE en absoluto (solo `GRANT SELECT, INSERT`) — la inmutabilidad se hereda del padre.
- **tipo_registro**: **OBLIGATORIO SIEMPRE** en flujo quirúrgico (electivo y urgencia). Bloqueante de `ACTO_QX` por declaración explícita en seed: `('ACTO_QX','Acto Quirúrgico', ..., array['CONS_INF'], true)` (archivo `08_seed_workflows.sql:26`). El motor de workflow ECE rechaza la creación de `ACTO_QX` si no existe `CONS_INF`/`CONS_QX` firmado en el mismo episodio.

---

## Propósito normativo

El **Consentimiento Quirúrgico (CONS_QX)** es la variante específica del consentimiento informado médico exigida por el **Art. 39 NTEC** previa a cualquier acto quirúrgico — mayor electivo, menor con sedación o urgencia con margen de tiempo razonable. A diferencia de `CONS_INF` genérico (que puede ser de hospitalización, anestésico, transfusional u otro), `CONS_QX` documenta el **procedimiento quirúrgico específico** con descripción detallada no abreviada (la abreviatura "colecistectomía lap." no es admisible: debe ser "colecistectomía laparoscópica electiva por colelitiasis sintomática"), los **riesgos quirúrgicos** propios del procedimiento, los **riesgos anestésicos** asociados al tipo de anestesia planeado (anexo anestésico firmado por el anestesiólogo cuando es distinta del consentimiento general), las **alternativas terapéuticas** —incluyendo la opción explícita de **NO OPERAR** y su impacto pronóstico—, y las **complicaciones frecuentes y severas** (sangrado, infección, lesión a estructuras vecinas, conversión a abierta en cirugía laparoscópica, necesidad de transfusión).

La **doble firma** paciente/representante + médico cirujano informante es **constitutiva** (no formal) y bloqueante del acto quirúrgico: el motor de workflow ECE declara `ACTO_QX` con `depende_de = ['CONS_INF']` y `obligatorio=true`, por lo que sin un consentimiento quirúrgico firmado vinculado al episodio el sistema no permite registrar la nota operatoria, la lista de cirugía segura OMS ni el registro anestésico. La firma del paciente se captura **antes** de la firma del MC (canvas digital o upload de imagen escaneada) y se almacena como URI/dataURL en `evidencia_firma_ref`. La firma del MC se ejecuta con **PIN electrónico argon2id** validado contra `ece.firma_electronica` con lockout a 5 intentos. El **anestesiólogo** firma su anexo de riesgos anestésicos por el mismo mecanismo (PIN), aunque hoy el modelo de datos no separa la firma del anestesiólogo de la del cirujano (`firma_mc_*` única) — ver §Drift conocido.

El **Art. 40 NTEC** establece inmutabilidad post-firma absoluta: una vez firmado por el MC, el documento es evidencia médico-legal permanente. La excepción documentada es la **revocación pre-procedimiento**: si el paciente retira el consentimiento antes de que el acto quirúrgico haya iniciado (antes del `Sign In` de la lista OMS), el documento puede pasar a estado `revocado` y **dispara la cancelación automática de la programación quirúrgica** (`PROG_QX` debe propagar al módulo de programación de quirófanos para liberar slot, equipo y personal). Una vez iniciado el procedimiento, el consentimiento queda como evidencia permanente y no se retira. Correcciones admisibles solo por **adendum** (documento nuevo vinculado) o por **rectificación trazable** (Art. 42 NTEC) con registro de usuario + timestamp + detalle.

Adicionalmente, el `CONS_QX` documenta **autorizaciones específicas** que no están en el `CONS_INF` genérico: (a) **transfusión planeada o eventual** (`transfusion_autorizada`) — habilita al equipo a transfundir hemoderivados en caso necesario sin nueva firma; (b) **ampliación quirúrgica autorizada** (`ampliacion_quirurgica_autorizada`) — habilita al cirujano a extender el alcance del acto si los hallazgos intraoperatorios lo justifican (ej. apendicectomía profiláctica durante cirugía pélvica); (c) **fotografía/grabación autorizada** (`fotografia_grabacion_autorizada`) — para fines docentes o diagnósticos. Estas autorizaciones son explícitas, no presuntas: cada una se firma con casilla independiente.

---

## Dependencias (depende_de)

- **`FICHA_ID`** — siempre (raíz del expediente). Sin ficha de identificación verificada (Art. 15 NTEC) no hay paciente al cual vincular el consentimiento.
- **`HOJA_ING`** (hospitalizado) **o** **`HIST_CLIN`/`HC_AMB`** (cirugía ambulatoria mayor o pre-quirúrgica en consulta externa) — el consentimiento quirúrgico se firma sobre un episodio de atención existente (`episodio_id` NOT NULL en `ece.consentimiento_informado`). En cirugía electiva ambulatoria, el episodio puede ser la propia consulta pre-quirúrgica.
- **`PREOP`** (valoración preoperatoria — recomendado obligatorio antes en cirugía electiva): la clasificación ASA, evaluación de vía aérea, exámenes preoperatorios completos (Art. TDR §13.2) y el plan anestésico del anestesiólogo deben estar documentados antes de explicar al paciente los riesgos anestésicos específicos. En cirugía de urgencia con riesgo vital inminente, la valoración preoperatoria puede ser sumaria y registrada en el mismo acto.
- **Implícita**: el **catálogo `ece.tipo_documento` debe contener la entrada `CONS_QX`** con su `flujo_estado` inicial. El router `crearQuirurgico` falla con `PRECONDITION_FAILED: Tipo de documento CONS_QX no configurado en el catálogo ECE` si el DBA no lo ha sembrado. Esta es una **deuda conocida** del seed `08_seed_workflows.sql` que actualmente lista `CONS_INF` pero no `CONS_QX` como tipo de documento independiente — ver §Drift §3.

---

## Obligatoriedad

**SIEMPRE en cirugía**, sin excepciones generales:

| Contexto quirúrgico | Obligatoriedad | Norma de referencia |
|---|---|---|
| Cirugía mayor electiva | **SI** | NTEC Art. 39 + TDR §13.2 |
| Cirugía mayor de urgencia con margen razonable | **SI** (debe firmarse pre-incisión) | NTEC Art. 39 + TDR §13 |
| Cirugía menor con sedación o anestesia regional/general | **SI** | NTEC Art. 39 |
| Cirugía menor con anestesia local únicamente (sutura simple, drenaje absceso) | **SI** consentimiento (puede ser `CONS_INF` simplificado en lugar de `CONS_QX` con anexo anestésico) | NTEC Art. 39 |
| Cirugía ambulatoria mayor (TDR §12) | **SI** | NTEC Art. 39 + TDR §12.5 |
| Reintervención no programada en mismo episodio (re-operación urgente) | **SI** documento nuevo (no adendum del anterior) | NTEC Art. 39 |
| Procedimiento quirúrgico con riesgo vital inminente y paciente inconsciente sin representante localizable | **EXCEPCIÓN documentada** — acta médica firmada por dos médicos certificando imposibilidad e inminencia; documento `CONS_QX` se completa post-procedimiento marcando `firmanteRol='excepcion_riesgo_vital'` (campo a modelar — ver §Drift) | NTEC Art. 39 + jurisprudencia médica deontológica |

> **No es válido** "consentimiento general de hospitalización" en lugar de `CONS_QX`. Cada procedimiento quirúrgico exige su propio consentimiento específico: si en el mismo episodio se programan dos cirugías separadas, son dos `CONS_QX` distintos.

---

## Roles firmantes

| Rol | Acción | Momento | Mecanismo |
|---|---|---|---|
| **MEDICO_CIRUJANO** (rol `MC` o `ESP` en `ece.personal_salud`) | **Explica** detalladamente al paciente procedimiento, riesgos quirúrgicos, alternativas, complicaciones. **Firma** electrónica posteriormente. | Pre-procedimiento, una vez registrada la firma del paciente | **PIN electrónico argon2id** contra `ece.firma_electronica` — lockout 5 intentos. El campo `medico_que_informa` registra al cirujano. La firma se almacena en `firma_mc_id` → `ece.firma_electronica`, timestamp en `firma_mc_en`, credencial en `evidencia_firma_mc_ref`. |
| **PACIENTE** | Firma manuscrita digital (canvas) o upload de imagen escaneada con su firma. | Pre-procedimiento, **antes** de la firma del MC | Canvas en navegador (dataURL base64) o input file → `evidencia_firma_ref` (TEXT). Se completa `firmante_rol='paciente'`, `firmante_nombre` y `firmante_documento` (DUI/NIT/NIE/pasaporte). |
| **REPRESENTANTE_LEGAL** (cuando paciente menor de edad, incapacitado declarado, inconsciente o con limitación cognitiva certificada) | Firma sustitutoria con **parentesco declarado**. | Pre-procedimiento, antes de la firma del MC | Mismo mecanismo que paciente; `firmante_rol='representante_legal'`, `firmante_nombre` y `firmante_documento` del representante. El parentesco se registra en `firmante_nombre` o en observación del documento (campo `parentesco` pendiente de modelar — ver §Drift §4). |
| **TESTIGO** (cuando paciente analfabeto, no puede firmar por discapacidad transitoria o cultural) | Firma adicional como testigo del consentimiento del paciente. | Pre-procedimiento, simultáneo a la firma del paciente | Datos del testigo en el campo opcional `datosTestigo` del schema (`nombre`, `documento`); imagen de firma en `evidencia_firma_ref` complementaria. Opcional, no sustituye la firma del paciente — la complementa. |
| **ANESTESIOLOGO** | Firma anexo anestésico con explicación de riesgos anestésicos específicos según tipo de anestesia (general / regional / local con sedación / combinada / MAC). | Pre-procedimiento, idealmente tras la valoración pre-anestésica y antes de la inducción | **PIN electrónico argon2id**. Hoy modelado bajo la misma columna `firma_mc_id` del cirujano (no hay columna `firma_anestesia_id`) — divergencia documentada en §Drift §1. En la práctica actual, el anestesiólogo firma como rol `ESP` un consentimiento separado `CONS_INF` subtipo `anestesico` vinculado al mismo episodio. |
| **DIR** (Dirección del establecimiento o jefe de servicio quirúrgico) | **Valida** administrativamente el documento doble-firmado. | Post-firma del MC | Transición `validar` (firmado → validado); no requiere firma electrónica del DIR. Esta validación es administrativa (Art. 21 NTEC), **no constituye** la doble firma del Art. 39 ni es bloqueante de la cirugía. |

> **Doble firma OBLIGATORIA**: paciente (o representante legal) **+** médico cirujano. Sin ambas firmas en estado `firmado` no se habilita `ACTO_QX`. La firma del anestesiólogo se considera adicional (anexo) — su ausencia no bloquea técnicamente el motor de workflow hoy, pero la práctica clínica y la auditoría NTEC la exigen cuando hay anestesia regional/general.

---

## Campos obligatorios

### Cabecera (`ece.consentimiento_informado`, `tipo='quirurgico'`)

- `episodio_id` (FK `ece.episodio_atencion`) — obligatorio.
- `paciente_id` (FK `ece.paciente`) — resuelto desde el episodio.
- `tipo` = literal `'quirurgico'` (validado por `eceConsentimientoQxCreateSchema.tipoConsentimiento: z.literal("quirurgico")`).
- `procedimiento_descrito` — texto detallado **no abreviado** (TEXT, requerido). Debe incluir nombre completo del procedimiento, lateralidad cuando aplique (sitio quirúrgico: izquierdo/derecho/bilateral), abordaje (laparoscópico / abierto / robótico / endoscópico), diagnóstico que lo motiva. **Obligatorio**.
- `riesgos_explicados` — texto largo: riesgos específicos del procedimiento (sangrado, infección sitio quirúrgico, lesión nerviosa/vascular/visceral, dehiscencia, recidiva, conversión a técnica abierta, mortalidad estimada). Recomendado fuerte; auditable.
- `alternativas` — texto largo: alternativas terapéuticas incluyendo **NO_OPERAR** y su impacto pronóstico, tratamiento conservador, otras técnicas quirúrgicas. Recomendado fuerte; obligatorio en auditoría NTEC.
- `medico_que_informa` (FK `ece.personal_salud`) — el **cirujano principal** que explica y firma. Resuelto desde `ctx.user.id` en el router `crearQuirurgico` (rol MC o ESP).
- `firmante_rol` ∈ `{paciente | representante_legal}` — NULL en borrador, se completa en `firmarPaciente`.
- `firmante_nombre` (VARCHAR 200) — NULL en borrador.
- `firmante_documento` (VARCHAR 40) — DUI / NIT / NIE / pasaporte. NULL en borrador.
- `evidencia_firma_ref` — URI/dataURL de la firma del paciente o representante. **Obligatorio antes** de la firma del MC.
- `firma_mc_id` (FK `ece.firma_electronica`) — poblado al firmar el MC.
- `firma_mc_en` — timestamp con segundos de la firma del MC.
- `evidencia_firma_mc_ref` — id de la credencial PIN usada por el MC.
- `estado` ∈ `{borrador | firmado | revocado}` — default `borrador`.
- `instancia_id` (FK `ece.documento_instancia`) — workflow del motor ECE.
- `fecha_hora` — `now()` al insertar.

### Específicos quirúrgicos (`ece.consentimiento_quirurgico`, satélite 1:1)

- `consentimiento_id` (FK UNIQUE `ece.consentimiento_informado`) — relación 1:1.
- `tipo_anestesia` — enum CHECK `{general | regional | local | sedacion | combinada}`. **Obligatorio**.
- `transfusion_autorizada` — boolean, default `false`. Si `true`, habilita transfusión sin nueva firma.
- `ampliacion_quirurgica_autorizada` — boolean, default `false`. Habilita ampliar alcance intraoperatorio.
- `fotografia_grabacion_autorizada` — boolean, default `false`. Para fines docentes/diagnósticos.
- `registrado_en` — timestamptz, default `now()`.

### Pendiente de modelado (gaps NTEC)

- `complicaciones_frecuentes_y_severas` — actualmente subsumido en `riesgos_explicados`; NTEC sugiere separarlo (no modelado hoy).
- `preguntas_paciente_y_respuestas` — campo libre para documentar preguntas del paciente y respuestas del cirujano (no modelado).
- `parentesco_representante_legal` — relación del representante con el paciente (madre/padre/cónyuge/tutor legal) — no modelado como columna explícita.
- `colegio_medico_no` del cirujano — derivable de `ece.personal_salud.numero_colegiado`, pero no proyectado en el documento.
- `firma_anestesia_id` / `firma_anestesia_en` — anexo anestésico no separado (ver §Drift §1).

### Metadatos obligatorios (Art. 55–56 NTEC)

`usuario_creador`, `firma_electronica_simple` (PIN argon2id), `timestamp` (con segundos), `establecimiento_id`, `institucion_id`, bitácora de modificaciones inmutable (retención 10 años en `audit.audit_log` con hash chain — TDR §6.3 / archivo `05_audit_hash_chain.sql`).

---

## Estados (flujo_estado)

```
borrador
   │
   │ (paciente firma — firmarPaciente registra evidencia_firma_ref + firmante_*)
   │   *El estado de workflow permanece 'borrador' hasta firma del MC.*
   │   *UI deriva etiqueta 'pendiente_firma_paciente' / 'pendiente_firma_mc'.*
   │
   ▼
firmado  ← (MC ejecuta 'firmar' con PIN argon2id; INMUTABLE post-firma — Art. 40)
   │              │
   │              │ (excepción: paciente revoca pre-procedimiento)
   │              ▼
   │           revocado  ── dispara cancelación PROG_QX (módulo programación quirúrgica)
   │
   │ (DIR ejecuta 'validar' — solo si no fue revocado)
   ▼
validado (estado final)

# Ramas alternativas
borrador → anulado  (DIR ejecuta 'anular' — transición universal pre-firma)
```

> **Estados en BD** (`ece.consentimiento_informado.estado` CHECK constraint): `borrador | firmado | revocado`. El estado `validado` y `anulado` viven en el motor de workflow (`ece.documento_instancia.estado_actual_id` → `ece.flujo_estado.codigo`), no en la columna `estado` del registro clínico. Esta divergencia es heredada de `CONS_INF` — ver §Drift §6.

---

## Transiciones

| origen | destino | acción | rol_autoriza | requiere_firma | notas |
|---|---|---|---|---|---|
| `borrador` | `borrador` | `firmarPaciente` (mutation tRPC) | MC / ESP / ANEST / DIR | NO (firma biométrica del paciente, no electrónica del profesional) | No avanza el workflow; actualiza `firmante_rol`, `firmante_nombre`, `firmante_documento`, `evidencia_firma_ref`. Requiere `estado='borrador'`. Pre-requisito para que MC pueda firmar. |
| `borrador` | `firmado` | `firmar` | **MC** o **ESP** (cirujano principal) | **SÍ** (PIN argon2id) | Pre-requisito: `evidencia_firma_ref IS NOT NULL`. Setea `estado='firmado'`, emite evento `workflow.transitionExecuted`, activa trigger de inmutabilidad. Habilita downstream `ACTO_QX`. |
| `borrador` | `firmado` (anexo) | `firmarAnexoAnestesia` (pendiente de implementar) | **ANEST** (anestesiólogo) | SÍ (PIN argon2id) | Firma del anexo anestésico. Hoy se modela como `CONS_INF` subtipo `anestesico` separado — divergencia §Drift §1. |
| `firmado` | `validado` | `validar` | **DIR** o **JEFE_QX** | NO | Validación administrativa (Art. 21 NTEC). Solo si `estado_codigo='firmado'`. No bloqueante para `ACTO_QX`. |
| `firmado` | `revocado` | `revocar` (pendiente de implementar como transición de workflow) | **PACIENTE** (con asistencia administrativa) o **MC** registrando la revocación del paciente | NO (firma del paciente registrada en evidencia) | **Solo pre-procedimiento** (antes del `Sign In` de la lista OMS). **Dispara evento `cons_qx.revocado`** que el módulo de programación quirúrgica debe consumir para cancelar `PROG_QX` (liberar slot, equipo, personal). Una vez iniciado el procedimiento, no se admite revocación. Hoy modelada solo a nivel de columna `estado`, no como transición de workflow seeded — §Drift §2. |
| `borrador` | `anulado` | `anular` | **DIR** | SÍ | Transición universal (todos los documentos). Solo desde borrador (pre-firma). Distinto de `revocar` (que es post-firma). |

> **Sin transición `firmado → revocado` seeded en el motor**: hoy el motor de workflow ECE solo conoce `firmado → validado` y `borrador → anulado`. La revocación pre-procedimiento es **gap a cerrar** (ver §Drift §2).

---

## Eventos de dominio

Emitidos por `emitDomainEvent` dentro del callback de `withWorkflowContext` (outbox transaccional). Tipo de evento canónico: **`workflow.transitionExecuted`** con `aggregateType = "ConsentimientoInformado"` y `aggregateSubtype = "CONS_QX"`.

| Evento (semántico) | Cuándo | Payload | Notas |
|---|---|---|---|
| `cons_qx.creado` | Tras `crearQuirurgico` (borrador inserto en cabecera + satélite) | `{ consentimientoId, instanciaId, episodioId, pacienteId, medicoCirujanoId, tipoAnestesia, transfusionAutorizada, ampliacionQuirurgicaAutorizada, fotografiaGrabacionAutorizada, orgId }` | **No emitido hoy** — drift respecto al briefing (mismo gap que `cons_inf.creado`). |
| `cons_qx.firmado_paciente` | Tras `firmarPaciente` (paciente o representante registró firma manuscrita digital) | `{ consentimientoId, firmanteRol, firmanteNombre, firmanteDocumento, firmaImagenUri, orgId }` | **No emitido hoy** — el router actualiza columnas y retorna `ok:true`, sin outbox. |
| `cons_qx.firmado_medico` ≡ `workflow.transitionExecuted` | Tras `firmar` (cirujano autenticado con PIN) | `{ instanceId, tipoDocumentoCodigo: "CONS_QX", fromStateId, toStateId: "firmado", accion: "firmar", byUserId, firmaId, contenidoHash }` | **Emitido**. El consumidor downstream (`ACTO_QX`) escucha este evento filtrando por `tipoDocumentoCodigo='CONS_QX'` para habilitar la creación de la nota operatoria. |
| `cons_qx.firmado_anestesia` | Tras firma del anexo anestésico por el anestesiólogo | `{ consentimientoId, anestesiologoId, tipoAnestesia, firmaId, orgId }` | **No implementado** — hoy el anestesiólogo firma un `CONS_INF` subtipo `anestesico` separado que emite su propio `workflow.transitionExecuted`. |
| `cons_qx.validado` ≡ `workflow.transitionExecuted` | Tras `validar` (DIR) | `{ instanceId, accion: "validar", toStateId: "validado", byUserId }` | Emitido (vía workflow). |
| `cons_qx.revocado` | Paciente retira consentimiento pre-procedimiento | `{ consentimientoId, episodioId, motivoRevocacion, revocadoPorRol, orgId }` — **dispara comando `cancelar_programacion_quirurgica` al módulo PROG_QX** | **No implementado** (ver §Drift §2). Cuando se implemente, debe ser síncrono con la actualización de `estado='revocado'` y con la cancelación de `PROG_QX` en el mismo episodio (transacción de outbox + comando). |
| `cons_qx.anulado` ≡ `workflow.transitionExecuted` | Tras `anular` (DIR) sobre borrador | `{ instanceId, accion: "anular", toStateId: "anulado", byUserId }` | Emitido. Solo pre-firma. |

---

## Drift conocido (audit)

### 1. Firma del anestesiólogo no separada de la del cirujano

El modelo de datos actual (`ece.consentimiento_informado`) tiene **una sola columna** `firma_mc_id` que registra la firma del médico que informa (cirujano principal). **No hay columna** `firma_anestesia_id` ni `firma_anestesia_en`. En la práctica clínica NTEC + TDR §13.2 ("Consentimiento informado quirúrgico y anestésico"), el anexo anestésico debe ser firmado por el **anestesiólogo responsable**, distinto del cirujano. Hoy esto se resuelve creando un **`CONS_INF` separado con `tipo='anestesico'`** vinculado al mismo `episodio_id`, lo que técnicamente funciona pero **fragmenta** la unidad lógica "consentimiento del acto quirúrgico" en dos documentos separados.

**Pendiente**: decidir si:
- (a) Añadir columnas `firma_anestesia_*` a `ece.consentimiento_informado` (subtipo `quirurgico` las usa, subtipo `hospitalizacion`/`anestesico` las deja NULL); o
- (b) Añadir tabla satélite `ece.consentimiento_quirurgico_anestesia` con FK al cabecera y firma propia del anestesiólogo (paralela a `ece.consentimiento_quirurgico`).

Hoy se favorece (b) por separación de responsabilidades, pero requiere modelado adicional. La auditoría Stream F (cirugía) lo identificó como hallazgo abierto.

### 2. Transición `firmado → revocado` no seeded; revocación no cancela PROG_QX

La columna `ece.consentimiento_informado.estado` admite `'revocado'` (CHECK constraint en `99_consentimiento_doble_firma_workflow.sql:19`) y el trigger `fn_bloquea_mutacion_consentimiento` ya cubre el caso (`OLD.estado IN ('firmado', 'revocado') ⇒ bloqueo de UPDATE/DELETE`). Sin embargo, el seed `08_seed_workflows.sql` **no declara** la transición `firmado → revocado` en `ece.flujo_transicion`. Tampoco existe procedimiento tRPC `revocar` en el router.

**Consecuencia operativa crítica para CONS_QX**: si un paciente retira su consentimiento la mañana del día de cirugía (situación clínicamente frecuente), no hay forma sistémica de:
1. Marcar el `CONS_QX` como `revocado` (queda artificialmente como `firmado`).
2. **Cancelar automáticamente la programación quirúrgica `PROG_QX`** (liberar slot, equipo, personal, instrumental especial reservado).
3. Notificar al equipo quirúrgico (cirujano, anestesiólogo, enfermería circulante).

**Pendiente** (gap P1 — Stream F):
- Añadir transición seeded `('CONS_QX','revocar','firmado','revocado','PACIENTE',true)` en `08_seed_workflows.sql`.
- Implementar procedimiento `revocar` en `consentimiento.router.ts` que: (a) actualice `estado='revocado'`, (b) emita `cons_qx.revocado` en outbox, (c) genere comando `cancelar_programacion_quirurgica` consumido por módulo PROG_QX.
- Validar que la revocación solo es admisible **antes del `Sign In`** de la lista OMS (`ACTO_QX` no iniciado).

### 3. Catálogo `tipo_documento` no contiene `CONS_QX` independiente

El router `crearQuirurgico` (`consentimiento.router.ts:781+`) busca `td.codigo = 'CONS_QX'` en `ece.tipo_documento`, pero el seed `08_seed_workflows.sql` **no declara** este tipo de documento independiente — solo declara `CONS_INF` que cubre `hospitalizacion`/`quirurgico`/`anestesico`/`otro` como subtipo en la columna `tipo`. Resultado: hoy `crearQuirurgico` **falla con `PRECONDITION_FAILED`** salvo que el DBA siembre manualmente `CONS_QX` en el catálogo del proyecto Supabase.

**Pendiente decisión arquitectural**:
- (a) **Unificar** — eliminar el código `CONS_QX` del router y usar siempre `CONS_INF` con `tipo='quirurgico'`. Más simple, menos redundancia, pero pierde la posibilidad de declarar dependencias distintas para `ACTO_QX` (`depende_de: ['CONS_QX']` es semánticamente más fuerte que `depende_de: ['CONS_INF']` con filtro `tipo='quirurgico'` en runtime).
- (b) **Sembrar `CONS_QX` como tipo independiente** — añadir al seed `08_seed_workflows.sql` con su propio `flujo_estado`, `flujo_transicion`, `documento_rol`. Más explícito, soporta dependencias finas, pero duplica metadata con `CONS_INF`.

Decisión recomendada (no aplicada): **(b)** — declarar `CONS_QX` como tipo independiente con `depende_de = array['CONS_INF']` (porque siempre presupone un `CONS_INF` de hospitalización o consulta pre-quirúrgica), o sin dependencia si el flujo ambulatorio puro no exige `CONS_INF` previo.

### 4. Parentesco del representante legal no modelado como columna

Cuando el paciente no puede firmar (menor, incapacitado, inconsciente), firma un representante legal con **parentesco declarado** (madre, padre, cónyuge, hijo/a mayor de edad, tutor legal). El modelo actual no tiene columna explícita `parentesco_representante_legal`: el campo se documenta libremente en `firmante_nombre` (anti-patrón) o en el contenido del documento. Esto dificulta auditoría y reporting NTEC.

**Pendiente** (gap P2): añadir columna `parentesco_representante` a `ece.consentimiento_informado` con enum `{madre | padre | conyuge | hijo_mayor | tutor_legal | otro_familiar | otro}` cuando `firmante_rol='representante_legal'`.

### 5. Excepción por riesgo vital inminente sin paciente/representante no modelada

NTEC y la jurisprudencia médica admiten que un procedimiento quirúrgico se realice **sin consentimiento previo** cuando el paciente está inconsciente, no hay representante legal localizable, y el riesgo vital es inminente. En este caso, el procedimiento se ejecuta y el documento se completa **post-procedimiento** con un acta médica firmada por dos médicos certificando la imposibilidad e inminencia.

El modelo actual **no soporta** este caso de manera explícita: `firmante_rol` solo admite `{paciente | representante_legal}`, no hay valor `excepcion_riesgo_vital`. Tampoco hay flujo de "doble firma médica certificando excepción".

**Pendiente** (gap P2): extender enum `firmante_rol` y modelar campo `acta_excepcion_riesgo_vital` (booleano + texto justificativo + firma de dos médicos).

### 6. Estados `pendiente_firma_paciente` / `pendiente_firma_mc` en UI sin reflejo en BD

Heredado de `CONS_INF`: el listado `apps/web/src/app/(clinical)/ece/consentimiento/page.tsx` mapea estados de UI `pendiente_firma_paciente`, `pendiente_firma_mc` que **no existen** en `ece.flujo_estado` (BD solo conoce `borrador | firmado | validado | anulado` a nivel workflow). El front debería derivar estas etiquetas semánticas:
- `estado='borrador' AND evidencia_firma_ref IS NULL` ⇒ `pendiente_firma_paciente`.
- `estado='borrador' AND evidencia_firma_ref IS NOT NULL AND firma_mc_id IS NULL` ⇒ `pendiente_firma_mc`.

**Pendiente**: documentar la regla de derivación en el front o exponer vista BD `ece.v_consentimiento_estado_semantico`.

### 7. Tabla `ece.consentimiento_quirurgico` sin trigger explícito de inmutabilidad

El archivo `99_consentimiento_quirurgico.sql` (líneas 47-49) comenta: *"UPDATE y DELETE bloqueados: la inmutabilidad del consentimiento firmado (trigger fn_bloquea_mutacion_consentimiento en consentimiento_informado) hace innecesario mutar esta tabla satélite post-firma."* Sin embargo, la tabla satélite **no tiene su propio trigger** ni CHECK que impida UPDATE/DELETE; solo se confía en `GRANT SELECT, INSERT` (sin UPDATE/DELETE para `authenticated`). Un rol con permisos elevados (service_role) podría mutar la satélite sin disparar la inmutabilidad de la cabecera.

**Pendiente** (gap P2): añadir trigger explícito `trg_inmutable_consentimiento_quirurgico` en la satélite que verifique el estado de la fila padre y bloquee mutaciones si `estado IN ('firmado','revocado')`.

### 8. Eventos `cons_qx.creado` y `cons_qx.firmado_paciente` no emitidos

Hereda el mismo gap de `CONS_INF`: el outbox transaccional solo emite eventos en la transición `firmar` (paso del MC). La creación del borrador, la firma del paciente y la firma del anestesiólogo (cuando se modele) deberían emitir eventos específicos del dominio para que módulos downstream (programación quirúrgica, dashboards, notificaciones) puedan reaccionar.

**Pendiente**: decidir granularidad de eventos — emisión específica `cons_qx.*` o subsumida bajo `workflow.transitionExecuted` con discriminador en payload.

---

## Descripción markdown rica

El **Consentimiento Quirúrgico (CONS_QX)** es la variante específica del consentimiento informado médico exigida por el **Art. 39 NTEC** previa a cualquier procedimiento quirúrgico — mayor electivo, menor con sedación, urgencia con margen razonable o reintervención. A diferencia del `CONS_INF` genérico (que cubre hospitalización, anestésico, transfusional u otro como subtipo), `CONS_QX` documenta el **procedimiento quirúrgico específico** con descripción detallada no abreviada (la abreviatura "colecistectomía lap." no es admisible: debe ser "colecistectomía laparoscópica electiva por colelitiasis sintomática"), los **riesgos quirúrgicos** propios del procedimiento, los **riesgos anestésicos** asociados al tipo de anestesia planeado, las **alternativas terapéuticas** —incluyendo la opción explícita de **NO_OPERAR** y su impacto pronóstico—, y las **complicaciones frecuentes y severas** (sangrado, infección sitio quirúrgico, lesión nerviosa/vascular/visceral, dehiscencia, recidiva, conversión a abierta, mortalidad estimada). Cubre también autorizaciones específicas no presuntas: **transfusión** planeada o eventual, **ampliación intraoperatoria** del alcance del acto si los hallazgos lo justifican, y **fotografía/grabación** con fines docentes/diagnósticos — cada una documentada con casilla independiente en `ece.consentimiento_quirurgico`.

La **doble firma OBLIGATORIA paciente/representante + médico cirujano** es **constitutiva y bloqueante**: el motor de workflow ECE declara `ACTO_QX` con `depende_de = ['CONS_INF']` y `obligatorio = true` (seed `08_seed_workflows.sql:26`), por lo que sin un consentimiento quirúrgico firmado vinculado al episodio el sistema **no permite** registrar la nota operatoria, la lista de cirugía segura OMS (Sign In / Time Out / Sign Out), ni el registro anestésico. La firma del paciente se captura **antes** de la firma del MC (canvas digital o upload escaneado) y se almacena como URI/dataURL en `evidencia_firma_ref`. La firma del MC se ejecuta con **PIN electrónico argon2id** validado contra `ece.firma_electronica` con lockout a 5 intentos. El router rechaza `firmar` si `evidencia_firma_ref` es NULL. El **anestesiólogo** firma un anexo de riesgos anestésicos específicos según el tipo de anestesia (general / regional / local con sedación / combinada / MAC); hoy ese anexo se modela como un `CONS_INF` separado con `tipo='anestesico'` (gap de modelado documentado — §Drift §1).

**Diferencia clave con `CONS_INF` general**: `CONS_INF` puede ser de hospitalización, anestésico, transfusional u otro, y se aplica a cualquier procedimiento de riesgo (hospitalización, transfusión, telemedicina, procedimiento ambulatorio mayor). `CONS_QX` es **específico del acto quirúrgico** y exige cuatro elementos extra: (1) descripción detallada del procedimiento con lateralidad y abordaje, (2) tipo de anestesia, (3) autorización explícita de transfusión, ampliación quirúrgica y registro audiovisual, (4) anexo anestésico firmado por anestesiólogo. Además, `CONS_QX` es **bloqueante** del flujo `ACTO_QX` mientras `CONS_INF` genérico es bloqueante solo cuando el procedimiento downstream lo exige (transfusión, telemedicina).

**Post-firma, el documento es estrictamente INMUTABLE** por aplicación directa del **Art. 40 NTEC**. El trigger `ece.fn_bloquea_mutacion_consentimiento` (archivo `99_consentimiento_doble_firma_workflow.sql:38-53`) bloquea a nivel de motor de base de datos cualquier `UPDATE` o `DELETE` sobre filas con `estado IN ('firmado','revocado')`, lanzando la excepción `mutacion_no_permitida: consentimiento informado en estado '%' es inmutable (Art. 40 NTEC)`. La tabla satélite `ece.consentimiento_quirurgico` no admite `UPDATE`/`DELETE` en absoluto a nivel de `GRANT` (solo `SELECT, INSERT` para `authenticated`) — la inmutabilidad se hereda lógicamente del padre, aunque la falta de trigger explícito en la satélite es un gap menor (§Drift §7). Correcciones admisibles solo por **adendum** (nuevo documento vinculado) o por **rectificación trazable** (Art. 42 NTEC) con registro de usuario + timestamp + detalle.

**Revocación pre-procedimiento**: si el paciente retira su consentimiento **antes del `Sign In`** de la lista OMS (antes de la inducción anestésica), el documento puede pasar a estado `revocado` y **debe** disparar la cancelación automática de la programación quirúrgica `PROG_QX` (liberación de slot de quirófano, equipo, anestesiólogo, instrumental especial reservado, notificación al equipo). Una vez iniciado el procedimiento (post Sign In), no se admite revocación: el consentimiento queda como evidencia documental permanente. **Hoy la revocación está modelada solo a nivel de columna `estado` pero sin transición de workflow seeded ni procedimiento tRPC `revocar`** — gap crítico P1 documentado en §Drift §2. Esto es funcionalmente bloqueante para el flujo de cancelación de cirugía del día y debe cerrarse antes del Go-Live de quirófanos.

**No confundir con consentimiento médico general ni con LOPD**: `CONS_QX` cubre exclusivamente el acto quirúrgico bajo NTEC Art. 39/40 (doble firma, inmutable post-firma, ciclo `borrador → firmado → validado` o `borrador → firmado → revocado`); `CONS_INF` con subtipo `hospitalizacion`/`anestesico`/`otro` cubre los demás procedimientos de riesgo bajo la misma normativa; `/consents` (admin) cubre consentimientos administrativos de **tratamiento de datos personales** bajo LPDP/GDPR/LOPD con una sola firma, revocables en cualquier momento, totalmente fuera del scope quirúrgico. Los tres dominios coexisten legítimamente — CLAUDE.md §"Adecuar legacy vs duplicar" lo documenta como contra-ejemplo de coexistencia.
