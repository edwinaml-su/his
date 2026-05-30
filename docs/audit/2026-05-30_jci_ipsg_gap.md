# Auditoría JCI — IPSG 1-6 Gap Analysis

> **@AE — Arquitecto Empresarial — Inversiones Avante**
> Fecha: 2026-05-30 | Edición JCI: 7th (2021)
> Alcance: cobertura de software HIS frente a IPSG. No sustituye auditoría JCI formal.
> Evidencia verificada contra rama `fix/rbac-listroles-for-other-org` (HEAD da3104a).

---

## IPSG.1 — Identify Patients Correctly

**Requerimiento JCI**: Toda organización debe usar al menos dos identificadores únicos del paciente (no incluye número de cama) en todos los puntos de cuidado: administración de medicamentos, transfusiones, toma de muestras, procedimientos y entrega de neonatos.

**Cobertura HIS actual**: Implementación GS1 GSRN (AI 8018) como identificador primario de pulsera más documento legal (DUI/NIE/NIT) con validación de check-digit. BCMA 5-Rights en `MedicationAdministration` verifica GSRN del paciente contra GTIN del medicamento en cada administración. WHO Checklist Sign-In requiere verificación de identidad pre-incisión. Banco de sangre realiza crossmatch con identidad. La cama es atributo del episodio, nunca PK del paciente. Módulo de admisión emite pulsera térmica con código de barras/QR.

**Evidencia**:
- `packages/trpc/src/routers/bedside-hardstops.router.ts` — hard-stop HS-01 PACIENTE_INCORRECTO (líneas 204-211)
- `packages/contracts/src/validators/` — validateDUI, validateNIT, validateNIE con paridad TS/SQL
- `packages/database/sql/143_medication_administration_scan_checks.sql` — constraint GSRN pre-administración
- `docs/22_user_manual_bcma_enfermeria.md` — flujo pulsera GSRN + protocolo pulsera dañada
- `docs/04_modelo_datos.md` — campo `patientWristbandScanned` en `MedicationAdministration`
- `packages/trpc/src/routers/ece/who-checklist.router.ts` — Sign-In con identidad
- `packages/trpc/src/routers/blood-bank.router.ts` — crossmatch + mrn

**Gaps identificados**:
- Toma de muestra lab bedside (SOL_EST) no fuerza re-verificación de 2 identificadores en el punto de extracción; el flujo captura el paciente en la solicitud pero no bloquea la ejecución sin re-escaneo GSRN (US.JCI.5.3 pendiente Sprint S1)
- No existe bloqueo SQL/trigger que impida crear IND_MED en un `Encounter` sin GSRN registrado (US.JCI.5.4 pendiente)
- Validación 2-IDs en transfusión documentada conceptualmente pero sin compliance test automatizado (US.JCI.5.2)

**Prioridad cierre**: P1 — La infraestructura base (GSRN + pulsera + BCMA) está. Los gaps son enforcement en flujos secundarios. Fallo en lab bedside y transfusión puede generar finding menor en survey pero no bloquea IPSG.1 si BCMA med está completo.

**Esfuerzo estimado**: 11 SP (US.JCI.5.2=3 + US.JCI.5.3=5 + US.JCI.5.4=3) — Sprint S1 E-05

---

## IPSG.2 — Improve Effective Communication

**Requerimiento JCI**: Establecer y ejecutar un proceso de comunicación efectiva incluyendo: read-back de órdenes verbales/telefónicas, lista de abreviaciones prohibidas, notificación oportuna de resultados críticos con confirmación de recepción, y estructura de handoff estandarizada (SBAR o equivalente).

**Cobertura HIS actual**: Tabla `ece.verbal_order` (migración 113) implementa el ciclo dictada → registrada → confirmada/rechazada con campo `texto_readback`. Columna `sbar` JSONB en `ece.registro_enfermeria` (migración 115) para handoff inter-turno. Tabla `critical_result_notification` (migración 114) con campo `read_back_at` y SLA <60 min. Evento `critical_result.read_back_confirmed` en catálogo de eventos. Módulo `forbidden-abbreviations.ts` en `@his/contracts` con tests.

