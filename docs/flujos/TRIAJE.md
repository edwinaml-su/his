# TRIAJE — Hoja de Triage Manchester

## Metadata
- **codigo**: TRIAJE
- **nombre**: Hoja de Triage / Clasificación de Emergencia (Manchester Triage System)
- **modalidad**: EMERGENCIA
- **NTEC artículo**: Acuerdo n.º 1616-2024, Doc 4 — Hoja de Triaje / Clasificación de Emergencia (NTEC §3.4 del análisis de workflows ECE). TDR §9 — Módulo de Triage de Manchester.
- **modulo_his_target**: `/triage` (legacy con Manchester implementado — **NO duplicar como `/ece/triaje`**)
- **tabla_datos**: `public."TriageEvaluation"` + `public."TriageVitalSign"` + `public."TriageDiscriminatorHit"` (HIS) **+** `ece.hoja_triaje` (bridge vía `eceBridgeTriage.router`)
- **inmutable**: `true` post-firma (`estado_registro = 'firmado'` en `ece.hoja_triaje` se vuelve inmutable; cambios subsecuentes vía rectificación NTEC, no UPDATE directo)
- **tipo_registro**: **TRANSACCIONAL** en NTEC (no Histórico). RECOMENDADO en EMERGENCIA cuando hay flujo formal de selección; CONDICIONAL al volumen y al protocolo institucional.

## Propósito normativo
Manchester Triage System (MTS) es el estándar internacional de clasificación de urgencias adoptado por el TDR §9 como modelo principal del HIS Multipaís. La Hoja de Triage cumple dos funciones legales y operativas inseparables:

1. **Prioriza la atención por gravedad clínica** asignando uno de los 5 niveles MTS (Rojo / Naranja / Amarillo / Verde / Azul) a partir del primer discriminador positivo evaluado en el flujograma de presentación correspondiente (52 flujogramas estándar parametrizables + variantes pediátricas).
2. **Es evidencia médico-legal** del tiempo de espera y del nivel asignado: ante una queja por demora, retiro sin atención (LWBS) o desenlace adverso, la Hoja de Triage establece el momento exacto de la clasificación, el discriminador disparado, el responsable y el tiempo máximo de espera comprometido.

La categorización determina además la asignación de cubículo / sala (resucitación, observación, consulta rápida) y dispara los cronómetros que alimentan las alertas Beta.15 cuando el tiempo máximo de espera se aproxima al umbral configurado.

## Dependencias
- **Ninguna obligatoria del HIS clínico previa.** Se ejecuta al ingreso a Emergencia ANTES de la Hoja de Atención de Emergencia (ATN_EMERG).
- **Identificación mínima del paciente** — registro rápido (nombre / sexo / edad estimada si no se conoce); recuperación inmediata desde MPI si ya está registrado.
- **Signos vitales iniciales** se toman dentro del propio triaje (no son un módulo previo independiente — comparten transacción con la evaluación Manchester).

## Obligatoriedad
- **EMERGENCIA con flujo formal de triage**: SI — Hoja obligatoria.
- **EMERGENCIA con flujo directo a consultorio** (instituciones sin etapa de selección): NO — se omite y se pasa directo a ATN_EMERG.
- **Ambulatorio / Hospitalización electiva**: NO aplica.

## Roles firmantes
| Rol | Acción | Momento |
|---|---|---|
| **ENFERMERIA_TRIAGE** (`NURSE` rol HIS) | Asigna categoría Manchester, registra signos vitales y discriminador positivo. Firma electrónica simple → `estado_registro = 'firmado'` en `ece.hoja_triaje`. | Ingreso del paciente a Emergencia. |
| **MEDICO_TRIAGE** (`PHYSICIAN`, opcional) | Re-categoriza si hay discrepancia clínica con la asignación de ENF; sobreescritura con justificación obligatoria (`overrideJustification` en `TriageEvaluation`). | Validación inmediata o ante alerta de re-triage. |
| **MT — Médico de Turno** (validador) | Validación posterior tipo workflow (`FIRMADO_ENF → VALIDADO_MT`) gestionada por `workflow-instance.router` con código `HOJA_TRIAJE_ECE`. NO es firma simultánea; es un paso de avance de estado posterior. | Tras firma ENF, dentro de la atención del paciente. |

> El bridge `eceBridgeTriage` solo establece el estado inicial `borrador` o `firmado` (ENF). La validación MT vive en el motor de workflow ECE (`workflow-instance.router`).

