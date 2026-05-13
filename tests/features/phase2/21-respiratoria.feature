# language: es
# Épica: E21 — Terapia Respiratoria
# TDR: §21 Terapia Respiratoria
# Stack backend: respiratoryRouter (skeleton Wave 8)
# Persona principal: P12 — Terapista respiratorio / P6 — Enfermería
# Valor: Orden de terapia, sesión de ventilador y registro de consumo de gases.

@phase2 @respiratory @es-SV
Característica: Órdenes de terapia respiratoria y registro de ventilación
  Como terapista respiratorio o enfermería (P6, P12)
  Quiero crear órdenes de terapia y registrar sesiones de ventilación
  Para documentar el soporte respiratorio del paciente con trazabilidad.

  Antecedentes:
    Dado un encounter activo del paciente "MRN-001100" en el tenant actual

  @smoke @happy
  Escenario: Crear orden de ventilación mecánica y abrir sesión
    Cuando creo una orden tipo "MECHANICAL_VENT" para el paciente
    Y abro una sesión de ventilador asociada a esa orden
    Entonces la orden queda activa y la sesión queda abierta
    Y ambas quedan asociadas al organizationId del tenant

  @edge @completed
  Escenario: Bloquear cierre de orden ya completada
    Dada una orden respiratoria ya completada
    Cuando intento cerrarla nuevamente
    Entonces el sistema responde "no encontrado"
    Y la orden permanece en su estado original
