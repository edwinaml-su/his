# Plan de Capacitación — HIS Avante (US-9.1) · v2

**Equipo:** Uniform — E9 Onboarding y Go-Live
**Sprint:** 3 (preparación) · ejecución T-21d a T-1d antes de Go-Live
**Owner:** Product Lead + Clinical Lead + RRHH Avante
**Métrica de éxito:** **≥ 90% del personal certificado** antes de Go-Live (evaluación final aprobada con ≥ 80%).
**Versión 2:** 2026-05-13 — extiende cobertura a las 14 rutas Phase 2 nuevas (§10-§22, §25) y añade roles especializados (Pharmacist, Lab Tech, Radiology Tech, Inventory Clerk, Insurance Clerk).

---

## 1. Objetivos

1. Garantizar que cada usuario opera el HIS con autonomía en su flujo crítico.
2. Reducir incidentes L1 los primeros 14 días (hipercuidado) — meta < 0.5 tickets/usuario/día.
3. Certificar super-usuarios por servicio (al menos 1 por turno y por área) que actuarán como soporte de primera línea.

## 2. Modalidad

| Fase | Modalidad | Duración | Audiencia |
|---|---|---|---|
| F1 — Kickoff | Presencial (auditorio) | 1 h | Toda la planta clínica |
| F2 — Capacitación por rol | Presencial (lab informático) | 2-4 h según rol | Por grupos de rol |
| F3 — E-learning refuerzo | Asincrónica (LMS interno) | Videos < 10 min cada uno | Todos |
| F4 — Evaluación final | LMS interno + checklist práctico | 30 min | Todos |
| F5 — Acompañamiento | Hipercuidado (ver runbook 17) | 14 días | Todos |

Los videos de e-learning están organizados por rol y módulo, en piezas de **< 10 minutos** cada uno para facilitar el repaso just-in-time.

## 3. Plan por rol

### 3.1 ADMIN (4 horas)

- **Temario:**
  - Gestión de organizaciones, sedes y servicios.
  - Catálogos paramétricos (CIE-10, CUPS, ATC) — sincronización y versionado.
  - Gestión de usuarios, roles RBAC y políticas ABAC.
  - Audit log: lectura, verificación de cadena hash, exportación.
  - SLOs y dashboards operativos.
  - Configuración de tasas de cambio multi-moneda.
- **Demo de flujos:** alta de usuario → asignación de rol → revocación → consulta en audit log.
- **Ejercicios prácticos:**
  1. Crear una sede nueva y asignarle 3 servicios.
  2. Importar versión nueva de catálogo CIE-10 (sandbox).
  3. Detectar y reportar una rotura de cadena hash simulada.
- **Evaluación final:** 15 preguntas de opción múltiple + 1 caso práctico.

### 3.2 PHYSICIAN — Médico (3 horas)

- **Temario:**
  - Búsqueda de paciente, lectura de historia clínica unificada.
  - Registro de consulta: anamnesis, examen, diagnóstico (CIE-10), plan.
  - Prescripción electrónica con interacciones medicamentosas.
  - Solicitud de órdenes (laboratorio, imagen, interconsulta).
  - Firma electrónica y cierre de episodio.
- **Demo de flujos:** consulta de urgencias → diagnóstico → prescripción → alta.
- **Ejercicios prácticos:**
  1. Atender un paciente NN llegado por triage rojo.
  2. Resolver alerta de interacción medicamentosa.
  3. Firmar epicrisis y verificar trazabilidad.
- **Evaluación final:** caso clínico simulado end-to-end.

### 3.3 NURSE — Enfermería (4 horas)

- **Temario:**
  - Recepción de paciente y verificación de pulsera.
  - Registro de signos vitales, balance hídrico, escalas (Braden, EVA, Glasgow).
  - Administración de medicamentos con doble verificación (5 correctos).
  - Notas de enfermería SOAP.
  - Manejo de eventos adversos.
- **Demo de flujos:** turno completo en hospitalización (recepción → vitales → meds → entrega de turno).
- **Ejercicios prácticos:**
  1. Administrar medicamento con scan de código de barras.
  2. Registrar caída de paciente como evento adverso.
  3. Generar reporte de entrega de turno.
- **Evaluación final:** simulación turno 4h en lab.

### 3.4 TRIAGE_NURSE — Enfermería de Triage (3 horas)

- **Temario:**
  - Aplicación de escala ESI (5 niveles).
  - Registro rápido NN con foto.
  - Reasignación de prioridad y traslado.
  - Comunicación con admisión y médico.
- **Demo de flujos:** llegada masiva (3 pacientes simultáneos, 1 rojo, 1 amarillo, 1 verde).
- **Ejercicios prácticos:**
  1. Triage rojo en < 60 segundos.
  2. Registrar NN sin documentos y reidentificar al obtener cédula.
  3. Reabrir caso por deterioro clínico.