## Campos obligatorios
Persistencia HIS — `public."TriageEvaluation"`:
- `patientId`, `encounterId`, `establishmentId`, `flowchartId`
- `assignedLevelId` (nivel resultante 1–5)
- `systemSuggestedLevelId` (lo que el sistema sugirió por discriminador positivo)
- `overrideJustification` (texto, obligatorio si `assignedLevelId ≠ systemSuggestedLevelId`)
- `status` (`IN_PROGRESS` / `COMPLETED` / `RE_TRIAGED` / `CANCELLED`)
- `startedAt`, `completedAt`, `triagistUserId`
- `reTriageOfId` (FK al triaje original si es re-triage)

Persistencia ECE — `ece.hoja_triaje` (vía bridge):
- `episodio_id` (FK obligatorio a `ece.episodio_atencion`)
- `fecha_hora_clasificacion`
- `motivo_consulta` (texto narrativo breve)
- `nivel_prioridad` ∈ {`I`, `II`, `III`, `IV`, `V`} — etiquetado ECE (Manchester 1→I, 2→II, ..., 5→V; ver `MANCHESTER_TO_ECE_NIVEL`)
- `destino_asignado` (cubículo / sala asignada: resucitación, observación adultos, observación pediátrica, consulta rápida, sala de espera con re-triage, etc. — texto libre parametrizado por institución)
- `signos_vitales_id` (FK a `ece.signos_vitales` del mismo episodio)
- `evaluacion_triaje` (JSONB — discriminador positivo, vía aérea, respiración, circulación, déficit neurológico, exposición; permite variabilidad clínica entre flujogramas)
- `registrado_por` (FK a `ece.personal_salud` — ENF)
- `estado_registro` ∈ {`borrador`, `firmado`, `rectificado`, `anulado`}

Signos vitales mínimos exigidos por TDR §9.2 (capturados en `TriageVitalSign` + alertas server-side en `triage.router`):
- **FC** (`HR`), **FR** (`RR`), **SpO₂** (`SPO2`), **Temperatura** (`TEMP`), **PA sistólica/diastólica** (`BP_SYS`/`BP_DIA`).
- **Glasgow** (`GCS`) si aplica al flujograma (trauma craneal, alteración de conciencia).
- **Escala de dolor** (`PAIN`) y **glicemia capilar** (`GLUC`) según `TriageFlowchartVitalSign.required`.

Adicionales operativos:
- `discriminador_manchester` (código del primer positivo, ej. `dolor_toracico_irradiado`) → registrado en `TriageDiscriminatorHit` con `positive=true`.
- `tiempo_espera_estimado_min` derivado de `TriageLevel.maxWaitMinutes` (parametrizable por organización para alinear con normativa MINSAL local).

## Estados
```
EN_CURSO (IN_PROGRESS)  →  CATEGORIZADO  →  FIRMADO  →  [VALIDADO_MT]  →  [RE_TRIAGED]
                                                          (workflow ECE)
```

Mapeo HIS ↔ ECE:
- HIS `TriageStatus`: `IN_PROGRESS` → `COMPLETED` → (opcional) `RE_TRIAGED` / `CANCELLED`.
- ECE `estado_registro`: `borrador` → `firmado` → (opcional) `rectificado` / `anulado`.
- Workflow ECE: `FIRMADO_ENF → VALIDADO_MT` (gestionado fuera del bridge, en `workflow-instance.router`).

## Transiciones
| origen | destino | rol | condición |
|---|---|---|---|
| (nuevo) | `EN_CURSO` (IN_PROGRESS) | ENFERMERIA_TRIAGE | Apertura de la evaluación al ingreso. Crea `TriageEvaluation` con `flowchartId` seleccionado. |
| `EN_CURSO` | `CATEGORIZADO` (COMPLETED) | ENFERMERIA_TRIAGE | Se registra el primer discriminador positivo + signos vitales mínimos del flujograma. `assignedLevelId` queda fijado; si difiere de `systemSuggestedLevelId` exige `overrideJustification`. |
| `CATEGORIZADO` | `FIRMADO` (`ece.hoja_triaje.estado_registro = 'firmado'`) | ENFERMERIA_TRIAGE | `eceBridgeTriage.createEceFromTriage` con `firmarInmediatamente=true` y rol NURSE; emite outbox `ece.triaje.linkedToHisTriage`. |
| `CATEGORIZADO` / `FIRMADO` | `RE_TRIAGED` | ENFERMERIA_TRIAGE / MEDICO_TRIAGE | Re-evaluación por cambio en signos vitales, evento clínico o vencimiento del umbral configurado. Crea NUEVO `TriageEvaluation` con `reTriageOfId` apuntando al original; el original conserva su estado. |
| `EN_CURSO` / `CATEGORIZADO` | `CANCELLED` | ENFERMERIA_TRIAGE / MEDICO_TRIAGE | Paciente se retira sin completar evaluación (LWBS) o errores de captura. |
| `FIRMADO` | `VALIDADO_MT` | MT (Médico de Turno) | Workflow ECE `HOJA_TRIAJE_ECE` — fuera del scope del bridge, en `workflow-instance.router`. |
| `FIRMADO` | `RECTIFICADO` | ENFERMERIA_TRIAGE + MT | Solicitud formal de rectificación NTEC (no UPDATE directo). Procedimiento administrativo documentado. |

