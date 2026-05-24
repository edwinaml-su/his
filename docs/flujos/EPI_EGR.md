# EPI_EGR — Epicrisis de Egreso

## Metadata
- **codigo**: `EPICRISIS` (codigo siembra `ece.tipo_documento` en `63_ece_08_seed.sql:78`; este archivo lo documenta como **EPI_EGR** según convención de la suite `docs/flujos/`)
- **nombre**: Epicrisis / Hoja de Egreso Hospitalario
- **modalidad**: HOSPITALIZACION (modalidad sembrada `hospitalario` — no aplica a Consulta Externa ni Emergencia sin ingreso)
- **NTEC artículo**: Arts. 17 lit. b (tipo_egreso y circunstancia_alta obligatorios y catalogados), 21 (certificación restringida a Dirección o delegado), 40 (firmas progresivas en ECE: MC → ESP → DIR), 41 lit. c (contenido mínimo del resumen del expediente: identificación, diagnósticos, manejo terapéutico, resultados, firmas), 42 (rectificación trazable post-firma), 55–56 (metadatos obligatorios y bitácora) — Acuerdo n.° 1616 MINSAL (30/05/2024, D.O. T.444 N°158). El brief del prompt cita "Art. 39" — PENDIENTE — validar con @AE/@PO el numeral exacto del Acuerdo 1616 (el `analisis_workflows_ece.md` §3.15 cita Art. 17, 21 y 41 lit. c; el seed cita "Art. 41 NTEC — inmutable al cierre"; ningún insumo expone un Art. 39 explícito para Epicrisis — se documentan los artículos efectivamente trazables).
- **modulo_his_target**: doble cobertura coexistente — (a) **`/discharges`** (operativo legacy, `apps/web/src/app/(clinical)/encounters/[id]/discharge/page.tsx` con `discharge-form.tsx` + `epicrisis-form.tsx`, router `encounterDischargeRouter` en `packages/trpc/src/routers/encounter-discharge.router.ts` — egreso administrativo + epicrisis provisional como `AuditLog.entity='Encounter.epicrisis'`); (b) **`/ece/epicrisis`** (formal NTEC, `apps/web/src/app/(clinical)/ece/epicrisis/{page,nueva,[id]}/page.tsx`, router `epicrisisRouter` en `packages/trpc/src/routers/ece/epicrisis.router.ts` — flujo de tres firmas progresivas + certificación DIR). Existe **drift**: el legacy almacena en `AuditLog`; el formal en `ece.epicrisis_egreso`. PENDIENTE — consolidar (ver "Drift conocido"). El bridge actual desde `/discharges` hacia `ece.epicrisis_egreso` no está confirmado: la auditoría HD-09 (Stream D) señala que `confirmarAlta` lee `estado_epicrisis` pero no garantiza que cada egreso operativo produzca una instancia ECE.
- **tabla_datos**: `ece.epicrisis_egreso` (Prisma `EceEpicrisisEgreso` — `packages/database/prisma/schema.prisma:5304`). UNIQUE en `episodio_id` (1:1 con episodio hospitalario). Workflow + columnas de firma agregados por `packages/database/sql/99_epicrisis_workflow.sql` (aplicado 2026-05-19 vía `apply_migration`).
- **inmutable**: **true post-firma** — el trigger `trg_bloquea_epicrisis` (`ece.fn_bloquea_mutacion_epicrisis()`, `99_epicrisis_workflow.sql:34`) bloquea `UPDATE/DELETE` cuando `estado_workflow IN ('firmado','certificado','anulado')`. Permite mutación solo en `borrador` y `validado` (visto del jefe de servicio puede agregar metadatos durante esa fase). Tras `certificado`, **solo procede rectificación trazable** (nueva instancia con `version+1`, Art. 42 NTEC).
- **tipo_registro**: **OBLIGATORIO** al cierre de todo episodio hospitalario (`tipo_documento.tipo_registro='historico'`, `obligatorio=true` en seed `63_ece_08_seed.sql:79`). Se aplica a todo egreso vivo o fallecido — para `tipo_egreso='fallecido'` la cadena se prolonga con `CERT_DEF` (Certificado de Defunción) que tiene a `EPICRISIS` como dependencia única (`depende_de=['EPICRISIS']`, seed línea 82).

