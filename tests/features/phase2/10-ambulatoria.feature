# language: es
# Épica: E10 — Ambulatoria (Outpatient)
# TDR: §10 Atención Ambulatoria
# Stack backend: outpatientRouter (skeleton Wave 6)
# Persona principal: P5 — Médico ambulatorio / P3 — Admisión
# Valor: Agendar consultas y registrar la consulta SOAP con trazabilidad por tenant.
# Estado UI: skeleton — pages aún no implementadas (deferido a @Dev).

@phase2 @outpatient @es-SV
Característica: Gestión de citas y consultas ambulatorias
  Como personal de admisión o médico ambulatorio (P3, P5)
  Quiero agendar citas y registrar consultas asociadas
  Para que cada visita quede ligada al MPI y al encounter, con aislamiento estricto por organización.

  Antecedentes:
    Dado que el establecimiento "Hospital Avante San Salvador" tiene activo el módulo "Ambulatoria"
    Y inicio sesión con rol "admision" y selecciono ese establecimiento como tenant

  @smoke @happy
  Escenario: Agendar una cita ambulatoria estándar
    Dado un paciente "María Hernández" registrado en el MPI con MRN "MRN-000123"
    Y un médico "Dr. José Ramírez" activo en la especialidad "Medicina General"
    Cuando agendo una cita el 15/06/2026 a las 09:00 con duración 30 minutos
    Y registro motivo "Control de hipertensión"
    Entonces el sistema crea la cita en estado "SCHEDULED"
    Y la cita queda vinculada al paciente y al médico
    Y queda asociada al organizationId del tenant actual

  @edge @tenant-isolation
  Escenario: Un médico de otra organización no puede ver citas ajenas
    Dado que existe una cita en la organización "OrgA"
    Cuando un médico autenticado en la organización "OrgB" consulta su lista de citas
    Entonces la cita de "OrgA" no aparece en los resultados
    Y consultar la cita por id devuelve "no encontrado"
