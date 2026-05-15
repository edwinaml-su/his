# language: es
# Épica: E30 — Notificaciones (Beta.15 / US.B15.3.1)
# TDR: §30 Alertas y Notificaciones (cross-cutting)
# Stack backend: notificationsRouter (list, markRead, unreadCount)
# Stack frontend: apps/web /notifications (client component + trpc react)
# Persona principal: P5 — Médico / P6 — Enfermería / P7 — Farmacéutico
# Valor: Permitir al clínico revisar sus alertas críticas y marcarlas como leídas
#        manteniendo aislamiento por usuario y por tenant.

@phase2 @notifications @beta15 @es-SV
Característica: Inbox personal de notificaciones del clínico
  Como clínico autenticado en su tenant
  Quiero revisar y marcar como leídas mis notificaciones recientes
  Para no perder alertas y mantener mi bandeja limpia.

  Antecedentes:
    Dado un usuario autenticado con rol "medico_planta" en el tenant actual

  @smoke @happy
  Escenario: Listado por defecto del inbox
    Dado que el usuario tiene 3 notificaciones recientes en su tenant
    Cuando visita "/notifications"
    Entonces ve una tabla con las 3 notificaciones ordenadas por createdAt DESC
    Y cada fila muestra: badge de severity, asunto, fecha relativa y estado
    Y solo ve las notificaciones cuyo recipientUserId coincide con su userId

  @happy
  Escenario: Inbox vacío muestra empty state
    Dado que el usuario no tiene ninguna notificación en su tenant
    Cuando visita "/notifications"
    Entonces ve el mensaje "No tienes notificaciones"
    Y no se renderiza ninguna fila de tabla

  @happy
  Escenario: Marcar una notificación como leída
    Dado una notificación con status "SENT" del usuario actual
    Cuando hace click en "Marcar leída" en esa fila
    Entonces el procedure notifications.markRead se invoca con el id correcto
    Y el status pasa a "READ"
    Y readAt registra el timestamp actual
    Y el contador unreadCount disminuye en 1

  @happy
  Escenario: markRead es idempotente para notificaciones ya leídas
    Dado una notificación con status "READ" del usuario actual
    Cuando invoco notifications.markRead con su id
    Entonces el procedure retorna ok=true y alreadyRead=true
    Y readAt NO se sobrescribe

  @happy
  Escenario: Paginación cargar más
    Dado que el usuario tiene 60 notificaciones en su tenant
    Cuando visita "/notifications"
    Entonces ve las primeras 25 notificaciones
    Y ve un botón "Cargar más" porque hay nextCursor
    Cuando hace click en "Cargar más"
    Entonces ve las siguientes 25 (total 50 mostradas)
    Y el botón "Cargar más" sigue visible mientras quede nextCursor

  @happy @filter
  Escenario: Filtrar por severidad CRITICAL
    Dado que el usuario tiene 5 notificaciones CRITICAL, 3 WARNING y 2 INFO
    Cuando selecciona el filtro "Críticas"
    Entonces solo ve las 5 notificaciones con severity=CRITICAL

  @edge @security
  Escenario: Aislamiento por usuario dentro del mismo tenant
    Dado que el usuario A tiene 2 notificaciones y el usuario B tiene 4
    Y ambos están en el mismo organizationId
    Cuando el usuario A visita "/notifications"
    Entonces solo ve sus 2 notificaciones
    Y nunca ve las del usuario B aunque pertenezcan al mismo tenant

  @edge @security
  Escenario: Aislamiento cross-tenant impide marcar notificación ajena
    Dado una notificación cuyo organizationId NO coincide con el tenant actual
    Cuando invoco notifications.markRead con su id
    Entonces el sistema responde NOT_FOUND
    Y el registro NO se modifica
