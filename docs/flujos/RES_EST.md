# RES_EST — Resultado de Estudios

## Metadata
- **codigo**: RES_EST
- **nombre**: Resultado de Estudio
- **modalidad**: AMBULATORIO, HOSPITALIZACION, EMERGENCIA (NTEC: `ambos`)
- **NTEC artículo**: §3.18 (NTEC Acuerdo n.° 1616, MINSAL 2024) — bloque "Resultado"; §17.5 y §17.6 TDR (validación técnica/médica + reporte LIS); §18.4 TDR (lectura e informe RIS)
- **modulo_his_target**: `/lab-results` (legacy LIS resultados), `/imaging` (legacy RIS informe), `/ece/estudios/[id]/registrar-resultado` (registro NTEC)
- **tabla_datos**: `ece.resultado_estudio` (registro NTEC) + bridge a `LabResult` (laboratorio) / `ImagingReport` (imagenología)
- **inmutable**: **true** (histórico — `tipo_registro='historico'`. Una vez firmado por el responsable de validación, no admite UPDATE/DELETE: solo rectificación con nueva versión, Art. 42 NTEC. La columna `estado_registro` enforza el invariante: `IN ('vigente','rectificado')`)
- **tipo_registro**: OBLIGATORIO toda vez que exista una SOL_EST en estado `firmado`/`resultado_listo` cuyo procesamiento se haya completado

## Propósito normativo

El **Resultado de Estudio (RES_EST)** documenta el informe técnico/médico del examen complementario solicitado por SOL_EST. Es el sustento objetivo del diagnóstico, del plan terapéutico subsecuente y de la responsabilidad profesional del validador (patólogo clínico, radiólogo, profesional de gabinete). Su carácter **histórico inmutable** está fundamentado en el Art. 42 NTEC (rectificación trazable, no borrado) y en el riesgo médico-legal que conlleva una modificación silenciosa de resultados clínicos.

El documento cubre tres dominios diagnósticos con estructura JSONB polimórfica (`valores`):
- **Laboratorio clínico** (TDR §17): múltiples analitos por estudio, cada uno con valor, unidad, rango de referencia estratificado por edad/sexo, y flag (normal/alto/bajo/crítico).
- **Imagenología** (TDR §18): informe estructurado del radiólogo con hallazgos, impresión, recomendación; opcionalmente plantillas RSNA/BI-RADS/LI-RADS/PI-RADS/TI-RADS/Lung-RADS.
- **Gabinete** (ECG, espirometría, electroencefalografía, etc.): trazado + interpretación del profesional.

El flag `'critico'` en `valores` debe disparar notificación inmediata al médico solicitante con registro de a quién y a qué hora se notificó (TDR §17.5 — "manejo de valores críticos" — y §18.4 — "hallazgos críticos con notificación urgente"). El TAT (Turn-Around-Time) por prueba y la tasa de valores críticos notificados <30 min son indicadores operativos del módulo (TDR §17.9, §18.6).

## Dependencias (depende_de)

- **SOL_EST** — bloqueante. Sin solicitud firmada no puede existir resultado válido. En BD: `ece.resultado_estudio.solicitud_id NOT NULL` referencia `ece.solicitud_estudio(id)` (archivo `61_ece_06_documentos.sql:755-769`). En el motor, el estado mínimo de la SOL_EST para crear RES_EST debe ser `firmado` (PENDIENTE — validar con @AE/@PO si debe ser `validado` o si admite `firmado`).
- **EPISODIO_ATENCION** (transitiva, vía SOL_EST → episodio).
- **HIST_CLIN** (transitiva, vía SOL_EST).

## Obligatoriedad por modalidad / contexto

| Modalidad / contexto | Obligatoriedad | Justificación |
|---|---|---|
| Toda SOL_EST firmada procesada (cualquier modalidad) | OBLIGATORIA | Cierre del ciclo diagnóstico; sin RES_EST la SOL_EST queda colgada en `en_proceso` (TDR §17.6, §18.5). |
| SOL_EST anulada | NO APLICA | El estado terminal `anulado` excluye procesar resultado. |
| SOL_EST externalizada a referencia (`LabOrder.externalLabRef NOT NULL`) | OBLIGATORIA registro manual | El resultado del laboratorio externo debe digitarse o cargarse para cerrar el ciclo. |
| Resultado con flag `'critico'` | OBLIGATORIA notificación adicional al MC + registro de notificación | TDR §17.5 y §18.4 — comunicación de valor crítico es parte de la trazabilidad de la responsabilidad profesional. |
| Mamografía de tamizaje | CONDICIONAL doble lectura (segundo radiólogo) | TDR §18.4. PENDIENTE — validar con @AE/@PO si el motor debe soportar doble RES_EST o un segundo estado `revalidado`. |

