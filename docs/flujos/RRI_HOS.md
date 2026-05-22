# RRI_HOS — Resumen, Referencia e Interconsulta (Hospitalización)

## Metadata

- **codigo**: RRI_HOS
- **nombre**: Hoja de Referencia, Retorno e Interconsulta (Resumen Clínico de Traslado)
- **modalidad**: HOSPITALIZACION (principal — referencias inter-establecimiento desde sala) + EMERGENCIA (referencias urgentes desde ATN_EMERG) + AMBULATORIO (referencias programadas a especialista)
- **NTEC artículo**: Art. 38 (continuidad asistencial y resumen del paciente referido) · §3.10 NTEC Acuerdo n.° 1616 MINSAL 2024 (campos clave) · Art. 40 NTEC (teleinterconsulta — registro en ambos expedientes)
- **modulo_his_target**: `/ece/rri` (registro NTEC — único módulo activo, no hay legacy `/referrals` separado en este worktree) — UI rutas: `/ece/rri`, `/ece/rri/nueva`, `/ece/rri/[id]`, `/ece/rri/[id]/responder`
- **tabla_datos**: `ece.rri` (registro NTEC, schema raw — NO está expuesta vía Prisma model `EceReferenciaRri` con caveat de schema drift, ver §Drift) + `ece.documento_instancia` (motor workflow) + `ece.documento_instancia_historial` (auditoría)
- **inmutable**: true post-firma (estado `firmado` y `validado`) — la corrección post-firma exige anulación (rol DIR) + nueva instancia (Art. 42 NTEC: rectificación trazable, no DELETE)
- **tipo_registro**: TRANSACCIONAL (catálogo `tipo_registro='transaccional'` en `ece.tipo_documento` seed `63_ece_08_seed.sql:63`) — OBLIGATORIO en: transferencia inter-establecimiento (referencia/retorno), solicitud de interconsulta intra-hospitalaria a especialidad distinta, egreso por traslado a otro hospital, teleinterconsulta (Art. 40 NTEC con registro en ambos expedientes)

## Propósito normativo

La **Hoja de Referencia, Retorno e Interconsulta (RRI)** es el documento médico-legal que formaliza la **continuidad asistencial** del paciente entre niveles de atención, entre establecimientos del SNIS o entre servicios/especialidades dentro de un mismo hospital. Es parte del **módulo RRI del SIS-MINSAL** y constituye uno de los soportes documentales mencionados por el Art. 38 NTEC: garantizar que la información clínica relevante viaje con el paciente cuando este es transferido, evaluado por un especialista externo, o regresa a su centro de origen tras una atención de mayor complejidad.

Cubre cuatro escenarios tipados en la columna `tipo` de `ece.rri` (constraint `CHECK (tipo IN ('referencia','retorno','interconsulta','teleinterconsulta'))`, archivo `61_ece_06_documentos.sql:380-383`):

- **referencia** — traslado del paciente a otro establecimiento o nivel de mayor complejidad para atención que excede la capacidad resolutiva del actual.
- **retorno** — contrarreferencia del centro receptor al centro origen tras estabilizar/resolver al paciente; incluye recomendaciones de seguimiento.
- **interconsulta** — solicitud intra-hospitalaria a especialidad distinta dentro del mismo establecimiento (ej. medicina interna solicita evaluación a cardiología); el paciente NO se traslada físicamente al otro establecimiento.
- **teleinterconsulta** — variante de interconsulta realizada por medios telemáticos (Art. 40 NTEC); el registro debe existir tanto en el expediente del centro solicitante como en el del centro consultor.

En modalidad hospitalaria es típicamente firmado por el médico tratante (MC) tras la decisión clínica de transferir o solicitar evaluación especializada, y respondido por el médico interconsultante (IC) o el médico receptor en el centro de destino. El documento sustenta médico-legalmente:

1. La **responsabilidad del médico referente** sobre la decisión y el estado del paciente al momento del traslado.
2. La **transferencia formal de responsabilidad asistencial** al centro/médico receptor (cuando aplica `referencia` con paciente en tránsito).
3. La **trazabilidad regulatoria SNIS** (Ley SNIS Arts. 24-26: expediente médico único por usuario) — el RRI cierra el ciclo de continuidad en la red de prestadores.
4. La **base reportable al MINSAL** para indicadores de derivación, contrarreferencia efectiva y uso de la red.

