# language: es
# Épica: E5 — ADT
# Historias cubiertas: US-5.4
# TDR: §8.4
# Persona principal: P2 — Enfermería, P6 — Jefe servicio
# Valor de negocio: Movimiento seguro de pacientes entre servicios con validación
# de aislamiento y notificación al servicio receptor.

@critical @adt @transfer @es-SV
Característica: Traslado interno entre servicios y camas
  Como enfermería (P2)
  Quiero solicitar y ejecutar traslados con validación automática
  Para mover pacientes con seguridad y trazabilidad.

  Antecedentes:
    Dado paciente "MRN-000123" en cama "MI-201" servicio "Medicina Interna"
    Y existen camas:
      | cama   | servicio | estado | aislamiento |
      | UCI-3  | UCI      | libre  | ninguno     |
      | UCI-4  | UCI      | libre  | respiratorio|
      | MI-204 | MI       | libre  | ninguno     |
    Y inicio sesión con rol "enfermeria"

  @smoke @golden
  Escenario: Traslado exitoso de Medicina Interna a UCI
    Cuando solicito traslado a "UCI-3" con motivo "Deterioro respiratorio"
    Entonces el sistema valida disponibilidad y aislamiento
    Y notifica al servicio receptor "UCI" en tiempo real
    Cuando UCI confirma recepción del paciente
    Entonces la cama "MI-201" pasa a "sucia"
    Y la cama "UCI-3" pasa a "ocupada"
    Y se publica "Transferred"
    Y el censo de ambos servicios se actualiza realtime

  @validation @isolation
  Escenario: Bloqueo por incompatibilidad de aislamiento
    Dado el paciente sin bandera de aislamiento
    Cuando intento trasladar a "UCI-4" (cohorte respiratoria)
    Entonces el sistema bloquea con "Cama destinada a pacientes con aislamiento respiratorio"
    Y sugiere "UCI-3" como alternativa

  @validation @no-disponibilidad
  Escenario: Bloqueo si destino no está libre
    Dado cama "UCI-3" pasa a "ocupada" durante el flujo
    Cuando confirmo el traslado
    Entonces el sistema responde "Cama no disponible"
    Y muestra alternativas

  @reject
  Escenario: Rechazo del servicio receptor
    Cuando solicito traslado a UCI
    Y UCI responde "Capacidad cero, derivar a otro centro"
    Entonces el traslado queda en "RECHAZADO"
    Y publica "TransferRejected"
    Y se notifica al jefe de servicio origen

  @audit
  Escenario: Cada traslado queda en audit_log
    Cuando se ejecuta traslado exitoso
    Entonces audit_log registra "Transferred" con cama_origen, cama_destino, motivo, autores y timestamps
