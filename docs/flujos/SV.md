# SV — Hoja de Signos Vitales

## Metadata
- **codigo**: `SIG_VIT` (código siembra `ece.tipo_documento`; este archivo abrevia como **SV** por convención del backlog Fase 2, pero el catálogo NTEC usa `SIG_VIT`).
- **nombre**: Hoja de Signos Vitales / Control de Constantes Vitales
- **modalidad**: TODAS — sembrado como `ambos` en `ece.tipo_documento.modalidad` (`packages/database/sql/63_ece_08_seed.sql:42-43`). Operativamente: monitoreo continuo en HOSPITALIZACION (UCI, hospitalización general, post-anestésica), tomas pautadas en EMERGENCIA (al menos una inicial obligatoria + repetición según gravedad), y tomas puntuales en AMBULATORIO (preconsulta).
- **NTEC artículo**: §3.3 NTEC (Hoja de Signos Vitales / Control de Constantes Vitales) — Acuerdo n.° 1616 MINSAL (30/05/2024, D.O. T.444 N°158). Metadatos obligatorios Art. 55 (timestamp nivel segundo); rectificación trazable Art. 42; firma electrónica simple Art. 23 lit. a.4 cuando se cierra hoja diaria. Cross-referencias TDR: §9.2 (signos vitales obligatorios en triage), §11.3 (monitorización en indicaciones médicas), §11.4 (evolución diaria de enfermería con frecuencia parametrizable).
- **modulo_his_target**: HIS legacy expone tres tablas operacionales en `public`: `InpatientVitals` (hospitalización — `packages/database/prisma/schema.prisma:2316`), `TriageVitalSign` (triage Manchester — `:1627`) y `TriageFlowchartVitalSign` (signos obligatorios por flujograma — `:1572`). NTEC añade `EceSignosVitales` (`:4924`) en schema `ece`. Ruta UI esperada: **extender** módulo legacy de monitoreo bedside (hospitalización) y triage (emergencia) — **NO** crear ruta paralela `/ece/signos-vitales` (regla del CLAUDE.md "adecuar legacy vs duplicar"). Bridge HIS↔ECE responsable de sincronizar capturas vía `bridge-triage.router.ts` (analogía: ya en producción para triage).
- **tabla_datos**: NTEC: `ece.signos_vitales` (Prisma `EceSignosVitales`, DDL `packages/database/sql/61_ece_06_documentos.sql:65-89`). HIS legacy: `public."InpatientVitals"` (hospitalización) + `public."TriageVitalSign"` (emergencia triage). Cada toma es una fila independiente (serie temporal por `episodioId, fechaHoraToma DESC`).
- **inmutable**: **cada toma es inmutable** post-firma. Workflow seed (`63_ece_08_seed.sql:212-214`) permite `borrador → firmado → validado` pero el router tRPC (`packages/trpc/src/routers/ece/signos-vitales.router.ts:413-419`) rechaza `UPDATE` con `BAD_REQUEST` cuando `estado_registro != 'borrador'`. La inmutabilidad vive en JS (no hay trigger Postgres dedicado todavía — drift conocido SV-005). La cadena de auditoría se garantiza por SHA-256 del payload en `ece.documento_instancia_historial.payload_hash` (análogo a Art. 55 hash-chain TDR §6.3).
- **tipo_registro**: **OBLIGATORIO según frecuencia indicada en `IND_MED`** (Hoja de Indicaciones Médicas, campo `monitorizacion.signos_vitales.frecuencia`). En hospitalización la frecuencia típica va de `q4h` (rutina) a `q15min` (post-quirúrgico inmediato / shock); en UCI puede ser continua con captura horaria. En emergencia: al menos **una toma inicial obligatoria** previa a la clasificación de triage (TDR §9.2 paso 2). En ambulatorio: una toma de preconsulta por consulta.

## Propósito normativo

