# language: es
# Épica: E2 — Seguridad
# Historias cubiertas: US-2.7 (Break-glass)
# TDR: §6
# Persona principal: P1 — Médico de emergencias (acceso excepcional)
# Valor de negocio: Permitir acceso clínico crítico fuera del ABAC normal,
# bajo justificación obligatoria, notificación inmediata y auditoría reforzada.

@critical @security @break-glass @es-SV
Característica: Acceso de emergencia (Break-the-Glass)
  Como médico de emergencias (P1)
  Quiero acceder a expedientes fuera de mi ámbito normal cuando una vida está en riesgo
  Para no bloquear atención crítica, asumiendo trazabilidad reforzada.

  Antecedentes:
    Dado un médico con rol "medico" asignado solo al servicio "Cirugía"
    Y existe el paciente "MRN-000789" en estado crítico, atendido en "Emergencia"
    Y el médico NO tiene permiso ABAC normal sobre el paciente

  @smoke
  Escenario: Activación de break-glass con justificación
    Cuando el médico intenta abrir el expediente de "MRN-000789"
    Entonces el sistema bloquea con "Fuera de ámbito"
    Y ofrece botón "Acceso de emergencia (break-the-glass)"
    Cuando el médico hace clic y captura justificación "Paro cardiaco en pasillo, médico de turno único disponible"
    Y confirma con su contraseña
    Entonces el sistema concede acceso temporal por 60 minutos
    Y muestra banner persistente "MODO BREAK-GLASS ACTIVO"
    Y emite evento "BreakGlassActivated"

  @validation
  Escenario: Justificación insuficiente bloquea activación
    Cuando el médico activa break-glass con texto "ok"
    Entonces el sistema rechaza con "Justificación mínima 30 caracteres"
    Y NO concede acceso

  @notification
  Escenario: Notificación al jefe de servicio en menos de 5 minutos
    Cuando se activa break-glass exitosamente
    Entonces el sistema envía notificación al jefe de servicio del paciente vía email + push
    Y el SLA de notificación es < 5 minutos
    Y la notificación incluye paciente, médico, justificación y enlace a auditoría

  @audit
  Escenario: Toda lectura bajo break-glass se audita como sensible
    Dado break-glass activo
    Cuando el médico abre cualquier sección del expediente
    Entonces cada lectura genera entrada "READ_BREAK_GLASS" en audit_log
    Y al expirar la sesión break-glass se publica "BreakGlassExpired"
    Y se emite resumen consolidado al jefe de servicio

  @timeout
  Escenario: Expiración automática del modo break-glass
    Dado break-glass activo desde hace 59 minutos
    Cuando transcurre 1 minuto adicional
    Entonces el acceso temporal se revoca
    Y al siguiente request el médico recibe "403 - Sesión break-glass expirada"
    Y se publica "BreakGlassExpired"

  @abuse
  Escenario: Abuso del break-glass dispara alerta
    Dado un médico que activó break-glass 3 veces en 24 horas sobre pacientes distintos
    Cuando activa una 4ta vez
    Entonces el sistema permite el acceso pero genera alerta "BreakGlassAbusePattern"
    Y notifica al CISO y al jefe de servicio
    Y queda en lista para revisión semanal
