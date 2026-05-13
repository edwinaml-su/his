# language: es
# Épica: E12 — Emergencia (Emergency)
# TDR: §12 Emergencias
# Stack backend: emergencyRouter (skeleton Wave 7)
# Persona principal: P4 — Triador / P5 — Médico de emergencia
# Valor: Registrar visita de emergencia y disponer destino (alta, ingreso, observación).

@phase2 @emergency @es-SV
Característica: Visitas de emergencia y disposición clínica
  Como médico o triador de emergencia (P4, P5)
  Quiero registrar la visita y su disposición final
  Para coordinar el destino del paciente con trazabilidad por organización.

  Antecedentes:
    Dado un establecimiento con servicio "Emergencia Adultos" activo
    Y inicio sesión con rol "medico_emergencia"

  @smoke @happy
  Escenario: Registrar visita de emergencia y disposición a observación
    Dado un encounter activo del paciente "MRN-000300" en el tenant actual
    Cuando registro la visita con modo de llegada "WALK_IN" y queja principal "Dolor abdominal"
    Y la disposición final es "OBSERVATION"
    Entonces la visita queda registrada con su organizationId
    Y el tiempo de disposición queda almacenado en "dispositionAt"

  @edge @lwbs
  Escenario: Disposición LWBS cuando el paciente abandona sin ser atendido
    Dado una visita de emergencia activa del tenant actual
    Cuando establezco disposición "LWBS" (Left Without Being Seen)
    Entonces la visita actualiza su estado a "LWBS"
    Y el evento queda auditado
    # @AE: regla pendiente — definir umbral de tiempo automático para LWBS