La Hoja de Signos Vitales es el **registro objetivo y seriado del estado fisiológico del paciente** y constituye el sustento de las decisiones de triage, la vigilancia clínica intra-hospitalaria, el disparo de alertas tempranas (Early Warning Scores — NEWS, qSOFA, PEWS) y la trazabilidad médico-legal de respuesta ante deterioro. La NTEC §3.3 la cataloga como documento **transaccional de alta frecuencia** (series temporales por episodio), con metadatos obligatorios al segundo (Art. 55) y validación fisiológica por curso de vida.

Su característica diferencial respecto a otros documentos clínicos es la **alta cadencia** (múltiples tomas por turno) y la **acumulación temporal**: no se "cierra" como un documento único sino que cada toma genera una fila inmutable, y la "Hoja Consolidada" diaria firmada por el médico es una vista derivada del conjunto de tomas del turno/día. La frecuencia no es fija: la define la **Hoja de Indicaciones Médicas** (`IND_MED`) según condición clínica, lo que convierte a SV en un documento parametrizable a nivel paciente y momento.

Habilita además dos flujos críticos downstream:

1. **Disparo de alertas EWS (Beta.15)** — cuando una toma cae fuera de rangos críticos (SpO₂ <90, PA <90/60 ó >180/110, FC <40 ó >130, FR <8 ó >30, T >39.5 ó <35, Glasgow ≤8) se emite `DomainEvent` con `eventType="vital.critical"` y el poller envía notificación al médico tratante (`InpatientAdmission.attendingId`). Ver `docs/blueprints/beta15_notifications.md:96-115`.
2. **Re-triage automático** (TDR §9.3) — si en emergencia los signos vitales del paciente en espera empeoran respecto al triage inicial, se dispara re-evaluación. La regla cruza `TriageVitalSign` con `TriageDiscriminator` por flujograma.

## Dependencias (depende_de)

Sembrado en `ece.tipo_documento.depende_de` para `SIG_VIT` (`63_ece_08_seed.sql:43`):

- **`FICHA_ID`** (Ficha de Identificación) — raíz del expediente, Art. 15 NTEC. Sin Ficha no se puede tomar signos vitales contra un episodio activo.

Dependencias funcionales no codificadas en `depende_de` pero esperadas:

- **`EPISODIO_ATENCION`** (entidad técnica, no `tipo_documento`) — `ece.signos_vitales.episodio_id NOT NULL`. Cada toma debe ligarse a un episodio activo de hospitalización, emergencia o ambulatorio.
- **`HOJA_ING` o `ATN_EMERG`** (lógica de contexto) — los signos vitales tomados durante hospitalización pertenecen al episodio iniciado por Hoja de Ingreso; en emergencia, al iniciado por Hoja de Atención de Emergencia (que a su vez depende de TRIAJE).
- **`IND_MED`** (frecuencia paramétrica) — la frecuencia de toma de signos vitales se define en las Indicaciones Médicas (TDR §11.3 — `Monitorización: signos vitales con frecuencia`). Sin `IND_MED` vigente con frecuencia indicada, las tomas se hacen contra protocolo institucional por defecto (q4h en sala general, q1h en UCI, según política del establecimiento).

Nota: `TRIAJE` depende de `SIG_VIT` (no al revés) — el seed (`63_ece_08_seed.sql:46`) declara que la Hoja de Triaje requiere SIG_VIT previo. Por eso la **primera toma en emergencia es obligatoria** antes de la clasificación Manchester.

## Obligatoriedad por modalidad / contexto