## Propósito normativo
La Epicrisis (también llamada Hoja de Egreso o Resumen de Egreso) es el documento histórico que cierra formalmente el episodio hospitalario, transfiere la responsabilidad asistencial al paciente / red ambulatoria y constituye base para la continuidad post-alta y para los indicadores de gestión hospitalaria (egresos, mortalidad, estancia, complicaciones). Cubre el contenido mínimo del **resumen del expediente** definido en Art. 41 lit. c NTEC: identificación, diagnósticos codificados, manejo terapéutico, resultados de estudios complementarios, firmas de responsables y dirección. Su carácter histórico la hace **inmutable al cierre** del workflow de firmas progresivas (Art. 40 NTEC: MC firma → ESP valida → DIR certifica).

Cumple además funciones extracríticas: (i) base del **reporte SNIS / MINSAL** de egresos hospitalarios (días-cama, giro cama, estancia promedio — TDR §13 estadísticas hospitalarias); (ii) sustento del **proceso de cobro ISSS / aseguradoras** para episodios cubiertos; (iii) **continuidad asistencial** mediante indicaciones al alta, prescripción ambulatoria de egreso (genera receta), citas de seguimiento y, si aplica, referencia a otro nivel del SNIS (vía documento RRI asociado); (iv) **insumo médico-legal** ante litigios, dado que es la síntesis firmada del episodio y la condición del paciente al egreso. La inmutabilidad criptográfica de la cadena `audit.audit_log` (TDR §6.3) + el `documentHash` SHA-256 emitido en el evento `ece.epicrisis.certificada` (computado en `epicrisis.router.ts:163` sobre los campos clínicos clave) garantizan la integridad de este sustento ante cualquier intento de modificación posterior.

## Dependencias (depende_de)
Documentos que DEBEN existir y haber alcanzado un estado de cierre antes de **firmar** la epicrisis (la creación en `borrador` requiere solo episodio activo; las dependencias se evalúan en la transición `firmar`):

- **`EVOL_MED`** (Nota / Hoja de Evolución Médica) — **única dependencia formal sembrada** (`tipo_documento.depende_de=['EVOL_MED']` en `63_ece_08_seed.sql:78`). NTEC exige evolución diaria mientras dure la hospitalización; sin al menos una nota de evolución firmada no debe existir epicrisis (el episodio carecería de sustento clínico evolutivo).
- **`HOJA_ING`** (Hoja de Ingreso) — **dependencia transitiva**: existe por el lado del episodio (la epicrisis no puede crearse sin `episodio_id` y todo episodio hospitalario abre con `HOJA_ING` firmada). El motor no la evalúa explícitamente para EPICRISIS, pero el flujo de creación del episodio sí.
- **`IND_MED`** (Indicaciones Médicas diarias) — **dependencia normativa**, no enforzada por seed. NTEC §3.x sobre indicaciones requiere al menos una indicación firmada por día de hospitalización. PENDIENTE — el brief del prompt menciona "al menos un IND_MED diario firmado" como dependencia; actualmente el motor solo enforza `EVOL_MED`. Validar con @AE/@PO si se agrega como dependencia formal.
- **`VAL_INI_ENF`** (Valoración Inicial de Enfermería) — el brief del prompt la menciona como dependencia; el seed no la registra explícitamente. NTEC requiere VAL_INI_ENF en las primeras 24 h del ingreso. PENDIENTE — validar.
- **`CONS_INF`** (Consentimiento Informado) — si el episodio incluyó procedimiento mayor (quirúrgico, anestésico), debe estar firmado antes del acto y referenciado. No es dependencia de la epicrisis per se, pero su ausencia es hallazgo de auditoría en el episodio.

Recomendados (no bloqueantes):
- **`SOL_EST` / `RES_EST`** (Solicitudes y Resultados de Estudios) — para alimentar `resultados_complementarios`.
- **`ACTO_QX`** (Hoja de Acto Quirúrgico) — si hubo cirugía durante el episodio.
- **`HOJA_ANES`** (Hoja de Anestesia) — si hubo anestesia general/regional.

## Obligatoriedad por modalidad / contexto
**SIEMPRE** al cierre de un episodio hospitalario, sin excepción:

