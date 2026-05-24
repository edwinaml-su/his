# URPA — Unidad de Recuperación Post-Anestésica

## Metadata
- **codigo**: URPA
- **nombre**: Hoja de Recuperación Post-Anestésica (PACU — Post-Anesthesia Care Unit)
- **modalidad**: QUIRURGICO (post-evento intra-hospitalario)
- **NTEC artículo**: TDR §13.5 (Recuperación Post-Anestésica) + Acuerdo MINSAL 1616/2024 Art. 17 lit. b (registro asistencial obligatorio del episodio quirúrgico) + Art. 19 (orden cronológico) + Art. 34 (conservación 5 años activo / 10 años pasivo) + Art. 39 (firma electrónica simple ENF + ANESTESIOLOGO) + Art. 55-56 (metadatos obligatorios). El insumo `docs/backlog/fase2/_insumos/analisis_workflows_ece.md` §3.13 lo declara componente del **Acto Quirúrgico** (Doc 14 NTEC) con monitoreo postanestésico, criterios y hora de egreso de recuperación. Documento **transaccional** (no histórico inmutable como REG_ANEST), pero con cierre **inmutable post-firma de alta**.
- **modulo_his_target**: `/ece/urpa` (lista de pacientes activos) + `/ece/urpa/nuevo` (registro de ingreso) — UI ECE-only (no hay equivalente legacy). Sub-flujo del módulo de cirugía (`/ece/cirugia`).
- **tabla_datos**: `ece.urpa_recovery` (cabecera + cierre — modelo Prisma `EceUrpaRecovery` en `packages/database/prisma/schema.prisma:5623-5635`, DDL en `packages/database/sql/70_urpa_recovery.sql`). El JSONB `ece.acto_quirurgico.recuperacion_urpa` queda como **campo legacy de transición** (snapshot histórico congelado dentro del acto quirúrgico al cierre del expediente — no se escribe desde el flujo nuevo).
- **inmutable**: parcial. Estado `activo` admite `registrarSignos` (medicamentos, complicaciones) y `actualizar Aldrete`. Estado `alta_otorgada` es **inmutable** — la firma de alta cierra el registro y dispara el evento de traslado/egreso. Estado `anulado` también es terminal.
- **tipo_registro**: **OBLIGATORIO** post-cirugía con anestesia general o regional (raquídea, epidural, bloqueos). Para sedación leve / MAC depende del protocolo institucional — el motor workflow no lo bloquea pero el dashboard de cumplimiento lo marca como `recomendado` cuando hay REG_ANEST con `tipo=local_sedacion`. Para cirugía sin anestesia (consultorio menor) no aplica.

## Propósito normativo

La Hoja URPA documenta la **vigilancia postoperatoria inmediata** del paciente tras el acto quirúrgico, durante el período de mayor riesgo de complicaciones anestésicas (depresión respiratoria, hipotermia, dolor agudo, sangrado, náuseas/vómitos, alteración del sensorio). Conforme TDR §13.5 + §7.4 del workflow hospitalario (`_insumos/analisis_workflows_ece.md`):

1. **Monitorización continua** de signos vitales y nivel de consciencia hasta cumplir criterios de egreso.
2. **Aplicación seriada del Score de Aldrete modificado** (0-10 puntos) — escala estandarizada internacionalmente para evaluar recuperación anestésica.
3. **Manejo del dolor post-operatorio** según escala visual analógica (EVA 0-10) con titulación de analgesia y antieméticos.
4. **Decisión de destino post-URPA**: alta a piso de hospitalización, traslado a UCI por complicación / criterio quirúrgico, o alta domiciliaria en cirugía ambulatoria.
5. **Trazabilidad criptográfica**: cada transición (ingreso → alta) se enlaza al hash chain del episodio para auditoría inmutable a 10 años (NTEC §6.3 + Art. 55-56).

Como **eslabón intermedio** entre el ACTO_QX y el documento clínico del destino (REG_ENF en hospitalización, EPICRISIS/instrucciones en alta ambulatoria, ingreso a UCI), URPA es **el punto de control final del riesgo anestésico**: ningún paciente con anestesia general o regional puede ser trasladado a piso ni dado de alta sin pasar por una URPA con criterio de alta validado por anestesiólogo.

## Dependencias

