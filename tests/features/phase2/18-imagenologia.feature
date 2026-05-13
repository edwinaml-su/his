# language: es
# Épica: E18 — Imagenología (RIS/PACS)
# TDR: §18 Imágenes Diagnósticas
# Stack backend: imagingRouter (skeleton Wave 7)
# Persona principal: P5 — Médico solicitante / P9 — Radiólogo
# Valor: Solicitud de estudio, registro de adquisición y reporte firmado.

@phase2 @imaging @es-SV
Característica: Solicitud y reporte de estudios de imagen
  Como médico solicitante o radiólogo (P5, P9)
  Quiero ordenar estudios y firmar el reporte
  Para cerrar el ciclo diagnóstico con trazabilidad por organización.

  Antecedentes:
    Dado una modalidad "TAC-01" tipo "CT" activa en el tenant actual
    Y un encounter activo del paciente "MRN-000900"

  @smoke @happy
  Escenario: Crear orden de imagen e indicar que fue adquirida
    Cuando ordeno un estudio de "Tórax simple" en la modalidad "TAC-01"
    Y la marco como "ACQUIRED"
    Entonces la orden registra "acquiredAt" con la fecha de adquisición
    Y queda vinculada al organizationId del tenant

  @edge @sign
  Escenario: Firmar reporte promueve la orden a REPORTED
    Dado una orden en estado "ACQUIRED" con reporte preliminar
    Cuando el radiólogo firma el reporte
    Entonces el reporte queda con timestamp de firma
    Y la orden transiciona a "REPORTED"
