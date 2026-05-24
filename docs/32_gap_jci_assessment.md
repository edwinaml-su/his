# 32 — Gap Assessment JCI vs HIS Multipaís Avante

> **Estado**: borrador técnico preliminar (no es auditoría formal JCI).
> **Fecha**: 2026-05-24
> **Edición JCI**: 7th Edition (2021) — la 8th Edition (2024) NO está contemplada aquí; requiere segundo gap análisis.
> **Alcance**: cobertura del software HIS frente a estándares JCI. NO evalúa cumplimiento institucional (procedimientos, capacitación, evidencia de práctica).

---

## Disclaimer importante

1. **Este documento no constituye una auditoría JCI.** Una acreditación formal requiere consultor JCI certificado + visita de evaluadores + evidencia documental + observación de práctica clínica.
2. **El HIS es habilitador, no garante de cumplimiento.** Tener BCMA 5R no significa que la institución cumpla MMU — depende de que el personal LO USE consistentemente. Joint Commission evalúa la práctica, no solo la capacidad técnica.
3. **El TDR del HIS NO declara JCI como meta de cumplimiento.** Está anclado en **NTEC SV (Acuerdo MINSAL 1616/2024)** + ISSS + SNIS. Existe overlap natural (~70-75%) por convergencia internacional de estándares.
4. **Este mapeo es estimación basada en código + documentación al 2026-05-24.** Schemas/triggers BD pueden cambiar; revalidar antes de cualquier presentación a evaluadores.

---

## Resumen ejecutivo

### Cobertura estimada por capítulo JCI

| Capítulo JCI | Cobertura HIS | Estado |
|---|---|---|
| **IPSG** International Patient Safety Goals (6 goals) | 5/6 | ⚠️ Falta IPSG.5 (infecciones/higiene) |
| **ACC** Access to Care and Continuity | ~85% | ✅ |
| **PFR** Patient and Family Rights | ~80% | ✅ |
| **AOP** Assessment of Patients | ~85% | ✅ |
| **COP** Care of Patients | ~80% | ✅ |
| **ASC** Anesthesia and Surgical Care | ~90% | ✅ |
| **MMU** Medication Management and Use | ~85% | ✅ |
| **PFE** Patient and Family Education | ~10% | ❌ |
| **QPS** Quality Improvement and Patient Safety | ~40% | ⚠️ |
| **PCI** Prevention and Control of Infections | ~5% | ❌ |
| **GLD** Governance, Leadership, and Direction | ~60% | ⚠️ |
| **FMS** Facility Management and Safety | N/A | — (no es ámbito software) |
| **SQE** Staff Qualifications and Education | ~35% | ❌ |
| **MOI** Management of Information | ~95% | ✅ |
| **MPE** Medical Professional Education | N/A | — (no aplica si no hay enseñanza) |
| **HRP** Human Subjects Research | N/A | — (no aplica si no hay investigación) |

**Brechas críticas (Go/No-Go para acreditación)**: PCI, PFE, QPS dashboard, SQE registro de credenciales.

---

## Mapeo IPSG (International Patient Safety Goals)

### IPSG.1 — Identify Patients Correctly (2 identificadores)

| Requisito JCI | Cobertura HIS | Evidencia técnica |
|---|---|---|
| 2 identificadores únicos por paciente | ✅ | GSRN (AI 8018) pulsera + DUI/NIE/NIT con check-digit (`packages/contracts/src/validators/`) |
| Validación pre-administración medicamentos | ✅ | BCMA 5R en `MedicationAdministration` (GSRN del paciente + GTIN del medicamento) |
| Validación pre-procedimiento | ✅ | WHO Surgical Safety Checklist Sign-In (verificación de identidad) |
| Validación pre-transfusión | ✅ | Banco de sangre crossmatch + verificación de identidad (`blood-bank.router.ts`) |
| Validación pre-toma muestra lab | ⚠️ | Solicitud de estudio captura paciente pero no exige re-verificación bedside |
| NO usar número de cama como identificador | ✅ | Cama es atributo del episodio, no PK del paciente |

**Estado**: cumplido en infraestructura; depende de adopción operativa.

### IPSG.2 — Improve Effective Communication

