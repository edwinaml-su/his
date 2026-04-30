# language: es
# Épica: E5 — ADT
# Historias cubiertas: US-5.1, US-5.2
# TDR: §8.2
# Persona principal: P3 — Admisión
# Valor de negocio: Reducir tiempos de admisión electiva con pre-admisión y
# documentación pre-cargada.

@regression @adt @scheduled @es-SV
Característica: Admisión programada (electiva)
  Como personal de admisión (P3)
  Quiero pre-admitir pacientes electivos y completar admisión el día del ingreso
  Para cumplir el objetivo de admisión en menos de 3 minutos.

  Antecedentes:
    Dado el paciente "MRN-000456" identificado en MPI
    Y inicio sesión con rol "admision"

  @smoke
  Escenario: Pre-admisión 48 h antes del ingreso
    Cuando creo pre-admisión con servicio "Cirugía Programada", fecha "2026-05-02"
    Y vincula procedimiento "Colecistectomía laparoscópica"
    Entonces se crea "Encounter" tipo "ELECTIVE" en estado "PREADMITTED"
    Y se publica "PreAdmissionCreated"

  @complete
  Escenario: Conversión de pre-admisión a admisión efectiva
    Dado pre-admisión activa para "MRN-000456"
    Cuando el día programado capturo consentimientos quirúrgicos y firmas
    Y confirmo la admisión
    Entonces el Encounter pasa a "ADMITTED"
    Y se asigna cama según disponibilidad
    Y se imprime pulsera

  @cancel
  Escenario: Cancelación de pre-admisión por inasistencia
    Dado pre-admisión para fecha pasada "2026-04-29"
    Cuando ejecuto "Cancelar pre-admisión por NoShow"
    Entonces el Encounter pasa a "CANCELLED" con motivo "NO_SHOW"
    Y se libera la cama reservada si aplica
    Y se publica "PreAdmissionCancelled"

  @validation
  Escenario: Bloqueo si faltan consentimientos quirúrgicos
    Cuando intento confirmar admisión sin consentimiento "uso_anestesia"
    Entonces el sistema bloquea con lista de consentimientos faltantes
    Y NO emite "Admitted"
