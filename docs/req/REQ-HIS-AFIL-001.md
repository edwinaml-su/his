# REQ-HIS-AFIL-001 — Modelo de Médico Afiliado y Agenda de Clínicas Externas

| Campo | Valor |
|---|---|
| Documento | REQ-HIS-AFIL-001 |
| Versión | 1.0 |
| Fecha | 2026-09-15 |
| Autor | TTD — Inversiones Avante, S.A. de C.V. |
| Sistema | HIS Avante Multipaís |
| Control de cambio | CC-00XX (asignar el siguiente correlativo libre; el mayor observado en el esquema es CC-0028) |
| Épicas | E1 — Modelo de Médico Afiliado · E2 — Agenda de Clínicas Externas |
| Destinatario | Claude Code (implementación) |
| Estado | Aprobado para construcción |

---

## 1. Contexto y problema

El HIS cubre hoy la producción clínica y la cuenta del paciente, pero **no modela el modelo de negocio de Avante**. Avante opera como hospital de staff abierto: la institución aporta infraestructura y continuidad 24/7, y el acto médico especializado lo aporta un cuerpo médico afiliado que no está en planilla. De ahí tres flujos de valor que el sistema no representa:

1. **Arrendamiento de consultorios** a médicos especialistas (ingreso recurrente).
2. **El especialista como cliente y contraparte económica**: consume quirófano, imágenes, laboratorio, camas e insumos, y a la vez origina la demanda y devenga honorarios.
3. **Turnos 24/7 de médicos generales** destacados por sede, que garantizan continuidad y captación.

Consecuencias actuales: no se puede responder "¿cuánto vale económicamente cada afiliado?", "¿qué consultorios están ociosos?" ni "¿quién está de turno en Surf City a las 3 a.m.?".

Adicionalmente, `OutpatientAppointment` existe como entidad pero **sin motor de agenda**: no hay disponibilidad, plantillas de horario, excepciones, ni enlace al consultorio arrendado.

## 2. Objetivo

Entregar dos épicas que conviertan al HIS en sistema de negocio y no solo en expediente:

- **E1 — Modelo de Médico Afiliado**: afiliado como parte única (arrendatario + proveedor de servicios profesionales), contrato de arrendamiento con devengo, atribución de producción, liquidación de honorarios y rostering 24/7.
- **E2 — Agenda de Clínicas Externas**: programación de citas por médico y consultorio, con disponibilidad derivada de la plantilla de horario y del contrato de arrendamiento.

## 3. Decisiones de arquitectura ya tomadas (no reabrir)

| ID | Decisión | Implicación |
|---|---|---|
| D1 | **El HIS devenga el arrendamiento; Odoo factura.** | `ContratoCargo` genera el devengo mensual y lo publica a Odoo vía `OdooSyncMapping`. El HIS **no** emite DTE de arrendamiento ni gestiona cobranza fiscal. |
| D2 | **El HIS calcula y liquida honorarios; Odoo ejecuta el pago.** | `Liquidacion` llega hasta estado `APROBADA`/`ENVIADA_ODOO`. La cuenta por pagar, retenciones fiscales de pago y desembolso viven en Odoo. |
| D3 | **Agenda interna por consultorio.** | Sin portal de autoagenda ni recordatorios WhatsApp/SMS en esta entrega. Se deja el campo `permiteAutoagenda` y los eventos de dominio preparados para la fase siguiente. |
| D4 | **Disponibilidad derivada, no materializada.** | No se crea tabla de slots. La disponibilidad se calcula por función SQL sobre plantilla + excepciones + citas activas. Evita millones de filas y desincronización. |
| D5 | **El afiliado es una entidad de negocio, no un `User`.** | `MedicoAfiliado` puede existir sin cuenta en el HIS (`userId` nulo). `User` sigue siendo identidad/acceso. |

## 4. Alcance

### 4.1 Dentro de alcance

- Catálogo de consultorios y su ocupación.
- Expediente del médico afiliado (datos fiscales, JVPM, especialidades, estado de relación).
- Contrato de arrendamiento, jornadas, devengo mensual y publicación a Odoo.
- Convenios y reglas de honorarios; atribución automática de producción; liquidación con compensación contra mora de arrendamiento.
- Plantillas de turno, programación (rostering), publicación, cobertura y resolución de "médico de turno vigente".
- Motor de agenda: plantilla semanal, excepciones, disponibilidad, reserva, reprogramación, cancelación, sobrecupo, no-show, check-in con creación de `Encounter` y `PatientAccount`, lista de espera.
- RBAC/ABAC, auditoría, migraciones, pruebas y tableros mínimos.

### 4.2 Fuera de alcance

- Emisión de DTE de arrendamiento y cobranza (Odoo).
- Pago efectivo de honorarios y retenciones de pago (Odoo).
- Portal de autoagenda del paciente y recordatorios por WhatsApp/SMS.
- Nómina del personal de planta (RRHH); el rostering no calcula salarios ni horas extra, solo cobertura.
- Módulo de fisioterapia y rehabilitación (brecha identificada, REQ aparte).

## 5. Convenciones obligatorias

Toda la implementación debe respetar lo ya establecido en el HIS:

- **Stack**: Next.js App Router, TypeScript, tRPC 11, Prisma 6, PostgreSQL 17. `pnpm`/Turborepo.
- **Nomenclatura de tablas**: PascalCase, dominio en español cuando la entidad es de negocio local (`TipoCuenta`, `CatalogoMedicamento`, `AbacRule` ya lo hacen).
- **Columnas estándar en toda tabla nueva**: `id uuid PK`, `organizationId uuid NOT NULL`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`.
- **RLS habilitado sin excepción** en todas las tablas nuevas, con aislamiento por `organizationId`.
- **Folios**: contador interno en tabla `secuencia_*` con `RLS deny-all`, sin grants API, accesible solo por función `SECURITY DEFINER` (`fn_next_*`), siguiendo el patrón CC-0020.
- **Migraciones**: archivos `sql/240_*.sql` en adelante; una migración por agrupación funcional, idempotente, con comentario `COMMENT ON TABLE` que cite la historia de usuario.
- **Auditoría**: `audit."AuditLog"` en toda mutación. Si el call-site corre en transacción demotada, documentarlo explícitamente como se hizo en `CareTask`.
- **RBAC**: los menús se derivan de permisos, nunca de fuentes de autorización. Todo recurso nuevo se registra en `Permission` + `RolePermission`.
- **Zona horaria**: `America/El_Salvador`. Toda columna temporal es `timestamptz`. Ninguna regla de agenda puede depender de la hora del navegador.
- **Diseño**: Avante DS v2.0 (navy `#0B3D5C`, teal `#00A8B5`, Inter, tokens OKLCH).
- **Moneda**: `currencyId` obligatorio en toda entidad monetaria; `numeric(14,2)` para montos y `numeric(7,4)` para porcentajes.
- **Extensión requerida**: `btree_gist` — **está disponible pero NO instalada** en la base actual. La primera migración de este cambio debe ejecutar `CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;` antes de cualquier restricción `EXCLUDE`.
- **Secuencias de folio**: seguir exactamente el patrón de las existentes (`fn_next_cuenta`, `fn_next_expediente`, `fn_next_no_identificado`, `fn_next_solicitud_imagen`). Las nuevas son `fn_next_contrato_arrendamiento` y `fn_next_liquidacion`, cada una con su tabla `secuencia_*` en `RLS deny-all`.

---

# ÉPICA E1 — Modelo de Médico Afiliado

> **Como** Dirección General de Avante
> **quiero** que el sistema represente al médico afiliado como contraparte económica, su consultorio arrendado, la producción que origina y la cobertura médica 24/7
> **para** conocer la rentabilidad real por afiliado y por sede, y garantizar continuidad asistencial verificable.

**Valor**: hoy el activo más valioso del negocio —el cuerpo médico afiliado— no existe en el sistema. Esta épica lo vuelve medible.

**Métricas de éxito**
- 100% de consultorios con contrato vigente registrado y devengo automático mensual.
- Rentabilidad por afiliado calculable sin hoja de cálculo externa.
- Cero turnos publicados con dotación descubierta sin autorización expresa.

---

## 5.1 Modelo de datos E1

### Bloque A — Consultorios y arrendamiento

