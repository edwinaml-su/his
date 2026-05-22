# IND_MED — Indicaciones Médicas

## Metadata

- **codigo**: IND_MED
- **nombre**: Indicaciones Médicas (diarias)
- **modalidad**: HOSPITALIZACION (diaria — registro obligatorio por jornada/turno) + AMBULATORIO (subset reducido = receta / prescripción farmacológica)
- **NTEC artículo**: Art. 36 (indicaciones médicas medicamentosas y no medicamentosas, firmadas diariamente). Conexos: Art. 23 lit. a.4 (firma electrónica simple por profesional), Art. 42 (rectificación trazable post-firma), Art. 55–56 (metadatos y bitácora ≥ 2 años). Doc 6 del catálogo NTEC (Acuerdo n.° 1616, MINSAL 2024 — D.O. T.444, N°158).
- **modulo_his_target**:
  - Legacy ambulatorio: `/pharmacy` (CPOE de receta ambulatoria — `Prescription` + `PrescriptionItem`).
  - ECE NTEC: `/ece/indicaciones` (lista + detalle) + `/ece/indicaciones/nueva` (creación). Kardex de administración: `/ece/kardex/[patientId]` y `/emar`.
  - Sin ruta legacy `/indications/` separada (no existe en el repositorio — CLAUDE.md "Adecuar legacy vs duplicar": el dominio se cubre desde `/pharmacy` para ambulatorio y desde `/ece/indicaciones` para hospitalización diaria).
- **tabla_datos**: `ece.indicaciones_medicas` + `ece.indicacion_item` + `ece.administracion_medicamento` (registro NTEC). Bridge operativo a `public.Prescription` + `public.PrescriptionItem` (TDR §15 — CPOE) y `public.MedicationAdministration` (TDR §16 — eMAR/BCMA).
- **inmutable**: true post-firma diaria (Art. 36 + Art. 42). El cierre diario fija un snapshot inmutable; modificaciones intra-día anteriores a la firma siguen el patrón de versionado optimistic (campo `version`); cambios post-firma exigen nueva instancia (nueva indicación firmada, suspender/cancelar la previa).
- **tipo_registro**: OBLIGATORIO DIARIO en hospitalización (revisión diaria por médico tratante con firma electrónica simple). En ambulatorio: transaccional condicional (solo si hay prescripción).

## Propósito normativo

Las indicaciones médicas son el acto documental por el cual el médico tratante ordena las acciones terapéuticas (medicamentosas y no medicamentosas), de cuidado de enfermería, dietéticas, de líquidos endovenosos, de monitorización, de profilaxis y de apoyo diagnóstico que el paciente debe recibir en cada jornada de atención. Constituyen el soporte médico-legal de la responsabilidad prescriptiva del médico (Art. 36 NTEC) y la fuente única de verdad clínica para el ciclo del medicamento (TDR §15 — Prescripción → Validación farmacéutica → Dispensación → Administración eMAR → Devolución → Conciliación) y para el plan de cuidados de enfermería (TDR §11.3, §16 eMAR).

En hospitalización, las indicaciones se renuevan obligatoriamente al menos una vez por jornada (visita médica diaria) — esa periodicidad diaria es el rasgo distintivo del Art. 36 frente a la receta ambulatoria. Cada conjunto de indicaciones del día queda como instancia firmada e inmutable; cuando el médico decide modificar el plan terapéutico, debe suspender o cancelar la indicación previa y emitir una nueva (no se sobrescribe un documento ya firmado — Art. 42).

En ambulatorio, las indicaciones se reducen al subconjunto medicamentoso entregado como **receta** (subset operativo); el flujo legacy ambulatorio HIS lo modela con `Prescription` + `PrescriptionItem` (TDR §15.3 CPOE) y no requiere registro separado ECE de indicaciones más allá de la receta firmada.

