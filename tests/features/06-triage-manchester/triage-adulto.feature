# language: es
# Épica: E6 — Triage Manchester
# Historias cubiertas: US-6.1, US-6.2, US-6.3, US-6.4, US-6.5, US-6.6, US-6.7
# TDR: §9 (Manchester Triage System), §12 (Emergencias)
# Persona principal: P4 — Triador (enfermera/o de emergencia)
# Valor de negocio: Clasificar pacientes en < 5 min con criterios objetivos,
# garantizar tiempos máximos de atención por nivel y activar protocolos críticos.

@critical @triage @manchester @es-SV
Característica: Triage Manchester para pacientes adultos
  Como triador de emergencias (P4)
  Quiero clasificar pacientes según los 5 niveles Manchester con discriminadores objetivos
  Para garantizar atención prioritaria y trazable, y activar protocolos críticos cuando aplique.

  Antecedentes:
    Dado que el establecimiento "Hospital Avante San Salvador" tiene el módulo de triage activo
    Y los 52 flujogramas Manchester estándar están cargados y vigentes
    Y los tiempos máximos por nivel son los configurados por la organización:
      | nivel    | codigo | prioridad | tiempo_max_min |
      | Rojo     | R      | 1         | 0              |
      | Naranja  | O      | 2         | 10             |
      | Amarillo | Y      | 3         | 60             |
      | Verde    | G      | 4         | 120            |
      | Azul     | B      | 5         | 240            |
    Y inicio sesión con rol "triador"
    Y selecciono el contexto "Hospital Avante San Salvador / Emergencia Adultos"

  # ----------------------------------------------------------------------
  # Asignación automática por nivel — un escenario por nivel
  # ----------------------------------------------------------------------
  @level @red @code-blue
  Escenario: Nivel Rojo - paro cardiorrespiratorio activa Código Azul
    Dado un paciente "Juan Pérez" presentado con "ausencia de pulso y respiración"
    Cuando aplico el flujograma "Adulto inconsciente"
    Y marco el discriminador "vía aérea comprometida / paro cardiorrespiratorio"
    Entonces el sistema asigna nivel "Rojo" con tiempo máximo "0 minutos"
    Y activa el "Código Azul" (paro cardiorrespiratorio)
    Y notifica simultáneamente al equipo de reanimación vía push
    Y el cronómetro arranca con valor "00:00" en estado expirado-inmediato
    Y emite los eventos "LevelAssigned" y "CodeBlueActivated"

  @level @orange @sepsis
  Escenario: Nivel Naranja - sospecha de sepsis activa bundle hour-1
    Dado un paciente con flujograma "Indisposición en adulto"
    Y los signos vitales registrados son:
      | parametro    | valor |
      | temperatura  | 39.2  |
      | fc           | 122   |
      | fr           | 26    |
      | spo2         | 92    |
      | ta_sistolica | 88    |
      | glasgow      | 14    |
    Cuando marco los discriminadores "fiebre alta + hipotensión + alteración del estado mental"
    Entonces el sistema asigna nivel "Naranja" con tiempo máximo "10 minutos"
    Y activa el protocolo "Código Sepsis" (bundle hour-1)
    Y muestra checklist obligatorio: lactato, hemocultivos, antibiótico de amplio espectro, fluidos 30 ml/kg
    Y inicia cronómetro de bundle hour-1 con expiración a los 60 minutos
    Y emite los eventos "LevelAssigned" y "SepsisProtocolActivated"

  @level @yellow
  Escenario: Nivel Amarillo - dolor moderado sin signos de alarma
    Dado un paciente con flujograma "Dolor abdominal en adulto"
    Y los signos vitales son normales para edad
    Cuando marco el discriminador "dolor moderado (EVA 5-6)"
    Entonces el sistema asigna nivel "Amarillo" con tiempo máximo "60 minutos"
    Y inicia cronómetro
    Y emite "LevelAssigned"

  @level @green
  Escenario: Nivel Verde - dolor leve estable
    Dado un paciente con flujograma "Dolor de garganta"
    Cuando marco discriminador "dolor leve (EVA 1-3)" sin disnea
    Entonces el sistema asigna nivel "Verde" con tiempo máximo "120 minutos"
    Y inicia cronómetro
    Y emite "LevelAssigned"

  @level @blue
  Escenario: Nivel Azul - consulta no urgente
    Dado un paciente con flujograma "Problemas dentales"
    Y no presenta dolor agudo ni signos de alarma
    Cuando completo el triage sin discriminadores activos
    Entonces el sistema asigna nivel "Azul" con tiempo máximo "240 minutos"
    Y muestra recomendación "Derivable a consulta ambulatoria"
    Y emite "LevelAssigned"

  # ----------------------------------------------------------------------
  # Sobreescritura por triador con justificación
  # ----------------------------------------------------------------------
  @override @audit
  Escenario: Sobreescritura de nivel con justificación obligatoria
    Dado que el sistema asignó automáticamente nivel "Verde" al paciente
    Cuando el triador decide sobreescribir a nivel "Amarillo"
    Y NO escribe justificación
    Entonces el botón "Confirmar sobreescritura" permanece deshabilitado
    Y se muestra "La justificación es obligatoria (mínimo 20 caracteres)"

  @override @audit
  Escenario: Sobreescritura aceptada con justificación clínica
    Dado que el sistema asignó automáticamente nivel "Verde"
    Cuando el triador sobreescribe a nivel "Amarillo"
    Y escribe justificación "Paciente con antecedente de cardiopatía isquémica, dolor atípico, requiere ECG"
    Y confirma la sobreescritura
    Entonces el nivel registrado es "Amarillo"
    Y el cronómetro se ajusta al nuevo tiempo máximo
    Y el audit_log registra el evento "LevelOverridden" con:
      | campo              | valor                         |
      | nivel_original     | Verde                         |
      | nivel_final        | Amarillo                      |
      | justificacion      | (texto íntegro)               |
      | usuario            | (id del triador)              |
      | hash_previo        | (cadena válida)               |
    Y la métrica "tasa_override" se actualiza para el panel de calidad

  # ----------------------------------------------------------------------
  # Re-triage por umbral
  # ----------------------------------------------------------------------
  @retriage
  Escenario: Re-triage automático tras superar umbral del 80% del tiempo máximo
    Dado un paciente con nivel "Amarillo" en cola desde hace 49 minutos (82% de 60 min)
    Cuando el sistema detecta el cruce del umbral 80%
    Entonces emite alerta visual amarilla parpadeante en el tablero
    Y notifica al triador asignado
    Y agrega al paciente a la lista "pendientes_retriage"
    Y publica el evento "RetriageRequired"

  @retriage @manual
  Escenario: Re-triage manual por cambio en signos vitales
    Dado un paciente con nivel inicial "Verde"
    Cuando enfermería registra nuevos signos vitales:
      | parametro | valor |
      | spo2      | 89    |
      | fr        | 28    |
    Y solicita "Re-triage por deterioro"
    Entonces el sistema ofrece reasignar el flujograma o discriminador
    Y al aplicar nuevo discriminador "saturación < 92%" reasigna nivel "Naranja"
    Y conserva el historial completo de niveles previos
    Y emite "RetriageExecuted" con motivo "deterioro_signos_vitales"

  # ----------------------------------------------------------------------
  # Activación de códigos críticos
  # ----------------------------------------------------------------------
  @code-red @stroke
  Escenario: Activación de Código Rojo (ictus) por flujograma neurológico
    Dado un paciente con flujograma "Déficit neurológico súbito"
    Cuando marco discriminadores "FAST positivo + inicio < 4.5 horas"
    Entonces el sistema asigna nivel "Rojo"
    Y activa el "Código ICTUS" con cronómetro puerta-aguja
    Y reserva tomografía y avisa al neurólogo de turno
    Y emite "CodeStrokeActivated"

  # TODO refinar con super-usuario clínico:
  # diferenciación local entre "Código Rojo" y "Código Azul" según protocolo
  # interno del establecimiento (en algunos hospitales SV se invierte el uso).

  # ----------------------------------------------------------------------
  # Tiempos máximos - matriz parametrizable
  # ----------------------------------------------------------------------
  @timing @parametric
  Esquema del escenario: Tiempos máximos por nivel y alerta al 80%
    Cuando un paciente es triado con nivel "<nivel>"
    Entonces el cronómetro arranca con tiempo máximo "<max_min>" minutos
    Y dispara alerta amarilla al "<alerta_min>" minutos
    Y emite "MaxWaitExceeded" si supera "<max_min>" minutos sin atención

    Ejemplos:
      | nivel    | max_min | alerta_min |
      | Rojo     | 0       | 0          |
      | Naranja  | 10      | 8          |
      | Amarillo | 60      | 48         |
      | Verde    | 120     | 96         |
      | Azul     | 240     | 192        |

  # ----------------------------------------------------------------------
  # Validación de signos vitales por edad
  # ----------------------------------------------------------------------
  @validation @vitals
  Escenario: Bloqueo por signos vitales fuera de rango fisiológico
    Cuando capturo "frecuencia cardíaca = 320" en un adulto
    Entonces el sistema bloquea el guardado
    Y muestra "Valor fuera de rango fisiológico para adulto (40-220 lpm)"
    Y solicita confirmar o corregir antes de continuar
