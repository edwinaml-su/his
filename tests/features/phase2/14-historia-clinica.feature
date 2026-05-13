# language: es
# Épica: E14 — Historia Clínica Electrónica (EHR Notes)
# TDR: §14 HCE
# Stack backend: ehrNotesRouter (skeleton Wave 6)
# Persona principal: P5 — Médico
# Valor: Notas SOAP inmutables tras la firma y diagnósticos asociados al encounter.

@phase2 @ehr-notes @es-SV
Característica: Notas clínicas SOAP con inmutabilidad post-firma
  Como médico (P5)
  Quiero registrar notas clínicas, firmarlas y agregar adendas si es necesario
  Para que la documentación clínica sea inmutable y auditable.

  Antecedentes:
    Dado un encounter activo del paciente "MRN-000500" en el tenant actual
    Y inicio sesión con rol "medico"

  @smoke @happy
  Escenario: Crear nota SOAP y firmarla como autor
    Cuando creo una nota tipo "PROGRESS" con secciones SOAP completas
    Y la firmo como autor de la nota
    Entonces la nota queda firmada con timestamp y autor registrado

  @edge @forbidden
  Escenario: Rechazar firma cuando el firmante no es el autor
    Dada una nota tipo "PROGRESS" creada por el médico "A"
    Cuando el médico "B" intenta firmar la nota
    Entonces el sistema rechaza con "prohibido"
    Y la nota permanece sin firmar

  @edge @addendum
  Escenario: Crear adenda solo sobre nota firmada
    Dada una nota original aún no firmada
    Cuando intento crear una adenda
    Entonces el sistema responde "no encontrado"
    Y no se crea la adenda
