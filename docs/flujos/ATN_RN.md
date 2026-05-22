# ATN_RN — Hoja de Atención del Recién Nacido (Doc 14 NTEC neonatal)

## Metadata
- **codigo**: ATN_RN
- **nombre**: Hoja de Atención Inmediata del Recién Nacido Vivo
- **modalidad**: HOSPITALIZACION (neonatal — sala de expulsión, recuperación neonatal, UCIN si aplica)
- **NTEC artículo**: Acuerdo n.° 1616 (MINSAL, 2024) — Doc 14 Obstétrico §3.14 ("base del expediente del recién nacido — creación automática en MINSAL"). TDR §11.6 — "Atención inmediata del recién nacido: APGAR 1', 5', 10', Capurro, Ballard, Silverman-Andersen, Downes, peso, talla, perímetro cefálico, vacunas inmediatas (BCG, Hep B), profilaxis ocular y vitamina K"; **apertura automática de expediente del recién nacido vinculado al de la madre**. Aplican Arts. 17 (estructura del expediente), 39 (firma electrónica simple), 40 (inmutabilidad post-firma), 41 lit. c (resumen al egreso), 55-56 (metadatos).
- **modulo_his_target**: `/ece/atencion-rn` (lista + creación atómica del RN como paciente). Router tRPC: `eceAtencionRn` (`packages/trpc/src/routers/ece/atencion-rn.router.ts`). **No tiene equivalente legacy** en HIS: la atención inmediata del RN es introducida formalmente por la NTEC y el HIS solo había modelado partos como evento administrativo (sin documento clínico del neonato). El expediente neonatal continúa en `/admission` cuando el RN requiere ingreso a UCIN.
- **tabla_datos**: `ece.atencion_recien_nacido` (26 columnas, ver `packages/database/sql/72_sala_expulsion.sql` para la tabla base y `sql/73_atencion_recien_nacido.sql` para el patch idempotente). Cabecera obstétrica: `ece.documentos_obstetricos.atencion_rn` (JSONB) + `ece.documentos_obstetricos.recien_nacido_paciente_id` (FK).
- **inmutable**: `true` **post-firma**. Estado documento: `borrador → firmado` (PIN argon2id del pediatra). Una vez `firmado`, ningún UPDATE legal; rectificaciones trazables (NTEC Art. 40, 42). Estado `validado` reservado para revisión de archivo si el flujo institucional lo exige.
- **tipo_registro**: **MAESTRO** (per `ece.tipo_documento.tipo_registro = 'maestro'`). Es la fuente primaria de identidad del RN como paciente — funcionalmente equivale a una FICHA_IDENT generada por nacimiento.

## Propósito normativo

La Hoja de Atención del Recién Nacido es el **documento fundacional del expediente neonatal**. Concentra en un solo acto clínico cinco funciones simultáneas:

1. **Identidad del recién nacido** — crea atómicamente el `Patient` (público) y `ece.paciente` (ECE) del RN, vinculados a la madre vía `motherPatientId`. Esta operación es la base del **expediente del recién nacido** mencionado por el TDR §11.6 y NTEC Doc 14.
2. **Valoración Apgar** — score estándar internacional al 1, 5 y 10 minutos. Apgar 5 min < 7 dispara protocolo NRP (Neonatal Resuscitation Program).
3. **Antropometría neonatal** — peso (g), talla (cm), perímetro cefálico (cm) — base de las curvas de crecimiento OMS (TDR §15.2).
4. **Examen físico inmediato** + identificación de malformaciones aparentes — captura clínica de patología congénita visible.
5. **Profilaxis neonatal** — vitamina K, profilaxis ocular, vacunas inmediatas (BCG, Hep B dosis 0), inicio de lactancia, contacto piel-a-piel — todos indicadores de calidad de atención neonatal en SV.

Como **base del expediente del RN**, ATN_RN dispara:

- Apertura automática del `Patient` neonatal con `motherPatientId` (vínculo madre-hijo verificable).
- Creación de la `ece.paciente` neonatal con identidad propia (NUI provisional hasta acta de nacimiento del Registro Civil).
- Evento de dominio `ece.rn.registrado` (y opcionalmente `ece.rn.reanimacion_requerida`) consumido por:
  - Módulo de pediatría/neonatología (apertura del expediente neonatal).
  - Módulo de tamizaje neonatal (TSH, fenilcetonuria, hipoacusia, cardiopatías críticas — exigibles en SV).
  - Módulo de vacunación (calendario neonatal SV).
  - Notificación al Registro Civil (interoperabilidad pendiente — TDR §11.6).

