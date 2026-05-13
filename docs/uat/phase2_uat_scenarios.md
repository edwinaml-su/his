# UAT — Phase 2 Scenarios (es-SV)

**Proyecto:** HIS Multipaís — Inversiones Avante
**Autor:** @QAF — Quality Analyst (BDD)
**Versión:** 1.0 — 2026-05-13 (Fase 6 — Stream D)
**Alcance:** 16 escenarios Gherkin en es-SV, uno por cada módulo Phase 2 entregado en Wave 6/7/8 + 1 cross-tenant.
**Audiencia:** super-usuarios clínicos + admisión + lab + farmacia para UAT formal pre go-live.

> Estos escenarios son **acceptance tests** ejecutables manualmente por usuarios reales en el ambiente staging (`his-avante.vercel.app` con datos sintéticos). Cada uno tiene precondiciones explícitas y resultado verificable. Cobertura técnica E2E vive en `apps/web/e2e/` (responsabilidad @QA).

---

## Cobertura por módulo

| #  | Módulo Phase 2          | TDR § | Escenario UAT                                                                | Rol primario           |
|----|-------------------------|-------|------------------------------------------------------------------------------|------------------------|
| 1  | Outpatient (§10)        | 10.3  | Agendar consulta externa y validar conflicto de agenda                      | Recepcionista          |
| 2  | Inpatient (§11)         | 11.2  | Admisión a hospitalización con asignación de cama                           | Admisión + Enfermería  |
| 3  | Emergency (§12)         | 12.4  | Registro de visita ER con triage previo                                     | Triage                 |
| 4  | Surgery (§13)           | 13.4  | Time-out OMS obligatorio antes de iniciar cirugía                           | Cirujano + Anestesia   |
| 5  | EHR Notes (§14)         | 14.3  | Inmutabilidad post-firma + addendum legal                                   | Médico tratante        |
| 6  | Pharmacy (§15)          | 15.4  | Prescripción de psicotrópico requiere doble verificación                   | Médico + Farmacéutico  |
| 7  | eMAR (§16)              | 16.3  | Administración de medicamento con escaneo paciente-droga                    | Enfermería             |
| 8  | LIS (§17)               | 17.5  | 4-eyes en validación de resultado crítico                                   | Tec. lab + Validador   |
| 9  | Imaging (§18)           | 18.3  | Orden de imagen con preparación del paciente                                | Médico + Tec. imagen   |
| 10 | Inventory (§19)         | 19.2  | Movimiento de stock con lote y vencimiento                                  | Almacén                |
| 11 | Services & Equip. (§20) | 20.4  | Mantenimiento preventivo de equipo biomédico crítico                       | Biomédico              |
| 12 | Respiratory (§21)       | 21.3  | Conexión a ventilador y registro de parámetros                             | Terapia respiratoria   |
| 13 | Nutrition (§22)         | 22.2  | Plan nutricional con restricciones por alergia                              | Nutrición              |
| 14 | Insurance (§25)         | 25.3  | Solicitud de autorización a aseguradora                                    | Admisión + Facturación |
| 15 | Catálogos globales      | 5     | Override local de catálogo MINSAL                                           | Admin tenant           |
| 16 | Multi-tenant            | 5     | Aislamiento cross-tenant en búsqueda global                                | Admin tenant           |

---

## Escenario 1 — Outpatient: agendar y detectar conflicto

```gherkin
# language: es

Característica: Agenda de consulta externa
  Como recepcionista de consulta externa
  Quiero agendar una cita y que el sistema detecte conflictos
  Para evitar doble-agenda al mismo profesional o paciente

  Antecedentes:
    Dada una organización "Hospital Demo SV"
    Y un profesional médico "Dra. Ramírez" con horario de consulta L-V 8:00-17:00
    Y un paciente registrado con MRN "MRN-000123"

  Escenario: Agendar cita en horario disponible
    Dado que ingreso a "Outpatient > Nueva cita"
    Cuando selecciono paciente "MRN-000123"
    Y selecciono profesional "Dra. Ramírez"
    Y selecciono fecha "2026-05-20" hora "09:30"
    Y motivo "Control post-operatorio"
    Y guardo
    Entonces la cita aparece en estado "SCHEDULED"
    Y se registra en audit log con action "CREATE"

  Escenario: Conflicto de agenda — mismo profesional, misma hora
    Dado que existe cita SCHEDULED de "Dra. Ramírez" el "2026-05-20" "09:30"
    Cuando intento agendar otra cita con "Dra. Ramírez" el "2026-05-20" "09:30"
    Entonces el sistema rechaza con mensaje "Conflicto: profesional ya tiene cita en ese horario"
    Y no se crea la cita
```