| Circunstancia del cierre | Obligatoriedad | Camino normativo |
|---|---|---|
| Alta médica (paciente vivo, evolución favorable o estable) | OBLIGATORIA | `tipo_egreso='vivo'`, `circunstancia_alta='alta_hospitalaria'` |
| Traslado a otro establecimiento del SNIS o privado | OBLIGATORIA | `circunstancia_alta='referido_otro_hospital'`; encadena con documento RRI |
| Alta voluntaria (paciente firma su retiro contra opinión médica) | OBLIGATORIA | `circunstancia_alta='alta_voluntaria'`; debe quedar firma del paciente y constancia en el expediente |
| Fuga del paciente | OBLIGATORIA | `circunstancia_alta='fuga'`; epicrisis con narrativa del incidente y notificación a Dirección |
| In extremis | OBLIGATORIA | `circunstancia_alta='in_extremis'`; egreso clínicamente inviable, soporte para defunción inminente |
| Defunción intrahospitalaria | OBLIGATORIA | `tipo_egreso='fallecido'`; **dispara obligatoriamente `CERT_DEF`** (Certificado de Defunción) |
| Alta rehabilitada ISRI (Inst. Salvadoreño de Rehabilitación Integral) | OBLIGATORIA | `circunstancia_alta='alta_rehabilitada_ISRI'` |

Catálogo enum BD (CHECK constraint en `circunstancia_alta`): `alta_hospitalaria | referido_otro_hospital | alta_voluntaria | fuga | in_extremis | alta_rehabilitada_ISRI`. Catálogo enum BD `tipo_egreso`: `vivo | fallecido`. El router `epicrisisRouter.create` (`epicrisis.router.ts:60`) usa Zod schema `motivoEgreso` con valores `alta_voluntaria | alta_medica | traslado | fallecido | otro` y deriva `tipo_egreso = motivoEgreso === 'fallecido' ? 'fallecido' : 'vivo'`. PENDIENTE — alinear el enum Zod con el enum BD (no son idénticos: `otro` no existe en BD; `alta_medica` no mapea a `alta_hospitalaria`). Auditoría requerida.

## Roles firmantes / actores
Workflow de tres firmas progresivas (Art. 40 NTEC, sembrado en `63_ece_08_seed.sql:269-272` y `419-422`):

| Rol | Acción | Momento | Requiere firma |
|---|---|---|---|
| **MC** (Médico de Cabecera / Tratante) | LLENA contenido clínico (borrador), RESPONSABLE del documento, FIRMA inicial (transición `firmar`) | Al decidir alta y completar el resumen | **SI** (firma electrónica simple, Art. 23 lit. a.4) |
| **MT** (Médico de Turno) | LLENA (alternativo, `obligatorio=false` en `documento_rol`) | Cuando MC no esté disponible al momento del alta (turno noche / fin de semana) | NO (firma final la hace el MC al regresar, o el ESP la valida) |
| **ESP** (Especialista / Jefe de Servicio) | VALIDA contenido clínico (transición `validar`, firmado → validado) | Tras revisión del jefe de servicio o especialista designado | NO (transición sin firma; se registra `visto_jefe_servicio_id` y `validado_en`) |
| **DIR** (Director Médico / Subdirector / Delegado de Dirección) | CERTIFICA formalmente el documento (transición `certificar`, validado → certificado) | Cierre formal del documento; pre-requisito para anexarlo a copias auditables del expediente (Art. 21 NTEC) | **SI** (firma electrónica simple del director — Art. 21 NTEC) |
| **DIR** | AUTORIZA anulación de la epicrisis antes de la certificación (transición `anular`) | Excepcional: error material, identificación errada, cambio de paciente | **SI** |
| **PACIENTE / FAMILIAR RESPONSABLE** | RECIBE copia + firma de recepción | Al momento del egreso físico del paciente | Firma de recibido (no es firma electrónica; es constancia en papel o digital de entrega) |

Fuente: `ece.documento_rol` seed `63_ece_08_seed.sql:418-422`. La firma del paciente no está modelada en el workflow del documento; se trazará en un evento operacional `ece.epicrisis.entregada` cuando la UI lo recoja (no implementado al 2026-05-22 — ver Drift).

## Campos obligatorios mínimos NTEC
Mapeados a columnas de `ece.epicrisis_egreso` (Prisma `EceEpicrisisEgreso` — `schema.prisma:5304-5349`):