```
Consultorio
  id uuid PK
  organizationId uuid NOT NULL -> Organization
  establishmentId uuid NOT NULL -> Establishment
  serviceUnitId uuid NULL -> ServiceUnit
  codigo varchar NOT NULL
  nombre varchar NOT NULL
  piso varchar NULL
  areaM2 numeric(8,2) NULL
  tipoUso varchar NOT NULL              -- ARRENDADO | PROPIO | MIXTO
  especialidadSugeridaId uuid NULL -> MedicalSpecialty
  capacidadPacientesHora int NULL
  glnCodigo varchar NULL
  equipamiento jsonb NOT NULL DEFAULT '{}'
  active boolean NOT NULL DEFAULT true
  UNIQUE (organizationId, codigo)

MedicoAfiliado
  id uuid PK
  organizationId uuid NOT NULL -> Organization
  userId uuid NULL -> User               -- nulo si aún no tiene acceso al HIS
  nombreCompleto varchar NOT NULL
  tipoDocumentoId uuid NULL -> IdentifierType
  numeroDocumento varchar NULL
  jvpmNumero varchar NOT NULL            -- Junta de Vigilancia de la Profesión Médica
  especialidadPrincipalId uuid NULL -> MedicalSpecialty
  tipoRelacion varchar NOT NULL          -- AFILIADO_ARRENDATARIO | AFILIADO_SIN_CONSULTORIO | STAFF_INTERNO
  nit varchar NULL
  nrc varchar NULL
  esContribuyenteIva boolean NOT NULL DEFAULT false
  estado varchar NOT NULL                -- PROSPECTO | ACTIVO | SUSPENDIDO | INACTIVO
  fechaIngreso date NULL
  fechaBaja date NULL
  motivoBaja varchar NULL
  permiteCompensacion boolean NOT NULL DEFAULT true   -- cruce renta vs honorarios
  UNIQUE (organizationId, jvpmNumero)

MedicoAfiliadoEspecialidad
  id uuid PK
  medicoAfiliadoId uuid NOT NULL -> MedicoAfiliado
  specialtyId uuid NOT NULL -> MedicalSpecialty
  esPrincipal boolean NOT NULL DEFAULT false
  UNIQUE (medicoAfiliadoId, specialtyId)

ContratoArrendamiento
  id uuid PK
  organizationId uuid NOT NULL
  medicoAfiliadoId uuid NOT NULL -> MedicoAfiliado
  consultorioId uuid NOT NULL -> Consultorio
  folio varchar NOT NULL                 -- fn_next_contrato_arrendamiento()
  modalidad varchar NOT NULL             -- EXCLUSIVO | COMPARTIDO_POR_JORNADA
  fechaInicio date NOT NULL
  fechaFin date NULL
  plazoMeses int NULL
  rentaMensual numeric(14,2) NOT NULL
  cuotaServicios numeric(14,2) NOT NULL DEFAULT 0
  currencyId uuid NOT NULL -> Currency
  diaCorte int NOT NULL DEFAULT 1        -- día del mes en que se devenga
  plazoPagoDias int NOT NULL DEFAULT 5
  ivaAplica boolean NOT NULL DEFAULT true
  indexacionAnualPct numeric(7,4) NULL
  depositoGarantia numeric(14,2) NOT NULL DEFAULT 0
  renovacionAutomatica boolean NOT NULL DEFAULT false
  mesesPreavisoTermino int NOT NULL DEFAULT 2
  costCenterId uuid NULL -> CostCenter
  estado varchar NOT NULL                -- BORRADOR | VIGENTE | EN_MORA | SUSPENDIDO | TERMINADO | RENOVADO
  notas text
  UNIQUE (organizationId, folio)
  EXCLUDE USING gist (consultorioId WITH =, daterange(fechaInicio, coalesce(fechaFin,'infinity'::date)) WITH &&)
      WHERE (estado IN ('VIGENTE','EN_MORA') AND modalidad = 'EXCLUSIVO')

ContratoJornada                          -- solo para modalidad COMPARTIDO_POR_JORNADA
  id uuid PK
  contratoId uuid NOT NULL -> ContratoArrendamiento
  diaSemana smallint NOT NULL            -- 0=domingo .. 6=sábado
  horaInicio time NOT NULL
  horaFin time NOT NULL
  CHECK (horaFin > horaInicio)

ContratoCargo                            -- devengo mensual
  id uuid PK
  organizationId uuid NOT NULL
  contratoId uuid NOT NULL -> ContratoArrendamiento
  periodo date NOT NULL                  -- primer día del mes devengado
  concepto varchar NOT NULL              -- RENTA | SERVICIOS | MORA | AJUSTE | DEPOSITO
  monto numeric(14,2) NOT NULL
  currencyId uuid NOT NULL
  estado varchar NOT NULL                -- DEVENGADO | ENVIADO_ODOO | FACTURADO | PAGADO | ANULADO
  odooInvoiceId int NULL
  odooSyncedAt timestamptz NULL
  generadoAt timestamptz NOT NULL
  UNIQUE (contratoId, periodo, concepto)
```

### Bloque B — Producción y honorarios

```
ConvenioHonorario
  id uuid PK
  organizationId uuid NOT NULL
  medicoAfiliadoId uuid NOT NULL -> MedicoAfiliado
  vigenciaDesde date NOT NULL
  vigenciaHasta date NULL
  retencionRentaPct numeric(7,4) NOT NULL DEFAULT 0.10
  aplicaIvaRetenido boolean NOT NULL DEFAULT false
  periodicidadLiquidacion varchar NOT NULL   -- QUINCENAL | MENSUAL
  estado varchar NOT NULL                    -- BORRADOR | VIGENTE | TERMINADO
  EXCLUDE USING gist (medicoAfiliadoId WITH =, daterange(vigenciaDesde, coalesce(vigenciaHasta,'infinity'::date)) WITH &&)
      WHERE (estado = 'VIGENTE')

ReglaHonorario
  id uuid PK
  convenioId uuid NOT NULL -> ConvenioHonorario
  ambito varchar NOT NULL                -- CIRUGIA | CONSULTA | PROCEDIMIENTO | INTERPRETACION | VISITA_HOSPITALARIA | INSUMO
  rolMedico varchar NULL                 -- TRATANTE | CIRUJANO | AYUDANTE | ANESTESISTA | INTERPRETE | REFERENTE
  serviceCategoryId uuid NULL -> ServiceCategory
  codigoServicio varchar NULL            -- código de ServicePriceListItem
  tipoCalculo varchar NOT NULL           -- PORCENTAJE | MONTO_FIJO
  porcentaje numeric(7,4) NULL
  montoFijo numeric(14,2) NULL
  montoMinimo numeric(14,2) NULL
  montoMaximo numeric(14,2) NULL
  prioridad int NOT NULL DEFAULT 0
  active boolean NOT NULL DEFAULT true
  CHECK ((tipoCalculo='PORCENTAJE' AND porcentaje IS NOT NULL) OR (tipoCalculo='MONTO_FIJO' AND montoFijo IS NOT NULL))

ProduccionMedica
  id uuid PK
  organizationId uuid NOT NULL
  establishmentId uuid NOT NULL
  medicoAfiliadoId uuid NOT NULL -> MedicoAfiliado
  rolMedico varchar NOT NULL
  patientAccountServiceId uuid NOT NULL -> PatientAccountService
  encounterId uuid NULL -> Encounter
  fecha date NOT NULL
  montoFacturado numeric(14,2) NOT NULL
  honorarioCalculado numeric(14,2) NOT NULL
  reglaHonorarioId uuid NULL -> ReglaHonorario
  estado varchar NOT NULL                -- PENDIENTE | LIQUIDADO | EXCLUIDO | REVERSADO
  liquidacionId uuid NULL -> Liquidacion
  motivoExclusion varchar NULL
  UNIQUE (patientAccountServiceId, medicoAfiliadoId, rolMedico)

Liquidacion
  id uuid PK
  organizationId uuid NOT NULL
  medicoAfiliadoId uuid NOT NULL
  folio varchar NOT NULL                 -- fn_next_liquidacion()
  periodoDesde date NOT NULL
  periodoHasta date NOT NULL
  totalBruto numeric(14,2) NOT NULL
  totalRetenciones numeric(14,2) NOT NULL
  totalCompensaciones numeric(14,2) NOT NULL   -- renta en mora cruzada
  totalNeto numeric(14,2) NOT NULL
  currencyId uuid NOT NULL
  estado varchar NOT NULL                -- BORRADOR | APROBADA | ENVIADA_ODOO | PAGADA | ANULADA
  aprobadaBy uuid NULL -> User
  aprobadaAt timestamptz NULL
  odooBillId int NULL
  odooSyncedAt timestamptz NULL
  UNIQUE (organizationId, folio)

LiquidacionCompensacion
  id uuid PK
  liquidacionId uuid NOT NULL -> Liquidacion
  contratoCargoId uuid NOT NULL -> ContratoCargo
  monto numeric(14,2) NOT NULL
  UNIQUE (liquidacionId, contratoCargoId)
```

