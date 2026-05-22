# PARTOGRAMA — Partograma OMS (vigilancia trabajo de parto)

## Metadata
- **codigo**: PARTOGRAMA
- **nombre**: Partograma OMS (vigilancia gráfica del trabajo de parto)
- **modalidad**: HOSPITALIZACION (obstétrica)
- **NTEC artículo**: Acuerdo n.° 1616 (MINSAL, 2024) — Doc 14 Obstétrico §3.14 (registro del trabajo de parto y del nacimiento como base del expediente del recién nacido). Sustento internacional: **Partograma OMS 1994** con curva de alerta y curva de acción (4 h de separación). Cruzado en el TDR §11.6 — Sala de Partos / Materno-infantil ("Partograma electrónico con curva de Friedman"). Para inmutabilidad y firma simple aplican Arts. 39-40, 42, 55-56.
- **modulo_his_target**: `/ece/obstetricia/partograma/[episodioId]?docId=<docObstetricoId>` (vista per-episodio; el `docObstetricoId` referencia el agregado `ece.documentos_obstetricos` por evento obstétrico). Router tRPC: `ecePartograma` (`packages/trpc/src/routers/ece/partograma.router.ts`). Sin equivalente "legacy" en HIS — el partograma electrónico nace dentro de la pila ECE y se ofrece como vista incrustada en el dashboard de obstetricia.
- **tabla_datos**: `ece.partograma_registro` (16 columnas, lecturas seriadas hijas de `ece.documentos_obstetricos`). Adicionalmente la cabecera obstétrica (`EceDocumentoObstetrico` / `ece.documentos_obstetricos`) lleva el JSONB `partograma` con metadatos de la curva y un campo `labor_parto` que se sella al cerrar. Tipo de documento `PARTOGRAMA` en `ece.tipo_documento` con dependencia hard de `HOJA_ING`.
- **inmutable**: **registros seriados inmutables individualmente**. Cada `ece.partograma_registro` es append-only — su `id` y `alerta_oms` calculada quedan fijos al `INSERT`. La cabecera `ece.documentos_obstetricos` admite transición `borrador → vigente → firmado` y, una vez `firmado`, ningún UPDATE adicional es legal (NTEC Art. 40). El procedure `cerrarPartograma` debería rechazar cierres sobre estados `firmado`/`anulado` (gap actual — ver "Drift conocido" HF-08).
- **tipo_registro**: **TRANSACCIONAL** dentro del episodio obstétrico (serie temporal). Conserva todas las lecturas; al cerrarse, queda como **HISTÓRICO** dentro del expediente.

## Propósito normativo

El partograma es la **herramienta gráfica de vigilancia del trabajo de parto activo** recomendada por la OMS desde 1994 y exigida por el TDR §11.6 como módulo obligatorio del HIS Multipaís. Su objetivo es **detectar tempranamente la distocia** (progresión anormal del trabajo de parto) graficando en un solo plano cuatro dimensiones del evento:

1. **Dilatación cervical** (cm, 0-10) — la curva central.
2. **Descenso de la cabeza fetal** (planos de Hodge 0-IV o estaciones de Lee) — registrado de forma narrativa o codificada en `observaciones` del registro (no es columna dedicada en el modelo actual).
3. **Frecuencia cardíaca fetal** (lpm 60-200) — `frecuencia_cardiaca_fetal`.
4. **Contracciones uterinas** (frecuencia en 10 min + intensidad leve/moderada/fuerte) — `contracciones_10min` + `intensidad`.

La OMS define dos **líneas de referencia** sobre la curva de dilatación:

- **Curva de alerta**: a razón de 1 cm/hora desde el momento en que la paciente entra a la **fase activa** (dilatación ≥ 4 cm). Si la dilatación real cruza esta línea hacia la derecha, la paciente está progresando más lento de lo esperado.
- **Curva de acción**: 4 horas a la derecha de la curva de alerta. Cruzar esta línea exige **intervención inmediata** (re-evaluación obstétrica, eventual cesárea o instrumentación).

