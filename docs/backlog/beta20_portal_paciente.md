# Beta.20 — Backlog Portal del Paciente (Fase 7)

**Owner:** @PO — Chief Product Officer, Inversiones Avante
**Stream:** Beta.20 Portal del Paciente
**Fecha:** 2026-05-16
**Estado:** Backlog inicial — pendiente refinement con @AS / @DBA / @UIUX
**Predecesor:** Beta.15 (Alerts & Notifications — completado), Beta.19 (BI — en curso)
**Referencia blueprint:** `docs/blueprints/beta20_portal_paciente.md`

---

## 1. Visión de Producto

> Dar al paciente o a su representante legal un acceso seguro, auditado y centrado en la persona a su propia información clínica almacenada en HIS Avante, habilitando autoservicio (citas, resultados, consentimientos, comunicaciones) sin requerir presencia física, y cumpliendo las obligaciones del TDR §6.4, §14, §17.6, §18.5 y la Ley de Protección de Datos Personales SV (D.39/2024).

**Outcomes esperables (90 días post-release Beta.20a):**

- **OB1 — Adopción:** >= 30% de pacientes activos (con cita en los últimos 90 días) registrados en el portal al mes 2 post-lanzamiento.
- **OB2 — Reducción de llamadas:** tickets de soporte por "consultar resultado de laboratorio" reducidos en >= 40% respecto al baseline 30 días antes de la salida.
- **OB3 — Compliance:** 100% de consentimientos activos tienen registro auditable en `PatientConsent` con canal="PORTAL" y timestamp.
- **OB4 — Seguridad:** 0 incidentes de acceso cruzado entre pacientes (RLS verificada por @QA antes de cada release).
- **OB5 — Accesibilidad:** axe-core sin hallazgos críticos ni serios en cada release (portal es público externo — exigencia WCAG AA estricta).

---

## 2. Definition of Ready (DoR)

Una user story está lista para sprint cuando:

- [ ] Criterios de aceptación Gherkin redactados en es-SV con escenarios happy + edge + seguridad/privacidad.
- [ ] @AS aprobó el approach técnico del router/endpoint del portal (withPatientContext vs. withTenantContext).
- [ ] @DBA validó el shape de datos y la política RLS adicional para el portal.
- [ ] @UIUX tiene wireframe o referencia de componente Shadcn para la vista.
- [ ] Impacto en cifrado evaluado (ver `docs/14_encryption_strategy.md`).
- [ ] Story points estimados por planning poker.
- [ ] Dependencias upstream identificadas y desbloqueadas.

---

## 3. Definition of Done (DoD)

### DoD general (heredado del proyecto)

- [ ] Código mergeado en `main` vía PR + CI verde (typecheck + lint + test + build).
- [ ] Tests unitarios + al menos 1 integration test (router → BD → respuesta correcta).
- [ ] Documentación: comentario en código + entrada en `docs/` si cambia arquitectura.
- [ ] Demoeable en staging por @PO.

### DoD específico del Portal del Paciente

- [ ] **Auditoría de acceso:** cada lectura de dato clínico del paciente genera entrada en `AuditLog` con `action="PORTAL_PATIENT_READ"`, `patientId`, `field`, `requestedBy="portal"`, `ip`, `timestamp`. Sin excepción.
- [ ] **Aislamiento de tenant:** prueba E2E automatizada por @QA que demuestra que el paciente A no puede ver datos del paciente B bajo ninguna ruta `/portal/*`.
- [ ] **a11y WCAG AA estricto:** axe-core sin hallazgos críticos ni serios. Las páginas del portal son accesibles a lectores de pantalla (NVDA).
- [ ] **Sin leak de org interna:** ninguna respuesta del portal incluye `organizationId`, `establishmentId` o datos de estructura interna del HIS. El paciente solo ve su `patientId` como referencia.
- [ ] **Cifrado en tránsito verificado:** headers HSTS activos en `/portal/*` (ya configurados en Vercel — verificar que apliquen al subrutas).
- [ ] **Consentimiento verificado:** si la US involucra compartición de datos entre organizaciones del grupo, se verifica que `PatientConsent` tiene registro activo antes de mostrar los datos.
- [ ] **Marca de agua en descargas:** PDFs generados por el portal incluyen nombre del paciente + fecha + DUI enmascarado (últimos 3 dígitos visibles).

---

## 4. Épicas y User Stories

### Épica E.B20.1 — Auth y Onboarding del Paciente

**Goal:** Proveer al paciente un flujo de registro e inicio de sesión seguro, sin contraseña compleja, con verificación de identidad mínima y protección MFA opcional.

**WSJF:** Costo de retraso = MUY ALTO (bloquea todo lo demás). Tamaño = MEDIO. **WSJF ≈ 9 (primera prioridad absoluta).**

---

#### US.B20.1.1 — Registro inicial del paciente en el portal (invitación por el establecimiento)

**Como** paciente que recibió un correo de invitación del establecimiento de salud,
**quiero** activar mi cuenta en el portal con mi email y sin necesidad de crear una contraseña,
**para** poder acceder a mi expediente de forma segura y sin depender de que el establecimiento me entregue credenciales en papel.

**Criterios de aceptación (Gherkin es-SV):**

```gherkin
Característica: Registro inicial del paciente vía invitación

  Escenario: Activación exitosa con magic link
    Dado que el establecimiento ha enviado una invitación al email "paciente@ejemplo.com"
    Y el email contiene un magic link válido con TTL de 24 horas
    Cuando el paciente hace clic en el magic link
    Entonces el sistema valida el token con Supabase Auth
    Y crea la sesión del paciente con claim { patient_id, invited_by_org_id, role: "patient" }
    Y redirige al paciente a /portal/dashboard
    Y registra en AuditLog action="PORTAL_ACCOUNT_ACTIVATED" con patientId y timestamp

  Escenario: Magic link expirado
    Dado que el paciente recibe un magic link
    Y han pasado más de 24 horas desde que fue enviado
    Cuando el paciente hace clic en el link
    Entonces el sistema muestra el mensaje "Tu enlace de acceso ha expirado. Solicita uno nuevo."
    Y ofrece un botón para reenviar el magic link a su email registrado
    Y NO crea ninguna sesión

  Escenario: Email no registrado en el sistema
    Dado que alguien intenta iniciar sesión con un email no vinculado a ningún patient_id
    Cuando ingresa el email en /portal/login
    Entonces el sistema responde "Si tienes expediente con nosotros, recibirás un enlace en tu correo"
    Y NO revela si el email existe o no en la base de datos (prevención de enumeración)
    Y NO envía ningún email si el email no está registrado
```

