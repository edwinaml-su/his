# language: es
@jci @ipsg_2 @P0
Característica: IPSG.2 — Comunicación efectiva en todos los puntos de traspaso y órdenes verbales

  Como profesional de salud en hospital con acreditación JCI
  Quiero que el sistema haga cumplir los protocolos de comunicación (SBAR, read-back, abreviaciones prohibidas)
  en cada orden verbal, cambio de turno y notificación de resultado crítico
  Para eliminar los errores de comunicación como causa de eventos adversos evitables

  Antecedentes:
    Dado un usuario "enf.turno@his.test" con rol "NURSE"
    Y un paciente con expediente N°"PAC-2026-00221" y banda GSRN "8018000000002345678901"
    Y un encuentro activo en servicio "UCI Piso 2"

  # ────────────────────────────────────────────────
  # SECCIÓN A: Órdenes verbales con read-back
  # ────────────────────────────────────────────────

  @happy_path
  Escenario: Registro de orden verbal con read-back completado y confirmación médica
    Dado el médico "dr.medina@his.test" dicta por teléfono la orden "Furosemida 40 mg IV STAT"
    Cuando la enfermera registra la orden verbal en el sistema con texto literal
    Y completa el campo "texto_readback" con la repetición de la orden
    Y el sistema pasa el estado de la orden a "registrada"
    Y el médico accede al sistema y confirma la lectura de la orden verbal
    Entonces el estado del "ece.verbal_order" cambia a "confirmada"
    Y el audit log registra el evento "VERBAL_ORDER_CONFIRMED" con timestamp del médico
    Y la indicación médica derivada puede ser firmada

  @gap_actual @validation @gate @P0
  Escenario: Sistema bloquea firma de indicación médica de origen verbal sin read-back confirmado
    Dado existe una orden verbal "VO-2026-00088" en estado "registrada" (pendiente de confirmación médica)
    Y la indicación médica "IND_MED-2026-04412" tiene origen "verbal_order_id = VO-2026-00088"
    Cuando la enfermera intenta firmar la indicación médica para administrar el medicamento
    Entonces el sistema debe rechazar la firma con mensaje
      "Esta indicación tiene origen en orden verbal sin confirmar. El médico debe confirmar el read-back antes de ejecutar."
    Y debe mostrar el estado actual de la orden verbal "VO-2026-00088"
    Y debe registrar el intento bloqueado en audit log con evento "IND_MED_BLOCKED_VERBAL_UNCONFIRMED"
    Y no debe crear ningún registro en "MedicationAdministration"
    # Estado: comportamiento DESEADO — gap IPSG.2-H1 P0 pendiente Sprint JCI-1.S2

  @edge_case
  Escenario: Orden verbal rechazada por el médico — ciclo de corrección
    Dado la enfermera registró la orden verbal "Ceftriaxona 2 g IV c/12h" con read-back
    Cuando el médico revisa y detecta un error en la dosis y selecciona "Rechazar"
    Y registra la observación "Dosis incorrecta: es 1 g, no 2 g"
    Entonces el estado de la orden verbal pasa a "rechazada"
    Y el sistema notifica a la enfermera con alerta urgente en Workflow Inbox
    Y la indicación derivada (si existía) queda suspendida automáticamente
    Y el ciclo no puede reabrirse — se debe crear una nueva orden verbal

  # ────────────────────────────────────────────────
  # SECCIÓN B: Abreviaciones prohibidas
  # ────────────────────────────────────────────────

  @happy_path
  Escenario: Nombre de procedimiento sin abreviaciones prohibidas pasa validación pre-firma
    Dado el médico redacta la indicación con descripción "Solución glucosada al 5% 500 ml IV a 60 ml/hora"
    Cuando el sistema ejecuta la validación de abreviaciones prohibidas al momento de firmar
    Entonces la validación pasa sin observaciones
    Y la indicación puede firmarse

  @gap_actual @validation @gate @P0
  Escenario: Sistema rechaza firma de indicación que contiene abreviación prohibida
    Dado el médico redacta la indicación con descripción "KCl conc. 20 mEq en 100 cc SF IV STAT"
    Y el catálogo "forbidden-abbreviations" incluye "conc." como abreviación prohibida
    Y el catálogo también incluye "cc" (debe usarse "ml") como abreviación prohibida
    Cuando el médico intenta firmar la indicación
    Entonces el sistema debe rechazar la firma con mensaje
      "La descripción contiene abreviaciones prohibidas: 'conc.', 'cc'. Corrija antes de firmar."
    Y debe listar cada abreviación detectada con su sustitución recomendada
    Y no debe persistir el documento en base de datos
    Y debe registrar el intento en audit log con evento "IND_MED_BLOCKED_FORBIDDEN_ABBR"
    # Estado: comportamiento DESEADO — gap IPSG.2-H2 P0 pendiente Sprint JCI-1.S2

  @edge_case
  Escenario: Validación de abreviaciones en nota de consulta quirúrgica pre-operatoria
    Dado el cirujano redacta el CONS_QX con el nombre del procedimiento "Colposcopia c/bx"
    Y el catálogo registra "c/bx" (con biopsia) como abreviación prohibida en texto de procedimiento
    Cuando el cirujano intenta firmar el CONS_QX
    Entonces el sistema rechaza la firma indicando "Abreviación prohibida en nombre del procedimiento: 'c/bx'"
    Y sugiere la forma completa "con biopsia"
    Y el CONS_QX permanece en estado "borrador"

  # ────────────────────────────────────────────────
  # SECCIÓN C: SBAR handoff entre turnos de enfermería
  # ────────────────────────────────────────────────

  @happy_path
  Escenario: Enfermera completa handoff SBAR al cerrar turno con paciente activo
    Dado el encuentro "ENC-2026-00221" está activo con diagnóstico principal "Neumonía adquirida en comunidad"
    Y la enfermera está cerrando su turno de 7:00 a 15:00
    Cuando la enfermera llena el formulario SBAR en "ece.registro_enfermeria":
      | Situación    | Paciente masculino 58 años, PAC-2026-00221, DX neumonía, turno sin complicaciones     |
      | Antecedentes | HTA, DM2. Alérgico penicilina. Ingresó hace 2 días con hipoxemia.                     |
      | Evaluación   | SatO2 96% con O2 2 LPM. FR 20. Afebril. Creatinina control pendiente de resultado.    |
      | Recomendación| Verificar resultado creatinina a las 16h. Continuar O2 bajo flujo. Posición semisentada|
    Y guarda el registro de enfermería
    Entonces el registro queda en estado "firmado" con campo "sbar" no nulo
    Y el sistema habilita el cierre de turno para este paciente

  @gap_actual @validation @gate @P0
  Escenario: Sistema bloquea cierre de turno si SBAR no está completado con paciente activo
    Dado el encuentro "ENC-2026-00221" está activo
    Y la enfermera intenta cerrar su registro de turno sin llenar el campo SBAR
    Cuando intenta cambiar el estado del "ece.registro_enfermeria" a "cerrado"
    Entonces el sistema debe rechazar el cierre con mensaje
      "No se puede cerrar el registro: el handoff SBAR es obligatorio para pacientes con encuentro activo"
    Y debe resaltar visualmente los 4 campos SBAR vacíos (Situación, Antecedentes, Evaluación, Recomendación)
    Y debe registrar el intento en audit log con evento "HANDOFF_SBAR_MISSING"
    Y el registro permanece en estado "en_revision"
    # Estado: comportamiento DESEADO — gap IPSG.2-H3 P0 pendiente Sprint JCI-1.S2

  @edge_case
  Escenario: SBAR parcial no es suficiente — todos los campos son obligatorios
    Dado la enfermera llena solo "Situación" y "Evaluación" del SBAR
    Y deja "Antecedentes" y "Recomendación" vacíos
    Cuando intenta cerrar el registro de turno
    Entonces el sistema rechaza con mensaje "SBAR incompleto: faltan campos Antecedentes, Recomendación"
    Y permite guardar como borrador para continuar llenando
    Y no permite el cierre definitivo del turno

  # ────────────────────────────────────────────────
  # SECCIÓN D: Notificación de resultado crítico
  # ────────────────────────────────────────────────

  @happy_path
  Escenario: Resultado crítico de laboratorio notificado con read-back dentro del SLA de 60 minutos
    Dado el laboratorio publica el resultado crítico "Potasio 2.1 mEq/L" para "PAC-2026-00221"
    Y el resultado cruza el umbral de valor crítico definido en el catálogo
    Cuando el sistema crea el registro en "critical_result_notification" con timestamp "2026-05-30T09:15:00"
    Y el médico de guardia es notificado vía Workflow Inbox
    Y el médico accede al resultado a las "2026-05-30T09:42:00"
    Y el médico realiza el read-back: "Confirmo: Potasio 2.1 mEq/L en PAC-2026-00221"
    Entonces el campo "read_back_at" se registra en "2026-05-30T09:42:00"
    Y el tiempo de respuesta es 27 minutos, dentro del SLA de 60 minutos
    Y el audit log emite el evento "critical_result.read_back_confirmed"
    Y el resultado queda en estado "confirmado"

  @gap_actual @validation @gate @P0
  Escenario: Watchdog activo marca SLA vencido si resultado crítico no tiene read-back en 60 minutos
    Dado el laboratorio publicó el resultado crítico "Glucosa 28 mg/dL" para "PAC-2026-00221"
    Y el registro en "critical_result_notification" tiene timestamp "2026-05-30T10:00:00"
    Y han transcurrido 65 minutos sin que nadie registre el read-back
    Entonces el sistema debe marcar la notificación como "SLA_VENCIDO"
    Y debe emitir alerta escalada al jefe de guardia en Workflow Inbox
    Y debe registrar el evento "CRITICAL_RESULT_SLA_BREACH" en audit log
    Y el KPI de tiempo de notificación de críticos debe reflejarlo en el dashboard
    # Estado: comportamiento DESEADO — gap SLA watchdog no conectado, pendiente Sprint JCI-1.S2

  @edge_case
  Escenario: Resultado crítico fuera de horario de guardia médica — escalada automática
    Dado el laboratorio publica un resultado crítico a las "02:30" cuando el médico asignado no ha respondido en 20 minutos
    Cuando el poller de SLA detecta la ausencia de read-back
    Entonces el sistema escala la notificación al médico de turno de guardia de segundo nivel
    Y registra la escalada en "critical_result_notification.escalado_a" con timestamp
    Y la alerta persiste hasta que algún médico autorizado registre el read-back
    Y el caso queda marcado para revisión en el reporte de gestión de resultados críticos