Sin un ATN_RN firmado, el RN **no existe como paciente** en el HIS — su trayectoria clínica posterior (ingreso a sala de recuperación neonatal, UCIN, alojamiento conjunto, alta) requiere este documento como precondición.

## Dependencias

| Dependencia | Tipo | Estado requerido | Origen |
|---|---|---|---|
| **HOJA_ING** obstétrica de la madre | Hard (bloqueante) | `firmado` o `validado` | NTEC §3.12. Sin episodio hospitalario formal de la madre, no hay marco legal para registrar el RN. Documentado en `ece.tipo_documento.depende_de = ARRAY['HOJA_ING']`. |
| **`ece.episodio_atencion`** obstétrico (= `episodioObsId`) | Hard (bloqueante) | `establecimiento_id` = `ctx.tenant.establishmentId` | El router exige episodio del establecimiento actual. Vinculo materno: `paciente_madre_id` se infiere del episodio. |
| **SALA_EXP** (o ACT_QX si cesárea) | Hard (lógica) | nacimiento registrado (`ece.sala_expulsion.nacimiento_ts` o equivalente en cesárea) | El RN nace dentro de un evento expulsivo (vaginal o cesárea). Funcionalmente la SALA_EXP precede a ATN_RN aunque actualmente el modelo no enlaza por FK explícita — el cruce es por `episodioObsId`. |
| **`ece.paciente`** de la madre | Hard (bloqueante) | activo (existe `paciente_madre_id`) | El router valida la madre antes de crear el Patient del RN con `motherPatientId`. |
| **`ece.personal_salud`** del pediatra firmante | Hard (operacional) | activa + `ece.firma_electronica` con `pin_hash` argon2id | NTEC Art. 39. El router invoca `verifyPin()` con argon2id + lockout 5 intentos. |
| **PARTOGRAMA** | Soft (informativo) | si hubo trabajo de parto, partograma cerrado con `motivoCierre = 'parto_vaginal'` | No bloquea ATN_RN pero proporciona contexto perinatal (FCF previa, intervenciones). |

## Obligatoriedad

- **SIEMPRE** — en **nacido vivo** (este documento es exclusivo para RN con vida al nacimiento).
- **NO aplica** — **mortinato** (nacido muerto / óbito fetal): genera `CERT_DEFUN_FETAL` u "óbito fetal" según protocolo institucional + estadística MINSAL; **no** se crea Patient neonatal por convención.
- **NO aplica** — **muerte inmediata neonatal** (RN nace vivo pero fallece en sala de expulsión antes de poder evaluar Apgar 5min): se documenta como `ATN_RN` con `apgar_5min = 0` + emisión inmediata de `CERT_DEFUN` neonatal; el Patient se crea igualmente para tener el expediente. **Decisión institucional pendiente** — clarificar si en esos casos el `Patient` se crea o no.
- **SIEMPRE** — en parto múltiple, **un ATN_RN por cada producto vivo** (gemelos, trillizos). Cada uno crea su propio `Patient` con el mismo `motherPatientId`.

## Roles firmantes

| Rol | Acción | Momento | Mecanismo |
|---|---|---|---|
| **PEDIATRA** / **NEONATOLOGO** (rol HIS `MC`) | Evalúa Apgar, antropometría, examen físico, decide reanimación, firma ATN_RN | Inmediato post-nacimiento (Apgar 1min) hasta cierre del registro (post 10 min y profilaxis aplicada) | `eceAtencionRn.create` (creación) → `registrarApgar` (refinamiento de scores) → `firmar` con PIN argon2id 6-32 char. Verificación: `ece.firma_electronica.pin_hash` + lockout 5 intentos. |
| **ENFERMERIA_NEONATAL** (rol `ENF`) | Administra vit K, profilaxis ocular, BCG/HepB, inicia lactancia/piel-a-piel, registra mediciones | Continuo en sala neonatal | `readerProc` para `list`/`get`. Las acciones se documentan en `datos` JSONB de la cabecera obstétrica (`atencion_rn`) o en checklist separado. |
| **MC** del equipo de reanimación NRP | Si Apgar 5min < 7 → activa protocolo NRP → registra `ece.reanimacion_neonatal` | Solo si reanimación requerida | Documento separado `REANIMACION_NEONATAL` con su propio workflow (ver `eceReanimacionNeonatalRouter`). |
| **ARCH** | Verifica integridad documental al final del expediente | Post-firma, opcional | Transición `firmado → validado` si la institución exige doble paso (no implementado en el router actual). |
| **DIR** | Anula el documento (excepcional) | Solo pre-validación | `requireRole(["DIR"])` — no implementado en el router actual; gestión vía workflow ECE genérico. |

