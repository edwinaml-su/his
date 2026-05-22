# CONS_INF — Consentimiento Informado Médico

## Metadata

- **codigo**: `CONS_INF`
- **nombre**: Consentimiento Informado Médico
- **modalidad**: `AMBULATORIO | HOSPITALIZACION | QUIRURGICO` (seed: `ambos` — aplicable a flujo ambulatorio y hospitalario; el subtipo se discrimina por columna `tipo` y por satélite `ece.consentimiento_quirurgico` cuando es `CONS_QX`).
- **NTEC artículo**: **Art. 39 NTEC** (doble firma — paciente + médico cirujano informante) + **Art. 40 NTEC** (inmutabilidad post-firma). Norma fuente: Acuerdo n.° 1616 MINSAL (D.O. T.444 N°158, 22/08/2024; reforma D.O. n.°55 T.450, 19/03/2026).
- **modulo_his_target**: `/ece/consentimiento` (listado) + `/ece/consentimiento/nuevo` (wizard 3 pasos) + `/ece/consentimiento/[id]` (detalle).
- **tabla_datos**: `ece.consentimiento_informado` (cabecera) + `ece.consentimiento_quirurgico` (satélite 1:1 cuando `tipo='quirurgico'`).
- **inmutable**: `true` (post-firma del MC — estado pasa a `firmado` y el trigger `trg_inmutable_consentimiento_informado` bloquea UPDATE/DELETE).
- **tipo_registro**: `OBLIGATORIO` — clasificación NTEC `historico` (seed `08_seed_workflows.sql` línea 22: `'CONS_INF', ..., 'historico', 'ambos', array['FICHA_ID'], true`).

---

## Propósito normativo

El **Art. 39 NTEC** exige consentimiento informado **previo** a cualquier procedimiento de riesgo (hospitalización, quirúrgico, anestésico, transfusional, telemedicina) como garantía del derecho del paciente a decidir informadamente — sustento en **Ley de Deberes y Derechos de los Pacientes y Prestadores de Servicios de Salud (Art. 5 lit. a)** y la **Ley de Protección de Datos Personales (Arts. 9 y 18)**.

La **doble firma** (paciente o representante legal + médico que informa) es **constitutiva**, no formal: sin ambas firmas el documento no es válido como descargo médico-legal y, en flujo quirúrgico, **bloquea** la ejecución del acto (`ACTO_QX` declara `depende_de: ['CONS_INF']` — ver seed `08_seed_workflows.sql` línea 26).

El **Art. 40 NTEC** establece que, una vez firmado, el contenido es **inmutable**: el procedimiento descrito, los riesgos explicados, las alternativas y la firma del paciente no pueden modificarse. Correcciones solo proceden por **adendum** (nuevo documento vinculado) o por **rectificación trazable** con registro de usuario + timestamp + detalle (Art. 42 NTEC). El trigger `ece.fn_bloquea_mutacion_consentimiento` (archivo `99_consentimiento_doble_firma_workflow.sql`) hace cumplir esta restricción a nivel de base de datos.

Legalmente, este documento cubre: (a) la información comprendida por el paciente sobre el procedimiento, sus riesgos, alternativas y beneficios; (b) el consentimiento expreso para ejecutarlo; (c) la trazabilidad del profesional que informa y de quien firma — con su parentesco si es representante legal —; (d) la prueba documental que sustenta el descargo de responsabilidad asistencial.

---

## Dependencias (depende_de)

- **`FICHA_ID`** — siempre (raíz del expediente; sin ficha de identificación no hay paciente al cual vincular el consentimiento). Seed declara explícitamente `array['FICHA_ID']` como dependencia base.
- **Contexto ambulatorio con procedimiento mayor**: precedido por **`HC_AMB` / `HIST_CLIN`** (historia clínica con indicación del procedimiento que motiva el consentimiento).
- **Contexto hospitalario**: precedido por **`HOJA_ING`** (apertura de episodio hospitalario) — el consentimiento de hospitalización se firma en el momento de admisión.
- **Contexto quirúrgico (subtipo `CONS_QX`)**: además de las anteriores, depende de la **valoración preoperatoria** y, en práctica, debe firmarse antes de mover el paciente al área quirúrgica. **`ACTO_QX`** declara `CONS_INF` como dependencia bloqueante.

---

## Obligatoriedad por modalidad