## Eventos
Outbox emitido vía `emitDomainEvent` dentro de transacción Prisma (patrón Beta.15):

- **`triaje.iniciado`** — payload: `{ triageEvalId, encounterId, patientId, flowchartId, organizationId, startedAt, triagistUserId }`. Disparado al crear `TriageEvaluation` con `status=IN_PROGRESS`.
- **`triaje.categorizado`** — payload: `{ triageEvalId, patientId, assignedLevelId, manchesterLevel (1-5), color, slaMinutes (= maxWaitMinutes), discriminatorCode, vitalAlerts[], overrideJustification? }`. Disparado al pasar a `COMPLETED`. Alimenta Beta.15 para el cronómetro de SLA.
- **`triaje.firmado`** — payload: `{ triageEvalId, eceTriajeId, nivelPrioridad ('I'-'V'), enfermeroId, firmadoEn }`. Equivalente al evento `ece.triaje.linkedToHisTriage` actualmente emitido por el bridge (ver §"Drift conocido").
- **`triaje.re_categorizado`** — payload: `{ originalTriageEvalId, newTriageEvalId, previousLevel, newLevel, reason, triggeredByUserId }`. Disparado al crear un re-triage (`reTriageOfId != null`).

Suscriptores típicos:
- Beta.15 alerting (canales por categoría — rojo dispara WhatsApp/SMS al jefe de turno; naranja dispara dashboard pulsante).
- Cronómetro de SLA (atención dentro del `maxWaitMinutes` del nivel asignado).
- BI / indicadores: tiempo puerta-triaje, tiempo triaje-evaluación, distribución porcentual, LWBS, reingresos 72h.

## SLA por categoría (Manchester)
| Categoría | Prioridad | Nivel ECE | SLA atención (TDR §9.1) | Parametrizable |
|---|---|---|---|---|
| **ROJO** | 1 | I | **Inmediato** (0 min) | Sí (por organización para alinear con MINSAL local) |
| **NARANJA** | 2 | II | ≤ **10 min** | Sí |
| **AMARILLO** | 3 | III | ≤ **60 min** | Sí |
| **VERDE** | 4 | IV | ≤ **120 min** | Sí |
| **AZUL** | 5 | V | ≤ **240 min** | Sí |

El `maxWaitMinutes` se persiste por organización en `TriageLevel` (no es hard-coded). Cada categorización activa cronómetro y dispara alertas Beta.15 cuando se alcanza el umbral configurado (típicamente 80% del SLA).

## Drift conocido
- **PR #101 eliminó `/ece/triaje` duplicado** — fue creado erróneamente en F2-S2 como ruta paralela cuando `/triage` legacy ya tenía Manchester completo (52 flujogramas, discriminadores, signos vitales, alertas server-side). El refactor consolidó el dominio en el módulo legacy y agregó el bridge `eceBridgeTriage` para sincronizar HIS → `ece.hoja_triaje`. Confirmado por redirect 301 permanente en `apps/web/next.config.mjs` (`/ece/triaje → /triage` y `/ece/triaje/:path* → /triage`). Caso testigo de la regla "Adecuar legacy, NO duplicar" del CLAUDE.md.
- **Evento outbox `ece.triaje.linkedToHisTriage`** — el bridge actual emite este evento (no los cuatro canónicos `triaje.iniciado/categorizado/firmado/re_categorizado` listados arriba). El catálogo canónico Beta.15 (`packages/contracts/src/events/catalog.ts`) aún no expone los eventos triaje.* y este documento describe el contrato target. La unificación bridge → catálogo Beta.15 es deuda técnica conocida.
- **`ece.hoja_triaje` no tiene FK directa a `public."TriageEvaluation"`** — vínculo persistido como JSONB (`data->>'hisTriageEvalId'`). Decisión deliberada para flexibilidad ante cambios de schema HIS sin migración ECE. La query inversa usa el operador `@>` o extracción por campo.
- **Sub-router `triajeEceRouter`** (`packages/trpc/src/routers/ece/triaje-ece.router.ts`) existe en paralelo al bridge para escenarios donde el triaje se origina en ECE (contingencia papel, digitación retroactiva). Coexistencia legítima — no duplica el dominio, cubre el caso "ECE-only".
- **`assigned_level_priority` en el JOIN del bridge** asume que `TriageLevel.priority` mantiene 1–5 estable. Cualquier renumeración rompería el mapeo `MANCHESTER_TO_ECE_NIVEL` — bloqueado por restricciones de catálogo (`@@unique [organizationId, priority]`).

