# language: es
# Épica: E6 — Triage Manchester
# Historias cubiertas: US-6.6, US-6.7, US-6.10
# TDR: §9
# Persona principal: P4 — Triador, P6 — Jefe servicio
# Valor de negocio: Cronómetros vivos por nivel y tablero realtime que reduzca LWBS.

@regression @triage @timing @es-SV
Característica: Cronómetros y tablero realtime de emergencias
  Como triador / jefe de servicio
  Quiero ver cronómetros por paciente y la cola completa en tiempo real
  Para asignar pacientes a sala/box y prevenir abandonos sin atender.

  Antecedentes:
    Dado el tablero "Emergencia Adultos" en pantalla mural
    Y existen pacientes triados con distintos niveles

  @smoke @realtime
  Escenario: Tablero muestra cola por nivel con cronómetros vivos
    Cuando se renderiza el tablero
    Entonces veo columnas por nivel (Rojo, Naranja, Amarillo, Verde, Azul)
    Y cada paciente muestra cronómetro en tiempo real
    Y el cronómetro cambia de color al cruzar el umbral 80%

  @assignment
  Escenario: Asignación a sala/box desde el tablero
    Cuando arrastro paciente a "Box-3"
    Entonces el sistema valida disponibilidad del box
    Y reasigna paciente al box
    Y se publica "BoxAssigned"

  @kpi @lwbs
  Escenario: Indicador de LWBS (Left Without Being Seen)
    Dado paciente que abandona sin ser atendido
    Cuando el triador marca "Abandono / LWBS"
    Entonces se cierra Encounter con motivo "LWBS"
    Y el KPI "lwbs" se incrementa
    Y se publica "PatientLeftWithoutSeen"

  @kpi
  Escenario: Indicadores de triage del turno
    Cuando consulto el panel de calidad del turno
    Entonces veo:
      | kpi                       |
      | tiempo_puerta_triage      |
      | distribucion_por_nivel    |
      | tasa_lwbs                 |
      | tasa_override             |
      | tiempos_excedidos         |

  @display
  Escenario: Pantalla mural sin datos identificables
    Dado el tablero proyectado en pasillo público
    Entonces NO muestra nombres completos ni DUI
    Y muestra solo: iniciales, nivel y cronómetro
    Y cumple WCAG AA para legibilidad a 5 metros