| Dependencia | Tipo | Estado requerido | Origen |
|---|---|---|---|
| **ACT_QX** (Acto Quirúrgico — Nota Operatoria) | Hard (bloqueante) | `firmado` por cirujano | NTEC §3.13. Sin nota operatoria cerrada no se puede crear URPA. El router `urpa-recovery.router.ts:188-201` valida que `ece.acto_quirurgico.id` existe y pertenece al establecimiento activo. |
| **REG_ANEST** (Registro Anestésico) | Hard (informativo) | `firmado` o `en_redaccion` | NTEC §3.13. El registro anestésico aporta tipo de anestesia, fármacos administrados, monitoreo transanestésico y eventos intraoperatorios — base para anticipar riesgos en URPA. En la práctica puede estar `en_redaccion` cuando llega el paciente; debe estar `firmado` antes de la firma de alta URPA. |
| **HOJA_ING** (Hoja de Ingreso Hospitalario) | Hard (cadena raíz) | `firmado` o `validado` | Si la cirugía es de paciente hospitalizado, el episodio hospitalario debe estar abierto. Para cirugía ambulatoria no aplica (el episodio se cierra con la salida URPA + instrucciones). |
| **CONS_INF Qx/Anest** | Hard (cascada) | `firmado` (ya validado en ACT_QX) | NTEC §3.13. El consentimiento quirúrgico y anestésico es precondición de ACT_QX; URPA hereda esta validación transitiva. |
| **Cama URPA disponible** | Hard (operacional) | recurso libre | Si la URPA gestiona slots de camas, el motor de capacidad asigna uno al ingreso. Si no hay slot disponible se desencadena escalado (overflow a UCI o demora controlada en sala de operaciones). |

## Obligatoriedad

**SIEMPRE** post-cirugía con anestesia general o regional (raquídea, epidural, bloqueos centrales o periféricos profundos):

- **Cirugía electiva con anestesia general** → URPA obligatoria. Aldrete de ingreso documenta línea base; reevaluación cada 15 min mínimo.
- **Cirugía de urgencia con anestesia general** → URPA obligatoria. Si el paciente sale intubado o inestable → traslado directo a UCI (la URPA puede ser breve o saltarse con justificación firmada por anestesiólogo).
- **Anestesia regional (raquídea/epidural)** → URPA obligatoria hasta recuperación del bloqueo motor y sensitivo (Aldrete con ítem actividad = 2).
- **Anestesia local con sedación / MAC** → URPA **recomendada** (no bloqueante en el motor). Depende del nivel de sedación (Ramsay/RASS) y del protocolo institucional.

**Excluida** explícitamente para:

- Cirugía menor con anestesia local sin sedación (consultorio, suturas, biopsias).
- Procedimientos diagnósticos sin anestesia (endoscopía sin sedación).
- Pacientes ya intubados pre-cirugía que pasan directo de quirófano a UCI (en estos casos la justificación queda en REG_ANEST como `destino_post_qx=UCI_DIRECTO` y se documenta en epicrisis quirúrgica).

## Roles firmantes

| Rol | Acción | Momento | Mecanismo |
|---|---|---|---|
| **ENF / ENFERMERIA_URPA** | Crea registro al ingreso del paciente + Aldrete inicial | Recepción del paciente proveniente de quirófano | `eceUrpaRecovery.create` — `requireRole(["NURSE"])`. Registra `escala_aldrete_ingreso`, `ingreso_urpa_ts`, medicación recibida en quirófano. |
| **ENF / ENFERMERIA_URPA** | Registra signos vitales seriados (q15min) + medicamentos + complicaciones | Durante toda la estancia URPA | `eceUrpaRecovery.registrarSignos` — `requireRole(["NURSE"])`. Acumula entradas en `medicamentos_administrados` JSONB y `complicaciones` TEXT. **Hoy NO firma con PIN** (drift conocido — alineado con drift HD-23 de VAL_INI_ENF/REG_ENF; firma simple por turno). |
| **ENF / ENFERMERIA_URPA** | Calcula Aldrete de alta + propone egreso | Cuando Aldrete ≥9 o complicación que exige escalado | `eceUrpaRecovery.darAlta` — `requireRole(["NURSE"])`. Registra `escala_aldrete_alta`, `criterio_alta`, `alta_urpa_ts`. |
| **ANESTESIOLOGO_RECUPERACION** | **Validación clínica** del alta + decisión de destino | Pre-egreso, antes de movilizar al paciente | TDR §13.5 + §7.4 exigen firma del anestesiólogo. **Drift detectado**: el router actual `urpa-recovery.router.ts:300-377` permite que NURSE ejecute `darAlta` sin doble firma de anestesiólogo. Ver "Drift conocido" HF-URPA-01. |
| **MC / MT** (médico tratante) | Recibe al paciente en piso (continuidad) | Post-alta URPA, destino HOSPITALIZACION_PISO | Suscriptor del evento `ece.urpa.alta_otorgada` — abre IND_MED post-quirúrgicas e instrucciones de cuidado. |