## Roles firmantes / actores

| Rol | Acción | Momento |
|---|---|---|
| PROF_DX (Profesional Diagnóstico — TEC laboratorio / Tecnólogo imagen) | Captura valores del resultado en estado `borrador` (validación técnica, TDR §17.5) | Tras procesamiento del analizador / realización del estudio |
| PROF_DX (Patólogo clínico / Radiólogo) | Firma electrónica simple (PIN argon2id) en transición `firmar` (validación médica, TDR §17.5 y §18.4) | Cuando los valores están técnicamente validados y listos para informe |
| MC (Médico solicitante o validador clínico superior) | Acción `aprobar` / `validar` — opcional según política institucional | Al recibir el informe en el HCE para confirmar lectura |
| DIR (Dirección) | Anula el registro vía transición universal `anular` | Excepcional: error en identificación de muestra, mezcla de resultados, motivos médico-legales |

Notas:
- En la implementación actual (`packages/trpc/src/routers/ece/resultado-estudio.router.ts`) no existe registro de RES_EST como `tipo_documento` separado en `ece.tipo_documento` (la siembra `63_ece_08_seed.sql` solo registra SOL_EST). Esto implica que **los actores y la matriz `documento_rol` para RES_EST están PENDIENTES — validar con @AE/@PO antes de aplicar seed**.
- Los roles aquí listados se derivan del análisis de workflows (`analisis_workflows_ece.md §3.18`) y del schema de `ece.resultado_estudio` (campo `responsable_validacion_id`).

## Campos obligatorios mínimos NTEC

Mapeo basado en `ece.resultado_estudio` (archivo `61_ece_06_documentos.sql:755-769`):

- `id` — UUID, generado por BD.
- `instancia_id` — UUID NOT NULL, FK a `ece.documento_instancia` (vínculo al motor workflow).
- `solicitud_id` — UUID NOT NULL, FK a `ece.solicitud_estudio` (vínculo a SOL_EST padre).
- `valores` — JSONB NOT NULL, polimorfo según tipo de SOL_EST padre:
  - Laboratorio: `[{analito, valor_texto, valor_numerico, unidad, rango_referencia_texto, flag: 'normal'|'alto'|'bajo'|'critico', metodo}]`
  - Imagenología: típicamente un único objeto con `{findings, impression, recommendation, plantilla_estructurada}` (BI-RADS/LI-RADS/etc.).
  - Gabinete: trazado/curva + texto interpretativo.
- `interpretacion` — TEXT, opcional, texto libre del profesional validador.
- `responsable_validacion_id` — UUID NOT NULL, FK a `ece.personal_salud` (el patólogo/radiólogo/profesional que firma).
- `fecha_hora_informe` — TIMESTAMPTZ NOT NULL DEFAULT now(), precisión segundo (Art. 55 NTEC).
- `estado_registro` — TEXT NOT NULL DEFAULT `'vigente'`, CHECK `IN ('vigente','rectificado')` — invariante del histórico: vigente o reemplazado por rectificación.

Para integración con módulos legacy:
- `LabResult` (`schema.prisma:2092-2114`): `orderItemId`, `specimenId`, `resultedAt`, `resultedById`, `valueNumeric`, `valueText`, `valueUnit`, `flag` (NORMAL/LOW/HIGH/CRITICAL_LOW/CRITICAL_HIGH/ABNORMAL), `validatedAt`, `validatedById` (regla 4-eyes — validador ≠ resultedBy enforced en router LIS).
- `ImagingReport` (`schema.prisma:2784-2803`): `orderId` (1-1 con `ImagingOrder`), `radiologistId`, `findings`, `impression`, `recommendation`, `reportedAt`, `signedAt`, `validatedAt` (cuando se establece, el reporte es inmutable por trigger DB), `amendedAt` (append-only enmiendas, ADR 0004).