| Requisito | Cobertura | Evidencia |
|---|---|---|
| Read-back de órdenes verbales / telefónicas | ❌ | No hay flujo formal de órdenes verbales con read-back |
| Read-back de resultados críticos | ⚠️ | LIS auto-flagging valores fuera de rango (HH-09 P1) sin workflow de read-back |
| Lista estandarizada de abreviaciones prohibidas | ❌ | No implementado |
| Handoff (cambio de turno / transferencia) estructurado | ⚠️ | REG_ENF cierre por turno existe; RRI para transferencia inter-establecimiento; sin SBAR formal |
| Notificación oportuna de resultados críticos a clínico | ⚠️ | Beta.15 EWS alerts + outbox events; sin SLA documentado de notificación |

**Estado**: parcialmente cubierto. Brecha: read-back formal + SBAR + SLA notificación.

### IPSG.3 — Improve the Safety of High-Alert Medications

| Requisito | Cobertura | Evidencia |
|---|---|---|
| Lista de high-alert medications por institución | ⚠️ | `Drug` tiene flag conceptual pero sin lista codificada (`isHighRiskDrug` en `pharmacy.ts`) |
| Look-alike / sound-alike (LASA) — separación física + alertas software | ⚠️ | Sin alerta LASA en UI BCMA |
| Concentrated electrolytes (KCl, NaCl >0.9%) — segregación | ❌ | No hay flujo dedicado |
| Doble verificación independiente (insulina, heparina, opioides) | ❌ | BCMA es single-check, no double-check |
| Dosis máximas + alertas dosis pediátricas | ⚠️ | Sin verificación de dosis máxima por peso/edad |

**Estado**: BCMA 5R cubre lo básico; brecha en double-check, LASA, dosis máximas pediátricas.

### IPSG.4 — Ensure Safe Surgery (Universal Protocol)

| Requisito | Cobertura | Evidencia |
|---|---|---|
| Marking the site (marcado del sitio quirúrgico) | ✅ | WHO Sign-In incluye "sitio marcado" |
| Pre-procedure verification | ✅ | PREOP_CHECK firmado anestesiólogo (`ece.preop_checklist`) |
| Time-out inmediatamente antes de incisión | ✅ | WHO Time-Out con 7+ ítems |
| Sign-out al finalizar (conteo instrumental, muestras) | ✅ | WHO Sign-Out con conteo gasas + muestras |
| Consentimiento informado quirúrgico | ✅ | CONS_QX doble firma paciente+MC+anestesiólogo (Art. 40 NTEC) |

**Estado**: cumplido — stack completo PROG_QX → CONS_QX → PREOP_CHECK → WHO_CHECK → ACTO_QX → REG_ANEST → URPA.

### IPSG.5 — Reduce the Risk of Health Care-Associated Infections (HAI)

| Requisito | Cobertura | Evidencia |
|---|---|---|
| Hand hygiene guidelines (OMS 5 momentos) | ❌ | Sin módulo de tracking/compliance |
| Vigilancia IAAS (CLABSI, CAUTI, SSI, VAP) | ❌ | Sin módulo de surveillance |
| Bundles de prevención (CVC, ventilator, UTI) | ❌ | No implementado |
| Aislamiento por precauciones (contacto/gotitas/aérea) | ⚠️ | Sin flag en `Encounter` ni notificación visible |
| Notificación oportuna de organismos multirresistentes | ❌ | Sin alertas |

**Estado**: ❌ **Brecha crítica**. Requiere módulo dedicado de Infection Control (PCI).

### IPSG.6 — Reduce the Risk of Patient Harm Resulting from Falls

| Requisito | Cobertura | Evidencia |
|---|---|---|
| Tamizaje de riesgo de caída al ingreso | ✅ | Escala Morse en VAL_INI_ENF (0-125) |
| Re-evaluación periódica | ⚠️ | Estructura existe pero sin SLA forzado |
| Intervenciones por nivel de riesgo | ⚠️ | Sin protocolo automatizado en UI |
| Reporte de eventos de caída | ⚠️ | Eventos centinela en REG_ENF (texto libre); sin formulario estructurado |

**Estado**: tamizaje sí; intervenciones + reporte estructurado falta.

---

## Mapeo Patient-Centered Standards

### ACC — Access to Care and Continuity