| Modalidad | ¿Obligatorio? | Norma de referencia |
|---|---|---|
| QUIRURGICO | **SI siempre** (cirugía mayor y menor con sedación) | NTEC Art. 39 + TDR §16 Cirugía |
| HOSPITALIZACION admisión | **SI** (consentimiento de hospitalización) | NTEC Art. 39 + TDR §11 Admisión |
| ANESTESICO (acto anestésico independiente del quirúrgico) | **SI** (cuando hay anestesia regional/general distinta del consentimiento quirúrgico) | NTEC Art. 39 |
| AMBULATORIO — procedimiento mayor (biopsia, endoscopía, infiltración) | **SI** | NTEC Art. 39 + TDR §13 Procedimientos ambulatorios |
| AMBULATORIO — consulta simple | **NO** | — |
| TRANSFUSIONAL | **SI** (consentimiento específico transfusión) | TDR §7.3 / NTEC Art. 39 |
| TELEMEDICINA | **SI** (consentimiento específico de telemedicina) | TDR §13.5 |
| INVESTIGACIÓN / DOCENCIA | **SI** (consentimiento específico de investigación) | LPDP Art. 9 |

> **Notar**: en el sistema actual el enum de subtipo (`ece.consentimiento_informado.tipo`) cubre `hospitalizacion | quirurgico | anestesico | otro` (ver `schemas.ts` y `eceConsentimientoCreateSchema`). Transfusional / telemedicina / investigación caen hoy bajo `otro`.

---

## Roles firmantes

| Rol | Acción | Momento | Mecanismo |
|---|---|---|---|
| **MC** (Médico de Cabecera / cirujano / tratante) | Informa al paciente y **firma** | Pre-procedimiento, una vez registrada la firma del paciente | **PIN electrónico** (argon2id) contra `ece.firma_electronica` — lockout 5 intentos |
| **PACIENTE** | Firma manuscrita digital | Pre-procedimiento, **antes** de la firma del MC | Canvas en navegador (dataURL) o **upload** de imagen escaneada → `evidencia_firma_ref` |
| **REPRESENTANTE LEGAL** | Firma sustitutoria con **parentesco declarado** | Cuando el paciente no puede firmar (menor, incapacitado, inconsciente) | Mismo mecanismo que paciente; `firmante_rol = 'representante_legal'` + `firmante_nombre` + `firmante_documento` |
| **TESTIGO** | Firma adicional (si paciente analfabeto o no puede firmar) | Pre-procedimiento | Datos en `datosTestigo` del schema; opcional; queda evidencia documental |
| **DIR** (Dirección del establecimiento) | **Valida** el documento firmado | Post-firma del MC | Transición `validar` (firmado → validado); no requiere firma electrónica |

> **Doble firma obligatoria SIEMPRE**: paciente (o representante legal) **+** médico cirujano. La firma del DIR es **validación administrativa**, no constituye la doble firma del Art. 39.

---

## Campos obligatorios

- `episodioId` (FK `ece.episodio_atencion`) — obligatorio.
- `pacienteId` (FK `ece.paciente`) — resuelto desde el episodio.
- `tipo` — `hospitalizacion | quirurgico | anestesico | otro` (UI usa `HOSPITALIZACION | QUIRURGICO | ANESTESICO`).
- `procedimientoDescrito` — texto libre (1..4000 chars). **Obligatorio**.
- `riesgosExplicados` — texto largo (0..4000 chars). Recomendado.
- `alternativas` — texto largo (0..4000 chars). Recomendado.
- `medicoQueInformaId` — FK `ece.personal_salud` (resuelto desde `ctx.user.id`).
- `firmanteRol` — `paciente | representante_legal` (NULL en borrador inicial; se completa en `firmarPaciente`).
- `firmanteNombre` — VARCHAR(200) (NULL en borrador inicial).
- `firmanteDocumento` — VARCHAR(40) — DUI / NIT / NIE / pasaporte (NULL en borrador inicial; en caso de representante legal **debe** incluir parentesco como observación del schema o reflejarse en el documento).
- `evidenciaFirmaRef` — URI/dataURL de la firma del paciente o representante (obligatorio antes de la firma del MC).
- `firmaMcId` — FK `ece.firma_electronica` (poblado al firmar el MC).
- `firmaMcEn` — timestamp de la firma del MC.
- `evidenciaFirmaMcRef` — id de la credencial PIN usada.
- `fechaHora` — `now()` al insertar.
- `instanciaId` — FK `ece.documento_instancia` (workflow).

### Campos adicionales subtipo `CONS_QX` (tabla satélite `ece.consentimiento_quirurgico`)