**Evidencia**:
- `packages/database/sql/113_verbal_order.sql` — tabla ece.verbal_order con ciclo JCI completo
- `packages/database/sql/114_critical_result_notification.sql` — SLA + read_back_at
- `packages/database/sql/115_sbar_handoff.sql` — columna sbar JSONB en registro_enfermeria
- `packages/contracts/src/schemas/ece-registro-enfermeria.ts` — SbarHandoffSchema
- `packages/contracts/src/clinical/__tests__/forbidden-abbreviations.test.ts`
- `packages/contracts/src/events/catalog.ts` línea 141 — critical_result.read_back_confirmed
- `packages/trpc/src/routers/ece/verbal-order.router.ts`
- `docs/backlog/jci/E-05_ipsg_sprint_plan.md` — US.JCI.5.5-5.8

**Gaps identificados**:
- El router `verbal-order.router.ts` existe pero el ciclo de confirmación del médico (estado `confirmada`) aún no tiene enforcement: no hay bloqueo que impida firmar una IND_MED de origen verbal sin read-back previo confirmado
- El campo `sbar` en REG_ENF es opcional (warning en app, no hard-stop); el surveyor JCI espera completado obligatorio al cierre de turno con paciente activo
- La lista de abreviaciones prohibidas en `forbidden-abbreviations.ts` existe como catálogo pero la validación pre-firma en IND_MED no está cableada al router (compliance test es stub)
- No hay SLA watchdog activo en producción para resultados críticos (poller Beta.15 existe pero la regla de 60 min para `critical_result_notification` no está conectada)

**Prioridad cierre**: P0 — La comunicación verbal no auditada es el gap más frecuente en surveys JCI de hospitales Latino América. El read-back sin enforcement es finding mayor.

**Esfuerzo estimado**: 26 SP (US.JCI.5.5=8 + US.JCI.5.6=5 + US.JCI.5.7=8 + US.JCI.5.8=5) — Sprint S2 E-05

---

## IPSG.3 — Improve the Safety of High-Alert Medications

**Requerimiento JCI**: La organización debe identificar y controlar high-alert medications (HAM), implementar alertas para medicamentos LASA (look-alike/sound-alike), segregar electrolitos concentrados, y requerir doble verificación independiente para insulina, heparina y opioides.

**Cobertura HIS actual**: Migración 116 crea tabla y marca `Drug.alertLevel = 'critical'` para KCl concentrado (B05XA01) y otros HAMs con justificación ISMP. Migración 117 crea catálogo `LasaPair` con 10 pares representativos y marca `alertLevel` en `Drug`. Router `bedside.router.ts` detecta pares LASA al escanear GTIN (pre-tx, solo lectura) y activa `requiresDoubleCheck` para HAMs. `MedicationAdministration` tiene campo `doubleCheckById` con constraint `doubleCheckById != administeredById`. Compliance tests en `packages/trpc/src/compliance/__tests__/` cubren ipsg3-lasa, ipsg3-high-alert e ipsg3-double-check. Workflow inbox emite `DOUBLE_CHECK_PENDING` para HAMs sin segunda verificación.

**Evidencia**:
- `packages/database/sql/116_high_alert_medications.sql` — catálogo HAM con ATC codes
- `packages/database/sql/117_lasa_double_check.sql` — tabla LasaPair (10 pares seed)
- `packages/trpc/src/routers/bedside.router.ts` líneas 382-447 — LASA detection + double-check gate
- `packages/trpc/src/compliance/__tests__/ipsg3-lasa.test.ts`
- `packages/trpc/src/compliance/__tests__/ipsg3-high-alert.test.ts`
- `packages/trpc/src/compliance/__tests__/ipsg3-double-check.test.ts`
- `packages/database/prisma/schema.prisma` línea 2851 — comentario JCI IPSG.3 ME 4
- `packages/contracts/src/schemas/workflow-inbox.ts` — DOUBLE_CHECK_PENDING

**Gaps identificados**:
- La alerta LASA es informativa en BCMA (toast), no bloquea el avance al siguiente paso; JCI ME 2 requiere que el clínico confirme activamente haber leído la alerta
- Dosis máximas pediátricas (mg/kg) no están implementadas — sin verificación por peso/edad (US.JCI.5.12 pendiente)
- Catálogo LASA tiene solo 10 pares seed; la lista ISMP completa tiene >300 pares; carga inicial pendiente pre-Go-Live
- Segregación física de electrolitos concentrados (KCl fuera de stock de planta) no está reflejada en `StorageLocation` — no hay flag de zona restringida en el modelo
- El double-check fuerza `doubleCheckById != administeredById` en schema pero no valida que el segundo verificador tenga rol NURSE/PHARMACIST; un médico podría ser el "segundo verificador"

