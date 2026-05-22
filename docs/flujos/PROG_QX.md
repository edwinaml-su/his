# PROG_QX — Programación Quirúrgica

## Metadata
- **codigo**: `PROG_QX` (PENDIENTE de siembra — al 2026-05-22 **no existe** en `ece.tipo_documento`. El listado de 19 documentos NTEC `§3.1..§3.19` sembrados en `packages/database/sql/63_ece_08_seed.sql` no incluye un tipo `PROG_QX` propio. La programación quirúrgica se ha implementado como **bridge atómico** sobre `ece.orden_ingreso` + `ece.reserva_sala_qx` en lugar de un documento ECE de pleno derecho).
- **nombre**: Programación Quirúrgica
- **modalidad**: `QUIRURGICO` (engloba electivo y urgente — la BD usa `modalidad='hospitalario'` para los documentos del acto operatorio; este flujo de planeación es transversal y aplica a Cirugía Mayor Ambulatoria (CMA) y a hospitalización).
- **NTEC artículo**: Acuerdo n.° 1616 MINSAL (30/05/2024, D.O. T.444 N°158) — **Art. 28** (lista de verificación preoperatoria — referencia del SQL `67_preop_checklist.sql:4`), Art. 17 lit. b (orden de ingreso como punto de inicio del episodio hospitalario), Art. 23 lit. a.4 (firma electrónica simple), Art. 39 (consentimientos informados quirúrgico y anestésico inmutables tras firma), Art. 55-56 (metadatos obligatorios + bitácora ≥ 10 años). El TDR HIS Multipaís §13.1 enumera los requisitos operativos del tablero. PENDIENTE — validar con @AE/@PO si el Acuerdo 1616 introduce un artículo específico para "programación quirúrgica" como acto documental separado o si su soporte legal vive en la Orden de Ingreso (`ORD_ING`) + Consentimiento Informado (`CONS_INF`) + Acto Quirúrgico (`ACTO_QX`).
- **modulo_his_target**: **EXTENDER `apps/web/src/app/(clinical)/ece/quirofano/programacion/`** (ya implementado: `page.tsx` calendario + `nueva/page.tsx` wizard). El módulo legacy `apps/web/src/app/(clinical)/surgery/` (TDR §13 — listado y wizard de `SurgeryCase` en Prisma `public`) **DUPLICA parcialmente** el dominio. Aplicar regla CLAUDE.md "adecuar legacy, NO duplicar": el dominio canónico ECE NTEC es `/ece/quirofano/programacion/`; `/surgery/` queda como cuenta operativa Prisma público para el tablero quirúrgico técnico (`SurgeryCase.signInAt/timeOutAt/signOutAt`). PENDIENTE — diff funcional formal y consolidar (#PR de unificación con redirect 301 desde `/surgery` al tablero ECE cuando aplique; o explicitar la coexistencia documentándola en el sidebar). Ver Stream E auditoría HE-01..HE-05 (`docs/audit/2026-05-19_audit_stream_e_quirofano.md`).
- **tabla_datos**: **NO es una sola tabla.** El flujo opera en transacción atómica sobre:
  - `ece.orden_ingreso` (Art. 17 lit. b — `motivo_ingreso_tipo='cirugia'`, `procedimiento_cie10`, `reserva_sala_qx_id`, `episodio_id`)
  - `ece.episodio_atencion` + `ece.episodio_hospitalario` (apertura de episodio quirúrgico)
  - `ece.preop_checklist` (NTEC Art. 28 — borrador creado en la misma tx; cabecera de `PREOP_CHECK`)
  - `ece.reserva_sala_qx` (catálogo en `ece.sala_qx`, archivo `99_sala_qx_reserva_sala_qx.sql`)
  - Bridge a `public.SurgeryCase` cuando se desee operación dual con el módulo Prisma legacy `/surgery/` (PENDIENTE — bridge formal aún no implementado).
- **inmutable**: `false` hasta `CONFIRMADA`; tras `CONFIRMADA` admite `REPROGRAMADA` (nueva fila con `version+1`, motivo obligatorio) y `CANCELADA` (estado terminal con motivo). Tras `EJECUTADA` (cuando se inserta el `ACTO_QX` vinculado, `ACTO_QX` sí es inmutable por seed `inmutable=true`).
- **tipo_registro**: **OBLIGATORIO** en cirugía electiva como prerrequisito al `ACTO_QX`. **CONDICIONAL** en urgencia: la cirugía urgente puede ejecutarse sin programación previa y la `PROG_QX` se registra post-evento para cierre documental (ver §Obligatoriedad).

## Propósito normativo
La programación quirúrgica es el **acto documental de planeación previa** que asigna en una misma decisión clínica-administrativa: paciente, procedimiento (CIE-10/CIE-10-PCS), equipo quirúrgico (cirujano principal, ayudantes, instrumentista), anestesiólogo, sala (`ece.sala_qx`), fecha y duración estimada, riesgo ASA preliminar y la valoración pre-anestésica programada. Es la **antesala obligatoria** del WHO Surgical Safety Checklist (`§13.3 TDR`, Sign-In/Time-Out/Sign-Out) y de la `lista de verificación preoperatoria` (`PREOP_CHECK`, NTEC Art. 28).

Su valor médico-legal cubre tres frentes: **(i) trazabilidad de la decisión quirúrgica** (qué se planeó vs qué se ejecutó — base para auditoría de complicaciones, eventos adversos quirúrgicos y NPS-Q), **(ii) gobierno de recursos** (asignación de sala/equipo, lista de espera, priorización clínica — TDR §13.1), y **(iii) cumplimiento ALARA y radioprotección preoperatoria** cuando aplique imagen intraoperatoria. Sin programación firmada por cirujano + coordinador QX, no se debe permitir el inicio del WHO checklist Sign-In en cirugía electiva.

Encaja en el flujo macro NTEC §1.7 "Ruta quirúrgica" (`analisis_workflows_ece.md` líneas 142-155): **7.1 Valoración preoperatoria → 7.2 Preparación → 7.3 Acto quirúrgico → 7.4 Recuperación postanestésica (URPA) → 7.5 Cuidados críticos**. La programación es el **paso 7.0 implícito** — la planeación que habilita los pasos 7.1-7.3.

## Dependencias (depende_de)
Documentos que DEBEN existir y estar firmados antes de crear (electiva) o registrar (urgencia) `PROG_QX`:
- **`FICHA_ID`** — raíz del expediente (Art. 15 NTEC). Sin Ficha no hay paciente sobre el cual programar.
- **`HIST_CLIN`** (modalidad ambulatoria o hospitalaria) — diagnóstico que motiva el procedimiento, codificado CIE-10. PENDIENTE — validar con @PO si `EVOL_MED` (Evolución Médica) puede sustituir a `HIST_CLIN` para pacientes ya hospitalizados con HC previa del episodio.
- **`HOJA_ING`** (Hoja de Ingreso) — **CONDICIONAL**: requerido cuando hay hospitalización previa al evento. Para cirugía mayor ambulatoria (CMA) el flujo es `HC_AMB + PROG_QX` directo sin ingreso previo; el `ORD_ING` se emite el mismo día.
- **`CONS_INF`** con `tipo='quirurgico'` y `tipo='anestesico'` (Doc 9 NTEC `analisis_workflows_ece.md §3.9`) — **debe estar firmado antes de la fecha programada**. Es `inmutable=true` en seed (`63_ece_08_seed.sql:61`). Sin consentimiento quirúrgico Y anestésico firmados, la transición `ASIGNADA → CONFIRMADA` debe bloquearse.
- **`SOL_EST`** + `RES_EST` (Solicitud y Resultado de Estudios pre-operatorios) — **CONDICIONAL** según riesgo ASA y tipo de procedimiento (TDR §13.2: "Lista de exámenes pre-operatorios completos"). Para ASA III-IV y cirugía mayor: obligatorio panel pre-operatorio (hemograma, química, coagulación, ECG, RX tórax) firmado y dentro de la ventana de validez clínica (típicamente ≤ 30 días).

Recomendados (no bloqueantes en el flujo actual del router `bridge-cirugia.router.ts`):
- Valoración preanestésica formal — actualmente embebida como subdocumento `valoracionPreop` JSONB en `ece.acto_quirurgico` (`ayuno_horas`, `asa_clase`, `alergias_relevantes`). PENDIENTE — promover a documento NTEC propio `VAL_PREANEST` con firma del anestesiólogo (auditoría Stream E HE-07 documenta 5 campos clínicos perdidos por falta de columnas en `ece.acto_quirurgico`).
- Marcaje del sitio quirúrgico (TDR §13.2) — registrado dentro de `preop_checklist.sitio_marcado` (boolean) en el momento del Sign-In. NO bloqueante para la programación.
- Reserva de hemoderivados, profilaxis antibiótica programada, profilaxis tromboembólica (TDR §13.2) — actualmente NO modelados como dependencia ni como campos estructurados. Auditoría HE-04 / HE-07 registra esta brecha.

## Obligatoriedad por modalidad / contexto
- **Cirugía electiva (hospitalaria)**: **OBLIGATORIA** — sin programación firmada no se permite Sign-In WHO. La fecha programada debe respetar ventana mínima de 24 h frente al `CONS_INF` quirúrgico firmado (período de reflexión recomendado NTEC, PENDIENTE confirmar artículo exacto).
- **Cirugía mayor ambulatoria (CMA)** (TDR §11 procedimientos ambulatorios + §13 quirófano): **OBLIGATORIA**, mismo día del ingreso. Flujo express: `HC_AMB → PROG_QX → CONS_INF → ORD_ING (mismo día) → ACTO_QX → URPA → Alta`.
- **Cirugía urgente / de emergencia**: **CONDICIONAL** — la programación puede registrarse **post-evento** (tras el `ACTO_QX`) para cierre documental. En este modo el estado inicial es `EJECUTADA` con backdate (`registro retroactivo` en términos NTEC, módulo `apps/web/src/app/(clinical)/ece/registro-retroactivo/` — ver HE pendiente). El motivo de urgencia (CIE-10 + categoría triaje) debe quedar registrado en `motivo_ingreso` de `orden_ingreso`.
- **Cirugía obstétrica de urgencia (cesárea)**: caso especial — la programación puede omitirse y el `ACTO_QX` se crea directo desde el flujo obstétrico (módulo `apps/web/src/app/(clinical)/ece/obstetricia/`). El registro retroactivo de `PROG_QX` es **OBLIGATORIO** dentro de las 48 h post-evento (TDR §13.6 trazabilidad).
- **Procedimiento menor / quirúrgico ambulatorio fuera de sala QX** (curaciones, suturas, biopsias — TDR §11): NO requiere `PROG_QX` formal. Se registra como `Nota de Procedimiento` (Doc 19 `DOC_ASOC`) + `CONS_INF` cuando aplique invasión.

## Roles firmantes / actores
| Rol | Acción | Momento | Firma electrónica |
|---|---|---|---|
| `MC` / `ESP` (Médico cirujano principal) | LLENA datos clínicos + indicación + tipo procedimiento + equipo propuesto; FIRMA al transicionar `SOLICITADA → ASIGNADA` (envío a coordinador) | Pre-programación, en consulta o pase de visita | **SI** (PIN argon2id contra `ece.firma_electronica`) |
| `COORD_QX` (Coordinador de quirófanos) | ASIGNA sala (`ece.sala_qx`), valida disponibilidad de equipo (anestesiólogo, instrumentista, circulante), fecha y hora finales; FIRMA al transicionar `ASIGNADA → CONFIRMADA` | Programación (puede ser días antes del evento) | **SI** | 
| `ANEST` (Anestesiólogo asignado) | VALORA preanestésica + ASA + tipo de anestesia planeada; FIRMA la valoración (subdocumento `valoracionPreop` embebido o `VAL_PREANEST` futuro) | Pre-evento (24-72 h antes en electivo; al ingreso en CMA) | **SI** | 
| `ENF` (Enfermería quirúrgica) | Verifica preparación del paciente (`PREOP_CHECK` Art. 28): ayuno, marcapasos, alergias, anticoagulantes, retiro de prótesis, identificación, sitio marcado, consentimiento físico presente, ASA | Día del evento, antes del Sign-In | **SI** sobre `PREOP_CHECK` |
| `DIR` (Dirección del establecimiento) | ANULA programación cuando aplique (transición universal `anular`, NTEC Art. 21) | Excepcional: error de identificación, duplicación, motivo médico-legal | **SI** | 

PENDIENTE — el rol `COORD_QX` **no está sembrado** en `ece.rol` al 2026-05-22. Los roles actuales del catálogo son MC, MT, ENF, ESP, IC, DIR, ADM, AC, ARCH (sembrados en `63_ece_08_seed.sql`). Para implementar la programación con dos firmas (cirujano + coordinador) hay tres alternativas:
1. **Sembrar `COORD_QX`** como rol nuevo en `ece.rol` y como entry de `documento_rol` para `PROG_QX`.
2. **Reutilizar `DIR`** como autoridad de programación (un coordinador con permisos delegados de Dirección).
3. **Modelo de un solo firmante** (`MC` o `ESP` único firmante) — más simple pero pierde el control 4-eyes que exige el TDR §13.1 ("Verificación de disponibilidad del cirujano y equipo, disponibilidad de sala").

Recomendación de @AE: opción 1 (rol propio `COORD_QX`) por trazabilidad y para diferenciar la firma del cirujano (intención clínica) de la del coordinador (gobierno de recursos).

## Campos obligatorios mínimos NTEC
Mapeo basado en el INSERT actual del router `packages/trpc/src/routers/ece/bridge-cirugia.router.ts` (paso 6, líneas 395-430) sobre `ece.reserva_sala_qx` + `ece.orden_ingreso`:

**Campos directos del flujo (todos NOT NULL en BD salvo indicado):**
- `paciente_id` — UUID FK a `ece.paciente` (vía `ece.episodio_atencion.paciente_id`).
- `episodio_id` — UUID NOT NULL FK a `ece.episodio_atencion` (creado en la misma tx atómica).
- `procedimiento_cie10` — TEXT NOT NULL. Almacenado en `ece.orden_ingreso.procedimiento_cie10` y replicado en `ece.reserva_sala_qx.procedimiento_cie10`. **Validar con catálogo CIE-10 / CIE-10-PCS** (auditoría HE pendiente — actualmente sin CHECK constraint).
- `motivo_ingreso` — TEXT (en `ece.orden_ingreso`). Con fallback a CIE-10 si se omite; **debe ser obligatorio en capa Zod**.
- `diagnostico_preoperatorio_cie10` — TEXT. PENDIENTE — actualmente NO existe como columna explícita; el diagnóstico preoperatorio formal se captura en `ece.acto_quirurgico.diagnostico_pre` al momento del Sign-In, no en la programación. Riesgo: si la cirugía se cancela, no queda registro del diagnóstico que motivó la programación.
- `fecha_inicio` (programada) — TIMESTAMPTZ NOT NULL. Equivale a `scheduledStart` de `SurgeryCase` legacy. La UI usa `toIsoOffset()` con TZ `America/El_Salvador`.
- `fecha_fin` (programada) — TIMESTAMPTZ NOT NULL. Restricción CHECK `fecha_fin > fecha_inicio`.
- `duracion_estimada_min` — INTEGER NOT NULL CHECK `BETWEEN 1 AND 1440`.
- `sala_qx_id` — UUID NOT NULL FK a `ece.sala_qx`. Catálogo de salas por establecimiento (`tipo IN ('mayor','menor','ambulatoria')`).
- `cirujano_id` — UUID NOT NULL (FK lógica a `ece.personal_salud.id`).
- `anestesiologo_id` — UUID nullable (cirugías sin anestesiólogo dedicado son válidas — anestesia local por cirujano).
- `estado` — TEXT NOT NULL DEFAULT `'programado'`, CHECK `IN ('programado','confirmado','en_curso','cancelado')` en `reserva_sala_qx`. **Este es el estado de datos** — el estado de workflow del documento ECE (cuando se promueva a tipo propio) vivirá en `ece.documento_instancia.estado_actual_id`.
- `reservado_por` — UUID NOT NULL (`ece.personal_salud.id`).
- `reservado_en` — TIMESTAMPTZ NOT NULL DEFAULT `now()` (metadato Art. 55).

**Campos NTEC requeridos que NO existen actualmente como columna estructurada (auditoría HE pendiente — gap P1):**
- `equipo_quirurgico` — JSONB con `{ cirujano_principal_id, ayudantes:[id], instrumentista_id, circulante_id }`. Actualmente solo se guarda `cirujano_id` plano.
- `tipo_anestesia_planeada` — enum `IN ('GENERAL','REGIONAL','LOCAL','SEDACION','NONE')` (Prisma `AnesthesiaType` ya existe en `schema.prisma:2478`).
- `riesgo_asa` (preoperatorio) — SMALLINT `BETWEEN 1 AND 5` (Prisma `AsaClass` ya existe en `schema.prisma:2488`; replicado en `ece.preop_checklist.riesgo_anestesico_asa`).
- `complejidad` — enum `IN ('BAJA','MEDIA','ALTA')` para priorización de lista de espera (TDR §13.1).
- `insumos_especiales_requeridos` — JSONB `[{ tipo, descripcion, lote_reservado, gtin }]` para prótesis, mallas, dispositivos (TDR §13.1, §13.6 trazabilidad UDI).
- `hemoderivados_reservados` — JSONB `{ tipo_componente, unidades, reserva_banco_id }` (TDR §13.1).
- `profilaxis_antibiotica` — JSONB `{ farmaco_id, dosis, momento_pre_incision_min }` (TDR §13.2 "en la 1ª hora previa a la incisión").
- `version` — INTEGER DEFAULT 1, incrementado en cada reprogramación trazable (Art. 42 NTEC).
- `motivo_reprogramacion` / `motivo_cancelacion` — TEXT. La cancelación ya existe (`motivo_cancelacion` en `reserva_sala_qx`); reprogramación NO está modelada como transición trazable separada.

Metadatos obligatorios Art. 55-56 NTEC (presentes vía bitácora del motor `documento_instancia_historial` cuando se promueva a documento ECE):
- `usuario_creador` (= `reservado_por`)
- `timestamp` precisión segundo (= `reservado_en`)
- Bitácora de modificaciones inmutable ≥ 10 años (NTEC retención clínica), append-only vía trigger `trg_historial_inmutable` cuando aplique.

## Estados (flujo_estado)
**Modelo propuesto** (al 2026-05-22 no sembrado en `ece.flujo_estado` porque `PROG_QX` no existe como `tipo_documento`):

| codigo | nombre | es_inicial | es_final | orden | semántica |
|---|---|---|---|---|---|
| `SOLICITADA` | Solicitada por cirujano | true | false | 1 | Cirujano firma la solicitud (CIE-10, equipo propuesto, fecha tentativa). Pendiente asignación de recursos. |
| `ASIGNADA` | Asignada (sala+equipo+fecha) | false | false | 2 | Coordinador asigna sala/equipo/fecha. Pendiente confirmación final (consentimientos, ASA, exámenes preop). |
| `CONFIRMADA` | Confirmada — lista para ejecutar | false | false | 3 | Todos los prerrequisitos verificados: `CONS_INF` quirúrgico+anestésico firmados, `PREOP_CHECK` aprobado, exámenes en ventana. Habilita Sign-In WHO. |
| `REPROGRAMADA` | Reprogramada (versión incrementada) | false | false | 4 | Cambio de fecha/sala/equipo con motivo obligatorio. NO es estado terminal — la nueva fila apunta a la versión previa vía `version_origen_id`. |
| `EJECUTADA` | Ejecutada (vinculada a ACTO_QX) | false | true | 5 | Sign-Out completado; `ece.acto_quirurgico.programacion_id` (PENDIENTE — campo a crear) cierra el ciclo. Final. |
| `CANCELADA` | Cancelada (con motivo) | false | true | 9 | Motivo obligatorio. Final. La reserva de sala libera el slot. |
| `ANULADA` | Anulada por Dirección | false | true | 10 | Universal NTEC Art. 21 — solo DIR puede anular un documento del expediente. Final. |

**Mapeo con estados de datos actuales** (`reserva_sala_qx.estado`):
- `programado` ≈ `SOLICITADA` ∪ `ASIGNADA` (la BD actual no diferencia estos dos pasos — gap funcional).
- `confirmado` ≈ `CONFIRMADA`.
- `en_curso` ≈ período entre Sign-In y Sign-Out (durante el `ACTO_QX`).
- `cancelado` ≈ `CANCELADA`.

**Estados terminales por defecto**: `EJECUTADA` (path feliz) o `CANCELADA`/`ANULADA` (path adverso).

## Transiciones (flujo_transicion)
**Modelo propuesto** (cuando `PROG_QX` se promueva a tipo de documento ECE de pleno derecho):

| origen | destino | acción | rol que autoriza | requiere firma | condición funcional |
|---|---|---|---|---|---|
| `(inicio)` | `SOLICITADA` | `crear_solicitud` | `MC` / `ESP` | NO | Captura mínima: paciente, CIE-10, equipo propuesto, fecha tentativa. |
| `SOLICITADA` | `ASIGNADA` | `asignar_recursos` | `COORD_QX` (o `DIR`) | **SI** | Disponibilidad verificada: sala libre en horario, cirujano y anestesiólogo sin conflicto. Verificación TOCTOU-safe con `pg_advisory_xact_lock(hashtext(sala_qx_id))` (ver auditoría HE-03). |
| `ASIGNADA` | `CONFIRMADA` | `confirmar` | `COORD_QX` | **SI** | Bloqueantes verificados: `CONS_INF` quirúrgico+anestésico firmados; `PREOP_CHECK` aprobado; exámenes pre-operatorios dentro de ventana (≤ 30 días según ASA); marcaje de sitio confirmado en `PREOP_CHECK`. |
| `ASIGNADA` | `REPROGRAMADA` | `reprogramar` | `COORD_QX` | **SI** | Motivo obligatorio (texto libre + categoría: `emergencia_prioritaria`, `paciente_no_apto`, `recurso_no_disponible`, `solicitud_paciente`, `otro`). Crea nueva fila `version+1`. |
| `CONFIRMADA` | `REPROGRAMADA` | `reprogramar` | `COORD_QX` | **SI** | Mismo motivo; obliga a re-validar `CONS_INF` si la nueva fecha excede ventana de 30 días desde la firma. |
| `CONFIRMADA` | `EJECUTADA` | `ejecutar` | `MC` (cirujano) | NO | Disparada automáticamente al `Sign-Out` del `ACTO_QX`. Crea vínculo `acto_quirurgico.programacion_id` (PENDIENTE — columna a añadir). |
| `SOLICITADA` | `CANCELADA` | `cancelar` | `MC` / `COORD_QX` | **SI** | Motivo obligatorio. Libera slot de sala. |
| `ASIGNADA` | `CANCELADA` | `cancelar` | `COORD_QX` | **SI** | Idem; obliga a notificar paciente (outbox `paciente.notificacion.cirugia_cancelada`). |
| `CONFIRMADA` | `CANCELADA` | `cancelar` | `MC` / `COORD_QX` / `ANEST` | **SI** | Motivo obligatorio (ej.: paciente afebril, ASA elevado descubierto en preop, ayuno no cumplido). |
| `*` | `ANULADA` | `anular` | `DIR` | **SI** | NTEC Art. 21 — universal. |

Transiciones bloqueadas (no permitidas):
- `EJECUTADA → cualquier` (terminal absoluto — la programación se concretó en `ACTO_QX` inmutable).
- `CANCELADA / ANULADA → cualquier` salvo creación de nueva programación con nuevo `id`.
- `CONFIRMADA → SOLICITADA` o `ASIGNADA → SOLICITADA` (rollback no permitido — usar `reprogramar` o `cancelar`).

## Eventos de dominio
Convención: `ece.prog_qx.<accion>`. El payload obligatorio incluye `organization_id`, `establishment_id`, `paciente_id`, `episodio_id`, `programacion_id`, `actor_id`, `timestamp`. Emisión vía outbox transaccional `notifications_outbox` (`packages/database/sql/42_notifications_outbox.sql`) Y audit hash chain (`audit.audit_log`).

- `ece.prog_qx.solicitada` — payload: `{ programacion_id, paciente_id, episodio_id, procedimiento_cie10, fecha_tentativa, equipo_propuesto, solicitante_id, timestamp }`
- `ece.prog_qx.asignada` — payload: `{ programacion_id, sala_qx_id, cirujano_id, anestesiologo_id, fecha_inicio, fecha_fin, asignado_por_id, firma_id, timestamp }`
- `ece.prog_qx.confirmada` — payload: `{ programacion_id, cons_inf_quirurgico_id, cons_inf_anestesico_id, preop_check_id, asa_class, confirmado_por_id, firma_id, timestamp }`
- `ece.prog_qx.reprogramada` — payload: `{ programacion_id, version_origen_id, version_nueva, motivo_categoria, motivo_texto, fecha_anterior, fecha_nueva, autor_id, firma_id, timestamp }`
- `ece.prog_qx.cancelada` — payload: `{ programacion_id, motivo_categoria, motivo_texto, cancelado_por_id, firma_id, timestamp }`
- `ece.prog_qx.ejecutada` — payload: `{ programacion_id, acto_qx_id, sign_out_at, cirujano_id, anestesiologo_id, timestamp }` (auto-disparado por `ACTO_QX.signOutAt`)
- `ece.prog_qx.anulada` — payload: `{ programacion_id, autorizado_por_dir_id, motivo, firma_id, timestamp }`

**Eventos actualmente emitidos** por `bridge-cirugia.router.ts:430-440` (al 2026-05-22):
- `ece.cirugia.programada` — único evento existente, dispara la creación atómica (paso 8 de la transacción).
- No hay eventos diferenciados de confirmación, reprogramación ni cancelación más allá del cambio de `estado` en `reserva_sala_qx`. PENDIENTE — implementar la matriz completa al promover `PROG_QX` a documento ECE.

## Drift conocido (audit) y riesgos
Hallazgos de `docs/audit/2026-05-19_audit_stream_e_quirofano.md` — Módulo 1 (Programación de Cirugías):

- **HE-01 [P0 — BLOQUEANTE Go-Live]** — Tablas `ece.reserva_sala_qx` y `ece.sala_qx` **no existen en producción** al momento de la auditoría (confirmado vía `information_schema.tables`). Toda llamada a `programarCirugia` y `listProgramacionDia` falla con `42P01: relation "ece.reserva_sala_qx" does not exist`. El DDL existe en `packages/database/sql/99_sala_qx_reserva_sala_qx.sql` pero **no ha sido aplicado al proyecto Supabase remoto**. **Acción inmediata**: aplicar el script 99 vía `mcp__supabase__apply_migration`.
- **HE-02 [P1 — ALTO]** — El bridge usa `ctx.prisma.$transaction` directamente sin `withWorkflowContext`. El rol Prisma `postgres.<ref>` tiene `BYPASSRLS`, por lo que las políticas RLS de `ece.orden_ingreso`, `ece.episodio_atencion`, `ece.preop_checklist` y `ece.reserva_sala_qx` **no se aplican** durante la transacción atómica. El aislamiento tenant depende exclusivamente del filtro JS `personal.establecimiento_id`. **Recomendación**: refactorizar para usar `withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {...})` y eliminar el comentario actual ("withTenantContext NO se usa") que documenta el anti-patrón.
- **HE-03 [P1 — ALTO]** — Race condition TOCTOU en `detectarConflictoSala`. La verificación de solapamiento de sala se ejecuta **antes** de abrir la transacción, abriendo ventana para doble-reserva concurrente. **Recomendación**: mover dentro de la transacción con `SELECT pg_advisory_xact_lock(hashtext(salaQxId))` para serializar el acceso por sala.
- **HE-04 [P2 — MEDIO]** — UI acepta UUIDs de cirujano/anestesiólogo/sala como **texto libre** en `<Input type="text">` sin combobox ni lookup. Errores FK solo aparecen en runtime. **Recomendación**: añadir `eceBridgeCirugia.listPersonalQx` y `listSalasQx` con `<Combobox>`.
- **HE-05 [P2 — MEDIO]** — Sin tests para `bridge-cirugia.router.ts`. El archivo de test en el directorio prueba `bridge-admision`, no cirugía (error de copia/pegado).
- **HE-07 [P1 — ALTO]** — 5 campos clínicos en Zod/UI del `acto_quirurgico` no tienen columna en BD (`tecnica`, `complicaciones`, `sangrado_estimado_ml`, `muestras_enviadas`, `tiempo_quirurgico_min`). El usuario los ingresa pero **se pierden silenciosamente**. Aunque esto afecta a `ACTO_QX` y no a `PROG_QX` directamente, refleja el mismo patrón de drift schema-router-UI que aplica al campo `equipo_quirurgico` y `tipo_anestesia_planeada` propuestos en este flujo.

Drift adicional detectado al 2026-05-22:
- **PROG_QX no está sembrado como `tipo_documento`** en `ece.tipo_documento`. La programación quirúrgica se opera como **bridge atómico** sin documento ECE de primera clase. Esto implica: (i) no hay workflow `borrador → firmado → validado` formal; (ii) no hay firma electrónica obligatoria por `ece.firma_electronica`; (iii) no hay bitácora `documento_instancia_historial` aplicada al ciclo de programación; (iv) la reprogramación trazable (Art. 42 NTEC) NO está implementada — solo cancelación + nueva fila sin vínculo de versión. **Decisión arquitectónica pendiente** (`@AE` + `@PO` + `@AS`):
  1. **Promover `PROG_QX` a tipo de documento ECE** con su tabla, workflow, firma y bitácora (alineación NTEC plena). Implica: añadir entry a `tipo_documento`, sembrar estados y transiciones, crear `ece.programacion_quirurgica` con FK a `documento_instancia`, y migrar `bridge-cirugia.router.ts` para usar el motor.
  2. **Mantener bridge atómico** y documentar formalmente que `PROG_QX` se respalda legalmente por `ORD_ING` + `CONS_INF` + `ACTO_QX` (cada uno con su firma) y que `reserva_sala_qx` es un mero registro operativo sin valor médico-legal directo.
- **Rol `COORD_QX` no sembrado** — el modelo de doble firma (cirujano + coordinador) propuesto en §Roles no se puede implementar sin sembrar el rol primero. Bloqueante para opción (1) anterior.
- **Duplicación con módulo legacy `/surgery`** — Prisma `SurgeryCase` (`schema.prisma:2518`) y `OperatingRoom` (`schema.prisma:2500`) en `public` modelan el caso quirúrgico con campos `signInAt/timeOutAt/signOutAt`, `asaClass`, `anesthesiaType`, `procedureCode`, `cancelReason`. El bridge no escribe en `SurgeryCase`. Hay dos pistas paralelas (`/surgery` y `/ece/quirofano/programacion`) que **no están sincronizadas**. PENDIENTE — bridge formal `SurgeryCase ↔ reserva_sala_qx` o consolidación.

## Descripción markdown rica (para BD `descripcion_markdown`)

> **Programación Quirúrgica (PROG_QX)** — Acto documental de **planeación previa** al procedimiento quirúrgico. Asigna en una sola decisión clínica-administrativa: **paciente, procedimiento (CIE-10/CIE-10-PCS), equipo (cirujano + ayudantes + instrumentista + circulante), anestesiólogo, sala, fecha y duración estimada, riesgo ASA preliminar y valoración pre-anestésica**. Constituye la antesala obligatoria del **WHO Surgical Safety Checklist** (Sign-In / Time-Out / Sign-Out) y de la **lista de verificación preoperatoria** (`PREOP_CHECK`, NTEC Art. 28).
>
> **Cuándo se usa:** toda cirugía electiva en sala de operaciones (hospitalaria o CMA). En cirugía urgente / de emergencia se registra **post-evento** como cierre documental (modo retroactivo) — el registro nunca se omite, solo se invierte temporalmente. No aplica a procedimientos menores fuera de sala QX (curaciones, suturas, biopsias ambulatorias), que se documentan como `Nota de Procedimiento` (`DOC_ASOC`) + `CONS_INF` cuando proceda.
>
> **Qué NO es:** no es el `Consentimiento Informado quirúrgico` ni `anestésico` (`CONS_INF` — documento separado, inmutable post-firma del paciente). No es la `Valoración Pre-anestésica` formal (subdocumento embebido o `VAL_PREANEST` futuro). No es la `Lista de verificación preoperatoria` (`PREOP_CHECK` Art. 28 — se ejecuta el día del evento, antes del Sign-In). No es la `Nota Operatoria` ni la `Descripción Operatoria` (`ACTO_QX` — documento del intra-operatorio, histórico inmutable).
>
> **Énfasis normativo:**
> - **Planeación previa OBLIGATORIA antes del WHO Checklist** — sin `PROG_QX` confirmada, el Sign-In en cirugía electiva no debe poder iniciarse. La motor de workflow debe enforzar `PROG_QX.estado=CONFIRMADA` como precondición de creación del `ACTO_QX` con `signInAt != null`.
> - **`CONS_INF` quirúrgico + anestésico firmado pre-fecha es bloqueante** — la transición `ASIGNADA → CONFIRMADA` se rechaza si los dos consentimientos no están firmados por el paciente/representante y por el médico que informa, con timestamp **anterior** a la fecha programada.
> - **Reprogramaciones reauditables** — todo cambio de fecha/sala/equipo crea una **nueva fila con `version+1`** apuntando al `version_origen_id`, con **motivo obligatorio** (categoría + texto libre). NUNCA se UPDATE-a la programación firmada — es rectificación trazable NTEC Art. 42.
> - **Riesgo ASA determina tipo de anestesia y monitoreo** — la valoración pre-anestésica firmada por el anestesiólogo asigna ASA (I-V), define el `tipo_anestesia_planeada` (GENERAL / REGIONAL / LOCAL / SEDACION / NONE) y, para ASA III-IV, **obliga** a reserva de cama de UCI post-quirúrgica y disponibilidad de hemoderivados verificada en `reserva_sala_qx` antes de `CONFIRMADA`. En ASA V (moribundo) la cirugía se ejecuta solo con autorización de Dirección + comité ECE documentada como `Junta Médica` (referencia Doc 19 `DOC_ASOC`).
> - **Disponibilidad de recursos verificada en transacción serializable** — sala libre en horario, cirujano sin solapamiento, anestesiólogo sin solapamiento, prótesis/insumos especiales reservados, hemoderivados (cuando aplique) y cama de recuperación/UCI verificados **dentro de la misma transacción** que crea la programación. La verificación TOCTOU-safe usa `pg_advisory_xact_lock(hashtext(sala_qx_id))` para serializar dos solicitudes concurrentes sobre la misma sala.
> - **Lista de espera quirúrgica con priorización clínica** (TDR §13.1) — cuando la solicitud no puede asignarse de inmediato, queda en estado `SOLICITADA` con campo `complejidad` (BAJA/MEDIA/ALTA) y categoría de prioridad clínica. La asignación posterior por `COORD_QX` debe ordenarse por prioridad clínica + fecha de solicitud + ASA, no por orden de llegada.
> - **Cancelación libera slot pero NO borra historial** — `CANCELADA` libera el slot de sala (`reserva_sala_qx.estado='cancelado'`) pero la fila permanece para auditoría. La cancelación con `motivo_cancelacion` se replica en `audit.audit_log` con hash chain.
>
> **Ejemplos típicos:**
> - Colecistectomía laparoscópica electiva programada con 7 días de antelación: `SOLICITADA` por cirujano general → `ASIGNADA` por coordinador (sala QX-3, anestesiólogo Dr. Pérez, 09:00, 90 min, ASA II) → `CONFIRMADA` tras `CONS_INF` quirúrgico+anestésico firmados y `PREOP_CHECK` aprobado el día previo → `EJECUTADA` al Sign-Out.
> - Cesárea de urgencia por sufrimiento fetal agudo: `ACTO_QX` se crea directo desde el flujo obstétrico; `PROG_QX` se registra retroactivamente dentro de 48 h con `estado=EJECUTADA` desde el inicio, `motivo_ingreso='cesarea_urgente'`, vinculada al `ACTO_QX` ya cerrado.
> - Reprogramación por paciente con ayuno no cumplido: programación original en `CONFIRMADA` para 08:00 → `REPROGRAMADA` a las 07:30 del mismo día con motivo `paciente_no_apto/ayuno_no_cumplido`, nueva fecha 14:00, `version=2`, `version_origen_id` apuntando a la fila original.
>
> **Errores comunes:**
> - Iniciar Sign-In del WHO Checklist sin `PROG_QX` en estado `CONFIRMADA` (cirugía electiva): viola el flujo y deja la planeación sin registro firmado.
> - UPDATE directo sobre `reserva_sala_qx` cambiando fecha/sala sin crear nueva versión (`version+1`) y motivo — viola Art. 42 NTEC (rectificación trazable).
> - Programar cirugía con `CONS_INF` quirúrgico firmado pero `CONS_INF` anestésico ausente — bloqueante en `ASIGNADA → CONFIRMADA`, pero el motor actual NO lo enforza.
> - Asignar sala sin verificar disponibilidad en la transacción (race condition HE-03) — produce doble-reserva en escenarios concurrentes.
> - Capturar el `equipo_quirurgico` solo como `cirujano_id` plano: pierde la información de ayudantes/instrumentista/circulante exigida por TDR §13.4 y por la trazabilidad de eventos adversos quirúrgicos.
> - Olvidar la reserva de hemoderivados o de cama UCI post-quirúrgica para ASA III-IV — bloqueante operativo el día del evento.
> - Backdating de `fecha_inicio` sin registrar el motivo de urgencia y sin pasar por `ece.registro_retroactivo` (módulo dedicado a la NTEC retroactiva): es manipulación de fechas, no rectificación válida.
