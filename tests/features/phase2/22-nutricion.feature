# language: es
# Épica: E22 — Nutrición
# TDR: §22 Nutrición y Alimentación
# Stack backend: nutritionRouter (skeleton Wave 8)
# Persona principal: P13 — Nutricionista / P5 — Médico
# Valor: Planes de dieta, evaluaciones nutricionales y órdenes de nutrición enteral/parenteral.

@phase2 @nutrition @es-SV
Característica: Planes de dieta y órdenes de nutrición especializada
  Como nutricionista o médico (P5, P13)
  Quiero registrar planes de dieta y órdenes de nutrición especializada
  Para coordinar la alimentación del paciente con auditoría completa.

  Antecedentes:
    Dado un encounter activo del paciente "MRN-001200" en el tenant actual

  @smoke @happy
  Escenario: Crear plan de dieta estándar
    Cuando creo un plan de dieta "DASH baja en sodio" vinculado al encounter del paciente
    Entonces el plan queda activo
    Y queda asociado al organizationId del tenant y al patientId del encounter

  @edge @validation
  Escenario: Rechazar plan cuando patientId no coincide con el encounter
    Dado un encounter del paciente "MRN-001200"
    Cuando intento crear un plan de dieta con patientId distinto
    Entonces el sistema rechaza con error de validación
    Y el plan no se crea
