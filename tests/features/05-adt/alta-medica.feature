# language: es
# Épica: E5 — ADT
# Historias cubiertas: US-5.5
# TDR: §8.5
# Persona principal: P1 — Médico
# Valor de negocio: Cierre clínico y administrativo trazable de cada hospitalización.

@critical @adt @discharge @es-SV
Característica: Alta médica con epicrisis firmada
  Como médico tratante (P1)
  Quiero registrar alta del paciente con epicrisis firmada electrónicamente
  Para cerrar el episodio asistencial con trazabilidad clínica.

  Antecedentes:
    Dado el Encounter activo de "MRN-000123" en cama "MI-201"
    Y inicio sesión con rol "medico"

  @smoke @golden
  Escenario: Alta médica con epicrisis completa
    Cuando capturo epicrisis con: motivo de alta, diagnóstico CIE-10, tratamiento, indicaciones
    Y firmo electrónicamente con MFA
    Y selecciono tipo de alta "MEDICA"
    Entonces el Encounter pasa a "DISCHARGED"
    Y la HospitalAccount se cierra (marca, no facturación detallada)
    Y la cama "MI-201" pasa a "sucia" pendiente de limpieza
    Y se publica "Discharged"

  @types
  Esquema del escenario: Tipos de alta soportados
    Cuando registro alta tipo "<tipo>" con datos requeridos
    Entonces el sistema acepta y publica "Discharged" con tipo "<tipo>"

    Ejemplos:
      | tipo                       |
      | MEDICA                     |
      | VOLUNTARIA                 |
      | TRASLADO_EXTERNO           |
      | FUGA                       |
      | FALLECIMIENTO              |
      | VOLUNTARIA_CONTRA_OPINION  |

  @validation
  Escenario: Bloqueo si epicrisis no incluye diagnóstico CIE-10
    Cuando intento firmar epicrisis sin código CIE-10
    Entonces el sistema bloquea con "Diagnóstico CIE-10 obligatorio"

  @validation @firma
  Escenario: Bloqueo si médico no es el responsable o no tiene JVPM vigente
    Dado un médico sin "JVPM" vigente al momento del alta
    Cuando intenta firmar epicrisis
    Entonces el sistema bloquea con "Número JVPM no vigente"
    Y NO genera el alta

  @against
  Escenario: Alta voluntaria contra opinión médica
    Cuando capturo alta tipo "VOLUNTARIA_CONTRA_OPINION"
    Entonces se exige firma del paciente o representante en formulario específico
    Y firma del médico responsable
    Y el evento "Discharged" se etiqueta como "alta_sensible"

  @reopen
  Escenario: Reapertura excepcional de alta dentro de 24 h
    Dado alta firmada hace 6 horas
    Cuando admin_clinico ejecuta "Reabrir alta" con justificación
    Entonces el Encounter vuelve a "ADMITTED" con bandera "REOPENED"
    Y se publica "DischargeReverted"
    Y queda auditado
