# SOL_EST — Solicitud de Estudios

## Metadata
- **codigo**: SOL_EST
- **nombre**: Solicitud de Estudio
- **modalidad**: AMBULATORIO, HOSPITALIZACION, EMERGENCIA (NTEC: `ambos`)
- **NTEC artículo**: §3.18 (NTEC Acuerdo n.° 1616, MINSAL 2024); §17.1 TDR (LIS); §18.1 TDR (RIS/PACS)
- **modulo_his_target**: `/lab-orders` (legacy LIS), `/imaging` (legacy RIS), `/ece/estudios` (registro NTEC)
- **tabla_datos**: `ece.solicitud_estudio` (registro NTEC) + bridge a `LabOrder` / `ImagingOrder` (operativo)
- **inmutable**: false (admite rectificación trazable hasta firma; tras `firmado` requiere anulación + nueva instancia — Art. 42 NTEC)
- **tipo_registro**: OBLIGATORIO cuando hay plan diagnóstico que requiera laboratorio, imagenología o gabinete (Art. 38 lit. e NTEC — vinculado a Historia Clínica)

## Propósito normativo

La solicitud de estudio (SOL_EST) es el acto médico documental que ordena un examen complementario al paciente con indicación clínica justificada. Forma parte del expediente clínico electrónico según el artículo §3.18 NTEC y respalda médico-legalmente el uso de recursos diagnósticos, la cadena de custodia de muestras (laboratorio) y la justificación de radioprotección (imagenología, §18.7 TDR — principio ALARA). En el SIS MINSAL el flujo se conoce como módulo RELAB para laboratorio; en SNIS, la solicitud forma parte del expediente médico único por usuario (Ley SNIS Arts. 24-26).

Su carácter de soporte legal implica firma electrónica simple del médico solicitante (Art. 4.17, 23 lit. a.4 NTEC) y vínculo bidireccional con el episodio de atención. La solicitud habilita downstream el flujo de toma de muestra (`SpecimenType` en `LabSpecimen`) o de programación de modalidad (DICOM Modality Worklist DMWL en `ImagingOrder`), por lo que sin SOL_EST firmada no debe poderse generar resultado válido (RES_EST).

## Dependencias (depende_de)
- **HIST_CLIN** — la Historia Clínica establece el contexto diagnóstico y la indicación clínica obligatoria. Sin HC firmada no debe poderse crear SOL_EST (regla seeded en `ece.tipo_documento.depende_de = ['HIST_CLIN']`, archivo `63_ece_08_seed.sql:88`).
- **FICHA_ID** — dependencia transitiva vía HIST_CLIN. La identificación del paciente debe estar verificada (Art. 15 NTEC).
- **EPISODIO_ATENCION** (no es `tipo_documento` sino entidad técnica) — toda solicitud se vincula a un episodio activo (`episodio_id NOT NULL` en `ece.solicitud_estudio`).

## Obligatoriedad por modalidad / contexto

| Modalidad | Obligatoriedad | Justificación |
|---|---|---|
| AMBULATORIO (Consulta Externa) | CONDICIONAL | Solo cuando el plan terapéutico incluya estudios complementarios (§2.1 análisis workflows). |
| AMBULATORIO (Emergencia) | CONDICIONAL | Vinculada a `ATN_EMERG`; típicamente obligatoria por prioridad clínica. |
| HOSPITALIZACION | CONDICIONAL | Indicaciones diarias pueden generar nuevas SOL_EST; ligada a `IND_MED` o a Evolución (§2.2). |
| Estudios con radiación ionizante (CT/XA/MG/NM) | OBLIGATORIA con indicación detallada | Radioprotección (TDR §18.7 ALARA); verificación de embarazo en mujeres en edad fértil (TDR §18.1). |
| Contraste yodado/gadolinio | OBLIGATORIA con declaración de alergias y función renal | Contraindicaciones documentadas (TDR §18.1). |

## Roles firmantes / actores