---

## Escenario 2 — Inpatient: admisión con asignación de cama

```gherkin
# language: es

Característica: Admisión a hospitalización
  Como personal de admisión
  Quiero admitir un paciente a hospitalización
  Y el sistema debe asignar una cama disponible verificando aislamiento

  Antecedentes:
    Dado un paciente "MRN-000456" con Encounter activo
    Y un servicio "Medicina Interna 2do piso"
    Y camas "201-A", "201-B" con estado "AVAILABLE"

  Escenario: Admisión a cama disponible
    Dado que ingreso a "Inpatient > Nueva admisión"
    Cuando selecciono encounter "MRN-000456"
    Y selecciono servicio "Medicina Interna 2do piso"
    Y selecciono cama "201-A"
    Y indico diagnóstico de ingreso "Neumonía adquirida en comunidad"
    Y confirmo admisión
    Entonces el estado de la cama "201-A" cambia a "OCCUPIED"
    Y la admisión se crea con status "ADMITTED"
    Y se registra en audit log

  Escenario: Cama ocupada bloquea selección
    Dado que la cama "201-A" está "OCCUPIED" por otro paciente
    Cuando intento admitir a "MRN-000456" en "201-A"
    Entonces el sistema no permite seleccionar la cama
    Y muestra "Cama no disponible"
```

---

## Escenario 3 — Emergency: visita ER con triage previo

```gherkin
# language: es

Característica: Registro de visita en Emergencias
  Como personal de triage
  Quiero que cada visita ER tenga triage Manchester completado
  Antes de pasar a atención médica

  Escenario: Visita ER con triage Manchester rojo
    Dado un paciente "MRN-000789" recién llegado a triage
    Y la encuesta Manchester arroja "Rojo - Emergencia"
    Cuando registro la visita ER
    Entonces la visita aparece en estado "WAITING"
    Y prioridad visual "RED" en el dashboard ER
    Y el tiempo de espera target es "0 min" (atención inmediata)
    Y se notifica a sala de reanimación

  Escenario: No se puede registrar visita sin triage
    Dado un paciente "MRN-000790" sin triage registrado
    Cuando intento registrar visita ER
    Entonces el sistema rechaza con "Triage Manchester obligatorio antes de visita ER"
```

---

## Escenario 4 — Surgery: time-out OMS obligatorio

```gherkin
# language: es

Característica: Time-out quirúrgico OMS antes de iniciar cirugía
  Como cirujano principal
  Quiero que el sistema bloquee inicio de cirugía
  Si no se ha registrado el time-out con firmas del equipo

  Antecedentes:
    Dado un caso quirúrgico programado "SC-001"
    Y paciente con consentimiento informado firmado
    Y equipo asignado: cirujano "Dr. Pérez", anestesiólogo "Dra. López", enfermera "Sra. Cruz"

  Escenario: Inicio bloqueado sin time-out
    Dado que el caso "SC-001" está en estado "TIMEOUT_PENDING"
    Cuando el cirujano intenta "Iniciar cirugía"
    Entonces el sistema rechaza con "Time-out OMS no registrado"
    Y el caso permanece en "TIMEOUT_PENDING"

  Escenario: Inicio bloqueado con time-out caducado
    Dado un time-out completado hace "45 min"
    Cuando intento iniciar cirugía
    Entonces el sistema rechaza con "Time-out caducado (45 min). Repetir."

  Escenario: Inicio exitoso con time-out válido
    Dado un time-out completado hace "10 min"
    Y firmas presentes: cirujano, anestesiólogo, enfermera
    Cuando el cirujano "Iniciar cirugía"
    Entonces el caso pasa a "IN_PROGRESS"
    Y se registra timestamp "startedAt"
    Y audit log captura la transición
```

---

## Escenario 5 — EHR Notes: inmutabilidad post-firma