> **Art. 39 NTEC** exige firma electrónica simple identificadora. Para URPA, el cierre debe identificar inequívocamente a **dos roles**: la enfermera que documentó la estancia (turno completo) y el anestesiólogo que autoriza el egreso. La implementación actual solo registra `alta_registrada_por` (un único `personal_id`), lo cual incumple parcialmente el doble-rol normativo. PR de fix sugerido: añadir `validado_por_anestesiologo_id` UUID FK + `validado_por_anestesiologo_ts` TIMESTAMPTZ + verificar rol en `darAlta`.

## Campos obligatorios

Conforme NTEC §13.5 + §3.13 + estructura de `ece.urpa_recovery` (DDL `70_urpa_recovery.sql`):

```
acto_quirurgico_id              uuid FK NOT NULL     → ece.acto_quirurgico(id) ON DELETE RESTRICT
ingreso_urpa_ts                 timestamptz NOT NULL → hora real de recepción del paciente
alta_urpa_ts                    timestamptz NULL     → hora de egreso autorizada
escala_aldrete_ingreso          smallint NOT NULL    → 0-10 (CHECK BETWEEN 0 AND 10)
escala_aldrete_alta             smallint NULL        → 0-10 (requerido cuando alta_urpa_ts NOT NULL)
medicamentos_administrados      jsonb NOT NULL '[]'  → [{ nombre, dosis, via, administrado_en }]
complicaciones                  text NULL            → texto libre con eventos relevantes
criterio_alta                   text NULL            → enum: 'cumple' | 'no_cumple_observacion' | 'trasladar_uci'
registrado_por                  uuid FK NOT NULL     → ece.personal_salud(id) — ENF que abrió URPA
alta_registrada_por             uuid FK NULL         → ece.personal_salud(id) — quien cerró (ENF o ANEST)
estado_registro                 text NOT NULL        → 'activo' | 'alta_otorgada' | 'anulado'
creado_en, actualizado_en       timestamptz          → trazabilidad temporal
```

### Score de Aldrete modificado (5 ítems × 0-2 puntos = 0-10 total)

| Ítem | 0 puntos | 1 punto | 2 puntos |
|---|---|---|---|
| **Actividad motora** | Incapaz de mover extremidades | Mueve 2 extremidades voluntariamente | Mueve 4 extremidades voluntariamente |
| **Respiración** | Apnea / requiere VM | Disnea o respiración superficial | Respira profundo, tose libremente |
| **Circulación** | TA fuera ±50% del basal | TA ±20-50% del basal | TA ±20% del basal |
| **Consciencia** | No responde | Despierta al llamado | Plenamente consciente |
| **Saturación O2** | SpO2 <90% con O2 suplementario | SpO2 ≥90% con O2 suplementario | SpO2 ≥92% aire ambiente |

**Criterio estándar de alta**: Aldrete ≥9 sostenido + sin sangrado activo + dolor controlado (EVA ≤3) + sin náuseas/vómitos activos.

### Campos obligatorios NTEC adicionales (no implementados como columnas — drift)

Conforme §13.5 + §7.4 del workflow, las **mejores prácticas internacionales** exigen los siguientes campos que actualmente solo viven dentro del JSONB `medicamentos_administrados` o `complicaciones`, sin estructura propia:

```
signos_vitales_seriados         array[15min]    PA, FC, FR, SpO2, temperatura cada 15 min mínimo
nivel_conciencia                enum            alerta | somnoliento | estuporoso | inconsciente
dolor_eva                       smallint 0-10   escala visual analógica seriada
analgesia_administrada          array           [{ farmaco, dosis, via, hora }]
antiemeticos_administrados      array           [{ farmaco, dosis, via, hora }]
nauseas_vomitos_ponv            boolean+grado   PONV scale (0-3)
sangrado_drenajes               array           [{ drenaje_id, volumen_ml, hora, caracteristicas }]
accesos_vasculares              array           [{ tipo, sitio, calibre, permeable }]
sonda_vesical_volumen_ml        integer         si aplica
temperatura_central_c           numeric(4,1)    monitoreo hipotermia post-anestésica
fluidoterapia                   array           [{ solucion, volumen_ml, via, hora_inicio, hora_fin }]
destino_post_urpa               enum            HOSPITALIZACION_PISO | UCI | ALTA_DOMICILIO_AMB | TRASLADO_EXTERNO
firma_anestesiologo_validacion  uuid FK         FK a ece.personal_salud — anestesiólogo que autoriza egreso
firma_anestesiologo_ts          timestamptz     hora de validación firmada
```