| Rol | Acción | Momento |
|---|---|---|
| MC (Médico de Cabecera) | Llena la solicitud, define examenes, indicación clínica, prioridad | Al momento de la decisión clínica durante consulta o pase de visita |
| MT (Médico de Turno) | Llena (alternativo, `obligatorio=false` en `documento_rol`) | En ausencia de MC, especialmente en emergencia/hospitalización turno noche |
| MC | Firma electrónica simple (PIN argon2id contra `ece.firma_electronica`) en transición `firmar` | Al cierre del acto médico, antes de transmitir al LIS/RIS |
| MC | Autoriza/valida el cierre de la solicitud (transición `validar`) | Tras confirmación del resultado disponible |
| PROF_DX (Profesional diagnóstico — TEC laboratorio / Tecnólogo imagen) | Llena el resultado (RES_EST asociado) | Tras procesamiento técnico |
| DIR (Dirección) | Anula la solicitud (transición universal `anular`, requiere firma) | Excepcional: errores de identificación, solicitud duplicada, motivos médico-legales |

Notas:
- En `ece.documento_rol` están registrados MC (LLENA, RESPONSABLE, FIRMA, AUTORIZA) y MT (LLENA, `obligatorio=false`).
- Para estudios externalizados a referencia (`LabOrder.externalLabRef`), la firma del MC es suficiente; el laboratorio externo registra resultado en RES_EST separada.

## Campos obligatorios mínimos NTEC

Mapeo basado en `ece.solicitud_estudio` (archivo `61_ece_06_documentos.sql:714-731`):

- `id` — UUID, generado por BD.
- `instancia_id` — UUID, FK a `ece.documento_instancia` (vínculo al motor workflow).
- `episodio_id` — UUID NOT NULL, FK a `ece.episodio_atencion`.
- `tipo` — TEXT NOT NULL, CHECK `IN ('laboratorio','imagenologia','gabinete')`.
- `examenes` — JSONB NOT NULL, array de items `[{codigo_loinc_o_local, nombre_examen, urgente: bool, observacion}]`. Comentario del DDL recomienda LOINC para laboratorio.
- `indicacion_clinica` — TEXT (opcional en DDL, pero **obligatorio normativamente** por TDR §17.1 y §18.1; debe validarse a nivel router/Zod).
- `medico_solicitante_id` — UUID NOT NULL, FK a `ece.personal_salud`.
- `fecha_hora` — TIMESTAMPTZ NOT NULL DEFAULT now(), precisión segundo (Art. 55 NTEC).
- `estado` — TEXT NOT NULL DEFAULT `'solicitado'`, CHECK `IN ('solicitado','en_proceso','resultado_listo','anulado')`. Este es el estado de **datos**; el estado de **workflow** vive en `ece.documento_instancia.estado_actual_id`.
- `registrado_en` — TIMESTAMPTZ NOT NULL DEFAULT now() (bitácora interna).

Para integración con módulos legacy:
- `LabOrder` (`packages/database/prisma/schema.prisma:2033-2054`): `encounterId`, `prescriberId`, `patientId`, `priority` (LabPriority: ROUTINE/URGENT/STAT), `status` (LabOrderStatus: DRAFT/ORDERED/COLLECTED/IN_PROCESS/RESULTED/VALIDATED/CANCELLED), `clinicalIndication`.
- `ImagingOrder` (`schema.prisma:2733-2780`): `encounterId`, `establishmentId`, `patientId`, `modalityType` (CR/CT/MR/US/XA/MG/NM/PT/OTHER), `studyDescription`, `bodySite`, `clinicalIndication` (NOT NULL), `priority` (STAT/URGENT/ROUTINE), `status` (ORDERED/SCHEDULED/IN_PROGRESS/COMPLETED/REPORTED/VALIDATED/CANCELLED), `radiationDoseDap`, `radiationDoseCtdi` para CT/XA/MG.

## Estados (flujo_estado)

Sembrados en `63_ece_08_seed.sql:135-177` (loop genérico — SOL_EST NO está en `('FICHA_ID','EPICRISIS','CERT_DEF')` y NO es inmutable, recibe el patrón base):

| codigo | nombre | es_inicial | es_final | orden |
|---|---|---|---|---|
| `borrador` | Borrador | true | false | 1 |
| `en_revision` | En revisión | false | false | 2 |
| `firmado` | Firmado | false | false | 3 |
| `validado` | Validado | false | true | 4 |
| `anulado` | Anulado | false | true | 9 |