### Bloque C — Turnos 24/7

```
PlantillaTurno
  id uuid PK
  organizationId uuid NOT NULL
  establishmentId uuid NOT NULL
  serviceUnitId uuid NULL -> ServiceUnit
  codigo varchar NOT NULL
  nombre varchar NOT NULL                -- p.ej. "Turno A — 07:00 a 19:00"
  horaInicio time NOT NULL
  horaFin time NOT NULL
  cruzaMedianoche boolean NOT NULL DEFAULT false
  tipo varchar NOT NULL                  -- MEDICO_GENERAL | ENFERMERIA | APOYO
  dotacionRequerida int NOT NULL DEFAULT 1
  active boolean NOT NULL DEFAULT true
  UNIQUE (organizationId, establishmentId, codigo)

ProgramacionTurno
  id uuid PK
  organizationId uuid NOT NULL
  establishmentId uuid NOT NULL
  periodoDesde date NOT NULL
  periodoHasta date NOT NULL
  estado varchar NOT NULL                -- BORRADOR | PUBLICADA | CERRADA
  publicadaBy uuid NULL
  publicadaAt timestamptz NULL
  autorizaDescubiertoBy uuid NULL
  autorizaDescubiertoMotivo varchar NULL
  UNIQUE (organizationId, establishmentId, periodoDesde, periodoHasta)

AsignacionTurno
  id uuid PK
  programacionId uuid NOT NULL -> ProgramacionTurno
  plantillaTurnoId uuid NOT NULL -> PlantillaTurno
  userId uuid NOT NULL -> User
  fecha date NOT NULL
  inicioProgramado timestamptz NOT NULL   -- calculado de fecha + plantilla
  finProgramado timestamptz NOT NULL
  inicioReal timestamptz NULL
  finReal timestamptz NULL
  estado varchar NOT NULL                -- PROGRAMADO | CONFIRMADO | EN_CURSO | CUMPLIDO | AUSENTE | SUSTITUIDO
  sustitutoUserId uuid NULL -> User
  motivoCambio varchar NULL
  UNIQUE (plantillaTurnoId, fecha, userId)
  EXCLUDE USING gist (userId WITH =, tstzrange(inicioProgramado, finProgramado) WITH &&)
      WHERE (estado IN ('PROGRAMADO','CONFIRMADO','EN_CURSO'))
```

**Función obligatoria**

```sql
fn_medico_de_turno(p_establishment_id uuid, p_at timestamptz DEFAULT now())
  RETURNS TABLE (userId uuid, fullName varchar, plantillaTurnoId uuid, tipo varchar)
-- SECURITY DEFINER, STABLE. Devuelve las asignaciones vigentes en p_at,
-- resolviendo sustituciones (si estado='SUSTITUIDO' devuelve sustitutoUserId).
```

---

## 5.2 Historias de usuario E1

### Sub-épica E1.A — Consultorios y arrendamiento

---

#### US.AFIL.1.1 — Registrar catálogo de consultorios

**Como** administrador de consultorios
**quiero** registrar cada consultorio de cada sede con sus atributos físicos
**para** poder arrendarlo, agendarlo y medir su ocupación.

**Criterios de aceptación**

1. **Dado** que estoy autenticado con permiso `consultorio:crear`, **cuando** registro un consultorio con código, nombre, sede y tipo de uso, **entonces** el sistema lo persiste con `active=true` y registra la mutación en `audit."AuditLog"`.
2. **Dado** que existe un consultorio con código `CE-201` en la organización, **cuando** intento crear otro con el mismo código, **entonces** el sistema rechaza la operación con error de unicidad y mensaje en español: "Ya existe un consultorio con el código CE-201 en esta organización".
3. **Dado** un consultorio con contrato `VIGENTE`, **cuando** intento desactivarlo, **entonces** el sistema lo impide e indica el folio del contrato que lo bloquea.
4. **Dado** que selecciono la sede en el filtro, **cuando** listo consultorios, **entonces** solo veo los de esa sede y los de organizaciones a las que tengo acceso por RLS.
5. **Dado** un usuario sin permiso `consultorio:leer`, **cuando** intenta acceder a la ruta, **entonces** recibe 403 y la opción no aparece en el menú (menú derivado de permisos).

---

#### US.AFIL.1.2 — Registrar médico afiliado

**Como** gerencia médica
**quiero** dar de alta al médico especialista como afiliado con sus datos fiscales y profesionales
**para** poder contratarlo, pagarle honorarios y atribuirle producción.

**Criterios de aceptación**

1. **Dado** un formulario de alta, **cuando** registro nombre, JVPM, especialidad principal y tipo de relación, **entonces** el afiliado queda en estado `PROSPECTO` y se genera `DomainEvent` `afiliado.creado`.
2. **Dado** un afiliado con JVPM ya registrado en la organización, **cuando** intento crearlo de nuevo, **entonces** el sistema lo rechaza y ofrece abrir el registro existente.
3. **Dado** un afiliado `PROSPECTO`, **cuando** tiene al menos un contrato `VIGENTE` o un convenio de honorarios `VIGENTE`, **entonces** el sistema permite pasarlo a `ACTIVO`; en caso contrario bloquea la transición.
4. **Dado** un afiliado `ACTIVO`, **cuando** lo doy de baja, **entonces** el sistema exige `fechaBaja` y `motivoBaja`, verifica que no tenga producción `PENDIENTE` sin liquidar ni contrato `VIGENTE`, y solo entonces lo pasa a `INACTIVO`.
5. **Dado** un afiliado con `userId` asignado, **cuando** el usuario inicia sesión, **entonces** su contexto incluye `medicoAfiliadoId` para efectos de ABAC.
6. **Dado** un afiliado con NIT registrado, **cuando** se sincroniza con Odoo, **entonces** se crea/actualiza `res.partner` y se registra el vínculo en `OdooSyncMapping` con `hisType='MedicoAfiliado'`.

---

#### US.AFIL.1.3 — Suscribir contrato de arrendamiento de consultorio

**Como** administrador de consultorios
**quiero** registrar el contrato de arrendamiento entre Avante y el médico afiliado
**para** devengar la renta y habilitar su agenda.

**Criterios de aceptación**

1. **Dado** un afiliado `ACTIVO` y un consultorio activo, **cuando** creo un contrato con modalidad `EXCLUSIVO`, fecha de inicio, renta y cuota de servicios, **entonces** el sistema asigna folio mediante `fn_next_contrato_arrendamiento()` y lo deja en `BORRADOR`.
2. **Dado** un consultorio con contrato `EXCLUSIVO` vigente del 2026-01-01 al 2026-12-31, **cuando** intento crear otro contrato `EXCLUSIVO` sobre el mismo consultorio que se traslape en fechas, **entonces** la restricción de exclusión lo rechaza con mensaje: "El consultorio ya está arrendado en ese período (folio ARR-000123)".
3. **Dado** un contrato `COMPARTIDO_POR_JORNADA`, **cuando** registro jornadas, **entonces** el sistema valida que no se traslapen con jornadas de otros contratos vigentes del mismo consultorio, día y rango horario.
4. **Dado** un contrato en `BORRADOR` completo, **cuando** lo activo, **entonces** pasa a `VIGENTE`, se genera el devengo del período en curso (prorrateado si la fecha de inicio no coincide con el día de corte) y se emite `DomainEvent` `contrato.activado`.
5. **Dado** un contrato con `indexacionAnualPct` y más de 12 meses de vigencia, **cuando** se cumple el aniversario, **entonces** el sistema propone (no aplica automáticamente) el ajuste de renta y genera tarea en el *Workflow Inbox*.
6. **Dado** un contrato `VIGENTE` con `renovacionAutomatica=false` y fecha de fin a `mesesPreavisoTermino` de distancia, **entonces** el sistema genera notificación al administrador de consultorios.
7. **Dado** un contrato `VIGENTE`, **cuando** lo termino anticipadamente, **entonces** el sistema exige motivo, genera el devengo prorrateado del período parcial y libera el consultorio a partir de la fecha efectiva.