Ver "Drift conocido" para el detalle de campos hoy ausentes vs. el requerimiento normativo.

## Estados

```
                       ┌──────────────────┐
                       │      activo      │ ◄── eceUrpaRecovery.create (ENF, post-ACT_QX firmado)
                       └────────┬─────────┘
            ┌───────────────────┼───────────────────┐
            │                   │                   │
   registrarSignos        darAlta (cumple)     anular (DIR — excepcional)
   (loop continuo)              │                   │
            │                   ▼                   ▼
            │      ┌──────────────────┐    ┌──────────────────┐
            └─────►│  alta_otorgada   │    │     anulado      │
                   │   (terminal)     │    │   (terminal)     │
                   └──────────────────┘    └──────────────────┘
                          │
                          └─► evento: ece.urpa.alta_otorgada
                              (suscriptores: módulo cama, IND_MED, traslado, alta administrativa)
```

## Transiciones

| origen | destino | rol | condición | acción tRPC |
|---|---|---|---|---|
| (n/a) | `activo` | NURSE | ACT_QX `firmado` + no existe URPA `activo` para mismo `acto_quirurgico_id` (UNIQUE constraint EXCLUDE) + Aldrete ingreso 0-10 | `eceUrpaRecovery.create({ actoQuirurgicoId, escalaAldreteIngreso, medicamentosAdministrados?, complicaciones?, ingresoUrpaTs? })` |
| `activo` | `activo` | NURSE | sin cambio de estado, actualiza datos | `eceUrpaRecovery.registrarSignos({ id, medicamentosAdministrados?, complicaciones? })` |
| `activo` | `alta_otorgada` | NURSE *(drift: debería ser NURSE + ANESTESIOLOGO)* | Aldrete ≥9 ↔ criterio=`cumple`; Aldrete <9 ↔ criterio ∈ {`no_cumple_observacion`, `trasladar_uci`} (validado en Zod y reforzado en router) | `eceUrpaRecovery.darAlta({ id, escalaAldreteAlta, criterioAlta, altaUrpaTs? })` |
| `activo` | `anulado` | DIR | error de registro / paciente movido inadvertidamente | (no implementado aún — `cancel/anular` pendiente; hoy se hace via UPDATE manual en service_role con justificación) |
| `alta_otorgada` | — | — | inmutable | — |
| `anulado` | — | — | terminal | — |

## Eventos

Emitidos al outbox de dominio dentro de la misma transacción de `darAlta`:

| Evento | Disparador | Aggregate | Payload (campos clave) |
|---|---|---|---|
| `urpa.ingreso` *(sintético — no emitido hoy)* | `create()` finaliza con éxito | `UrpaRecovery` | `{ urpaId, actoQuirurgicoId, escalaAldreteIngreso, registradoPor, ingresoUrpaTs }` — **drift**: hoy no se emite, podría ayudar al dashboard de ocupación URPA. |
| `urpa.aldrete_actualizado` *(sintético — no emitido hoy)* | `registrarSignos()` cuando se incluye nuevo Aldrete | `UrpaRecovery` | `{ urpaId, nuevoAldrete, deltaAldrete }` — **drift**: actualmente el modelo solo guarda Aldrete de ingreso y alta, no serie temporal. |
| `urpa.complicacion_postanestesica` *(sintético — no emitido hoy)* | `registrarSignos()` cuando `complicaciones` se llena | `UrpaRecovery` | `{ urpaId, complicacion, severidad }` — **drift**: alerta al equipo de anestesia/UCI sería deseable. |
| **`ece.urpa.alta_otorgada`** *(implementado en `urpa-recovery.router.ts:359-373`)* | `darAlta()` finaliza con éxito | `UrpaRecovery` | `{ urpaId, actoQuirurgicoId, escalaAldreteAlta, criterioAlta, altaOtorgadaEn, registradoPor, organizationId }` |

Suscriptores observados / esperados en el catálogo:

- **Motor workflow ECE** — marca ACT_QX como `episodio quirúrgico cerrado`; libera dependencias post-quirúrgicas (instrucciones de alta, receta, citas de seguimiento, instrucciones de cuidados de herida).
- **Módulo de camas URPA** — libera slot ocupado; recalcula tiempo medio de estancia URPA por procedimiento.
- **Módulo de hospitalización** — si `destino_post_urpa = HOSPITALIZACION_PISO`, dispara apertura de tarea para enfermería de piso (recepción del paciente, continuación de signos vitales, REG_ENF de turno).
- **Módulo UCI** — si `criterio_alta = trasladar_uci`, dispara solicitud de cama UCI con prioridad alta y notificación al intensivista de guardia.
- **Módulo de alta ambulatoria** — si `destino_post_urpa = ALTA_DOMICILIO_AMB`, dispara checklist de criterios de alta domiciliaria (escolta adulta, transporte, comprensión de instrucciones, control de vía oral, deambulación, micción).
- **Audit hash chain** — registra `payload_hash` de la transición `activo → alta_otorgada` en `ece.documento_instancia_historial` (retención 10 años, NTEC §6.3).
- **Dashboard cumplimiento NTEC** — actualiza KPI "% cirugías con URPA documentada", "tiempo medio en URPA por procedimiento", "% altas con Aldrete ≥9".

## Drift conocido

URPA fue construido en Wave Quirófano (Fase 2) sin pasar todavía por un sprint dedicado de auditoría como otros streams. Los hallazgos a continuación son de **lectura directa del código + schema** vs. requerimientos NTEC §13.5 + §7.4 y mejores prácticas PACU internacionales. Se sugiere abrir un Stream F-URPA dedicado.

| ID | Severidad | Descripción | Ruta afectada |
|---|---|---|---|
| **HF-URPA-01** | P0-BLOQUEANTE normativo | `darAlta` solo exige `requireRole(["NURSE"])`. TDR §13.5 + Tabla 2.2 §7.4 exigen **firma de egreso del anestesiólogo**. La enfermera puede dar alta sin doble validación, violando Art. 39 NTEC (firma identificadora del responsable clínico del alta anestésica). | `packages/trpc/src/routers/ece/urpa-recovery.router.ts:300` (`const nurseOnly = requireRole(["NURSE"])`). |
| **HF-URPA-02** | P0-BLOQUEANTE estructural | Schema `ece.urpa_recovery` carece de columnas para **signos vitales seriados q15min** (PA, FC, FR, SpO2, temperatura, nivel consciencia). Los campos hoy se ocultan dentro de `medicamentos_administrados` JSONB o `complicaciones` TEXT, sin estructura ni serialización temporal — impide reportes de calidad, no permite gráficas de tendencia, ni permite alertas automáticas (p. ej. hipotensión sostenida). | `packages/database/sql/70_urpa_recovery.sql:16-73`. |
| **HF-URPA-03** | P0-BLOQUEANTE normativo | No existe campo `destino_post_urpa` ni evento de traslado. La cadena URPA → piso/UCI/ambulatorio se infiere del valor de `criterio_alta`, pero las tres alternativas (`cumple`, `no_cumple_observacion`, `trasladar_uci`) no mapean 1:1 con el destino (un `cumple` puede ser piso o domicilio ambulatorio). Esto rompe la trazabilidad del flujo de cuidado post-anestésico. | `urpa-recovery.router.ts:300-377` + `70_urpa_recovery.sql` (sin columna destino). |
| **HF-URPA-04** | P1-ALTO | No se implementa la firma electrónica con PIN argon2id en `darAlta` (alineado con drift HD-23 ya identificado en Stream D para VAL_INI_ENF/REG_ENF). La firma de cierre URPA es jurídicamente relevante porque autoriza el egreso del paciente del control anestésico. | `urpa-recovery.router.ts:300-377`. |
| **HF-URPA-05** | P1-ALTO | Aldrete se guarda solo en dos puntos (`escala_aldrete_ingreso`, `escala_aldrete_alta`). NTEC §13.5 implica **monitorización hasta criterios de alta**, lo que clínicamente exige Aldrete seriado cada 15 min (mínimo) durante la estancia. Sin serie temporal no se puede demostrar mejoría progresiva ni detectar deterioros transitorios. | `70_urpa_recovery.sql:30-35`. |
| **HF-URPA-06** | P1-ALTO | No hay tabla ni JSONB estructurado para **escala de dolor EVA** ni para PONV (náuseas/vómitos post-operatorios). Estos son los dos drivers principales de prolongación de estancia URPA y deben ser KPIs operativos. | `70_urpa_recovery.sql`. |
| **HF-URPA-07** | P2-MEDIO | El campo `recuperacion_urpa JSONB` en `ece.acto_quirurgico` (`schema.prisma:5266`) **coexiste** con la tabla normalizada `ece.urpa_recovery`. No hay documentación de cuál es la fuente de verdad ni política de sincronización. Riesgo: drift de datos entre JSONB legacy y tabla normalizada. | `packages/database/prisma/schema.prisma:5266` + `5623-5635`. |
| **HF-URPA-08** | P2-MEDIO | El evento `ece.urpa.alta_otorgada` no incluye `destinoPostUrpa` ni `episodioId` en su payload — los suscriptores (módulo hospitalización, módulo alta) tienen que hacer un round-trip extra a la BD para resolver el destino. | `urpa-recovery.router.ts:359-373`. |
| **HF-URPA-09** | P2-MEDIO | No existen los eventos sintéticos `urpa.ingreso`, `urpa.aldrete_actualizado`, `urpa.complicacion_postanestesica` mencionados en el insumo de workflows. Limita observabilidad de tiempo real (dashboards URPA en tiempo real, alertas a anestesia). | `urpa-recovery.router.ts:181-289`. |
| **HF-URPA-10** | P3-BAJO | Falta procedure `anular` para casos excepcionales (error de registro, paciente trasladado por equivocación). Hoy se requiere intervención de service_role con justificación manual. | `urpa-recovery.router.ts` (router completo). |

