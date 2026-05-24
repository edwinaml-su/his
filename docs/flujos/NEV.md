# NEV — Nota de Evolución (modalidad ambulatoria)

## Metadata
- **codigo**: `EVOL_MED` (codigo siembra `ece.tipo_documento`; este archivo documenta su uso en modalidad **ambulatoria**)
- **nombre**: Nota / Hoja de Evolución Médica
- **modalidad**: AMBULATORIO (tipo_documento.modalidad sembrado como `ambos` — en hospitalización la nota de evolución es diaria, en ambulatorio es por consulta subsecuente)
- **NTEC artículo**: Arts. 19 (ordenamiento cronológico ascendente del expediente), 23 lit. a.4 (firma electrónica simple obligatoria por nota), 42 (rectificación trazable post-firma), 55–56 (metadatos obligatorios y bitácora ≥2 años) — Acuerdo n.° 1616 MINSAL (30/05/2024, D.O. T.444 N°158). El TDR referencia "Art. 28–30" para este doc — PENDIENTE — validar con @AE/@PO el rango exacto del Acuerdo 1616 (la versión del análisis usado cita explícitamente Arts. 19/42/55 para evolución médica; Art. 28 no aparece como referencia directa).
- **modulo_his_target**: `/encounters/[id]/notes` (legacy — Timeline de notas SOAP del encuentro, TDR §10.3 "notas SOAP") y `/ece/evolucion` (ya implementado — listado cronológico inverso por episodio ECE). Ambos coexisten: el primero es el módulo HCE genérico, el segundo es la vista NTEC formal del expediente ECE. Decisión arquitectónica: **adecuar** `/encounters/[id]/notes` para emitir filas en `ece.evolucion_medica` cuando el episodio esté gobernado por ECE; **NO** duplicar la captura.
- **tabla_datos**: `ece.evolucion_medica` (Prisma `EceEvolucionMedica` — `packages/database/prisma/schema.prisma:5098`)
- **inmutable**: false en seed, pero efectivamente **inmutable post-firma** vía bitácora append-only (`documento_instancia_historial`) + política de rectificación (Art. 42 NTEC: corrección crea nota nueva, no muta la firmada). El campo `tipo_registro` en seed es `transaccional` pero la nota individual firmada se comporta como histórica.
- **tipo_registro**: OBLIGATORIO por cada consulta ambulatoria subsecuente con el mismo motivo de consulta (cuando ya existe `HIST_CLIN` vigente para el episodio).

## Propósito normativo
La Nota de Evolución registra el **seguimiento clínico cronológico** durante consultas subsecuentes ambulatorias (y la estancia hospitalaria, fuera del alcance de este documento). Usa estructura **SOAP** — Subjetivo, Objetivo, Análisis, Plan — para capturar la progresión del paciente, actualizar diagnósticos (CIE-10) y registrar cambios de plan terapéutico.

Cumple la exigencia NTEC de **ordenamiento cronológico ascendente** del expediente (Art. 19) y de **firma electrónica simple** por cada nota (Art. 23 lit. a.4). Cubre el riesgo médico-legal de la continuidad asistencial entre consultas y soporta la trazabilidad clínica longitudinal (HCE — TDR §14). Una nota firmada solo se corrige mediante adendo o rectificación trazable que conserve la versión original (Art. 42 NTEC; pattern de "addendum" ya implementado en `/encounters/[id]/notes`).

## Dependencias (depende_de)
Documentos que DEBEN existir y estar firmados antes de crear este:
- `HIST_CLIN` (Historia Clínica) — debe existir una HC vigente del paciente para el episodio o motivo de consulta. La nota de evolución es por definición **subsecuente** a una primera valoración (Art. 19 NTEC, orden cronológico). Sembrado como única dependencia en `ece.tipo_documento.depende_de` para `EVOL_MED`.