```gherkin
# language: es

Característica: Inmutabilidad de notas clínicas firmadas
  Como médico tratante
  Quiero que mis notas firmadas no puedan ser modificadas
  Y poder agregar addendums cuando sea necesario corregir

  Escenario: Edición permitida en borrador
    Dado una nota clínica "NC-100" en estado "DRAFT" del autor logueado
    Cuando edito el contenido y guardo
    Entonces la nota se actualiza sin generar versión nueva
    Y permanece en "DRAFT"

  Escenario: Edición rechazada post-firma
    Dado una nota clínica "NC-101" en estado "SIGNED"
    Cuando intento editar el contenido
    Entonces el sistema rechaza con "Nota firmada: use addendum o anulación legal"
    Y la nota permanece intacta

  Escenario: Addendum legal
    Dado una nota "NC-101" SIGNED
    Cuando creo un addendum con texto "Se aclara que la dosis fue 500 mg, no 50 mg"
    Y firmo el addendum
    Entonces se crea "ClinicalNoteAddendum" enlazado a "NC-101"
    Y la nota original muestra "1 addendum" en el listado
    Y ambos quedan consultables en orden cronológico
```

---

## Escenario 6 — Pharmacy: prescripción psicotrópico con doble verificación

```gherkin
# language: es

Característica: Prescripción de medicamentos controlados
  Como médico tratante
  Quiero prescribir psicotrópicos con doble verificación
  Para cumplir Ley de Drogas SV y trazabilidad DNM

  Escenario: Prescripción de medicamento controlado clase II
    Dado un paciente con encuentro activo
    Y el catálogo Drug incluye "Morfina 10 mg ampolla" clasificado controlled=true
    Cuando prescribo "Morfina 10 mg, 1 ampolla SC c/4h x 24h"
    Y firmo la prescripción
    Entonces el sistema solicita "Confirmación adicional para medicamento controlado"
    Y al confirmar se crea Prescription con flag "controlled=true"
    Y se registra en audit log con severity "HIGH"
    Y la dispensación queda bloqueada hasta verificación farmacéutico

  Escenario: Dispensación con verificación farmacéutico
    Dado prescripción "RX-200" de medicamento controlado lista para dispensar
    Cuando farmacéutico ingresa con su credencial
    Y confirma "Verificado contra receta original"
    Entonces se crea MedicationDispense
    Y se descuenta del lote correspondiente en StockLot
    Y se registra en libro de psicotrópicos (DNM)
```

---

## Escenario 7 — eMAR: administración con escaneo paciente-droga

```gherkin
# language: es

Característica: Administración de medicamentos con verificación BCMA
  Como enfermera
  Quiero escanear paciente + medicamento antes de administrar
  Para prevenir errores de dosis y paciente equivocado

  Escenario: Administración correcta
    Dado un paciente "MRN-000456" en cama "201-A"
    Y una orden eMAR activa: "Amoxicilina 500 mg VO c/8h"
    Y la próxima dosis programada hace 5 minutos
    Cuando enfermera escanea pulsera del paciente
    Y escanea código de barras del medicamento "AMX-500-LOT-XYZ"
    Entonces el sistema valida: paciente correcto, medicamento correcto, dosis correcta, hora correcta, vía correcta (5 rights)
    Y registra MedicationAdministration con timestamp
    Y descuenta del stock

  Escenario: Bloqueo por paciente equivocado
    Cuando enfermera escanea paciente "MRN-000789" en lugar de "MRN-000456"
    Entonces el sistema rechaza con "ALERTA: paciente no coincide con la orden"
    Y registra intento en audit log con severity "CRITICAL"
    Y no se administra el medicamento
```

---

## Escenario 8 — LIS: 4-eyes en validación de resultado crítico

```gherkin
# language: es

Característica: Validación de resultados de laboratorio con regla 4-eyes
  Como técnico de laboratorio
  Quiero que un colega valide mis resultados
  Para cumplir ISO 15189 y TDR §17.5

  Escenario: Resultado validado por colega
    Dado un técnico "Tec1" ingresa resultado "Hemoglobina 8.5 g/dL" (crítico bajo)
    Y el resultado está en estado "RESULT_ENTERED"
    Cuando "Tec2" (distinto de "Tec1") accede a la pantalla de validación
    Y revisa el resultado y firma "Validado"
    Entonces el resultado pasa a "RESULT_VALIDATED"
    Y queda visible en el expediente del paciente
    Y se notifica al médico tratante (resultado crítico)

  Escenario: Mismo técnico no puede validar
    Dado un resultado ingresado por "Tec1"
    Cuando "Tec1" intenta validar
    Entonces el sistema rechaza con "4-eyes: el técnico que ingresó el resultado no puede validarlo. Solicite a un colega."
    Y el resultado permanece en "RESULT_ENTERED"
```