La firma electrónica simple del médico es obligatoria por instancia (Art. 23 lit. a.4 NTEC). Sin firma, la indicación está en `borrador` y la enfermería no debe ejecutarla (la generación de slots eMAR / líneas de administración pendientes se dispara en el outbox al evento `ece.indicaciones.firmadas`).

## Dependencias (depende_de)

- **HOJA_ING** — admisión hospitalaria firmada. Sin episodio hospitalario abierto y hoja de ingreso no procede emitir indicaciones (FK `episodio_id NOT NULL` en `ece.indicaciones_medicas`).
- **HIST_CLIN** — la Historia Clínica establece el diagnóstico que justifica las indicaciones. En ambulatorio la receta se vincula a `encounterId` de la consulta.
- **VAL_INI_ENF** (recomendado, no bloqueante) — la Valoración Inicial de Enfermería identifica alergias, riesgos de caída, riesgos de UPP (Braden) y otros datos que el médico debe considerar al prescribir (TDR §15.3 alerts: alergias, función renal/hepática, edad pediátrica/geriátrica, embarazo/lactancia).
- **FICHA_ID** — dependencia transitiva. La identificación del paciente debe estar verificada (Art. 15 NTEC) y el brazalete GS1/GSRN emitido para habilitar BCMA bedside.

## Obligatoriedad por modalidad / contexto

| Modalidad | Obligatoriedad | Justificación |
|---|---|---|
| HOSPITALIZACION (general, servicios médicos / quirúrgicos) | **SI — cada jornada (cierre diario obligatorio)** | Art. 36 NTEC: indicaciones diarias firmadas. Es el documento que ordena el plan terapéutico de las próximas 24 h. |
| HOSPITALIZACION (UCI/UCIN/UCIP/UCO) | SI — frecuencia configurable (diario o intra-día) | Pacientes críticos pueden requerir ajustes intra-día (vasoactivos, sedación, ventilatorio); cada cambio genera nueva instancia firmada. TDR §11.5 FAST HUG check diario. |
| HOSPITAL DE DIA (estancia < 24 h) | SI — única instancia para el día | Toda estancia hospitalaria con orden de ingreso requiere indicaciones del día (TDR §11.1). |
| AMBULATORIO (Consulta Externa) | CONDICIONAL — solo si plan terapéutico farmacológico | Se materializa como **receta** (`Prescription`); no se emite documento ECE separado para indicaciones higiénico-dietéticas (estas viven en la nota de evolución / plan SOAP del HIST_CLIN). |
| AMBULATORIO (Emergencia sin ingreso) | CONDICIONAL | Si la disposición es alta ambulatoria y hay tratamiento medicamentoso → receta de emergencia. |
| Egreso hospitalario | SI (subset) | "Indicaciones para la casa" + receta de egreso forman parte de la Epicrisis (TDR §11.7). |

## Roles firmantes / actores

| Rol | Acción | Momento |
|---|---|---|
| MC (Médico de Cabecera / Médico Tratante) | Llena las indicaciones (CPOE) y firma electrónicamente al cierre de la visita médica diaria. | Visita médica diaria (al menos una vez por jornada). |
| MT (Médico de Turno) | Llena indicaciones de turno cuando el MC no está disponible (turno noche, fin de semana). | Eventos intra-día o turno fuera de horario. |
| RES (Residente) | Acompañamiento / pre-llenado bajo supervisión del MC. La firma legal final es del MC (no del residente solo). | Pase de visita docente / pre-llenado. |
| ESP (Especialista interconsultante) | Indicaciones específicas de interconsulta — se incorporan al plan del MC tratante. | Tras respuesta de RRI. |
| ENF (Enfermería) | Lectura, transcripción al kardex / eMAR y ejecución de cada dosis con BCMA 5R. Sin firma de prescripción; firma su propio acto de administración (REG_ENF / `ece.administracion_medicamento`). | Continuo durante el turno. |
| QFB (Farmacéutico clínico) | Validación farmacéutica de la prescripción (alertas, interacciones, dosis). | Cola de validación pre-dispensación (TDR §15.4 — parametrizable por área). |
| DIR (Dirección) | Anula la indicación firmada por motivos médico-legales (transición universal `anular`). | Excepcional. |