- **Evaluación final:** 5 casos cronometrados.

### 3.5 ADMISSION_CLERK — Admisionista (2 horas)

- **Temario:**
  - Búsqueda y desambiguación de paciente.
  - Admisión (urgencias, programada, hospitalización).
  - Registro de acompañante y datos de contacto.
  - Verificación de aseguradora y autorización.
  - Manejo de paciente NN.
- **Demo de flujos:** admisión completa con verificación de derechos.
- **Ejercicios prácticos:**
  1. Admitir paciente conocido con cambio de aseguradora.
  2. Crear NN y completarlo posteriormente.
  3. Reversar admisión por error.
- **Evaluación final:** 10 casos prácticos en simulador.

### 3.6 PHARMACIST — Farmacéutico (3 horas)

- **Temario:**
  - Validación farmacéutica 4-eyes (CPOE → Validated).
  - Detección de alergias e interacciones (dataset Wave 1).
  - Dispensación unidosis con lote/expiración + barcode item.
  - Doble verificación para fármacos de alto riesgo (ISMP High Risk).
  - Libro DNM (clase II/III/IV) con folio gapless + hash-chain.
  - Manejo de rechazos farmacéuticos (ALLERGY, INTERACTION, DOSE_OUT_OF_RANGE).
- **Demo de flujos:** validación → dispensación → seguimiento eMAR.
- **Ejercicios prácticos:**
  1. Aprobar prescripción con override de interacción moderada justificada.
  2. Rechazar prescripción por alergia y devolver al médico.
  3. Asentar entrada y salida de fármaco controlado en libro DNM.
- **Evaluación final:** 10 casos prácticos + simulación de rotura de stock.

### 3.7 LAB_TECHNOLOGIST — Tecnólogo de Laboratorio (3 horas)

- **Temario:**
  - Worklist de órdenes (priorización STAT/ROUTINE).
  - Recepción y aceptación/rechazo de specimens.
  - Procesamiento e ingestión de resultados (manual y vía analizador HL7).
  - Validación técnica (paso 1 de 4-eyes).
  - Manejo de valores críticos con SLA < 30 min.
  - Delta check, Westgard, flags (high/low/critical).
- **Demo de flujos:** recepción → procesamiento → validación técnica → cola patólogo.
- **Ejercicios prácticos:**
  1. Rechazar specimen hemolizado con motivo y nota.
  2. Procesar hemograma completo y disparar alerta crítica.
  3. Manejar duplicado HL7 ORU (idempotencia).
- **Evaluación final:** 8 casos cronometrados.

### 3.8 PATHOLOGIST / BIOLOGIST — Validador Clínico (2 horas)

- **Temario:**
  - Validación clínica (paso 2 de 4-eyes) con firma TSA.
  - Cadena de validación con hash encadenado.
  - Single-validator exception (con justificación obligatoria).
  - Liberación al HCE (Released) — irreversible salvo amend.
  - Amend post-release (append-only).
- **Demo de flujos:** revisión histórica → validación clínica → release.
- **Ejercicios prácticos:**
  1. Liberar resultado validado por tecnólogo en horario laboral.
  2. Amend de resultado liberado con razón documentada.
  3. Single-validator nocturno con justificación.
- **Evaluación final:** 6 casos clínicos.

### 3.9 RADIOLOGY_TECHNOLOGIST — Tecnólogo de Imagen (2 horas)

- **Temario:**
  - Recepción de orden de imagen (RIS).
  - Worklist de estudios pendientes.
  - Inicio/finalización de estudio con QC.
  - Carga de imágenes (placeholder PACS Wave 1).
  - Manejo de protocolos por modalidad (Rx, US, TAC, RMN).
- **Demo de flujos:** orden → estudio → reporte (stub).
- **Ejercicios prácticos:**
  1. Procesar orden urgente con preparación previa.
  2. Cancelar estudio por paciente no cooperativo.
- **Evaluación final:** 4 casos prácticos.

### 3.10 INVENTORY_CLERK — Encargado de Inventario (2 horas)

- **Temario:**
  - Recepción de mercadería y registro de lotes.
  - Control de fechas de vencimiento (FEFO).
  - Reposición desde almacén central a servicios.
  - Conteo cíclico mensual.
  - Reportes de movimientos.
- **Demo de flujos:** entrada → ubicación → reposición → ajuste.
- **Ejercicios prácticos:**
  1. Recibir entrega con lote y vencimiento.
  2. Ajuste de stock por daño o pérdida (con motivo).
  3. Generar reporte de movimientos del mes.
- **Evaluación final:** 6 ejercicios prácticos.

### 3.11 INSURANCE_CLERK — Gestor de Aseguradoras (3 horas)