Recomendados (no bloqueantes):
- `SIG_VIT` (Hoja de Signos Vitales del control) — recomendado para la sección Objetivo del SOAP, pero el motor no lo enforza.
- `IND_MED` (Indicaciones Médicas previas) — referenciadas en la sección Plan cuando se ajustan o continúan; no es prerrequisito de creación.

## Obligatoriedad por modalidad / contexto
- AMBULATORIO primera vez: **NO** (la primera consulta usa Historia Clínica `HIST_CLIN`, no Nota de Evolución).
- AMBULATORIO subsecuente: **SI** (obligatorio en cada consulta de control / seguimiento con el mismo motivo que la HC inicial del episodio).
- Por especialidad: estructura SOAP es genérica. Especialidades pueden extender los campos JSONB (`diagnostico_cie10` y `data`) sin crear documento nuevo. Salud Mental, Pediatría y Gineco-Obstetricia comparten el mismo tipo. PENDIENTE — validar con @AE/@PO si la Nota de Evolución de salud mental requiere régimen reforzado de confidencialidad.

## Roles firmantes / actores
| Rol | Acción | Momento |
|---|---|---|
| MC (Médico de Cabecera / tratante) | LLENA, RESPONSABLE, FIRMA, AUTORIZA validación | Durante y al cierre de la consulta subsecuente |
| MT (Médico de Turno) | LLENA (obligatorio=false — alternativo) | Cuando MC no está disponible; común en hospitalización y en cobertura de consulta externa por turnos |
| ENF (Enfermería) | Toma signos vitales (en `SIG_VIT`) referenciados desde la sección Objetivo | Pre-consulta del control |

Fuente: `ece.documento_rol` seed en `packages/database/sql/63_ece_08_seed.sql` líneas 371–375.

## Campos obligatorios mínimos NTEC
Mapeados a columnas de `ece.evolucion_medica` (Prisma `EceEvolucionMedica`):

- `episodio_id` — FK obligatorio a `ece.episodio_atencion` (uuid, NOT NULL). Encadena la nota al episodio del paciente.
- `fecha_hora` — timestamptz NOT NULL DEFAULT now(). Marca temporal cronológica (Art. 19 NTEC). Nivel segundo (Art. 55).
- `subjetivo` — text. Lo que refiere el paciente: síntomas, percepción, eventos desde la última consulta.
- `objetivo` — text. Hallazgos del examen físico actualizado + referencia a signos vitales (`SIG_VIT`).
- `analisis` — text. Interpretación clínica, evolución de los diagnósticos, respuesta al tratamiento.
- `plan` — text. Ajustes terapéuticos, nuevos estudios, indicaciones, próximo control.
- `diagnostico_cie10` — JSONB. Estructura: `[ { cie10: string, tipo: 'presuntivo'|'definitivo' } ]`. Diagnóstico actualizado para esta visita.
- `registrado_por` — uuid FK a `ece.personal_salud`, NOT NULL (metadato obligatorio Art. 55).
- `registrado_en` — timestamptz NOT NULL DEFAULT now() (metadato Art. 55, nivel segundo).
- `estado_registro` — VARCHAR(20), default `vigente`. Workflow gestionado por motor (`ece.documento_instancia.estado_actual_id`). Misma observación de drift que en `HIST_CLIN`.
- Firma electrónica simple — registrada en `ece.firma_electronica`, referenciada desde `documento_instancia_historial.firma_id` en la transición `firmar` (Art. 23 lit. a.4 NTEC). **Obligatoria por cada nota individual** (Art. 23 — una nota = una firma).

Campos de contingencia (F2-S15 Stream A — registro retroactivo en papel):
- `digitado_retroactivamente` (boolean, default false)
- `timestamp_real_papel` (timestamptz nullable) — marca temporal del registro original en papel
- `contingencia_evento_id` (uuid nullable) — FK al evento de contingencia que justifica la digitación retroactiva

## Estados (flujo_estado)
Sembrados por el bloque DO de `63_ece_08_seed.sql` para todo `tipo_documento` no inmutable:

- `borrador` (inicial) → `en_revision` → `firmado` → `validado` (final) → `anulado` (final alternativo)