## Dependencias (depende_de)

Sembrado en `ece.tipo_documento.depende_de = ARRAY['HIST_CLIN']` (`63_ece_08_seed.sql:63-64`).

- **HIST_CLIN** — Historia Clínica firmada del episodio (NTEC §3.3). Sin diagnóstico documentado el motivo de la referencia/interconsulta carece de sustento clínico.
- **EPISODIO_ATENCION** — toda RRI se vincula a un episodio activo (`episodio_id` FK NOT NULL en el INSERT del router, aunque la columna BD permite NULL — el router lo enforce). En hospitalización el episodio típicamente es `HOJA_ING` (apertura de episodio hospitalario, NTEC §3.12).
- **FICHA_ID** — dependencia transitiva vía HIST_CLIN: identificación del paciente verificada (Art. 15 NTEC).

Dependencias contextuales (no en `depende_de` formal del catálogo pero exigidas operativamente):

- Cuando `tipo='referencia'` desde emergencia: requiere **ATN_EMERG** (Hoja de Atención de Emergencia firmada) con diagnóstico y decisión de disposición = `referencia` (§3.9 análisis_workflows_ece).
- Cuando `tipo='retorno'`: requiere referencia previa (`referencia` ya validada en el centro receptor) — idealmente vinculada por `establecimiento_origen_id` / `establecimiento_destino_id` invertidos.

## Obligatoriedad por modalidad / contexto

| Modalidad / contexto | Obligatoriedad | Justificación |
|---|---|---|
| Referencia inter-establecimiento desde hospitalización | **SI** | Continuidad asistencial obligatoria SNIS (Ley SNIS Art. 24); soporte médico-legal del traslado. |
| Referencia inter-establecimiento desde emergencia | **SI** | Acta de transferencia de responsabilidad cuando el establecimiento no resuelve. |
| Interconsulta intra-hospitalaria (otra especialidad) | **SI** cuando el plan terapéutico exige evaluación especializada | Documenta solicitud + respuesta del IC; queda en el expediente como parte del manejo (FASE 2 §2.2 análisis_workflows_ece). |
| Teleinterconsulta (Art. 40 NTEC) | **SI** con registro en ambos expedientes | Soporte legal del acto telemático; ambos firmantes registran. |
| Egreso por traslado a otro hospital | **SI** | Tipo de egreso `referido_otro_hospital` en `EPICRISIS` exige RRI vinculada (Art. 41 lit. c NTEC). |
| Contrarreferencia (retorno) | **SI** cuando el centro receptor cierra ciclo y devuelve al paciente al centro de origen | Cierra el ciclo de la red; reporta resolución al centro origen. |
| Solicitud informal de opinión (no formal) | NO | Conversación clínica no documentada formalmente — NO sustituye RRI. |

## Roles firmantes / actores

Sembrados en `ece.documento_rol` (`63_ece_08_seed.sql:385-389`):

| Rol | Acción ECE | Obligatorio | Momento |
|---|---|---|---|
| **MC** (Médico de Cabecera / Tratante) | LLENA + RESPONSABLE + FIRMA | true | Llena la solicitud (motivo, resumen clínico, especialidad/establecimiento destino) y firma con PIN al cierre del acto antes de transmitir/transferir. |
| **MT** (Médico de Turno) | LLENA | false (`obligatorio=false`) | Alternativo en ausencia de MC, especialmente en turno noche o emergencia hospitalizada. |
| **IC** (Interconsultante / Médico Receptor) | AUTORIZA (firma la respuesta) | true | Recibe la RRI firmada, evalúa al paciente (presencial o tele), redacta respuesta y firma con PIN. Cierra el circuito. |
| **ESP** (Especialista) | habilitado vía `requireRole(["MC","ESP","IC"])` | — | Puede actuar como MC (solicitante) o IC (consultor) según contexto. |
| **DIR** (Dirección) | ANULA (transición universal) | true cuando aplica | Único rol autorizado para anular una RRI errónea o cancelada (Art. 21 NTEC). |
| **ENF / ARCH** | LECTURA | — | Acceso de solo lectura para verificación operativa (`readerProc = requireRole(["MC","ESP","IC","ENF","DIR","ARCH"])`). |