- **MoSCoW:** Must
- **Story Points:** 8
- **Dependencias:** Tabla `PortalAccount` (patient_id, email, invited_by_org_id, activatedAt) — nueva, diseño @DBA. Supabase Auth magic link ya configurado para HIS interno; extender para rol "patient".
- **Riesgos:** La verificación de identidad documental (DUI) para el registro inicial es una decisión pendiente (ver §5 trade-off 1). En Beta.20a asumimos que el establecimiento pre-registra el email del paciente a partir de datos ya existentes en el sistema.

---

#### US.B20.1.2 — Login recurrente con magic link

**Como** paciente ya registrado en el portal,
**quiero** iniciar sesión ingresando solo mi email y recibir un enlace de acceso,
**para** no tener que recordar contraseñas y poder acceder desde cualquier dispositivo de forma segura.

**Criterios de aceptación (Gherkin es-SV):**

```gherkin
Característica: Login recurrente del paciente

  Escenario: Login exitoso con magic link
    Dado que el paciente tiene una cuenta activa en el portal
    Cuando ingresa su email en /portal/login y solicita el magic link
    Entonces recibe un email con el enlace en menos de 2 minutos
    Y al hacer clic en el enlace, el sistema inicia su sesión
    Y el JWT tiene TTL de 8 horas (configurable por tenant)
    Y se registra AuditLog action="PORTAL_LOGIN" con patientId, ip, userAgent

  Escenario: Sesión expirada durante el uso
    Dado que la sesión del paciente expiró mientras navegaba el portal
    Cuando intenta cargar una página protegida
    Entonces el sistema lo redirige a /portal/login con mensaje "Tu sesión ha expirado"
    Y conserva la URL destino para redirigir después del nuevo login

  Escenario: Múltiples dispositivos
    Dado que el paciente inicia sesión en su móvil
    Y luego solicita un nuevo magic link desde su computadora
    Cuando hace clic en el nuevo link
    Entonces tiene una sesión nueva en la computadora
    Y la sesión del móvil sigue activa (multi-sesión permitida)
```

- **MoSCoW:** Must
- **Story Points:** 3
- **Dependencias:** US.B20.1.1 (cuenta activa requerida)
- **Riesgos:** Bajo. El magic link de Supabase Auth ya existe — es solo configurar el redirectTo correcto para `/portal/*`.

---

#### US.B20.1.3 — Activación de MFA opcional para el paciente

**Como** paciente que quiere mayor seguridad en su cuenta del portal,
**quiero** habilitar un segundo factor de autenticación vía SMS o app TOTP,
**para** proteger mi expediente médico ante accesos no autorizados en caso de que alguien intercepte mi email.

**Criterios de aceptación (Gherkin es-SV):**

```gherkin
Característica: MFA opcional para pacientes

  Escenario: Activación de MFA por SMS
    Dado que el paciente está en /portal/perfil/seguridad
    Cuando selecciona "Activar verificación en dos pasos" y elige SMS
    Y ingresa su número de teléfono en formato E.164
    Y el sistema envía un OTP de 6 dígitos
    Cuando el paciente ingresa el OTP correcto
    Entonces el MFA queda activado
    Y en el próximo login, tras el magic link, se le pide el OTP de SMS
    Y se registra AuditLog action="PORTAL_MFA_ENABLED"

  Escenario: OTP incorrecto en login con MFA activo
    Dado que el paciente tiene MFA por SMS habilitado
    Cuando ingresa un OTP incorrecto 3 veces consecutivas
    Entonces el sistema bloquea el intento por 10 minutos
    Y muestra "Demasiados intentos fallidos. Intenta de nuevo en 10 minutos."
    Y registra AuditLog action="PORTAL_MFA_FAILED" con intentos y ip

  Escenario: Paciente sin MFA activo (flujo normal)
    Dado que el paciente tiene una cuenta activa sin MFA habilitado
    Cuando hace clic en el magic link del email
    Entonces accede directamente al portal sin paso adicional de MFA
```

- **MoSCoW:** Should
- **Story Points:** 5
- **Dependencias:** US.B20.1.2, disponibilidad de SMS gateway (ver §5 trade-off 3)
- **Riesgos:** Costo del SMS gateway. En Beta.20a puede diferirse solo el SMS; TOTP (app autenticadora) tiene costo cero.

---

#### US.B20.1.4 — Acceso del tutor legal para menores de edad (LEPINA)

**Como** padre, madre o tutor legal de un menor de 18 años paciente en el establecimiento,
**quiero** vincular mi cuenta del portal con el expediente de mi hijo/a o representado/a,
**para** gestionar sus citas, ver sus resultados y otorgar consentimientos en su nombre, cumpliendo con la LEPINA.

**Criterios de aceptación (Gherkin es-SV):**

```gherkin
Característica: Acceso del tutor legal (LEPINA)

  Escenario: Tutor registra vínculo con menor
    Dado que el tutor tiene cuenta activa en el portal
    Y el establecimiento ha verificado el vínculo (DUI del tutor + partida de nacimiento / DUI del menor si aplica)
    Y el sistema tiene registrado el vínculo en GuardianRelationship
    Cuando el tutor accede a /portal/dashboard
    Entonces ve un selector de perfil: "Tu perfil" y "Perfil de [nombre del menor]"
    Y al seleccionar el perfil del menor, el JWT incluye { patient_id: <menor_id>, as_guardian: true }

  Escenario: Menor entre 14-17 años accede a su propio expediente
    Dado que el paciente tiene entre 14 y 17 años y tiene cuenta propia en el portal
    Cuando inicia sesión con su email
    Entonces puede ver sus propios datos clínicos (excluyendo categorías protegidas si el médico las ocultó)
    Y NO puede ver el registro de accesos de su tutor
    Y el médico puede marcar ciertos registros como "solo tutor" en el sistema interno

  Escenario: Tutor intenta acceder al expediente de un mayor de 18 años
    Dado que hay un vínculo activo entre tutor y un paciente
    Y ese paciente ya cumplió 18 años
    Cuando el tutor intenta acceder al perfil de ese paciente
    Entonces el sistema deniega el acceso con mensaje "Este paciente ya es mayor de edad. El acceso requiere su autorización directa."
    Y registra AuditLog action="PORTAL_GUARDIAN_ACCESS_DENIED" con motivo="patient_of_age"
```

