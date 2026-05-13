# language: es
# Épica: E17 — Laboratorio Clínico (LIS)
# TDR: §17 Laboratorio Clínico
# Stack backend: lisRouter (skeleton Wave 6)
# Persona principal: P5 — Médico / P8 — Técnico de laboratorio
# Valor: Solicitud de exámenes, recolección de muestra y validación 4-ojos.

@phase2 @lis @es-SV
Característica: Solicitud de laboratorio con validación 4-ojos
  Como médico o técnico de laboratorio (P5, P8)
  Quiero solicitar exámenes y validar resultados con la regla 4-ojos
  Para evitar errores de transcripción y garantizar la calidad analítica.

  Antecedentes:
    Dado el catálogo global de paneles y exámenes cargado
    Y un encounter activo del paciente "MRN-000800"

  @smoke @happy
  Escenario: Crear orden de laboratorio en estado ORDERED
    Cuando creo una orden con panel "Hemograma completo" y prioridad por defecto
    Entonces la orden queda en estado "ORDERED"
    Y la prioridad registrada es "ROUTINE"
    Y la orden queda asociada al organizationId del tenant

  @edge @4-eyes
  Escenario: Rechazar validación cuando el validador es el mismo que entró el resultado
    Dado un resultado ingresado por el técnico "A"
    Cuando el técnico "A" intenta validar su propio resultado
    Entonces el sistema rechaza con "prohibido"
    Y el resultado permanece sin validar
