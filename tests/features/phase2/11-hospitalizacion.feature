# language: es
# Épica: E11 — Hospitalización (Inpatient)
# TDR: §11 Hospitalización
# Stack backend: inpatientRouter (skeleton Wave 7)
# Persona principal: P5 — Médico de planta / P6 — Enfermería
# Valor: Registrar admisión a piso, signos vitales y kardex con aislamiento por tenant.

@phase2 @inpatient @es-SV
Característica: Admisión hospitalaria y registro clínico
  Como médico de planta o enfermería (P5, P6)
  Quiero admitir pacientes a hospitalización y documentar su evolución
  Para garantizar continuidad del cuidado y trazabilidad por organización.

  Antecedentes:
    Dado un establecimiento con servicio "Medicina Interna" habilitado
    Y inicio sesión con rol "medico_planta"

  @smoke @happy
  Escenario: Admisión hospitalaria a partir de un encounter del tenant
    Dado un encounter activo del paciente "MRN-000200" en el tenant actual
    Cuando admito al paciente al servicio "Medicina Interna" con diagnóstico de ingreso "Neumonía adquirida en comunidad"
    Y registro el médico tratante "Dra. Ana Pérez"
    Entonces el sistema crea la admisión en estado "ADMITTED"
    Y la admisión queda vinculada al encounter y al organizationId del tenant

  @edge @validation
  Escenario: Rechazar admisión cuando patientId no coincide con el encounter
    Dado un encounter del paciente "MRN-000200" del tenant actual
    Cuando intento admitir con un patientId distinto al del encounter
    Entonces el sistema rechaza la operación con error de validación
    Y no se crea ningún registro de admisión