---

#### US.AFIL.1.4 — Devengar la renta mensual y publicarla a Odoo

**Como** contabilidad
**quiero** que el HIS genere automáticamente el cargo mensual de cada contrato y lo envíe a Odoo
**para** facturar sin recaptura manual y sin duplicar el motor fiscal.

**Criterios de aceptación**

1. **Dado** un contrato `VIGENTE` con `diaCorte=1`, **cuando** corre el job programado (`cron`) el día 1 a las 02:00 `America/El_Salvador`, **entonces** se crean los `ContratoCargo` de conceptos `RENTA` y, si aplica, `SERVICIOS` con estado `DEVENGADO`.
2. **Dado** que el job se ejecuta dos veces para el mismo período, **cuando** intenta insertar, **entonces** la unicidad `(contratoId, periodo, concepto)` garantiza idempotencia y no se duplica el cargo.
3. **Dado** un cargo `DEVENGADO`, **cuando** se publica a Odoo, **entonces** se crea el `account.move` correspondiente, se registra en `OdooSyncMapping` con `hisType='ContratoCargo'` y `lastSyncedHash`, y el cargo pasa a `ENVIADO_ODOO`.
4. **Dado** un cargo cuyo hash no cambió, **cuando** se reintenta la sincronización, **entonces** el sistema no vuelve a crear el documento en Odoo y registra el intento en `OdooSyncLog`.
5. **Dado** que Odoo confirma la factura, **cuando** llega la confirmación, **entonces** el cargo pasa a `FACTURADO` con `odooInvoiceId`.
6. **Dado** un cargo `FACTURADO` vencido más allá de `plazoPagoDias`, **cuando** corre el job de mora, **entonces** el contrato pasa a `EN_MORA` y se genera notificación a Gerencia Financiera y al administrador de consultorios.
7. **Dado** un cargo en estado `ENVIADO_ODOO` o `FACTURADO`, **cuando** intento anularlo desde el HIS, **entonces** el sistema lo impide e indica que la anulación se hace en Odoo.

---

### Sub-épica E1.B — Producción y honorarios

---

#### US.AFIL.1.5 — Definir convenio y reglas de honorarios

**Como** gerencia financiera
**quiero** configurar por afiliado el porcentaje o monto de honorario según el tipo de acto
**para** calcular su liquidación sin negociación caso por caso.

**Criterios de aceptación**

1. **Dado** un afiliado sin convenio vigente, **cuando** creo uno con vigencia desde hoy, **entonces** queda en `BORRADOR` y solo puede activarse con al menos una regla `active`.
2. **Dado** un convenio `VIGENTE` del afiliado, **cuando** intento crear otro convenio `VIGENTE` con fechas traslapadas, **entonces** la restricción de exclusión lo rechaza.
3. **Dado** varias reglas que hacen match con un mismo cargo, **cuando** se resuelve el honorario, **entonces** gana la primera regla ordenada por **especificidad** (código de servicio > categoría > ámbito) → `prioridad` desc → creación desc, replicando el patrón ya usado en `ServicePriceRule` (CC-0021).
4. **Dado** una regla `PORCENTAJE` de 40% con `montoMinimo` de $25.00, **cuando** el cargo facturado es de $50.00, **entonces** el honorario calculado es $25.00 (aplica el mínimo) y queda registrada la regla aplicada.
5. **Dado** un cargo sin ninguna regla que haga match, **cuando** se calcula la producción, **entonces** se registra `ProduccionMedica` con `honorarioCalculado=0`, `estado='EXCLUIDO'` y `motivoExclusion='SIN_REGLA'`, visible en un reporte de excepciones.
6. **Dado** que modifico una regla, **cuando** guardo, **entonces** el cambio **no** recalcula producción ya liquidada; solo aplica a producción `PENDIENTE` generada a partir de la fecha del cambio.

---

#### US.AFIL.1.6 — Atribuir producción al médico afiliado

**Como** sistema
**quiero** registrar automáticamente qué producción generó cada médico y en qué rol
**para** sustentar la liquidación y medir el valor económico del afiliado.

**Criterios de aceptación**

1. **Dado** un cargo confirmado en `PatientAccountService` con médico responsable identificado, **cuando** se emite el evento de dominio del cargo, **entonces** se crea `ProduccionMedica` con `estado='PENDIENTE'`, el rol médico correspondiente y el honorario resuelto por regla.
2. **Dado** una cirugía con cirujano, ayudante y anestesista, **cuando** se registra el caso quirúrgico, **entonces** se generan tres filas de `ProduccionMedica` sobre el mismo `patientAccountServiceId`, una por `rolMedico`, cada una con su propia regla.
3. **Dado** un intento de crear producción duplicada para el mismo cargo, médico y rol, **cuando** se inserta, **entonces** la unicidad lo impide y el evento se marca como procesado sin efecto (idempotencia).
4. **Dado** un `PatientAccountService` que se reversa (`reversalOfId` no nulo), **cuando** se procesa la reversión, **entonces** la producción asociada pasa a `REVERSADA` y —si ya estaba liquidada— se genera una fila de producción negativa que se arrastra a la siguiente liquidación.
5. **Dado** un paciente referido por un especialista que no ejecutó el acto, **cuando** el encuentro tiene `isReferral=true` y `referralOrigin` asociado a un afiliado, **entonces** se registra producción con `rolMedico='REFERENTE'` (honorario solo si hay regla para ese rol).
6. **Dado** un cargo cuyo médico es `STAFF_INTERNO`, **cuando** se calcula producción, **entonces** se registra la atribución con `honorarioCalculado=0` y `estado='EXCLUIDO'`, motivo `PERSONAL_DE_PLANTA`, para conservar la trazabilidad clínica sin generar cuenta por pagar.

---

#### US.AFIL.1.7 — Generar y aprobar la liquidación de honorarios

**Como** analista de honorarios
**quiero** consolidar la producción del período en una liquidación por afiliado
**para** enviarla a Odoo y que se ejecute el pago.

**Criterios de aceptación**

1. **Dado** un afiliado con producción `PENDIENTE` en el período, **cuando** genero la liquidación, **entonces** el sistema asigna folio, agrupa la producción, calcula `totalBruto`, aplica `retencionRentaPct` del convenio y deja la liquidación en `BORRADOR`.
2. **Dado** un afiliado con `permiteCompensacion=true` y cargos de arrendamiento vencidos, **cuando** se genera la liquidación, **entonces** el sistema crea filas en `LiquidacionCompensacion` hasta el monto disponible, sin dejar `totalNeto` negativo, y deja el remanente para el siguiente período.
3. **Dado** una liquidación en `BORRADOR`, **cuando** se vuelve a generar la del mismo período, **entonces** el sistema la reemplaza (no duplica) y conserva la trazabilidad en auditoría.
4. **Dado** una liquidación en `BORRADOR`, **cuando** un usuario con permiso `liquidacion:aprobar` la aprueba, **entonces** pasa a `APROBADA`, se sella con `aprobadaBy` y `aprobadaAt`, y la producción incluida pasa a `LIQUIDADO` con `liquidacionId`.
5. **Dado** una liquidación `APROBADA`, **cuando** intento modificarla, **entonces** el sistema lo impide; solo es posible anularla con motivo, lo que devuelve la producción a `PENDIENTE`.
6. **Dado** una liquidación `APROBADA`, **cuando** se publica a Odoo, **entonces** se crea el documento de cuenta por pagar, se registra en `OdooSyncMapping` con `hisType='Liquidacion'` y pasa a `ENVIADA_ODOO`.
7. **Dado** una liquidación en cualquier estado, **cuando** la consulto, **entonces** puedo descargar el detalle por paciente, fecha, servicio, monto facturado, regla aplicada y honorario, en PDF y en XLSX.
8. **Dado** el usuario afiliado con acceso al HIS, **cuando** consulta su portal de afiliado, **entonces** ve únicamente sus propias liquidaciones y su estado de cuenta (renta devengada vs honorarios), por regla ABAC.

---

#### US.AFIL.1.8 — Tablero de rentabilidad por afiliado y ocupación de consultorios

**Como** Dirección General
**quiero** ver por afiliado la renta devengada, la producción originada y los honorarios pagados
**para** decidir renovaciones, tarifas y prioridades comerciales.

**Criterios de aceptación**