Notas operativas (extraídas del router `packages/trpc/src/routers/ece/rri.router.ts`):

- La firma electrónica simple del MC y del IC se verifica con **PIN argon2id** contra `ece.firma_electronica.pin_hash` (Art. 23 lit. a.4 NTEC).
- **Lockout automático**: 5 intentos fallidos consecutivos bloquean la firma (`LOCKOUT_MAX = 5`, líneas 219-280 router) — coherente con seguridad de credenciales.
- El campo `respondido_por` se llena con `ece.personal_salud.id` del IC al ejecutar `responder()`.

## Campos obligatorios mínimos NTEC

Mapeo basado en la tabla real `ece.rri` (`61_ece_06_documentos.sql:374-395`) y validaciones Zod en `packages/trpc/src/routers/ece/rri.schemas.ts`:

### Columnas en BD (`ece.rri`)

- `id` — UUID PK DEFAULT `gen_random_uuid()`.
- `instancia_id` — UUID NOT NULL FK → `ece.documento_instancia(id)` (vínculo al motor workflow).
- `paciente_id` — UUID NOT NULL FK → `ece.paciente(id)` (derivado del episodio, NO se acepta en el payload de creación).
- `episodio_id` — UUID FK → `ece.episodio_atencion(id)` (en la práctica obligatorio, validado por el router).
- `tipo` — TEXT NOT NULL, CHECK `IN ('referencia','retorno','interconsulta','teleinterconsulta')`.
- `establecimiento_origen_id` — UUID FK → `ece.establecimiento(id)` (campo BD no mapeado en el router actual; debe derivarse del `ctx.tenant.establishmentId`).
- `establecimiento_destino_id` — UUID FK → `ece.establecimiento(id)` (obligatorio cuando `tipo IN ('referencia','retorno')`; puede usarse para teleinterconsulta apuntando al centro consultor).
- `especialidad_solicitada` — TEXT NULL (recomendado para interconsulta y referencia a especialista).
- `motivo` — TEXT NULL en DDL pero **obligatorio normativamente** (validado en Zod: `min(1).max(2000)`).
- `resumen_clinico` — TEXT NULL en DDL pero **obligatorio normativamente** (validado en Zod: `min(1).max(4000)`). Concentra anamnesis, examen físico relevante, diagnósticos, plan actual y, por decisión HD-25, también la **urgencia** y datos clínicos extendidos hasta que se cree columna separada.
- `respuesta_interconsultante` — TEXT NULL hasta que el IC responda; al responder se llena con texto libre (Zod: `min(1).max(4000)`).
- `solicitado_por` — UUID NOT NULL FK → `ece.personal_salud(id)` (MC firmante; resuelto desde `his_user_id` por `findPersonal()`).
- `respondido_por` — UUID NULL FK → `ece.personal_salud(id)` (IC; llenado al ejecutar `responder()`).
- `registrado_en` — TIMESTAMPTZ NOT NULL DEFAULT `now()` (precisión segundo, Art. 55 NTEC).
- `estado_registro` — TEXT NOT NULL DEFAULT `'vigente'`, CHECK `IN ('vigente','rectificado')` (NO confundir con estado de workflow — éste es estado de **datos** para rectificación trazable).

### Campos NTEC §3.10 listados en TDR (mapeo)

| Campo NTEC TDR §3.10 | Columna BD `ece.rri` | Estado |
|---|---|---|
| `expediente_id` | `paciente_id` (vía episodio) | OK derivado |
| `tipo:[referencia, retorno, interconsulta, teleinterconsulta]` | `tipo` | OK |
| `establecimiento_origen` | `establecimiento_origen_id` | **NO mapeado en router actual** (drift) |
| `establecimiento_destino` | `establecimiento_destino_id` | OK |
| `especialidad_solicitada` | `especialidad_solicitada` | OK columna; **NO mapeado en payload create** del Zod |
| `resumen_clinico` | `resumen_clinico` | OK |
| `motivo` | `motivo` | OK |
| `respuesta_interconsultante` | `respuesta_interconsultante` | OK |
| firma del solicitante | `solicitado_por` + `documento_instancia_historial.firma_id` | OK |
| firma del interconsultante | `respondido_por` + `documento_instancia_historial.firma_id` | OK |
| metadatos (usuario, timestamp, etc.) | `documento_instancia` + `audit.audit_log` (Art. 55-56) | OK |