- **MoSCoW:** Must (regulatorio LEPINA)
- **Story Points:** 8
- **Dependencias:** Tabla `GuardianRelationship` (guardian_patient_id, minor_patient_id, verified_at, verified_by_staff_id, expires_at) — nueva, diseño @DBA. US.B20.1.1.
- **Riesgos:** La verificación del vínculo legal es un proceso mixto digital/presencial. En Beta.20a el vínculo lo registra el personal del establecimiento; el tutor solo consume lo que ya fue verificado en persona.

---

### Épica E.B20.2 — Consulta de HCE (Historia Clínica Electrónica)

**Goal:** Permitir al paciente acceder en modo lectura a los componentes principales de su historia clínica: citas, resultados de laboratorio, historia clínica resumen, vacunación, recetas activas. Cada acceso queda auditado.

**WSJF:** Costo de retraso = ALTO (es el valor central del portal). Tamaño = ALTO. **WSJF ≈ 8.**

---

#### US.B20.2.1 — Ver y cancelar citas programadas

**Como** paciente con citas agendadas en el establecimiento,
**quiero** ver mis próximas citas y cancelar aquellas que ya no pueda atender,
**para** liberar el espacio en la agenda y evitar el cobro de no-show.

**Criterios de aceptación (Gherkin es-SV):**

```gherkin
Característica: Gestión de citas en el portal del paciente

  Escenario: Visualización de citas próximas
    Dado que el paciente está autenticado en el portal
    Cuando accede a /portal/citas
    Entonces ve la lista de sus citas futuras ordenadas por fecha ascendente
    Y cada cita muestra: fecha, hora, especialidad, nombre del médico, establecimiento, estado
    Y ve citas de hasta 90 días en el futuro
    Y AuditLog registra action="PORTAL_PATIENT_READ" con field="appointments"

  Escenario: Cancelación de cita con antelación suficiente
    Dado que el paciente tiene una cita a más de 24 horas de distancia
    Cuando selecciona la cita y hace clic en "Cancelar cita"
    Entonces el sistema muestra un diálogo de confirmación con la información de la cita
    Y solicita un motivo de cancelación (selección de lista: "No puedo asistir", "Cambié de médico", "Mejoré", "Otro")
    Cuando el paciente confirma la cancelación
    Entonces el estado de la cita cambia a "Cancelada por paciente"
    Y el sistema envía notificación al establecimiento
    Y el paciente recibe confirmación por email
    Y AuditLog registra action="PORTAL_APPOINTMENT_CANCELLED" con appointmentId y motivo

  Escenario: Cita no cancelable por proximidad de tiempo
    Dado que el paciente tiene una cita dentro de las próximas 24 horas
    Cuando accede a esa cita en el portal
    Entonces el botón "Cancelar" no está disponible
    Y se muestra el mensaje "Para cancelar una cita con menos de 24 horas de anticipación, comunícate con el establecimiento: [número]"
```

- **MoSCoW:** Must
- **Story Points:** 8
- **Dependencias:** Router de agenda (Appointment) existente. Nuevo endpoint `portal.appointments.listMyCancelable` con `withPatientContext`. Política de cancelación configurable por tenant (24h, 48h, etc.).
- **Riesgos:** La política de cancelación varía por establecimiento. En Beta.20a, hardcodear 24h con configuración a futuro.

---

#### US.B20.2.2 — Ver resultados de laboratorio

**Como** paciente,
**quiero** ver los resultados de mis exámenes de laboratorio directamente en el portal,
**para** no tener que ir al establecimiento o esperar una llamada para saber mis resultados.

**Criterios de aceptación (Gherkin es-SV):**

```gherkin
Característica: Resultados de laboratorio en el portal

  Escenario: Listado de resultados disponibles
    Dado que el paciente está autenticado en el portal
    Cuando accede a /portal/resultados
    Entonces ve sus resultados de laboratorio ordenados por fecha descendente
    Y cada resultado muestra: fecha, nombre del examen, estado (Pendiente/Disponible/Validado)
    Y solo ve resultados con estado "Validado" (firmados por el laboratorista)
    Y resultados "Pendiente" aparecen con etiqueta de estado pero sin valores
    Y AuditLog registra action="PORTAL_PATIENT_READ" con field="lab_results"

  Escenario: Ver detalle de resultado validado
    Dado que existe un resultado de laboratorio en estado "Validado"
    Cuando el paciente hace clic en ese resultado
    Entonces ve los valores de cada analito con su rango de referencia por edad/sexo
    Y los valores fuera de rango aparecen resaltados (color warning o critical según flag)
    Y se muestra el nombre del laboratorista validador y la fecha de validación
    Y se muestra una nota: "Estos resultados son informativos. Consulta con tu médico para su interpretación."

  Escenario: Resultado con datos sensibles protegidos
    Dado que un resultado tiene flag "confidencial" (p. ej. VIH, drogas)
    Cuando el paciente accede a /portal/resultados
    Entonces ese resultado NO aparece en el listado del portal
    Y el médico tratante en el HIS interno mantiene visibilidad normal
```

- **MoSCoW:** Must (explícito en TDR §17.6)
- **Story Points:** 8
- **Dependencias:** Router LIS existente (`lis.router.ts`). Nuevo endpoint `portal.labResults.listMine`. Campo `confidential` en `LabResult` (o flag en `LabOrder`) — verificar con @DBA.
- **Riesgos:** El campo "confidencial" puede no existir aún en el schema. Decisión en §5 trade-off 2.

---

#### US.B20.2.3 — Ver historia clínica resumen