| Standard | Cobertura | Evidencia |
|---|---|---|
| ACC.1 Screening at admission | ✅ | TRIAJE Manchester (5 niveles), HOJA_ING anamnesis |
| ACC.2 Admission process | ✅ | ORD_ING → admisión → HOJA_ING (bridge atómico) |
| ACC.3 Transfer / discharge planning | ✅ | EPI_EGR, RRI, alta médica formal |
| ACC.4 Care continuity | ✅ | Expediente longitudinal + bitácora acceso |
| ACC.5 Patient transfer to external organization | ✅ | RRI con estado_paciente_al_traslado |
| ACC.6 Discharge summary | ✅ | EPI_EGR con resumen + dx + recomendaciones + medicación |

**Cobertura ~85%** — brecha menor: protocolos formales documentados (no software).

### PFR — Patient and Family Rights

| Standard | Cobertura | Evidencia |
|---|---|---|
| PFR.1 Rights identified and respected | ⚠️ | LOPD consents existe; sin checklist explícito de derechos JCI |
| PFR.2 Patient participates in care decisions | ✅ | CONS_INF con preguntas paciente + respuestas |
| PFR.3 Informed consent process | ✅ | CONS_INF + CONS_QX (Art. 40 doble firma, inmutable post-firma) |
| PFR.4 Privacy and confidentiality | ✅ | RLS multi-tenant + bitácora acceso (Art. 45-52 NTEC) |
| PFR.5 Protection from abuse / neglect | ❌ | Sin módulo de reporte de abuso/sospechas |
| PFR.6 Patient grievance process | ❌ | Sin módulo de quejas estructurado |

**Cobertura ~80%** — brechas: derechos checklist + reporte abuso + grievance.

### AOP — Assessment of Patients

| Standard | Cobertura | Evidencia |
|---|---|---|
| AOP.1 Initial assessment timeframes | ✅ | VAL_INI_ENF ≤24h, ATN_EMERG inmediato |
| AOP.2 Reassessment | ✅ | NEV (evolución), SV seriados, REG_ENF por turno |
| AOP.3 Laboratory services | ✅ | SOL_EST → LIS → RES_EST con 4-eyes validación |
| AOP.4 Imaging / Radiology | ✅ | SOL_EST → RIS → RES_EST |
| AOP.5 Pain assessment | ✅ | EVA 0-10 en SIG_VIT; FLACC/Wong-Baker pediátrico |
| AOP.6 Nutritional assessment | ✅ | MNA en VAL_INI_ENF |
| AOP.7 Functional / falls / UPP risk | ✅ | Morse, Braden, Gordon en VAL_INI_ENF |

**Cobertura ~85%** — brecha: re-evaluación con SLA enforced no completamente automatizada.

### COP — Care of Patients

| Standard | Cobertura | Evidencia |
|---|---|---|
| COP.1 Uniform care | ✅ | Motor workflow ECE asegura misma secuencia obligada por modalidad |
| COP.2 Care planning | ✅ | Plan terapéutico en HOJA_ING + IND_MED diarias |
| COP.3 High-risk patients (resuscitation, blood, restraints) | ⚠️ | NRP sí; banco de sangre sí; restraints no |
| COP.4 Food and nutrition | ⚠️ | Dieta en IND_MED; sin trazabilidad de servicio comida |
| COP.5 End-of-life care | ⚠️ | CERT_DEF estructurado; sin órdenes ANR/DNR formales |
| COP.6 Pain management | ✅ | EVA seriado + analgesia administrada con timestamps |
| COP.7 Care planning for dying patient | ❌ | Sin flujo cuidados paliativos / comfort care |
| COP.8 Organ donation | ❌ | Sin módulo |

**Cobertura ~80%** — brechas: restraints, ANR/DNR, cuidados paliativos, donación de órganos.

### ASC — Anesthesia and Surgical Care

| Standard | Cobertura | Evidencia |
|---|---|---|
| ASC.1 Anesthesia services organized | ✅ | PREOP_CHECK con ASA, vía aérea, premedicación |
| ASC.2 Pre-anesthesia assessment | ✅ | PREOP_CHECK firma anestesiólogo |
| ASC.3 Anesthesia plan documented | ✅ | Plan en PREOP_CHECK + ejecución en REG_ANEST |
| ASC.4 Anesthesia monitoring | ✅ | REG_ANEST con SV cada 5 min, capnografía obligatoria GA |
| ASC.5 Post-anesthesia recovery | ✅ | URPA con Aldrete + validación anestesiólogo |
| ASC.6 Surgical care planning | ✅ | PROG_QX con equipo + sala + insumos |
| ASC.7 Surgical safety verification | ✅ | WHO Checklist 3 pausas |