- `id` — UUID, generado por BD.
- `instancia_id` — UUID, FK opcional a `ece.documento_instancia` (vínculo al motor workflow; nullable porque el workflow puede iniciar antes que el documento o viceversa).
- `episodio_id` — UUID NOT NULL **UNIQUE**, FK a `ece.episodio_atencion`. Garantiza 1:1 epicrisis ↔ episodio hospitalario.
- `paciente_id` — UUID opcional, denormalización para consultas rápidas (la fuente canónica es `episodio.paciente_id`).
- `fecha_hora_egreso` — TIMESTAMPTZ NOT NULL. **Metadato obligatorio Art. 55 NTEC** (precisión segundo).
- `tipo_egreso` — VARCHAR(20) NOT NULL. Enum BD: `vivo | fallecido`. Art. 17 lit. b NTEC.
- `circunstancia_alta` — TEXT NOT NULL. Enum BD: `alta_hospitalaria | referido_otro_hospital | alta_voluntaria | fuga | in_extremis | alta_rehabilitada_ISRI`. Art. 17 lit. b NTEC.
- `diagnosticos_egreso` — JSONB NOT NULL. Estructura: `[{ cie10: string, descripcion: string, tipo: 'principal'|'secundario'|'comorbilidad' }]`. **Mínimo un diagnóstico principal** (Zod `.min(1)` en router). Hard-stop Art. 17 NTEC en la transición `firmar`: requiere `cie10_principal` poblado (estructurado, columna dedicada).
- `cie10_principal` — TEXT (columna dedicada agregada en `99_epicrisis_workflow.sql`). **Hard-stop al firmar** (`epicrisis.router.ts:362`): `PRECONDITION_FAILED` si está vacío. Validado contra `public."Icd10Catalog"` (códigos activos).
- `cie10_secundarios` — TEXT[] (max 4 según Zod `setCie10`).
- `procedimientos_realizados` — JSONB opcional. Recomendado CIE-9 PCS o CIE-10 PCS.
- `resumen_ingreso` — TEXT opcional. Sintetiza el motivo de ingreso y estado inicial.
- `evolucion_hospitalaria` — TEXT opcional. Síntesis cronológica de la evolución (consolida `EVOL_MED` diarias).
- `tratamiento_egreso` — TEXT opcional. Prescripción ambulatoria al alta (medicación, dosis, duración).
- `indicaciones_egreso` — TEXT opcional. Recomendaciones (dieta, actividad, signos de alarma).
- `resumen_evolucion` — TEXT opcional (alternativo / consolidado con `evolucion_hospitalaria`).
- `resultados_complementarios` — TEXT opcional. Referencias a `RES_EST` clave (laboratorio, imagenología).
- `manejo_terapeutico` — TEXT opcional. Tratamiento durante el internamiento.
- `indicaciones_alta` — TEXT opcional.
- `citas_seguimiento` — JSONB opcional. Estructura sugerida: `[{ especialidad: string, fecha_sugerida: date|null, plazo_dias: int|null, observacion: string }]`. Genera citas en `/appointments`.
- `medico_tratante` — UUID NOT NULL, FK a `ece.personal_salud`. **Firmante MC**.
- `visto_jefe_servicio` — UUID opcional, FK a `ece.personal_salud`. **Validador ESP**.
- `estado_workflow` — TEXT NOT NULL DEFAULT `'borrador'`, CHECK `IN ('borrador','firmado','validado','certificado','anulado')`.
- `firma_mc_id` — UUID opcional, FK a `ece.firma_electronica`. Set en transición `firmar`.
- `firma_esp_id` — UUID opcional. **Nota:** la transición `validar` actual del router (`epicrisis.router.ts:386`) NO requiere firma del ESP (no actualiza `firma_esp_id`), solo registra `validado_en` y `visto_jefe_servicio_id`. PENDIENTE — confirmar si Art. 40 exige firma electrónica de ESP o basta el vínculo del jefe de servicio.
- `firma_dir_id` — UUID opcional. Set en transición `certificar`. **Firma DIR obligatoria** (Art. 21 NTEC).
- `firmado_en`, `validado_en`, `certificado_en`, `anulado_en` — TIMESTAMPTZ opcionales, timestamps de cada transición.
- `motivo_anulacion` — TEXT opcional, requerido en transición `anular`.
- `registrado_en` — TIMESTAMPTZ NOT NULL DEFAULT `now()`. **Metadato obligatorio Art. 55**.
- `estado_registro` — VARCHAR(20) DEFAULT `'vigente'`. Campo legacy duplicado con `estado_workflow`. PENDIENTE — consolidar (mismo drift que en HC_AMB).

Campos del brief del prompt **NO presentes en BD** (pueden derivarse o agregarse):
- `fecha_ingreso` — derivable de `episodio.fecha_hora_orden_ingreso` (no se duplica).
- `estancia_dias_calculada` — derivable: `fecha_hora_egreso - episodio.fecha_hora_orden_ingreso`. Recomendado computar en lectura.
- `complicaciones` — no existe columna dedicada; modelar dentro de `evolucion_hospitalaria` o agregar columna en migración futura (PENDIENTE).
- `condicion_egreso` (MEJORADO|SIN_CAMBIOS|EMPEORADO|...) — el modelo actual usa `tipo_egreso` + `circunstancia_alta`. El concepto de "condición del paciente al egreso" (mejoría / sin cambios / empeoramiento) NO está catalogado en BD ni en seed. **PENDIENTE — agregar columna `condicion_egreso` enum** si se requiere reporte SNIS detallado. Esto es **GAP normativo** entre el brief y el modelo implementado.