| Modalidad | Obligatoriedad | Justificación |
|---|---|---|
| HOSPITALIZACION general | **SI** según frecuencia `IND_MED` | TDR §11.3 — monitorización es indicación médica obligatoria; mínimo institucional típico q4h. |
| HOSPITALIZACION UCI / UCIN / UCIP / UCO | **SI** continua + captura horaria mínima | TDR §11.5 — cuidados críticos con escalas APACHE II/SOFA/NEWS basadas en signos vitales. |
| Post-anestésica (URPA) | **SI** q15min hasta criterios de egreso | TDR §13.x — monitoreo postanestésico hasta criterios Aldrete cumplidos. |
| EMERGENCIA — pre-triage | **SI inicial obligatoria** (mínimo TA, FC, FR, SpO₂, T, Glasgow, EVA) | TDR §9.2 paso 2 — signos vitales previos a flujograma Manchester. Sin SV no puede emitirse TRIAJE. |
| EMERGENCIA — observación | **SI** según prioridad Manchester | Rojo: continua; Naranja: q15min; Amarillo: q1h; Verde: q2h; Azul: única (revisión al alta). Tiempos parametrizables por organización (TDR §9.1). |
| AMBULATORIO consulta externa primera vez | **SI** (puntual en preconsulta) | TDR §3.3 análisis workflows — preconsulta de enfermería incluye toma de signos vitales. |
| AMBULATORIO consulta externa subsecuente | **CONDICIONAL** | Toma puntual si lo amerita la especialidad/motivo; en controles rutinarios (ej. control rápido de receta) puede omitirse. |
| AMBULATORIO control rápido (renovación de receta, validación de incapacidad) | **NO obligatorio** | Sin valor clínico añadido; reduce carga de enfermería en flujo de baja complejidad. |
| Hospital de Día (quimioterapia, hemodiálisis, transfusiones) | **SI** pre, intra y post | TDR §10.5 + §22 (transfusiones requieren `vitalSigns` JSON `{pre, intra, post}` — `Transfusion.vitalSigns` en `schema.prisma:3792`). |
| Pediatría / Neonatología | **SI** con rangos por edad | TDR §9.5 — variantes pediátricas con cálculos automáticos de rangos normales por edad; perímetro cefálico hasta los 2 años. Captura `escalaDolor` con escalas FLACC / Wong-Baker en lugar de EVA numérica. |

## Roles firmantes / actores

Seed en `ece.documento_rol` (`63_ece_08_seed.sql:338-342`):

| Rol | Acción | Momento | Obligatorio |
|---|---|---|---|
| ENF (Enfermería) | LLENA cada toma | En el momento de la medición | **SI** (`obligatorio=true`) |
| ENF (Enfermería) | RESPONSABLE de la veracidad | Por cada toma | **SI** |
| ENF (Enfermería) | FIRMA electrónica simple | Al cerrar hoja consolidada (turno/día) | **SI** |
| ENF (Enfermería) | AUTORIZA validación (supervisor/jefe de turno) | Validación inter-pares al cierre de turno | **SI** |
| MC / MT (Médico) | LECTURA + revisión clínica + firma de hoja consolidada diaria | Pase de visita diario en hospitalización | NO modelado como `documento_rol` separado — la firma médica de la consolidada vive en la Nota de Evolución (`NEV`) que referencia las tomas. PENDIENTE — validar con @AE/@PO si la consolidada diaria requiere firma médica explícita o sólo lectura. |

Procedures tRPC actuales (`signos-vitales.router.ts:45-51`):

- `list`, `get` → `requireRole(["NURSE","PHYSICIAN"])` — ambos pueden leer.
- `create`, `update`, `firmar`, `validar` → `requireRole(["NURSE"])` — solo enfermería escribe/firma/valida.
- PHYSICIAN intentando firmar → `403 FORBIDDEN` (cubierto por test E2E mencionado en el doc-comment del router).

Notas operativas:

- En triage la captura puede ser hecha por **TEC** (auxiliar de enfermería) en pre-evaluación, pero la firma queda en ENF responsable del turno.
- En UCI con monitor automatizado, las tomas pueden insertarse vía integración HL7/MLLP (`vital.critical` event source = `respiratory` por `RespiratoryOrder` — ver `beta15_notifications.md:549`), pero la **firma humana** sigue siendo obligatoria al cierre de turno (la captura automática no sustituye la verificación de enfermería).

## Campos obligatorios por toma

Mapeo a columnas de `ece.signos_vitales` (DDL `61_ece_06_documentos.sql:65-89`, Prisma `EceSignosVitales:4924`):