### Campos NO mapeados en BD (gap normativo P2)

Campos sugeridos por el template del usuario que **no existen como columna independiente** y deben serializarse dentro de `resumen_clinico` o `motivo` (decisión HD-25):

- `urgencia (ELECTIVA|URGENTE|EMERGENCIA)` — columna eliminada del router (`urgencia` no existe en BD). Pendiente Issue @AE para columna `urgencia` ENUM o JSONB.
- `transporte (AMBULANCIA_BASICA|MEDICALIZADA|HELICOPTERO)` — no existe en BD; capturable en texto libre.
- `estado_paciente_al_traslado` — no existe; capturable en `resumen_clinico` (responsabilidad médico-legal).
- `examenes_relevantes` (link a RES_EST) — no existe FK; referenciar UUIDs dentro de `resumen_clinico` como texto.
- `medicacion_actual` — no existe columna; redundante con prescripción activa del episodio (consultar `Prescription` legacy).
- `diagnostico_ic` / `plan_ic` (diagnóstico y plan del interconsultante) — eliminados del schema HD-25; capturar en `respuesta_interconsultante`.

## Estados (flujo_estado)

Sembrados genéricamente para todos los tipos no inmutables en `63_ece_08_seed.sql:135-177` y aplicados a RRI:

| codigo | nombre | es_inicial | es_final | orden |
|---|---|---|---|---|
| `borrador` | Borrador | true | false | 1 |
| `en_revision` | En revisión | false | false | 2 |
| `firmado` | Firmado | false | false | 3 |
| `validado` | Validado | false | true | 4 |
| `anulado` | Anulado | false | true | 9 |

Mapping conceptual al template del usuario:

- BORRADOR (template) → `borrador` (ECE)
- EN_FIRMA (template) → `en_revision` (ECE)
- FIRMADO (template) → `firmado` (ECE) — equivale a "RRI emitida, paciente puede partir"
- EN_TRANSITO (template) → en este modelo, `firmado` permanece hasta que el IC responde; **NO existe estado dedicado `en_transito`** (gap menor — el tránsito físico se gestiona fuera del sistema documental, vía evento `ece.rri.firmada` consumido por el módulo de transporte / cama / referencia operativa)
- RECIBIDO (template, referencia) → modelado como llegada de respuesta del centro receptor; transición `responder` lo marca como `validado`
- RESPONDIDA (template, interconsulta) → `validado` (estado terminal; `es_final=true`)

## Transiciones (flujo_transicion)

Sembradas específicamente para RRI en `63_ece_08_seed.sql:246-249` + transición universal `anular`:

| origen | destino | acción | rol_autoriza | requiere_firma | condición |
|---|---|---|---|---|---|
| `borrador` | `en_revision` | `enviar_revision` | MC | false | Solicitud completa con motivo + resumen + destino (cuando aplica). |
| `en_revision` | `firmado` | `firmar` | MC | **true** (PIN argon2id) | Firma electrónica simple del médico solicitante (Art. 23 lit. a.4 NTEC). El router permite firmar también desde `borrador` (`['borrador','en_revision']`, línea 571 router) — pragmático para flujos hospitalarios rápidos. |
| `firmado` | `validado` | `validar` (alias `responder` en router) | IC | **true** (PIN argon2id) | El interconsultante / médico receptor responde y firma con PIN. Persiste `respuesta_interconsultante` y `respondido_por` antes de avanzar estado. |
| `*` (excepto `validado`/`anulado`) | `anulado` | `anular` | DIR | true | Universal: solo Dirección puede anular (Art. 21 NTEC). El router rechaza anular desde `validado` o `anulado`. |

Notas operativas (router):