## Estados (flujo_estado)
Sembrados en `63_ece_08_seed.sql` (bloque DO genérico + transiciones EPICRISIS-específicas):

```
borrador (inicial)
   │
   │ firmar  (MC, requiere firma)
   ▼
firmado     ──────┐
   │              │
   │ validar (ESP, sin firma)
   ▼              │
validado          │
   │              │
   │ certificar (DIR, requiere firma)
   ▼              │
certificado (final, inmutable)
                  │
                  ▼
              anulado (final alternativo, solo desde borrador/firmado/validado, NUNCA desde certificado)
```

Estado terminal: **`certificado`** (`es_final=true` por flag `necesita_certificacion=true` para EPICRISIS — seed `63_ece_08_seed.sql:132`).

**Reglas de inmutabilidad**:
- Trigger `trg_bloquea_epicrisis` (`99_epicrisis_workflow.sql:56`) bloquea `UPDATE/DELETE` cuando `estado_workflow IN ('firmado','certificado','anulado')`. Permite mutación en `borrador` (capturando contenido) y `validado` (excepcionalmente, para metadatos de ESP).
- Tras `certificado`, **rectificación trazable únicamente**: nueva instancia con `version+1`, vinculada al `instancia_origen_id` (Art. 42 NTEC).
- La transición `anular` está bloqueada desde `certificado` (`epicrisis.router.ts:583`).

## Transiciones (flujo_transicion)
Seed `63_ece_08_seed.sql:269-272` + anulación universal:

| origen | destino | acción | rol que autoriza | requiere firma | condición funcional |
|---|---|---|---|---|---|
| borrador | firmado | `firmar` | MC | **SI** | (a) `cie10_principal` no nulo (hard-stop Art. 17 NTEC); (b) episodio activo; (c) PIN/firma electrónica simple validada en `ece.firma_electronica`; (d) `medico_tratante` = usuario firmante; (e) dependencia `EVOL_MED` con al menos una instancia firmada para el episodio (motor) |
| firmado | validado | `validar` | ESP | NO | Revisión del jefe de servicio o especialista designado; registra `visto_jefe_servicio_id` + `validado_en` |
| validado | certificado | `certificar` | DIR | **SI** | (a) Firma electrónica del director (Art. 21 NTEC); (b) cómputo de `documentHash` SHA-256 sobre campos clínicos clave (`epicrisis.router.ts:163`); (c) emisión del evento `ece.epicrisis.certificada` vía `emitDomainEvent` (outbox) |
| borrador / firmado / validado | anulado | `anular` | DIR | **SI** | Anulación con `motivoAnulacion` (min 10 chars). Bloqueado desde `certificado`. |

Transiciones **bloqueadas / inexistentes** (no sembradas):
- `firmado → borrador` (rollback prohibido; usar rectificación).
- `validado → firmado` (rollback prohibido).
- `certificado → cualquier estado` (terminal absoluto; solo rectificación).
- `anulado → cualquier estado` (terminal alternativo).

## Eventos de dominio
Convención `ece.<codigo>.<accion>`. Payload obligatorio mínimo: `organization_id`, `establishment_id`, `paciente_id`, `episodio_id`, `instancia_id`, `actor_id`, `timestamp`.

Eventos **implementados** (al 2026-05-22):
- **`ece.epicrisis.certificada`** — emitido en `certificar()` (`epicrisis.router.ts:479-493`) vía `emitDomainEvent` dentro de la transacción. Payload: `{ epicrisisId, episodioId, documentHash, directorId, firmaId, organizationId }`. Es el evento de cierre formal del episodio.