Estados del campo de datos (`ece.solicitud_estudio.estado`, distinto del estado de workflow):
- `solicitado` — creado, pendiente de procesar.
- `en_proceso` — recibido por laboratorio/imagenología, en procesamiento.
- `resultado_listo` — resultado disponible (vincula a RES_EST).
- `anulado` — solicitud anulada.

## Transiciones (flujo_transicion)

Sembradas en `63_ece_08_seed.sql:284-287` + transición universal `anular` (líneas 300-314):

| origen | destino | acción | rol_autoriza | requiere_firma | condición |
|---|---|---|---|---|---|
| `borrador` | `en_revision` | `enviar_revision` | MC | false | Solicitud completa, lista para revisión interna. |
| `en_revision` | `firmado` | `firmar` | MC | **true** (PIN MC) | Firma electrónica simple del médico solicitante (Art. 23 lit. a.4 NTEC). |
| `firmado` | `validado` | `validar` | MC | false | El médico confirma cierre del ciclo (resultado disponible o anulación administrativa). |
| `borrador` | `anulado` | `anular` | DIR | **true** | Universal: solo Dirección puede anular un documento del expediente. |

Observación crítica (audit HH-03 / `docs/audit/2026-05-19_audit_stream_h_diagnosticos.md`): la transición `validar` no requiere PIN del MC en la implementación actual del router (`packages/trpc/src/routers/ece/solicitud-estudio.router.ts:519`). El propio firmante puede autovalidar sin segundo factor. La regla seeded (`requiere_firma=false`) refleja la intención normativa, pero el riesgo go-live recomienda elevar a PIN o regla 4-eyes (validador ≠ firmante).

## Eventos de dominio

Eventos emitidos por el router ECE y/o por bridges hacia LIS/RIS:

- `ece.solicitud_estudio.creado` — al INSERT en estado `borrador`.
- `ece.solicitud_estudio.enviada_revision` — transición borrador → en_revision.
- `ece.solicitud_estudio.firmada` — transición en_revision → firmado, con `firma_id` en historial.
- `ece.solicitud_estudio.validada` — transición firmado → validado.
- `ece.solicitud_estudio.anulada` — transición * → anulado.
- `lab.order.created` — bridge a LIS cuando `tipo='laboratorio'` y se sincroniza con `LabOrder`.
- `imaging.order.created` — bridge a RIS cuando `tipo='imagenologia'` y se sincroniza con `ImagingOrder`.
- `lab.criticalValue` / `imaging.criticalFinding` — emitidos por LIS/RIS cuando el resultado downstream contenga flag crítico (notificación al MC solicitante, TDR §17.5).

## Drift conocido (audit) y riesgos

Auditoría Stream H (`docs/audit/2026-05-19_audit_stream_h_diagnosticos.md`), commit `6532a92`:

- **HH-01 [P0]** — Schema drift masivo en `ece.solicitud_estudio`: el router ECE asume 5 columnas inexistentes en BD: `paciente_id`, `estudios_solicitados` (BD usa `examenes`), `prioridad` (no existe — embebida en `examenes[].urgente`), `observaciones_clinicas` (BD usa `indicacion_clinica`), `solicitado_por` (BD usa `medico_solicitante_id`). INSERT y SELECT fallan en runtime con `column does not exist`. **Bloqueante go-live.** Recomendación: alinear el router a las columnas reales (precedente: `fix/firma-electronica-schema-drift`).
- **HH-03 [P1]** — `validar` sin PIN: el MC firmante puede autovalidar su propia solicitud sin segundo factor. Recomendación: elevar `requiere_firma=true` en seed + verificar PIN en router, o implementar regla 4-eyes (validador ≠ firmante, como el LIS aplica en `result.validate`).
- **HH-04 [P2]** — `estudiosRaw` (UI) sin validación de formato LOINC: el campo acepta texto libre separado por comas. Recomendación: selector de catálogo cuando `tipo IN ('laboratorio','imagenologia')` con autocompletado contra `LabTest` o catálogo de estudios.
- **HH-06 / HH-08 [P0]** — RLS bypass en LIS e Imaging: los routers legacy `lisRouter` e `imagingRouter` no usan `withTenantContext`; políticas RLS con `roles={public}` no se aplican porque el rol Prisma tiene BYPASSRLS. Si SOL_EST sincroniza con `LabOrder`/`ImagingOrder` vía bridge, el aislamiento tenant depende exclusivamente del filtro JS. **Bloqueante go-live para módulos legacy.**

