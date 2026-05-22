# HC_AMB — Historia Clínica (modalidad ambulatoria)

## Metadata
- **codigo**: `HIST_CLIN` (codigo siembra `ece.tipo_documento`; este archivo documenta su uso en modalidad **ambulatoria** específicamente)
- **nombre**: Historia Clínica
- **modalidad**: AMBULATORIO (tipo_documento.modalidad sembrado como `ambos` — este doc describe la rama ambulatoria; la rama hospitalaria se cubre en `HC_HOSP.md` cuando se redacte)
- **NTEC artículo**: Arts. 15 (raíz de identificación), 19 (ordenamiento cronológico ascendente), 23 lit. a.4 (firma electrónica simple obligatoria), 42 (rectificación trazable), 55–56 (metadatos obligatorios y bitácora) — Acuerdo n.° 1616 MINSAL (30/05/2024, D.O. T.444 N°158). El TDR referencia "Art. 28" para este doc — PENDIENTE — validar con @AE/@PO el artículo exacto del Acuerdo 1616 (la versión consultada del análisis no expone un Art. 28 específico para Historia Clínica ambulatoria).
- **modulo_his_target**: `/outpatient` (legacy — agenda y consulta externa, TDR §10) extendido con el formulario HC NTEC. Se documenta también el bridge a `apps/web/src/app/(clinical)/encounters/[id]/notes` cuando la HC primera vez se capture como nota inicial del encuentro. **NO** crear ruta paralela `/ece/historia-clinica` salvo que la auditoría confirme que extender el legacy es inviable (ver hallazgo HC-001 en `docs/audit/2026-05-19_audit_stream_b_clinico_activo.md`).
- **tabla_datos**: `ece.historia_clinica` (Prisma `EceHistoriaClinica` — `packages/database/prisma/schema.prisma:4897`)
- **inmutable**: false — admite edición controlada hasta el estado `firmado`; tras `firmado` solo se acepta rectificación trazable (nueva instancia con `version+1`, Art. 42 NTEC). Aun siendo `tipo_registro=transaccional`, la columna `estado_registro` y la bitácora `documento_instancia_historial` garantizan inmutabilidad efectiva post-firma.
- **tipo_registro**: OBLIGATORIO para toda primera vez ambulatoria con apertura/uso de expediente; CONDICIONAL en subsecuentes (se sustituye por Nota de Evolución `NEV` cuando el expediente ya tiene HC vigente para el episodio activo, salvo cambio de modalidad o motivo).

## Propósito normativo
La Historia Clínica es el documento base de la atención clínica ambulatoria y constituye respaldo legal y fuente primaria de vigilancia epidemiológica, investigación y docencia (Art. 4.14 NTEC). Captura anamnesis, examen físico, diagnóstico CIE-10 y plan terapéutico en la **primera consulta** de un paciente para un motivo de consulta determinado; en consultas subsecuentes ambulatorias se sustituye por la Nota de Evolución (`NEV`).

Cumple el conjunto mínimo de variables del expediente y la firma electrónica simple del médico (Art. 23 lit. a.4 NTEC), cubre el riesgo médico-legal de la atención no programada o programada en consulta externa, y habilita la continuidad asistencial entre niveles del SNIS (módulo RRI) y la facturación/derechohabiencia ISSS cuando aplique. La modificación post-firma solo procede por rectificación trazable conservando la versión previa (Art. 42 NTEC).

## Dependencias (depende_de)
Documentos que DEBEN existir y estar firmados antes de crear este:
- `FICHA_ID` (Ficha de Identificación) — raíz del expediente (Art. 15 NTEC). Sin Ficha no hay expediente sobre el cual abrir Historia Clínica. Sembrado como única dependencia en `ece.tipo_documento.depende_de` para `HIST_CLIN`.

Recomendados (no bloqueantes en el seed actual, pero esperados en flujo ambulatorio):
- `SIG_VIT` (Hoja de Signos Vitales) — recomendado pero **no bloqueante**; en consulta externa preconsulta los signos vitales se toman antes de la HC, pero el motor permite HC sin SIG_VIT previo si el flujo institucional así lo dispone.

## Obligatoriedad por modalidad / contexto
- AMBULATORIO primera vez: **SI** (obligatorio; sustento de la atención y de cualquier orden/receta).
- AMBULATORIO subsecuente: **CONDICIONAL** — se usa Nota de Evolución (`NEV`) salvo que: (a) cambie el motivo de consulta principal de forma sustantiva, (b) se abra un nuevo episodio ambulatorio (paciente pasivo reactivado tras > 5 años — Art. 4 expediente activo/pasivo), o (c) sea primera consulta con una especialidad distinta.
- Por especialidad: la HC NTEC es genérica; especialidades (gineco-obstetricia, pediatría, salud mental) extienden secciones específicas en `examenFisico` y `antecedentes` (JSONB) sin crear documento nuevo. PENDIENTE — validar con @AE/@PO si Salud Mental requiere documento independiente con régimen de confidencialidad reforzado.