Eventos **del brief, NO implementados al 2026-05-22** (gap):
- **`epi_egr.iniciada`** — propuesto: emitir en `create()` (estado borrador). Permite a observadores (UI dashboard de egresos pendientes, motor de alertas de estancia prolongada) saber que el alta está en preparación. Payload sugerido: `{ instanciaId, episodioId, autorId, creadoEn }`.
- **`epi_egr.firmada`** — propuesto: emitir en `firmar()`. Hito clínico: cierra la responsabilidad asistencial del médico tratante. Payload sugerido: `{ instanciaId, firmaId, hashDocumento, firmanteId, firmadoEn, episodioId, cie10Principal }`. **Acción downstream**: dispara cambio de estado del episodio (`fecha_hora_egreso` poblada en `episodio_atencion` / `episodio_hospitalario`).
- **`epi_egr.entregada`** — propuesto: emitir cuando paciente / familiar confirme recepción. Payload sugerido: `{ instanciaId, recibidoPor, relacionConPaciente, recibidoEn, firmaRecepcionRef }`. **No modelado** en BD (no hay columna `entregado_en` ni tabla de recepciones). PENDIENTE — modelar.
- **`epi_egr.condicion_egreso_definida`** — propuesto: emitir cuando se setee `condicion_egreso` (campo aún no en BD). PENDIENTE.

PENDIENTE — validar con @AS si los eventos se emiten exclusivamente vía outbox (`emitDomainEvent` ya usado para `certificada`) o si se replican en `audit.audit_log` (hash-chain Art. 55–56). Patrón actual: outbox + audit triggers paralelos.

## Documentos que esto dispara
- **`circunstancia_alta='referido_otro_hospital'`** → genera/encadena con documento **`RRI_HOS`** (Referencia / Retorno / Interconsulta hospitalaria). NTEC requiere RRI firmado antes del traslado físico. El motor no enforza la creación automática; la UI debe disparar el formulario RRI cuando se seleccione esta circunstancia.
- **`tipo_egreso='fallecido'`** → **dispara obligatoriamente `CERT_DEF`** (Certificado de Defunción). `tipo_documento.depende_de=['EPICRISIS']` para `CERT_DEF` (seed línea 82). La epicrisis con `tipo_egreso='fallecido'` debe estar al menos en estado `firmado` antes de iniciar el `CERT_DEF`. **Restricción de catálogo restricciones_calidad**: `"fallecido => exige Certificado de Defunción vinculado"` (`analisis_workflows_ece.md:571`). Adicionalmente, la auditoría requiere validar que el flujo de defunción legacy (`/deaths`) consolide o se sincronice con `CERT_DEF` ECE (ver memoria de migración `migrate-deaths-to-ece.mjs`).
- **Citas de seguimiento (`citas_seguimiento` poblado)** → genera/sugiere citas en `/appointments` (módulo HIS). El motor no las crea automáticamente; la UI de cierre de epicrisis debe ofrecer "Crear cita ahora" por cada entrada del array.
- **Prescripción ambulatoria de egreso (`tratamiento_egreso` con medicación)** → puede generar **receta ambulatoria** en el módulo `/prescriptions`. PENDIENTE — definir si se modela como documento NTEC separado (`RECETA_EGRESO`) o como anexo a la epicrisis. El brief del prompt menciona "medicacion_al_alta (prescripción ambulatoria)" como campo; actualmente se captura como texto libre en `tratamiento_egreso`.
- **Reporte SNIS / MINSAL de egresos** → la certificación de la epicrisis (`ece.epicrisis.certificada` + `documentHash`) alimenta el procesamiento estadístico (TDR §13). No es un documento clínico; es un agregado.
- **Cierre operativo de cama** → el legacy `encounterDischargeRouter.dischargeEncounter` (`encounter-discharge.router.ts:80-89`) actualiza `BedAssignment.releasedAt = now()` y `Bed.status = 'DIRTY'`. La epicrisis formal ECE no toca cama directamente; depende del bridge con el flujo legacy de alta.

## Drift conocido (auditoría) y riesgos

**Hallazgos consolidados** (ver `docs/audit/2026-05-19_audit_stream_d_hospitalizacion.md` y `2026-05-19_audit_stream_b_clinico_activo.md`):