## Descripción markdown rica

### Por qué URPA es un punto de control distinto a piso de hospitalización

El paciente que sale de quirófano **no es asistencialmente equivalente** al paciente en piso de hospitalización: durante las primeras 1-2 horas tras anestesia general o regional persisten riesgos específicos (depresión respiratoria por opioides residuales, hipotermia, retención urinaria, dolor agudo, sangrado activo no controlado, alteración del sensorio). Por eso URPA es:

1. **Una unidad física separada**, con relación enfermera-paciente más alta (típicamente 1:2 vs. 1:6-1:8 en piso), monitoreo continuo de SpO2, FC, PA, capnografía si necesario, oxigenoterapia disponible, y carro de paro inmediato.
2. **Un episodio temporal corto** (mediana 45-90 min en cirugía ambulatoria; hasta 2-4 h en cirugía mayor), tras el cual la decisión clínica es **trifásica**: egreso a piso, traslado a UCI, alta domiciliaria.
3. **Un punto de doble firma normativa** (NTEC §13.5): la enfermera de URPA documenta la estancia continua y el anestesiólogo autoriza el egreso — la responsabilidad legal del estado anestésico del paciente termina cuando el anestesiólogo firma el alta URPA. Después de eso, la responsabilidad pasa al médico tratante del piso o al médico ambulatorio.

### El Score de Aldrete: estándar internacional y su uso operativo

El **Score de Aldrete modificado** (Aldrete & Kroulik, 1970, revisado en 1995) es el instrumento universalmente aceptado para evaluar la recuperación post-anestésica. Sus características operativas:

- **Reproducible**: cinco ítems con escala discreta 0-2, evaluación rápida (<2 min por aplicación).
- **Sensible al cambio temporal**: una mejora de 6 → 9 puntos en 60 min refleja recuperación esperada; estancarse en <8 puntos a los 90 min sugiere complicación.
- **Criterio internacionalmente aceptado de egreso**: ≥9 puntos sostenidos en dos evaluaciones consecutivas (≥30 min de estabilidad) habilita egreso a piso. Para alta domiciliaria ambulatoria se exige además criterios adicionales (escolta adulta, deambulación, vía oral tolerada, micción espontánea, comprensión de instrucciones).
- **Limitaciones**: no evalúa náuseas/vómitos, dolor ni sangrado — por eso URPA debe complementar Aldrete con EVA dolor, PONV, vigilancia activa de sangrado.

En el modelo de datos actual, Aldrete es **un número entero único** al ingreso y al alta. La práctica clínica real exige **serie temporal cada 15 min** durante la estancia, con un componente narrativo asociado a cada punto de medida (medicación administrada en ese intervalo, complicación observada). Modelar esto correctamente exige una tabla hija `ece.urpa_evaluacion_seriada` con FK a `urpa_recovery_id` y campos para cada ítem Aldrete + signos vitales + dolor EVA — ver drift HF-URPA-02 y HF-URPA-05.