> El **pediatra firma el ATN_RN** — no la enfermera. Es responsabilidad médica certificar la valoración Apgar y la condición del RN al nacimiento. Si el establecimiento no tiene pediatra de guardia, firma el ginecoobstetra a cargo del parto.

## Campos obligatorios

Estructura de `ece.atencion_recien_nacido` (26 columnas):

```
id                                  UUID PK
episodio_obs_id                     UUID NOT NULL FK → ece.episodio_atencion(id)
instancia_id                        UUID NULL FK → ece.documento_instancia(id) ON DELETE SET NULL
paciente_madre_id                   UUID NOT NULL                        -- FK al Patient público de la madre
paciente_rn_id                      UUID NOT NULL                        -- creado atómicamente por el router
hora_nacimiento                     TIMESTAMPTZ NOT NULL DEFAULT now()   -- ver HF-17 (drift)
peso_g                              SMALLINT NOT NULL                    -- 200-8000 (Zod), smallint en BD
talla_cm                            NUMERIC NOT NULL                     -- 20-70 cm
perimetro_cefalico_cm               NUMERIC NULL                         -- 20-50 cm
sexo                                TEXT CHECK IN ('M','F','I')          -- I = indeterminado / intersexual
edad_gestacional_semanas            SMALLINT NOT NULL                    -- 20-45
apgar_1min                          SMALLINT NOT NULL                    -- 0-10
apgar_5min                          SMALLINT NULL                        -- 0-10
apgar_10min                         SMALLINT NULL                        -- 0-10 (obligatorio si apgar_5min < 7)
apgar_desglose                      JSONB NULL                           -- desglose por criterio (FC, esfuerzo respiratorio, tono, irritabilidad, color)
reanimacion_requerida               BOOLEAN NOT NULL DEFAULT false
reanimacion_protocolo_nrp_aplicado  JSONB NULL                           -- {aplicado: true|false, pasos: [...]}
malformaciones_visibles             TEXT NULL                            -- texto narrativo libre
alimentacion_inicial                TEXT NOT NULL CHECK IN ('lactancia_inmediata','formula','sng')
estado_documento                    TEXT NOT NULL DEFAULT 'borrador'     -- 'borrador' | 'firmado' | 'validado' | 'anulado'
firmado_por                         UUID NULL FK → ece.personal_salud(id)
firmado_en                          TIMESTAMPTZ NULL
registrado_por                      UUID NOT NULL FK → ece.personal_salud(id)
atendido_por                        UUID NULL FK → ece.personal_salud(id) -- pediatra MC firmante
registrado_en                       TIMESTAMPTZ NOT NULL DEFAULT now()
estado_registro                     TEXT NOT NULL DEFAULT 'borrador'      -- redundante con estado_documento (drift histórico)
```

Campos clínicos recomendados por TDR §11.6 + NTEC §3.14 y **acomodados hoy en campos no estructurados** o pendientes de columna explícita:

- **Sexo del RN** (`M | F | I`) — columna existe ✓.
- **Hora del nacimiento** (`hora_nacimiento`) — columna existe pero el router actual usa el default `now()` en lugar del `nacimiento_ts` real de SALA_EXP (gap HF-17).
- **Vivo SI/NO** — implícito en la existencia del documento (ATN_RN solo para vivos). Mortinato → otro documento.
- **Apgar 1', 5', 10'** — columnas existen ✓; `apgar_10min` debería ser obligatorio si `apgar_5min < 7` (validación cliente, no constraint DB).
- **Apgar desglose por criterio** (`apgar_desglose` JSONB) — soporta el desglose de los 5 componentes (frecuencia cardíaca, esfuerzo respiratorio, tono muscular, irritabilidad refleja, coloración).
- **Peso, talla, perímetro cefálico** — columnas existen ✓. **Perímetro torácico**: no columna dedicada hoy; recomendado agregar `perimetro_toracico_cm NUMERIC`.
- **Edad gestacional** (`edad_gestacional_semanas`) — columna existe ✓. **Método de cálculo** (Capurro vs Ballard vs FUR): no columna dedicada hoy; recomendado `edad_gestacional_metodo TEXT CHECK IN ('capurro', 'ballard', 'fur', 'eco')`.
- **Clasificación somatométrica** (AEG / PEG / GEG — adecuado/pequeño/grande para edad gestacional): no columna dedicada hoy; **derivable** del peso + edad gestacional vs curvas OMS Intergrowth-21st (debería ser campo calculado server-side y persistido para análisis epidemiológico).
- **Examen físico segmentario** (cabeza, cuello, tórax, abdomen, genitales, extremidades, neurológico): no columnas dedicadas; recomendado un JSONB `examen_fisico_neonatal` con estructura por sistema. Hoy se anota en `malformaciones_visibles` (TEXT libre).
- **Malformaciones aparentes** (`malformaciones_visibles`) — columna existe ✓; texto libre. Recomendado agregar campo paralelo de CIE-10 estructurado para malformaciones detectadas.
- **Screening neonatal** (TSH, fenilcetonuria, hipoacusia, cardiopatías críticas): no columna dedicada hoy; debería modelarse como tabla separada `ece.tamizaje_neonatal` con eventos múltiples.
- **Vit K administrada** (sí/no, dosis, vía IM/oral): no columna dedicada; documentado en checklist enfermería del documento obstétrico (`datos` JSONB de cabecera).
- **Profilaxis ocular** (sí/no, eritromicina/tetraciclina): no columna dedicada; idem.
- **Vacuna BCG y Hep B dosis 0** (sí/no, lote, fecha): no columnas dedicadas; deberían integrarse con módulo de vacunación SV.
- **Contacto piel-a-piel iniciado** (sí/no, duración): no columna dedicada; indicador de calidad.
- **Lactancia inmediata** (sí/no, momento) — parcialmente cubierto por `alimentacion_inicial = 'lactancia_inmediata'` ✓.
- **Madre ID** (`paciente_madre_id`) — columna existe ✓ (FK Patient madre).
- **Firma del pediatra** (`firmado_por`, `firmado_en`, `atendido_por`) — columnas existen ✓; PIN argon2id verificado.

## Estados

```
borrador (al crear con eceAtencionRn.create)
   │
   ├─registrarApgar (refinamiento de Apgar 5/10 si Apgar 1 fue inicial)
   │     │
   │     └─ solo en borrador
   │
   ├─firmar (PIN argon2id del pediatra)─────► firmado
   │                                            (inmutable post-firma — NTEC Art. 40)
   │                                            emite ece.rn.registrado al outbox
   │                                            (si reanimacion_requerida → ece.rn.reanimacion_requerida)
   │
   └─anular (DIR, solo pre-firma)──────────► anulado
```

## Transiciones

| origen | destino | rol | condición | acción tRPC |
|---|---|---|---|---|
| `borrador` | `borrador` (update) | `MC` | reescritura de Apgar antes de firma | `eceAtencionRn.registrarApgar({ id, apgar1min, apgar5min, apgar10min? })` |
| `borrador` | `firmado` | `MC` | PIN correcto + `ece.firma_electronica` no bloqueada (< 5 intentos fallidos) | `eceAtencionRn.firmar({ id, pin })` |
| `firmado` | — | — | inmutable absoluto | — (rectificación trazable en NOTA_EVOL) |
| `borrador` | `anulado` | `DIR` | motivo de anulación (gestión vía workflow ECE genérico) | (no implementado en router actual) |
| `anulado` | — | — | terminal | — |

> El `registrarApgar` solo opera en estado `borrador` (TODO en código actual; verificación pendiente). Una vez firmado, los Apgar son inmutables.

## Eventos

Emitidos al outbox (`emitDomainEvent` desde `@his/database`) en la misma transacción que el INSERT/UPDATE:

| Evento | Disparador | Aggregate | Payload (campos clave) |
|---|---|---|---|
| **`atn_rn.valoracion_iniciada`** | `eceAtencionRn.create` finaliza con éxito (mapeado como `ece.rn.registrado` en el código) | `EceAtencionRecienNacido` | `{ id, episodioObsId, pacienteMadreId, pacienteRnId, instanciaId, registradoPor, registradoEn, apgar1min, apgar5min }` |
| **`atn_rn.apgar_registrado`** | `eceAtencionRn.registrarApgar` finaliza con éxito | `EceAtencionRecienNacido` | `{ id, apgar1min, apgar5min, apgar10min?, registradoPor }` — útil cuando los scores se completan progresivamente (Apgar 1 inicial, 5/10 después). |
| **`atn_rn.malformacion_detectada`** (alerta) | si `malformaciones_visibles` no vacío al crear o firmar | `EceAtencionRecienNacido` | `{ id, pacienteRnId, descripcion, pediatraId }` — dispara notificación al equipo de pediatría/genética. **No implementado** hoy explícitamente — se infiere del campo `malformaciones_visibles`. |
| **`atn_rn.lactancia_inmediata_iniciada`** | si `alimentacionInicial = 'lactancia_inmediata'` al crear/firmar | `EceAtencionRecienNacido` | `{ id, pacienteRnId, momentoInicio }` — indicador de calidad. **No implementado** hoy como evento dedicado. |
| **`ece.rn.reanimacion_requerida`** | si `reanimacionRequerida = true` al crear | `EceAtencionRecienNacido` | `{ id, episodioObsId, pacienteRnId, apgar1min, apgar5min, atencionRnId }` — dispara apertura de `ece.reanimacion_neonatal` (módulo NRP). |
| **`atn_rn.firmada`** | `eceAtencionRn.firmar` finaliza con éxito | `EceAtencionRecienNacido` | `{ id, pacienteRnId, firmadoPor, firmadoEn, firmaId, payloadHash }` — **dispara apertura formal del expediente RN como paciente distinto** + notificación a Registro Civil (cuando interoperabilidad esté lista). |

Suscriptores observados / esperados:

- **Módulo de pediatría / neonatología** — abre expediente neonatal con `Patient` del RN ya creado.
- **Módulo de reanimación neonatal** (`ece.reanimacion_neonatal`) — escucha `ece.rn.reanimacion_requerida` y precarga el registro NRP.
- **Módulo de vacunación** (calendario neonatal SV) — agenda BCG, Hep B dosis 0, próximas dosis.
- **Módulo de tamizaje neonatal** — abre tarea de tamizaje TSH / fenilcetonuria / hipoacusia / cardiopatías críticas (ventana 24-72 h post-nacimiento).
- **Módulo de notificaciones (Beta.15)** — escala al jefe de neonatología si Apgar 5min < 7 o reanimación requerida.
- **Registro Civil** (futuro, vía interoperabilidad MINSAL — TDR §11.6) — emite acta de nacimiento.
- **Audit hash chain** — debería encadenar el `payload_hash` del ATN_RN al historial del episodio obstétrico.

## Drift conocido

Auditoría **Stream F — Obstetricia + Neonatal (2026-05-19)** documenta 5 hallazgos sobre el módulo (Módulo 4 — Atención RN). Referencia: `docs/audit/2026-05-19_audit_stream_f_obstetricia_neonatal.md`.

| ID | Severidad | Descripción | Ruta afectada |
|---|---|---|---|
| **HF-17** | P1-ALTO | `hora_nacimiento` se inserta con el `DEFAULT now()` de la BD en lugar del **timestamp real del nacimiento** disponible en `ece.sala_expulsion.nacimiento_ts`. Si el pediatra registra ATN_RN 2 horas después del parto, el registro muestra la hora de creación del documento, no la del nacimiento. **Impacto legal**: el acta de nacimiento refleja la hora incorrecta. | `packages/trpc/src/routers/ece/atencion-rn.router.ts:376-408` |
| **HF-18** | P1-ALTO | **RLS solapadas**: la policy `atencion_rn_select` tiene `qual = current_setting('app.current_org_id', true) IS NOT NULL` — cualquier autenticado con el GUC seteado puede leer todos los registros RN. La policy correcta `atn_rn_by_episodio_estab` filtra por `episodio_atencion.establecimiento_id`. PostgreSQL aplica las policies PERMISSIVE con OR — la más laxa gana. **Fuga cross-org de datos neonatales** mientras `atencion_rn_select` esté activa. | `packages/database/sql/73_atencion_recien_nacido.sql` (policies) |
| **HF-19** | P2-MEDIO | `pesoG` declarado como `z.number().int().min(200).max(8000)` — el max 8000 está en rango de smallint (max 32767) pero un futuro cambio del validador podría superar el tipo de columna. **Tipos no rigurosamente sincronizados**. | `atencion-rn.router.ts:46` |
| **HF-20** | P2-MEDIO | `reanimacion_protocolo_nrp_aplicado` se serializa como `JSON.stringify({ aplicado: bool })::jsonb` — la columna es JSONB pero **sin schema formal**. Si el router NRP (`eceReanimacionNeonatalRouter`) necesita leer este JSONB para precargar pasos, la falta de tipado produce runtime errors. **Recomendación**: cambiar a columna `boolean` o definir Zod schema explícito. | `atencion-rn.router.ts:399` |
| **HF-21** | P3-BAJO | UI usa **11 `useRef` DOM nativos** en lugar de React Hook Form o controlled inputs. Lectura por `ref.current?.value` directamente — propenso a bugs de sincronización y difícil de probar. Inconsistente con el resto de módulos ECE. | `apps/web/src/app/(clinical)/ece/atencion-rn/page.tsx:131-143` |