El router `ecePartograma.registrar` calcula automáticamente la zona OMS (`normal | zona_alerta | zona_accion`) usando `calcularAlertaOms` (función pura cubierta por tests unitarios) y la persiste en la columna `alerta_oms`. Cuando la zona ≠ `normal`, emite el evento de dominio **`ece.partograma.alerta`** al outbox para que el dashboard de obstetricia (`/ece/obstetricia`) y el motor de notificaciones (Beta.15) alerten al jefe de servicio y al ginecólogo de guardia.

Como evidencia médico-legal, el partograma demuestra que **el equipo vigiló el trabajo de parto cada 30 minutos o menos** (frecuencia mínima exigida por protocolo obstétrico). Una serie incompleta o con huecos temporales > 60 min es una bandera de mala praxis ante un desenlace adverso (sufrimiento fetal, ruptura uterina, asfixia perinatal).

## Dependencias

| Dependencia | Tipo | Estado requerido | Origen |
|---|---|---|---|
| **HOJA_ING** obstétrica | Hard (bloqueante) | `firmado` o `validado` con `servicio_destino=GINECO` o equivalente | NTEC §3.12. Sin episodio hospitalario formal abierto, el motor workflow rechaza la creación del documento obstétrico. |
| **`ece.documentos_obstetricos`** (cabecera) | Hard (bloqueante) | fila existente con `id` (= `docObstetricoId`) | El router exige `docObstetricoId` como FK en el INSERT a `partograma_registro`. Esta cabecera se crea al iniciar el ingreso obstétrico. |
| **`ece.episodio_atencion`** del establecimiento | Hard (bloqueante) | `establecimiento_id` = `ctx.tenant.establishmentId` | El router valida pertenencia del episodio antes de insertar (`SELECT id FROM ece.episodio_atencion WHERE id = ... AND establecimiento_id = ...`). |
| **`ece.personal_salud`** del firmante | Hard (operacional) | fila activa para el usuario actual (`his_user_id`) | El router resuelve `personalId` para el campo `registrado_por`. Drift documentado: el router usa `usuario_id` cuando la columna real es `his_user_id` (HF-14). |
| **SALA_EXP** | Soft (consecutiva) | aparece después; no es precondición | Sala de Expulsión consume los últimos registros del partograma como contexto del nacimiento. PARTOGRAMA precede temporalmente a SALA_EXP. |
| **CONS_INF obstétrico** | Soft (informativo) | recomendado si se contempla intervención (instrumentación, episiotomía electiva, cesárea) | NTEC Doc 5/6. No bloquea el partograma per se. |

## Obligatoriedad

- **SI** — en **trabajo de parto activo** (dilatación cervical ≥ 4 cm, o conforme protocolo institucional aunque la fase latente puede registrarse también).
- **SI** — en pacientes con **inducción** del trabajo de parto (oxitocina, misoprostol, balón cervical) desde el inicio de la inducción aunque la dilatación esté < 4 cm.
- **SI** — en **prueba de trabajo de parto** post-cesárea (VBAC) donde la vigilancia debe ser estricta.
- **NO aplica** — cesárea electiva sin trabajo de parto previo (saltar directo a `ACTO_QX` + SALA_EXP simulada por cesárea + ATN_RN).
- **NO aplica** — admisión obstétrica para vigilancia que no llega a fase activa antes de alta (se conserva la nota de evolución obstétrica pero no se inicia partograma).

> La fase latente del trabajo de parto (< 4 cm) puede ser registrada en el partograma pero la curva de alerta/acción **solo se calcula desde la fase activa** (≥ 4 cm) per OMS. La función `calcularAlertaOms` retorna `"normal"` para dilataciones < 4.

## Roles firmantes

