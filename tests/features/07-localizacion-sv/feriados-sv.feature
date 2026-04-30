# language: es
# Épica: E7 — Localización SV
# Historias cubiertas: US-7.3
# TDR: §27
# Persona principal: P8 — Admin TI
# Valor de negocio: Feriados oficiales SV influyen en agenda, turnos, recargos.

@regression @localization @sv @holidays
Característica: Catálogo de feriados oficiales de El Salvador
  Como admin TI
  Quiero mantener el catálogo de feriados SV con vigencia anual
  Para que módulos de agenda y turnos los consideren correctamente.

  Antecedentes:
    Dado el catálogo "feriados_SV" con feriados oficiales del año vigente:
      | fecha       | descripcion                     | tipo       |
      | 2026-01-01  | Año Nuevo                       | nacional   |
      | 2026-04-02  | Jueves Santo                    | religioso  |
      | 2026-04-03  | Viernes Santo                   | religioso  |
      | 2026-04-04  | Sábado Santo                    | religioso  |
      | 2026-05-01  | Día del Trabajo                 | nacional   |
      | 2026-05-10  | Día de la Madre                 | nacional   |
      | 2026-06-17  | Día del Padre                   | nacional   |
      | 2026-08-06  | Fiestas Agostinas (San Salvador)| local      |
      | 2026-09-15  | Día de la Independencia         | nacional   |
      | 2026-11-02  | Día de los Difuntos             | nacional   |
      | 2026-12-25  | Navidad                         | religioso  |

  @smoke
  Escenario: Consultar feriados del año
    Cuando consulto feriados de "2026"
    Entonces veo al menos 11 feriados oficiales
    Y cada uno con tipo y descripción

  @local
  Escenario: Feriados locales por municipio
    Cuando consulto feriados con filtro municipio "San Salvador"
    Entonces los feriados nacionales aplican
    Y "Fiestas Agostinas" aparece como local de San Salvador
    Y NO aparece "Fiestas Patronales de Santa Ana"

  @validation
  Escenario: Feriado bloqueado para edición retroactiva en módulos operativos
    Dado un feriado pasado "2026-01-01"
    Cuando admin intenta cambiar la fecha
    Entonces el sistema bloquea con "Feriado pasado no editable; cree versión nueva si aplica"

  @integration
  Escenario: Consumo del catálogo desde agenda
    Dado el módulo de agenda (futuro)
    Cuando consulta el endpoint "GET /holidays?country=SV&year=2026"
    Entonces recibe la lista en menos de 100 ms
    Y aplica recargos según tipo si configurado

  # TODO refinar con super-usuario operativo:
  # feriados móviles (Semana Santa) generados automáticamente vs cargados manualmente.