- `id` — UUID PK, generado por BD.
- `instancia_id` — UUID FK a `ece.documento_instancia` (vínculo al motor workflow; se crea automáticamente al firmar la toma — `signos-vitales.router.ts:170-195`).
- `episodio_id` — UUID NOT NULL, FK a `ece.episodio_atencion`. **Obligatorio**.
- `fecha_hora_toma` — TIMESTAMPTZ NOT NULL DEFAULT `now()`, precisión segundo (Art. 55 NTEC). Es la **clave de la serie temporal**.
- `presion_sistolica` — SMALLINT, CHECK `BETWEEN 40 AND 300` (mmHg).
- `presion_diastolica` — SMALLINT, CHECK `BETWEEN 20 AND 200` (mmHg).
- `frecuencia_cardiaca` — SMALLINT, CHECK `BETWEEN 20 AND 300` (latidos/min). Zod del contrato más estricto: `30-220` (`signos-vitales.schemas.ts:25`).
- `frecuencia_respiratoria` — SMALLINT, CHECK `BETWEEN 4 AND 60` (resp/min).
- `temperatura` — NUMERIC(4,1), CHECK `BETWEEN 30.0 AND 45.0` (°C). Zod: `30-43`.
- `saturacion_o2` — SMALLINT, CHECK `BETWEEN 50 AND 100` (%).
- `escala_dolor` — SMALLINT, CHECK `BETWEEN 0 AND 10` (EVA 0-10). PENDIENTE — para pediátricos sustituir por FLACC/Wong-Baker (campo `data` JSONB).
- `peso_kg` — NUMERIC(6,2), CHECK `> 0`. Zod: `0.5-300`.
- `talla_cm` — NUMERIC(5,1), CHECK `> 0`. Zod: `30-250`.
- `imc` — NUMERIC(5,2). **Calculado por capa de aplicación** (`signos-vitales.router.ts:107-111`: `peso / (talla/100)²`, redondeo 1 decimal). Guardado para auditoría.
- `perimetro_cefalico_cm` — NUMERIC(5,1). Obligatorio en pediatría <2 años (TDR §9.5).
- `glucometria_mgdl` — NUMERIC(5,1). Obligatorio en triage según TDR §9.2 paso 2.
- `data` — JSONB. Campo extensión para Glasgow desglosado, FLACC pediátrico, PEWS componentes, observaciones breves, fuente (manual/monitor), número de serie de monitor (trazabilidad equipo).
- `registrado_por` — UUID NOT NULL, FK a `ece.personal_salud` (ENF que tomó la medición — metadato obligatorio Art. 55).
- `registrado_en` — TIMESTAMPTZ NOT NULL DEFAULT `now()`, distinto de `fecha_hora_toma` (este último es la hora real de la medición, el primero es la hora del registro en sistema — pueden diferir en captura retroactiva).
- `estado_registro` — TEXT DEFAULT `'vigente'`, CHECK `IN ('vigente','rectificado')`. Workflow real gestionado en `ece.documento_instancia.estado_actual_id`. Drift conocido entre esta columna y el motor — ver SV-004.
- `digitado_retroactivamente` — BOOLEAN DEFAULT false (F2-S15 Stream A contingencia §6). Marca tomas registradas a posteriori desde papel.
- `timestamp_real_papel` — TIMESTAMPTZ. La hora real de la toma cuando se digitó retroactivamente desde respaldo en papel.
- `contingencia_evento_id` — UUID FK al evento de contingencia que originó la captura en papel.

Campos derivados/recomendados (no en BD, en `data` JSONB o calculados):

- Glasgow Coma Scale (GCS) — total 3-15, con desglose `eye`/`verbal`/`motor`. Obligatorio en trauma, postquirúrgico inmediato, alteración de conciencia.
- News2 / qSOFA / PEWS — calculables a partir de los signos primarios; no se persiste el cálculo (se recomputa al leer).
- Observaciones breves — texto libre <200 caracteres.

## Estados (flujo_estado)

Sembrados por el bloque DO de `63_ece_08_seed.sql` para todo `tipo_documento` no inmutable:

- `borrador` (inicial) → `en_revision` → `firmado` → `validado` (final) → `anulado` (final alternativo)

Estado terminal por defecto: **`validado`**.

Particularidad de SIG_VIT:

