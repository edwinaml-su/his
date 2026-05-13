# language: es
# Épica: E13 — Cirugía (Surgery)
# TDR: §13 Cirugía
# Stack backend: surgeryRouter (skeleton Wave 7)
# Persona principal: P5 — Cirujano / P6 — Enfermería de quirófano
# Valor: Programar caso quirúrgico, ejecutar time-out y completarlo con auditoría.

@phase2 @surgery @es-SV
Característica: Programación y ejecución de casos quirúrgicos
  Como cirujano o enfermería de quirófano (P5, P6)
  Quiero programar y ejecutar un caso quirúrgico con time-out
  Para asegurar la seguridad del paciente y la trazabilidad del procedimiento.

  Antecedentes:
    Dado un establecimiento con quirófano "QF-01" activo en el tenant actual
    Y inicio sesión con rol "cirujano"

  @smoke @happy
  Escenario: Programar caso quirúrgico y cerrar time-out
    Dado un paciente "MRN-000400" con encounter activo
    Cuando programo un caso en el quirófano "QF-01" para procedimiento "Colecistectomía laparoscópica"
    Y ejecuto el time-out registrando equipo quirúrgico y verificación de identidad
    Entonces el caso queda con time-out registrado
    Y la marca "timeOutAt" y "timeOutById" quedan persistidas

  @edge @state-machine
  Escenario: Bloquear inicio de cirugía sin time-out previo
    Dado un caso quirúrgico programado sin time-out
    Cuando intento marcar el inicio del procedimiento
    Entonces el sistema rechaza con error "no encontrado"
    Y el caso permanece en su estado anterior