**Como** paciente,
**quiero** ver un resumen de mi historia clínica (alergias activas, medicación crónica, problemas activos, últimas consultas),
**para** tener contexto de mi estado de salud y compartirlo con otros médicos si lo necesito.

**Criterios de aceptación (Gherkin es-SV):**

```gherkin
Característica: Historia clínica resumen en el portal

  Escenario: Vista resumen del expediente
    Dado que el paciente está autenticado en el portal
    Cuando accede a /portal/historia
    Entonces ve las siguientes secciones:
      - Alergias activas (tipo, severidad, manifestación)
      - Medicación crónica activa (nombre genérico, dosis, frecuencia)
      - Problemas activos (diagnósticos CIE-10 activos)
      - Últimas 5 consultas (fecha, motivo, establecimiento)
    Y cada sección tiene la fecha de última actualización
    Y AuditLog registra action="PORTAL_PATIENT_READ" con field="health_summary"

  Escenario: Secciones vacías
    Dado que el paciente no tiene alergias registradas en el sistema
    Cuando accede a /portal/historia
    Entonces la sección "Alergias" muestra "Sin alergias registradas en este establecimiento"
    Y NO muestra ningún dato de otros establecimientos sin consentimiento explícito

  Escenario: Solicitud de corrección de datos incorrectos
    Dado que el paciente detecta un dato incorrecto en su historia clínica
    Cuando hace clic en "Reportar dato incorrecto"
    Entonces puede enviar una solicitud de corrección con descripción del error
    Y el sistema crea un ticket interno con prioridad media
    Y el paciente recibe confirmación de que la solicitud fue recibida
    Y AuditLog registra action="PORTAL_CORRECTION_REQUESTED" con detalle
```

- **MoSCoW:** Must
- **Story Points:** 8
- **Dependencias:** Routers MPI, HCE existentes. Nuevo endpoint agregador `portal.healthSummary.getMine`. El agregador consulta varias tablas en una sola respuesta para minimizar RTTs.
- **Riesgos:** La agregación de datos sensibles en un solo endpoint requiere revisión de seguridad cuidadosa — @AS debe aprobar el shape.

---

#### US.B20.2.4 — Ver esquema de vacunación (PAI)

**Como** paciente (o tutor del menor),
**quiero** ver el esquema de vacunación registrado en el establecimiento,
**para** saber qué vacunas tengo (o tiene mi hijo/a) y cuáles están pendientes según el PAI El Salvador.

**Criterios de aceptación (Gherkin es-SV):**

```gherkin
Característica: Esquema de vacunación en el portal

  Escenario: Ver vacunas aplicadas
    Dado que el paciente está autenticado en el portal
    Cuando accede a /portal/vacunacion
    Entonces ve la lista de vacunas aplicadas con: nombre de la vacuna, lote, fecha de aplicación, establecimiento
    Y las vacunas del esquema PAI El Salvador que NO ha recibido aparecen como "Pendiente" según su edad
    Y AuditLog registra action="PORTAL_PATIENT_READ" con field="vaccination"

  Escenario: Vacunas del PAI pendientes para menor
    Dado que el tutor accede al perfil de su hijo de 2 años
    Cuando visita /portal/vacunacion (del menor)
    Entonces ve las vacunas aplicadas y las pendientes según el calendario PAI SV para esa edad
    Y se muestra una nota: "Consulta con tu pediatra para programar las vacunas pendientes"

  Escenario: Sin registros de vacunación
    Dado que el paciente no tiene vacunas registradas en este establecimiento
    Cuando accede a /portal/vacunacion
    Entonces se muestra "No tienes vacunas registradas en este establecimiento. Si las recibiste en otro lugar, consulta con tu médico para registrarlas."
```

- **MoSCoW:** Should (TDR §14.5)
- **Story Points:** 5
- **Dependencias:** Tabla `VaccinationRecord` y catálogo PAI SV existentes. Nuevo endpoint `portal.vaccination.listMine`.
- **Riesgos:** Bajo. El catálogo PAI SV ya existe en la BD.

---

#### US.B20.2.5 — Ver recetas activas y descargar PDF

**Como** paciente,
**quiero** ver mis recetas médicas activas y descargar una copia en PDF,
**para** poder surtirlas en una farmacia externa o tener registro de mis medicamentos.

**Criterios de aceptación (Gherkin es-SV):**

```gherkin
Característica: Recetas activas en el portal

  Escenario: Listado de recetas activas
    Dado que el paciente está autenticado en el portal
    Cuando accede a /portal/recetas
    Entonces ve sus prescripciones activas (status="ACTIVE" o "DISPENSED_PARTIAL")
    Y cada receta muestra: fecha, médico, medicamentos (nombre genérico, dosis, frecuencia, días), vigencia
    Y AuditLog registra action="PORTAL_PATIENT_READ" con field="prescriptions"

  Escenario: Descarga de PDF de receta con marca de agua
    Dado que el paciente selecciona una receta activa
    Cuando hace clic en "Descargar PDF"
    Entonces el sistema genera un PDF firmado digitalmente
    Y el PDF incluye marca de agua con nombre del paciente + fecha de descarga + últimos 3 dígitos del DUI
    Y el PDF incluye código QR de verificación de autenticidad
    Y AuditLog registra action="PORTAL_DOCUMENT_DOWNLOADED" con documentType="prescription" y prescriptionId

  Escenario: Receta vencida no descargable
    Dado que existe una receta con vigencia expirada
    Cuando el paciente intenta descargarla
    Entonces el sistema permite la descarga pero muestra aviso: "Esta receta está vencida. Solo es válida para tus registros personales."
```

- **MoSCoW:** Should
- **Story Points:** 8
- **Dependencias:** Router farmacia existente. Generación de PDF (react-pdf o librería similar — decisión en §5 trade-off 4). Signed URLs de Supabase Storage para los archivos generados.
- **Riesgos:** La generación de PDFs con marca de agua requiere una librería de PDF que @AS debe validar (out-of-scope de Beta.20 si bloquea; diferir a Beta.20b).

---

### Épica E.B20.3 — Consentimientos y Privacidad

**Goal:** Permitir al paciente otorgar, ver y revocar consentimientos de privacidad para el uso de sus datos y el acceso a su HCE entre organizaciones del grupo, en cumplimiento del TDR §6.4 y D.39/2024.

