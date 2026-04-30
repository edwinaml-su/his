# language: es
# Épica: E4 — MPI: Identificación Única del Paciente
# Historias cubiertas: US-4.1, US-4.2, US-4.6, US-4.7, US-4.8 (vinculación RN parcial)
# TDR: §8.1 (MPI), §27 (DUI/NIT El Salvador)
# Persona principal: P3 — Personal de admisión
# Valor de negocio: Identificar pacientes sin duplicidad en menos de 3-5 minutos,
# con datos demográficos íntegros y validación documental fuerte para SV.

@critical @mpi @es-SV
Característica: Registro de paciente en El Salvador
  Como personal de admisión (P3)
  Quiero registrar pacientes con datos demográficos completos y documento validado
  Para construir un MPI confiable, sin duplicados y trazable.

  Antecedentes:
    Dado que el establecimiento "Hospital Avante San Salvador" está activo
    Y el pack de localización "SV" está habilitado para la organización
    Y inicio sesión con rol "admision"
    Y selecciono el contexto "Hospital Avante San Salvador / Admisiones"
    Y navego al módulo "Registro de Paciente"

  # ----------------------------------------------------------------------
  # Golden path
  # ----------------------------------------------------------------------
  @smoke @golden
  Escenario: Registro exitoso de paciente adulto con DUI válido
    Cuando capturo los datos demográficos:
      | campo                | valor                          |
      | primer_nombre        | María                          |
      | segundo_nombre       | Elena                          |
      | primer_apellido      | Hernández                      |
      | segundo_apellido     | López                          |
      | fecha_nacimiento     | 1985-03-12                     |
      | sexo_biologico       | F                              |
      | identidad_genero     | Femenino                       |
      | tipo_documento       | DUI                            |
      | numero_documento     | 04567823-4                     |
      | departamento         | San Salvador                   |
      | municipio            | Soyapango                      |
      | telefono_movil       | +50377889900                   |
      | grupo_sanguineo      | O+                             |
    Y guardo el registro
    Entonces el sistema crea el paciente con un MRN único
    Y el evento "PatientRegistered" se publica en el outbox
    Y el audit_log registra la creación con el usuario, timestamp y hash encadenado
    Y veo el mensaje "Paciente registrado correctamente"

  # ----------------------------------------------------------------------
  # Validación DUI — matriz de casos válidos e inválidos
  # ----------------------------------------------------------------------
  @validation @dui
  Esquema del escenario: Validación del DUI con dígito verificador (módulo 10)
    Cuando capturo el tipo de documento "DUI" con número "<dui>"
    Entonces el resultado de la validación debe ser "<resultado>"
    Y el mensaje mostrado contiene "<mensaje>"

    Ejemplos: DUIs válidos
      | dui          | resultado | mensaje                       |
      | 04567823-4   | valido    | DUI válido                    |
      | 00000001-9   | valido    | DUI válido                    |
      | 12345678-5   | valido    | DUI válido                    |
      | 03219876-8   | valido    | DUI válido                    |
      | 06789012-3   | valido    | DUI válido                    |

    Ejemplos: DUIs inválidos por dígito verificador
      | dui          | resultado | mensaje                                    |
      | 04567823-0   | invalido  | Dígito verificador no coincide             |
      | 12345678-9   | invalido  | Dígito verificador no coincide             |
      | 00000000-0   | invalido  | DUI no permitido                           |

    Ejemplos: DUIs inválidos por formato
      | dui          | resultado | mensaje                                    |
      | 4567823-4    | invalido  | Formato esperado: 8 dígitos + guion + 1    |
      | 045678234    | invalido  | Formato esperado: 8 dígitos + guion + 1    |
      | ABCDEFGH-1   | invalido  | El DUI solo admite dígitos                 |
      | 04567823-A   | invalido  | El dígito verificador debe ser numérico    |
      |              | invalido  | El DUI es obligatorio para mayores de edad |

  @validation @dui @duplicates
  Escenario: Bloqueo al intentar registrar un DUI ya existente
    Dado que existe un paciente activo con DUI "04567823-4"
    Cuando intento registrar otro paciente con el mismo DUI "04567823-4"
    Entonces el sistema bloquea el guardado
    Y muestra "Ya existe un paciente registrado con este DUI: María Elena Hernández López (MRN-000123)"
    Y ofrece la acción "Ver expediente existente"
    Y no se crea un nuevo registro
    Y el audit_log registra el intento como "PatientDuplicateAttempt"

  # ----------------------------------------------------------------------
  # Detección probabilística previa al guardado
  # ----------------------------------------------------------------------
  @duplicates @probabilistic
  Escenario: Advertencia de posible duplicado por similitud demográfica
    Dado que existe un paciente "Maria E. Hernandez Lopez" nacido el "1985-03-12" sexo "F" sin DUI
    Cuando capturo "María Elena Hernández López" nacida el "1985-03-12" sexo "F"
    Y aún no he capturado el DUI
    Entonces el sistema muestra una alerta "Posible duplicado detectado (score 0.92)"
    Y lista al paciente candidato con MRN, fecha de nacimiento y sexo
    Y exige confirmación explícita "Confirmar que es un paciente diferente" antes de continuar
    Y el evento "PossibleDuplicateDetected" se publica en el outbox

  # ----------------------------------------------------------------------
  # Pacientes NN (sin documento)
  # ----------------------------------------------------------------------
  @nn @emergency
  Escenario: Registro de paciente NN traído inconsciente a emergencia
    Dado que el paciente llega inconsciente sin acompañante
    Cuando selecciono "Registrar como NN"
    Y capturo solo los datos disponibles:
      | campo            | valor       |
      | sexo_aparente    | M           |
      | edad_estimada    | 45          |
      | señas_visibles   | tatuaje brazo izquierdo "M.A.R." |
    Y guardo el registro
    Entonces el sistema asigna un identificador temporal con formato "NN-AAAAMMDD-NNN"
    Y el paciente queda marcado como "pendiente_identificacion"
    Y se permite emitir pulsera con el código NN
    Y el registro puede fusionarse posteriormente con un MRN definitivo

  @nn @merge
  Escenario: Identificación posterior y fusión de NN con paciente existente
    Dado un paciente "NN-20260430-007" registrado hace 2 horas
    Y existe en MPI el paciente "Carlos Antonio Ramírez Méndez" con DUI "01234567-8"
    Cuando un familiar identifica al NN como "Carlos Antonio Ramírez Méndez"
    Y ejecuto la acción "Fusionar NN con paciente existente"
    Y proporciono justificación "Identificación por familiar - cédula presentada"
    Entonces el sistema requiere rol "admin_clinico" o "super_admin"
    Y los encuentros del NN se reasocian al MRN definitivo
    Y el evento "PatientsMerged" se publica con origen "NN"
    Y el audit_log registra la fusión con justificación

  # ----------------------------------------------------------------------
  # Menores de edad
  # ----------------------------------------------------------------------
  @minor
  Escenario: Registro de menor con carné de minoridad
    Cuando capturo los datos demográficos de un menor:
      | campo                  | valor                |
      | primer_nombre          | Diego                |
      | primer_apellido        | Ramírez              |
      | fecha_nacimiento       | 2014-08-22           |
      | sexo_biologico         | M                    |
      | tipo_documento         | CARNE_MINORIDAD      |
      | numero_documento       | CM-2014-082234       |
      | nombre_responsable     | Carlos Ramírez       |
      | dui_responsable        | 01234567-8           |
      | parentesco_responsable | padre                |
    Y guardo el registro
    Entonces el sistema acepta el documento sin requerir DUI
    Y vincula al responsable como contacto legal
    Y registra el evento "MinorRegistered"

  @minor
  Escenario: Registro de recién nacido con partida de nacimiento y vínculo materno
    Dado que existe la madre "Ana Beatriz Pérez" con MRN "MRN-000555"
    Cuando registro al recién nacido:
      | campo               | valor                |
      | primer_nombre       | Sofía                |
      | primer_apellido     | Pérez                |
      | fecha_nacimiento    | 2026-04-29           |
      | sexo_biologico      | F                    |
      | tipo_documento      | PARTIDA_NACIMIENTO   |
      | numero_documento    | PN-SS-2026-0123456   |
      | madre_mrn           | MRN-000555           |
      | peso_al_nacer_g     | 3250                 |
    Y guardo el registro
    Entonces el sistema crea el vínculo madre-recién-nacido (US-4.7)
    Y el RN puede heredar alergias relevantes en la HCE
    Y el evento "NewbornRegistered" se publica con referencia a "MotherPatientId"

  @minor @validation
  Escenario: Bloqueo al exigir DUI a un menor de 18 años
    Cuando capturo fecha de nacimiento "2015-01-10" y selecciono tipo de documento "DUI"
    Entonces el sistema rechaza la combinación
    Y muestra "El DUI solo aplica a personas mayores de 18 años. Use 'Carné de Minoridad' o 'Partida de Nacimiento'"

  # ----------------------------------------------------------------------
  # Alergias en el registro inicial
  # ----------------------------------------------------------------------
  @allergies
  Escenario: Captura de alergia crítica al registrar paciente
    Cuando registro al paciente con DUI válido
    Y agrego la alergia:
      | sustancia      | reaccion       | severidad  |
      | Penicilina     | Anafilaxia     | CRITICA    |
    Y guardo el registro
    Entonces la alergia queda visible en el banner de identidad del paciente
    Y se marca como "no_modificable_sin_revision_clinica"
    Y el evento "AllergyRecorded" se publica con severidad "CRITICA"

  # ----------------------------------------------------------------------
  # Accesibilidad
  # ----------------------------------------------------------------------
  @a11y
  Escenario: Formulario de registro accesible con teclado y lector de pantalla
    Cuando navego el formulario de registro únicamente con tabulador
    Entonces el orden de foco sigue el flujo lógico del formulario
    Y cada campo tiene etiqueta asociada (label-for)
    Y los mensajes de error se anuncian vía aria-live
    Y el contraste de los mensajes cumple WCAG AA (≥ 4.5:1)