Notas:

- En `ece.documento_rol` seeded (`63_ece_08_seed.sql:160-161`): `IND_MED` requiere LLENA + RESPONSABLE + FIRMA del MC; AUTORIZA por ENF (transcripción/verificación al kardex).
- En el router actual (`packages/trpc/src/routers/ece/indicaciones-medicas.router.ts`): `list`, `get`, `listAdministraciones` → `PHYSICIAN | NURSE`; `create`, `update`, `firmar` → `PHYSICIAN`; `suspender`, `cancelar` → `PHYSICIAN | NURSE` (cancelación con motivo); `registrarAdministracion` → `NURSE`.

## Campos obligatorios mínimos NTEC

Mapeo basado en `ece.indicaciones_medicas` + `ece.indicacion_item` (`packages/database/sql/61_ece_06_documentos.sql:81-100` + `98_ind_constraints.sql`):

### Encabezado `ece.indicaciones_medicas`

- `id` — UUID, generado por BD.
- `instancia_id` — UUID, FK a `ece.documento_instancia` (vínculo al motor workflow).
- `episodio_id` — UUID NOT NULL, FK a `ece.episodio_atencion`.
- `fecha_hora` — TIMESTAMPTZ NOT NULL DEFAULT now() — momento del acto prescriptivo (precisión segundo, Art. 55 NTEC).
- `vigencia` — TEXT NOT NULL DEFAULT `'ACTIVA'`, CHECK `IN ('ACTIVA','SUSPENDIDA','CANCELADA')` (CHK `chk_ind_vigencia`, migración `98_ind_constraints.sql:17`).
- `version` — INT NOT NULL DEFAULT 1 — optimistic lock para edición en borrador.
- `medico_prescriptor` — UUID NOT NULL, FK a `ece.personal_salud`.
- `transcripcion_enf` — UUID NULLABLE, FK a `ece.personal_salud` (enfermería que transcribe al kardex; se setea a NULL al firmar para reset cuando aplique).
- `estado_registro` — TEXT NOT NULL DEFAULT `'borrador'`, CHECK `IN ('borrador','firmado','validado')` (CHK `chk_ind_estado_registro`).
- `digitado_retroactivamente` — BOOLEAN NOT NULL DEFAULT false (TRUE cuando se registra papel post-evento de contingencia, ver Stream Contingencia).
- `timestamp_real_papel` — TIMESTAMPTZ NULL (momento real de la indicación en papel durante contingencia).
- `contingencia_evento_id` — UUID NULL (FK al evento de contingencia que justifica registro retroactivo).
- `registrado_en` — TIMESTAMPTZ NOT NULL DEFAULT now() (bitácora interna, Art. 55–56).

### Item terapéutico `ece.indicacion_item`

- `id` — UUID, generado por BD.
- `indicacion_id` — UUID NOT NULL, FK a `ece.indicaciones_medicas`.
- `tipo` — TEXT NOT NULL, enum lógico `('MEDICAMENTO','PROCEDIMIENTO','DIETA','CUIDADO_GENERAL','ESTUDIO')`. Hallazgo IND-002: campo es `text` sin CHECK enum en BD (validación solo a nivel router/Zod — gap follow-up).
- `descripcion` — TEXT NOT NULL — texto libre estructurado por tipo (e.g. "Cefalosporina 1g IV c/8h por 7 días", "Dieta blanda hiposódica", "Curación de herida diaria con SSN").
- `dosis` — TEXT NULLABLE — "500 mg", "1 ampolla" (hallazgo IND-002 P1: divergencia de tipos contra `PrescriptionItem.dosage VARCHAR(120)` y `MedicationAdministration.doseAmount DECIMAL(12,4) + doseUnit VARCHAR(20)`).
- `via` — TEXT NULLABLE — enum lógico `(ORAL|IV|IM|SC|TOPICAL|INHALED|RECTAL|SUBLINGUAL|OPHTHALMIC|OTIC|NASAL)`. Validación Zod en router; BD lo permite como texto libre.
- `frecuencia` — TEXT NULLABLE — enum lógico `(QD|BID|TID|QID|Q4H|Q6H|Q8H|Q12H|Q24H|STAT|PRN)`. Validación Zod en router; BD lo permite como texto libre.
- `duracion` — TEXT NULLABLE — "7 días", "según evolución".

