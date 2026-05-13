# language: es
# Épica: E25 — Convenios y Aseguradoras
# TDR: §25 Convenios y Aseguradoras
# Stack backend: insuranceRouter (skeleton Wave 8)
# Persona principal: P14 — Coordinador convenios / P3 — Admisión
# Valor: Catálogo aseguradoras, planes, coberturas y solicitud de autorización.

@phase2 @insurance @es-SV
Característica: Gestión de convenios con aseguradoras y autorizaciones
  Como coordinador de convenios o personal de admisión (P3, P14)
  Quiero registrar aseguradoras, planes, coberturas y solicitar autorizaciones
  Para asegurar la cobertura previa del paciente con flujo aprobado/denegado.

  Antecedentes:
    Dado un paciente "MRN-001300" registrado en el MPI del tenant actual

  @smoke @happy
  Escenario: Aprobar una solicitud de autorización
    Dado una aseguradora y plan activos en el tenant
    Y una cobertura activa del paciente
    Y una solicitud de autorización en estado "REQUESTED"
    Cuando apruebo la solicitud sin marcar "partial"
    Entonces la solicitud transiciona a estado "APPROVED"
    Y queda registrada la fecha de aprobación

  @edge @not-found
  Escenario: No autorizar cobertura de otro tenant
    Dada una cobertura registrada en la organización "OrgA"
    Cuando un usuario de "OrgB" intenta crear una solicitud de autorización sobre esa cobertura
    Entonces el sistema responde "no encontrado"
    Y no se crea la solicitud