- `tipoAnestesia` — `general | regional | local | sedacion | combinada`.
- `transfusionAutorizada` — boolean.
- `ampliacionQuirurgicaAutorizada` — boolean (consentimiento para ampliar el alcance del acto si los hallazgos intraoperatorios lo justifican).
- `fotografiaGrabacionAutorizada` — boolean (consentimiento para registro audiovisual con fines docentes/diagnósticos).

### Metadatos obligatorios (Art. 55–56 NTEC)

`usuario_creador`, `firma_electronica_simple`, `timestamp` (con segundos), `establecimiento_id`, `institucion_id`, bitácora de modificaciones inmutable (≥ 2 años de retención — política del sistema: 10 años para `audit.audit_log`).

---

## Estados (flujo_estado)

```
borrador
   │
   │ (interacción paciente: firmarPaciente — registra evidencia_firma_ref)
   │   *Nota: el estado de workflow permanece 'borrador' hasta la firma del MC.*
   │   *La UI muestra etiquetas semánticas 'pendiente_firma_paciente' / 'pendiente_firma_mc'.*
   │
   ▼
firmado  ← (MC ejecuta 'firmar' con PIN argon2id; INMUTABLE post-firma — Art. 40)
   │
   │ (DIR ejecuta 'validar')
   ▼
validado (estado final)

# Ramas alternativas
borrador → anulado (DIR ejecuta 'anular' — transición universal, requiere firma)
firmado  → (revocado) ← solo pre-procedimiento; ver Drift conocido
```

> **Estados reales en BD** (seed `08_seed_workflows.sql` paso 2): `borrador`, `firmado`, `validado`, `anulado`. El estado `revocado` existe a nivel de columna `ece.consentimiento_informado.estado` (`CHECK (estado IN ('borrador','firmado','revocado'))`) pero **no** como estado del motor de workflow ECE — es divergencia conocida (ver §Drift).

---

## Transiciones

| origen | destino | acción | rol_autoriza | requiere_firma | notas |
|---|---|---|---|---|---|
| `borrador` | `borrador` | `firmarPaciente` (mutation tRPC) | MC / PHYSICIAN / ENF / DIR / ARCH | NO (firma biométrica del paciente, no electrónica del profesional) | No avanza el workflow; actualiza `firmante_*` y `evidencia_firma_ref`. Requiere `estado='borrador'`. |
| `borrador` | `firmado` | `firmar` | **MC** (o ESP cuando aplica) | **SÍ** (PIN argon2id) | Pre-requisito: `evidencia_firma_ref IS NOT NULL`. Setea `estado='firmado'`, emite evento `workflow.transitionExecuted`, activa trigger de inmutabilidad. |
| `firmado` | `validado` | `validar` | **DIR** | NO | Validación administrativa (Art. 21 NTEC). Solo permitida si `estado_codigo='firmado'`. |
| `borrador` | `anulado` | `anular` | **DIR** | SÍ | Transición universal (todos los documentos). Solo desde borrador. |

> **Sin transición `firmado → revocado` en el motor de workflow**: la columna `estado` admite `'revocado'` pero no hay transición seeded. La revocación pre-procedimiento requiere modelado adicional (ver §Drift).

---

## Eventos de dominio

Emitidos por `emitDomainEvent` dentro del callback de `withWorkflowContext` (outbox transaccional). Tipo de evento canónico: **`workflow.transitionExecuted`** con `aggregateType = "ConsentimientoInformado"`.

| Evento (semántico) | Cuándo | Payload | Notas |
|---|---|---|---|
| `cons_inf.creado` | Tras `create` (borrador inserto) | `{ consentimientoId, instanciaId, episodioId, pacienteId, medicoQueInformaId, orgId }` | **No emitido hoy** — drift respecto al briefing. Se emite vía outbox solo en transiciones de estado. |
| `cons_inf.firmado_paciente` | Tras `firmarPaciente` (paciente o representante registró firma) | `{ consentimientoId, firmanteRol, firmaImagenUri, orgId }` | **No emitido hoy** — no avanza el workflow; el router actualiza columnas y retorna `ok:true`. |
| `cons_inf.firmado_medico` ≡ `workflow.transitionExecuted` | Tras `firmar` (MC autenticado con PIN) | `{ instanceId, tipoDocumentoCodigo: "CONS_INF", fromStateId, toStateId: "firmado", accion: "firmar", byUserId, firmaId }` + `contenidoHash` (SHA-256 del payload clínico) | **Emitido**. El consumidor que escucha doble firma completa debe filtrar por `tipoDocumentoCodigo` y `accion='firmar'`. |
| `cons_inf.validado` ≡ `workflow.transitionExecuted` | Tras `validar` (DIR) | `{ instanceId, accion: "validar", toStateId: "validado", byUserId }` | Emitido. |
| `cons_inf.revocado` | Solo pre-procedimiento | — | **No implementado** (ver §Drift). |

