# language: es
# Épica: E2 — Seguridad, AuthN/AuthZ y Auditoría
# Historias cubiertas: US-2.8 (audit log append-only con hash chain)
# TDR: §6.5 (Auditoría inmutable)
# Persona principal: P8 — Super-admin TI / SRE; auditor regulatorio
# Valor de negocio: Trazabilidad completa, integridad criptográfica de la
# bitácora y cumplimiento normativo (HIPAA-equiv, Ley SV).

@critical @security @audit @es-SV
Característica: Auditoría inmutable con cadena de hash
  Como super-admin / auditor (P8)
  Quiero que toda acción sensible quede registrada de forma inmutable y verificable
  Para satisfacer auditorías internas, regulatorias y forenses.

  Antecedentes:
    Dado que el sistema tiene la tabla "audit_log" con hash encadenado activo
    Y existe un job nocturno "AuditChainVerification"
    Y inicio sesión como "auditor@avante.sv" con rol "auditor"

  # ----------------------------------------------------------------------
  # Captura de operaciones de escritura
  # ----------------------------------------------------------------------
  @capture @write
  Esquema del escenario: Captura de creación, modificación y eliminación lógica
    Dado un usuario con permiso ejecuta la acción "<accion>" sobre "<entidad>"
    Cuando la operación se completa
    Entonces el audit_log registra una entrada con:
      | campo            | regla                                  |
      | actor_id         | usuario autenticado                    |
      | actor_role       | rol activo en la sesión                |
      | accion           | <accion>                               |
      | entidad          | <entidad>                              |
      | entidad_id       | id afectado                            |
      | timestamp_utc    | ISO-8601 con TZ UTC                    |
      | ip_origen        | IP cliente                             |
      | user_agent       | UA del cliente                         |
      | hash_previo      | hash de la entrada anterior            |
      | hash_actual      | SHA-256(payload + hash_previo)         |
      | payload_diff     | snapshot del cambio antes/después      |

    Ejemplos:
      | accion              | entidad           |
      | CREATE              | Patient           |
      | UPDATE              | Patient           |
      | SOFT_DELETE         | Patient           |
      | CREATE              | Encounter         |
      | UPDATE              | TriageAssessment  |
      | OVERRIDE            | TriageLevel       |
      | MERGE               | Patient           |
      | CHANGE              | UserRole          |

  # ----------------------------------------------------------------------
  # Captura de READ sobre datos sensibles (HCE)
  # ----------------------------------------------------------------------
  @capture @read @sensitive
  Escenario: Captura de READ sobre Historia Clínica Electrónica
    Dado el paciente "MRN-000123" con datos clínicos en HCE
    Cuando el médico "medico1@avante.sv" abre el expediente del paciente
    Entonces el audit_log registra una entrada "READ_SENSITIVE" con:
      | campo         | valor                  |
      | accion        | READ_SENSITIVE         |
      | entidad       | ClinicalRecord         |
      | entidad_id    | MRN-000123             |
      | seccion_leida | "alergias,medicamentos"|
    Y el evento NO se registra para lecturas de catálogos no sensibles
    Y la lectura sensible se conserva 7 años (retención clínica)

  @capture @read @break-glass
  Escenario: Captura especial de lectura en modo Break-Glass
    Dado que el médico activó "break_the_glass" para el paciente "MRN-000789"
    Cuando lee cualquier sección del expediente
    Entonces cada lectura genera una entrada "READ_BREAK_GLASS"
    Y se etiqueta con "alta_sensibilidad"
    Y el resumen diario notifica al jefe de servicio

  # ----------------------------------------------------------------------
  # Búsqueda y consulta de la bitácora
  # ----------------------------------------------------------------------
  @search @by-user
  Escenario: Búsqueda de actividad por usuario
    Dado que existen entradas en el audit_log de los últimos 30 días
    Cuando filtro por "actor_id = medico1@avante.sv" y rango "últimos 7 días"
    Entonces veo todas las entradas paginadas (50 por página)
    Y puedo exportar el resultado como JSON o CEF (SIEM)
    Y la exportación queda registrada como "AuditExported"

  @search @by-entity
  Escenario: Búsqueda de actividad por entidad (paciente)
    Cuando filtro por "entidad = Patient" y "entidad_id = MRN-000123"
    Entonces veo la línea de tiempo completa de quién accedió o modificó al paciente
    Y puedo expandir cada entrada para ver el "payload_diff"

  @search @forensic
  Escenario: Filtros combinados para investigación forense
    Cuando filtro por "accion=OVERRIDE AND entidad=TriageLevel AND fecha entre X y Y"
    Entonces el resultado lista todas las sobreescrituras de triage en el rango
    Y permite descargar como evidencia firmada (zip + manifiesto SHA-256)

  # ----------------------------------------------------------------------
  # Inmutabilidad
  # ----------------------------------------------------------------------
  @immutability @critical
  Escenario: Intento de eliminar una entrada del audit_log falla
    Dado un super_admin autenticado
    Cuando intenta ejecutar DELETE sobre "audit_log" vía API
    Entonces el sistema responde "403 Forbidden" con código "AUDIT_IMMUTABLE"
    Y NO se elimina ningún registro
    Y el intento queda registrado como "AuditTamperAttempt"

  @immutability @critical
  Escenario: Intento de UPDATE sobre una entrada del audit_log falla
    Cuando un usuario con privilegios intenta UPDATE sobre una entrada
    Entonces el sistema rechaza la operación
    Y el intento queda auditado como "AuditTamperAttempt"

  @immutability @db
  Escenario: La base de datos rechaza modificación directa por trigger
    Dado un actor con conexión directa a Postgres (no recomendado)
    Cuando intenta UPDATE o DELETE sobre "audit_log"
    Entonces el trigger de inmutabilidad lanza excepción
    Y la transacción aborta sin afectar registros

  # ----------------------------------------------------------------------
  # Verificación de cadena de hash
  # ----------------------------------------------------------------------
  @hash-chain @nightly
  Escenario: Verificación nocturna detecta cadena íntegra
    Cuando se ejecuta el job "AuditChainVerification" a las 02:00
    Y todas las entradas tienen hash_actual válido respecto al hash_previo
    Entonces el job termina con estado "OK"
    Y publica métrica "audit_chain_integrity = 1"

  @hash-chain @alert
  Escenario: Verificación detecta cadena rota y alerta
    Dado que un atacante manipuló (hipotéticamente) una entrada
    Cuando se ejecuta la verificación y un hash_actual no coincide
    Entonces el job termina con estado "FAILED"
    Y emite alerta "AuditChainBroken" a Sentry, Slack y email del CISO
    Y la métrica "audit_chain_integrity = 0"
    Y se bloquean operaciones de exportación hasta intervención humana

  # ----------------------------------------------------------------------
  # Retención y exportación
  # ----------------------------------------------------------------------
  @retention
  Escenario: Retención mínima de 7 años para auditoría clínica
    Dada una entrada de auditoría sensible con fecha "2026-04-30"
    Cuando se ejecuta la política de retención
    Entonces la entrada permanece accesible al menos hasta "2033-04-30"
    Y NO puede ser purgada antes de ese plazo

  @export @siem
  Escenario: Exportación periódica a SIEM externo
    Dado un endpoint SIEM configurado con formato CEF
    Cuando se ejecuta la tarea diaria de exportación
    Entonces las entradas del día se envían en formato CEF firmado
    Y se reintenta hasta 3 veces si falla
    Y la exportación misma genera entrada "AuditExportedToSIEM"