- Por la alta cadencia, **cada toma es una instancia de workflow independiente**. No existe la noción de "una hoja con muchas tomas firmadas en bloque" — cada fila de `ece.signos_vitales` se firma individualmente.
- La "Hoja Consolidada del turno/día" es una **vista derivada** del conjunto de tomas filtradas por `episodio_id, fecha_hora_toma BETWEEN turno_inicio AND turno_fin`. No tiene tipo de documento separado.
- `inmutable=false` en seed pero efectivamente inmutable post-firma: la bitácora `documento_instancia_historial` es siempre append-only (trigger `trg_historial_inmutable` en `60_ece_05_motor.sql`).

## Transiciones (flujo_transicion)

Seed en `63_ece_08_seed.sql:211-214` + anulación universal:

| origen | destino | acción | rol | requiere firma | condición funcional |
|---|---|---|---|---|---|
| borrador | en_revision | `enviar_revision` | ENF | NO | Captura mínima completa: `episodio_id` + al menos un signo vital primario (TA, FC, FR, T, SpO₂). |
| en_revision | firmado | `firmar` | ENF | **SI** | Firma electrónica simple ENF validada vía PIN. |
| firmado | validado | `validar` | ENF | NO | Validación inter-pares por supervisora de turno o jefe de enfermería (auto-validación de la misma ENF permitida en seed actual; PENDIENTE — endurecer a `validador_id != firmante_id`). |
| cualquiera | anulado | `anular` | NURSE/PHYSICIAN | **SI** | Corrección de toma con error sustancial (ej. paciente equivocado, monitor descalibrado, valor implausible). Causa documentada obligatoria. |

Transiciones bloqueadas (no sembradas — no se permiten):

- `firmado → en_revision` — rollback post-firma prohibido; el camino correcto es **anular** la toma y crear una nueva en `borrador` (rectificación trazable, Art. 42 NTEC).
- `validado → borrador / en_revision / firmado` — estado terminal.

## Eventos de dominio

Convención: `ece.sig_vit.<accion>`. Payload obligatorio incluye `organization_id`, `establishment_id`, `paciente_id`, `episodio_id`, `instancia_id`, `actor_id`, `timestamp`.

Eventos previstos del flujo NTEC (PENDIENTE — el router actual `signos-vitales.router.ts:25-29` declara explícitamente que **no emite eventos de dominio** para evitar carga de la outbox por la alta cadencia; los consumidores leen directo de la tabla):

- `ece.sig_vit.creado` — payload: `{ instancia_id, paciente_id, episodio_id, fecha_hora_toma, autor_id, valores_resumen }`.
- `ece.sig_vit.firmado` — payload: `{ instancia_id, firma_id, hash_payload, firmante_id, firmado_en }` (Art. 23 + Art. 55 NTEC).
- `ece.sig_vit.validado` — payload: `{ instancia_id, validador_id, timestamp }`.
- `ece.sig_vit.anulado` — payload: `{ instancia_id, motivo, autor_id, timestamp }`.

Eventos críticos del flujo operativo (Beta.15 — sí emitidos hoy desde `InpatientVitals` legacy):

- `vital.critical` (alerta EWS) — emitido por el router de `InpatientVitals` cuando algún signo cae fuera de rango crítico. Payload (`beta15_notifications.md:190-200`): `{ admissionId, patientId, vitalsId, threshold: { parameter: "SPO2"|"HR"|"BP_SYS"|"TEMP"|"GCS"|"PAIN"|"RR"|"ETCO2", value, severity: "critical" }, recordedAt }`. Disparador downstream: poller de notificaciones envía email/SMS al `InpatientAdmission.attendingId`.
- `vital.retriage_required` — disparado en emergencia si los signos vitales del paciente en sala de espera divergen del umbral configurado respecto a la toma inicial del triage (TDR §9.3 — re-triage automático). PENDIENTE — no implementado todavía; ver issue de backlog Fase 2 §11.

Reglas (rangos críticos por defecto adultos — parametrizables por organización en `Beta.15`):

- Tensión arterial: sistólica <90 ó >180; diastólica <60 ó >110.
- Frecuencia cardiaca: <40 ó >130 lpm.
- Frecuencia respiratoria: <8 ó >30 rpm.
- Temperatura: <35.0 ó >39.5 °C.
- Saturación O₂: <90 %.
- Glasgow: ≤8 (intubación / inconsciencia).
- Escala de dolor EVA: ≥7 (intervención obligatoria).