1. **Dado** un período seleccionado, **cuando** abro el tablero, **entonces** veo por afiliado: renta devengada, renta cobrada, producción facturada por línea (consulta, quirófano, imágenes, laboratorio, farmacia, hospitalización), honorarios devengados y margen de contribución.
2. **Dado** el mismo tablero, **cuando** filtro por sede, **entonces** los totales se recalculan respetando RLS y permisos.
3. **Dado** un consultorio, **cuando** consulto ocupación, **entonces** veo % de horas contratadas sobre horas disponibles y % de cupos usados sobre cupos publicados (este último se alimenta de la Épica E2).
4. **Dado** un afiliado sin producción en 90 días con contrato vigente, **cuando** se ejecuta el cálculo, **entonces** aparece marcado como "afiliado inactivo comercialmente" en el tablero.
5. **Dado** el tablero, **cuando** lo exporto, **entonces** obtengo XLSX con las mismas cifras visibles y una hoja de metodología de cálculo.
6. **NFR**: el tablero responde en p95 < 1.5 s para 24 meses de historia; se permite vista materializada refrescada por `cron` en el esquema `analytics`.

---

### Sub-épica E1.C — Turnos 24/7

---

#### US.AFIL.1.9 — Definir plantillas de turno por sede

**Como** jefe médico de sede
**quiero** definir los turnos tipo y la dotación requerida de cada uno
**para** programar la cobertura 24/7.

**Criterios de aceptación**

1. **Dado** una sede, **cuando** creo una plantilla con hora de inicio 19:00 y fin 07:00, **entonces** el sistema marca `cruzaMedianoche=true` automáticamente y calcula correctamente la duración (12 h).
2. **Dado** el conjunto de plantillas activas de tipo `MEDICO_GENERAL` de una sede, **cuando** valido cobertura, **entonces** el sistema indica si existen huecos horarios no cubiertos en un día tipo de 24 horas y los muestra gráficamente.
3. **Dado** una plantilla usada en asignaciones vigentes, **cuando** intento desactivarla, **entonces** el sistema lo impide hasta que no existan asignaciones futuras asociadas.
4. **Dado** que la sede es Surf City, **cuando** defino plantillas, **entonces** puedo establecer `dotacionRequerida=1`, distinta de Hospital Escalón.

---

#### US.AFIL.1.10 — Programar y publicar el rol de turnos

**Como** jefe médico de sede
**quiero** asignar médicos generales a los turnos de un período y publicar el rol
**para** que el personal y el sistema conozcan quién está de guardia.

**Criterios de aceptación**

1. **Dado** un período quincenal o mensual, **cuando** creo la programación, **entonces** queda en `BORRADOR` y puedo asignar médicos por turno y fecha mediante una vista de calendario.
2. **Dado** que asigno un médico a dos turnos que se traslapan, **cuando** guardo, **entonces** la restricción de exclusión lo rechaza indicando el turno en conflicto.
3. **Dado** un médico con más de 24 horas continuas asignadas, **cuando** guardo, **entonces** el sistema emite advertencia bloqueante que requiere justificación explícita del jefe médico.
4. **Dado** una programación con turnos por debajo de `dotacionRequerida`, **cuando** intento publicarla, **entonces** el sistema lo impide, salvo que un usuario con permiso `turno:autorizar_descubierto` registre motivo, quedando trazado en `autorizaDescubiertoBy`/`autorizaDescubiertoMotivo`.
5. **Dado** una programación `PUBLICADA`, **cuando** un médico no puede cubrir su turno, **entonces** se registra sustitución con `sustitutoUserId` y motivo, el turno original pasa a `SUSTITUIDO` y se notifica a los involucrados.
6. **Dado** una programación `PUBLICADA`, **cuando** cambio una asignación, **entonces** queda registro en auditoría con estado anterior y nuevo, y se notifica al afectado.
7. **Dado** un turno publicado, **cuando** el médico marca su ingreso, **entonces** se registra `inicioReal` y el estado pasa a `EN_CURSO`; al cierre se registra `finReal` y pasa a `CUMPLIDO`.
8. **Dado** un turno cuyo inicio programado pasó sin registro de ingreso más allá de 30 minutos, **cuando** corre el job de control, **entonces** se marca alerta de turno sin cobertura y se notifica al jefe médico de sede.

---

#### US.AFIL.1.11 — Resolver el médico de turno vigente

**Como** sistema y como personal asistencial
**quiero** saber en todo momento qué médico está de guardia en cada sede
**para** enrutar tareas, interconsultas y llamadas sin ambigüedad.

**Criterios de aceptación**

1. **Dado** un instante y una sede, **cuando** invoco `fn_medico_de_turno`, **entonces** obtengo los médicos vigentes resolviendo sustituciones y turnos que cruzan medianoche.
2. **Dado** un `CareTask` creado sin `assigneeId` cuyo `assignedRoleCode` corresponde a médico general, **cuando** se persiste, **entonces** el sistema resuelve el asignatario con `fn_medico_de_turno` para la sede del `establishmentId` de la tarea.
3. **Dado** que no hay médico de turno en el instante consultado, **cuando** se resuelve, **entonces** la tarea queda sin asignatario, se marca `SIN_COBERTURA` y se notifica al jefe médico de sede; el flujo clínico **no** se bloquea.
4. **Dado** el módulo de emergencia, **cuando** se muestra el encabezado del turno, **entonces** despliega el nombre del médico de guardia vigente y se actualiza sin recargar la página al cambiar el turno.
5. **NFR**: la resolución responde en p95 < 150 ms.

---

# ÉPICA E2 — Agenda de Clínicas Externas

> **Como** Avante
> **quiero** un motor de agenda por médico afiliado y consultorio
> **para** ordenar el flujo de pacientes de consulta externa, medir la ocupación de los consultorios arrendados y convertir la consulta en producción hospitalaria.

**Valor**: la agenda es el punto donde el arrendamiento (E1) se convierte en demanda de servicios hospitalarios. Sin ella, el consultorio es solo un alquiler; con ella, es un canal medible.

**Métricas de éxito**
- % de cupos publicados efectivamente usados por consultorio y por médico.
- Tasa de no-show medida y atribuible.
- Tiempo de reserva por cita < 60 segundos en recepción.

---

## 6.1 Modelo de datos E2

### Extensiones a `OutpatientAppointment` (tabla existente)

```
ALTER TABLE "OutpatientAppointment" ADD COLUMN
  medicoAfiliadoId uuid NULL -> MedicoAfiliado
  consultorioId uuid NULL -> Consultorio
  agendaId uuid NULL -> AgendaMedico
  tipoCita varchar NULL              -- PRIMERA_VEZ | SUBSECUENTE | CONTROL_POSTQX | PROCEDIMIENTO
  canal varchar NULL                 -- RECEPCION | TELEFONO | MEDICO | PORTAL
  tipoCuentaId uuid NULL -> TipoCuenta
  insurerId uuid NULL -> Insurer
  esSobrecupo boolean NOT NULL DEFAULT false
  autorizaSobrecupoBy uuid NULL -> User
  llegadaAt timestamptz NULL
  inicioAtencionAt timestamptz NULL
  finAtencionAt timestamptz NULL
  encounterId uuid NULL -> Encounter
  reprogramadaDeId uuid NULL -> OutpatientAppointment
  motivoCancelacion varchar NULL
  canceladaBy uuid NULL -> User
  canceladaAt timestamptz NULL

-- Antirreserva doble sobre el mismo médico y sobre el mismo consultorio
ALTER TABLE "OutpatientAppointment" ADD CONSTRAINT excl_cita_medico
  EXCLUDE USING gist (providerId WITH =,
                      tstzrange(scheduledAt, scheduledAt + (durationMinutes || ' minutes')::interval) WITH &&)
  WHERE (status IN ('SCHEDULED','CONFIRMED','CHECKED_IN') AND esSobrecupo = false AND deletedAt IS NULL);

ALTER TABLE "OutpatientAppointment" ADD CONSTRAINT excl_cita_consultorio
  EXCLUDE USING gist (consultorioId WITH =,
                      tstzrange(scheduledAt, scheduledAt + (durationMinutes || ' minutes')::interval) WITH &&)
  WHERE (status IN ('SCHEDULED','CONFIRMED','CHECKED_IN') AND esSobrecupo = false AND deletedAt IS NULL);
```

