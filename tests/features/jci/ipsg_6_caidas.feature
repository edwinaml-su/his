# language: es
@jci @ipsg_6 @P1
Característica: IPSG.6 — Reducción del riesgo de daño al paciente por caídas

  Como profesional de salud en hospital con acreditación JCI
  Quiero que el sistema aplique la Escala Morse al ingreso, re-evalúe con SLA por turno
  y registre las intervenciones tomadas
  Para demostrar un programa estructurado de prevención de caídas ante el surveyor JCI

  Antecedentes:
    Dado un usuario "enf.valoracion@his.test" con rol "NURSE"
    Y un paciente con expediente N°"PAC-2026-00556" y banda GSRN "8018000000005678901234"
    Y un encuentro activo en servicio "Medicina Interna Piso 5 Cama 08"

  # ────────────────────────────────────────────────
  # SECCIÓN A: Evaluación Morse al ingreso
  # ────────────────────────────────────────────────

  @happy_path
  Escenario: Valoración inicial de enfermería registra Morse con clasificación correcta al ingreso
    Dado el paciente ingresó hace 30 minutos al servicio
    Cuando la enfermera de turno completa la "VAL_INI_ENF" con los ítems de Escala Morse:
      | Ítem                                  | Valor | Puntaje |
      | Historial de caídas en últimos 3 meses| Sí    | 25      |
      | Diagnóstico secundario                | Sí    | 15      |
      | Apoyo en la deambulación              | Mueble| 30      |
      | Terapia IV / heparina IV              | No    | 0       |
      | Marcha                                | Débil | 10      |
      | Estado mental                         | Normal| 0       |
    Entonces el sistema calcula un puntaje Morse total de 80
    Y clasifica el riesgo como "ALTO" (Morse >= 45)
    Y el "PatientContextBar" muestra el badge "RIESGO CAÍDA ALTO" en color rojo
    Y el audit log registra el evento "MORSE_ASSESSED" con puntaje y clasificación

  @happy_path
  Escenario: Protocolo de intervenciones por nivel de riesgo se activa automáticamente
    Dado la valoración inicial arrojó un puntaje Morse de 80 (riesgo ALTO)
    Cuando la enfermera accede a la pantalla de intervenciones de caída
    Entonces el componente "FallRiskInterventions" despliega el protocolo de intervenciones nivel ALTO:
      | Intervención                                    | Nivel mínimo |
      | Cama en posición más baja                       | ALTO         |
      | Barandas levantadas (4 barandas)                | ALTO         |
      | Timbre al alcance del paciente                  | MEDIO-ALTO   |
      | Pulsera/señalización visual "Riesgo de Caída"   | ALTO         |
      | Rondas horarias de verificación                 | ALTO         |
      | Evaluación de calzado antideslizante            | ALTO         |

  # ────────────────────────────────────────────────
  # SECCIÓN B: Registro de intervenciones tomadas (con trazabilidad)
  # ────────────────────────────────────────────────

  @gap_actual @validation @gate @P1
  Escenario: Sistema registra cuáles intervenciones se implementaron — no solo las recomendadas
    Dado el puntaje Morse es 80 y el protocolo despliega 6 intervenciones nivel ALTO
    Cuando la enfermera implementa las intervenciones y las registra en el sistema:
      | Intervención                   | Implementada | Observación               |
      | Cama en posición más baja      | Sí           | —                         |
      | Barandas levantadas            | Sí           | —                         |
      | Timbre al alcance              | Sí           | —                         |
      | Señalización "Riesgo de Caída" | Sí           | Pulsera colocada en muñeca|
      | Rondas horarias                | Sí           | Programadas en turno      |
      | Calzado antideslizante         | No           | Paciente sin calzado propio — pendiente familiar |
    Y firma el registro de intervenciones
    Entonces el sistema persiste el registro de "fall_risk_interventions_log" con cada ítem y su estado
    Y el audit log contiene el evento "FALL_INTERVENTIONS_RECORDED" con firma y timestamp
    Y el Jefe de Enfermería puede consultar la trazabilidad de intervenciones por paciente
    # Estado: comportamiento DESEADO — componente muestra protocolo pero no registra implementación, gap US.JCI.5.15

  @gap_actual @validation @P1
  Escenario: Intervención no implementada requiere justificación documentada
    Dado la enfermera marca "Calzado antideslizante" como "No implementada"
    Cuando intenta guardar el registro de intervenciones
    Entonces el sistema debe exigir una justificación en el campo de observación para ítems no implementados
    Y no debe permitir guardar el ítem "No implementada" sin texto de justificación
    Y la intervención pendiente queda en una cola de seguimiento para el próximo turno
    # Estado: comportamiento DESEADO — requiere campo obligatorio en registro de intervención omitida

  # ────────────────────────────────────────────────
  # SECCIÓN C: Re-evaluación Morse con SLA por turno
  # ────────────────────────────────────────────────

  @happy_path
  Escenario: Re-evaluación Morse completada dentro del SLA de 24 horas para paciente de alto riesgo
    Dado el paciente tiene Morse inicial de 80 (ALTO) registrado hace 20 horas
    Y el Workflow Inbox ha emitido el ítem "MORSE_REEVALUATE" activo
    Cuando la enfermera del turno de tarde realiza la re-evaluación Morse
    Y el nuevo puntaje es 75 (sigue siendo ALTO)
    Entonces el sistema registra la nueva valoración con timestamp
    Y cierra el ítem "MORSE_REEVALUATE" en Workflow Inbox
    Y genera un nuevo ítem "MORSE_REEVALUATE" programado para las próximas 24 horas
    Y el audit log registra "MORSE_REEVALUATED" con delta de puntuación

  @gap_actual @validation @gate @P1
  Escenario: Sistema bloquea alta del paciente si Morse >45 y re-evaluación vencida
    Dado el paciente tiene Morse de 70 (ALTO) con última evaluación hace 26 horas
    Y el SLA de re-evaluación (24 horas para Morse >45) está vencido
    Y el ítem "MORSE_REEVALUATE" sigue abierto en Workflow Inbox
    Cuando el médico intenta crear la nota de alta del paciente
    Entonces el sistema debe rechazar la alta con mensaje
      "No se puede emitir alta: la re-evaluación de riesgo de caídas está vencida (última hace 26h, SLA: 24h)"
    Y debe mostrar el enlace directo al formulario de re-evaluación Morse
    Y debe registrar el intento bloqueado en audit log con evento "ALTA_BLOCKED_MORSE_SLA"
    # Estado: comportamiento DESEADO — alerta existe pero no bloquea alta, gap US.JCI.5.14

  @gap_actual @validation @P1
  Escenario: Watchdog de SLA escala alerta si Morse >45 sin re-evaluación en 24 horas
    Dado el paciente tiene Morse de 55 (ALTO) registrado hace 25 horas
    Y no se ha realizado re-evaluación
    Cuando el poller de SLA de Workflow Inbox ejecuta su ciclo
    Entonces debe escalar el ítem "MORSE_REEVALUATE" a prioridad "urgente"
    Y debe notificar a la jefatura de enfermería con evento de escalada
    Y debe registrar "MORSE_SLA_BREACH" en audit log con horas de vencimiento
    Y el KPI "tasa_reevaluacion_morse_en_plazo" debe reflejar el incumplimiento
    # Estado: comportamiento DESEADO — poller emite alerta inicial pero no escala ni bloquea

  @edge_case
  Escenario: Paciente con Morse que baja de ALTO a MEDIO — ajuste automático de frecuencia de re-evaluación
    Dado el paciente tenía Morse 60 (ALTO) y se re-evalúa con Morse 35 (MEDIO)
    Cuando la enfermera registra la nueva valoración
    Entonces el sistema ajusta la frecuencia de re-evaluación de 24h a 48h (estándar para MEDIO)
    Y actualiza el ítem en Workflow Inbox con el nuevo SLA
    Y el badge en "PatientContextBar" cambia a "RIESGO CAÍDA MEDIO" en color amarillo
    Y el protocolo de intervenciones se actualiza al nivel correspondiente

  # ────────────────────────────────────────────────
  # SECCIÓN D: Registro de evento de caída ocurrida
  # ────────────────────────────────────────────────

  @happy_path
  Escenario: Registro estructurado de evento de caída con notificación JCI para lesión moderada
    Dado el paciente sufrió una caída a las "14:35" del día actual
    Cuando la enfermera registra el evento en "ece.fall_event" con los datos:
      | Categoría          | Accidental (entorno hospitalario)    |
      | Hora del evento    | 2026-05-30T14:35:00                  |
      | Lesión resultante  | Moderada — hematoma en cadera izquierda |
      | Morse previo       | 80                                    |
      | Intervenciones activas al momento | Barandas levantadas, señalización  |
      | Descripción        | Paciente intentó levantarse sin asistencia para ir al baño |
    Y guarda el evento
    Entonces el sistema registra el "fall_event" con categoría "accidental"
    Y establece "notificado_jci = true" dado que lesión es >= moderada
    Y genera notificación obligatoria al Comité de Seguridad del Paciente en Workflow Inbox
    Y el KPI "tasa_caidas_por_1000_dias_cama" es actualizado en la matview

  @edge_case
  Escenario: Evento de caída leve — notificación JCI no obligatoria pero registro completo sí
    Dado el paciente sufrió una caída sin lesión (lesión nivel "ninguna")
    Cuando la enfermera registra el evento
    Entonces el "fall_event" se registra con "notificado_jci = false"
    Y el sistema NO genera notificación automática al Comité JCI
    Y el KPI de caídas sí se actualiza (toda caída cuenta, independientemente de lesión)
    Y el audit log registra el evento para el reporte mensual de seguridad