| Rol | Acción | Momento | Mecanismo |
|---|---|---|---|
| **GINECO_OBSTETRA** (rol HIS `PHYSICIAN`) | Registra evaluaciones obstétricas, decisión de inducción, indicaciones | Continuo durante el trabajo de parto; obligatorio al cruzar `zona_alerta` y `zona_accion` | `ecePartograma.registrar` — no requiere PIN para cada lectura (es serie continua). |
| **RESIDENTE** (rol `PHYSICIAN_RESIDENT` / `MT`) | Ejecuta vigilancia bajo supervisión; registra dilatación, FCF, contracciones | Cada 30 min mínimo en fase activa; cada 15 min en fase de transición; continuo en expulsivo | `ecePartograma.registrar` con `requireRole(["PHYSICIAN", "NURSE", "MT"])` activo. |
| **ENFERMERIA_OBSTETRICIA** (rol `NURSE`) | Toma signos vitales maternos, monitoriza FCF intermitente, registra contracciones palpadas | Continuo turnos | `ecePartograma.registrar` permite firma de enfermería como autor del registro. |
| **GINECO_OBSTETRA** (cierre) | `cerrarPartograma` al finalizar (parto vaginal, cesárea, traslado, alta sin parto) | Una sola vez por documento obstétrico | `ecePartograma.cerrarPartograma` con `motivoCierre ∈ {parto_vaginal, cesarea, traslado, alta, otro}`. Sella el documento. |

> El partograma es un **registro de equipo**, no documento de firma única. La firma final corresponde al ginecólogo responsable del cierre. Los registros intermedios quedan auditables individualmente con su `registrado_por`.

## Campos obligatorios

Estructura de `ece.partograma_registro` (un INSERT por evaluación, mínimo cada 30 min en fase activa):

```
id                          UUID PK (auto gen_random_uuid)
doc_obstetrico_id           UUID FK → ece.documentos_obstetricos(id) ON DELETE RESTRICT
episodio_id                 UUID FK → ece.episodio_atencion(id) ON DELETE RESTRICT
registrado_en               TIMESTAMPTZ NOT NULL DEFAULT now()
dilatacion_cm               NUMERIC(3,1) NOT NULL CHECK (0 ≤ dilatacion_cm ≤ 10)
borramiento_pct             SMALLINT NULL CHECK (0 ≤ borramiento_pct ≤ 100)
posicion_fetal              TEXT NULL CHECK IN (
                              'OIA','OIP','ODA','ODP',
                              'OIIA','OIIP','ODIA','ODIP',
                              'presentacion_cara','presentacion_frente','otro')
frecuencia_cardiaca_fetal   SMALLINT NULL CHECK (60 ≤ fcf ≤ 200)
contracciones_10min         SMALLINT NULL CHECK (0 ≤ c10 ≤ 10)
intensidad                  TEXT NULL CHECK IN ('leve','moderada','fuerte')
dolor_paciente              SMALLINT NULL CHECK (0 ≤ dolor ≤ 10)   -- EVA 0-10
medicamentos                TEXT NULL                              -- texto libre, dosis oxitocina, analgesia
observaciones               TEXT NULL                              -- ruptura membranas, PA materna, pulso, temperatura
alerta_oms                  TEXT DEFAULT 'normal' CHECK IN (
                              'normal','zona_alerta','zona_accion')
registrado_por              UUID NOT NULL FK → ece.personal_salud(id)
created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
```

Campos clínicos recomendados por OMS y **acomodados hoy en `observaciones` o `medicamentos` (texto libre)** mientras se acuerda la promoción a columnas estructuradas (gap NTEC):

- **Hora de evaluación** — disponible vía `registrado_en` (timestamptz).
- **Descenso de la cabeza fetal** (planos de Hodge 0-IV o estaciones de Lee -3 a +3) — recomendado columna dedicada `descenso_cabeza`.
- **Ruptura de membranas** — íntegras vs rotas + hora de ruptura + características del líquido (claro / meconial / hemorrágico). Hoy se anota en `observaciones`.
- **Medicación uterotónica** (oxitocina U/min, prostaglandinas) — hoy en `medicamentos`.
- **Analgesia obstétrica** (peridural, IV) — hoy en `medicamentos`.
- **Presión arterial materna** — recomendado columna `pa_sistolica` + `pa_diastolica`; hoy en `observaciones`.
- **Pulso materno** — recomendado columna `pulso_materno`; hoy en `observaciones`.
- **Temperatura materna** — recomendado columna `temperatura_materna`; hoy en `observaciones`.