> El enum `AppointmentStatus` existente (`SCHEDULED|CONFIRMED|CHECKED_IN|NO_SHOW|COMPLETED|CANCELLED`) **se conserva sin cambios**.

### Tablas nuevas

```
AgendaMedico
  id uuid PK
  organizationId uuid NOT NULL
  establishmentId uuid NOT NULL
  medicoAfiliadoId uuid NOT NULL -> MedicoAfiliado
  consultorioId uuid NOT NULL -> Consultorio
  contratoId uuid NULL -> ContratoArrendamiento
  specialtyId uuid NULL -> MedicalSpecialty
  vigenciaDesde date NOT NULL
  vigenciaHasta date NULL
  duracionSlotMin int NOT NULL DEFAULT 20
  capacidadPorSlot int NOT NULL DEFAULT 1
  sobrecupoMaximoDia int NOT NULL DEFAULT 0
  anticipacionMinimaHoras int NOT NULL DEFAULT 0
  horizonteMaximoDias int NOT NULL DEFAULT 90
  politicaCancelacionHoras int NOT NULL DEFAULT 24
  permiteAutoagenda boolean NOT NULL DEFAULT false   -- reservado para fase siguiente
  estado varchar NOT NULL              -- BORRADOR | PUBLICADA | SUSPENDIDA | CERRADA
  active boolean NOT NULL DEFAULT true

AgendaHorario
  id uuid PK
  agendaId uuid NOT NULL -> AgendaMedico
  diaSemana smallint NOT NULL          -- 0=domingo .. 6=sábado
  horaInicio time NOT NULL
  horaFin time NOT NULL
  CHECK (horaFin > horaInicio)

AgendaExcepcion
  id uuid PK
  agendaId uuid NOT NULL -> AgendaMedico
  fecha date NOT NULL
  tipo varchar NOT NULL                -- BLOQUEO | EXTENSION | VACACION | CONGRESO
  horaInicio time NULL                 -- nulo = día completo
  horaFin time NULL
  motivo varchar NOT NULL
  createdBy uuid NOT NULL

ListaEspera
  id uuid PK
  organizationId uuid NOT NULL
  agendaId uuid NOT NULL -> AgendaMedico
  patientId uuid NOT NULL -> Patient
  prioridad varchar NOT NULL           -- NORMAL | PREFERENTE
  fechaDeseadaDesde date NULL
  fechaDeseadaHasta date NULL
  estado varchar NOT NULL              -- ESPERANDO | CONTACTADO | AGENDADO | DESISTIO | VENCIDO
  citaGeneradaId uuid NULL -> OutpatientAppointment
  notas text
```

**Función obligatoria**

```sql
fn_agenda_disponibilidad(p_agenda_id uuid, p_desde date, p_hasta date)
  RETURNS TABLE (inicio timestamptz, fin timestamptz, capacidad int, ocupados int, disponible int)
-- STABLE. Calcula slots aplicando, en este orden:
--   1) AgendaHorario de la agenda vigente
--   2) intersección con ContratoJornada si el contrato es COMPARTIDO_POR_JORNADA
--   3) resta de Holiday del país (tabla Holiday) salvo excepción tipo EXTENSION
--   4) resta de AgendaExcepcion tipo BLOQUEO/VACACION/CONGRESO
--   5) resta de citas en estados SCHEDULED|CONFIRMED|CHECKED_IN
--   6) filtro por anticipacionMinimaHoras y horizonteMaximoDias
```

---

## 6.2 Historias de usuario E2

---

#### US.AGE.2.1 — Configurar la agenda de un médico en su consultorio

**Como** secretaria del médico afiliado o recepción
**quiero** definir los días, horas y duración de cita del médico en su consultorio
**para** que el sistema publique cupos reservables.

**Criterios de aceptación**

1. **Dado** un médico afiliado con contrato `VIGENTE` sobre un consultorio, **cuando** creo su agenda con duración de slot de 20 minutos, **entonces** se persiste en estado `BORRADOR`.
2. **Dado** un contrato de modalidad `COMPARTIDO_POR_JORNADA` con jornada martes 14:00–18:00, **cuando** defino un horario de agenda martes 08:00–12:00, **entonces** el sistema lo rechaza indicando: "El horario está fuera de la jornada contratada para este consultorio (martes 14:00–18:00)".
3. **Dado** una agenda en `BORRADOR` con al menos un `AgendaHorario`, **cuando** la publico, **entonces** pasa a `PUBLICADA` y los cupos quedan disponibles dentro de `horizonteMaximoDias`.
4. **Dado** dos agendas del mismo médico en consultorios distintos, **cuando** sus horarios se traslapan, **entonces** el sistema lo rechaza: un médico no puede estar en dos consultorios a la vez.
5. **Dado** una agenda `PUBLICADA`, **cuando** modifico la duración del slot, **entonces** el cambio aplica solo a fechas sin citas reservadas; si hay citas futuras afectadas, el sistema lista las citas en conflicto y exige decisión explícita antes de guardar.
6. **Dado** un contrato que pasa a `TERMINADO` o `EN_MORA`, **cuando** se evalúa la agenda asociada, **entonces** pasa automáticamente a `SUSPENDIDA`, no se publican nuevos cupos y las citas ya reservadas se conservan con alerta visible para recepción.

---

#### US.AGE.2.2 — Registrar excepciones de agenda

**Como** secretaria del médico
**quiero** bloquear días u horas (vacaciones, congreso, cirugía programada)
**para** que no se reserven cupos que el médico no podrá atender.

**Criterios de aceptación**

1. **Dado** una agenda publicada, **cuando** registro una excepción de día completo tipo `VACACION` con motivo, **entonces** esa fecha deja de mostrar disponibilidad.
2. **Dado** una excepción sobre una fecha con citas ya reservadas, **cuando** la guardo, **entonces** el sistema lista las citas afectadas y exige decidir entre reprogramarlas o cancelarlas con notificación; no permite dejarlas huérfanas.
3. **Dado** un día registrado en `Holiday`, **cuando** consulto disponibilidad, **entonces** no se ofrecen cupos, salvo que exista una excepción tipo `EXTENSION` para esa fecha.
4. **Dado** una excepción tipo `EXTENSION` de 18:00 a 20:00, **cuando** consulto disponibilidad de esa fecha, **entonces** aparecen cupos adicionales fuera del horario habitual.
5. **Dado** una excepción registrada, **cuando** la elimino, **entonces** los cupos vuelven a estar disponibles y queda registro en auditoría de quién la creó y quién la eliminó.

---

#### US.AGE.2.3 — Consultar disponibilidad

**Como** recepción
**quiero** ver los cupos libres de un médico o de una especialidad en un rango de fechas
**para** ofrecer la cita más próxima al paciente.

**Criterios de aceptación**

1. **Dado** un médico y un rango de fechas, **cuando** consulto disponibilidad, **entonces** obtengo los cupos libres con fecha, hora, consultorio y sede.
2. **Dado** que busco por especialidad en lugar de por médico, **cuando** consulto, **entonces** obtengo los cupos de todos los médicos activos de esa especialidad, ordenados por proximidad temporal.
3. **Dado** una agenda con `anticipacionMinimaHoras=4`, **cuando** consulto a las 10:00, **entonces** no se ofrecen cupos anteriores a las 14:00 del mismo día.
4. **Dado** una agenda con `horizonteMaximoDias=90`, **cuando** consulto una fecha a 120 días, **entonces** el sistema informa que excede el horizonte de publicación.
5. **NFR**: la consulta de disponibilidad de un médico para 30 días responde en p95 < 300 ms.
6. **Dado** un usuario con rol `SECRETARIA_MEDICO_AFILIADO`, **cuando** consulta disponibilidad, **entonces** por regla ABAC solo ve las agendas de su médico afiliado.

---

#### US.AGE.2.4 — Reservar una cita

**Como** recepción
**quiero** reservar un cupo para un paciente
**para** formalizar la atención y estimar su cobertura.

**Criterios de aceptación**