## Descripción markdown rica

### Manchester como estándar internacional
El sistema implementa MTS por mandato del TDR §9 — no es opcional. La parametrización por organización (`TriageLevel.maxWaitMinutes`, `TriageFlowchart` activos, discriminadores y signos vitales obligatorios) permite alinear con normativas locales (MINSAL puede ajustar tiempos máximos respecto al estándar Manchester original) sin perder la trazabilidad del estándar internacional. Los 52 flujogramas estándar de Manchester están parametrizados desde el seed (`seed-manchester.ts`) con posibilidad de añadir flujogramas locales por la administración clínica. Las variantes pediátricas (TEP, FLACC, Wong-Baker, signos vitales normales por edad) se manejan vía `TriageFlowchart.isPediatric=true`.

### Bridge HIS ↔ ECE
Arquitectura de bridge en lugar de duplicación de datos:

- **HIS** (`public.TriageEvaluation` + tablas asociadas) es el sistema de registro operativo en tiempo real: cola de pacientes, dashboard de triage, captura de signos vitales con alertas, selección guiada de flujograma y discriminador.
- **ECE** (`ece.hoja_triaje`) es el documento formal exigido por NTEC para el expediente clínico electrónico, con firma electrónica simple y estados de workflow NTEC.
- **`eceBridgeTriage.router`** crea / vincula la fila ECE a partir del registro HIS sin duplicar datos clínicos. La fila ECE referencia el `TriageEvaluation` HIS vía `data->>'hisTriageEvalId'`, y los signos vitales se referencian via `ece.signos_vitales.id`.
- **`syncCompletedTriages`** es un job manual de backfill: encuentra `TriageEvaluation` COMPLETED sin contraparte ECE y crea las filas faltantes en estado `borrador` para revisión posterior por enfermería.

### SLA y alertas Beta.15
El cronómetro arranca con `triaje.categorizado` (no con `triaje.iniciado` — la espera médica empieza cuando la categoría está asignada y el paciente está enrutado). El evento lleva `slaMinutes` ya resuelto del catálogo `TriageLevel` activo en la organización. Beta.15 (`packages/infrastructure/src/notifications/`) consume el outbox y dispara:

- Notificación inicial al equipo médico al llegar al **80% del SLA** (warning visual en dashboard, opcionalmente email).
- Escalada al **100% del SLA** (alerta al jefe de turno, canal severity=critical para rojo/naranja).
- Re-triage automático si los signos vitales se deterioran (regla configurable en `TriageFlowchartVitalSign` + reglas server-side en `triage.router.computeServerAlerts`).

### Regla "Adecuar legacy, NO duplicar"
**NO crear `apps/web/src/app/(clinical)/ece/triaje/`** ni `(admin)/ece/triaje/`. Cualquier requerimiento NTEC adicional (formulario de rectificación, validación MT, vista de cumplimiento) se inyecta en `/triage` y persiste vía bridge en `ece.hoja_triaje`. Cualquier PR que proponga ruta paralela debe ser rechazado o retrabajado para consolidar en el módulo legacy.

Diff legacy vs NTEC ya consolidado en PR #101:
- Legacy `/triage` cubre: captura, categorización, signos vitales, alertas, re-triage, dashboard. Faltaba: persistencia ECE formal, firma ENF inmutable, estado de workflow NTEC.
- Inyección NTEC: bridge `eceBridgeTriage` (PR #93), firma electrónica vía estado `firmado`, workflow `HOJA_TRIAJE_ECE` para validación MT, redirect 301 desde la ruta duplicada eliminada.

### Sidebar
Un solo item del sidebar para este dominio: **"Triage"** apuntando a `/triage`. Los documentos NTEC formales no aparecen como item separado del sidebar — son una capa de persistencia y workflow encima del módulo legacy.

### Cumplimiento normativo
- **NTEC Acuerdo n.º 1616-2024 Art. 44** — firma electrónica simple del personal de salud (ENF) ejecutada vía `estado_registro = 'firmado'` con auditoría hash-chain en `audit.audit_log` (TDR §6.3).
- **TDR §9.4** — indicadores operativos (puerta-triage, triage-evaluación, distribución %, LWBS, reingresos 72h) calculables sobre `TriageEvaluation` + `Encounter` sin joins fuera del esquema HIS principal.
- **Retención** — 10 años por la cadena de auditoría (audit hash chain inmutable). La rectificación NTEC genera nueva versión en `estado_registro = 'rectificado'`; el registro original NO se borra (Art. 19 NTEC ordenamiento cronológico ascendente).