**Cobertura ~90%** — el módulo quirúrgico es el más maduro del HIS frente a JCI.

### MMU — Medication Management and Use

| Standard | Cobertura | Evidencia |
|---|---|---|
| MMU.1 Medication management organized | ✅ | Catálogo `Drug` + farmacia con dispensación FEFO |
| MMU.2 Selection and procurement | ✅ | GS1 inbound (proceso A) con 5 correctos muelle |
| MMU.3 Storage (cold chain, controlados) | ✅ | Cold-chain monitoring + temp tracking |
| MMU.4 Prescribing | ✅ | IND_MED con principio activo + dosis + vía + frecuencia + duración (Art. 36) |
| MMU.5 Preparation and dispensing | ✅ | Unidosis (proceso C) + dispensación con verificación |
| MMU.6 Administration (BCMA 5R) | ✅ | BCMA con GSRN+GTIN+lote+vencimiento + excipientes alergénicos |
| MMU.7 Monitoring effects / ADRs | ⚠️ | Farmacovigilancia sí; sin tracking sistemático de ADRs |

**Cobertura ~85%** — brecha: ADR tracking estructurado + lista LASA/high-alert codificada.

### PFE — Patient and Family Education

| Standard | Cobertura | Evidencia |
|---|---|---|
| PFE.1 Education needs assessment | ❌ | No implementado |
| PFE.2 Education provided and documented | ❌ | No implementado |
| PFE.3 Education verified (teach-back) | ❌ | No implementado |

**Cobertura ~10%** (solo capacidad de adjuntar PDFs vía `DOC_ASOC`). ❌ **Brecha crítica**.

---

## Mapeo Health Care Organization Standards

### QPS — Quality Improvement and Patient Safety

| Standard | Cobertura | Evidencia |
|---|---|---|
| QPS.1 QI program structure | ⚠️ | Sin dashboard QPS centralizado |
| QPS.2 Data collection (indicators) | ⚠️ | Datos clínicos sí; sin pipeline a indicadores QPS |
| QPS.3 Analysis (statistical, trending) | ❌ | Sin BI dashboard JCI-aligned |
| QPS.4 Implementation of improvements | ❌ | Sin tracking de PDSA cycles |
| QPS.5 Sentinel events reporting + RCA | ⚠️ | Eventos centinela capturados en REG_ENF/outbox; sin RCA formal |
| QPS.6 Adverse events / near misses | ⚠️ | Beta.15 alertas; sin formulario de reporte |
| QPS.7 Patient safety culture survey | ❌ | No implementado |

**Cobertura ~40%** — datos están capturados, falta la capa de **gestión de calidad** (BI + RCA + PDSA).

### PCI — Prevention and Control of Infections

| Standard | Cobertura | Evidencia |
|---|---|---|
| PCI.1-11 (programa, surveillance, bundles, isolation, etc.) | ❌ | Sin módulo de Infection Control |

**Cobertura ~5%** (solo el campo `aislamiento` en bedside-ronda router, sin workflow). ❌ **Brecha crítica**.

### GLD — Governance, Leadership, and Direction

| Standard | Cobertura | Evidencia |
|---|---|---|
| GLD.1-6 Governance | ⚠️ | Estructura `institucion → establecimiento` existe; sin políticas digitalizadas |
| GLD.7 Risk management framework | ⚠️ | Audit hash chain + bitácora sí; sin risk register |
| GLD.8-18 Department leadership / contracts | ❌ | Fuera de scope software |

**Cobertura ~60%** (lo aplicable a software). La mayoría es ámbito institucional.

### SQE — Staff Qualifications and Education

| Standard | Cobertura | Evidencia |
|---|---|---|
| SQE.1 Job descriptions | ❌ | Roles existen (`ece.rol`) sin descripciones formales |
| SQE.2-4 Credentialing | ❌ | Sin registro de credenciales/títulos/colegio médico |
| SQE.5 Privileging (qué procedimientos puede hacer cada uno) | ❌ | RBAC sí; privileging clínico no |
| SQE.6 Performance evaluation | ❌ | No implementado |
| SQE.7-9 Education and training records | ❌ | Sin LMS integrado |
| SQE.10 Re-credentialing / OPPE | ❌ | No implementado |

