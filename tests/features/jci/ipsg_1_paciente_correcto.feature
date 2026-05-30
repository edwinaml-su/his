# language: es
@jci @ipsg_1 @P1
Característica: IPSG.1 — Identificación correcta del paciente en todos los puntos de cuidado

  Como profesional de salud en hospital con acreditación JCI
  Quiero que el sistema exija dos identificadores únicos del paciente (GSRN + documento legal)
  en cada punto de cuidado (medicación, toma de muestras, procedimientos)
  Para garantizar que ninguna acción clínica se ejecute sobre el paciente equivocado

  Antecedentes:
    Dado un usuario "enf.bedside@his.test" con rol "NURSE"
    Y un paciente con expediente N°"PAC-2026-00117" y banda GSRN "8018000000001234567890"
    Y el paciente tiene DUI registrado "04561234-5"
    Y un encuentro activo en servicio "Medicina Interna Piso 3 Cama 12"

  @happy_path
  Escenario: Administración de medicamento con doble verificación exitosa de identidad
    Dado el paciente está en cama con banda GSRN legible
    Y una prescripción activa de "Metoprolol 50 mg VO" para el paciente
    Cuando la enfermera escanea la banda GSRN "8018000000001234567890" en BCMA
    Y el sistema confirma que el GSRN corresponde al expediente "PAC-2026-00117"
    Y la enfermera confirma el segundo identificador DUI "04561234-5" visualmente
    Entonces el sistema habilita la pantalla de administración del medicamento
    Y registra la verificación en "MedicationAdministration.patientWristbandScanned = true"
    Y el audit log contiene el evento "BCMA_PATIENT_VERIFIED" con timestamp

  @validation @gate
  Escenario: BCMA bloquea administración si GSRN no coincide con el paciente de la prescripción
    Dado una prescripción activa de "Amoxicilina 500 mg VO" asignada al paciente "PAC-2026-00117"
    Cuando la enfermera escanea la banda GSRN "8018000000009999999999" (pertenece a otro paciente)
    Entonces el sistema debe rechazar la operación con hard-stop "HS-01 PACIENTE_INCORRECTO"
    Y debe mostrar el mensaje "El identificador escaneado no corresponde al paciente de esta prescripción"
    Y debe registrar el intento en audit log con clasificación "IDENTIDAD_MISMATCH"
    Y no debe registrar ninguna administración en "MedicationAdministration"

  @gap_actual @validation @gate @P1
  Escenario: Toma de muestra lab bloquea extracción sin re-escaneo GSRN en el punto bedside
    Dado una solicitud de laboratorio "SOL_EST-2026-04521" activa para el paciente "PAC-2026-00117"
    Y la solicitud fue creada por el médico en enfermería de turno
    Cuando el flebotomista intenta registrar la toma de muestra en el punto de extracción
    Y no ha escaneado la banda GSRN del paciente en este punto
    Entonces el sistema debe rechazar la confirmación de toma con mensaje
      "Se requiere re-verificación de identidad: escanee la banda GSRN del paciente"
    Y no debe permitir marcar la muestra como "extraída"
    Y debe registrar el intento bloqueado en audit log
    # Estado: comportamiento DESEADO — gap US.JCI.5.3 pendiente Sprint JCI-1.S1

  @gap_actual @validation @gate @P1
  Escenario: Sistema impide crear indicación médica en encuentro sin GSRN registrado
    Dado un encuentro "ENC-2026-00889" activo donde el campo GSRN de la pulsera es nulo
    Cuando el médico intenta crear la indicación "IND_MED" para ese encuentro
    Entonces el sistema debe rechazar la creación con mensaje
      "No se puede prescribir: el paciente no tiene banda GSRN registrada en este episodio"
    Y debe sugerir la acción "Emitir pulsera desde Admisión"
    Y debe registrar el intento en audit log con evento "IND_MED_BLOCKED_NO_GSRN"
    # Estado: comportamiento DESEADO — gap US.JCI.5.4 pendiente Sprint JCI-1.S1

  @happy_path
  Escenario: Verificación de identidad correcta en procedimiento pre-operatorio Sign-In
    Dado el paciente tiene programada una cirugía "COLECISTECTOMÍA LAPAROSCÓPICA"
    Y el encuentro está en fase "PRE-QUIRÚRGICA"
    Cuando el cirujano ejecuta la pausa "Sign-In" del WHO Checklist
    Y el sistema solicita la confirmación de identidad con dos identificadores
    Y el cirujano confirma GSRN "8018000000001234567890" y nombre completo del paciente
    Entonces el WHO Checklist registra "identidad_confirmada = true" en Sign-In
    Y el ítem "Identidad del paciente verificada con 2 identificadores" queda marcado
    Y se puede continuar con el resto del Sign-In

  @edge_case
  Escenario: Pulsera GSRN dañada — protocolo de verificación manual alternativo
    Dado la banda GSRN del paciente está dañada y el código de barras no es legible
    Y el paciente está consciente y orientado
    Cuando la enfermera intenta administrar "Enalapril 5 mg VO"
    Y selecciona la opción "Banda dañada — verificación manual"
    Y registra la confirmación verbal: nombre completo + DUI pronunciados por el paciente
    Y un segundo profesional de salud presente firma como testigo de la verificación
    Entonces el sistema registra el evento "WRISTBAND_DAMAGED_MANUAL_VERIFY"
    Y habilita la administración con nota de auditoría obligatoria
    Y genera alerta en Workflow Inbox para reposición urgente de pulsera
    Y el incidente queda en audit log para reporte a Seguridad del Paciente

  @gap_actual @validation @P1
  Escenario: Verificación de 2 identificadores en transfusión de sangre con compliance test
    Dado un paciente con prescripción de transfusión "PRC-2026-00045" (concentrado globular)
    Y el banco de sangre liberó el producto tras crossmatch exitoso
    Cuando la enfermera inicia el proceso de transfusión en BCMA
    Entonces el sistema debe exigir verificación explícita de dos identificadores antes de colgar el hemoderivado
    Y debe registrar "crossmatch_identity_verified = true" con firma de dos profesionales
    Y debe emitir compliance event "TRANSFUSION_2ID_VERIFIED" en audit log
    Y el test automatizado "ipsg1-transfusion-2id" debe estar en estado "passing"
    # Estado: comportamiento DESEADO — gap US.JCI.5.2 pendiente Sprint JCI-1.S1