### Mapeo a entidades operativas (bridge)

Cuando se sincroniza a pharmacy operacional (TDR §15):

- `public.Prescription` (modelo Prisma): `encounterId`, `prescriberId`, `patientId`, `prescribedAt`, `status` (`PrescriptionStatus`: DRAFT|SIGNED|DISPENSED|PARTIALLY_DISPENSED|CANCELLED|EXPIRED), `signedAt`, `signedHash` (firma electrónica simple).
- `public.PrescriptionItem`: `drugId` (FK `Drug`), `dosage VARCHAR(120)`, `route AdminRoute`, `frequency VARCHAR(80)`, `durationDays INT`, `prnAsNeeded BOOLEAN`, `prescribedQty DECIMAL(12,4)` (base para cumulative-qty enforcement Beta.8), `administeredQty DECIMAL(12,4)` (trigger).

Cuando se ejecuta administración bedside (TDR §16 eMAR + GS1 5 Correctos):

- `public.MedicationAdministration`: `prescriptionItemId`, `administeredAt`, `administeredById`, `secondVerifierId` (doble-check para alto riesgo / controlados), `status` (`MedAdminStatus`: SCHEDULED|ADMINISTERED|GIVEN|HELD|REFUSED|MISSED|DOCUMENTED_LATE|CANCELED), `doseAmount DECIMAL(12,4)`, `doseUnit VARCHAR(20)`, BCMA scans (`patientBarcodeScanned`, `drugBarcodeScanned`, `providerBadgeScanned`), GS1 (`gtinScanned`, `loteScanned`, `serieScanned`, `gsrnPaciente`, `gsrnEnfermera`, `glnUbicacion`), `bedsideValidationId` (FK al evento bedside), `timingWindowMinutes` (default 30, Beta enforcement), `overrideReason`, `cancelReason`/`canceledAt`/`canceledById`.

Equivalente ECE: `ece.administracion_medicamento` con `registro_enf_id`, `indicacion_item_id`, `hora_programada`, `hora_aplicada`, `estado` (CHK `chk_admin_med_estado` `IN ('PROGRAMADA','ADMINISTRADO','OMITIDA','RECHAZADA')`), `motivo_omision` (obligatorio cuando estado OMITIDA|RECHAZADA — validado en Zod, hallazgo IND-004 follow-up para CHECK condicional en BD), `responsable`.

## Estados (flujo_estado)

Sembrados en el motor workflow ECE (`docs/backlog/fase2/_insumos/08_seed_workflows.sql:94-95`):

| codigo | nombre | es_inicial | es_final | orden | notas |
|---|---|---|---|---|---|
| `borrador` | Borrador | true | false | 1 | Editable por MC; ENF no debe ejecutar. |
| `firmado` | Firmado | false | false | 3 | Inmutable; ENF puede transcribir al kardex y ejecutar. Dispara outbox `ece.indicaciones.firmadas`. |
| `validado` | Validado | false | true | 4 | ENF confirma transcripción (`validar`). Estado terminal del workflow ECE. |
| `anulado` | Anulado | false | true | 9 | Terminal alterno. Solo DIR puede transicionar (universal `anular`). |

Vigencia (campo independiente del estado de workflow) — modela el ciclo terapéutico:

- `ACTIVA` — la indicación está en ejecución y la enfermería debe administrarla.
- `SUSPENDIDA` — pausada temporalmente (e.g. paciente NPO para procedimiento); no se cancela.
- `CANCELADA` — cesa definitivamente (el médico decide retirar el medicamento, cambio de plan terapéutico).