## Estados (flujo_estado)

**PENDIENTE — RES_EST no está sembrado en `ece.tipo_documento`** (revisado `63_ece_08_seed.sql`, solo existe SOL_EST). Propuesta para Fase 1 del workflow designer, alineada al patrón inmutable (mismo grupo que CONS_INF, ACTO_QX, EPICRISIS, CERT_DEF en seed actual — saltean `en_revision`):

| codigo | nombre | es_inicial | es_final | orden |
|---|---|---|---|---|
| `borrador` | Borrador (validación técnica) | true | false | 1 |
| `firmado` | Firmado (validado médicamente) | false | false | 3 |
| `validado` | Validado (visto MC solicitante) | false | true | 4 |
| `anulado` | Anulado | false | true | 9 |

Estado del campo de datos (`ece.resultado_estudio.estado_registro`):
- `vigente` — versión activa del resultado.
- `rectificado` — reemplazado por una nueva versión (la nueva instancia con `version+1` en `documento_instancia` apunta al mismo `solicitud_id`).

Justificación del patrón inmutable:
- El tipo de registro `historico` exige bloqueo de UPDATE/DELETE post-firma (trigger `ece.fn_tabla_historica_inmutable`, archivo `60_ece_05_motor.sql:287-314`). Por lo tanto la tabla `ece.resultado_estudio` debe registrarse vía `SELECT ece.registrar_tabla_historica('resultado_estudio')`.
- Saltar `en_revision` es coherente con CONS_INF/ACTO_QX/EPICRISIS: documentos que firma una sola autoridad y que se vuelven inmutables al firmar.

## Transiciones (flujo_transicion)

**PENDIENTE — sin seed actual.** Propuesta basada en `analisis_workflows_ece.md §3.18` + patrón observable en otros documentos `historico` del seed:

| origen | destino | acción | rol_autoriza | requiere_firma | condición |
|---|---|---|---|---|---|
| `borrador` | `firmado` | `firmar` | PROF_DX (PENDIENTE — definir rol específico para patólogo/radiólogo en `ece.rol`; alternativa: usar MC con función LLENA/RESPONSABLE) | **true** (PIN del validador) | Resultado técnicamente verificado; cierre del lado del laboratorio/imagenología (TDR §17.5, §18.4). |
| `firmado` | `validado` | `validar` | MC solicitante | false (PENDIENTE — recomendación HH-05 audit: elevar a `true` con PIN) | El médico solicitante reconoce la lectura del informe. Opcional según política institucional. |
| `borrador` | `anulado` | `anular` | DIR | **true** | Universal: solo Dirección puede anular un documento del expediente. |

Reglas adicionales (deben enforced a nivel motor o trigger):
- SOL_EST padre debe estar en estado `firmado` o `validado` para permitir creación de RES_EST (PENDIENTE — definición exacta con @AE/@PO).
- Una SOL_EST puede tener **N RES_EST en `estado_registro='rectificado'` + 1 en `'vigente'`** (versionado), pero solo 1 vigente a la vez.
- Tras `firmado`, cualquier corrección requiere crear nueva `documento_instancia` con `version+1` y marcar la anterior como `rectificado` (Art. 42 NTEC).

## Eventos de dominio

Eventos emitidos por el router ECE y/o por bridges hacia LIS/RIS:

- `ece.resultado_estudio.creado` — al INSERT en estado `borrador`.
- `ece.resultado_estudio.firmado` — transición borrador → firmado, con `firma_id` y `responsable_validacion_id`.
- `ece.resultado_estudio.validado` — transición firmado → validado.
- `ece.resultado_estudio.anulado` — transición * → anulado.
- `ece.resultado_estudio.rectificado` — al crear nueva versión que marca la anterior como `rectificado`.
- `lab.criticalValue` — emitido por LIS cuando `flag IN ('CRITICAL_LOW','CRITICAL_HIGH')` (ya implementado en `lis.router.ts`, TDR §17.5).
- `imaging.criticalFinding` — emitido por RIS para hallazgo crítico (TDR §18.4).
- `lab.resultValidated` — emitido tras regla 4-eyes en `LabResult.validatedAt`.
- `imaging.reportSigned` — emitido tras `ImagingReport.signedAt` o `validatedAt`.

## Drift conocido (audit) y riesgos

