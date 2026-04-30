# language: es
# Épica: E1 — Multi-Entidad
# Historias cubiertas: US-1.2, US-1.5, US-1.7
# TDR: §5
# Persona principal: Cualquier rol multi-establecimiento (P1, P3, P6, P8)
# Valor de negocio: Aislar contextualmente datos por país/organización/establecimiento
# y dar al usuario control explícito de su contexto operativo activo.

@critical @multi-entidad @es-SV
Característica: Selección de contexto multi-entidad
  Como usuario con acceso a múltiples establecimientos
  Quiero seleccionar país, organización, establecimiento, sede y servicio
  Para que toda la pantalla y operaciones se filtren al contexto elegido.

  Antecedentes:
    Dado que el usuario "jefe1@avante.sv" tiene acceso a:
      | pais | organizacion           | establecimiento                   | servicio              |
      | SV   | Avante Salud SA de CV  | Hospital Avante San Salvador      | Medicina Interna      |
      | SV   | Avante Salud SA de CV  | Hospital Avante San Salvador      | Emergencia Adultos    |
      | SV   | Avante Salud SA de CV  | Clínica Avante Santa Tecla        | Consulta Externa      |
    Y inicio sesión exitosamente

  @smoke
  Escenario: Selector visible en header tras login
    Cuando entro al dashboard
    Entonces veo en el header un selector con "Establecimiento / Sede / Servicio"
    Y el selector muestra el último contexto usado o por defecto el primero permitido

  @persistence
  Escenario: Persistencia del contexto por sesión
    Dado que selecciono "Hospital Avante San Salvador / Emergencia Adultos"
    Cuando navego a "Pacientes" y luego a "Censo"
    Entonces el contexto sigue siendo "Hospital Avante San Salvador / Emergencia Adultos"
    Cuando cierro sesión y vuelvo a entrar
    Entonces el sistema sugiere el último contexto pero NO lo aplica sin confirmación explícita

  @filter
  Escenario: Datos filtrados por contexto activo
    Dado que selecciono "Clínica Avante Santa Tecla / Consulta Externa"
    Cuando consulto la lista de pacientes en encuentro
    Entonces solo veo encuentros del establecimiento "Clínica Avante Santa Tecla"
    Y NO veo datos de "Hospital Avante San Salvador"

  @rls @security
  Escenario: RLS bloquea acceso fuera del contexto autorizado
    Dado que el usuario NO tiene acceso a "Hospital Regional X"
    Cuando intenta acceder vía URL directa a un encuentro de "Hospital Regional X"
    Entonces el sistema responde "404 Not Found"
    Y NO revela existencia del recurso
    Y el intento queda auditado

  @switch
  Escenario: Cambio de contexto refresca datos visibles
    Dado que estoy viendo el censo de "Medicina Interna"
    Cuando cambio el selector a "Emergencia Adultos"
    Entonces el censo se refresca al servicio nuevo en menos de 1 segundo
    Y ningún dato del servicio anterior queda en memoria visible