### Hipotermia post-anestésica: una complicación crítica

La **hipotermia post-anestésica** (temperatura central <36 °C) afecta al 30-50 % de los pacientes que reciben anestesia general por más de 60 min, especialmente:

- Cirugías largas (>2 h).
- Pacientes ancianos, niños, con baja masa magra.
- Salas de quirófano por debajo de 21 °C ambiente.
- Sin medidas activas de calentamiento intraoperatorio (mantas térmicas, fluidos calentados).

Consecuencias documentadas: incremento de complicaciones cardiovasculares (vasoconstricción, isquemia), prolongación de tiempo de recuperación, mayor sangrado por coagulopatía inducida por frío, mayor consumo de oxígeno por escalofríos. La URPA debe **medir temperatura central al ingreso**, repetir cada 30 min hasta normotermia, y aplicar medidas de recalentamiento activo (mantas de aire forzado, fluidos IV tibios). El modelo actual **no captura temperatura** como campo estructurado — drift HF-URPA-02.

### Destino post-URPA y la cadena de continuidad asistencial

El campo `destino_post_urpa` (no implementado — drift HF-URPA-03) condiciona el siguiente flujo del expediente y los eventos que se disparan:

```
URPA.alta_otorgada
  │
  ├─ destino = HOSPITALIZACION_PISO
  │    ├─► reactiva REG_ENF de piso (turno entrante asume cuidado)
  │    ├─► dispara IND_MED post-quirúrgicas (analgesia, hidratación, profilaxis, ATB)
  │    ├─► NOTA_EVOL del cirujano describe estado al pasar a piso
  │    └─► módulo de camas confirma cama de piso ya asignada
  │
  ├─ destino = UCI
  │    ├─► criterio_alta = 'trasladar_uci' obligatorio
  │    ├─► dispara solicitud de cama UCI con prioridad alta
  │    ├─► notifica intensivista de guardia (Beta.15 notifications)
  │    ├─► REG_ANEST se anexa al expediente UCI como contexto pre-ingreso
  │    └─► continuidad de monitoreo invasivo (línea arterial, CVP, etc.)
  │
  ├─ destino = ALTA_DOMICILIO_AMB (cirugía ambulatoria)
  │    ├─► checklist de alta domiciliaria adicional (escolta, transporte, criterios PADSS)
  │    ├─► dispara EPICRISIS abreviada / Resumen de alta ambulatoria
  │    ├─► receta de egreso (analgesia oral, antibiótico si aplica)
  │    ├─► instrucciones de cuidado de herida + signos de alarma
  │    └─► cita de seguimiento agendada (control 7-10 días)
  │
  └─ destino = TRASLADO_EXTERNO (excepcional)
       ├─► hoja de referencia (RRI) hacia hospital receptor
       ├─► resumen quirúrgico abreviado
       └─► coordinación logística (ambulancia, contacto receptor)
```

Sin este campo estructurado, la decisión de destino se infiere del estado y del Aldrete, perdiendo trazabilidad explícita.

### Integración con motor de workflow ECE

URPA es un documento `transaccional` (no histórico inmutable como REG_ANEST), pero su cierre dispara estados terminales:

- `ece.tipo_documento` codigo `URPA`, registro `transaccional`, `inmutable=false`.
- Flujo de estados: `activo` (inicial) → `alta_otorgada` (final) | `anulado` (final).
- El workflow no obliga PIN para `darAlta` (drift HF-URPA-04) — la firma electrónica simple por sesión autenticada se considera suficiente operativamente, pero **no normativamente** según Art. 39.

### Relación con el bridge de cirugía

El bridge `eceBridgeCirugia` (`packages/trpc/src/routers/ece/bridge-cirugia.router.ts`) gestiona la **programación** y **cancelación** de cirugías. URPA opera **después** de la cirugía, fuera del scope transaccional del bridge — `eceBridgeCirugia` no crea URPA atómicamente con ACT_QX. La creación de URPA es un acto manual de la enfermera al recibir al paciente.

Una mejora futura podría ser un sub-router `eceBridgeCirugia.cerrarActoQx({ ... })` que en una sola transacción atómica:
1. Marca ACT_QX como `firmado`.
2. Crea URPA con Aldrete inicial 0 (placeholder) y estado `pendiente_ingreso`.
3. Emite `ece.acto_qx.cerrado` para que el sistema notifique a URPA que tiene un paciente entrante.

### Retención (Art. 34-35 NTEC)