**WSJF:** Costo de retraso = ALTO (regulatorio). Tamaño = MEDIO. **WSJF ≈ 7.**

---

#### US.B20.3.1 — Ver y otorgar consentimientos de privacidad

**Como** paciente registrado en el portal,
**quiero** ver qué consentimientos he otorgado y poder otorgar nuevos (incluyendo el de compartición de mi HCE entre establecimientos del grupo),
**para** tener control sobre quién puede ver mi expediente y bajo qué condiciones.

**Criterios de aceptación (Gherkin es-SV):**

```gherkin
Característica: Gestión de consentimientos en el portal

  Escenario: Listado de consentimientos activos
    Dado que el paciente está autenticado en el portal
    Cuando accede a /portal/consentimientos
    Entonces ve la lista de consentimientos otorgados con: tipo, fecha de otorgamiento, vigencia, estado (Activo/Revocado)
    Y ve los consentimientos pendientes de su aprobación (si los hay)
    Y AuditLog registra action="PORTAL_PATIENT_READ" con field="consents"

  Escenario: Otorgar consentimiento de compartición multi-organización
    Dado que el paciente quiere que su expediente sea accesible en todos los establecimientos del grupo
    Cuando selecciona "Autorizar acceso compartido entre establecimientos Avante"
    Y lee el texto completo del consentimiento (obligatorio: el botón de aceptar aparece solo después de hacer scroll)
    Y hace clic en "Acepto"
    Entonces se crea un registro en PatientConsent con channel="PORTAL", grantedAt=now(), scope="MULTI_ORG"
    Y el médico de cualquier establecimiento del grupo puede ver el expediente con indicador "Consentimiento compartido activo"
    Y AuditLog registra action="PORTAL_CONSENT_GRANTED" con consentId y scope

  Escenario: Consentimiento sin leer el texto completo
    Dado que el paciente no ha hecho scroll hasta el final del texto del consentimiento
    Cuando intenta hacer clic en "Acepto"
    Entonces el botón está deshabilitado
    Y aparece la indicación "Desplázate hasta el final para aceptar"
```

- **MoSCoW:** Must (TDR §6.4, D.39/2024 Art. 13)
- **Story Points:** 8
- **Dependencias:** Tabla `PatientConsent` existente en schema.prisma. Nuevo endpoint `portal.consents.listMine` + `portal.consents.grant`. Campo `channel` en `PatientConsent` — verificar con @DBA si ya existe o necesita migration.
- **Riesgos:** El texto legal del consentimiento debe ser aprobado por el área legal de Avante antes de este sprint.

---

#### US.B20.3.2 — Revocar consentimiento

**Como** paciente,
**quiero** poder revocar un consentimiento otorgado previamente,
**para** ejercer mi derecho de retirar el permiso de uso o compartición de mis datos en cualquier momento (D.39/2024 Art. 14-15).

**Criterios de aceptación (Gherkin es-SV):**

```gherkin
Característica: Revocación de consentimiento en el portal

  Escenario: Revocación exitosa
    Dado que el paciente tiene un consentimiento activo de tipo "MULTI_ORG"
    Cuando selecciona ese consentimiento y hace clic en "Revocar"
    Y confirma la acción en el diálogo de confirmación que explica las implicaciones
    Entonces el estado del consentimiento cambia a "Revocado" y se registra revokedAt=now()
    Y el sistema cierra el acceso multi-org para ese paciente de forma inmediata (dentro del siguiente ciclo de caché, máximo 5 minutos)
    Y el paciente recibe confirmación por email de la revocación
    Y AuditLog registra action="PORTAL_CONSENT_REVOKED" con consentId y revokedBy="patient"

  Escenario: Revocación con implicaciones clínicas activas
    Dado que el paciente tiene un ingreso hospitalario activo en otro establecimiento del grupo
    Cuando intenta revocar el consentimiento multi-org
    Entonces el sistema muestra una advertencia: "Tienes una atención activa en [nombre establecimiento]. Revocar el acceso puede afectar tu atención. ¿Deseas continuar?"
    Y el paciente puede confirmar de todos modos (es su derecho legal)
    Y si confirma, el sistema revoca y notifica al médico tratante del otro establecimiento

  Escenario: Ver historial de accesos (quién vio mi expediente)
    Dado que el paciente quiere saber quién ha accedido a su expediente
    Cuando accede a /portal/consentimientos y selecciona "Ver historial de accesos"
    Entonces ve una lista de los últimos 30 accesos a su expediente con: fecha, nombre del médico (enmascarado: "Dr. M.R."), especialidad, establecimiento
    Y AuditLog registra action="PORTAL_PATIENT_READ" con field="access_log"
```

- **MoSCoW:** Must (D.39/2024 Art. 14-15)
- **Story Points:** 5
- **Dependencias:** US.B20.3.1. Router de revocación `portal.consents.revoke`. Mecanismo de invalidación de caché de permisos (máximo 5 min de propagación).
- **Riesgos:** La propagación inmediata de la revocación requiere que los routers internos consulten `PatientConsent` en tiempo real o tengan TTL de caché corto. Decisión técnica @AS.

---

#### US.B20.3.3 — Solicitud de derecho de acceso y supresión (D.39/2024)

**Como** paciente,
**quiero** poder solicitar a través del portal una copia completa de mis datos personales o solicitar la supresión de los datos que no sean necesarios para mi atención clínica,
**para** ejercer mis derechos reconocidos en la Ley de Protección de Datos Personales SV.

**Criterios de aceptación (Gherkin es-SV):**

