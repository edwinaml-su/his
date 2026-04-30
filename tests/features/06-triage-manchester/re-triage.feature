# language: es
# Épica: E6 — Triage Manchester
# Historias cubiertas: US-6.8
# TDR: §9
# Persona principal: P4 — Triador, P2 — Enfermería
# Valor de negocio: Detectar deterioro y reclasificar para evitar que pacientes
# críticos sean atendidos tardíamente.

@critical @triage @retriage @es-SV
Característica: Re-triage automático y manual
  Como triador (P4)
  Quiero que el sistema detecte cambios significativos y permita re-triage
  Para garantizar que pacientes en cola que se deterioren reciban prioridad correcta.

  Antecedentes:
    Dado paciente "Juan P." con triage inicial nivel "Verde" hace 30 minutos
    Y los signos vitales basales fueron registrados al ingreso
    Y inicio sesión con rol "enfermeria"

  @auto
  Escenario: Re-triage automático por umbral 80% del tiempo máximo
    Dado paciente nivel "Amarillo" con tiempo máximo "60 min" en espera "49 min"
    Cuando el job de cronómetro detecta el umbral
    Entonces marca al paciente con bandera "RetriageRequired"
    Y notifica al triador
    Y publica "RetriageRequired"

  @manual @vitals
  Escenario: Re-triage manual por signos vitales deteriorados
    Cuando enfermería captura signos:
      | parametro | valor |
      | spo2      | 88    |
      | fr        | 30    |
    Y solicita "Re-triage por deterioro"
    Entonces el sistema reabre el flujograma
    Y al aplicar nuevo discriminador "saturación < 92%" reasigna nivel "Naranja"
    Y conserva historial de niveles previos
    Y publica "RetriageExecuted"

  @history
  Escenario: Historial de niveles preservado
    Dado paciente con 3 reclasificaciones en su Encounter
    Cuando consulto historial de triage
    Entonces veo cronológicamente cada nivel con: timestamp, autor, justificación, signos vitales

  @max-overdue
  Escenario: Evento MaxWaitExceeded cuando se incumple tiempo máximo
    Dado paciente nivel "Amarillo" con espera de 61 minutos
    Cuando el cronómetro supera el tiempo máximo
    Entonces se publica "MaxWaitExceeded"
    Y el indicador "tiempos_excedidos" se incrementa para el panel de calidad