Cabecera obstétrica (`ece.documentos_obstetricos`):

```
partograma                  JSONB    -- metadatos curva, eventos clave
labor_parto                 JSONB    -- sello de cierre con motivoCierre, observacionCierre, fecha
sala_expulsion              JSONB    -- referencia al evento expulsivo (campo distinto al registro)
atencion_rn                 JSONB    -- referencia al RN nacido (campo distinto al registro)
recien_nacido_paciente_id   UUID     -- FK al Patient del RN cuando se cree
estado_registro             VARCHAR(20)  -- 'borrador' | 'vigente' | 'firmado' | 'anulado'
```

## Estados

```
documento obstétrico (cabecera)             registros seriados
-------------------------------             ---------------------
borrador (al admitir obstétrica)            n/a hasta primera lectura
  │
  ├─registrar (N veces, fase activa)───►    INSERT en partograma_registro
  │                                          (cada uno calcula alerta_oms y queda inmutable)
  │
  └─cerrarPartograma───────────────────►    UPDATE labor_parto en cabecera
                                            estado_registro = 'vigente'
                                            (NTEC Art. 40 — debería rechazar si ya firmado;
                                             gap HF-08)
                                            │
                                            └─firma final del ginecólogo───► firmado
                                                                              (inmutable absoluto)
```

> **Reglas**:
> - Registros individuales (`ece.partograma_registro`): **append-only**, ningún UPDATE legal. La inmutabilidad es per fila desde el momento del INSERT.
> - Cabecera (`ece.documentos_obstetricos`): admite transiciones de estado. Una vez `firmado`, queda sellada per NTEC Art. 40.

## Eventos

Emitidos al outbox (`emitDomainEvent` desde `@his/database`) en la misma transacción que el INSERT:

| Evento | Disparador | Aggregate | Payload (campos clave) |
|---|---|---|---|
| **`partograma.registro_creado`** | `ecePartograma.registrar` finaliza con éxito | `EcePartogramaRegistro` | `{ id, docObstetricoId, episodioId, registradoPor, dilatacionCm, alertaOms, registradoEn }` |
| **`partograma.linea_alerta_cruzada`** (alerta calidad) | `alerta_oms = 'zona_alerta'` | `EcePartogramaRegistro` | `{ id, docObstetricoId, episodioId, dilatacionCm, dilatacionEsperada, horasEnFaseActiva }` — implementado bajo el evento genérico `ece.partograma.alerta` con `nivel: 'alerta'` |
| **`partograma.linea_accion_cruzada`** (acción inmediata) | `alerta_oms = 'zona_accion'` | `EcePartogramaRegistro` | mismo payload con `nivel: 'accion'`. Dispara notificación urgente al jefe de servicio y al ginecólogo de guardia (Beta.15). |
| **`partograma.cerrado`** | `ecePartograma.cerrarPartograma` finaliza con éxito | `EceDocumentoObstetrico` | `{ docObstetricoId, episodioId, motivoCierre, observacionCierre, cerradoPor }` |

Suscriptores observados:

- **Dashboard obstetricia** (`/ece/obstetricia`) — debe consumir `ece.partograma.alerta` para mostrar pacientes con curva fuera de rango (hoy mockeado — drift HF-03).
- **Motor de notificaciones (Beta.15)** — escala alerta a SMS / push del ginecólogo de guardia cuando `nivel = 'accion'`.
- **Audit hash chain** — debería encadenar cada registro al `payload_hash` previo del módulo. Hoy no hay trigger de auditoría en `ece.partograma_registro` (drift HF-15).