Estado de administración por ítem (`ece.administracion_medicamento.estado`):

- `PROGRAMADA` — slot generado por el motor MAR a partir del evento `ece.indicaciones.firmadas` (frecuencia × duración).
- `ADMINISTRADO` — enfermería ejecutó con BCMA 5R; debe ser inmutable (hallazgo IND-003 P1, trigger pendiente).
- `OMITIDA` — no se aplicó por motivo clínico (paciente NPO, vómito, paciente fuera de sala); requiere `motivo_omision` ≥ 10 caracteres.
- `RECHAZADA` — paciente rechazó la dosis; requiere `motivo_omision`.

## Transiciones (flujo_transicion)

Workflow ECE (`08_seed_workflows.sql:94-95` + universal `anular` líneas 128-134):

| origen | destino | acción | rol_autoriza | requiere_firma | condición |
|---|---|---|---|---|---|
| `borrador` | `firmado` | `firmar` | MC | **true** (PIN MC) | Firma electrónica simple del médico prescriptor (Art. 23 lit. a.4 NTEC). Cierra la edición. |
| `firmado` | `validado` | `validar` | ENF | false | Enfermería confirma transcripción al kardex. Habilita ejecución. |
| `borrador` | `anulado` | `anular` | DIR | **true** | Universal — error médico-legal de la indicación en borrador. |

Vigencia (transiciones del campo terapéutico, ortogonal al workflow):

| origen | destino | acción | rol | condición |
|---|---|---|---|---|
| `ACTIVA` | `SUSPENDIDA` | `suspender` | MC / ENF | Motivo obligatorio (1–500 chars). |
| `ACTIVA` | `CANCELADA` | `cancelar` | MC | Motivo obligatorio (1–500 chars). MC ratifica cese definitivo. |
| `SUSPENDIDA` | `ACTIVA` | (reactivar) | MC | Implementación pendiente — actualmente solo trayectoria unidireccional. |

Administración por ítem:

| origen | destino | acción | rol | condición |
|---|---|---|---|---|
| (sin admin) | `PROGRAMADA` | (auto motor MAR) | sistema | Tras `ece.indicaciones.firmadas`. |
| `PROGRAMADA` | `ADMINISTRADO` | `registrarAdministracion` | ENF | BCMA 5R completo: paciente (GSRN) + medicamento (GTIN+lote+serie) + enfermera (GSRN) + ubicación (GLN) + ventana de tiempo ±30 min. |
| `PROGRAMADA` | `OMITIDA` / `RECHAZADA` | `registrarAdministracion` | ENF | `motivo_omision` obligatorio ≥10 chars (validado Zod). |

## Eventos de dominio

Emitidos por el router ECE Indicaciones y bridges asociados:

- `ece.indicaciones.creadas` — al INSERT en estado `borrador` (creación inicial por MC).
- `ece.indicaciones.firmadas` — transición borrador → firmado. **Evento crítico de orquestación**: el motor MAR (Stream 30) consume este evento desde el outbox y genera los slots `PROGRAMADA` en `ece.administracion_medicamento` según `frecuencia × duracion` de cada item de tipo `MEDICAMENTO`. Payload: `{ indicacionId, episodioId, medicoId, itemCount, organizationId }` (ver `packages/contracts/src/events/payloads.ts:257`).
- `ece.indicaciones.modificadas` — re-firma requerida cuando hay cambio post-firma. Implementación: suspender la indicación previa + crear nueva instancia + firmar (no se hace UPDATE in-place sobre la firmada).
- `ece.indicaciones.suspendidas` — vigencia ACTIVA → SUSPENDIDA.
- `ece.indicaciones.canceladas` — vigencia ACTIVA → CANCELADA.
- `ece.administracion.registrada` — al INSERT en `ece.administracion_medicamento` (cualquier estado). Payload `{ administracionId, registroId, indicacionItemId, episodioId, enfermeraId }`.
- `ind_med.medicamento_administrado` — BCMA 5R completado con éxito. Equivale al evento legacy `medication.administered` (TDR §16). Dispara contadores de adherencia y trazabilidad GS1 (TBR — Total Bedside Record).
- `pharmacy.prescription.signed` (bridge) — cuando el subset ambulatorio se materializa como `Prescription` con `status=SIGNED`.