Estado terminal por defecto: **`validado`** (es_final = true para EVOL_MED al no requerir certificación).

Notas:
- `inmutable=false` en seed pero la **bitácora `documento_instancia_historial` es siempre append-only** (trigger `trg_historial_inmutable`).
- Política de **addendum** (ya implementada en `/encounters/[id]/notes`): correcciones se modelan como notas independientes con `noteType=ADDENDUM` y referencia a la nota original; **la nota original firmada NO se muta** (lección del Sprint 4 Lima, comentario en `encounters/[id]/notes/page.tsx:1-17`).

## Transiciones (flujo_transicion)
Seed en `63_ece_08_seed.sql` líneas 237–239 + anulación universal:

| origen | destino | acción | rol que autoriza | requiere firma | condición funcional |
|---|---|---|---|---|---|
| borrador | en_revision | `enviar_revision` | MC | NO | SOAP con al menos `subjetivo` y `plan` capturados |
| en_revision | firmado | `firmar` | MC | **SI** | PIN/firma electrónica simple del autor validada (solo el autor puede firmar — política UX Lima) |
| firmado | validado | `validar` | MC | NO | Auto-validación del médico tratante (seed default); no requiere visto adicional en ambulatorio |
| borrador | anulado | `anular` | DIR | **SI** | Anulación con causa documentada (bloque 5b universal) |

Transiciones bloqueadas (no sembradas):
- `firmado → en_revision` (no rollback post-firma; usar addendum/rectificación)
- `validado → *` salvo anulado

Particularidad ambulatoria: la auto-validación post-firma por el mismo MC es práctica común en consulta externa. En hospitalización con jefe de servicio podría introducirse una transición `firmado → validado` con `rol_autoriza = ESP` (jefe de servicio) — fuera del alcance ambulatorio de este doc.

## Eventos de dominio
Convención: `ece.<codigo_documento>.<accion>`. Payload obligatorio incluye `organization_id`, `establishment_id`, `paciente_id`, `episodio_id`, `instancia_id`, `actor_id`, `timestamp`:

- `ece.evol_med.creado` — payload: `{ instancia_id, paciente_id, episodio_id, hist_clin_origen_id, autor_id, creado_en }`
- `ece.evol_med.enviado_revision` — payload: `{ instancia_id, autor_id, timestamp }`
- `ece.evol_med.firmado` — payload: `{ instancia_id, firma_id, hash_documento, firmante_id, firmado_en }` (Art. 23 + Art. 55 NTEC)
- `ece.evol_med.validado` — payload: `{ instancia_id, validador_id, timestamp }`
- `ece.evol_med.addendum_creado` — payload: `{ instancia_addendum_id, instancia_original_id, autor_id, motivo, timestamp }` (patrón ya implementado en `/encounters/[id]/notes`)
- `ece.evol_med.rectificado` — payload: `{ instancia_origen_id, instancia_nueva_id, version_nueva, motivo, autor_id, timestamp }` (Art. 42 NTEC)
- `ece.evol_med.anulado` — payload: `{ instancia_id, autorizado_por_dir_id, motivo, timestamp }`

PENDIENTE — validar con @AS si los eventos se emiten vía `audit.AuditLog` (hash-chain Art. 55) o vía outbox de notificaciones (`packages/database/sql/42_notifications_outbox.sql`). El módulo legacy `/encounters/[id]/notes` ya emite a `audit.AuditLog`; la consolidación debe preservar esa cadena.

## Drift conocido (audit) y riesgos
Hallazgos relevantes de `docs/audit/2026-05-19_audit_stream_b_clinico_activo.md` (Stream B, Módulo 1 — extrapolados a `evolucion_medica` por simetría de estructura con `historia_clinica`):