- La transición `firmar` se ejecuta con `rolEjecutor = ctx.tenant.roleCodes.includes("MC") ? "MC" : "ESP"` — un ESP también puede firmar como solicitante.
- La transición `responder` se ejecuta con `rolEjecutor = ctx.tenant.roleCodes.includes("IC") ? "IC" : "ESP"` — un ESP también responde como IC.
- **No hay 4-eyes**: el mismo MC que firma puede ser, en teoría, el mismo IC que responde (si tiene ambos roles activos). En la práctica el seed asigna roles distintos a sets de personal distintos; el control es organizacional.

## Eventos de dominio

Emitidos vía `emitDomainEvent()` dentro del callback `withWorkflowContext` (router líneas 585-599, 643-655):

- **`ece.rri.firmada`** — emitido al ejecutar `firmar()` exitosamente.
  - `payload`: `{ instanceId, tipo ('referencia'|'retorno'|'interconsulta'|'teleinterconsulta'), establecimientoDestinoId, solicitadoPor, payloadHash (SHA-256 del payload canónico), firmaId }`.
  - **Consumidores**:
    - Módulo de transporte/referencia operativa: dispara orden de ambulancia / coordinación con centro destino.
    - Módulo de notificaciones: alerta al centro receptor (`establecimiento_destino_id`) sobre paciente en tránsito.
    - Bitácora ECE: registro inmutable en `audit.audit_log` (hash chain Art. 55-56).
- **`ece.rri.respondida`** — emitido al ejecutar `responder()` exitosamente. Cierra el circuito.
  - `payload`: `{ instanceId, tipo, respondidoPor, firmaId }`.
  - **Consumidores**:
    - Notificación al MC solicitante de que la respuesta está disponible.
    - Cuando `tipo='referencia'` y la respuesta implica retorno, dispara workflow de creación de RRI tipo `retorno` (no automático en el código actual, pendiente).
    - Bitácora ECE.
- **`ece.rri.anulada`** — implícita por `avanzarEstado('anular')`; NO emite `emitDomainEvent` específico en el código actual (gap menor de observabilidad — los consumidores deben suscribirse al log de `documento_instancia_historial`).

**Payload hash canónico** (`computeRriHash()`, líneas 354-365 router):

```ts
SHA-256(JSON.stringify({
  id, tipo, motivo, resumen_clinico,
  establecimiento_destino_id, solicitado_por, registrado_en
}))
```

Este hash entra en el evento de outbox y permite verificación de integridad downstream.

## Drift conocido (audit) y riesgos

