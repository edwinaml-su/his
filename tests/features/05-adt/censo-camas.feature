# language: es
# Épica: E5 — ADT
# Historias cubiertas: US-5.3, US-5.6, US-5.10
# TDR: §8.6
# Persona principal: P6 — Jefe de servicio, P2 — Enfermería
# Valor de negocio: Visibilidad realtime de ocupación, KPIs operacionales y
# transiciones de estado de cama auditadas.

@critical @adt @census @es-SV
Característica: Censo de camas y ocupación realtime
  Como jefe de servicio (P6)
  Quiero ver en tiempo real el estado de las camas y KPIs de ocupación
  Para tomar decisiones operativas (admitir, trasladar, dar de alta).

  Antecedentes:
    Dado el servicio "Medicina Interna" con 20 camas
    Y la distribución actual es:
      | estado        | cantidad |
      | libre         | 5        |
      | ocupada       | 12       |
      | sucia         | 2        |
      | bloqueada     | 1        |
      | mantenimiento | 0        |
    Y inicio sesión con rol "jefe_servicio"

  @smoke @realtime
  Escenario: Tablero de censo refresca al ingresar paciente
    Cuando un paciente nuevo ingresa a cama "MI-205" libre
    Entonces el tablero se actualiza en menos de 1 segundo (Supabase Realtime)
    Y los KPIs se recalculan:
      | kpi              | valor    |
      | ocupacion        | 65%      |
      | camas_libres     | 4        |

  @transitions
  Esquema del escenario: Transiciones válidas de estado de cama
    Dado una cama en estado "<from>"
    Cuando se ejecuta acción "<accion>"
    Entonces la cama pasa a "<to>"

    Ejemplos:
      | from          | accion                | to            |
      | libre         | asignar_paciente      | ocupada       |
      | ocupada       | dar_alta              | sucia         |
      | sucia         | limpieza_completada   | libre         |
      | libre         | bloquear              | bloqueada     |
      | bloqueada     | desbloquear           | libre         |
      | libre         | mantenimiento         | mantenimiento |
      | mantenimiento | mantenimiento_termino | libre         |

  @transitions @invalid
  Esquema del escenario: Transiciones inválidas son bloqueadas
    Dado una cama en estado "<from>"
    Cuando se intenta acción "<accion>"
    Entonces el sistema bloquea con "<error>"

    Ejemplos:
      | from     | accion              | error                                          |
      | sucia    | asignar_paciente    | Cama requiere limpieza antes de asignación     |
      | ocupada  | bloquear            | Cama ocupada no puede bloquearse directamente  |
      | mantenimiento | asignar_paciente | Cama en mantenimiento                        |

  @kpi
  Escenario: KPIs del censo
    Cuando consulto los KPIs del servicio
    Entonces veo:
      | kpi                   |
      | porcentaje_ocupacion  |
      | giro_cama             |
      | estancia_promedio     |
      | egresos_del_dia       |
      | ingresos_del_dia      |
      | traslados_del_dia     |
    Y puedo filtrar por sede, servicio, tipo de paciente

  @lists
  Escenario: Listas operativas del día
    Cuando consulto "Listas operativas"
    Entonces veo:
      | lista                |
      | ingresos_hoy         |
      | egresos_hoy          |
      | traslados_hoy        |
      | programados_proximas_24h |
    Y puedo exportar a CSV/PDF

  @audit
  Escenario: Cambios de estado auditados
    Cuando enfermería marca cama "MI-201" como "sucia"
    Entonces audit_log registra "BedStateChanged" con autor, from, to, timestamp