- **EPI-D1 [P1 — ALTO] — Doble persistencia legacy vs ECE.** El router `encounterDischargeRouter.dischargeEncounter` persiste la epicrisis como entry de `audit.audit_log` con `entity='Encounter.epicrisis'` (`encounter-discharge.router.ts:137-147`). El router `epicrisisRouter.create` persiste en `ece.epicrisis_egreso`. **No hay bridge automático**: un egreso operado por `/discharges` no genera fila en `ece.epicrisis_egreso`, y viceversa. Conformidad NTEC requiere que **todo episodio hospitalario tenga epicrisis ECE** — riesgo de incumplimiento si la UI de `/discharges` se usa sin abrir paralelamente `/ece/epicrisis`. **Mitigación pendiente**: extender legacy para que `dischargeEncounter` cree (o redirija a) creación ECE, o eliminar la doble vía. Aplica la regla de "Adecuar legacy vs duplicar" del CLAUDE.md.
- **EPI-D2 [P2 — MEDIO] — Enum `motivoEgreso` Zod no alineado con enum BD `circunstancia_alta`.** Router Zod (`epicrisis.router.ts:60`): `alta_voluntaria | alta_medica | traslado | fallecido | otro`. BD CHECK: `alta_hospitalaria | referido_otro_hospital | alta_voluntaria | fuga | in_extremis | alta_rehabilitada_ISRI`. El valor `otro` no existe en BD (falla en INSERT); `alta_medica` no mapea limpiamente a `alta_hospitalaria`; faltan `fuga`, `in_extremis`, `alta_rehabilitada_ISRI` en el Zod. **Mitigación**: alinear ambos catálogos. PR de armonización pendiente.
- **HD-09 [P2 — MEDIO] — `confirmarAlta` no valida médico firmante.** El router `episodio-hospitalario.router.ts.confirmarAlta` valida que `estado_epicrisis NOT IN ('borrador','anulado')` pero no verifica que `epicrisis.medico_tratante_id == ctx.user.id`. Permite que el médico A confirme alta con epicrisis firmada por médico B, violando Art. 40 NTEC. (Audit `2026-05-19_audit_stream_d_hospitalizacion.md:229-233`.)
- **EPI-D3 [P2 — MEDIO] — `estado_registro` (legacy) duplicado con `estado_workflow` (workflow).** Mismo drift que HC: la fila tiene dos campos de estado que pueden divergir.
- **EPI-D4 [P2 — MEDIO] — Falta validación ESP firma electrónica.** La transición `validar` no requiere firma del ESP; solo registra `visto_jefe_servicio_id`. Art. 40 NTEC habla de "firmas progresivas" — interpretación pendiente con @AE/@PO de si "visto" basta o si requiere firma electrónica del jefe de servicio.
- **EPI-D5 [P3 — BAJO] — Campos del brief no modelados.** `complicaciones`, `condicion_egreso` (MEJORADO|SIN_CAMBIOS|EMPEORADO|...), `estancia_dias_calculada` (derivable), `medicacion_al_alta` (estructurada, no como texto libre en `tratamiento_egreso`), `control_indicado` (estructurado por especialidad+plazo, no solo `citas_seguimiento` libre). Modelar si la versión MINSAL del Acuerdo 1616 lo exige (no se encontró explícito en los insumos disponibles — PENDIENTE).
- **EPI-D6 [P3 — BAJO] — Recepción del paciente no modelada.** Evento `epi_egr.entregada` y firma de recibido del paciente / familiar no están en BD. Modelar columna `entregado_en` + `recibido_por_nombre` + `recibido_por_relacion` + adjunto de firma escaneada o referencia a kiosk de firma electrónica del paciente.
- **EPI-D7 [P3 — BAJO] — Falta link automático SOL_EST/RES_EST relevantes.** `resultados_complementarios` es texto libre. Idealmente debería referenciar IDs de `RES_EST` para trazabilidad y para incluir resultados firmados como anexo del PDF de epicrisis. Modelar como `resultados_relevantes_ids: uuid[]`.

**Drift adicional 2026-05-22:**
- La tabla `ece.episodio_hospitalario` (no confundir con `ece.episodio_atencion`) tiene un campo `tipo_egreso` propio (`audit Stream D:193`). El router `epicrisisRouter` opera sobre `ece.epicrisis_egreso.tipo_egreso`, no propaga al episodio. Cuando se firma/certifica la epicrisis, el `episodio_hospitalario.tipo_egreso` debe sincronizarse — actualmente sin trigger. PENDIENTE — agregar trigger o paso explícito en `firmar()`.
- La auditoría Stream D señala drift de nombres `fecha_egreso` vs `fecha_hora_egreso` en `episodio_hospitalario`. La epicrisis no es afectada directamente pero las consultas conjuntas requieren cuidado.

## Descripción markdown rica (para BD `descripcion_markdown`)