```gherkin
Característica: Derechos ARCO (Acceso, Rectificación, Cancelación, Oposición) en el portal

  Escenario: Solicitud de exportación de datos personales
    Dado que el paciente está en /portal/consentimientos/derechos
    Cuando selecciona "Solicitar copia de mis datos" y confirma su identidad (re-autenticación por magic link)
    Entonces el sistema crea un ticket interno con prioridad alta
    Y genera un job para preparar el paquete de exportación (máximo 30 días por ley)
    Y el paciente recibe confirmación: "Tu solicitud fue registrada. Recibirás los datos en máximo 30 días hábiles al email registrado."
    Y AuditLog registra action="PORTAL_DATA_EXPORT_REQUESTED"

  Escenario: Solicitud de supresión de datos no clínicos
    Dado que el paciente solicita suprimir sus datos de contacto (email personal, teléfono)
    Cuando envía la solicitud con justificación
    Entonces el DPO recibe la solicitud para evaluación
    Y el sistema responde al paciente: "Tu solicitud será evaluada. Los datos necesarios para tu atención médica no pueden suprimirse por razones legales (conservación 10 años)."
    Y AuditLog registra action="PORTAL_DATA_DELETION_REQUESTED"

  Escenario: Solicitud no procesable automáticamente
    Dado que el paciente solicita suprimir datos de diagnóstico clínico
    Cuando envía la solicitud
    Entonces el sistema informa: "Los registros clínicos deben conservarse por un mínimo de 10 años según la normativa MINSAL. Tu solicitud fue registrada y el DPO te contactará."
    Y el paciente puede apelar la decisión
```

- **MoSCoW:** Should (D.39/2024 — requerimiento legal pero flujo manual en Beta.20)
- **Story Points:** 5
- **Dependencias:** Proceso DPO de Avante (flujo humano — el sistema solo crea el ticket). US.B20.3.1.
- **Riesgos:** La gestión del proceso ARCO en el sistema actual es manual. El portal solo es el canal de entrada.

---

### Épica E.B20.4 — Comunicación y Soporte

**Goal:** Proveer al paciente un canal de comunicación asíncrono con el establecimiento, reutilizando el motor de notificaciones de Beta.15 y extendiendo el canal a tipo "PATIENT".

**WSJF:** Costo de retraso = MEDIO. Tamaño = BAJO. **WSJF ≈ 5.**

---

#### US.B20.4.1 — Inbox del paciente (notificaciones del establecimiento)

**Como** paciente registrado en el portal,
**quiero** recibir y leer mensajes del establecimiento directamente en mi portal (recordatorios de citas, resultados disponibles, comunicados),
**para** centralizar las comunicaciones relevantes de mi salud en un solo lugar.

**Criterios de aceptación (Gherkin es-SV):**

```gherkin
Característica: Inbox del paciente en el portal

  Escenario: Ver notificaciones del establecimiento
    Dado que el establecimiento envió una notificación al paciente ("Tu resultado de laboratorio ya está disponible")
    Cuando el paciente accede a /portal/comunicaciones
    Entonces ve la notificación en su inbox con: asunto, fecha, remitente (nombre del establecimiento), estado (No leída/Leída)
    Y AuditLog registra action="PORTAL_PATIENT_READ" con field="inbox"

  Escenario: Marcar notificación como leída
    Dado que el paciente tiene una notificación "No leída"
    Cuando la abre o hace clic en "Marcar como leída"
    Entonces el estado cambia a "Leída" y la fecha de lectura queda registrada
    Y el contador de no leídas en el navbar del portal disminuye en 1

  Escenario: Notificación con enlace interno al recurso
    Dado que el establecimiento envía "Tu resultado de laboratorio ya está disponible"
    Cuando el paciente abre la notificación
    Entonces ve un botón "Ver resultado" que lo lleva directamente a /portal/resultados/[resultadoId]
    Y el sistema verifica antes de renderizar que el paciente tiene acceso a ese resultado (no solo al link)
```

- **MoSCoW:** Should
- **Story Points:** 5
- **Dependencias:** Motor de notificaciones Beta.15 (completado). Nuevo canal `PATIENT_PORTAL` en enum `NotificationChannel`. Nuevo `recipientType` o tabla separada para pacientes (ya que los pacientes no son `User` del HIS interno) — decisión @DBA en §5 trade-off 5.
- **Riesgos:** El motor de notificaciones Beta.15 está diseñado para usuarios internos (`User`). Extenderlo para pacientes externos (`PortalAccount`) requiere una decisión arquitectónica sobre el modelo de destinatario.

---

#### US.B20.4.2 — Contacto con el establecimiento (mensaje de soporte)

**Como** paciente,
**quiero** poder enviar un mensaje de texto libre al establecimiento desde el portal,
**para** resolver dudas sobre mis citas, resultados o trámites sin tener que llamar por teléfono.

**Criterios de aceptación (Gherkin es-SV):**

```gherkin
Característica: Mensajería paciente → establecimiento

  Escenario: Envío de mensaje al establecimiento
    Dado que el paciente está en /portal/comunicaciones/nuevo-mensaje
    Cuando selecciona el establecimiento destinatario, ingresa un asunto y el cuerpo del mensaje (máx 500 caracteres)
    Y hace clic en "Enviar"
    Entonces el mensaje queda registrado en la BD con status="ENVIADO"
    Y el personal del establecimiento recibe una notificación interna en el HIS
    Y el paciente ve el mensaje en su historial como "Enviado, pendiente de respuesta"
    Y AuditLog registra action="PORTAL_MESSAGE_SENT" con messageId

  Escenario: Respuesta del establecimiento al paciente
    Dado que el personal del establecimiento respondió el mensaje del paciente desde el HIS interno
    Cuando el paciente accede a /portal/comunicaciones
    Entonces ve la respuesta como un hilo de conversación bajo su mensaje original
    Y recibe una notificación en su inbox de portal con "Tienes una respuesta del establecimiento"

  Escenario: Mensaje con contenido inapropiado o urgencia médica
    Dado que el paciente envía un mensaje indicando urgencia médica ("me duele mucho el pecho")
    Entonces el sistema muestra un aviso: "Si tienes una emergencia médica, llama al 911 o dirígete a emergencias. Este canal no es para urgencias."
    Y el mensaje se envía de todos modos con tag "posible_urgencia" para el personal
```

- **MoSCoW:** Could
- **Story Points:** 5
- **Dependencias:** US.B20.4.1. Nueva tabla `PatientMessage` (patient_id, org_id, subject, body, status, threadId) — diseño @DBA. Vista interna en HIS para responder mensajes del portal.
- **Riesgos:** El módulo de respuesta interno requiere un componente UI en el HIS admin que @UIUX debe diseñar. Si el scope de Beta.20 no lo incluye, el personal responde solo por email (MVP mínimo).

