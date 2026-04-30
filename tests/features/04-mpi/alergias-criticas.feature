# language: es
# Épica: E4 — MPI
# Historias cubiertas: US-4.8
# TDR: §8.1, §14 (HCE)
# Persona principal: P1 — Médico, P2 — Enfermería
# Valor de negocio: Visibilidad inmediata de alergias críticas en cada acción clínica
# para prevenir errores potencialmente mortales.

@critical @mpi @allergies @es-SV
Característica: Captura y visualización de alergias críticas
  Como médico/enfermería
  Quiero registrar y ver de inmediato las alergias del paciente con severidad codificada
  Para prevenir prescripciones o intervenciones peligrosas.

  Antecedentes:
    Dado el paciente "MRN-000123" sin alergias previas
    Y inicio sesión con rol "medico"

  @smoke
  Escenario: Registrar alergia crítica
    Cuando agrego alergia:
      | sustancia      | reaccion       | severidad  |
      | Penicilina     | Anafilaxia     | CRITICA    |
    Y guardo
    Entonces la alergia queda visible en el banner de identidad del paciente
    Y se muestra ícono rojo en cualquier vista del paciente
    Y se publica "AllergyRecorded"

  @severity
  Esquema del escenario: Severidades codificadas
    Cuando registro alergia con severidad "<sev>"
    Entonces el sistema asigna color "<color>" e ícono "<icono>"

    Ejemplos:
      | sev      | color   | icono       |
      | CRITICA  | rojo    | warning-red |
      | ALTA     | naranja | warning     |
      | MODERADA | amarillo| info        |
      | LEVE     | gris    | info-muted  |

  @banner
  Escenario: Banner persistente en todas las pantallas del paciente
    Dado paciente con alergia "Penicilina (CRITICA)"
    Cuando navego entre HCE, prescripciones, signos vitales
    Entonces el banner de alergias críticas permanece visible en la parte superior
    Y NO puede ser cerrado por el usuario

  @modify @audit
  Escenario: Modificación de alergia requiere revisión clínica
    Dado paciente con alergia "Penicilina (CRITICA)"
    Cuando intento eliminar la alergia
    Entonces el sistema exige justificación + segunda firma médica
    Y el cambio se registra como "AllergyModified" en audit_log

  @inheritance @newborn
  Escenario: Recién nacido hereda alergias relevantes de la madre (sugeridas, no automáticas)
    Dado madre "MRN-000555" con alergia "Penicilina (CRITICA)"
    Cuando registro el recién nacido vinculado a la madre
    Entonces el sistema sugiere "Considerar alergia materna a Penicilina"
    Pero NO la copia automáticamente (requiere validación clínica)

  # TODO refinar con super-usuario clínico:
  # alergias alimentarias vs medicamentosas vs ambientales — codificación con
  # SNOMED-CT o catálogo local; pendiente decisión arquitectónica.
