# language: es
# Épica: E3 — Catálogos Maestros
# Historias cubiertas: US-3.7, US-3.8, US-3.9
# TDR: §7
# Persona principal: P7 — Administrador clínico
# Valor de negocio: Mantener catálogos sin tickets a TI, con vigencia y trazabilidad,
# habilitando autonomía operativa.

@regression @catalog @es-SV
Característica: CRUD de catálogos maestros con vigencia y trazabilidad
  Como administrador clínico (P7)
  Quiero crear, editar, deprecar y versionar elementos de catálogo
  Para que los datos maestros estén siempre actualizados sin depender de TI.

  Antecedentes:
    Dado que inicio sesión con rol "admin_clinico"
    Y selecciono el módulo "Catálogos / Especialidades médicas"

  @smoke @create
  Escenario: Crear especialidad médica nueva
    Cuando creo la especialidad:
      | campo          | valor              |
      | codigo         | NEUMO              |
      | nombre_es      | Neumología         |
      | nombre_en      | Pulmonology        |
      | vigente_desde  | 2026-05-01         |
    Y guardo
    Entonces la especialidad queda activa
    Y aparece en la lista de búsqueda
    Y se publica "CatalogItemCreated"

  @update
  Escenario: Editar nombre con versionado automático
    Dado existe la especialidad "Cardio" con nombre "Cardiología"
    Cuando edito el nombre a "Cardiología Clínica" con vigencia desde "2026-06-01"
    Entonces el sistema crea una nueva versión vigente desde "2026-06-01"
    Y la versión anterior queda marcada como "vigente_hasta = 2026-05-31"
    Y se publica "CatalogItemUpdated"

  @deprecate
  Escenario: Deprecar elemento sin perder histórico
    Dado existe la especialidad "GeriaTemp" usada en 0 encuentros activos
    Cuando deprecé la especialidad con motivo "Reemplazada por Geriatría"
    Entonces queda marcada como "deprecada"
    Y NO aparece en selectores de creación nuevos
    Y SÍ aparece en consultas históricas

  @deprecate @validation
  Escenario: Bloqueo al deprecar elemento en uso activo
    Dado existe la especialidad "Cardio" con 12 encuentros activos
    Cuando intento deprecarla
    Entonces el sistema bloquea con "12 encuentros activos requieren este catálogo"
    Y ofrece "Ver encuentros afectados"

  @bulk
  Escenario: Importación masiva CSV con validación previa
    Cuando cargo un archivo CSV con 50 especialidades
    Y 3 filas tienen códigos duplicados
    Entonces el sistema muestra preview con errores marcados
    Y NO importa nada hasta confirmación
    Cuando corrijo y confirmo
    Entonces se importan las 50 filas en una sola transacción
    Y se emite "CatalogBulkImported"

  @versioning @history
  Escenario: Ver historial de cambios de un elemento
    Dado existe la especialidad "Cardio" con 3 versiones
    Cuando consulto su historial
    Entonces veo las 3 versiones con autor, timestamp y diff campo a campo
    Y puedo restaurar una versión previa (genera versión nueva, no sobrescribe)