URPA forma parte del expediente quirúrgico y por tanto del **expediente hospitalario** del paciente:

- **5 años activo** (acceso operativo on-line).
- **10 años pasivo** (archivado en almacenamiento frío) si el episodio incluye defunción por causa violenta, accidente o en investigación.
- Backup cifrado diario en ubicación distinta del sitio principal (Art. 48).
- El `payload_hash` de la transición `darAlta` se preserva indefinidamente en `audit.audit_log` (hash chain, retención 10 años mínimo por NTEC §6.3).

### Por qué la firma del anestesiólogo es no-negociable

El acto de **autorizar el egreso URPA** es médico-legal y exclusivo del anestesiólogo (o del médico delegado por el servicio de anestesia con autorización institucional formal). La razón es que:

1. **Quien indujo y mantuvo la anestesia es quien debe declararla resuelta**. Cualquier evento post-anestésico inmediato (depresión respiratoria por opioide residual, hipotensión por bloqueo simpático persistente, despertar incompleto) es responsabilidad clínica del anestesiólogo.
2. **La transición a piso o domicilio implica salir del control farmacológico anestésico**. El médico de piso o el paciente en casa no tienen el monitoreo ni la capacidad de rescate inmediato que tenía URPA.
3. **Jurisprudencia**: en demandas por complicaciones post-anestésicas inmediatas, la firma del anestesiólogo en el alta URPA es el documento que delimita la responsabilidad. Sin esa firma, la responsabilidad del anestesiólogo se extiende indefinidamente.

El **drift HF-URPA-01** (permitir que NURSE dé alta sin firma de anestesiólogo) es por tanto un riesgo legal real y debe priorizarse como P0 bloqueante para producción. Implementación propuesta:

```ts
// urpa-recovery.router.ts (propuesta)
darAlta: nurseOnly  // ENF inicia la solicitud de alta
  .input(eceUrpaDarAltaSchema.extend({
    pinAnestesiologo: z.string().regex(/^\d{6,8}$/),
    anestesiologoId: z.string().uuid(),
  }))
  .mutation(async ({ ctx, input }) => {
    // ... validación Aldrete vs criterio
    await verifyPinOrThrow(tx, input.anestesiologoId, input.pinAnestesiologo);
    // ... UPDATE con dos firmas (alta_registrada_por + validado_por_anestesiologo_id)
  })
```

---

**Referencias cruzadas**:

- TDR: §13.5 (URPA), §13.1-13.4 (Cirugía), §13.7 (CEYE), §7.4 workflow (Fase 1 — `_insumos/analisis_workflows_ece.md`).
- Norma: MINSAL Acuerdo n.° 1616 (2024), Arts. 17b (registro asistencial), 19 (orden cronológico), 21 (certificación DIR), 34-35 (retención), 39 (firma electrónica simple), 41c (resumen del expediente), 48 (backups), 55-56 (metadatos).
- Workflow insumo: `docs/backlog/fase2/_insumos/analisis_workflows_ece.md` §3.13 (Documentos del Acto Quirúrgico), §7.4 (Recuperación postanestésica), Tabla 2.2 §7.4 (firmantes).
- Schema: `packages/database/prisma/schema.prisma:5266` (legacy JSONB) + `5623-5635` (modelo normalizado).
- DDL: `packages/database/sql/70_urpa_recovery.sql` (tabla, índices, RLS Cat-E, seed tipo_documento, flujo_estado).
- Router: `packages/trpc/src/routers/ece/urpa-recovery.router.ts` — `list`, `get`, `create`, `registrarSignos`, `darAlta`.
- Tests: `packages/trpc/src/routers/ece/__tests__/urpa-recovery.router.test.ts`.
- UI: `apps/web/src/app/(clinical)/ece/urpa/page.tsx` (lista) + `nuevo/page.tsx` (registro de ingreso).
- Componentes: `apps/web/src/components/urpa/aldrete-badge.tsx` (badge visual Aldrete) + `urpa-countdown.tsx` (tiempo en URPA).
- Bridge relacionado: `packages/trpc/src/routers/ece/bridge-cirugia.router.ts` — programación / cancelación de cirugías (URPA no está en su scope atómico).
- Documentos relacionados (cadena quirúrgica): `docs/flujos/HOJA_ING.md`, eventual `docs/flujos/ACT_QX.md`, eventual `docs/flujos/REG_ANEST.md`, eventual `docs/flujos/CONS_INF_QX.md`.
