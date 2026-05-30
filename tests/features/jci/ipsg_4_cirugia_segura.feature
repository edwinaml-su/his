# language: es
@jci @ipsg_4 @P1
Característica: IPSG.4 — Cirugía segura y Protocolo Universal WHO (3 pausas)

  Como integrante del equipo quirúrgico en hospital con acreditación JCI
  Quiero que el sistema haga cumplir el Protocolo Universal WHO
  con las 3 pausas obligatorias (Sign-In, Time-Out, Sign-Out) y marcado estructurado del sitio
  Para garantizar que el procedimiento correcto se realiza en el sitio correcto sobre el paciente correcto

  Antecedentes:
    Dado un usuario "cirujano.titular@his.test" con rol "SURGEON"
    Y un usuario "anestesiologo@his.test" con rol "ANESTHESIOLOGIST"
    Y un usuario "enf.quirofano@his.test" con rol "OR_NURSE"
    Y un paciente con expediente N°"PAC-2026-00445" y banda GSRN "8018000000004567890123"
    Y el paciente tiene un programa quirúrgico "PROG_QX-2026-00112" aprobado
    Y el encuentro está activo en servicio "Quirófano 2"

  # ────────────────────────────────────────────────
  # SECCIÓN A: Sign-In — Verificación previa a inducción anestésica
  # ────────────────────────────────────────────────

  @happy_path
  Escenario: Sign-In completado correctamente antes de inducción anestésica
    Dado el "WHO_CHECK-2026-00112" está en estado "borrador"
    Y el anestesiólogo inicia la pausa "Sign-In" antes de inducción
    Cuando el equipo completa todos los ítems del Sign-In:
      | Ítem                                         | Estado    |
      | Identidad del paciente confirmada (2 IDs)    | Marcado   |
      | Consentimiento informado firmado             | Marcado   |
      | Sitio quirúrgico marcado                     | Marcado   |
      | Lateralidad documentada: Derecha             | Registrado|
      | Alergias conocidas revisadas                 | Marcado   |
      | Riesgo de vía aérea difícil evaluado         | Marcado   |
    Y el anestesiólogo firma el Sign-In
    Entonces el "WHO_CHECK" registra "sign_in_at" con timestamp y firmante
    Y el estado avanza a "sign_in_completo"
    Y el audit log registra el evento "WHO_SIGNIN_COMPLETED"

  @gap_actual @validation @gate @P1
  Escenario: Sistema bloquea firma de Sign-In si faltan ítems mínimos obligatorios
    Dado el equipo ha marcado solo 3 de los 6 ítems mínimos del Sign-In
    Y el campo de lateralidad está vacío para un procedimiento en miembro derecho
    Cuando el anestesiólogo intenta firmar el Sign-In
    Entonces el sistema debe rechazar la firma con mensaje
      "Sign-In incompleto: deben marcarse todos los ítems obligatorios antes de firmar"
    Y debe resaltar los ítems sin marcar y el campo de lateralidad vacío
    Y no debe cambiar el estado del "WHO_CHECK"
    Y debe registrar el intento en audit log con evento "WHO_SIGNIN_INCOMPLETE_ATTEMPT"
    # Estado: comportamiento DESEADO — validación de ítems mínimos sin enforcement en BD, gap US.JCI.5.13

  @gap_actual @validation @gate @P1
  Escenario: Sistema registra lateralidad de forma estructurada en site marking del Sign-In
    Dado el procedimiento es "Artroscopia de rodilla derecha"
    Y el anestesiólogo inicia el Sign-In
    Cuando el sistema presenta el campo estructurado de marcado de sitio
    Y el usuario selecciona lateralidad "Derecha" en el campo "site_marking.lateralidad"
    Y el usuario confirma la marca física en el campo "site_marking.confirmado_fisicamente = true"
    Entonces el "WHO_CHECK" persiste el objeto "site_marking" con:
      | lateralidad              | DERECHA   |
      | confirmado_fisicamente   | true      |
      | firmado_por              | anestesiologo@his.test |
      | firmado_at               | timestamp |
    Y el ítem "Sitio marcado y lateralidad registrada" queda marcado automáticamente
    # Estado: comportamiento DESEADO — site_marking estructurado con lateralidad pendiente US.JCI.5.13

  # ────────────────────────────────────────────────
  # SECCIÓN B: Time-Out — Inmediatamente antes de la incisión
  # ────────────────────────────────────────────────

  @happy_path
  Escenario: Time-Out completado con todo el equipo presente antes de la incisión
    Dado el Sign-In está en estado "sign_in_completo"
    Y el cirujano, anestesiólogo y enfermera de quirófano están presentes
    Cuando el cirujano inicia la pausa "Time-Out" y el equipo confirma verbalmente:
      | Ítem                                              | Estado    |
      | Identidad del paciente (nombre + GSRN)            | Confirmado|
      | Procedimiento correcto confirmado                 | Confirmado|
      | Sitio quirúrgico correcto (rodilla derecha)       | Confirmado|
      | Posición del paciente correcta                    | Confirmado|
      | Disponibilidad de implantes/equipo especial       | Confirmado|
      | Profilaxis antibiótica administrada en últimas 60 min | Confirmado|
      | Imágenes diagnósticas desplegadas (si aplica)     | Confirmado|
    Y los 3 miembros del equipo firman el Time-Out en el sistema
    Entonces el "WHO_CHECK" registra "time_out_at" con timestamp
    Y registra "time_out_firmantes" con los 3 roles presentes
    Y el estado avanza a "time_out_completo"

  @validation @gate
  Escenario: Sistema bloquea inicio de ACTO_QX si WHO_CHECK no está en estado firmado
    Dado el "WHO_CHECK-2026-00112" está en estado "sign_in_completo" (Time-Out pendiente)
    Cuando el cirujano intenta crear el documento "ACTO_QX-2026-00112"
    Entonces el trigger SQL "147_who_checklist_rls_insert_check" rechaza el insert
    Y el sistema devuelve error "PRECONDITION_FAILED: WHO Checklist debe estar en estado 'firmado' para iniciar el acto quirúrgico"
    Y no se crea ningún registro en "documento_instancia" para ACTO_QX
    Y el audit log registra "ACTO_QX_BLOCKED_NO_WHO_CHECK"

  @edge_case
  Escenario: Alerta cuando el equipo quirúrgico presente difiere del equipo planificado en PROG_QX
    Dado el "PROG_QX-2026-00112" planificó al cirujano "dr.martinez@his.test" como titular
    Y durante el Time-Out el sistema detecta que el firmante titular es "dr.sustituto@his.test"
    Cuando el Time-Out es firmado por el equipo actual
    Entonces el sistema registra el cambio de cirujano titular en el "WHO_CHECK"
    Y genera una alerta en Workflow Inbox al Jefe de Cirugía indicando "Cambio de cirujano titular no planificado"
    Y el audit log registra el evento "WHO_TIMEOUT_SURGEON_SUBSTITUTION"
    Y el acto quirúrgico puede proceder pero la alerta queda abierta para revisión administrativa

  # ────────────────────────────────────────────────
  # SECCIÓN C: Sign-Out — Antes de que el paciente salga del quirófano
  # ────────────────────────────────────────────────

  @happy_path
  Escenario: Sign-Out completado correctamente con conteos confirmados
    Dado el "WHO_CHECK-2026-00112" está en estado "time_out_completo"
    Y el procedimiento quirúrgico ha concluido
    Cuando la enfermera de quirófano registra el Sign-Out con:
      | Ítem                                         | Resultado  |
      | Nombre del procedimiento realizado           | Artroscopia de rodilla derecha |
      | Conteo de gasas: inicial vs final            | 12 / 12    |
      | Conteo de instrumental: inicial vs final     | 45 / 45    |
      | Conteo de agujas: inicial vs final           | 8 / 8      |
      | Especímenes etiquetados correctamente        | 1 muestra líquido articular |
      | Incidencias de equipos a reportar            | Ninguna    |
    Y firma el Sign-Out
    Entonces el "WHO_CHECK" registra "sign_out_at" con timestamp y firmante
    Y el estado del "WHO_CHECK" avanza a "firmado"
    Y el estado del "ACTO_QX" puede cerrarse
    Y el audit log emite "WHO_SIGNOUT_COMPLETED"

  @validation @gate
  Escenario: Sistema bloquea Sign-Out si hay discrepancia en conteo de gasas o instrumental
    Dado el conteo inicial de gasas fue 12
    Y el conteo final de gasas es 11 (falta 1 gasa)
    Cuando la enfermera intenta registrar el Sign-Out con esta discrepancia
    Entonces el sistema debe bloquear el Sign-Out con alerta crítica
      "ALERTA DE SEGURIDAD: Discrepancia en conteo de gasas (inicial: 12, final: 11). Verificar campo operatorio antes de cerrar."
    Y no debe cambiar el estado del "WHO_CHECK"
    Y debe generar notificación de alta prioridad al cirujano y anestesiólogo presentes
    Y debe registrar el evento "SURGICAL_COUNT_DISCREPANCY" en audit log

  @edge_case
  Escenario: Reoperación de urgencia — Time-Out acelerado con documentación mínima obligatoria
    Dado el paciente regresa a quirófano de urgencia por sangrado post-operatorio
    Y el estado es crítico y no permite el Time-Out completo de rutina
    Cuando el cirujano activa el modo "Urgencia — Time-Out abreviado"
    Entonces el sistema permite un Time-Out reducido con los ítems críticos mínimos:
      | Identidad del paciente (GSRN)      | Obligatorio |
      | Procedimiento de urgencia descrito | Obligatorio |
    Y registra la justificación de urgencia en "who_check.urgencia_justificacion"
    Y genera la alerta "TIME_OUT_URGENCIA_ABREVIADO" en audit log
    Y el evento queda marcado para revisión en reporte de seguridad quirúrgica