**Prioridad cierre**: P1 — El double-check existe pero con gaps de enforcement. La alerta LASA informativa (no bloqueante) es el gap más visible para un surveyor. Dosis pediátricas aplica si hay pediatría activa.

**Esfuerzo estimado**: 18 SP (US.JCI.5.9=5 + US.JCI.5.10=5 + US.JCI.5.11=8) Sprint S2 + US.JCI.5.12=5 Sprint S3

---

## IPSG.4 — Ensure Safe Surgery (Universal Protocol)

**Requerimiento JCI**: Implementar el Universal Protocol para la prevención de cirugías en sitio/paciente/procedimiento incorrecto, incluyendo: verificación pre-procedimiento, marcado del sitio quirúrgico, y time-out obligatorio inmediatamente antes de la incisión con todo el equipo presente.

**Cobertura HIS actual**: Stack quirúrgico completo en 7 documentos NTEC en secuencia forzada por motor workflow ECE: PROG_QX → CONS_QX → PREOP_CHECK → WHO_CHECK (3 pausas: Sign-In + Time-Out + Sign-Out) → ACTO_QX → REG_ANEST → URPA. El WHO Checklist tiene ítems: sitio marcado (Sign-In), conteo gasas/instrumental/agujas (Sign-Out), 7+ ítems en Time-Out. Trigger SQL en migración 147 impide insert en `documento_instancia` para ACTO_QX sin WHO_CHECK firmado. El CONS_QX documenta abreviaciones prohibidas en nombre del procedimiento. PREOP_CHECK requiere firma del anestesiólogo.

**Evidencia**:
- `packages/trpc/src/routers/ece/who-checklist.router.ts`
- `packages/trpc/src/routers/ece/preop-checklist.router.ts`
- `packages/trpc/src/routers/ece/acto-quirurgico.router.ts` — `checklist_cirugia_segura` JSONB
- `packages/database/sql/147_who_checklist_rls_insert_check.sql` — trigger enforcement
- `apps/web/e2e/who-checklist.spec.ts` — E2E suite
- `packages/trpc/src/routers/ece/__tests__/who-checklist.test.ts`
- `docs/23_user_manual_consentimiento_quirurgico.md`
- `docs/flujos/WHO_CHECK.md`, `docs/flujos/PREOP.md`, `docs/flujos/ACT_QX.md`

**Gaps identificados**:
- El marcado del sitio (site marking) está como ítem check del Sign-In pero no hay registro fotográfico ni campo estructurado de lateralidad en WHO_CHECK; el surveyor puede solicitar evidencia del proceso físico
- El trigger SQL (147) bloquea ACTO_QX sin WHO firmado, pero no hay bloqueo que impida firmar WHO_CHECK sin los 3 ítems mínimos completados (validación Zod existe en contrato pero no en trigger BD)
- No hay alertas si el equipo quirúrgico cambia entre Sign-In y Time-Out (distinto de lo planeado)

**Prioridad cierre**: P1 — Es el IPSG más maduro. Los gaps son de profundidad, no de ausencia. El enforcement SQL del trigger 147 es sólido. Riesgo de finding menor en site marking documentation.

**Esfuerzo estimado**: 3 SP (US.JCI.5.13=3 enforcement + registro lateralidad en WHO_CHECK) — Sprint S3

---

## IPSG.5 — Reduce the Risk of Health Care-Associated Infections

**Requerimiento JCI**: Cumplimiento de guías de higiene de manos actuales de OMS/CDC; vigilancia activa de IAAS (CLABSI, CAUTI, SSI, VAP); bundles de prevención; aislamiento por tipo de precaución.

**Cobertura HIS**: Sin módulo de Infection Control. El HIS no rastrea cumplimiento de higiene de manos, no tiene módulo de vigilancia de IAAS, ni bundles de prevención, ni flags de precauciones de aislamiento en `Encounter`. Este IPSG está deliberadamente fuera del alcance actual del software.

**Criterio de descarte**: El TDR HIS está anclado en NTEC/MINSAL SV, no en JCI. El módulo PCI (Prevention and Control of Infections) requeriría una épica dedicada (estimación >200 SP) que no entra en el roadmap actual. Corresponde a épica E-01 del programa JCI de largo plazo.

---

## IPSG.6 — Reduce the Risk of Patient Harm Resulting from Falls

**Requerimiento JCI**: Evaluar riesgo de caída en todos los pacientes con herramienta validada (Morse, Humpty-Dumpty pediátrico), documentar intervenciones por nivel de riesgo, re-evaluar periódicamente, y reportar eventos de caída de forma estructurada.