**Cobertura ~35%** — RBAC existe pero falta credentialing + privileging clínico + LMS.

### MOI — Management of Information

| Standard | Cobertura | Evidencia |
|---|---|---|
| MOI.1 Information needs identified | ✅ | Schema 4NF cubre todos los dominios NTEC |
| MOI.2 Privacy and confidentiality | ✅ | RLS + bitácora acceso + break-glass auditable |
| MOI.3 Security and integrity | ✅ | Audit hash chain SHA-256 + inmutabilidad post-firma (triggers) |
| MOI.4 Retention (timeframes acordados) | ✅ | 10 años retención TDR §6.3 |
| MOI.5 Backup and disaster recovery | ⚠️ | Supabase managed backups; sin DR plan documentado |
| MOI.6 Medical record content | ✅ | 30 tipos NTEC sembrados (`docs/31_flujos_operativos_consolidado.md`) |
| MOI.7 Medical record completion | ✅ | Wizard `proximosDocumentos` + enforcement `assertDependenciasFirmadas` |
| MOI.8 Medical record review for quality | ⚠️ | CERT_DIR existe; sin programa de auditoría de calidad de expediente |
| MOI.9 Code sets and terminology | ✅ | CIE-10 estructurado, LOINC parcial, CIE-9/10 PCS |
| MOI.10 Data dictionary | ✅ | `docs/04_modelo_datos.md` |
| MOI.11 Information governance | ✅ | DIR puede configurar overrides workflow (Fase 6) |
| MOI.12 Document control | ✅ | Versioning + rectificación trazable (RECT) |
| MOI.13 Electronic signatures | ✅ | PIN argon2id + bitácora firma electrónica |
| MOI.14 Health record audit trail | ✅ | `audit.audit_log` + `ece.bitacora_acceso` |

**Cobertura ~95%** — MOI es el chapter mejor cubierto. NTEC Art. 40-56 se alinea muy de cerca con MOI.

---

## Brechas críticas priorizadas

### Prioridad 1 (Go/No-Go para acreditación JCI)

1. **PCI** (Infection Control) — 0% cobertura. Requiere módulo completo: surveillance IAAS, hand hygiene tracking, bundles, isolation precautions, MDR alerts.
2. **PFE** (Patient Education) — 10% cobertura. Requiere módulo de needs assessment, education delivery tracking, teach-back verification.
3. **QPS Dashboard** — datos están, falta capa analítica. Requiere BI con indicadores JCI (mortalidad ajustada, readmisión 30d, eventos centinela rate).

### Prioridad 2 (importante para acreditación)

4. **SQE Credentialing/Privileging** — registro formal de credenciales médicas + privileging clínico (qué procedimientos puede hacer cada médico).
5. **IPSG.2** Read-back de órdenes verbales + resultados críticos + SBAR estructurado.
6. **IPSG.3** Double-check de high-alert meds + LASA alerts + lista codificada.
7. **PFR.5-6** Módulo de reporte de abuso/sospechas + grievance/quejas.

### Prioridad 3 (deseable)

8. **COP.5/7** Cuidados paliativos + ANR/DNR formal.
9. **MMU.7** ADR tracking estructurado.
10. **QPS.5** RCA (Root Cause Analysis) formal post-evento centinela.

---

## Roadmap propuesto

### Fase JCI-1 — Brechas críticas (Sprint dedicado, ~3-4 meses)

- **Módulo PCI** (Infection Control)
  - Tabla `pci.episodio_aislamiento` (tipo: contacto/gotitas/aérea/protector, fechas, motivo)
  - Tabla `pci.hand_hygiene_observation` (compliance tracking via mobile)
  - Tabla `pci.iaas_surveillance` (CLABSI/CAUTI/SSI/VAP con criterios NHSN)
  - Bundles: CVC, ventilator, UTI catheter
  - Alerts MDR organism detection en lab results
  - UI: dashboard infection prevention nurse
- **Módulo PFE** (Patient Education)
  - Tabla `pfe.educacion_paciente` (tema, modalidad, idioma, comprensión)
  - Library de materiales (PDF, video) por dx/procedimiento
  - Teach-back verification con firma paciente/familiar
  - Bridge a expediente (cada educación queda como documento del episodio)