---

#### US.B20.4.3 — Configurar preferencias de comunicación del portal

**Como** paciente,
**quiero** controlar qué tipos de notificaciones recibo del establecimiento y por qué canales (email, portal inbox),
**para** no recibir comunicaciones no deseadas y decidir cuándo quiero notificaciones de recordatorio.

**Criterios de aceptación (Gherkin es-SV):**

```gherkin
Característica: Preferencias de notificación del paciente

  Escenario: Configurar canal de notificaciones
    Dado que el paciente está en /portal/perfil/notificaciones
    Cuando desactiva "Recordatorios de citas por email"
    Entonces el sistema actualiza PatientNotificationPreference con { type: "REMINDER", channel: "EMAIL", enabled: false }
    Y en el próximo recordatorio de cita, no se envía email (solo aparece en inbox del portal)

  Escenario: Tipo de notificación crítica no desactivable
    Dado que el paciente intenta desactivar "Resultados críticos de laboratorio"
    Cuando hace toggle off
    Entonces el toggle vuelve a activo automáticamente
    Y se muestra: "Los resultados con valores críticos siempre se notifican por tu seguridad"

  Escenario: Desuscripción total de email (excepto críticos)
    Dado que el paciente selecciona "No recibir ningún email del portal"
    Cuando guarda la preferencia
    Entonces todas las notificaciones de tipo INFO y REMINDER se deshabilitan por email
    Y las notificaciones CRITICAL siguen activas
    Y el paciente ve un resumen: "Solo recibirás emails para resultados críticos"
```

- **MoSCoW:** Could
- **Story Points:** 3
- **Dependencias:** US.B20.4.1. Tabla `PatientNotificationPreference` — similar a `UserNotificationPreference` pero para pacientes.
- **Riesgos:** Bajo. Reutiliza el patrón de preferencias de Beta.15.

---

## 5. Trade-offs y Decisiones Pendientes para Stakeholder

### 5.1 Verificación de identidad documental en el onboarding

**Problema:** ¿Cómo verificamos que quien se registra en el portal es realmente el paciente del expediente? La LEPINA y D.39/2024 requieren que el acceso a datos de salud sea del titular.

**Opciones:**

| Opción | Costo | Riesgo | Velocidad de implementación |
|---|---|---|---|
| A — El establecimiento pre-carga el email del paciente y le envía la invitación (proceso presencial/telefónico) | Bajo | Medio (depende de que el staff haga bien su trabajo) | Alto — Beta.20a |
| B — Verificación automática por DUI: el paciente ingresa DUI + fecha de nacimiento y el sistema verifica contra el MPI | Cero extra de API | Medio (no verifica que el DUI es tuyo, solo que coincide con el expediente) | Medio — Beta.20b |
| C — Verificación por videollamada o biometría externa (servicio RENAP/RNPN) | Alto (costo API + latencia) | Bajo | Bajo — Beta.20c o posterior |

**Recomendación @PO:** Opción A para Beta.20a (MVP funcional, verificación presencial). Opción B para Beta.20b. Opción C diferida a decisión del Steering Committee.

**Decisión requerida de Edwin / @AE:** ¿Aceptamos Opción A para arrancar? ¿Cuál es el riesgo reputacional de un registro sin verificación fuerte?

---

### 5.2 Resultados de laboratorio con flag "confidencial"

**Problema:** El TDR §17.6 dice que los resultados van al portal. Pero resultados de VIH, ITS, drogas, salud mental tienen protección especial. ¿Hay un campo `confidential` en `LabResult` o en `LabOrder`?

**Decisión requerida de @DBA + @AE:** ¿Existe este campo? Si no, ¿se agrega en Beta.20 o se asume que TODOS los resultados son visibles y se educa al staff para no ordenar exámenes confidenciales con el portal habilitado?

**Recomendación @PO:** Agregar `showInPortal boolean DEFAULT true` en `LabResult` + `LabOrder`. El médico o laboratorista puede marcarlo como `false` antes de validar.

---

### 5.3 SMS gateway para MFA del paciente

**Problema:** El MFA por SMS del paciente requiere un SMS gateway (Twilio, AWS SNS, etc.) con costo variable. Para pacientes salvadoreños, el volumen esperado es bajo al inicio.

**Opciones:**

| Opción | Costo estimado (100 pacientes/mes) | Complejidad |
|---|---|---|
| Solo TOTP (app autenticadora) | $0 | Baja |
| SMS via Twilio | ~$5/mes | Media |
| Sin MFA en Beta.20 (solo magic link) | $0 | Mínima |

**Recomendación @PO:** Solo TOTP para Beta.20a. SMS en Beta.20b si hay demanda o regulación lo exige. El magic link con TTL corto (1h) ya es un factor de posesión razonable.

**Decisión requerida de Edwin:** ¿OK diferir SMS a Beta.20b?

---

### 5.4 Generación de PDFs con marca de agua

**Problema:** Las recetas y reportes descargables requieren marca de agua y potencialmente firma digital. Las librerías de PDF en Node.js tienen curvas de aprendizaje y licencias distintas.

**Opciones:**

| Opción | Licencia | Calidad PDF | Effort |
|---|---|---|---|
| `@react-pdf/renderer` | MIT | Buena, CSS-like | Bajo — ya evaluada para Beta.15 emails |
| `puppeteer` (headless Chrome) | Apache 2.0 | Perfecta (HTML → PDF) | Medio — requiere Chrome en servidor |
| `pdfkit` | MIT | Básica, programática | Bajo pero verbose |

**Recomendación @PO:** `@react-pdf/renderer` como primera opción (consistente con stack React, ya familiar al equipo). Si la calidad no es suficiente para reportes de imagen, `puppeteer` en Beta.20b.

**Decisión requerida de @AS + @Dev:** ¿Tenemos restricciones de memoria en Vercel que hagan `puppeteer` inviable?

---

### 5.5 Extensión del motor de notificaciones Beta.15 para pacientes externos

**Problema:** El motor de notificaciones Beta.15 fue diseñado para `User` (empleados internos). Los pacientes del portal son `PortalAccount`, no `User`. ¿Cómo los incluimos como destinatarios de notificaciones?