Auditoría Stream H (`docs/audit/2026-05-19_audit_stream_h_diagnosticos.md`), commit `6532a92`:

- **HH-02 [P0]** — Schema drift masivo en `ece.resultado_estudio`: el router asume 6 columnas inexistentes en BD: `resultado` (BD usa `valores`), `adjunto_uri` (no existe), `registrado_por` (BD usa `responsable_validacion_id`), `aprobado_por`, `aprobado_en`, `comentario_medico` (no existen), `estado` (BD usa `estado_registro`), `registrado_en` (BD usa `fecha_hora_informe`). INSERT y SELECT fallan en runtime. **Bloqueante go-live.** Recomendación: alinear el router a las columnas reales o aplicar DDL para columnas faltantes con justificación funcional (`adjunto_uri` parece necesario para imágenes/PDF adjuntos; `comentario_medico` parece equivalente al `interpretacion` existente).
- **HH-05 [P2]** — Aprobación de resultado sin PIN: el botón "Aprobar" en `/ece/estudios/[id]/page.tsx:229` llama a `trpc.eceResultadoEstudio.aprobar` sin solicitar PIN al MC. La aprobación es un acto médico que debe quedar acreditado con firma. Recomendación: agregar diálogo con PIN antes de transición a `validado`.
- **HH-06 / HH-08 [P0]** — RLS bypass en LIS e Imaging: los routers legacy no usan `withTenantContext`; las políticas con `roles={public}` no se aplican. Si RES_EST sincroniza con `LabResult` / `ImagingReport` vía bridge, el aislamiento tenant depende exclusivamente del filtro JS. **Bloqueante go-live para módulos legacy.**
- **HH-09 [P1]** — Auto-flagging LIS sin contexto paciente: el formulario `EnterResultDialog` (`/lis/orders/[id]/page.tsx:662-674`) no envía `patientAgeYears` ni `patientSex` al router, por lo que la estratificación de rangos de referencia se ignora. Recomendación: el router debe cargar `patient.biologicalSexId` y `patient.birthDate` server-side y calcular flag con estratificación correcta.
- **HH-16 / HH-17 [P0/P1]** — Pathology (Anatomía Patológica) tiene router completo pero **5 tablas Prisma referenciadas no existen en BD** y **no hay UI** (`apps/web/src/app/(clinical)/pathology/`). Si RES_EST debe cubrir también informes anatomopatológicos (TDR §17.7 "Anatomía Patológica"), el módulo está inoperativo. Recomendación: aplicar migración DDL `XX_pathology.sql` y construir UI.

Riesgos residuales:
- **Sin seed actual** — RES_EST no figura como `tipo_documento` independiente. En la implementación vigente, el ciclo de resultado se modela como continuación del workflow de SOL_EST (transición `firmado → validado` sobre la solicitud, no sobre el resultado). La Fase 1 del workflow designer debe decidir explícitamente:
  - **Opción A**: tratar RES_EST como `tipo_documento` separado con su propio grafo de estados (alineado a NTEC §3.18 que distingue "Solicitud" y "Resultado" como entidades distintas).
  - **Opción B**: mantener un único workflow SOL_EST que abarca todo el ciclo, con RES_EST como tabla satélite sin workflow propio (más simple, pero pierde trazabilidad de validación médica separada).
  Recomendación: **Opción A** — preserva el principio NTEC de responsable de validación distinto del solicitante y permite auditoría separada de TAT por etapa.
- Falta de rol específico `PROF_DX` (patólogo clínico / radiólogo) en `ece.rol`. Catálogo actual: ADM, AC, ARCH, ENF, MT, MC, ESP, IC, DIR. **PENDIENTE — agregar `LAB_TEC`, `RAD`, `PAT` con su matriz `documento_rol`**.

## Descripción markdown rica (para BD `descripcion_markdown`)

El **Resultado de Estudio (RES_EST)** es el documento médico-legal histórico que registra el informe técnico/médico del examen complementario solicitado por una SOL_EST. Forma parte del expediente clínico electrónico según el **artículo §3.18 de la NTEC (Acuerdo n.° 1616, MINSAL 2024)** y constituye el sustento objetivo del diagnóstico, del plan terapéutico subsecuente y de la responsabilidad profesional del validador (patólogo clínico, radiólogo, profesional de gabinete).