- **QPS Dashboard**
  - Capa semántica (dbt) sobre datos existentes
  - Indicadores JCI Library of Measures (subset 20-30 indicadores prioritarios)
  - Dashboard Metabase/Power BI embebido

### Fase JCI-2 — Brechas importantes (~2-3 meses)

- **SQE Credentialing**
  - Tabla `sqe.credencial_profesional` (título, colegio_medico, fecha expedición, vencimiento)
  - Tabla `sqe.privilegio_clinico` (procedimientos autorizados por personal_id)
  - Workflow renovación + alerts pre-vencimiento
  - Integration con OPPE (Ongoing Professional Practice Evaluation)
- **IPSG.2 Enhancements**
  - Workflow de orden verbal con read-back obligatorio
  - SLA notification critical results con escalamiento
  - SBAR template en handoff de turno
- **IPSG.3 Enhancements**
  - Lista codificada high-alert medications
  - LASA alerts en UI BCMA
  - Double-check workflow para insulina/heparina/opioides
- **PFR Modules**
  - Tabla `pfr.reporte_abuso_sospecha`
  - Workflow grievance con escalamiento

### Fase JCI-3 — Deseables (~1-2 meses)

- ANR/DNR orders formales en `IND_MED`
- Cuidados paliativos workflow
- ADR tracking estructurado en farmacovigilancia
- RCA template + workflow post-evento centinela

---

## Estimación de esfuerzo

| Fase | Story points | Meses (4 devs) | Costo estimado |
|---|---|---|---|
| JCI-1 (PCI + PFE + QPS) | ~400 SP | 3-4 | TBD |
| JCI-2 (SQE + IPSG.2/3 + PFR) | ~250 SP | 2-3 | TBD |
| JCI-3 (deseables) | ~120 SP | 1-2 | TBD |
| **Total** | **~770 SP** | **6-9 meses** | TBD |

Más el costo del **consultor JCI certificado** (no incluido en software).

---

## Diferencias clave NTEC SV vs JCI 7th Edition

| Tema | NTEC SV | JCI |
|---|---|---|
| **Foco** | Documento clínico (expediente) | Calidad y seguridad del paciente |
| **Mecanismo** | Lista de documentos obligatorios + inmutabilidad | Estándares de proceso + medición continua |
| **Autoridad** | MINSAL (regulación nacional) | Acreditación voluntaria internacional |
| **Verificación** | Auditoría periódica del CSS | Visita de evaluadores cada 3 años |
| **Sanción** | Multa / cierre regulatorio | Pérdida de acreditación |
| **Cobertura HAI** | Limitada | Capítulo PCI completo |
| **Educación paciente** | Limitada | Capítulo PFE completo |
| **Credentialing** | Limitada (solo colegio_medico_no) | Capítulo SQE completo |

---

## Próximos pasos recomendados

1. **Validación @AE/@PO**: revisar este mapeo y aprobar/ajustar.
2. **Consultor JCI**: contratar evaluador certificado para gap análisis formal.
3. **Decisión estratégica**: ¿meta es acreditación JCI completa o solo "JCI-ready"? Si lo segundo, JCI-1 + JCI-2 podría bastar.
4. **Sprint planning**: si se aprueba, abrir epic en `docs/backlog/` con las 3 fases.
5. **Comunicación cliente**: transparentar las brechas — no presumir cumplimiento.

---

## Referencias

- JCI Accreditation Standards for Hospitals, 7th Edition (2021)
- JCI Library of Measures
- `TDR_HIS_Multipais.md` — TDR original del HIS
- `docs/31_flujos_operativos_consolidado.md` — flujos NTEC implementados
- `docs/02_arquitectura_software.md` — arquitectura técnica
- `docs/12_rls_validation.md` — validación RLS / multi-tenant
- `packages/database/sql/02_audit_triggers.sql` — audit hash chain (MOI.14)
- `packages/database/sql/05_audit_hash_chain.sql` — inmutabilidad criptográfica

---

**Autor**: análisis técnico preliminar — Claude Code 2026-05-24
**Revisores pendientes**: @AE (arquitectura), @PO (priorización), @DA (BI/QPS), consultor JCI certificado (validación final)