Riesgos residuales:
- Inconsistencia semántica entre `ece.solicitud_estudio.estado` (datos: solicitado/en_proceso/resultado_listo/anulado) y el estado de workflow (`ece.flujo_estado`: borrador/en_revision/firmado/validado/anulado). El designer de workflow debe presentar ambos sin confundirlos.
- La transición `validado` cierra el documento ECE pero el resultado (`ece.resultado_estudio`) puede ingresar después en paralelo. La regla normativa (`depende_de` en RES_EST = SOL_EST en estado `firmado`) debe enforced a nivel motor.

## Descripción markdown rica (para BD `descripcion_markdown`)

La **Solicitud de Estudio (SOL_EST)** es el documento médico-legal que ordena un examen complementario (laboratorio clínico, imagenología, gabinete) sobre un paciente con indicación clínica justificada. Forma parte del expediente clínico electrónico según el **artículo §3.18 de la NTEC (Acuerdo n.° 1616, MINSAL 2024)** y constituye el punto de entrada al circuito diagnóstico del HIS Multipaís — Avante: LIS (TDR §17), RIS/PACS (TDR §18) o gabinete operativo.

### Casos de uso clínico

Procede en cualquier modalidad asistencial cuando el plan terapéutico requiera apoyo diagnóstico:

- **Consulta externa ambulatoria** — paneles preventivos, control de patología crónica, tamizaje.
- **Emergencia** — laboratorios STAT (química, gasometría, troponina), imagen urgente (TAC craneal, RX tórax, ecografía FAST).
- **Hospitalización** — laboratorios diarios de seguimiento, perfil pre-quirúrgico, controles de tratamiento.
- **Quirófano / pre-anestesia** — exámenes pre-operatorios obligatorios.

### Reglas operativas (motor workflow)

El documento sigue el ciclo **borrador → en_revisión → firmado → validado**, con el estado terminal universal `anulado` accesible solo desde `borrador` y autorizado únicamente por Dirección (Art. 21 NTEC). La transición a `firmado` exige **firma electrónica simple del médico solicitante** mediante PIN argon2id verificado contra `ece.firma_electronica` (Art. 23 lit. a.4 NTEC).

Una vez firmada, la solicitud no admite UPDATE directo sobre la fila de datos; los cambios solo proceden por anulación + nueva instancia (rectificación, Art. 42 NTEC). El estado de datos (`ece.solicitud_estudio.estado`) avanza en paralelo conforme el laboratorio/imagenología procesa la muestra: `solicitado → en_proceso → resultado_listo`, sincronizando con el estado del workflow del documento RES_EST cuando exista.

### Integración con módulos legacy

Cuando `tipo='laboratorio'`, el documento se replica vía bridge en `LabOrder` (TDR §17.2), con su grafo propio de estados Prisma (`DRAFT → ORDERED → COLLECTED → IN_PROCESS → RESULTED → VALIDATED | CANCELLED`) y prioridad `LabPriority` (ROUTINE/URGENT/STAT). Cuando `tipo='imagenologia'`, se replica en `ImagingOrder` (TDR §18.2) con modalidad DICOM (`ImagingModalityType`: CR/CT/MR/US/XA/MG/NM/PT/OTHER) y registro de dosis (`radiationDoseDap`, `radiationDoseCtdi`) cuando aplica radioprotección. El designer de workflows debe respetar la regla "extender legacy, no duplicar" (CLAUDE.md, regla permanente).

### Cumplimiento normativo

- **NTEC Art. 23 lit. a.4** — firma electrónica simple por profesional.
- **NTEC Art. 42** — rectificación trazable (no DELETE).
- **NTEC Art. 55-56** — metadatos `usuario_creador`, `timestamp` precisión segundo, bitácora de modificaciones inmutable ≥ 2 años.
- **TDR §17.1** — indicación clínica obligatoria, detección de duplicidades en ventana temporal, regla de aprobación para pruebas restringidas.
- **TDR §18.1** — verificación de embarazo en mujeres en edad fértil para estudios con radiación, contraindicaciones para medios de contraste.
- **TDR §18.7** — principio ALARA y registro acumulado de dosis por paciente.