### Naturaleza inmutable (Art. 42 NTEC)

A diferencia de SOL_EST (que admite revisión antes de firma), el RES_EST es un **registro histórico inmutable**: una vez firmado por el responsable de validación, no admite UPDATE/DELETE. Cualquier corrección requiere crear una **nueva versión** (`documento_instancia.version+1`) marcando la versión previa como `rectificado` en la columna `estado_registro`. El invariante está enforced por el trigger `ece.fn_tabla_historica_inmutable` (registrado en la tabla vía `ece.registrar_tabla_historica('resultado_estudio')`).

### Cobertura polimórfica (JSONB)

El campo `valores` (JSONB) soporta tres dominios diagnósticos sin cambio de esquema:

- **Laboratorio clínico** (TDR §17.6) — múltiples analitos por estudio, cada uno con `{analito, valor_texto, valor_numerico, unidad, rango_referencia_texto, flag, metodo}`. El flag `'critico'` dispara notificación inmediata al médico solicitante (TDR §17.5) con registro auditable de a quién y a qué hora se notificó.
- **Imagenología** (TDR §18.4) — informe estructurado del radiólogo con hallazgos, impresión y recomendación. Soporta plantillas RSNA/BI-RADS/LI-RADS/PI-RADS/TI-RADS/Lung-RADS según protocolo institucional. Hallazgos críticos disparan notificación urgente al solicitante.
- **Gabinete** — trazado (ECG, espirometría, EEG, polisomnografía) + interpretación del profesional.

### Validación técnica y médica (TDR §17.5)

El ciclo NTEC implica dos pasos de validación:

1. **Validación técnica** (`borrador`): el técnico/tecnólogo captura los valores del analizador o del estudio, verifica calibración, hemólisis/lipemia/ictericia (laboratorio) o calidad de imagen (radiología).
2. **Validación médica** (`firmado`): el patólogo clínico, radiólogo o profesional habilitado revisa, agrega interpretación si aplica, y firma electrónicamente (PIN argon2id contra `ece.firma_electronica`). Tras esta firma el registro queda inmutable.

Para laboratorios con criterios de auto-validación (rangos sin flag y sin delta-check fallido), TDR §17.5 admite que la firma sea automática y el reporte pase directamente a `firmado`; el responsable es el patólogo clínico que aprobó la regla.

### Regla 4-eyes y doble lectura

En LIS legacy (`packages/trpc/src/routers/lis.router.ts`), la transición a `VALIDATED` en `LabResult` exige que `validatedById ≠ resultedById` (regla 4-eyes — el que ingresa el resultado no puede ser el mismo que lo valida). Esta regla debe replicarse o documentarse explícitamente en la implementación del workflow RES_EST.

En RIS para **mamografía de tamizaje** (TDR §18.4), el protocolo institucional puede exigir doble lectura por un segundo radiólogo. El motor de workflow debe poder modelar esta variante (PENDIENTE — validar con @AE/@PO si se modela como segunda instancia con `version=2` o como nuevo estado `doble_validado`).

### Tele-radiología y descentralización

TDR §18.4 admite lectura remota (tele-radiología) por un radiólogo en otra sede u organización. El motor debe soportar que `responsable_validacion_id` corresponda a un `personal_salud` con `establishment_id` distinto al del paciente, mientras la transición y la firma queden registradas en el historial del documento.

### Cumplimiento normativo

- **NTEC Art. 42** — rectificación trazable, versionado, no borrado.
- **NTEC Art. 55-56** — metadatos `usuario_creador`, `firma_electronica_simple`, `timestamp` precisión segundo, bitácora ≥ 2 años.
- **TDR §17.5** — validación técnica + médica; manejo de valores críticos con notificación inmediata.
- **TDR §17.6** — resultados con valores de referencia por edad/sexo; tendencias gráficas históricas; comentarios interpretativos.
- **TDR §17.9** — indicadores: TAT por prueba, tasa de valores críticos notificados <30 min.
- **TDR §18.4** — informe firmado electrónicamente; hallazgos críticos con notificación urgente; doble lectura para mamografía de tamizaje cuando aplique.
- **TDR §18.5** — disponibilidad inmediata en HCE; visor ligero DICOM embebido; compartición con paciente vía portal con marca de agua y consentimiento.