**Cobertura HIS actual**: Escala Morse (0-125) en `VAL_INI_ENF` (valoración inicial enfermería) con clasificación Low/Medium/High. Componente `FallRiskInterventions` en UI muestra protocolo de intervenciones por nivel. `PatientContextBar` muestra badge de riesgo de caída. Router `fallEventRouter` registra eventos de caída con campos estructurados: categoría (accidental/fisiológica anticipada/fisiológica no anticipada), lesión resultante (5 niveles), Morse previo, notificación JCI para lesiones >= moderada. KPI `tasa_caidas_por_1000_dias_cama` en matview `analytics.kpi_falls_rate_monthly` (migración 122). Workflow inbox emite `MORSE_REEVALUATE` para pacientes con Morse >45 sin re-evaluación en 24h.

**Evidencia**:
- `packages/database/sql/119_fall_event.sql` — tabla ece.fall_event con tipos ENUM JCI
- `packages/database/sql/122_kpi_falls_rate.sql` — matview KPI caídas/1000 días-cama
- `packages/trpc/src/routers/ece/fall-event.router.ts` — record + list con outbox event
- `packages/trpc/src/compliance/__tests__/ipsg6-falls-kpi.test.ts`
- `apps/web/src/components/fall-risk-interventions.tsx` — protocolo por nivel Morse
- `apps/web/src/components/patient-context-bar.tsx` — badge fallRisk
- `packages/trpc/src/routers/workflow-inbox.router.ts` líneas 398-417 — MORSE_REEVALUATE alert
- `apps/web/src/app/(clinical)/ece/fall-event/nuevo/page.tsx` — formulario estructurado

**Gaps identificados**:
- La re-evaluación Morse con SLA no tiene enforcement: el workflow inbox genera alerta pero no bloquea alta ni admite orden nueva si Morse >45 y han pasado >24h sin re-evaluación (US.JCI.5.14)
- El componente `FallRiskInterventions` muestra el protocolo pero no registra cuáles intervenciones se implementaron — no hay trazabilidad de las acciones tomadas (US.JCI.5.15)
- Humpty-Dumpty (escala pediátrica) no está implementada; si el establecimiento atiende pediatría, se requiere escala validada específica
- El campo `notificado_jci` en `fall_event` es booleano sin workflow de notificación activa — depende de llenado manual

**Prioridad cierre**: P1 — Tamizaje y reporte estructurado están. El gap crítico es la re-evaluación periódica sin SLA enforced y la trazabilidad de intervenciones. Para pediatría es P0 si hay servicio activo.

**Esfuerzo estimado**: 18 SP (US.JCI.5.14=5 + US.JCI.5.15=5 + US.JCI.5.16=5 + US.JCI.5.17=3) — Sprint S3

---

## Estado MMU y AOP (Próximos capítulos JCI)

### MMU — Medication Management and Use (~85% cobertura)

El capítulo MMU es el segundo en evaluarse post-IPSG. El HIS cubre los 7 estándares en su mayoría: catálogo Drug con ATC, GS1 inbound (proceso A), cold-chain, IND_MED Art. 36 NTEC, unidosis (proceso C), BCMA 5R. El gap pendiente es el módulo de Adverse Drug Reactions (ADR) tracking estructurado — actualmente los ADRs se registran en texto libre en REG_ENF sin codificación. Estimación: 20-25 SP para cierre completo MMU (ADR formulario + SRS farmacovigilancia reporting).

### AOP — Assessment of Patients (~85% cobertura)

AOP está bien cubierto: triage Manchester, VAL_INI_ENF con Morse/Braden/Gordon/MNA/EVA, NEV evolutivo, SIG_VIT seriados, SOL_EST → LIS/RIS → RES_EST con validación 4-eyes. El único gap relevante es la re-evaluación con SLA enforced (AOP.2) — comparte raíz con IPSG.6. Un segundo gap es AOP.7 funcional sin notificación proactiva al clínico cuando Braden <12 (UPP risk) — solo se muestra en UI, sin alerta activa. Estimación: 10-15 SP para cierre completo AOP.

---

## Matriz de cobertura IPSG

