# language: es
# Épica: E4 — MPI
# Historias cubiertas: US-4.4 (detección), US-4.5 (merge)
# TDR: §8.1
# Persona principal: P7 — Admin clínico (revisor de duplicados)
# Valor de negocio: Mantener tasa de duplicados < 1% mediante detección determinista
# + probabilística y fusión auditada con reversibilidad.

@critical @mpi @deduplication @es-SV
Característica: Detección y fusión de duplicados de paciente
  Como administrador clínico (P7)
  Quiero detectar y fusionar registros duplicados con auditoría
  Para mantener un MPI confiable y preservar la trazabilidad clínica.

  Antecedentes:
    Dado que el worker de deduplicación corre cada 30 minutos
    Y el umbral de score probabilístico es 0.85
    Y inicio sesión con rol "admin_clinico"

  @deterministic
  Escenario: Detección determinista por DUI duplicado
    Dado que existen 2 pacientes activos con DUI "04567823-4" (creados por error)
    Cuando el worker corre
    Entonces ambos quedan en lista "duplicados_deterministas"
    Y se publica "DuplicateDetected" con tipo "DETERMINISTIC"

  @probabilistic
  Escenario: Detección probabilística por similitud demográfica
    Dado los pacientes:
      | mrn          | nombre                       | fn         | sexo |
      | MRN-000300   | Carlos Antonio Ramírez M.    | 1980-07-15 | M    |
      | MRN-000301   | Carlos A Ramirez Mendez      | 1980-07-15 | M    |
    Cuando el worker corre
    Entonces calcula score (Levenshtein nombres + DOB + sexo) >= 0.85
    Y los marca como "posible_duplicado" con score
    Y se publica "PossibleDuplicateDetected"

  @merge @golden
  Escenario: Fusión exitosa con reversibilidad por 30 días
    Dado los pacientes "MRN-000300" (sobrevive) y "MRN-000301" (se fusiona)
    Cuando ejecuto "Fusionar" con justificación clínica
    Y confirmo qué dato sobrevive en cada campo en conflicto
    Entonces los encuentros, alergias, prescripciones de "MRN-000301" se reasocian a "MRN-000300"
    Y "MRN-000301" queda marcado como "FUSIONADO_EN MRN-000300"
    Y se publica "PatientsMerged"
    Y la fusión es reversible durante 30 días

  @merge @permission
  Escenario: Solo admin_clinico o super_admin pueden fusionar
    Dado un usuario con rol "admision"
    Cuando intenta fusionar 2 pacientes
    Entonces recibe "403 - Acción no autorizada"

  @merge @reverse
  Escenario: Reversión de fusión dentro del plazo de 30 días
    Dado una fusión ejecutada hace 5 días
    Cuando admin_clinico ejecuta "Revertir fusión" con justificación
    Entonces los registros se separan al estado previo
    Y se publica "PatientMergeReverted"

  @merge @reverse @blocked
  Escenario: Reversión bloqueada después de 30 días
    Dado una fusión ejecutada hace 31 días
    Cuando intento revertir
    Entonces el sistema bloquea con "Plazo de reversibilidad expirado"
    Y sugiere "Crear nuevo registro y vincular manualmente"

  @audit
  Escenario: Toda fusión queda auditada
    Cuando se ejecuta fusión exitosa
    Entonces audit_log registra "PatientsMerged" con:
      | campo                  | valor                    |
      | mrn_sobreviviente      | MRN-000300               |
      | mrn_fusionado          | MRN-000301               |
      | autor                  | admin_clinico            |
      | justificacion          | (texto íntegro)          |
      | snapshot_pre_fusion    | (JSON inmutable)         |
