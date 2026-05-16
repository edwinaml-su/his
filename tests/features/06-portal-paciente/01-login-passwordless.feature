# Feature: Login passwordless del paciente en el portal
# Referencia: US.B20.1.1, US.B20.1.2
# Regulatoria: D.39/2024 Art. 5 (datos sensibles), TDR §6.4
# Owner: @QAF — Quality Analyst (BDD)
# Notas: Este archivo es especificación BDD (no está automatizado — @QA lo implementará en Beta.20a)

Característica: Login passwordless del paciente en el portal

  Contexto:
    Dado que el sistema HIS tiene habilitado el módulo "Portal del Paciente"
    Y que Supabase Auth está configurado con magic link para el rol "patient"
    Y que existe un paciente con DUI "123456789" registrado en el sistema como "María López"

  Escenario: Activación exitosa con magic link de invitación (happy path)
    Dado que el establecimiento ha enviado una invitación al email "maria.lopez@ejemplo.com" vinculada al patient_id de "María López"
    Y el email contiene un magic link con TTL de 24 horas aún válido
    Cuando "María López" hace clic en el magic link desde su cliente de correo
    Entonces el sistema valida el token con Supabase Auth correctamente
    Y crea una sesión con claim { role: "patient", patient_id: <uuid_valido>, invited_by_org_id: <org_id> }
    Y redirige a la paciente a /portal/dashboard
    Y el dashboard muestra "Bienvenida, María López" con el nombre del establecimiento
    Y AuditLog registra una entrada con action="PORTAL_ACCOUNT_ACTIVATED" y el patient_id correspondiente

  Escenario: Magic link expirado (edge case de tiempo)
    Dado que el establecimiento envió una invitación hace más de 24 horas
    Y el magic link del email tiene TTL vencido
    Cuando "María López" hace clic en el magic link
    Entonces el sistema muestra el mensaje "Tu enlace de acceso ha expirado. Solicita uno nuevo."
    Y la página muestra un formulario para ingresar el email y solicitar un nuevo link
    Y NO se crea ninguna sesión de paciente
    Y NO aparece ninguna entrada en AuditLog de tipo "PORTAL_LOGIN"

  Escenario: Intento de acceso con email no registrado (seguridad anti-enumeración)
    Dado que "pedro.desconocido@otro.com" no está registrado como paciente en el sistema
    Cuando "Pedro Desconocido" ingresa ese email en /portal/login y solicita el magic link
    Entonces el sistema muestra el mensaje "Si tienes expediente con nosotros, recibirás un enlace en tu correo"
    Y NO se envía ningún email a esa dirección
    Y el tiempo de respuesta es equivalente al de un email registrado (prevención de timing attack)
    Y AuditLog registra una entrada con action="PORTAL_LOGIN_ATTEMPT_UNKNOWN_EMAIL" sin revelar el patient_id

  Escenario: Login recurrente de paciente ya activado (happy path segundo acceso)
    Dado que "María López" ya activó su cuenta previamente
    Y tiene una cuenta activa en el portal vinculada a "maria.lopez@ejemplo.com"
    Cuando ingresa su email en /portal/login y hace clic en "Enviar enlace de acceso"
    Entonces recibe un email con el magic link en menos de 2 minutos
    Y al hacer clic en el link obtiene una sesión válida de 8 horas
    Y es redirigida a /portal/dashboard
    Y AuditLog registra action="PORTAL_LOGIN" con patientId, ip y userAgent

  Escenario: Sesión expirada durante la navegación del portal
    Dado que "María López" inició sesión hace más de 8 horas
    Y su sesión JWT ha expirado
    Cuando intenta acceder a /portal/resultados
    Entonces el sistema la redirige a /portal/login con query param ?redirect=/portal/resultados
    Y muestra el mensaje "Tu sesión ha expirado. Ingresa de nuevo para continuar."
    Y después del nuevo login es redirigida a /portal/resultados (la URL original)
