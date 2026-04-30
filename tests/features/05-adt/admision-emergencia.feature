# language: es
# Épica: E5 — ADT (Admisión, Traslados, Altas, Censo)
# Historias cubiertas: US-5.2, US-5.3, US-5.8, US-5.10
# TDR: §8 (ADT), §12 (Emergencias)
# Persona principal: P3 — Admisión / P4 — Triador (entrada conjunta)
# Valor de negocio: Admitir pacientes de emergencia en minutos, asegurando trazabilidad
# auditada de cada paso desde la llegada hasta la asignación de cama o el alta.

@critical @adt @emergency @es-SV
Característica: Admisión de paciente vía emergencia
  Como personal de admisión / triage (P3, P4)
  Quiero registrar la llegada del paciente, identificarlo, triarlo y asignarle cama o alta
  Para que cada paso quede auditado y el censo se actualice en tiempo real.

  Antecedentes:
    Dado que el establecimiento "Hospital Avante San Salvador" tiene módulo "Emergencias" activo
    Y existe el servicio "Emergencia Adultos" con 12 boxes (3 disponibles)
    Y existe el servicio "Hospitalización Medicina Interna" con camas:
      | cama  | estado     |
      | MI-201| libre      |
      | MI-202| ocupada    |
      | MI-203| sucia      |
      | MI-204| libre      |
    Y existen consentimientos vigentes versión "v3-2026"
    Y inicio sesión con rol que combina "admision" y "triador"

  # ----------------------------------------------------------------------
  # Golden path - llegada a cama hospitalaria
  # ----------------------------------------------------------------------
  @smoke @golden
  Escenario: Llegada a emergencia, identificación, triage, ingreso a cama hospitalaria
    Cuando registro la llegada del paciente con DUI "04567823-4"
    Entonces el sistema recupera el paciente "María Elena Hernández López" del MPI
    Y crea un "Encounter" tipo "EMERGENCY" en estado "ARRIVED"
    Y emite el evento "PatientArrived"

    Cuando ejecuto el triage Manchester con flujograma "Dolor torácico"
    Y marco discriminador "dolor severo + diaforesis"
    Y se asigna nivel "Naranja"
    Entonces el Encounter pasa a estado "TRIAGED"
    Y se emite "Triaged"

    Cuando capturo el consentimiento informado "v3-2026" con firma digital del paciente
    Entonces el sistema almacena el token de consentimiento con timestamp
    Y emite "ConsentCaptured"

    Cuando imprimo la pulsera con código de barras y QR del MRN
    Entonces el evento "WristbandPrinted" se publica
    Y la pulsera contiene MRN, nombre, fecha de nacimiento y alergias críticas

    Cuando admito formalmente al paciente al servicio "Emergencia Adultos / Box-3"
    Entonces se crea una "HospitalAccount" abierta
    Y el Encounter pasa a estado "ADMITTED"
    Y el evento "Admitted" se publica con referencias al box

    Cuando el médico decide hospitalizar y solicita cama "MI-201"
    Entonces el sistema valida disponibilidad y aislamiento
    Y la cama "MI-201" pasa a estado "ocupada"
    Y el Encounter se vincula a la cama
    Y el censo de "Medicina Interna" se actualiza en tiempo real (Supabase Realtime)
    Y emite "BedAssigned"

    Y todos los eventos quedan registrados en audit_log con hash encadenado válido

  # ----------------------------------------------------------------------
  # Llegada con paciente nuevo (no en MPI)
  # ----------------------------------------------------------------------
  @new-patient
  Escenario: Llegada de paciente no registrado - mini-registro y admisión
    Cuando registro la llegada con DUI "06789012-3"
    Y el sistema NO encuentra el paciente en el MPI
    Entonces ofrece "Registrar paciente rápido" con campos mínimos
    Cuando capturo nombres, fecha de nacimiento, sexo y DUI validado
    Entonces se crea el paciente y el Encounter "EMERGENCY/ARRIVED" en una sola transacción
    Y el evento "PatientRegistered" precede a "PatientArrived" en el outbox

  # ----------------------------------------------------------------------
  # Llegada NN crítica
  # ----------------------------------------------------------------------
  @nn @code-blue
  Escenario: Llegada de paciente NN inconsciente con activación inmediata
    Dado que llega un paciente inconsciente sin documento
    Cuando registro como NN con sexo aparente "M" y edad estimada "55"
    Entonces el sistema asigna ID "NN-AAAAMMDD-NNN"
    Y permite saltar la captura de consentimiento marcándolo como "diferido_emergencia"
    Y al detectar paro cardiorrespiratorio activa "Código Azul" inmediato
    Y la admisión queda en estado "ADMITTED" pendiente de identificación
    Y todos los pasos diferidos quedan en lista "pendientes_post_estabilizacion"

  # ----------------------------------------------------------------------
  # Asignación de cama bloqueada por aislamiento
  # ----------------------------------------------------------------------
  @bed-isolation
  Escenario: Bloqueo de asignación de cama por incompatibilidad de cohorte
    Dado un paciente con bandera de aislamiento "contacto_respiratorio"
    Y la cama "MI-201" está libre pero comparte habitación con paciente sin aislamiento
    Cuando intento asignar la cama "MI-201"
    Entonces el sistema bloquea la asignación
    Y muestra "Cama incompatible: cohorte respiratoria requerida. Camas sugeridas: MI-204"
    Y NO se emite "BedAssigned"

  # ----------------------------------------------------------------------
  # Alta directa desde emergencia
  # ----------------------------------------------------------------------
  @discharge-er
  Escenario: Alta desde emergencia tras estabilización (sin hospitalización)
    Dado un Encounter "EMERGENCY/ADMITTED" del paciente
    Cuando el médico registra epicrisis breve y decide alta tipo "MEDICA"
    Y firma electrónicamente la nota de egreso
    Entonces el Encounter pasa a estado "DISCHARGED"
    Y la HospitalAccount se cierra (marca, no facturación detallada en MVP)
    Y se emite "Discharged" con tipo "MEDICA"
    Y el censo se libera

  # ----------------------------------------------------------------------
  # Alta contra opinión médica
  # ----------------------------------------------------------------------
  @discharge-against
  Escenario: Alta contra opinión médica con consentimiento firmado
    Cuando el paciente solicita egreso voluntario
    Y firma "Egreso contra opinión médica - v2"
    Entonces el sistema registra alta tipo "VOLUNTARIA_CONTRA_OPINION"
    Y exige firma del médico responsable
    Y emite "Discharged" con motivo y advertencias
    Y queda auditado el evento como sensible

  # ----------------------------------------------------------------------
  # Trazabilidad y auditoría
  # ----------------------------------------------------------------------
  @audit @critical
  Escenario: Toda la trayectoria de emergencia queda auditada e inmutable
    Dado que un paciente recorre llegada → triage → admisión → cama → alta
    Cuando consulto el audit_log filtrando por su MRN
    Entonces veo en orden cronológico todos los eventos:
      | evento               |
      | PatientArrived       |
      | Triaged              |
      | ConsentCaptured      |
      | WristbandPrinted     |
      | Admitted             |
      | BedAssigned          |
      | Discharged           |
    Y cada entrada tiene hash encadenado verificado
    Y ningún evento puede ser modificado ni borrado (append-only)