---

## Drift conocido (audit)

### 1. Doble dominio `consentimiento` — `/consents` (admin LOPD) vs `/ece/consentimiento` (clinical NTEC)

Existen **dos módulos** con nombre similar pero **dominios distintos** (CLAUDE.md §"Adecuar legacy vs duplicar" lo aclara explícitamente como **contra-ejemplo legítimo de coexistencia**):

| Aspecto | `/consents` (admin) | `/ece/consentimiento` (clinical) |
|---|---|---|
| Norma fuente | Ley de Protección de Datos Personales (Arts. 9 y 18) + GDPR/LOPD | NTEC Art. 39 + Art. 40 (Acuerdo 1616 MINSAL) |
| Propósito | Consentimiento de **tratamiento de datos** (purpose: data-processing, mpi-cross-org, transfusion, research, telemedicine) | Consentimiento **médico informado** previo a procedimiento de riesgo |
| Firmantes | **1 firma** del paciente (titular del dato) | **Doble firma**: paciente/representante + médico cirujano (MC) |
| Lifecycle | **Revocable** por el paciente en cualquier momento (`status: active | revoked | expired`) | **Inmutable post-firma** (Art. 40); rectificación solo por adendum |
| Tabla | `Consent` (Prisma — modelo legacy GDPR) | `ece.consentimiento_informado` (raw SQL — esquema NTEC) |
| Operador | Admin / Atención al Cliente | Médico tratante (MC) |

**Conclusión**: NO son duplicados. Coexisten legítimamente. Mantener etiquetas distintivas en sidebar:
- **Consentimientos LOPD** para `/consents` (admin).
- **Consentimientos informados** para `/ece/consentimiento` (clinical).

### 2. Estado `revocado` modelado pero sin transición

La columna `ece.consentimiento_informado.estado` admite `'revocado'` (CHECK constraint en `99_consentimiento_doble_firma_workflow.sql` línea 19) pero el seed de workflow (`08_seed_workflows.sql`) **no declara** la transición `firmado → revocado`. El trigger de inmutabilidad sí cubre el caso (`OLD.estado IN ('firmado', 'revocado')` ⇒ bloqueo), pero **no hay procedimiento tRPC** para ejecutar la revocación.

> **Pendiente**: definir si la revocación pre-procedimiento se modela como transición de workflow ECE (`firmado → revocado` con autorizador MC) o como **anulación** (`borrador → anulado` antes de firmar) más documento nuevo. Hoy, en la práctica, lo que existe es `anular` desde `borrador` (Art. 21 — autoriza DIR), lo cual **no cubre el caso de paciente que retira consentimiento ya firmado pero antes del procedimiento**.

### 3. Estados `pendiente_firma_paciente` / `pendiente_firma_mc` en UI sin reflejo en BD

El listado `apps/web/src/app/(clinical)/ece/consentimiento/page.tsx` mapea estados de UI `pendiente_firma_paciente`, `pendiente_firma_mc` que **no existen** en `ece.flujo_estado` (BD solo conoce `borrador | firmado | validado | anulado`). Son etiquetas semánticas que el front debería derivar de:
- `estado='borrador' AND evidencia_firma_ref IS NULL` ⇒ `pendiente_firma_paciente`.
- `estado='borrador' AND evidencia_firma_ref IS NOT NULL AND firma_mc_id IS NULL` ⇒ `pendiente_firma_mc`.

**Pendiente**: documentar la regla de derivación en el front o añadir vista BD que expose el estado semántico.

### 4. Eventos `cons_inf.creado` y `cons_inf.firmado_paciente` no emitidos

El briefing del template menciona estos eventos como esperados. **Hoy no se emiten**: el router solo invoca `emitDomainEvent` en `firmar` (paso del MC) con tipo `workflow.transitionExecuted`. La creación del borrador y la firma del paciente son operaciones silenciosas a nivel de outbox.

**Pendiente**: decidir si se emiten como eventos específicos del dominio (granularidad alta) o se mantienen subsumidos en `workflow.transitionExecuted` (granularidad baja).