Para pediátricos los rangos varían por edad (TDR §9.5) y deben sembrarse como tabla de referencia por organización.

## Drift conocido (audit) y riesgos

Hallazgos identificables de la auditoría general (`docs/audit/2026-05-19_*.md`) y revisión del router al 2026-05-22:

- **SV-001 [P1 — ALTO]** Duplicación operativa de tablas: `InpatientVitals` (legacy) y `EceSignosVitales` (NTEC) coexisten. Bridge HIS↔ECE para signos vitales **no existe** — sólo hay bridges para triage, encounter y patient (PR #93). Riesgo: tomas registradas vía `inpatient.vitals.record` no se replican a `ece.signos_vitales` y por tanto no quedan ligadas al motor workflow ni a la firma electrónica NTEC. Decisión pendiente: ¿extender el módulo legacy de bedside para escribir simultáneamente en ambas tablas (bridge), o migrar la captura íntegra a `ece.*`?
- **SV-002 [P1 — ALTO]** El router tRPC ECE **no emite eventos de dominio** (`signos-vitales.router.ts:25-29`). Es decisión consciente por costo de cadencia, pero deja sin disparar las alertas Beta.15 cuando la captura entra por la ruta ECE (sólo dispara desde `InpatientVitals` legacy). Hay que añadir emisión condicional de `vital.critical` también desde el router NTEC al firmar.
- **SV-003 [P2 — MEDIO]** Auto-validación permitida: el seed permite que la misma ENF firme y valide la toma. NTEC sugiere validación inter-pares por supervisora. Endurecer a `validador_id != firmante_id` y exigir rol jerárquico.
- **SV-004 [P2 — MEDIO]** Doble fuente de verdad para estado: `ece.signos_vitales.estado_registro` (TEXT `'vigente'|'rectificado'`) versus `ece.documento_instancia.estado_actual_id` (motor workflow). Consolidar en una sola.
- **SV-005 [P2 — MEDIO]** Inmutabilidad post-firma vive en JS (`signos-vitales.router.ts:413-419`), no en trigger Postgres. Inserto directo vía `service_role` o consola SQL puede modificar tomas firmadas. La auditoría hash-chain detectaría el cambio pero no lo previene. Añadir trigger `BEFORE UPDATE` que rechace si `estado_registro != 'borrador'`.
- **SV-006 [P3 — BAJO]** Pediatría: escala de dolor numérica EVA hardcoded en columna; FLACC/Wong-Baker dependen de `data` JSONB sin esquema validado. Definir contrato JSON por edad.
- **SV-007 [P3 — BAJO]** Captura desde monitor automatizado no marca origen `source`. Si el monitor introduce ruido (ej. SpO₂ caída artefactual por movimiento), no hay forma de filtrar mediciones "automáticas" vs "verificadas manualmente". Añadir `source` enum (`MANUAL_HUMAN`, `MONITOR_AUTO`, `MONITOR_VALIDATED`) al `data` JSONB.

Schema drift Prisma vs SQL:

- DDL `61_ece_06_documentos.sql:65-89` define `peso_kg`, `talla_cm`, `perimetro_cefalico_cm` con sufijo de unidad. Prisma `EceSignosVitales` los mapea como `peso`, `talla`, `perimetroCefalico` (sin sufijo). Verificar antes de cambios — la documentación de columnas tiene precedencia para SQL hand-rolled.
- `EceSignosVitales.pacienteId` (Prisma) no aparece en el DDL original — fue añadido en migración posterior. Confirmar contra Supabase remoto antes de generar tipos.

## Descripción markdown rica (para BD `descripcion_markdown`)

> **Hoja de Signos Vitales** — Registro objetivo y seriado del estado fisiológico del paciente (TA, FC, FR, T, SpO₂, EVA, peso/talla cuando aplica, glicemia capilar, Glasgow en alteraciones de conciencia). Cada toma es una fila inmutable con timestamp al segundo y firma electrónica simple de enfermería; el conjunto de tomas del turno/día conforma la "Hoja Consolidada" que el médico revisa en pase de visita.
>
> **Cuándo se usa:** hospitalización (frecuencia según `IND_MED` — q4h general, q1h-q15min UCI/post-quirúrgico, continua en cuidados críticos), emergencia (al menos una inicial obligatoria antes del triage Manchester y repetición según prioridad), ambulatorio primera vez (preconsulta), hospital de día (pre/intra/post para quimio, hemodiálisis, transfusión). En pediatría con rangos por edad + perímetro cefálico hasta 2 años + escalas de dolor FLACC/Wong-Baker.
>
> **Qué NO es:** no es la Hoja de Indicaciones Médicas (`IND_MED` — esa define la frecuencia de toma); no es la Hoja de Triaje (`TRIAJE` — esa usa los signos para clasificar Manchester pero no los registra); no es nota de evolución de enfermería (`REG_ENF` — esa narra plan de cuidados, no signos cuantitativos).
>
> **Énfasis operativos:**
> - **Registros inmutables** post-firma (cadena temporal SHA-256 en `documento_instancia_historial`). Si se detecta error en una toma firmada, **no se edita** — se anula con causa documentada y se crea una nueva toma con valor corregido (rectificación trazable Art. 42 NTEC).
> - **Alertas EWS automáticas** — valores fuera de rango crítico disparan evento `vital.critical` que el poller de Beta.15 entrega por email/SMS al médico tratante (`attendingId`). Tiempo de entrega objetivo <2 min desde captura.
> - **Frecuencia parametrizada por `IND_MED`** — la cadencia no es global del paciente sino indicada por el médico tratante y puede cambiar varias veces al día (ej. q4h → q1h tras un evento adverso). La interfaz de enfermería debe leer la frecuencia vigente al momento del turno.
> - **Primera toma en emergencia obligatoria** — sin SV no puede emitirse `TRIAJE`. Esto está sembrado como dependencia dura: `ece.tipo_documento.depende_de = ['SIG_VIT']` para `TRIAJE` (`63_ece_08_seed.sql:46`).
> - **Pediátricos con rangos distintos** — neonato, lactante menor, lactante mayor, preescolar, escolar, adolescente. El sistema debe calcular rangos normales por edad y aplicar las escalas correspondientes (FLACC <3 años, Wong-Baker 3-7 años, EVA ≥8 años — TDR §9.5).
> - **Captura desde monitor** (UCI, URPA) puede llegar vía integración HL7/MLLP; aun así la firma humana de la ENF al cierre de turno es obligatoria (Art. 23 lit. a.4 NTEC).
>
> **Ejemplos típicos:**
> - Paciente post-cesárea: q15min × 2 horas (URPA) → q1h × 6 horas (sala) → q4h × resto de internamiento (`IND_MED`).
> - Paciente UCI sepsis: continua con captura horaria + qSOFA recalculado cada toma + alertas SpO₂<92 y PA media <65 disparan acción inmediata.
> - Paciente emergencia dolor torácico: inicial pre-triage (TA, FC, FR, T, SpO₂, ECG obligatorio por flujograma — `TriageFlowchartVitalSign`), si Manchester=Rojo → continua hasta evaluación médica.
> - Paciente ambulatorio control hipertensión: una toma de preconsulta (TA en brazo dominante con 5 min de reposo previo); peso/talla anual.
>
> **Errores comunes:**
> - Olvidar marcar `digitadoRetroactivamente=true` cuando la toma se ingresa horas después desde papel (rompe la cadena temporal real → falsea cronología clínica).
> - Capturar SpO₂ baja por artefacto de movimiento sin re-medir → dispara alerta crítica innecesaria y satura el canal de notificaciones (riesgo de fatiga de alarma).
> - Editar una toma firmada en lugar de anular + crear nueva (rompe inmutabilidad — Art. 42 NTEC).
> - No tomar la inicial en emergencia y proceder al triage Manchester con valores estimados o copiados de la triage anterior.
> - En pediatría aplicar rangos adultos a un lactante (lo que es "normal" en niño puede ser "alarmante" interpretado contra rangos adultos y al revés).