---

## Escenario 9 — Imaging: orden con preparación del paciente

```gherkin
# language: es

Característica: Orden de estudio de imagen con preparación
  Como médico tratante
  Quiero ordenar estudios de imagen con preparación clara
  Para que el paciente acuda en condiciones óptimas

  Escenario: TAC abdominal con ayuno
    Dado paciente con encuentro activo
    Cuando ordeno "TAC abdomen con contraste"
    Y completo motivo "Dolor abdominal en cuadrante derecho, descartar apendicitis"
    Y confirmo la orden
    Entonces se crea ImagingOrder con modality "CT"
    Y la pantalla muestra "Preparación: Ayuno 6h. Hidratación post-estudio."
    Y se imprime/envía instrucciones al paciente
    Y la orden aparece en cola de "Tomografía"
```

---

## Escenario 10 — Inventory: movimiento de stock con lote y vencimiento

```gherkin
# language: es

Característica: Movimientos de inventario con trazabilidad
  Como personal de almacén
  Quiero registrar movimientos con lote y vencimiento
  Para trazabilidad regulatoria DNM

  Escenario: Recepción de medicamento con lote
    Dado un item "Amoxicilina 500 mg cap" en catálogo StockItem
    Cuando registro recepción: 1000 unidades, lote "AMX-2026-A1", vencimiento "2027-06-30"
    Y proveedor "Distribuidora Médica SA"
    Entonces se crea StockLot ligado al item con cantidad 1000
    Y se crea StockMovement tipo "IN" con cantidad 1000
    Y el stock total del item aumenta en 1000

  Escenario: Bloqueo de venta de lote vencido
    Dado un lote "AMX-2025-Z" con vencimiento "2025-12-31"
    Cuando intento dispensar de ese lote en fecha 2026-05-13
    Entonces el sistema rechaza con "Lote vencido. No se puede dispensar."
    Y muestra alerta al farmacéutico
```

---

## Escenario 11 — Services & Equipment: mantenimiento preventivo

```gherkin
# language: es

Característica: Mantenimiento preventivo de equipos biomédicos
  Como biomédico
  Quiero registrar mantenimientos preventivos
  Y que el sistema alerte cuando se acerque la fecha programada

  Escenario: Mantenimiento programado próximo a vencer
    Dado un ventilador "VENT-001" con PmSchedule cada 90 días
    Y último mantenimiento "2026-02-13" (hace 89 días)
    Cuando ingreso al dashboard biomédico
    Entonces "VENT-001" aparece en lista "Próximos a mantenimiento"
    Y muestra "Vence en 1 día"

  Escenario: Calibración registrada
    Cuando registro CalibrationLog para "VENT-001" con resultado "Conforme"
    Y técnico "Ing. Hernández" firma
    Entonces el último mantenimiento se actualiza a fecha de hoy
    Y la próxima fecha programada se desplaza 90 días
```

---

## Escenario 12 — Respiratory: conexión a ventilador

```gherkin
# language: es

Característica: Soporte ventilatorio con registro de parámetros
  Como terapeuta respiratorio
  Quiero registrar la sesión de ventilación con sus parámetros
  Para trazabilidad clínica y facturación

  Escenario: Inicio de sesión de ventilación mecánica
    Dado paciente "MRN-000456" en estado crítico
    Y un ventilador "VENT-001" disponible
    Cuando inicio VentilatorSession con modo "AC/VC", FiO2 50%, PEEP 5, VT 450
    Entonces se crea sesión con timestamp de inicio
    Y el ventilador queda asociado al paciente hasta destete
    Y los parámetros aparecen en el monitor de UCI

  Escenario: Consumo de gas medicinal
    Dado una sesión de ventilación activa de 8 horas con FiO2 50%
    Cuando se cierra la sesión
    Entonces se calcula MedicalGasUsage en m³ y se imputa a la cuenta hospitalaria
```

---

## Escenario 13 — Nutrition: plan con restricciones por alergia

