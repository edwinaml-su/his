# language: es
# Épica: Hardening OWASP Top 10:2025 — A06 Insecure Design / A07 Authentication Failures / A09 Security Logging and Alerting Failures
# Historias cubiertas: sin US formal de backlog — remediación de auditoría de seguridad
# Fuente: docs/audit/2026-08-17_owasp_2025_remediacion.md (§A06, §A07, §A09)
# Persona principal: P8 super-admin/CISO; personal clínico con rol privilegiado (DIR/ARCH/ADMIN)
# Valor de negocio: frenar el abuso automatizado de la API sin afectar la atención
# clínica normal, exigir un segundo factor a los roles privilegiados cuando Avante
# active la política, y dejar rastro auditable — sin datos de paciente en los logs
# técnicos — de cada consulta al copiloto de IA.

@critical @security @owasp2025 @es-SV
Característica: Freno al abuso de la API, segundo factor para roles privilegiados y auditoría del copiloto
  Como super-admin / CISO del HIS
  Quiero que la API se defienda sola ante tráfico abusivo, que el personal con
  rol privilegiado confirme un segundo factor cuando la política lo exija, y que
  toda consulta al copiloto de IA quede trazada sin exponer datos de pacientes
  Para reducir la superficie de ataque sin interrumpir la operación clínica normal.

  Antecedentes:
    Dado que el límite de peticiones sin sesión iniciada es 60 por minuto por
      dirección IP
    Y el límite de peticiones con sesión iniciada es 600 por minuto por usuario

  # ----------------------------------------------------------------------
  # Rate limit global de la API (A06)
  # ----------------------------------------------------------------------
  @critical @rate-limit @a06
  Escenario: Se supera el umbral sin sesión iniciada
    Dado que no tengo sesión iniciada
    Cuando envío más de 60 peticiones en un minuto desde la misma dirección IP
    Entonces a partir de la petición 61 el sistema responde código 429
    Y la respuesta indica cuánto tiempo debo esperar antes de reintentar

  @rate-limit @a06 @edge-case
  Escenario: El uso normal de un usuario autenticado nunca alcanza el límite
    Dado que inicié sesión como "medico1@avante.sv"
    Cuando uso el sistema con normalidad, incluyendo el refresco automático de
      los tableros clínicos (censo de camas, bandeja de tareas) durante mi turno
    Entonces ninguna de mis peticiones recibe código 429
    Y no noto ninguna diferencia respecto al comportamiento antes de activar el límite

  @rate-limit @a06 @edge-case @resilience
  Escenario: Si el mecanismo de conteo de peticiones falla, el personal clínico no queda bloqueado
    Dado que inicié sesión como "enfermera1@avante.sv"
    Y el mecanismo interno que cuenta las peticiones para el límite deja de responder
    Cuando registro signos vitales de un paciente
    Entonces la operación se completa con normalidad
    Y el sistema no me bloquea por no poder verificar el límite
    # Nota: a diferencia del gate de sesión (que falla cerrado, ver A10), el
    # límite de peticiones falla abierto — un contador caído no puede
    # convertirse en una interrupción de la atención al paciente.

  # ----------------------------------------------------------------------
  # Segundo factor obligatorio para roles privilegiados (A07)
  # ----------------------------------------------------------------------
  @a07
  Escenario: Con la política activa, un rol privilegiado sin segundo factor verificado en la sesión es redirigido
    Dado que Avante activó la exigencia de segundo factor para el rol "DIR"
    Y inicio sesión como "director.medico@avante.sv" con rol "DIR"
    Y mi sesión aún no tiene un segundo factor verificado
    Cuando intento abrir cualquier pantalla clínica o administrativa
    Entonces se me redirige a la pantalla de verificación de segundo factor "/mfa"
    Y ninguna llamada a la API me devuelve datos hasta verificar el segundo factor

  @a07
  Escenario: Con la política apagada (comportamiento por defecto), nada cambia
    Dado que Avante NO ha configurado ningún rol en la exigencia de segundo factor
    Y inicio sesión como "director.medico@avante.sv" con rol "DIR"
    Cuando abro cualquier pantalla clínica o administrativa
    Entonces accedo con normalidad, igual que antes de esta remediación
    Y no se me pide ningún segundo factor adicional al de mi login habitual

  @a07 @validation @edge-case
  Escenario: Una marca de sesión de segundo factor falsificada no sirve
    Dado que Avante activó la exigencia de segundo factor para el rol "ADMIN"
    Y inicio sesión como "admin.sistemas@avante.sv" con rol "ADMIN"
    Cuando presento una marca de "segundo factor verificado" que no fue emitida
      por el sistema al completar mi TOTP
    Entonces el sistema la considera inválida
    Y se me redirige a "/mfa" igual que si no hubiera presentado ninguna marca

  @a07 @validation @edge-case
  Escenario: Una marca de sesión de segundo factor vencida no sirve
    Dado que Avante activó la exigencia de segundo factor para el rol "ARCH"
    Y verifiqué mi segundo factor hace más de 12 horas
    Cuando intento abrir una pantalla protegida sin volver a verificar
    Entonces mi marca de segundo factor ya no es válida
    Y se me redirige a "/mfa" para verificar nuevamente

  @a07 @edge-case @fail-closed
  Escenario: Un rol configurado para exigir segundo factor sin la firma de sesión lista se niega, no se ignora
    Dado que Avante configuró el rol "DIR" en la exigencia de segundo factor
    Pero el mecanismo de firma de la sesión de segundo factor no quedó
      correctamente configurado
    Cuando un usuario con rol "DIR" intenta abrir una pantalla protegida
    Entonces el sistema le niega el acceso
    Y NO lo deja pasar como si la política estuviera apagada

  # ----------------------------------------------------------------------
  # Auditoría del copiloto de IA (A09)
  # ----------------------------------------------------------------------
  @a09 @audit @ia
  Escenario: Toda consulta al copiloto de IA queda en la cadena de auditoría inmutable
    Dado que inicié sesión como "medico1@avante.sv"
    Cuando le hago una pregunta al copiloto de IA sobre un protocolo clínico
    Entonces la consulta y su respuesta quedan registradas en el audit_log
    Y esa entrada forma parte de la misma cadena de hash verificable que el
      resto de la auditoría del sistema

  @a09 @audit @ia @privacy
  Escenario: Los logs técnicos de aplicación no contienen identificadores del paciente
    Dado que inicié sesión como "medico1@avante.sv"
    Cuando le pregunto al copiloto de IA por el paciente con expediente "2229000003"
    Entonces la conversación completa con el paciente identificado queda en el
      registro de auditoría clínica, con acceso restringido y trazabilidad
    Pero los logs técnicos generales de la aplicación (los que revisa
      soporte/SRE ante un incidente) NO contienen el número de expediente, DUI,
      NIT ni nombre del paciente en texto plano
