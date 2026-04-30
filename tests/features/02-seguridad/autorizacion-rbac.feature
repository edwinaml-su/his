# language: es
# Épica: E2 — Seguridad
# Historias cubiertas: US-2.3 (RBAC), US-2.4 (ABAC)
# TDR: §6
# Persona principal: P8 — Super-admin TI
# Valor de negocio: Control granular de accesos por rol y atributos contextuales
# (servicio, sede, turno) cumpliendo principio de mínimo privilegio.

@critical @security @authz @rbac @es-SV
Característica: Autorización RBAC + ABAC
  Como super-admin (P8)
  Quiero asignar roles y reglas ABAC a los usuarios
  Para que cada uno acceda únicamente a lo que necesita por su función y contexto.

  Antecedentes:
    Dado que existen los roles base:
      | rol             |
      | super_admin     |
      | admin_clinico   |
      | admision        |
      | triador         |
      | enfermeria      |
      | medico          |
      | jefe_servicio   |
      | lectura         |
    Y existe el catálogo de permisos por módulo

  @rbac
  Escenario: Usuario con rol "admision" puede crear pacientes pero no firmar epicrisis
    Dado un usuario con rol "admision"
    Cuando accede al módulo "MPI"
    Entonces puede crear, editar y buscar pacientes
    Y al intentar acceder a "Firmar epicrisis" recibe "403 - Acción no autorizada"

  @rbac
  Escenario: Usuario "lectura" no puede modificar nada
    Dado un usuario con rol "lectura"
    Cuando intenta cualquier operación de escritura
    Entonces el sistema responde "403"
    Y los botones de acción están deshabilitados con tooltip "Solo lectura"

  @rbac @ui
  Escenario: La UI oculta acciones no permitidas
    Dado un usuario con rol "enfermeria"
    Cuando navega al expediente
    Entonces NO ve el botón "Firmar nota médica"
    Y SÍ ve "Registrar signos vitales"

  @abac @servicio
  Escenario: ABAC limita acceso a servicio asignado
    Dado un médico asignado al servicio "Medicina Interna"
    Y existe paciente activo en servicio "Cirugía"
    Cuando intenta abrir el expediente del paciente de "Cirugía"
    Entonces el sistema responde "403 - Fuera de ámbito de servicio"
    A menos que active "break-the-glass"

  @abac @turno
  Escenario: ABAC limita acceso por turno activo
    Dado un médico con turno "diurno (07:00-19:00)"
    Cuando intenta acceder al sistema a las "23:00"
    Entonces el sistema bloquea la sesión clínica
    Y muestra "Su turno actual no está activo. Use break-glass si es emergencia"

  @rbac @admin
  Escenario: Solo super_admin puede crear/editar roles
    Dado un usuario "admin_clinico"
    Cuando intenta crear un nuevo rol "supervisor"
    Entonces el sistema responde "403"
    Y el evento "UnauthorizedRoleChangeAttempt" se audita

  @rbac @audit
  Escenario: Cambios de rol quedan auditados
    Dado super_admin asigna rol "medico" al usuario "u123"
    Entonces el audit_log registra "UserRoleChanged" con rol_previo, rol_nuevo y autor
    Y notifica al usuario afectado por email
