# language: es
# Épica: E5 — ADT
# Historias cubiertas: US-5.7
# TDR: §8.5
# Persona principal: P1 — Médico
# Valor de negocio: Cierre administrativo y notificación legal del fallecimiento con
# certificado médico digital y causas codificadas CIE-10.

@critical @adt @death @es-SV
Característica: Registro de defunción y certificado médico digital
  Como médico tratante (P1)
  Quiero registrar el fallecimiento con certificado médico firmado digitalmente
  Para cumplir requisitos clínicos y legales de cierre del Encounter.

  Antecedentes:
    Dado el paciente "MRN-000123" en estado crítico
    Y inicio sesión con rol "medico" con MFA

  @smoke
  Escenario: Registro de defunción con causas CIE-10 codificadas
    Cuando registro fallecimiento con:
      | campo               | valor                                |
      | fecha_hora          | 2026-04-30 18:42                     |
      | causa_directa       | I46.9 (Paro cardíaco no especificado)|
      | causa_intermedia    | I50.0 (Insuficiencia cardiaca CHF)   |
      | causa_basica        | I25.10 (Cardiopatía isquémica)       |
      | constancia_clinica  | (texto íntegro)                      |
    Y firmo certificado con MFA
    Entonces se cierra el Encounter como "DISCHARGED" tipo "FALLECIMIENTO"
    Y la HospitalAccount se cierra
    Y la cama pasa a "sucia"
    Y se genera "CertificadoMedicoDefuncion" como PDF firmado digitalmente
    Y se registra en morgue del establecimiento
    Y se publica "DeathRegistered"

  @validation
  Escenario: Bloqueo si causas no son CIE-10 válidas
    Cuando ingreso causa "no aplica" como texto libre
    Entonces el sistema bloquea con "Causas deben ser códigos CIE-10 válidos"

  @notification
  Escenario: Notificación stub a registro civil (futuro)
    Cuando se registra defunción exitosa
    Entonces se publica evento "DeathNotificationPending" en outbox
    Y queda en cola para integración futura con registro civil SV
    # TODO refinar con super-usuario clínico:
    # endpoint oficial RNPN/MINSAL para envío automático del certificado.

  @audit
  Escenario: Defunción auditada de forma reforzada
    Cuando se registra fallecimiento
    Entonces audit_log registra entrada "DEATH_REGISTERED" con sensibilidad "alta"
    Y notifica al jefe de servicio para revisión de mortalidad
