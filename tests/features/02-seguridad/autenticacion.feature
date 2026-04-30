# language: es
# Épica: E2 — Seguridad, AuthN/AuthZ y Auditoría
# Historias cubiertas: US-2.1, US-2.2, US-2.6, US-2.10
# TDR: §6 (Seguridad)
# Persona principal: Todos los roles (foco en P8 super-admin para configuración)
# Valor de negocio: Acceso seguro de grado clínico, MFA para roles privilegiados,
# bloqueo por intentos, y gestión de sesiones que cumple políticas internas.

@critical @security @authn @es-SV
Característica: Autenticación de usuarios
  Como cualquier usuario del HIS
  Quiero iniciar y cerrar sesión de forma segura, con MFA cuando aplique
  Para proteger los datos clínicos y administrativos de Avante.

  Antecedentes:
    Dado que la política de contraseñas vigente es:
      | parametro                     | valor |
      | longitud_minima               | 12    |
      | requiere_mayuscula            | true  |
      | requiere_numero               | true  |
      | requiere_simbolo              | true  |
      | historial_contraseñas         | 5     |
      | expiracion_dias               | 90    |
      | max_intentos_fallidos         | 5     |
      | bloqueo_minutos               | 15    |
      | idle_timeout_minutos          | 15    |
    Y el dominio activo es "his.avante.sv"

  # ----------------------------------------------------------------------
  # Login básico
  # ----------------------------------------------------------------------
  @smoke @login
  Escenario: Login exitoso con credenciales válidas (rol no privilegiado)
    Dado que existe el usuario "enfermera1@avante.sv" con rol "enfermeria"
    Cuando ingreso "enfermera1@avante.sv" y la contraseña correcta
    Entonces el sistema autentica y redirige al dashboard según rol
    Y se crea una sesión con expiración por inactividad de 15 minutos
    Y el evento "LoginSucceeded" queda registrado

  @login @validation
  Escenario: Login fallido con credencial incorrecta
    Cuando ingreso "enfermera1@avante.sv" y contraseña incorrecta
    Entonces se muestra el mensaje genérico "Credenciales inválidas"
    Y NO se revela si el usuario existe o no
    Y el contador de intentos fallidos se incrementa en 1
    Y el evento "LoginFailed" queda registrado

  # ----------------------------------------------------------------------
  # MFA TOTP obligatorio para roles privilegiados
  # ----------------------------------------------------------------------
  @mfa @privileged
  Escenario: MFA obligatorio para rol super_admin
    Dado que existe el usuario "admin@avante.sv" con rol "super_admin" y MFA enrolado
    Cuando ingreso credenciales válidas
    Entonces el sistema solicita un código TOTP de 6 dígitos
    Cuando ingreso el código TOTP correcto
    Entonces accedo al panel y se registra "LoginSucceeded" con flag "mfa=true"

  @mfa @privileged
  Escenario: MFA obligatorio para rol admin_clinico
    Dado un usuario con rol "admin_clinico"
    Cuando inicia sesión con credenciales válidas
    Entonces el sistema exige código TOTP además de contraseña
    Y bloquea el acceso si TOTP no se proporciona

  @mfa @enrollment
  Escenario: Primer enrolamiento MFA entrega códigos de respaldo
    Dado un usuario "admin_clinico" recién creado sin MFA
    Cuando inicia sesión por primera vez
    Entonces el sistema fuerza el enrolamiento TOTP antes de continuar
    Y muestra QR de provisión y secreto base32
    Y al confirmar el primer código, entrega 10 códigos de respaldo de un solo uso
    Y exige descargar/imprimir antes de cerrar el modal

  @mfa @validation
  Escenario: Código TOTP inválido o expirado
    Cuando ingreso un código TOTP "000000" inválido
    Entonces el sistema rechaza con "Código TOTP inválido"
    Y el contador de intentos MFA fallidos se incrementa
    Tras "3" intentos MFA fallidos
    Entonces la sesión candidata se invalida
    Y se exige reiniciar el flujo de login

  # ----------------------------------------------------------------------
  # Bloqueo por intentos fallidos
  # ----------------------------------------------------------------------
  @lockout
  Esquema del escenario: Bloqueo progresivo por intentos fallidos
    Dado un usuario con "<intentos_previos>" intentos fallidos
    Cuando falla el login una vez más
    Entonces el sistema responde "<respuesta>"
    Y el estado del usuario es "<estado>"

    Ejemplos:
      | intentos_previos | respuesta                                    | estado    |
      | 0                | Credenciales inválidas                       | activo    |
      | 3                | Credenciales inválidas (advertencia interna) | activo    |
      | 4                | Cuenta bloqueada por 15 minutos              | bloqueado |

  @lockout @audit
  Escenario: El bloqueo se audita y notifica al administrador
    Dado un usuario que llega al 5to intento fallido
    Entonces el sistema bloquea la cuenta por 15 minutos
    Y emite el evento "AccountLocked"
    Y notifica al super-admin vía email/Slack
    Y el audit_log registra IP de origen y user-agent

  # ----------------------------------------------------------------------
  # Recuperación de contraseña
  # ----------------------------------------------------------------------
  @password-reset
  Escenario: Recuperación de contraseña vía enlace temporal
    Cuando solicito "Olvidé mi contraseña" para "enfermera1@avante.sv"
    Entonces el sistema envía un enlace de un solo uso al correo
    Y el enlace expira en 30 minutos
    Y al ingresar nueva contraseña esta debe cumplir la política
    Y NO puede coincidir con las últimas 5 usadas
    Y al guardar emite "PasswordChanged" y cierra todas las sesiones activas

  @password-reset @validation
  Escenario: Rechazo de contraseña que no cumple política
    Cuando intento establecer contraseña "Avante2026"
    Entonces el sistema rechaza con detalle:
      | regla                | cumple |
      | longitud >= 12       | false  |
      | requiere símbolo     | false  |

  # ----------------------------------------------------------------------
  # Sesión expirada e idle timeout
  # ----------------------------------------------------------------------
  @session
  Escenario: Sesión expira por inactividad
    Dado que estoy autenticado desde hace 14 minutos sin actividad
    Cuando transcurre 1 minuto adicional sin actividad
    Entonces la sesión se invalida automáticamente
    Y al siguiente request soy redirigido al login
    Y el sistema emite "SessionExpired"

  @session @ux
  Escenario: Aviso de inactividad próximo a expiración
    Dado que llevo 13 minutos sin actividad
    Entonces se muestra modal "Su sesión expirará en 2 minutos. ¿Desea continuar?"
    Cuando hago clic en "Continuar"
    Entonces el contador de inactividad se reinicia

  # ----------------------------------------------------------------------
  # Cierre de sesión
  # ----------------------------------------------------------------------
  @logout
  Escenario: Cierre de sesión manual
    Cuando hago clic en "Cerrar sesión"
    Entonces la sesión se invalida en el servidor (no solo en cliente)
    Y al volver atrás en el navegador no recupero el estado autenticado
    Y se emite "LogoutSucceeded"

  @logout @admin
  Escenario: Cierre forzado de todas las sesiones desde panel admin
    Dado que soy super_admin
    Cuando ejecuto "Cerrar todas las sesiones" para el usuario "medico1@avante.sv"
    Entonces todas las sesiones activas del usuario quedan invalidadas
    Y el usuario afectado pierde acceso al siguiente request
    Y se emite "AllSessionsRevoked" con autor

  # ----------------------------------------------------------------------
  # Accesibilidad
  # ----------------------------------------------------------------------
  @a11y
  Escenario: Pantalla de login accesible
    Cuando navego al login solo con teclado
    Entonces puedo completar el flujo sin necesidad de ratón
    Y los errores se anuncian con aria-live="assertive"
    Y el campo contraseña tiene toggle de visibilidad accesible (aria-pressed)