**Opciones:**

| Opción | Pros | Contras |
|---|---|---|
| A — Agregar `recipientPortalAccountId` nullable en `Notification` | Mínimo cambio de schema | Rompe el tipo monomorfo de recipient |
| B — Polimorfismo: tabla `NotificationRecipient` con discriminated union | Extensible (futuro: WhatsApp, SMS) | Migration y refactor de Beta.15 |
| C — Tabla `PatientNotification` completamente separada | Sin acoplamiento | Duplica lógica de despacho |

**Recomendación @PO:** Opción A para Beta.20a (cambio mínimo, funcional). Opción B en Beta.21+ cuando se agreguen más tipos de destinatarios.

**Decisión requerida de @AS + @DBA:** ¿Acepta Opción A con deuda técnica documentada?

---

## 6. Roadmap de Releases del Portal

### Beta.20a — Auth + HCE Básica (sprint 1-2, ~4 semanas)

**Épica cubierta:** E.B20.1 completa (US.B20.1.1, US.B20.1.2, US.B20.1.4) + E.B20.2 parcial (US.B20.2.1, US.B20.2.2).

**Objetivo:** El paciente puede activar su cuenta, iniciar sesión con magic link, ver sus próximas citas y cancelarlas, y ver sus resultados de laboratorio validados.

**Precondición:** Decisión §5.1 Opción A (establecimiento pre-carga el email). Tabla `PortalAccount` creada (@DBA).

**Story points:** 8+3+8+8+8 = **35 SP**

**Gate de salida:** @QA valida que el paciente A no puede ver datos del paciente B. axe-core sin críticos. Login passwordless funcional en staging.

---

### Beta.20b — Consentimientos + Comunicación (sprint 3-4, ~4 semanas)

**Épica cubierta:** E.B20.3 completa + E.B20.4.1 + E.B20.4.2 + E.B20.1.3 (MFA TOTP) + E.B20.2.3 (HCE resumen) + E.B20.2.4 (Vacunación).

**Objetivo:** El paciente puede gestionar sus consentimientos (otorgar, revocar, ver historial de accesos), enviar mensajes al establecimiento, y ver su historia clínica completa.

**Story points:** 8+5+5+5+8+5 = **36 SP**

**Gate de salida:** Texto legal de consentimientos aprobado por área legal de Avante. @QAF valida BDD de todos los flujos de consentimiento.

---

### Beta.20c — Optimización y Cierre (sprint 5, ~2 semanas)

**Épica cubierta:** E.B20.2.5 (recetas + PDF) + E.B20.4.3 (preferencias) + E.B20.1.3 MFA SMS (si se aprueba) + hardening de performance + a11y completo.

**Objetivo:** Portal completo, optimizado, con NPS >= 4/5 en piloto, listo para declarar Beta.20 completado y habilitar G8.

**Story points:** 8+3+5 = **16 SP** + buffer de 10 SP para defectos y hardening

**Gate de salida (G8 pre-requisito):** 60 días en producción con SLOs cumplidos, adopción >= 30%, 0 incidentes de privacidad, @QA firma el DoD.

---

## 7. Métricas de Éxito Post-Release

| Métrica | Baseline | Objetivo Beta.20a | Objetivo Beta.20c |
|---|---|---|---|
| **Registros activos en portal** (% pacientes activos) | 0% | >= 15% al mes 1 | >= 30% al mes 2 |
| **Tasa de cancelación de citas vía portal** | 0% | >= 10% de cancelaciones totales | >= 25% |
| **Tickets "consultar resultado de lab"** | Baseline (30 días pre-launch) | Reducción >= 20% | Reducción >= 40% |
| **NPS paciente del portal** | N/A | Medición inicial | >= 4.0 / 5.0 |
| **Incidentes de privacidad (acceso cruzado)** | 0 | 0 (obligatorio) | 0 (obligatorio) |
| **axe-core críticos / serios en portal** | N/A | 0 (gate pre-release) | 0 (mantenido) |
| **Consentimientos multi-org activos** | 0 | >= 5 en piloto | >= 50% de pacientes piloto |
| **Tiempo medio de login** (magic link → dashboard) | N/A | < 3 minutos (incluyendo apertura de email) | < 2 minutos |

---

## 8. Dependencias Upstream / Fuera de Alcance

### Bloqueantes (deben resolverse antes de Beta.20a)

- **Tabla `PortalAccount`** (nueva) — diseño y migration @DBA.
- **Decisión §5.1** (verificación de identidad) — Edwin / @AE.
- **Texto legal de consentimientos** — área legal de Avante (para Beta.20b).
- **Tabla `GuardianRelationship`** (nueva) — diseño @DBA.

### Dependencias que bloquean a otras waves

- Beta.20c completo bloquea el cierre formal G8.
- El canal `PATIENT_PORTAL` en notificaciones (Beta.20a) habilita futuros: Beta.21 WhatsApp para pacientes, Beta.22 app móvil nativa.

### Fuera de alcance explícito de Beta.20

- Telemedicina con video.
- App móvil nativa (iOS/Android).
- Edición directa de datos clínicos por el paciente.
- Portal en nawat (idioma local indígena SV — TDR §28 opcional).
- Integración con wearables del paciente.
- FHIR API pública para el paciente (es para B2B, no B2C).
- Biometría / verificación RNPN (diferido a Beta.20c o posterior).

---

## 9. Resumen de Capacidad

| Épica | Stories | Story Points | Ola |
|---|---|---|---|
| E.B20.1 — Auth y Onboarding | 4 | 24 | Beta.20a/b |
| E.B20.2 — HCE Consulta | 5 | 37 | Beta.20a/b/c |
| E.B20.3 — Consentimientos y Privacidad | 3 | 18 | Beta.20b |
| E.B20.4 — Comunicación y Soporte | 3 | 13 | Beta.20b/c |
| **TOTAL Beta.20** | **15** | **92 SP** | 3 olas |

Con velocidad histórica del equipo (~20-25 SP/sprint), **Beta.20 estimado en 4-5 sprints** (~8-10 semanas), incluyendo buffer de defectos y hardening.

---

**Fin del backlog Beta.20.**