> **Resumen**: el módulo ATN_RN tiene la **implementación más completa y correcta del Stream F** según el auditor (creación atómica del RN, firma electrónica argon2id, eventos de dominio, motor de workflow integrado). Los hallazgos restantes son de menor impacto que en otros módulos, pero **HF-17 (hora real del nacimiento) y HF-18 (RLS solapada)** son P1 que deben resolverse antes de go-live.

## Descripción markdown rica

### Por qué el Apgar sigue siendo el estándar internacional

El **Apgar score** (Virginia Apgar, 1952) evalúa 5 criterios al minuto 1 y minuto 5 (extendido a minuto 10 si Apgar 5 min < 7): **F**recuencia cardíaca, **A**ctividad (tono muscular), **G**esto (irritabilidad refleja), **A**specto (coloración), **R**espiración. Cada criterio puntúa 0-2 → total 0-10.

- **Apgar ≥ 7**: condición normal del RN, no requiere intervención inmediata.
- **Apgar 4-6**: depresión moderada — estimulación + oxígeno + observación estrecha.
- **Apgar 0-3**: depresión severa — **activar NRP inmediato** (`ece.reanimacion_neonatal`).

El protocolo internacional es claro: **Apgar 5min < 7 dispara protocolo NRP** y exige Apgar 10min como verificación de respuesta a la reanimación. El router `eceAtencionRn.create` acepta `reanimacionRequerida: boolean` que cuando `true` emite `ece.rn.reanimacion_requerida` al outbox; este evento debe ser consumido por el módulo NRP para precargar el registro de reanimación.

> **No es un Apgar bajo** lo único que dispara NRP — también disparan otros indicadores (ausencia de respiración espontánea, FC < 100, líquido amniótico meconial con depresión). El campo `reanimacionRequerida` lo decide el pediatra con criterio clínico, no solo el score.

### Creación atómica del paciente RN — la transacción de oro

El procedure `eceAtencionRn.create` ejecuta **dentro de una sola transacción `withWorkflowContext`** los siguientes pasos:

1. Verifica que existe `personal_salud` activo para el MC firmante.
2. **Crea `public.Patient`** del RN con: `firstName`, `lastName`, `biologicalSexId`, `birthDate`, **`motherPatientId = paciente_madre_id`** (vínculo madre-hijo).
3. **Crea `ece.paciente`** apuntando al mismo `Patient.id` recién creado.
4. Resuelve `tipo_documento = 'ATN_RN'` + estado inicial del flujo.
5. **Crea `ece.documento_instancia`** del workflow.
6. **Inserta `ece.atencion_recien_nacido`** con `paciente_madre_id`, `paciente_rn_id`, `instancia_id`, Apgar, peso, talla, PC, etc.
7. Emite `ece.rn.registrado` al outbox (siempre).
8. Si `reanimacionRequerida=true` → emite también `ece.rn.reanimacion_requerida` al outbox.

Esta atomicidad es crítica: **si cualquier paso falla, el RN no se crea como paciente fantasma**. Es el patrón "transacción ACID + outbox" recomendado para crear agregados que cruzan bounded contexts (Patient público + Patient ECE + workflow instance + evento).

> **Comparativa con el HOJA_ING `eceBridgeAdmision.admitirDesdeOrden`** (9 pasos atómicos): el ATN_RN es la segunda transacción atómica más compleja del sistema ECE.

### Verificación de PIN argon2id

El procedure `eceAtencionRn.firmar` invoca `verifyPin(tx, hisUserId, pin)`:

1. Resuelve `personal_salud` activo del firmante.
2. Lee `ece.firma_electronica` (`pin_hash`, `failed_attempts`, `locked_until`).
3. Si `locked_until > now()` → `TOO_MANY_REQUESTS` con mensaje de minutos restantes.
4. Importa dinámicamente `@his/infrastructure` (`argon2.verify`) — la importación dinámica permite mock en tests sin resolución de módulo en runtime de Vitest.
5. Si PIN inválido → `UPDATE failed_attempts = failed_attempts + 1`; si `failed_attempts >= 5` la firma queda bloqueada hasta `locked_until`.
6. Si PIN válido → `UPDATE failed_attempts = 0`; retorna `{ firmaId, personalId }`.

Parámetros argon2id: m=64MB, t=3, p=4 — conservadores para hardware moderno, ~250 ms por verificación. Adecuado para firma puntual; no apto para alto throughput.

### Indicadores de calidad neonatal (TDR §11.6 + OPS)

ATN_RN es la fuente primaria de varios **indicadores de calidad** monitoreados por la jefatura de pediatría y reportados a MINSAL:

- **Tasa de contacto piel-a-piel inmediato** = % de RN con piel-a-piel iniciado en sala de expulsión (target ≥ 80%).
- **Tasa de lactancia inmediata** = `alimentacion_inicial = 'lactancia_inmediata'` / total ATN_RN (target ≥ 70%).
- **Tasa de reanimación neonatal** = `reanimacionRequerida = true` / total ATN_RN (benchmark institucional).
- **Distribución Apgar 5min** — Apgar < 7 marca asfixia neonatal (target < 5% del total).
- **Tasa de detección de malformaciones** — `malformaciones_visibles` no vacío vs total (epidemiología congénita).
- **Cobertura de vit K** = % de RN con vit K administrada en primeras 4 h (target 100%).
- **Cobertura BCG + Hep B 0** = % vacunados antes del alta hospitalaria (target ≥ 95%).

Hoy varios de estos campos viven en JSONB no estructurado o no se capturan estructuradamente. El **roadmap NTEC** propone promover columnas dedicadas para todos estos indicadores.

### Apertura automática del expediente RN como paciente distinto

El **evento clave** de ATN_RN es que **el RN se vuelve un paciente con expediente propio**:

- `Patient` (público): identidad demográfica del RN con `motherPatientId` apuntando a la madre.
- `ece.paciente`: contraparte ECE del RN para módulos NTEC.
- `Encounter`/`ece.episodio_atencion` neonatal: cuando el RN ingresa a sala de recuperación neonatal, UCIN o alojamiento conjunto se abre un episodio neonatal **independiente** del episodio obstétrico de la madre. Este episodio neonatal hereda:
  - `Patient` del RN.
  - Vínculo paterno-materno (`motherPatientId`).
  - Información de nacimiento (peso, edad gestacional, Apgar).

A partir de ahí, el RN tiene su propia trayectoria clínica: notas de evolución pediátricas, indicaciones médicas, signos vitales, alimentación, tamizaje, vacunas, alta, etc. **La cadena de hash chain del expediente neonatal comienza con el `payload_hash` de la firma del ATN_RN**.

### Mortinato vs nacido vivo — el caso límite

El TDR §11.6 menciona explícitamente "nacido vivo" como precondición para ATN_RN. Casos límite a definir explícitamente en política institucional:

- **Mortinato** (óbito fetal anteparto o intraparto sin signos de vida al nacimiento): **no se crea ATN_RN**. Se genera `CERT_DEFUN_FETAL` u "óbito fetal" en SALA_EXP/expediente obstétrico materno. Estadística MINSAL exige clasificación de óbito.
- **Muerte inmediata neonatal** (RN nace vivo, Apgar 1min > 0, fallece antes de Apgar 5min): **se crea ATN_RN** con Apgar 5min = 0 + emisión inmediata de `CERT_DEFUN` neonatal. El Patient sí se crea porque hubo trazabilidad de vida.
- **Apgar 0 al 1min en RN reanimado exitosamente**: ATN_RN normal con `apgar_1min = 0` + `reanimacion_requerida = true` + Apgar 5min/10min reflejando respuesta.

### Integración con motor workflow ECE

El tipo `ATN_RN` está registrado en `ece.tipo_documento` con:
- `tipo_registro = 'maestro'`
- `modalidad = 'hospitalario'`
- `depende_de = ARRAY['HOJA_ING']`
- `inmutable = false` (pero efectivamente sí post-firma, gestionado por `estado_documento`)

El motor de workflow:
- Bloquea creación si no hay HOJA_ING firmada para la madre.
- Crea `ece.documento_instancia` con estado inicial `borrador`.
- Avanza a `firmado` via `eceAtencionRn.firmar`.
- Registra historial inmutable en `ece.documento_instancia_historial` con `firma_id`, `payload_hash`, `ejecutado_por`.

