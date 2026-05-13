# language: es
# Épica: E20 — Servicios y Equipos Biomédicos
# TDR: §20 Servicios Hospitalarios, Usos y Equipos
# Stack backend: servicesEquipmentRouter (skeleton Wave 8)
# Persona principal: P11 — Biomédico / P10 — Mantenimiento
# Valor: Catálogo de equipos, mantenimientos preventivos y bitácora de calibración.

@phase2 @services-equipment @es-SV
Característica: Gestión de equipos biomédicos y mantenimiento preventivo
  Como ingeniero biomédico o personal de mantenimiento (P10, P11)
  Quiero registrar equipos, programar mantenimientos y bitácora de calibración
  Para asegurar disponibilidad y cumplimiento normativo por establecimiento.

  Antecedentes:
    Dado un establecimiento del tenant actual
    Y rol "biomedico" autenticado

  @smoke @happy
  Escenario: Registrar equipo y programar mantenimiento preventivo
    Cuando registro un equipo con asset tag "EQ-1001" en el establecimiento del tenant
    Y programo un mantenimiento preventivo con fecha futura
    Entonces el equipo queda asociado al organizationId del tenant
    Y el mantenimiento queda planificado contra ese equipo

  @edge @not-found
  Escenario: Programar mantenimiento sobre equipo de otro tenant falla
    Dado un equipo registrado en la organización "OrgA"
    Cuando un usuario de "OrgB" intenta programar un mantenimiento sobre ese equipo
    Entonces el sistema responde "no encontrado"
    Y no se crea el plan de mantenimiento