## Drift conocido

Auditoría **Stream F — Obstetricia + Neonatal (2026-05-19)** documenta 5 hallazgos sobre el módulo. Referencia: `docs/audit/2026-05-19_audit_stream_f_obstetricia_neonatal.md` (Módulo 2 — Partograma OMS).

| ID | Severidad | Descripción | Ruta afectada |
|---|---|---|---|
| **HF-05** | P1-ALTO | `docObstetricoId` se obtiene de `window.location.search` (`?docId=`) sin validar existencia ni usar `useSearchParams()` de Next.js 14. Si falta el query param, el partograma queda inutilizable sin guía al usuario. | `apps/web/src/app/(clinical)/ece/obstetricia/partograma/[episodioId]/page.tsx:426-432` |
| **HF-06** | P1-ALTO | **Bypass RLS**: el router invoca `ctx.prisma.$queryRaw` directo sin `withWorkflowContext`. El rol Prisma (`postgres.<ref>`) tiene BYPASSRLS, por lo que la policy `prt_read_personal` / `prt_write_personal` (que filtra por `establecimiento_id`) **no aplica en absoluto**. El único filtro real es el `WHERE ep.establecimiento_id = ${establecimientoId}` del raw SQL ("defensa débil" per contrato RLS del CLAUDE.md). | `packages/trpc/src/routers/ece/partograma.router.ts:151-289` |
| **HF-07** | P2-MEDIO | `alerta_oms` es `NULLABLE` en BD pero `PartogramaRegistroRow.alerta_oms` en TS lo tipa como `"normal" \| "zona_alerta" \| "zona_accion"` (sin `\| null`). Un registro antiguo con NULL revienta la UI al renderizar el badge. | `partograma.router.ts:69-86`, `[episodioId]/page.tsx:441` |
| **HF-08** | P2-MEDIO | `cerrarPartograma` actualiza `labor_parto` + `estado_registro = 'vigente'` **sin validar transición**. Un documento ya `firmado` puede ser re-cerrado y mutado (violación NTEC Art. 40 — inmutabilidad post-firma). | `partograma.router.ts:307-337` |
| **HF-09** | P3-BAJO | Tests de `partograma.router.test.ts` cubren `calcularAlertaOms` (4 casos) + Zod schemas + `detectarAlertasOMS`, pero **no cubren `cerrarPartograma`** (ni happy path ni rechazo por estado incorrecto). | `__tests__/partograma.router.test.ts` |
| **HF-14** | P2-MEDIO | El router resuelve `personalId` con `WHERE usuario_id = ${userId}` pero la columna real en `ece.personal_salud` es `his_user_id`. `partograma.registrar` falla con `42703: column "usuario_id" does not exist`. | `partograma.router.ts:198-206` |
| **HF-15** | P2-MEDIO | **Sin audit hash chain**: ningún trigger registrado en `information_schema.triggers` para `ece.partograma_registro`. Los registros de trabajo de parto no tienen inmutabilidad criptográfica per TDR §6.3. | `packages/database/sql/71_partograma_dilatacion.sql` |

> **Resumen**: el módulo Partograma tiene la **mejor lógica de negocio del Stream F** (`calcularAlertaOms` funcionalmente correcta) pero arrastra problemas de seguridad de tenant (HF-06), drift de naming (HF-14) y falta de inmutabilidad criptográfica (HF-15). El ADR-F-03 propone unificar todos los routers obstétricos bajo `withWorkflowContext`.

## Descripción markdown rica

### Por qué el partograma OMS es un instrumento médico-legal único

El partograma no es un registro narrativo más en el expediente: **es un instrumento gráfico estándar que comprime en un solo plano toda la información necesaria para decidir si el trabajo de parto progresa normalmente o necesita intervención**. Su valor médico-legal proviene de tres propiedades:

1. **Granularidad temporal** — cada 30 minutos (o menos en transición / expulsivo) se documenta el estado completo. Un hueco > 60 min en la serie es indicio de vigilancia insuficiente.
2. **Trazabilidad gráfica** — la curva real frente a las líneas de alerta y acción es interpretable por cualquier obstetra del mundo sin necesidad de leer texto. En un peritaje, el gráfico habla por sí solo.
3. **Cierre formal** — el `cerrarPartograma` con `motivoCierre` ∈ {`parto_vaginal`, `cesarea`, `traslado`, `alta`, `otro`} sella el documento. Tras eso, la cabecera obstétrica es inmutable y cualquier cambio requiere rectificación trazable (NTEC Art. 42).

### Curvas de alerta y acción — la matemática implementada

La función pura `calcularAlertaOms(baseTime, baseDilatacion, currentTime, currentDilatacion)` implementa el modelo OMS 1994:

```
si dilatacion_actual  < 4   → "normal" (fase latente)
si dilatacion_base   < 4   → "normal" (no hay base de fase activa todavía)

horas_transcurridas = (current - base) / 1h
dilatacion_esperada_alerta = base + horas_transcurridas              -- 1 cm/h
dilatacion_esperada_accion = base + max(0, horas_transcurridas - 4)  -- 4h a la derecha

si dilatacion_actual < dilatacion_esperada_accion  → "zona_accion"
si dilatacion_actual < dilatacion_esperada_alerta  → "zona_alerta"
en otro caso                                       → "normal"
```

Esta función está cubierta por tests unitarios (`partograma.router.test.ts`) y se invoca dentro del procedure `registrar` **antes** del INSERT, persistiendo el resultado en `alerta_oms`. La detección de la "base de fase activa" se hace con un SELECT `WHERE dilatacion_cm >= 4 ORDER BY registrado_en ASC LIMIT 1` — el primer registro que cruzó los 4 cm para ese documento obstétrico.

### Diferencia OMS vs Friedman

El TDR §11.6 menciona "curva de Friedman" como referencia clásica (Emanuel Friedman, 1954). El partograma implementado en HIS Multipaís usa la versión **OMS 1994 simplificada** que aplana las fases de aceleración/desaceleración descritas por Friedman a una única pendiente lineal de 1 cm/h en la fase activa. La OMS 2018 emitió guías que cuestionan incluso la rigidez de la curva de alerta para nulíparas, sugiriendo que progresiones más lentas (0.5 cm/h) pueden ser fisiológicas. **El HIS sigue OMS 1994 por compatibilidad con la práctica clínica salvadoreña actual** y porque la NTEC referencia esa curva indirectamente vía protocolos MINSAL.

### Relación con SALA_EXP y ATN_RN

El partograma **precede temporalmente** al período expulsivo. Cuando la dilatación llega a 10 cm y comienza el pujo, la atención se centra en `ece.sala_expulsion`. El partograma queda en estado `vigente`/`firmado` y sus últimos registros son la "memoria inmediata" del nacimiento. Al ocurrir el nacimiento:

- `ece.sala_expulsion.nacimiento_ts` registra el instante exacto.
- Se crea `ece.atencion_recien_nacido` (ATN_RN) con `paciente_madre_id` = paciente actual y `paciente_rn_id` = paciente nuevo creado atómicamente.
- El partograma **no se modifica** post-nacimiento; el cierre formal ocurre con `cerrarPartograma({ motivoCierre: 'parto_vaginal' | 'cesarea' })`.

Si el partograma cruza la **zona_accion** y se decide cesárea, la cabecera obstétrica se cierra con `motivoCierre: 'cesarea'`. La cesárea se documenta en `ACTO_QX` y la atención del RN sigue el mismo flujo ATN_RN.

### Integración con motor workflow ECE

El tipo de documento `PARTOGRAMA` está registrado en `ece.tipo_documento` con `depende_de = ARRAY['HOJA_ING']` y `inmutable = false` (porque la cabecera admite transiciones). El motor de workflow:

- Bloquea la creación de un `ece.documentos_obstetricos` (que contiene partograma) hasta que exista `HOJA_ING` firmada para ese episodio.
- Permite registros seriados en `partograma_registro` mientras la cabecera esté en `borrador` o `vigente`.
- Sella la cabecera al `firmado` y de ahí en adelante rechaza writes (gap HF-08 — no implementado completamente).

### Integración con notificaciones Beta.15

Cuando `alerta_oms = 'zona_alerta'`:
- Notificación in-app al ginecólogo asignado al episodio + a la jefatura de obstetricia.
- Refresco del dashboard `/ece/obstetricia` (que debería listar las salas con bandera amarilla).

Cuando `alerta_oms = 'zona_accion'`:
- Notificación urgente (SMS / push) al ginecólogo de guardia + jefe de servicio.
- Bandera roja en el dashboard.
- Sugerencia automática de checklist de cesárea segura (TDR §13.3).

Hoy el dashboard mockea estas alertas (HF-01, HF-03). La cadena completa estará operativa cuando se cablee `eceObstetriciaRouter` con consumo del outbox `ece.partograma.alerta`.

### Hardening pendiente

Antes de habilitar el partograma para go-live en producción:

1. **HF-06** — envolver el router en `withWorkflowContext` para que la RLS aplique con rol `authenticated` demotado.
2. **HF-14** — corregir `usuario_id` → `his_user_id` en el SELECT a `ece.personal_salud`.
3. **HF-08** — guarda de inmutabilidad en `cerrarPartograma` (`WHERE estado_registro NOT IN ('firmado', 'anulado')`).
4. **HF-15** — agregar trigger `02_audit_triggers.sql` para `ece.partograma_registro` con hash chain.
5. **HF-07** — añadir `| null` al tipo TS de `alerta_oms` y fallback `?? "normal"` en el router.
6. **HF-05** — migrar la resolución de `docId` a `useSearchParams()` + procedure `eceDocumentosObstetricos.getByEpisodio` para resolver desde el `episodioId` de la ruta.

---

**Referencias cruzadas**:

- ADR: `docs/audit/2026-05-19_audit_stream_f_obstetricia_neonatal.md` — ADR-F-01 (migración previa go-live), ADR-F-02 (verifyPin unificado), ADR-F-03 (`withWorkflowContext` en todos los routers obstétricos).
- Audit: `docs/audit/2026-05-19_audit_stream_f_obstetricia_neonatal.md` (Módulo 2 — Partograma OMS, HF-05 a HF-09 + HF-14, HF-15).
- Insumo: `docs/backlog/fase2/_insumos/analisis_workflows_ece.md` §3.14 — Documentos Obstétricos.
- Schema: `packages/database/sql/71_partograma_dilatacion.sql` (tabla + RLS Cat-E), `packages/database/prisma/schema.prisma:5637-5649` (`EcePartogramaRegistro`).
- Router: `packages/trpc/src/routers/ece/partograma.router.ts` (procedures `list`, `get`, `registrar`, `cerrarPartograma`, `detectarAlertasOMS`).
- UI: `apps/web/src/app/(clinical)/ece/obstetricia/partograma/[episodioId]/page.tsx` (vista per-episodio); `apps/web/src/app/(clinical)/ece/obstetricia/page.tsx` (dashboard madre, mockeado).
- TDR: §11.6 (Sala de Partos / Materno-infantil) — "Partograma electrónico con curva de Friedman"; §6.3 (audit hash chain); §9 (Manchester precede a obstetricia en emergencias obstétricas).
- Norma: MINSAL Acuerdo n.° 1616 (2024), Doc 14 Obstétrico §3.14; Arts. 39 (firma simple), 40 (inmutabilidad post-firma), 42 (rectificación), 55-56 (metadatos).
- Estándar internacional: **OMS Managing Complications in Pregnancy and Childbirth — Partograph (1994)**; OMS Recommendations Intrapartum Care (2018) — actualización metodológica no adoptada aún.