## Drift conocido (audit) y riesgos

Auditoría Stream B (`docs/audit/2026-05-19_audit_stream_b_clinico_activo.md`), commit `6532a92`:

- **IND-001 [P0] CERRADO** — Ruta UI y router completamente ausentes. **Cerrado** por el router `packages/trpc/src/routers/ece/indicaciones-medicas.router.ts` y las páginas `apps/web/src/app/(clinical)/ece/indicaciones/` (list + detalle + nueva). Quedan flujos `firmar` y `registrarAdministracion` cableados con `ece.indicaciones.firmadas` emitido.
- **IND-002 [P1 — FOLLOW-UP]** — `indicacion_item.dosis/via/frecuencia` son `text` libre sin enum constraint en BD. Validación solo a nivel router/Zod. **Impacto**: el puente ECE↔pharmacy no puede hacer join estructurado de manera robusta (string "500mg" → no decimal). **Remediación**: añadir columnas estructuradas `dosis_valor DECIMAL(12,4)`, `dosis_unidad VARCHAR(20)`, `via_codigo TEXT` con CHECK alineado a `AdminRoute`. Mantener `dosis` como legacy de transición.
- **IND-003 [P1 — FOLLOW-UP]** — `ece.administracion_medicamento` no tiene trigger de inmutabilidad post-`ADMINISTRADO`. El equivalente `public.MedicationAdministration` sí lo tiene (`fn_emar_immutable_post_administered`). **Impacto**: un registro ECE de administración puede ser modificado post-hecho, rompiendo integridad clínica. **Remediación**: trigger análogo `fn_ece_admin_med_immutable`. Bloqueante go-live para integridad de eMAR ECE.
- **IND-004 [P2 — FOLLOW-UP]** — `motivo_omision` nullable sin CHECK condicional. Cuando `estado IN ('OMITIDA','RECHAZADA')` el motivo debería ser NOT NULL en BD. Hoy se valida solo en Zod (`superRefine` en `administracionSchema`). **Remediación**: `CHECK (estado NOT IN ('OMITIDA','RECHAZADA') OR motivo_omision IS NOT NULL)`.
- **IND-005 [P2 — CERRADO]** — `vigencia` y `estado_registro` sin enum constraint. **Cerrado** por `packages/database/sql/98_ind_constraints.sql` (CHK `chk_ind_vigencia`, `chk_ind_estado_registro`, `chk_admin_med_estado`).

Riesgos residuales:

- Doble tracking semántico entre `ece.indicaciones_medicas.estado_registro` (workflow ECE: borrador/firmado/validado/anulado) y `vigencia` (terapéutico: ACTIVA/SUSPENDIDA/CANCELADA). El designer de workflow debe presentar ambos sin confundirlos — son ortogonales.
- Generación automática de slots de administración tras `ece.indicaciones.firmadas` depende del motor MAR (Stream 30); si el outbox falla o el consumer no procesa, no se crean slots `PROGRAMADA` y la enfermería no ve el plan en eMAR.
- Subset ambulatorio (receta) hoy vive como `Prescription` legacy sin sync directa a `ece.indicaciones_medicas`. Para registros ECE ambulatorios "puros" se requeriría bridge inverso `pharmacy → ece.indicaciones_medicas` que no existe (decisión consciente: en ambulatorio, la receta es el documento legal — Art. 36 aplica a hospitalización diaria).
- `transcripcion_enf` se setea a NULL en `firmar()` — esto es intencional para forzar nueva transcripción tras cada firma, pero pierde el rastro del enfermero que transcribió la versión previa. La trazabilidad histórica completa vive en el audit hash chain (`audit.audit_log`).