- **Temario:**
  - Verificación de elegibilidad (eligibility check).
  - Solicitud de autorización previa.
  - Generación de claim al alta del paciente.
  - Manejo de denegaciones y apelaciones.
  - Carga de tarifarios por aseguradora.
- **Demo de flujos:** admisión → verificación → autorización → claim.
- **Ejercicios prácticos:**
  1. Verificar elegibilidad en línea con respuesta mock.
  2. Solicitar autorización para procedimiento programado.
  3. Generar claim agregando ítems del episodio.
- **Evaluación final:** 8 casos de claims.

### 3.12 OUTPATIENT_SCHEDULER — Programador Ambulatorio (2 horas)

- **Temario:**
  - Configuración de agendas médicas (Schedule + Slot).
  - Reserva de citas con paciente conocido o NN.
  - Reprogramación y cancelación con motivo.
  - Manejo de No-Show vía cron.
  - Generación de incapacidades médicas (MedicalLeave).
- **Demo de flujos:** apertura agenda → reserva → check-in → in-consult → completed.
- **Ejercicios prácticos:**
  1. Publicar agenda 4 semanas adelante.
  2. Reprogramar cita con notificación a paciente.
  3. Marcar No-Show manualmente y revisar log de transiciones.
- **Evaluación final:** 5 casos prácticos.

### 3.13 EMERGENCY_NURSE — Enfermería de Emergencias (3 horas, módulo §12)

- **Temario:**
  - Triage Manchester (5 niveles) con flowcharts.
  - Dashboard de emergencias en tiempo real.
  - LWBS (Left Without Being Seen) y reidentificación.
  - Escalamiento clínico por deterioro.
- **Demo de flujos:** llegada → Manchester → asignación box → tratamiento → disposición.
- **Ejercicios prácticos:**
  1. Triage rojo en < 60s con flowchart de dolor torácico.
  2. Reabrir caso LWBS al retorno del paciente.
- **Evaluación final:** 5 casos cronometrados.

### 3.14 SURGEON / OR_NURSE — Cirugía (3 horas, módulo §13)

- **Temario:**
  - Surgical Safety Checklist (Timeout WHO).
  - OR Condition (estado del quirófano).
  - Documentación intraoperatoria.
  - Conteo de gasas/instrumental (placeholder Wave 1).
- **Demo de flujos:** programación → timeout → cirugía → cierre.
- **Ejercicios prácticos:**
  1. Ejecutar timeout completo con todos los participantes.
  2. Documentar evento adverso intraoperatorio.
- **Evaluación final:** 4 casos.

### 3.15 INPATIENT_NURSE — Enfermería de Hospitalización (3 horas, módulo §11)

- **Temario:**
  - Inpatient Admission + asignación de cama.
  - Vitals horarios + alertas por umbrales.
  - Kardex append-only de turno.
  - Care Plan (objetivos + intervenciones).
  - State machine de InpatientStatus.
- **Demo de flujos:** admisión → vitales → kardex → alta o transferencia.
- **Ejercicios prácticos:**
  1. Registrar vitales con alerta automática por taquicardia.
  2. Agregar entrada al kardex de turno noche.
  3. Solicitar transferencia de cama por aislamiento.
- **Evaluación final:** simulación turno 4h en lab.

### 3.16 RESPIRATORY_THERAPIST — Terapista Respiratorio (2 horas, módulo §21)

- **Temario:**
  - Configuración de ventilador (modo, FiO2, PEEP, frecuencia, volumen).
  - Plan de weaning (destete).
  - Documentación de aerosolterapia.
- **Demo de flujos:** prescripción → ajuste ventilatorio → progresión weaning.
- **Ejercicios prácticos:**
  1. Ajustar parámetros ventilatorios con justificación.
  2. Iniciar weaning según protocolo.
- **Evaluación final:** 4 casos prácticos.

### 3.17 NUTRITIONIST — Nutricionista (2 horas, módulo §22)

- **Temario:**
  - Orden dietética con restricciones (DM, HTA, IRC, alergia).
  - Balance hídrico y nutricional.
  - Suplementos y alimentación enteral/parenteral.
- **Demo de flujos:** evaluación → indicación → seguimiento balance.
- **Ejercicios prácticos:**
  1. Indicar dieta DM2 con restricción sódica.
  2. Calcular balance día con I/O.
- **Evaluación final:** 4 casos prácticos.

### 3.18 EHR_PHYSICIAN_NOTES — Médicos (transversal, 1 hora suplementaria, módulo §14)

- **Temario adicional al §3.2:**
  - SOAP con campos obligatorios.
  - Firma electrónica TSA + immutability post-sign.
  - Addendum encadenado por hash.
  - Diagnóstico CIE-10 (primary, chronic).
