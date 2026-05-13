# language: es
# Épica: E15 — Farmacia
# TDR: §15 Farmacia y Gestión de Medicamentos
# Stack backend: pharmacyRouter (skeleton Wave 6)
# Persona principal: P5 — Médico prescriptor / P7 — Farmacéutico
# Valor: Catálogo de medicamentos, prescripción firmada y dispensación trazable.

@phase2 @pharmacy @es-SV
Característica: Prescripción y dispensación farmacéutica
  Como médico o farmacéutico (P5, P7)
  Quiero prescribir medicamentos y dispensarlos contra recetas firmadas
  Para garantizar trazabilidad del medicamento desde el catálogo hasta el paciente.

  Antecedentes:
    Dado el catálogo global de medicamentos cargado
    Y un encounter activo del paciente "MRN-000600" en el tenant actual

  @smoke @happy
  Escenario: Crear y firmar una receta
    Cuando creo una receta con item "Amoxicilina 500mg" cada 8 horas por 7 días
    Y firmo la receta como médico autorizado
    Entonces la receta queda en estado "SIGNED"
    Y los items quedan asociados al organizationId del tenant

  @edge @validation
  Escenario: Bloquear creación de receta cuando patientId no coincide con el encounter
    Dado un encounter del paciente "MRN-000600"
    Cuando intento crear una receta con un paciente distinto
    Entonces el sistema rechaza con error de validación
    Y no se crea la receta