## Descripción markdown rica (para BD `descripcion_markdown`)

Las **Indicaciones Médicas (IND_MED)** son el documento clínico que materializa el plan terapéutico del médico tratante para una jornada hospitalaria o, en subset ambulatorio, la receta de medicamentos. Su fundamento normativo es el **artículo 36 de la NTEC (Acuerdo n.° 1616, MINSAL 2024)** que exige el registro firmado diariamente de todas las indicaciones — medicamentosas y no medicamentosas — durante la hospitalización. Junto con la Historia Clínica de ingreso, la Hoja de Evolución y el Registro de Enfermería, conforman el núcleo asistencial del expediente clínico electrónico.

### Énfasis normativo: cierre diario OBLIGATORIO (Art. 36)

En hospitalización general, intermedios y UCI, el médico tratante debe firmar **al menos una vez por jornada** un conjunto completo de indicaciones que cubra las próximas 24 horas (o el ciclo de la unidad — en UCI puede haber múltiples revisiones intra-día). El cierre diario es el rasgo que distingue las indicaciones de la receta ambulatoria: no es un acto puntual de prescripción, sino una **renovación obligatoria periódica del plan terapéutico** que evidencia la presencia y la decisión clínica del médico cada día.

Cuando el médico no realiza la visita diaria y no emite indicaciones nuevas, el sistema debe alertar a la dirección médica del servicio. La ausencia de indicaciones firmadas del día es un hallazgo médico-legal contra el establecimiento (incumplimiento Art. 36) y un riesgo asistencial (la enfermería no tiene plan validado para administrar).

### BCMA 5R y trazabilidad GS1 — el evento crítico `ind_med.medicamento_administrado`

La firma de las indicaciones (`borrador → firmado`) dispara el evento outbox `ece.indicaciones.firmadas`, consumido por el motor MAR que genera los slots `PROGRAMADA` en `ece.administracion_medicamento` (y su equivalente operativo `MedicationAdministration` con `status=SCHEDULED`) según `frecuencia × duracion` de cada item de tipo MEDICAMENTO.

En la cabecera del paciente, antes de cada administración, la enfermería ejecuta el flujo BCMA 5 Correctos con identificadores GS1:

1. **Paciente correcto** — scan del brazalete `GSRN` del paciente.
2. **Medicamento correcto** — scan del envase con `GTIN-14`, `lote`, `serie` (cuando aplica) y validación de no-vencimiento.
3. **Dosis correcta** — match contra `prescribedQty`/`doseAmount` del `PrescriptionItem` enlazado.
4. **Vía correcta** — match contra `route` del item.
5. **Hora correcta** — dentro de la ventana de tolerancia `timingWindowMinutes` (default ±30 min sobre `scheduledTime`).

Adicionalmente: scan del badge `GSRN` de la enfermera (identificación del responsable) y captura del `GLN` de ubicación (sala/cama). Solo cuando los tres scans BCMA (`patientBarcodeScanned`, `drugBarcodeScanned`, `providerBadgeScanned`) están en `true` el status puede transicionar a `ADMINISTERED` (regla seeded en `packages/database/sql/95_cumplimiento_operacional.sql` y `packages/trpc/src/gs1/validate-5-correctos.ts`).

El evento `ind_med.medicamento_administrado` (alias `ece.administracion.registrada` con status `ADMINISTRADO`) cierra el ciclo: alimenta indicadores de adherencia, dispara conciliación de inventario (devolución de unidades no usadas), y deja constancia trazable lote-paciente para farmacovigilancia (Centro Nacional de Farmacovigilancia / DNM El Salvador, TDR §15.10).

### Inmutabilidad post-firma y patrón de rectificación