### 5. CONS_QX como subtipo o como tipo_documento independiente

La columna `tipo` de `ece.consentimiento_informado` permite `quirurgico`, y existe la tabla satélite `ece.consentimiento_quirurgico`. El seed declara también un código `CONS_QX` independiente (visto en `router.ts` líneas 781+). Hay redundancia: ambos caminos existen y `crearQuirurgico` resuelve el tipo `CONS_QX` mientras inserta también en `consentimiento_informado` con `tipo='quirurgico'`.

**Pendiente**: unificar — o eliminar el `CONS_QX` del catálogo y usar solo el subtipo, o aislar `CONS_QX` con su propia cabecera independiente.

---

## Descripción markdown rica

El **Consentimiento Informado Médico (CONS_INF)** es el documento médico-legal que sustenta la decisión del paciente de someterse a un procedimiento de riesgo, conforme al **Art. 39 de la Norma Técnica del Expediente Clínico Electrónico** (Acuerdo n.° 1616 MINSAL, El Salvador). Es **obligatorio siempre** antes de toda hospitalización, acto quirúrgico, anestesia, transfusión, procedimiento ambulatorio mayor o atención por telemedicina; no aplica en consulta externa simple sin procedimientos. En flujo quirúrgico es **bloqueante**: el motor de workflow no permite ejecutar `ACTO_QX` sin un `CONS_INF` en estado `firmado` vinculado al mismo episodio.

La firma del documento es **doble por mandato normativo**: paciente (o representante legal con parentesco declarado, cuando el paciente no puede firmar — menor, incapacitado, inconsciente) **más** médico cirujano informante. En el sistema, la firma del paciente se captura como imagen (canvas o upload) y se almacena como URI/dataURL en `evidencia_firma_ref`; la firma del médico se ejecuta con **PIN electrónico argon2id** validado contra `ece.firma_electronica`, con lockout de 5 intentos. La sola firma del médico no es suficiente: el router rechaza el `firmar` si `evidencia_firma_ref` es NULL. Cuando aplica testigo (paciente analfabeto o que no puede firmar), su firma se documenta en el cuerpo del consentimiento mediante el campo opcional `datosTestigo`.

**Post-firma, el documento es estrictamente inmutable** por aplicación directa del **Art. 40 NTEC**. El trigger `ece.fn_bloquea_mutacion_consentimiento` (instalado en `99_consentimiento_doble_firma_workflow.sql`) hace cumplir esta restricción a nivel de motor de base de datos: cualquier `UPDATE` o `DELETE` sobre filas con `estado IN ('firmado', 'revocado')` lanza la excepción `mutacion_no_permitida` con referencia textual al artículo. Las correcciones admisibles son únicamente: (a) **adendum** — documento nuevo vinculado al original que aclara, amplía o corrige información; (b) **rectificación trazable** (Art. 42 NTEC) — registrando usuario, timestamp y detalle del cambio, sin sobrescribir el contenido original. La revocación, cuando es admisible, **solo procede pre-procedimiento**: si el paciente retira su consentimiento antes de que el acto quirúrgico haya iniciado, el documento puede pasar a estado `revocado` (modelado en la columna `estado` pero pendiente de transición de workflow — ver §Drift). Una vez iniciado el procedimiento, el consentimiento queda como evidencia documental permanente y no se retira.

**No confundir con `/consents` administrativo (LOPD)**: el HIS opera dos módulos de consentimientos que coexisten legítimamente porque cubren **dominios distintos**. `/consents` (admin) gestiona consentimientos de **tratamiento de datos personales** (data-processing, MPI cross-org, transfusión, investigación, telemedicina) bajo la **Ley de Protección de Datos Personales** y GDPR/LOPD: una sola firma del paciente, **revocable en cualquier momento**, ciclo `active | revoked | expired`. `/ece/consentimiento` (clinical) gestiona consentimientos **médicos informados** bajo NTEC Art. 39 / 40: doble firma paciente+MC, **inmutable post-firma**, ciclo `borrador → firmado → validado`. Los identificadores son distintos (`Consent` Prisma vs `ece.consentimiento_informado` raw SQL), los operadores son distintos (Admin/AC vs MC), las normativas fuente son distintas (LPDP/LOPD vs NTEC) y los lifecycles son incompatibles. CLAUDE.md §"Adecuar legacy vs duplicar" documenta este caso explícitamente como **contra-ejemplo de coexistencia legítima** — no consolidar.