1. **Dado** un cupo disponible y un paciente existente, **cuando** reservo la cita indicando tipo de cita, motivo y tipo de cuenta, **entonces** se crea la cita con `status='SCHEDULED'` y se emite `DomainEvent` `cita.reservada`.
2. **Dado** un paciente inexistente, **cuando** reservo, **entonces** puedo crear el pre-registro (`REQ-ECE-PRE-001`) desde el mismo flujo sin perder el cupo seleccionado.
3. **Dado** dos usuarios que intentan reservar el mismo cupo simultáneamente, **cuando** ambos confirman, **entonces** la restricción de exclusión permite solo una reserva y al segundo se le informa que el cupo acaba de ocuparse, refrescando la disponibilidad.
4. **Dado** un paciente con cita `SCHEDULED` en la misma agenda y fecha, **cuando** intento reservar otra, **entonces** el sistema advierte del duplicado y exige confirmación explícita.
5. **Dado** un tipo de cuenta con aseguradora, **cuando** reservo, **entonces** el sistema muestra el precio estimado de la consulta resolviéndolo contra `TipoCuenta` → `ServicePriceList` → `ServicePriceRule`, y la cobertura estimada según `InsurancePlanCoverage`/`PatientCoverageOverride` (CC-0028). El estimado es informativo y **no** genera cargo.
6. **Dado** una agenda `SUSPENDIDA` por mora del contrato, **cuando** intento reservar, **entonces** el sistema lo impide salvo que un usuario con permiso `agenda:reservar_suspendida` lo autorice con motivo.
7. **Dado** que no hay cupos en el rango deseado, **cuando** lo indico, **entonces** puedo inscribir al paciente en `ListaEspera` con prioridad y rango de fechas deseado.

---

#### US.AGE.2.5 — Reprogramar, cancelar y sobrecupo

**Como** recepción
**quiero** mover, cancelar o forzar una cita fuera de cupo
**para** responder a la realidad operativa sin salirme del sistema.

**Criterios de aceptación**

1. **Dado** una cita `SCHEDULED` o `CONFIRMED`, **cuando** la reprogramo a otro cupo, **entonces** la cita original pasa a `CANCELLED` con motivo `REPROGRAMADA`, se crea una nueva con `reprogramadaDeId` apuntando a la anterior, y la cadena de reprogramaciones es consultable.
2. **Dado** una agenda con `politicaCancelacionHoras=24`, **cuando** se cancela una cita con menos de 24 horas de antelación, **entonces** el sistema exige motivo tipificado y marca la cancelación como tardía para efectos de indicador.
3. **Dado** una cita cancelada, **cuando** el cupo se libera, **entonces** el sistema notifica al primer paciente en `ListaEspera` de esa agenda cuyo rango deseado incluya la fecha, y registra el contacto.
4. **Dado** una agenda con `sobrecupoMaximoDia=2` y 2 sobrecupos ya otorgados ese día, **cuando** intento un tercero, **entonces** el sistema lo impide.
5. **Dado** un sobrecupo autorizado, **cuando** se crea la cita, **entonces** `esSobrecupo=true`, se registra `autorizaSobrecupoBy`, y la cita queda exenta de las restricciones de exclusión pero visible como sobrecupo en la agenda del día.
6. **Dado** una cita en estado `COMPLETED`, **cuando** intento cancelarla o reprogramarla, **entonces** el sistema lo impide.

---

#### US.AGE.2.6 — Check-in y conversión a encuentro

**Como** recepción
**quiero** registrar la llegada del paciente y abrir su encuentro y cuenta
**para** que el médico pueda documentar y los cargos puedan registrarse.

**Criterios de aceptación**

1. **Dado** una cita del día, **cuando** registro el check-in, **entonces** `status='CHECKED_IN'`, se sella `llegadaAt`, se crea `Encounter` con `admissionType` ambulatorio, `establishmentId` y `serviceUnitId` de la agenda, y se vincula en `OutpatientAppointment.encounterId`.
2. **Dado** el check-in, **cuando** se crea el encuentro, **entonces** se crea también `PatientAccount` con `tipoCuentaId` de la cita y número asignado por `fn_next_cuenta`, en estado `ABIERTA`.
3. **Dado** un check-in ya realizado, **cuando** se intenta repetir, **entonces** el sistema es idempotente: no crea un segundo encuentro ni una segunda cuenta.
4. **Dado** un paciente con datos incompletos para admisión, **cuando** hago check-in, **entonces** el sistema exige completarlos antes de crear el encuentro, reutilizando la validación de admisión existente.
5. **Dado** una cita `CHECKED_IN`, **cuando** el médico firma la consulta (`OutpatientConsultation.signedAt`), **entonces** la cita pasa a `COMPLETED` y se sella `finAtencionAt`.
6. **Dado** el encuentro creado desde una cita de un médico afiliado, **cuando** se registran cargos, **entonces** la atribución de producción de US.AFIL.1.6 se dispara con ese afiliado como `TRATANTE`.

---

#### US.AGE.2.7 — No-show automático y tablero del día

**Como** jefatura de consulta externa
**quiero** que las citas no atendidas se marquen solas y ver el estado del día en una pantalla
**para** medir no-show y gestionar el flujo en tiempo real.

**Criterios de aceptación**

1. **Dado** una cita `SCHEDULED`/`CONFIRMED` cuya hora programada pasó en más de 60 minutos sin check-in, **cuando** corre el job, **entonces** pasa a `NO_SHOW` automáticamente y se registra el evento.
2. **Dado** una cita marcada `NO_SHOW` por el job, **cuando** el paciente llega tarde ese mismo día, **entonces** recepción puede revertirla a `CHECKED_IN` con motivo, quedando trazado.
3. **Dado** el tablero del día por sede, **cuando** lo abro, **entonces** veo por consultorio y médico: citas programadas, llegadas, en atención, completadas, no-show y sobrecupos, actualizados en tiempo real.
4. **Dado** el tablero, **cuando** selecciono un consultorio, **entonces** puedo hacer *drilldown* a la lista de pacientes de esa agenda.
5. **Dado** un rango de fechas, **cuando** consulto indicadores, **entonces** obtengo tasa de no-show, tasa de cancelación tardía, ocupación de cupos y tiempo promedio de espera (`llegadaAt` → `inicioAtencionAt`), por médico, consultorio y sede.
6. **Dado** un afiliado, **cuando** se calcula su tablero de rentabilidad (US.AFIL.1.8), **entonces** el % de ocupación de cupos proviene de estos mismos indicadores.

---

## 7. Seguridad — RBAC y ABAC

### 7.1 Recursos y acciones nuevas (`Permission`)

| Recurso | Acciones |
|---|---|
| `consultorio` | leer, crear, editar, desactivar |
| `medico_afiliado` | leer, crear, editar, dar_baja |
| `contrato_arrendamiento` | leer, crear, editar, activar, terminar |
| `contrato_cargo` | leer, generar, publicar_odoo, anular |
| `convenio_honorario` | leer, crear, editar, activar |
| `produccion_medica` | leer, excluir, reprocesar |
| `liquidacion` | leer, generar, aprobar, anular, publicar_odoo |
| `turno` | leer, programar, publicar, sustituir, autorizar_descubierto |
| `agenda` | leer, configurar, publicar, reservar, reprogramar, cancelar, sobrecupo, reservar_suspendida |

### 7.2 Roles nuevos sugeridos

| Rol | Permisos principales |
|---|---|
| `ADMIN_CONSULTORIOS` | consultorio.*, contrato_arrendamiento.*, contrato_cargo:leer/generar |
| `ANALISTA_HONORARIOS` | convenio_honorario.*, produccion_medica.*, liquidacion:leer/generar |
| `GERENTE_FINANCIERO` | liquidacion:aprobar/publicar_odoo, contrato_cargo:publicar_odoo, tableros |
| `JEFE_MEDICO_SEDE` | turno.*, agenda:leer, tablero del día |
| `SECRETARIA_MEDICO_AFILIADO` | agenda:leer/reservar/reprogramar/cancelar (acotado por ABAC) |
| `MEDICO_AFILIADO` | agenda propia, liquidaciones propias, estado de cuenta propio |

### 7.3 Reglas ABAC (`AbacRule`)

1. `SECRETARIA_MEDICO_AFILIADO` y `MEDICO_AFILIADO` solo acceden a registros cuyo `medicoAfiliadoId` coincide con el del contexto del usuario. Condición: `{"medicoAfiliadoId": "$user.medicoAfiliadoId"}`.
2. `JEFE_MEDICO_SEDE` solo programa turnos de los `establishmentId` donde tiene asignación vigente en `UserServiceUnitAssignment`.
3. Ningún rol de afiliado accede a `ProduccionMedica` de otro afiliado, ni siquiera agregada.
4. Las reglas se persisten en `AbacRule` y se evalúan por `evaluarAbac()`/`abacGuard` (CC-0017 F2). Prohibido *hardcodear*.