- **Demo de flujos:** crear → firmar → addendum.
- **Ejercicio:** firmar nota e intentar editar (debe fallar); crear addendum.

## 4. Cronograma (referencia)

| Día | Actividad | Responsable |
|---|---|---|
| T-21d | Kickoff general (F1) — 14 módulos Phase 2 presentados | PO + Clinical Lead |
| T-20d a T-14d | Capacitación por rol clínico base (F2.1), tandas mañana/tarde | Trainers + super-usuarios |
| T-13d a T-7d | Capacitación por rol especializado (F2.2): Pharmacist, Lab Tech, Path/Bio, Rad Tech, Inv Clerk, Ins Clerk | Trainers especializados |
| T-14d a T-2d | E-learning (F3) habilitado en LMS — 14 screencasts < 3 min | RRHH |
| T-3d a T-1d | Evaluaciones finales (F4) | RRHH |
| T-1d | Reporte de cobertura → autorización Go-Live | PO |

## 5. Materiales

- Manuales de usuario: `docs/19_user_manual_admision.md`, `docs/20_user_manual_triage.md` (extendidos en v2 con secciones Phase 2).
- Manuales suplementarios Phase 2 (backlog próximo Sprint, owners @PO):
  - `docs/19b_user_manual_outpatient.md` (§10)
  - `docs/19c_user_manual_inpatient.md` (§11)
  - `docs/19d_user_manual_emergency.md` (§12)
  - `docs/19e_user_manual_surgery.md` (§13)
  - `docs/19f_user_manual_ehr_notes.md` (§14)
  - `docs/19g_user_manual_pharmacy.md` (§15/§16)
  - `docs/19h_user_manual_lis.md` (§17)
  - `docs/19i_user_manual_imaging.md` (§18)
  - `docs/19j_user_manual_inventory.md` (§19)
  - `docs/19k_user_manual_services_equipment.md` (§20)
  - `docs/19l_user_manual_respiratory.md` (§21)
  - `docs/19m_user_manual_nutrition.md` (§22)
  - `docs/19n_user_manual_insurance.md` (§25)
- Videos cortos hospedados en LMS interno — 14 screencasts < 3 min cada uno (uno por módulo Phase 2), formato fijo:
  - 0:00–0:20 — Contexto del módulo
  - 0:20–2:00 — Flujo principal en pantalla
  - 2:00–2:40 — Errores comunes y cómo resolverlos
  - 2:40–3:00 — Q&A pointer
- Ambiente de capacitación: `https://train.his.avante.local` — datos sintéticos, RLS aislado.
- Quick reference cards (1 página) por rol, plastificadas, distribuidas en estaciones.

### 5.1 Scripts de screencast por módulo Phase 2

Cada screencast sigue el formato fijo arriba. Los scripts viven en `docs/training-scripts/` (a generar en T-14d, owner @PO):

| Archivo | Módulo | Audiencia primaria |
|---|---|---|
| `screencast-10-outpatient.md` | §10 Ambulatorio | Scheduler + Physician |
| `screencast-11-inpatient.md` | §11 Hospitalización | Inpatient Nurse + Physician |
| `screencast-12-emergency.md` | §12 Emergencias | Emergency Nurse + ER Physician |
| `screencast-13-surgery.md` | §13 Cirugía | Surgeon + OR Nurse |
| `screencast-14-ehr-notes.md` | §14 EHR Notes | Physician (todos) |
| `screencast-15-pharmacy.md` | §15 Pharmacy | Pharmacist + Physician |
| `screencast-16-emar.md` | §16 eMAR | Nurse (todos) |
| `screencast-17-lis.md` | §17 LIS | Lab Tech + Path/Bio |
| `screencast-18-imaging.md` | §18 RIS/PACS | Radiology Tech + Physician |
| `screencast-19-inventory.md` | §19 Inventario | Inventory Clerk |
| `screencast-20-services-equipment.md` | §20 Servicios | Admin |
| `screencast-21-respiratory.md` | §21 Respiratorio | Resp Therapist |
| `screencast-22-nutrition.md` | §22 Nutrición | Nutritionist |
| `screencast-25-insurance.md` | §25 Insurance | Insurance Clerk |

## 6. Certificación

- **Aprobación:** ≥ 80% en evaluación + checklist práctico observado por trainer.
- **Vigencia:** 12 meses; refresco obligatorio al cambio de versión mayor.
- **Registro:** tabla `training_certification` (alimentada manualmente por RRHH en Sprint 3 — automatización en backlog Sprint 5).

## 7. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Personal de noche con baja asistencia | Tanda nocturna dedicada + e-learning obligatorio |
| Rotación durante hipercuidado | Super-usuarios certificados como mentores |
| Ambiente de capacitación inestable | SRE garantiza paridad con prod (ver `docs/08_devops.md`) |