- **Heredado de HC-001 [P0]** — Ruta UI `/ece/evolucion` **SI existe** (a diferencia de HC). Implementada con timeline cronológico inverso, filtros por fecha/autor, badges Firmada/Validada (`apps/web/src/app/(clinical)/ece/evolucion/page.tsx`). Riesgo residual: validar que el router tRPC asociado use `withTenantContext` para no bypassear RLS (regla CLAUDE.md).
- **Heredado de HC-003 [P1]** — `estado_registro` es `text` sin CHECK constraint ni enum Postgres. Permite valores fuera de catálogo NTEC. Mismo hallazgo aplica a `ece.evolucion_medica`.
- **Heredado de HC-004 [P1]** — `diagnostico_cie10` JSONB sin validación de estructura CIE-10 en BD. Solo Zod del contrato valida.
- **Heredado de HC-005 [P2]** — Sin trigger de inmutabilidad físico en `ece.evolucion_medica` post-firma. El audit-hash-chain detecta el cambio pero no lo previene.

Drift adicional detectado al 2026-05-22:
- **Doble módulo de captura**: `/encounters/[id]/notes` (legacy SOAP-genérica) y `/ece/evolucion` (NTEC) capturan notas de evolución, potencialmente en tablas distintas. **Decisión pendiente** sobre consolidación: extender el legacy para escribir en `ece.evolucion_medica` cuando el episodio esté gobernado por ECE, o mantener el dual durante un período de transición con bridge. La regla CLAUDE.md de "adecuar, no duplicar" favorece la consolidación. PENDIENTE — validar con @AE.
- **Campos de contingencia retroactiva** (F2-S15) están presentes en la tabla pero no han sido auditados en este stream; revisar que UI exponga el flujo de digitación retroactiva con la justificación documentada.

## Descripción markdown rica (para BD `descripcion_markdown`)

> **Nota de Evolución (SOAP)** — Registro cronológico de seguimiento clínico de una consulta **subsecuente** ambulatoria. Captura la progresión del paciente desde la última consulta usando estructura **SOAP**:
>
> - **S — Subjetivo**: lo que refiere el paciente (síntomas, percepción, adherencia al tratamiento, eventos desde la última visita).
> - **O — Objetivo**: hallazgos del examen físico, signos vitales del control y resultados de estudios recientes.
> - **A — Análisis**: interpretación clínica, evolución de los diagnósticos, respuesta al tratamiento.
> - **P — Plan**: ajustes terapéuticos, nuevos estudios o interconsultas, próximo control.
>
> **Cuándo se usa:** segunda y subsecuentes consultas ambulatorias del mismo episodio/motivo, una vez que existe Historia Clínica (`HIST_CLIN`) firmada. Cada consulta subsecuente = una nota nueva firmada (Art. 19 cronológico ascendente, Art. 23 una firma por nota).
>
> **Qué NO es:** no es Historia Clínica (eso es `HIST_CLIN`, primera vez); no es nota de emergencia (`ATN_EMERG`); no es epicrisis (`EPICRISIS`); no es nota de enfermería (`REG_ENF`). Tampoco es un "resumen" de varias visitas — cada visita = una nota.
>
> **Ejemplos típicos:** control mensual de paciente diabético con ajuste de hipoglucemiantes; segunda consulta de un cuadro respiratorio con respuesta a antibiótico; control prenatal subsecuente de gestación normal; nota de retorno de interconsulta especializada (módulo RRI).
>
> **Errores comunes:**
> - Modificar la nota firmada en lugar de emitir un **addendum** o una **rectificación** trazable (Art. 42).
> - Crear Historia Clínica nueva cuando corresponde Nota de Evolución (mismo motivo, mismo episodio).
> - Firmar la nota sin actualizar el diagnóstico CIE-10 cuando cambió la impresión diagnóstica.
> - Omitir la sección Subjetivo cuando el paciente no aporta información nueva — registrar explícitamente "Paciente refiere mejoría clínica" o equivalente; **no dejar la sección vacía** (compromete la firma médica).
> - Capturar la evolución en `/encounters/[id]/notes` cuando el episodio ya está bajo gobierno ECE — debe emitirse en `ece.evolucion_medica` para cumplir trazabilidad NTEC.