### Hardening pendiente

Antes de habilitar ATN_RN para go-live en producción:

1. **HF-17** — añadir `rnBirthTs: z.coerce.date()` al schema de `create` y pasar explícitamente `hora_nacimiento = ${input.rnBirthTs}` al INSERT, propagando el timestamp real desde `ece.sala_expulsion.nacimiento_ts`.
2. **HF-18** — eliminar la policy `atencion_rn_select` redundante; conservar solo `atn_rn_by_episodio_estab` (filtro real por establecimiento).
3. **HF-20** — definir Zod schema formal para `reanimacion_protocolo_nrp_aplicado` JSONB o promoverlo a columna boolean si solo almacena un flag.
4. **HF-19** — sincronizar tipos Zod vs smallint de BD con `z.number().int().min(200).max(32767)` o cambiar columna a `integer`.
5. **HF-21** — migrar UI a React Hook Form o controlled state para alineación con el resto de los módulos ECE.
6. **Pendiente roadmap NTEC** — promover columnas estructuradas para perímetro torácico, examen físico segmentario, método de cálculo de edad gestacional, screening neonatal, vit K, profilaxis ocular, vacunas inmediatas, contacto piel-a-piel. Hoy en JSONB o texto libre.
7. **Pendiente interoperabilidad** — implementar notificación al **Registro Civil** al firmar ATN_RN (TDR §11.6 mencionado pero no cableado).
8. **Audit hash chain** — confirmar que `ece.atencion_recien_nacido` tiene trigger de auditoría (verificar `02_audit_triggers.sql`). Si falta, agregar igual que se solicita para PARTOGRAMA (HF-15 análogo).

---

**Referencias cruzadas**:

- ADR: `docs/audit/2026-05-19_audit_stream_f_obstetricia_neonatal.md` — ADR-F-02 (verifyPin unificado entre routers obstétricos).
- Audit: `docs/audit/2026-05-19_audit_stream_f_obstetricia_neonatal.md` (Módulo 4 — Atención RN, HF-17 a HF-21).
- Insumo: `docs/backlog/fase2/_insumos/analisis_workflows_ece.md` §3.14 — Documentos Obstétricos (base del expediente RN).
- Schema: `packages/database/sql/72_sala_expulsion.sql` (tabla base `atencion_recien_nacido` creada en SQL 72), `packages/database/sql/73_atencion_recien_nacido.sql` (patch idempotente — `instancia_id`, `atendido_por`, índices, RLS Cat-E), `packages/database/prisma/schema.prisma:5651-5663` (`EceAtencionRecienNacido`).
- Router: `packages/trpc/src/routers/ece/atencion-rn.router.ts` (procedures `list`, `get`, `create` atómico, `registrarApgar`, `firmar` con PIN argon2id).
- UI: `apps/web/src/app/(clinical)/ece/atencion-rn/page.tsx` (lista + creación con `ApgarScoreInput` reutilizable; checklist de alimentación).
- Documento hermano: `docs/flujos/PARTOGRAMA.md` (precede a ATN_RN — vigilancia del trabajo de parto).
- Documento hermano: `ece.reanimacion_neonatal` (router `eceReanimacionNeonatalRouter`, módulo NRP, disparado por `ece.rn.reanimacion_requerida`).
- Patient público: `public."Patient".motherPatientId` — vínculo madre-RN.
- TDR: §11.6 (Sala de Partos / Materno-infantil) — APGAR 1'/5'/10', Capurro, Ballard, Silverman-Andersen, Downes, antropometría, vacunas inmediatas BCG/Hep B, profilaxis ocular, vit K; **"Apertura automática de expediente del recién nacido vinculado al de la madre"**; "Notificación al registro civil (cuando exista interoperabilidad)". §15.2 (Pediatría — curvas OMS de crecimiento).
- Norma: MINSAL Acuerdo n.° 1616 (2024), Doc 14 Obstétrico §3.14; Arts. 17 (estructura), 39 (firma simple), 40 (inmutabilidad), 41 lit. c (resumen al egreso), 55-56 (metadatos).
- Estándar internacional: **Apgar Score** (Virginia Apgar, 1952) — escala 0-10 vigente; **NRP** (Neonatal Resuscitation Program, AAP/AHA) — protocolo de reanimación neonatal.