```gherkin
# language: es

Característica: Plan nutricional con alergias del paciente
  Como nutricionista
  Quiero que el sistema bloquee dietas con alergenos conocidos
  Para seguridad del paciente

  Escenario: Bloqueo por alérgeno
    Dado paciente "MRN-000456" con PatientAllergy "Maní" severidad "ANAFILACTIC"
    Cuando intento prescribir DietPlan con ingrediente "Mantequilla de maní"
    Entonces el sistema rechaza con "ALERTA: paciente alérgico a maní (anafilaxia)"
    Y registra intento en audit log

  Escenario: Plan compatible
    Cuando prescribo dieta "Hipoglúcida 1800 kcal sin gluten"
    Y el paciente no tiene alergias conflictivas
    Entonces se crea NutritionAssessment + NutritionOrder
    Y aparece en cola de servicio de alimentación
```

---

## Escenario 14 — Insurance: solicitud de autorización

```gherkin
# language: es

Característica: Autorización de aseguradora
  Como personal de admisión
  Quiero solicitar autorización electrónica a la aseguradora
  Antes de procedimientos electivos

  Escenario: Autorización requerida pre-cirugía
    Dado paciente "MRN-000456" con PatientCoverage activa de "ISSS"
    Y cirugía programada "Colecistectomía laparoscópica"
    Cuando admisión genera AuthorizationRequest
    Y completa diagnóstico CIE-10, código de procedimiento, costos estimados
    Y envía a la aseguradora
    Entonces el caso queda en estado "AUTH_PENDING"
    Y la cirugía no puede pasar a "SCHEDULED" hasta recibir "AUTH_APPROVED"

  Escenario: Bloqueo de procedimiento sin autorización
    Cuando intento programar cirugía sin AuthorizationRequest aprobada
    Entonces el sistema advierte "Autorización pendiente — procedimiento puede generar rechazo de facturación"
    Y exige confirmación supervisor para continuar
```

---

## Escenario 15 — Catálogos: override local de MINSAL

```gherkin
# language: es

Característica: Override local de catálogo global
  Como admin de tenant
  Quiero crear variantes locales del catálogo MINSAL
  Sin alterar el catálogo global de referencia

  Escenario: Override de LabPanel
    Dado un catálogo global LabPanel "Perfil hepático MINSAL" (organizationId NULL)
    Cuando como admin de "Hospital Demo SV" copio el panel y modifico el costo
    Entonces se crea un nuevo LabPanel con organizationId del tenant
    Y el panel global permanece intacto
    Y al solicitar lab desde mi tenant, aparecen ambos (global + propio) diferenciados
    Y los workflows clínicos prefieren el local
```

---

## Escenario 16 — Multi-tenant: aislamiento cross-tenant

```gherkin
# language: es

Característica: Aislamiento estricto entre tenants
  Como admin de tenant "Hospital Demo SV"
  Quiero asegurar que NO veo datos de otros hospitales
  Para cumplir Ley de Protección de Datos SV

  Escenario: Búsqueda no devuelve pacientes ajenos
    Dado existen pacientes en "Hospital Demo SV" y en "Clínica San Pedro"
    Y estoy logueado en "Hospital Demo SV"
    Cuando busco "Pérez" en MPI global
    Entonces solo veo pacientes de mi tenant
    Y NO veo pacientes de "Clínica San Pedro"
    Y en audit log queda registro de búsqueda

  Escenario: Acceso directo por ID ajeno bloqueado
    Dado un paciente "MRN-CSP-001" en "Clínica San Pedro"
    Cuando intento acceder vía URL directa "/patient/<id-de-MRN-CSP-001>"
    Entonces el sistema responde "404 No encontrado" (no "403" para no filtrar existencia)
    Y registra intento en audit log con severity "HIGH"
```

---

## Plan de ejecución UAT

| Fase           | Cuándo         | Quién                                        | Duración estimada |
|----------------|----------------|----------------------------------------------|-------------------|
| Walkthrough    | T-14d          | @QAF + super-usuarios + Clinical Lead        | 4h                |
| Ejecución      | T-10d a T-3d   | Super-usuarios por servicio (auto-administrada) | 5 días        |
| Triage hallazgos | T-2d         | @QAF + @PO + @Dev                            | 1d                |
| Fix + re-test  | T-2d a T-1d    | @Dev + @QAF                                  | 1.5d              |
| Sign-off       | T-1d           | Clinical Lead + PO                           | 0.5h              |

Documentación de resultados en `docs/uat/phase2_uat_results.md` (a generar tras ejecución).

## Criterios de éxito UAT

- 100% de escenarios pasan o tienen workaround documentado.
- 0 hallazgos CRITICAL abiertos (severity definida en `docs/17_hipercuidado_runbook.md` §3).
- Sign-off escrito de Clinical Lead + PO.