Una vez firmadas, las indicaciones del día **no se pueden modificar** (Art. 36 + Art. 42 NTEC). Si el plan terapéutico cambia intra-día (resultado de laboratorio que obliga ajuste, evento adverso, evolución del paciente), el médico debe:

1. **Suspender o cancelar** la indicación previa con motivo documentado (`suspender` o `cancelar` — vigencia ACTIVA → SUSPENDIDA/CANCELADA).
2. **Crear una nueva instancia** de indicación en `borrador` con el plan actualizado.
3. **Firmar la nueva instancia** (`firmar` → `firmado`).

La indicación previa permanece en el expediente como histórico inmutable; solo cambia su vigencia. Esto preserva la cadena de decisiones clínicas y la responsabilidad del prescriptor en cada momento.

### Subset ambulatorio = prescripción / receta

En ambulatorio, las indicaciones se reducen a la **receta de medicamentos** (TDR §15.3 CPOE), modelada en `public.Prescription` + `public.PrescriptionItem` del HIS legacy. Aplican las mismas validaciones clínicas en tiempo real (alergias, interacciones, dosis máximas, ajuste por función renal/hepática, embarazo/lactancia, edad pediátrica) que en CPOE hospitalario, pero no hay obligación de cierre diario: la receta es un acto puntual de prescripción al cierre de la consulta. Indicaciones higiénico-dietéticas, recomendaciones de actividad y educación al paciente quedan registradas en la nota de evolución (parte del HIST_CLIN), no en un documento ECE separado.

Esta diferenciación es deliberada: el ECE NTEC requiere `IND_MED` con firma diaria solo en hospitalización; el flujo ambulatorio cumple Art. 36 vía receta firmada por consulta. El sidebar HIS debe presentar un único item por dominio (`/pharmacy` ambulatorio + `/ece/indicaciones` hospitalario), respetando la regla "Adecuar legacy vs duplicar" (CLAUDE.md regla permanente).

### Cumplimiento normativo

- **NTEC Art. 36** — indicaciones medicamentosas y no medicamentosas firmadas diariamente en hospitalización (base normativa principal).
- **NTEC Art. 23 lit. a.4** — firma electrónica simple por profesional (PIN argon2id contra `ece.firma_electronica`).
- **NTEC Art. 42** — rectificación trazable: cambio post-firma vía nueva instancia, no UPDATE in-place. Versionado con `version` (optimistic lock) en borrador; suspender/cancelar para cese terapéutico.
- **NTEC Art. 55–56** — metadatos obligatorios (`registrado_en`, `medico_prescriptor`, `establecimiento_id` vía RLS), bitácora inmutable ≥ 2 años (audit hash chain SQL `02_audit_triggers.sql` + `05_audit_hash_chain.sql`).
- **TDR §11.3** — Order Entry / CPOE hospitalario con todos los grupos de indicaciones (medicamentos, dieta, líquidos IV, oxígeno, monitorización, actividad, posición, profilaxis, curaciones, procedimientos, interconsultas, laboratorios e imágenes).
- **TDR §15.3** — CPOE ambulatorio con validación clínica en tiempo real y soporte de protocolos preestablecidos (sepsis, IAM, asma).
- **TDR §15.4** — Validación farmacéutica QFB previa a dispensación.
- **TDR §15.7** — Sustancias controladas (receta verde / retenida) con firma reforzada del médico.
- **TDR §16** — eMAR / BCMA 5R con escaneo de brazalete + medicamento + badge enfermera; doble verificación para alto riesgo (insulinas, anticoagulantes, opioides, quimioterapia, vasoactivos pediátricos).
- **GS1 SIS El Salvador** — GTIN-14 medicamento, GSRN paciente y enfermera, GLN ubicación; trazabilidad lote-paciente (ver `docs/backlog/fase2/_insumos/guia_trazabilidad_hospitalaria_gs1.md`).
- **Ley Reguladora de Actividades Relativas a las Drogas (DNM El Salvador)** — controlados con inventario reforzado, doble custodia, libro de control, reportes regulatorios.