Auditoría **Stream D — Hospitalización** (`docs/audit/2026-05-19_audit_stream_d_hospitalizacion.md`, Módulo 8), consolidación top P0/P1 (`docs/audit/2026-05-19_consolidacion_top15_p0_p1.md` entrada #11):

### HD-25 [P0-BLOQUEANTE] — Schema drift masivo en `ece.rri` (corregido en branch S1)

El router original asumía 6 columnas con nombres incorrectos o inexistentes:

| Router (incorrecto) | BD real | Estado tras fix S1 |
|---|---|---|
| `destino_servicio_id` | `establecimiento_destino_id` | Renombrado en router |
| `urgencia` | (no existe) | **Eliminado del schema Zod** — se serializa en texto libre |
| `datos_clinicos_relevantes` | `resumen_clinico` | Renombrado |
| `diagnostico_ic` | (no existe) | **Eliminado** — se serializa en `respuesta_interconsultante` |
| `plan_ic` | (no existe) | **Eliminado** — se serializa en `respuesta_interconsultante` |
| `respuesta` | `respuesta_interconsultante` | Renombrado |
| `fecha_solicitud` | `registrado_en` (DB DEFAULT now()) | Eliminado del payload — gestionado por BD |

**Estado actual**: corregido en `packages/trpc/src/routers/ece/rri.schemas.ts` y `rri.router.ts` (HD-25 (S1) marker en header). **El INSERT y UPDATE ya alinean con BD**. Deuda residual: la columna `establecimiento_origen_id` existe en BD pero no se llena desde el router — debe derivarse del `ctx.tenant.establishmentId` activo (issue pendiente).

### HD-26 [P1-ALTO] — UI RRI acepta `episodioId` como texto libre sin validación UUID client-side

`apps/web/src/app/(clinical)/ece/rri/nueva/page.tsx:112-121` usa `<Input type="text">` para episodio. Sin selector visual, el médico puede escribir un episodio inválido y el error solo aparece tras submit con `ZodError` server-side.

**Remediación pendiente**: reemplazar por selector de episodios activos del paciente (llamada `eceEpisodioHospitalario.listActivos`) o, mínimo, validación UUID client-side.

### HD-27 [P2-MEDIO] — RRI no captura diagnóstico CIE-10 estructurado

NTEC §3.10 implícitamente requiere diagnóstico del motivo de referencia (el centro receptor lo necesita para priorizar). El `eceRriCreateSchema` actual no incluye `diagnosticoCIE10`. Se sugiere agregar `diagnosticosCIE10: z.array(icd10CodeSchema).min(1)` al schema de creación.

### Otros riesgos residuales

- **Gap del campo `establecimiento_origen_id`**: la columna existe en BD pero el router no la llena. Debe inferirse de `ctx.tenant.establishmentId` o ser explícito en el payload — necesario para reporte SNIS y trazabilidad de la red.
- **No hay vínculo bidireccional `referencia ↔ retorno`**: el modelo permite RRI tipo `retorno` pero no hay FK que lo enlace explícitamente a la `referencia` original (ambos son filas independientes). Auditoría futura debería agregar `rri_origen_id UUID NULL` para cerrar el ciclo.
- **`ece.rri.anulada` no emite domain event**: la transición universal `anular` solo registra en `documento_instancia_historial` — los consumidores externos no son notificados directamente. Issue de observabilidad.
- **Teleinterconsulta no diferencia técnicamente de interconsulta**: el tipo `teleinterconsulta` existe en el constraint pero el router no captura metadatos del acto telemático (timestamp video-call, plataforma, hash de grabación si aplica) — gap respecto a Art. 40 NTEC.
- **Sin validación de coherencia `tipo` ↔ `establecimiento_destino_id`**: el schema Zod exige `establecimientoDestinoId` para todos los tipos, pero conceptualmente una interconsulta intra-hospitalaria no debería requerir centro destino distinto al origen (debería ser el mismo establecimiento). Falta validación cruzada.

## Descripción markdown rica (para BD `descripcion_markdown`)

La **Hoja de Referencia, Retorno e Interconsulta (RRI)** es el documento médico-legal bisagra del sistema asistencial: **es el único acto documental que cruza las fronteras del establecimiento** y por tanto el único que viaja físicamente con el paciente cuando este es transferido. Su importancia trasciende lo clínico inmediato — es el sustento del **Sistema Único de Información en Salud (SNIS)** previsto por la Ley SNIS Arts. 24-26 y del **expediente médico único por usuario** que debe estar disponible para todos los prestadores públicos.

### Casos de uso clínico

La RRI procede en cuatro escenarios formalmente distintos pero modelados sobre la misma tabla:

1. **Referencia** — el paciente es transferido a otro establecimiento o nivel de mayor complejidad. La RRI documenta el estado del paciente al momento del traslado, el motivo, el resumen clínico y la responsabilidad del médico referente. Ejemplos: paciente con IAM en hospital nivel I trasladado a nivel III para angioplastía; gestante con eclampsia trasladada a un centro con UCI obstétrica; paciente politraumatizado trasladado a hospital de referencia.

2. **Retorno (contrarreferencia)** — el centro receptor cierra el episodio de mayor complejidad y devuelve al paciente al centro de origen con recomendaciones de seguimiento. Cierra el ciclo de la red de servicios. La RRI tipo `retorno` también requiere firma del médico que la emite (típicamente el especialista del centro receptor) y del médico receptor (el MC del centro origen al recibir).

3. **Interconsulta intra-hospitalaria** — dentro de un mismo hospital, el médico tratante solicita evaluación a otra especialidad (ej. medicina interna solicita a cardiología, cirugía solicita a anestesiología, pediatría solicita a neurocirugía). El paciente NO se traslada físicamente entre establecimientos; el documento solo cruza servicios. La RRI tipo `interconsulta` documenta la solicitud y la respuesta del especialista, ambas firmadas.

4. **Teleinterconsulta** (Art. 40 NTEC) — variante telemática de la interconsulta. El acto telemático debe quedar registrado tanto en el expediente del centro solicitante como en el del centro consultor. La firma electrónica de ambos profesionales y los metadatos del acto (timestamp, especialidad consultora) son obligatorios.

### Punto bisagra y responsabilidad médico-legal

A diferencia de otros documentos del ECE (que son internos a un episodio o establecimiento), la RRI **transfiere o comparte responsabilidad asistencial** entre profesionales y, cuando aplica, entre instituciones. Por eso el campo `estado_paciente_al_traslado` (capturable en `resumen_clinico` hasta que exista columna separada) es crítico — describe la condición exacta del paciente en el momento en que sale del establecimiento. Si el paciente se descompensa en tránsito o en el centro destino, este registro es la evidencia de partida para análisis de eventos adversos.

### Reglas operativas (motor workflow)

El ciclo de vida sigue el motor genérico ECE: `borrador → en_revision → firmado → validado`, con `anulado` accesible solo desde Dirección. La transición `firmado` exige **firma PIN del MC** (argon2id, lockout 5 intentos). La transición `validado` (alias `responder` en código) exige **firma PIN del IC** y simultáneamente persiste el texto de la respuesta. No hay regla 4-eyes técnica: el mismo profesional que firma puede, si tiene ambos roles habilitados, responder a su propia solicitud — la separación es organizacional (asignación de roles en `ece.usuario_rol`).

Tras la firma del MC se emite el evento de dominio `ece.rri.firmada`, consumido por:

- El módulo de coordinación de transporte (cuando `tipo='referencia'`).
- El módulo de notificaciones hacia el `establecimiento_destino_id`.
- La bitácora ECE inmutable con cadena de hash (`audit.audit_log`, Art. 55-56 NTEC).

### Integración con el resto del ECE y el SNIS

La RRI es el principal documento reportable al **MINSAL para indicadores de red**: tasa de referencia efectiva, tasa de contrarreferencia, tiempos de respuesta, especialidades más solicitadas. Su estructura tipada (`tipo`, `establecimiento_destino_id`, `especialidad_solicitada`) habilita estos reportes de manera nativa. Cuando el paciente egresa por traslado (`EPICRISIS.circunstancia_alta = 'referido_otro_hospital'`), la epicrisis exige RRI vinculada — la dependencia es contractual a nivel de auditoría documental aunque no esté implementada como FK estricta.

### Cumplimiento normativo

- **NTEC Art. 38** — continuidad asistencial: garantizar que la información clínica relevante acompañe al paciente.
- **NTEC §3.10** — campos clave del módulo RRI: tipo, establecimientos, especialidad, resumen, motivo, respuesta, firmas, metadatos.
- **NTEC Art. 40** — teleinterconsulta: registro en ambos expedientes.
- **NTEC Art. 23 lit. a.4** — firma electrónica simple por profesional (MC solicitante e IC respondiente).
- **NTEC Art. 42** — rectificación trazable post-firma (estado `rectificado` en `estado_registro`).
- **NTEC Art. 55-56** — metadatos obligatorios: usuario creador, timestamp precisión segundo, bitácora inmutable ≥ 2 años (hash chain).
- **Ley SNIS Arts. 24-26** — expediente médico único por usuario; la RRI es el vehículo de continuidad entre prestadores públicos.
- **MINSAL SIS — módulo RRI** — la implementación HIS debe poder exportar a este módulo para reporte nacional.

### Diferencia operativa interconsulta vs referencia (no confundir)

- **Interconsulta**: el paciente PERMANECE en su servicio/establecimiento; un especialista distinto del MC tratante lo evalúa (presencial o por video, "teleinterconsulta"). La responsabilidad asistencial primaria sigue siendo del MC; el IC emite recomendación.
- **Referencia**: el paciente SE TRASLADA físicamente a otro establecimiento; la responsabilidad asistencial se transfiere total o temporalmente al centro receptor. El centro origen documenta el estado del paciente al salir; el centro destino lo recibe formalmente (idealmente con `tipo='retorno'` cuando devuelve).

Esta distinción tiene implicaciones legales: en interconsulta no hay transferencia de custodia; en referencia sí. El documento RRI las trata como variantes tipadas pero el operador clínico debe respetar la diferencia conceptual al elegir el `tipo`.