## Roles firmantes / actores
| Rol | Acción | Momento |
|---|---|---|
| MC (Médico de Cabecera / tratante) | LLENA, RESPONSABLE, FIRMA, AUTORIZA validación | Durante y al cierre de la consulta |
| MT (Médico de Turno) | LLENA (obligatorio=false — alternativo) | Cuando MC no está disponible (consulta externa por turno, emergencia ambulatoria) |
| ENF (Enfermería) | Toma signos vitales (en `SIG_VIT`); referenciado vía `examenFisico.signos_vitales_ref` | Preconsulta |

Fuente: `ece.documento_rol` seed en `packages/database/sql/63_ece_08_seed.sql` líneas 332–337.

## Campos obligatorios mínimos NTEC
Mapeados a columnas de `ece.historia_clinica` (Prisma `EceHistoriaClinica`):

- `episodio_id` — FK obligatorio a `ece.episodio_atencion` (uuid, NOT NULL). Fuente: Art. 15 NTEC (identificación + episodio).
- `tipo_consulta` — texto VARCHAR(20), NOT NULL. Valores esperados: `primera_vez`, `subsecuente`. PENDIENTE — validar con @AE/@PO si debe convertirse en CHECK constraint o enum (auditoría HC-003).
- `motivo_consulta` — text, recomendado (campo NTEC §3.2). Actualmente nullable en BD; debe forzarse a NOT NULL en capa de validación Zod del contrato.
- `enfermedad_actual` — text, recomendado (campo NTEC §3.2).
- `antecedentes` — JSONB. Estructura sugerida (analisis_workflows_ece.md §3.2): `{ personales_patologicos, familiares, gineco_obstetricos, alergias[], habitos }`.
- `examen_fisico` — JSONB. Estructura sugerida: `{ signos_vitales_ref: <FK>, hallazgos_por_sistema }`.
- `diagnosticos` — JSONB. Estructura: `[ { cie10: string, tipo: 'presuntivo'|'definitivo' } ]`. Validación CIE-10 sólo en capa Zod (auditoría HC-004 P1 — falta CHECK constraint en BD).
- `plan_manejo` — text, recomendado (campo NTEC §3.2 plan terapéutico).
- `disposicion` — VARCHAR(30). Valores esperados: `alta_ambulatoria`, `referencia`, `observacion`, `orden_ingreso` (analisis_workflows_ece.md §3.2). PENDIENTE — validar enum/CHECK.
- `registrado_por` — uuid FK a `ece.personal_salud`, NOT NULL (metadato obligatorio Art. 55).
- `registrado_en` — timestamptz NOT NULL DEFAULT now() (metadato obligatorio Art. 55, nivel segundo).
- `estado_registro` — VARCHAR(20), default `vigente`. Workflow gestionado por motor (`ece.documento_instancia.estado_actual_id`); este campo es legacy del modelo de tabla y duplica información. PENDIENTE — consolidar con motor para evitar drift.
- Firma electrónica simple — registrada en `ece.firma_electronica` y referenciada desde `documento_instancia_historial.firma_id` en la transición `firmar` (Art. 23 lit. a.4 NTEC).

## Estados (flujo_estado)
Sembrados por el bloque DO de `63_ece_08_seed.sql` para todo `tipo_documento` no inmutable:

- `borrador` (inicial) → `en_revision` → `firmado` → `validado` (final) → `anulado` (final alternativo)

Estado terminal por defecto: **`validado`** (es_final = true para HIST_CLIN al no requerir certificación).

Notas:
- `inmutable=false` en seed, pero la **bitácora `documento_instancia_historial` es siempre append-only** (trigger `trg_historial_inmutable`). Las modificaciones a la fila `historia_clinica` post-firma se deben canalizar como rectificación (nueva instancia, `version+1`).
- La auditoría HC-005 señala ausencia de trigger de inmutabilidad físico en `ece.historia_clinica` post-firma — riesgo P2 documentado.

## Transiciones (flujo_transicion)
Seed en `63_ece_08_seed.sql` líneas 207–209 + anulación universal:

| origen | destino | acción | rol que autoriza | requiere firma | condición funcional |
|---|---|---|---|---|---|
| borrador | en_revision | `enviar_revision` | MC | NO | Captura mínima completa: `episodio_id`, `tipo_consulta`, al menos un diagnóstico |
| en_revision | firmado | `firmar` | MC | **SI** | PIN/firma electrónica simple validada; `diagnosticos[]` codificado CIE-10 |
| firmado | validado | `validar` | MC | NO | Auto-validación del médico tratante (default seed); el TDR §10.3 menciona firma del médico como aprobación única |
| borrador | anulado | `anular` | DIR | **SI** | Anulación con causa documentada (transición universal sembrada en bloque 5b) |

Transiciones bloqueadas (no sembradas — no se permiten):
- `firmado → en_revision` (rollback post-firma prohibido; usar rectificación)
- `validado → cualquier estado distinto de anulado` (estado terminal)

## Eventos de dominio
Convención: `ece.<codigo_documento>.<accion>`. Payload obligatorio incluye `organization_id`, `establishment_id`, `paciente_id`, `episodio_id`, `instancia_id`, `actor_id`, `timestamp`:

- `ece.hist_clin.creado` — payload: `{ instancia_id, paciente_id, episodio_id, tipo_consulta, autor_id, creado_en }`
- `ece.hist_clin.enviado_revision` — payload: `{ instancia_id, autor_id, timestamp }`
- `ece.hist_clin.firmado` — payload: `{ instancia_id, firma_id, hash_documento, firmante_id, firmado_en }` (Art. 23 + Art. 55 NTEC)
- `ece.hist_clin.validado` — payload: `{ instancia_id, validador_id, timestamp }`
- `ece.hist_clin.rectificado` — payload: `{ instancia_origen_id, instancia_nueva_id, version_nueva, motivo, autor_id, timestamp }` (Art. 42 NTEC)
- `ece.hist_clin.anulado` — payload: `{ instancia_id, autorizado_por_dir_id, motivo, timestamp }`

PENDIENTE — validar con @AS si los eventos se emiten vía `audit.AuditLog` (hash-chain Art. 55) o vía outbox de notificaciones (`packages/database/sql/42_notifications_outbox.sql`).

## Drift conocido (audit) y riesgos
Hallazgos de `docs/audit/2026-05-19_audit_stream_b_clinico_activo.md` (Stream B, Módulo 1):

- **HC-001 [P0 — BLOQUEANTE Go-Live]** Ruta UI `/ece/historia-clinica` no existe. La carpeta `apps/web/src/app/(clinical)/ece/` no contiene `historia-clinica/`. Decisión arquitectónica pendiente: extender `/outpatient` legacy con formulario HC NTEC vs. crear ruta nueva. La regla del CLAUDE.md privilegia extender legacy.
- **HC-002 [P0 — BLOQUEANTE Go-Live]** Sin router tRPC. `packages/trpc/src/routers/ece/` solo contiene `comite-ece.router.ts`, `epicrisis.router.ts`, `icd10.router.ts`. Riesgo de bypass RLS si se escribe directo a Supabase sin `withTenantContext`.
- **HC-003 [P1 — ALTO]** `estado_registro` es `text` sin CHECK constraint ni enum Postgres. Permite valores fuera de catálogo NTEC.
- **HC-004 [P1 — ALTO]** `diagnosticos` JSONB sin validación de estructura CIE-10 en BD. Solo Zod del contrato impone el formato. Insert directo puede omitir el código.
- **HC-005 [P2 — MEDIO]** Sin trigger de inmutabilidad en `ece.historia_clinica` post-firma. Aud-hash-chain detecta el cambio pero no lo previene.

Drift adicional detectado al 2026-05-22:
- La modalidad sembrada es `ambos` para `HIST_CLIN`. Si se requiere separar workflows ambulatorio vs. hospitalario (rol firmante, transiciones, plazos), abrir issue para crear `HIST_CLIN_AMB` / `HIST_CLIN_HOSP` como tipos de documento distintos. PENDIENTE — validar con @AE/@PO.
- Campo `disposicion` con valor `orden_ingreso` cruza al flujo hospitalario (genera `ORD_ING` como dependencia de salida). El motor actual no enforza esa cadena de creación — es responsabilidad de la capa tRPC.

## Descripción markdown rica (para BD `descripcion_markdown`)

> **Historia Clínica ambulatoria** — Documento base de la atención clínica del paciente en consulta externa o emergencia sin ingreso. Captura el primer contacto con el motivo de consulta vigente: **anamnesis** completa, **examen físico** por sistemas, **diagnósticos CIE-10** (presuntivos y definitivos) y **plan terapéutico** (manejo clínico, órdenes de estudios, prescripciones e indicaciones higiénico-dietéticas).
>
> **Cuándo se usa:** primera consulta ambulatoria con un motivo determinado; reactivación de paciente pasivo (>5 años sin registro); primera consulta con una especialidad distinta dentro del mismo episodio. En consultas subsecuentes con el mismo motivo se usa la **Nota de Evolución** (`NEV`), no se duplica la HC.
>
> **Qué NO es:** no es nota de evolución (eso es `NEV`), ni nota de emergencia (eso es `ATN_EMERG` cuando hubo triaje), ni epicrisis (eso es `EPICRISIS` al egreso hospitalario). No reemplaza el consentimiento informado para procedimientos.
>
> **Ejemplos típicos:** primera consulta de control de hipertensión en consulta externa de medicina general; primera valoración pediátrica de un niño con cuadro respiratorio en emergencia ambulatoria; primera evaluación gineco-obstétrica con anamnesis ginecológica completa.
>
> **Errores comunes:**
> - Olvidar codificar diagnóstico CIE-10 al menos al cierre del cuadro clínico (Art. 16–17 NTEC).
> - Crear HC nueva cuando corresponde Nota de Evolución (subsecuente con mismo motivo).
> - Modificar la HC firmada en lugar de emitir rectificación trazable (Art. 42).
> - Firmar sin que el examen físico haga referencia a los signos vitales tomados por enfermería en preconsulta.
> - Cerrar con disposición `orden_ingreso` sin emitir la `Orden de Ingreso` (`ORD_ING`) requerida para abrir el episodio hospitalario.
