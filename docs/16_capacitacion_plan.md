# Plan de Capacitación — HIS Avante (US-9.1)

**Equipo:** Uniform — E9 Onboarding y Go-Live
**Sprint:** 3 (preparación) · ejecución T-14d a T-1d antes de Go-Live
**Owner:** Product Lead + Clinical Lead + RRHH Avante
**Métrica de éxito:** **≥ 90% del personal certificado** antes de Go-Live (evaluación final aprobada con ≥ 80%).

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

### 3.6 PHARMACIST — Farmacéutico (2 horas — **diferido a Sprint 4**)

- **Temario:** validación farmacéutica, dispensación, control de inventario, narcóticos.
- **Estado:** diferido — el módulo de farmacia entra en Sprint 4. Capacitación se programa T-7d antes de su go-live independiente.

## 4. Cronograma (referencia)

| Día | Actividad | Responsable |
|---|---|---|
| T-14d | Kickoff general (F1) | PO + Clinical Lead |
| T-13d a T-7d | Capacitación por rol (F2), tandas mañana/tarde | Trainers + super-usuarios |
| T-10d a T-2d | E-learning (F3) habilitado en LMS | RRHH |
| T-3d a T-1d | Evaluaciones finales (F4) | RRHH |
| T-1d | Reporte de cobertura → autorización Go-Live | PO |

## 5. Materiales

- Manuales de usuario: `docs/19_user_manual_admision.md`, `docs/20_user_manual_triage.md` (resto en backlog Sprint 4).
- Videos cortos (< 10 min) hospedados en LMS interno — placeholder URLs en wizard `/onboarding`.
- Ambiente de capacitación: `https://train.his.avante.local` — datos sintéticos, RLS aislado.
- Quick reference cards (1 página) por rol, plastificadas, distribuidas en estaciones.

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