---

## 8. Requisitos no funcionales

| ID | Requisito |
|---|---|
| NFR-1 | Disponibilidad de agenda: p95 < 300 ms (30 días, un médico). Resolución de médico de turno: p95 < 150 ms. |
| NFR-2 | Tableros: p95 < 1.5 s con 24 meses de historia; se permite vista materializada en `analytics` refrescada por `cron`. |
| NFR-3 | Toda tabla nueva con RLS habilitado y aislamiento por `organizationId`. Sin excepciones. |
| NFR-4 | Toda mutación auditada en `audit."AuditLog"`, con actor, antes y después. |
| NFR-5 | Idempotencia obligatoria en jobs de devengo, no-show y publicación a Odoo. Reintentos seguros. |
| NFR-6 | Zona horaria `America/El_Salvador` en toda la lógica de agenda y turnos; correcto manejo de turnos que cruzan medianoche. |
| NFR-7 | Cumplimiento de Decretos 143/144: los datos de agenda contienen datos personales de paciente; minimización en listados, sin datos clínicos en vistas de secretaría del afiliado. |
| NFR-8 | UI conforme a Avante DS v2.0; interfaz en español (es-SV); accesible por teclado en las pantallas de recepción. |
| NFR-9 | Toda cifra monetaria en `numeric(14,2)` con `currencyId` explícito; sin flotantes. |

---

## 9. Integración con Odoo

| Objeto HIS | `hisType` | Modelo Odoo | Dirección | Disparador |
|---|---|---|---|---|
| `MedicoAfiliado` | `MedicoAfiliado` | `res.partner` | HIS → Odoo | Alta/edición de afiliado con NIT |
| `ContratoCargo` | `ContratoCargo` | `account.move` (cliente) | HIS → Odoo | Devengo mensual aprobado |
| `Liquidacion` | `Liquidacion` | `account.move` (proveedor) | HIS → Odoo | Liquidación `APROBADA` |
| Confirmación de factura | — | `account.move` | Odoo → HIS | Webhook o *polling*; actualiza estado del cargo |

Reglas: toda publicación registra `OdooSyncMapping` (`hisId`, `odooId`, `lastSyncedHash`) y bitácora en `OdooSyncLog`. Si el hash no cambió, no se reenvía. Ningún flujo clínico se bloquea por indisponibilidad de Odoo: el cargo queda `DEVENGADO` y reintenta.

---

## 10. Migraciones y estructura de código

```
sql/239_ext_btree_gist.sql              -- CREATE EXTENSION IF NOT EXISTS btree_gist (prerrequisito de todos los EXCLUDE)
sql/240_afiliado_consultorio.sql        -- Consultorio, MedicoAfiliado, MedicoAfiliadoEspecialidad
sql/241_afiliado_contrato.sql           -- ContratoArrendamiento, ContratoJornada, ContratoCargo, secuencia + fn_next
sql/242_afiliado_honorarios.sql         -- ConvenioHonorario, ReglaHonorario, ProduccionMedica
sql/243_afiliado_liquidacion.sql        -- Liquidacion, LiquidacionCompensacion, secuencia + fn_next
sql/244_turnos.sql                      -- PlantillaTurno, ProgramacionTurno, AsignacionTurno, fn_medico_de_turno
sql/245_agenda_core.sql                 -- AgendaMedico, AgendaHorario, AgendaExcepcion, ListaEspera
sql/246_agenda_appointment_alter.sql    -- ALTER OutpatientAppointment + constraints de exclusión
sql/247_agenda_disponibilidad.sql       -- fn_agenda_disponibilidad
sql/248_rbac_afil_age.sql               -- Permission, Role, RolePermission, RoleCodeAlias, AbacRule
sql/249_jobs_cron.sql                   -- devengo mensual, mora, no-show, control de turno sin cobertura
```

Routers tRPC sugeridos en `packages/trpc/src/routers/`: `consultorio`, `afiliado`, `contrato`, `honorario`, `liquidacion`, `turno`, `agenda`. Resolución de honorarios en `packages/trpc/src/lib/honorario-resolver.ts`, siguiendo el patrón de `coverage-resolver.ts`.

---

## 11. Plan de entrega sugerido

| Sprint | Contenido | Historias |
|---|---|---|
| S1 | Catálogo de consultorios y afiliados | US.AFIL.1.1, US.AFIL.1.2 |
| S2 | Contratos y devengo con Odoo | US.AFIL.1.3, US.AFIL.1.4 |
| S3 | Motor de agenda (configuración y disponibilidad) | US.AGE.2.1, US.AGE.2.2, US.AGE.2.3 |
| S4 | Operación de agenda | US.AGE.2.4, US.AGE.2.5, US.AGE.2.6, US.AGE.2.7 |
| S5 | Turnos 24/7 | US.AFIL.1.9, US.AFIL.1.10, US.AFIL.1.11 |
| S6 | Honorarios y liquidación | US.AFIL.1.5, US.AFIL.1.6, US.AFIL.1.7 |
| S7 | Tableros y cierre | US.AFIL.1.8 + endurecimiento y pruebas de carga |

**Dependencias duras**: S2 antes de S3 (la agenda valida contra la jornada contratada). S4 antes de S6 (la producción nace de cargos que se originan en encuentros creados por check-in). US.AFIL.1.11 depende de US.AFIL.1.10.

---

## 12. Pruebas exigidas

**Unitarias (Vitest)** — cobertura mínima 85% en la lógica de dominio:

- Resolución de regla de honorario por especificidad, con mínimo y máximo.
- Prorrateo de devengo cuando el contrato inicia a mitad de período.
- Compensación de renta en mora sin producir neto negativo.
- Cálculo de disponibilidad con feriado, excepción, extensión y jornada contratada.
- Turno que cruza medianoche y resolución de médico de turno con sustitución.

**Integración (base de datos real)**:

- Restricciones de exclusión: contrato traslapado, cita doble sobre médico, cita doble sobre consultorio, turno traslapado.
- Idempotencia del job de devengo ejecutado dos veces.
- RLS: un usuario de la organización A no lee registros de la organización B en todas las tablas nuevas.

**E2E (Playwright)**:

- Recepción reserva, reprograma y cancela una cita; verifica cupo liberado.
- Check-in genera exactamente un `Encounter` y una `PatientAccount`; segundo check-in no duplica.
- Jefe médico publica rol de turnos con dotación descubierta y el sistema lo bloquea hasta autorización.
- Analista genera liquidación, gerente aprueba, el sistema impide editarla después.
- Secretaría de un afiliado no puede ver la agenda de otro médico (ABAC).

---

## 13. Definición de hecho

Una historia está hecha cuando: migración aplicada e idempotente; RLS activo y probado; permisos registrados y menú derivado de ellos; auditoría verificada; router tRPC con validación de entrada; UI conforme a DS v2.0 en español; pruebas unitarias, de integración y E2E en verde; NFR de latencia medido; y documentación de la entidad en el `COMMENT ON TABLE` citando el ID de la historia.

---

## 14. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Doble fuente de verdad HIS/Odoo en arrendamiento | Alto | Devengo solo en HIS, facturación solo en Odoo, vínculo obligatorio en `OdooSyncMapping` |
| Reglas de honorario mal parametrizadas al inicio | Alto | Reporte de excepciones `SIN_REGLA` obligatorio antes de la primera liquidación real; marcha blanca de un período en paralelo |
| Resistencia del cuerpo médico a agendar en el sistema | Alto | Entregar primero el valor al médico: agenda propia, estado de cuenta y liquidación transparente |
| Turnos sin cobertura por falta de personal | Medio | El sistema no lo oculta: lo bloquea o lo deja trazado con autorización nominal |
| Carga de datos históricos de contratos | Medio | Plantilla de carga masiva validada, con corte contable definido por Gerencia Financiera |

---

## 15. Preguntas abiertas para el negocio

1. ¿La cuota de servicios del consultorio es fija o se escalona por consumo (energía, enfermería de apoyo)?
2. ¿Existe participación diferenciada del hospital sobre insumos y medicamentos usados en el acto del especialista?
3. ¿La compensación renta-honorarios está pactada contractualmente o requiere consentimiento por escrito de cada afiliado?
4. ¿La retención del 10% de renta aplica a todos los afiliados o hay casos de sujetos excluidos por régimen?
5. ¿Los médicos generales de turno perciben algún componente variable por producción que deba modelarse?