> **Epicrisis de Egreso** — Documento histórico que cierra formalmente el episodio hospitalario y constituye el **resumen del expediente** definido por el Art. 41 lit. c NTEC: identificación, diagnósticos finales codificados (CIE-10), procedimientos realizados, manejo terapéutico, resultados de estudios complementarios y firmas de responsables (médico tratante, jefe de servicio, director). Es el **único documento del expediente cuya certificación es atribución exclusiva de la Dirección del establecimiento** o su delegado (Art. 21 NTEC), motivo por el cual su workflow exige tres firmas progresivas: MC firma el contenido, ESP valida desde el servicio, DIR certifica el cierre. Tras la certificación, **el documento es inmutable**: cualquier cambio requiere rectificación trazable conservando la versión previa (Art. 42 NTEC) y el `documentHash` SHA-256 emitido en el evento `ece.epicrisis.certificada` permite verificar la integridad a perpetuidad.
>
> **Cuándo se usa:** **siempre** al cierre de un episodio hospitalario, sin excepción — alta médica, traslado a otro establecimiento, alta voluntaria, fuga, in extremis o defunción. Es **obligatoria 1:1 con el episodio** (`UNIQUE(episodio_id)` en BD): no puede haber dos epicrisis para el mismo episodio, ni un episodio cerrado sin epicrisis. La modalidad es exclusivamente hospitalaria; los cierres ambulatorios o de emergencia sin ingreso no generan epicrisis sino notas finales en HC o ATN_EMERG.
>
> **Qué NO es:** no es nota de evolución diaria (eso es `EVOL_MED`), ni hoja de ingreso (eso es `HOJA_ING`), ni receta ambulatoria de egreso (módulo separado), ni certificado de defunción (eso es `CERT_DEF`, que **es disparado** por una epicrisis con `tipo_egreso='fallecido'`), ni documento de referencia / retorno (eso es `RRI_HOS`, **disparado** por una epicrisis con `circunstancia_alta='referido_otro_hospital'`). La epicrisis es el documento integrador del cierre, no un sustituto de las notas evolutivas que la sustentan.
>
> **Datos clínicos clave:** el contenido mínimo exigible es (a) tipo de egreso (vivo / fallecido) catalogado, (b) circunstancia del alta catalogada (Art. 17 lit. b NTEC), (c) diagnóstico principal CIE-10 + secundarios + comorbilidades, (d) procedimientos realizados durante la hospitalización, (e) resumen evolutivo, (f) tratamiento durante el internamiento, (g) resultados complementarios relevantes (laboratorio, imagenología), (h) indicaciones al egreso (dieta, actividad, signos de alarma, medicación ambulatoria), (i) citas de seguimiento (especialidad + plazo). El `cie10_principal` es **hard-stop al firmar**: el sistema bloquea la transición `borrador → firmado` con `PRECONDITION_FAILED` si está vacío (Art. 17 NTEC).
>
> **Eventos disparadores downstream:** `tipo_egreso='fallecido'` exige el flujo de Certificado de Defunción (`CERT_DEF`) que tiene a la epicrisis como su única dependencia formal. `circunstancia_alta='referido_otro_hospital'` exige documento RRI hospitalario para el traslado. `citas_seguimiento` poblado debe generar citas ambulatorias en el módulo `/appointments`. La certificación de la epicrisis dispara el evento de dominio `ece.epicrisis.certificada` con `documentHash` SHA-256, que es consumido por el motor de **reporte SNIS de egresos hospitalarios** (días-cama, mortalidad, estancia, complicaciones — TDR §13) y por el **cierre administrativo del episodio** (liberación de cama operada por el flujo legacy `/discharges`).
>
> **Errores comunes:**
> - Cerrar el episodio operativamente en `/discharges` (legacy) sin abrir la epicrisis formal en `/ece/epicrisis` — el episodio queda sin documento NTEC (drift EPI-D1).
> - Firmar la epicrisis sin codificar el CIE-10 principal — el sistema bloquea con `PRECONDITION_FAILED`, pero la práctica es escribir el diagnóstico solo en texto libre y olvidar el código estructurado.
> - Confundir `tipo_egreso='fallecido'` con poder cerrar el episodio sin emitir el `CERT_DEF` — el ciclo no está completo hasta que el certificado de defunción se firma y certifica.
> - Editar el contenido tras la firma del MC — bloqueado por trigger `trg_bloquea_epicrisis`. Usar rectificación trazable (Art. 42 NTEC).
> - Certificar sin que el jefe de servicio haya validado — el motor permite el orden estricto borrador → firmado → validado → certificado; saltar `validado` falla en la transición.
> - Confirmar el alta administrativa con epicrisis firmada por **otro** médico (HD-09) — el sistema actual no lo bloquea; vigilar manualmente hasta que se cierre el hallazgo.
> - Olvidar que tras `certificado` no hay rollback: una corrección requiere nueva instancia rectificadora; la copia certificada para expediente / paciente / aseguradora ya emitida queda como referencia histórica.