| IPSG | Nombre | Estado | Evidencia principal | Prioridad |
|---|---|---|---|---|
| IPSG.1 | Identificación del paciente | Parcial | bedside-hardstops.router.ts, validators/, 143_scan_checks.sql | P1 |
| IPSG.2 | Comunicación efectiva | Parcial | 113_verbal_order.sql, 114_critical_result.sql, 115_sbar.sql | P0 |
| IPSG.3 | Medicamentos alto riesgo | Parcial | 116_high_alert.sql, 117_lasa.sql, bedside.router.ts | P1 |
| IPSG.4 | Cirugía segura | Cubierto | who-checklist.router.ts, 147_rls_insert_check.sql, E2E suite | P1 |
| IPSG.5 | Higiene de manos / HAI | Falta | — (fuera de scope MVP) | N/A |
| IPSG.6 | Reducción caídas | Parcial | 119_fall_event.sql, 122_kpi_falls.sql, fall-event.router.ts | P1 |

---

## Top 5 hallazgos P0

1. **IPSG.2-H1 — Read-back de órdenes verbales sin enforcement**: La tabla `ece.verbal_order` existe con el ciclo correcto, pero no hay trigger/middleware que bloquee la firma de una IND_MED de origen verbal si el estado del verbal_order no es `confirmada`. Un médico puede dictar una orden que se ejecuta sin confirmación. Ruta de cierre: middleware en `indicaciones-medicas.router.ts` que valida `verbal_order.estado = 'confirmada'` pre-firma.

2. **IPSG.2-H2 — Abreviaciones prohibidas no validadas pre-firma**: El catálogo `forbidden-abbreviations.ts` existe y tiene tests unitarios, pero la validación no está cableada al router de IND_MED ni a CONS_QX. Un nombre de procedimiento con abreviación prohibida (ej. "cCx" por "concentración") puede persistirse. Ruta de cierre: Zod `.superRefine()` en schema IND_MED + compliance test de integración.

3. **IPSG.2-H3 — SBAR handoff es opcional**: La columna `sbar` en `ece.registro_enfermeria` es JSONB nullable con solo un warning en app. El surveyor JCI evalúa que el handoff esté documentado en CADA cambio de turno con paciente activo. Ruta de cierre: trigger BD que rechaza `estado = 'cerrado'` en registro_enfermeria si `sbar IS NULL` y el episodio sigue activo.

4. **IPSG.3-H1 — Alerta LASA informativa, no confirmatoria**: El router bedside detecta pares LASA y devuelve `lasaAlert != null` al cliente, pero el frontend puede ignorarla (es un toast). JCI ME 2 requiere evidencia de que el clínico reconoció la alerta (acknowledgement registrado en BD). Ruta de cierre: campo `lasa_ack_at + lasa_ack_by` en `MedicationAdministration`; null bloquea la persistencia si `lasaAlert` está presente.

5. **IPSG.1-H1 — Toma de muestra lab sin re-verificación 2-IDs**: El flujo SOL_EST captura el paciente en la solicitud, pero la ejecución bedside de la extracción no exige re-escaneo de GSRN. En un survey JCI, el phlebotomist debe demostrar verificación de identidad en el punto de extracción. Ruta de cierre: sub-procedimiento `verifyPatientIdentityBeforeSample` en LIS router con GSRN scan obligatorio.

---

## Plan de cierre estimado

| Sprint | IPSG | US | SP | Duración estimada |
|---|---|---|---|---|
| JCI-1.S1 | IPSG.1 | US.5.1-5.4 | 14 | 2 semanas |
| JCI-1.S2 | IPSG.2, IPSG.3 | US.5.5-5.11 + P0s H1-H3 | 44 | 2 semanas |
| JCI-1.S3 | IPSG.3, IPSG.4, IPSG.6 | US.5.12-5.17 | 31 | 2 semanas |

**SP totales épica E-05**: 89 SP en 6 semanas (3 sprints x 2 semanas).

**Ruta crítica**: Los 3 P0 de IPSG.2 (H1-H3) son el cuello de botella. Dependen de:
- Router `indicaciones-medicas`: central, muchos consumidores — cambio de alto riesgo
- Schema `ece.registro_enfermeria`: trigger BD requiere coordinacion con @DBA para no romper seeds

**Dependencias externas para Go-Live JCI**:
- Carga de lista LASA completa ISMP (>300 pares) — tarea @Data previo al go-live
- Capacitación personal en BCMA, SBAR y verbal order — no es software, pero bloquea la práctica que JCI evalúa
- Pentest externo (ya planificado) — JCI evaluará MOI (seguridad de la información) en paralelo

**Cobertura total estimada post-E-05**: IPSG 5/6 (IPSG.5 explícitamente excluido) con profundidad suficiente para survey formal. IPSG.5 requiere épica dedicada E-01 PCI no planificada en roadmap actual.
