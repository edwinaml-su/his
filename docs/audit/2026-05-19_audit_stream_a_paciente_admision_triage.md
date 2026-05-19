# Auditoría Stream A — Paciente + Admisión + Triage Manchester

**Fecha:** 2026-05-19  
**Auditor:** @AS — Arquitecto de Software, Unidad de Transformación Digital, Inversiones Avante  
**Rama auditada:** `feat/fase2-s1-gate` (commit `6532a92`)  
**Método:** lectura estática de UI + routers tRPC + contratos Zod + schema Prisma + consultas `information_schema` / `pg_policies` / `pg_proc` al proyecto Supabase de producción. Sin modificaciones.  
**Scope:** 3 módulos — Paciente (registro/edición), Admisión hospitalaria (+ bridge ECE), Triage Manchester.

---

## Índice

1. [Flujo 1 — Paciente (registro + edición)](#flujo-1)
2. [Flujo 2 — Admisión hospitalaria + bridge ECE](#flujo-2)
3. [Flujo 3 — Triage Manchester](#flujo-3)
4. [Resumen final Stream A](#resumen-final)

---

## Flujo 1 — Paciente (registro + edición) {#flujo-1}

### 1.1 Resumen ejecutivo

El módulo cubre el Master Patient Index (TDR §8.1): búsqueda, registro mínimo (`/patients/new`), y vista 360° (`/patients/[id]`). Incluye deduplicación MPI con scoring Jaro-Winkler y merge con auditoría transaccional.

**Actores:** Recepcionista, Enfermera, Médico, Administrador MPI.  
**CRUD principal:** CREATE en `/patients/new`, READ en `/patients` y `/patients/[id]`. UPDATE vía `patient.update` (no expuesto en UI directa — solo vía merge). DELETE: soft-delete (`deletedAt`).

El formulario de registro es MVP mínimo: captura 5 campos de los ~25 disponibles en el contrato. Los campos omitidos (segundos nombres, lugar de nacimiento, estado civil, ocupación, nivel educativo, tipo/RH de sangre, género) solo se visualizan en la vista detalle pero no tienen formulario de edición directo. El módulo de identificadores (DUI/NIT/NIE) opera por separado vía `addIdentifier`.

### 1.2 Matriz de trazabilidad

| # | Campo UI | Payload tRPC | Propiedad Zod | Prop ORM Prisma | Columna DB | Tipo UI | Tipo Zod | Tipo Prisma | Tipo SQL | Req UI | NotNull Zod/ORM | NOT NULL DB | Long UI | Long ORM | Long DB | FK/Cat | Val UI | Val Zod | Constraint DB | Observación |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | MRN | `mrn` | `z.string().min(1).max(40)` | `mrn String` | `mrn varchar(40)` | text | string 1-40 | String | varchar(40) | required | YES | YES | — | 40 | 40 | UNIQUE (org,mrn) | — | min 1, max 40 | NOT NULL, UNIQUE | Alineado. |
| 2 | Nombre | `firstName` | `z.string().min(1).max(120)` | `firstName String` | `firstName varchar(120)` | text | string 1-120 | String | varchar(120) | required | YES | YES | — | 120 | 120 | — | — | min 1, max 120 | NOT NULL | Alineado. |
| 3 | Apellido | `lastName` | `z.string().min(1).max(120)` | `lastName String` | `lastName varchar(120)` | text | string 1-120 | String | varchar(120) | required | YES | YES | — | 120 | 120 | — | — | min 1, max 120 | NOT NULL | Alineado. |
| 4 | Segundo apellido | — | `z.string().max(120).optional()` | `secondLastName String?` | `secondLastName varchar(120)` | — | string 0-120 opt | String? | varchar(120) | — | NO | NO | — | 120 | 120 | — | — | optional | NULL | **C1**: visible en vista detalle pero sin campo de edición en `/patients/new`. |
| 5 | Fecha de nacimiento | `birthDate` | `z.coerce.date().optional()` | `birthDate DateTime? @db.Date` | `birthDate date` | date input | Date opt | DateTime? | date | — | NO | NO | — | — | — | — | — | coerce de string ISO | NULL | UI envía `new Date(string)` — zona horaria del browser puede desplazar 1 día. |
| 6 | Sexo biológico | `biologicalSexId` | `z.string().uuid()` | `biologicalSexId String @db.Uuid` | `biologicalSexId uuid` | Select catálogo | uuid | String | uuid | — | YES | YES | — | — | — | BiologicalSex | — | uuid válido | NOT NULL | Alineado. Catálogo seedeado. |
| 7 | Género | — | `genderId uuid optional` | `genderId String?` | `genderId uuid` | — | uuid opt | String? | uuid | — | NO | NO | — | — | — | Gender | — | — | NULL | **C1**: visible en detalle, sin UI de edición/registro. |
| 8 | Estado civil | — | `maritalStatusId uuid optional` | `maritalStatusId String?` | `maritalStatusId uuid` | — | uuid opt | String? | uuid | — | NO | NO | — | — | — | MaritalStatus | — | — | NULL | **C1**: visible en detalle, sin UI de edición/registro. |
| 9 | Tipo de sangre | — | `bloodTypeAbo enum optional` | `bloodTypeAbo String? varchar(3)` | `bloodTypeAbo varchar(3)` | — | enum A/B/AB/O opt | String? | varchar(3) | — | NO | NO | — | 3 | 3 | — | — | enum check Zod | No CHECK constraint DB | **C2/C7**: el enum Zod (A/B/AB/O) no está reforzado por CHECK en DB; cualquier varchar(3) pasa. |
| 10 | RH | — | `bloodRh enum optional` | `bloodRh String? varchar(3)` | `bloodRh varchar(3)` | — | enum +/- opt | String? | varchar(3) | — | NO | NO | — | 3 | 3 | — | — | enum check Zod | No CHECK constraint DB | **C3**: Zod valida '+'/'-' pero DB acepta cualquier varchar(3). |
| 11 | DUI / NIT / NIE | `value` (addIdentifier) | `z.string().min(1).max(80)` + `.refine(validateIdentifier)` | `value String varchar(80)` | `value varchar(80)` | text | string 1-80 + refine | String | varchar(80) | — | YES | YES | — | 80 | 80 | IdentifierType | — | validateIdentifier() | trigger `trg_validate_patient_identifier` → `fn_validate_patient_identifier()` | **C7+**: paridad correcta TS↔SQL (ambos validan DUI/NIT/NIE). Bien. |
| 12 | Identificador `kind` | `kind` | `patientIdentifierKindEnum` | `kind PatientIdentifierKind` | `kind "PatientIdentifierKind"` (enum) | — | enum | Enum | USER-DEFINED | YES | YES | YES | — | — | — | — | — | enum check | Enum DB | Alineado. |
| 13 | `birthDateEstimated` | `birthDateEstimated` | `z.boolean().default(false)` | `birthDateEstimated Boolean @default(false)` | `birthDateEstimated boolean DEFAULT false` | — | boolean | Boolean | boolean | — | YES (default) | YES | — | — | — | — | — | default false | NOT NULL DEFAULT false | Alineado. UI siempre envía `false` — no existe campo para marcarlo. **C1 menor**. |
| 14 | `isUnknown` | `isUnknown` | `z.boolean().default(false)` | `isUnknown Boolean @default(false)` | `isUnknown boolean DEFAULT false` | — | boolean | Boolean | boolean | — | YES (default) | YES | — | — | — | — | — | default false | NOT NULL DEFAULT false | Usado por flujo NN en triage. Correcto. |
| 15 | `mergedIntoId` | — (solo lectura post-merge) | — | `mergedIntoId String?` | `mergedIntoId uuid` | — | — | String? | uuid | — | — | NO | — | — | — | Patient (self) | — | — | NULL | **C2**: columna DB no expuesta en UI (no es un hallazgo activo, solo documentar). |
| 16 | Dirección `line1` | `line1` (addAddress) | `z.string().min(1).max(300)` | `line1 String varchar(300)` | `line1 varchar(300)` | text | string 1-300 | String | varchar(300) | required | YES | YES | — | 300 | 300 | — | — | min 1, max 300 | NOT NULL | Alineado. |
| 17 | Alergias `substanceText` | `substanceText` | `z.string().min(1).max(200)` | `substanceText String varchar(200)` | `substanceText varchar(200)` | text | string 1-200 | String | varchar(200) | required | YES | YES | — | 200 | 200 | — | — | min 1, max 200 | NOT NULL | Alineado. |
| 18 | Alergias `severity` | `severity` | `z.enum(["mild","moderate","severe","life-threatening"])` | `severity String varchar(20)` | `severity varchar(20)` | — | string enum | String | varchar(20) | required | YES | YES | — | 20 | 20 | — | — | enum Zod | No CHECK constraint DB | **C3**: Zod restringe a 4 valores pero DB acepta cualquier varchar(20). No hay trigger ni CHECK. |
| 19 | `active` (paciente) | — | — | `active Boolean @default(true)` | `active boolean DEFAULT true` | — | — | Boolean | boolean | — | YES | YES | — | — | — | — | — | — | NOT NULL | `patient.unmerge` restaura `active=true` correctamente. |
| 20 | `gsrn` | — | — | `gsrn String? @unique @db.Char(18)` | `gsrn varchar(18)` | — | — | String? | varchar(18) | — | — | NO | — | 18 | 18 | — | — | `validateGSRN()` antes de UPDATE | UNIQUE | Asignado automáticamente en `encounter.admit`. |
| 21 | Teléfono `phone` | `phone` | — | `phone String varchar(40)` | `phone varchar(40)` | text | string | String | varchar(40) | — | YES | YES | — | 40 | 40 | — | — | — | NOT NULL | **C7**: sin validación de formato telefónico en Zod ni DB. Acepta cualquier string. |

### 1.3 Hallazgos

#### H1-01 — C1 — Formulario de registro MVP expone solo 5/25 campos capturables (P2 MEDIA)

**Descripción:** `/patients/new` (`page.tsx:24-43`) captura únicamente `mrn`, `firstName`, `lastName`, `biologicalSexId`, `birthDate`. El contrato `patientCreateSchema` define 15 campos adicionales (segundos nombres, lugar de nacimiento, género, estado civil, ocupación, nivel educativo, tipo de sangre, RH, `isUnknown`). La vista 360° en `/patients/[id]` los muestra pero no los edita.  
**Líneas afectadas:** `apps/web/src/app/(clinical)/patients/new/page.tsx:24-43`, `packages/contracts/src/schemas/patient.ts:48-65`.  
**Recomendación:** Agregar sección "Datos adicionales" colapsable en `/patients/new` o una ruta `/patients/[id]/edit`. No bloquea go-live si los datos adicionales son opcionales, pero impide capturar datos demográficos completos requeridos por TDR §8.1.  
**Riesgo go-live:** Medio. La búsqueda por nombre funciona. El módulo clínico depende de sexo biológico (presente). Los reportes estadísticos del MINSAL requieren nivel educativo, ocupación y estado civil.

#### H1-02 — C5 — `biologicalSexId` requerido en Zod/ORM/DB pero no validado como `required` en UI (P1 ALTA)

**Descripción:** El `Select` de sexo biológico en `/patients/new` no tiene atributo `required`. Si el usuario no selecciona sexo (`biologicalSexId = ""`), el DTO envía una cadena vacía que falla la validación UUID de Zod (`z.string().uuid()`), pero el error solo aparece en el banner de tRPC sin feedback visual previo al submit. No hay `required` HTML ni validación client-side previa.  
**Líneas afectadas:** `apps/web/src/app/(clinical)/patients/new/page.tsx:83-97`.  
**Recomendación:** Añadir validación client-side antes del `create.mutate(...)` o usar react-hook-form con resolver Zod que marque el campo visualmente antes del submit.  
**Riesgo go-live:** Alto. Puede generar UX confusa con error de servidor para campo obligatorio.

#### H1-03 — C5 — `birthDate` timezone shift: `new Date(string)` en browser puede desplazar 1 día (P1 ALTA)

**Descripción:** En `/patients/new` el campo de fecha se lee como `form.birthDate` (string ISO "YYYY-MM-DD"), se convierte vía `new Date(form.birthDate)` (`page.tsx:39`) y se envía al servidor. `z.coerce.date()` en el servidor hace otra conversión. El problema: `new Date("1990-03-15")` en un browser UTC-6 (America/El_Salvador) produce `1990-03-14T18:00:00Z`, que al guardarse como `@db.Date` resulta en `1990-03-14`, un día antes de lo ingresado.  
**Líneas afectadas:** `apps/web/src/app/(clinical)/patients/new/page.tsx:39`, `packages/contracts/src/schemas/patient.ts:55`.  
**Recomendación:** Enviar la fecha como string ISO sin conversión a Date en el cliente, o añadir `T12:00:00` al string antes de construir el Date. En el servidor, parsear con `parseISO` de date-fns antes de `z.coerce.date`. Esto es un problema clásico documentado en el TDR §8.1.  
**Riesgo go-live:** Alto. Fechas de nacimiento incorrectas afectan cálculos de edad, elegibilidad de protocolos pediátricos y documentos oficiales (certificados).

#### H1-04 — C3/C7 — `bloodTypeAbo` y `bloodRh`: enum Zod sin CHECK constraint en DB (P2 MEDIA)

**Descripción:** `patientCreateSchema` define `bloodTypeAbo: z.enum(["A","B","AB","O"])` y `bloodRh: z.enum(["+","-"])`. La columna DB es `varchar(3)` sin CHECK constraint ni tipo enum Postgres. Si se inserta directamente (seed, migración, otra herramienta) se puede persisitir un valor inválido (ej. "X+").  
**Líneas afectadas:** `packages/contracts/src/schemas/patient.ts:62-63`, schema Prisma líneas 994-995, columnas confirmadas por `information_schema`.  
**Recomendación:** Crear enum Postgres `BloodTypeAbo` ('A','B','AB','O') y `BloodRh` ('+','-') y migrar las columnas, o agregar un CHECK constraint: `CHECK ("bloodTypeAbo" IN ('A','B','AB','O'))`.  
**Riesgo go-live:** Medio. Solo el router Zod protege la integridad; acceso directo a BD puede insertar basura.

#### H1-05 — C7 — Teléfono `phone` sin validación de formato en ninguna capa (P2 MEDIA)

**Descripción:** `PatientPhone.phone varchar(40)` en DB, campo en Zod `patientAddressSchema` no tiene schema para teléfono (es un tipo distinto). No existe validación de formato E.164 ni patrón salvadoreño (8 dígitos) en Zod, UI, ni DB. Se acepta cualquier string de hasta 40 chars.  
**Líneas afectadas:** `packages/database/prisma/schema.prisma:1227`, `packages/contracts/src/schemas/patient.ts:40-46` (dirección) — no existe schema de teléfono en contracts.  
**Recomendación:** Agregar a `patientPhoneSchema` (que aún no existe en `packages/contracts/src/schemas/patient.ts`) una validación `z.string().regex(/^\+?[0-9\s\-]{7,20}$/)` y un `maxLength` de 20 (suficiente para E.164 + espacios).  
**Riesgo go-live:** Bajo. No bloquea flujos clínicos, pero impide limpieza automática y generación de reportes telefónicos.

#### H1-06 — C12 — `patient.search` y `patient.get` NO usan `withTenantContext` — RLS no aplica (P0 CRITICA)

**Descripción:** Los procedures `patient.search`, `patient.get`, `patient.create`, `patient.update`, `patient.mergePatients`, `patient.unmerge`, `patient.findDuplicates` usan `ctx.prisma` directo sin `withTenantContext`. El rol Supabase (`postgres.<ref>`) tiene `BYPASSRLS`, por lo que **las políticas RLS (`tenant_isolation_select`, `patient_soft_delete`) no aplican** en producción. El filtro `where: { organizationId: ctx.tenant.organizationId }` en aplicación es la única barrera.  
**Líneas afectadas:** `packages/trpc/src/routers/patient.router.ts:166-546` (ninguna llamada a `withTenantContext`).  
**Contexto:** `rls-context.ts:16-25` explica que esto es intencional en MVP Sprint 1, con plan para Fase 2+. El contexto CLAUDE.md lo identifica como "defensa débil".  
**Recomendación:** Migrar los procedures de lectura de datos de pacientes (`search`, `get`, `findDuplicates`) a `withTenantContext`. Los procedures de escritura ya aplican `where: { organizationId }` explícito, pero aún se beneficiarían de la defensa en profundidad. Prioridad máxima antes de go-live con múltiples tenants.  
**Riesgo go-live:** Crítico en entorno multi-tenant. Un bug en el filtro `organizationId` expone datos de todos los pacientes. En entorno single-tenant es aceptable temporalmente.

#### H1-07 — C11 — `nextEncounterNumber` duplicado entre `encounter.router.ts` y `triage.router.ts` (P2 MEDIA)

**Descripción:** La función `nextEncounterNumber` está copiada literalmente en `packages/trpc/src/routers/encounter.router.ts:39-55` y `packages/trpc/src/routers/triage.router.ts:27-37`, con un comentario que reconoce la duplicación. Bajo concurrencia alta, ambas copias tienen la misma race condition en el contador (documentada en `encounter.router.ts:30-36`).  
**Líneas afectadas:** `encounter.router.ts:39-55`, `triage.router.ts:27-37`.  
**Recomendación:** Extraer a un módulo compartido `packages/trpc/src/lib/encounter-number.ts` y usar un contador Postgres con `SELECT ... FOR UPDATE` o una `SEQUENCE` dedicada.  
**Riesgo go-live:** Medio. En volumen bajo (admisiones < 100/día) la colisión es improbable, pero en picos (accidentes masivos) puede ocurrir.

#### H1-08 — C12 — `patient.unmerge` no restaura FK reasignadas — inconsistencia documentada pero sin compensación (P1 ALTA)

**Descripción:** `patient.unmerge` restaura el `deletedAt=null` del paciente "from" pero **no restaura** los encuentros, triages, alergias, etc. que se reasignaron al "to" durante el merge. El código lo reconoce (`TODO Sprint 3`). La audit_log captura la operación pero el estado de datos queda inconsistente: el paciente restaurado aparece sin historial clínico.  
**Líneas afectadas:** `packages/trpc/src/routers/patient.router.ts:504-544`.  
**Recomendación:** Antes de go-live, implementar snapshot completo en `PatientMerge.snapshotJson` y restauración transaccional, o deshabilitar el botón unmerge en la UI hasta que Sprint 3 lo implemente.  
**Riesgo go-live:** Alto. Un unmerge operacional deja al paciente restaurado sin historial, lo que puede causar duplicidad de atenciones o pérdida de continuidad asistencial.

---

## Flujo 2 — Admisión hospitalaria + bridge ECE {#flujo-2}

### 2.1 Resumen ejecutivo

El wizard de admisión (`/admission`) implementa 4 pasos: selección de paciente, tipo de admisión + datos administrativos, asignación de cama, confirmación. El router `encounter.admit` crea el `Encounter` y opcionalmente asigna cama (`BedAssignment`). La pantalla de confirmación (`/admission/[id]/confirm`) gestiona el GSRN para la pulsera de identificación. El bridge ECE (`bridge-admision.router.ts`) no existe en el directorio auditado.

**Actores:** Recepcionista, Enfermera de Admisión, Administrador.  
**CRUD principal:** CREATE `Encounter` vía `encounter.admit`; READ en `/admission/[id]/confirm`.

### 2.2 Matriz de trazabilidad

| # | Campo UI | Payload tRPC | Propiedad Zod | Prop ORM Prisma | Columna DB | Tipo UI | Tipo Zod | Tipo Prisma | Tipo SQL | Req UI | NotNull Zod/ORM | NOT NULL DB | Long UI | Long ORM | Long DB | FK/Cat | Val UI | Val Zod | Constraint DB | Observación |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Paciente | `patientId` | `z.string().uuid()` | `patientId String @db.Uuid` | `patientId uuid` | búsqueda | uuid | String | uuid | required | YES | YES | — | — | — | Patient | selección UI | uuid válido | NOT NULL + FK | Alineado. |
| 2 | Tipo de admisión | `admissionType` | `admissionTypeEnum` | `admissionType AdmissionType` | `admissionType "AdmissionType"` | Select | enum 5 valores | Enum | USER-DEFINED | required | YES | YES | — | — | — | — | — | enum check | NOT NULL enum | Alineado. |
| 3 | Servicio | `serviceUnitId` | `z.string().uuid().optional()` | `serviceUnitId String?` | `serviceUnitId uuid` | Select | uuid opt | String? | uuid | — | NO | NO | — | — | — | ServiceUnit | — | uuid opt | NULL | **C5**: UI permite pasar sin servicio para EMERGENCY. No hay validación que lo requiera en SCHEDULED; el servidor solo lo exige para cama. |
| 4 | Moneda | `currencyId` | `z.string().uuid()` | `currencyId String @db.Uuid` | `currencyId uuid` | Select | uuid | String | uuid | req (auto-default) | YES | YES | — | — | — | Currency | auto-selección primera | uuid | NOT NULL | Auto-elegida vía `useEffect`. Alineado. |
| 5 | Cama | `bedId` | `z.string().uuid().optional()` | BedAssignment separado | BedAssignment tabla | Select | uuid opt | String? | uuid | req si SCHEDULED | NO | NO | — | — | — | Bed | — | uuid opt | NULL (en schema Encounter no existe bedId) | Alineado: cama en tabla `BedAssignment`. |
| 6 | Motivo de consulta | `chiefComplaint` | `z.string().max(500).optional()` | NO EXISTE en `Encounter` | — | text input | string opt | — | — | — | NO | — | — | — | — | — | max 500 | Sin columna DB | **C1 P1**: campo capturado en UI y contrato pero **no persistido** en BD. Comentario en código: `TODO Sprint 4`. |
| 7 | Acompañante | `accompanyingPersonName` | `z.string().max(200).optional()` | NO EXISTE en `Encounter` | — | text input | string opt | — | — | — | NO | — | — | — | — | — | max 200 | Sin columna DB | **C1 P1**: ídem. No persistido. |
| 8 | Valuables | `valuables` | `z.array(z.string()).max(20).optional()` | NO EXISTE en `Encounter` | — | text (CSV) | string[] opt | — | — | — | NO | — | — | — | — | — | max 20 items | Sin columna DB | **C1 P1**: ídem. No persistido. UI envía CSV de texto plano; contrato espera `string[]`. |
| 9 | Referencia | `isReferral` + `referralOrigin` | `z.boolean()` + `z.string().max(200)` | NO EXISTE en `Encounter` | — | checkbox + input | bool + string opt | — | — | — | NO | — | — | — | — | — | — | Sin columna DB | **C1 P1**: ídem. |
| 10 | Número de encuentro | — (generado server) | — | `encounterNumber String varchar(40)` | `encounterNumber varchar(40)` | display | — | String | varchar(40) | — | YES | YES | — | 40 | 40 | UNIQUE (org) | — | — | NOT NULL, UNIQUE | Generado en servidor (race condition documentada — ver H1-07). |
| 11 | `admittedAt` | `admittedAt` | `z.coerce.date().optional()` | `admittedAt DateTime @db.Timestamptz()` | `admittedAt timestamptz` | — (default now) | date opt | DateTime | timestamptz | — | NO | YES | — | — | — | — | — | coerce | NOT NULL | Default `new Date()` si no se pasa. Alineado. |
| 12 | `exchangeRateToFunc` | — (hardcoded `1`) | — | `exchangeRateToFunc Decimal @db.Decimal(18,8)` | `exchangeRateToFunc numeric(18,8)` | — | — | Decimal | numeric(18,8) | — | — | YES | — | — | — | — | — | — | NOT NULL | **C8**: siempre se escribe `1`. No lee tabla `ExchangeRate`. `TODO Sprint 2` en código. |
| 13 | `patientTypeId` | `patientTypeId` | `z.string().uuid().optional()` | `patientTypeId String?` | `patientTypeId uuid` | — | uuid opt | String? | uuid | — | NO | NO | — | — | — | PatientType | — | — | NULL | **C1**: UI no expone este campo en el wizard. Se envía `undefined`. |
| 14 | `patientCategoryId` | `patientCategoryId` | `z.string().uuid().optional()` | `patientCategoryId String?` | `patientCategoryId uuid` | — | uuid opt | String? | uuid | — | NO | NO | — | — | — | PatientCategory | — | — | NULL | **C1**: ídem. |
| 15 | GSRN (pulsera) | `patientId` (assign) | — | `gsrn String? @unique @db.Char(18)` | `gsrn varchar(18)` | display + botones | — | String? | varchar(18) | — | NO | NO | 18 | 18 | 18 | — | — | `validateGSRN()` | UNIQUE | Asignación en TX separada post-admit (ver H2-04). |
| 16 | Cama `status` | — | — | `status BedStatus` | `status "BedStatus"` | — | — | Enum | USER-DEFINED | — | — | YES | — | — | — | — | — | — | NOT NULL | `admit` verifica `status='FREE'` antes de asignar. Correcto. |
| 17 | `dischargeType` | `dischargeType` | `dischargeTypeEnum` | `dischargeType DischargeType?` | `dischargeType "DischargeType"` | — | enum opt | Enum? | USER-DEFINED | — | NO | NO | — | — | — | — | — | enum check | NULL enum | Alineado. Se escribe en `discharge`. |
| 18 | `Encounter.status` lógico | — | — | (NO existe columna) | — | Badge "Abierto" | — | — | — | — | — | — | — | — | — | — | — | `dischargedAt IS NULL` | **C11**: la UI muestra Badge "Abierto" hardcodeado. El estado real se infiere de `dischargedAt IS NULL`. Correcto por diseño, pero sin cálculo explícito. |

### 2.3 Hallazgos

#### H2-01 — C1 — `chiefComplaint`, `accompanyingPersonName`, `valuables`, `isReferral/referralOrigin` capturados en UI y contrato pero no persisten en DB (P1 ALTA)

**Descripción:** El wizard captura 4 grupos de campos clínicamente relevantes que viajan hasta el contrato Zod y el router, pero **no existe columna** correspondiente en `Encounter` (confirmado por `information_schema`). El código lo documenta explícitamente como `TODO Sprint 4`.  
**Líneas afectadas:** `apps/web/src/app/(clinical)/admission/admission-form.tsx:57-58` (comentario), `packages/contracts/src/schemas/encounter.ts:27-48`, `packages/trpc/src/routers/encounter.router.ts:175-193` (datos ignorados al crear Encounter).  
**Recomendación:** Antes de go-live, o bien (a) agregar las columnas a `Encounter` en la próxima migración SQL, o (b) deshabilitar visualmente los campos y mostrar "Disponible en Sprint 4" para no generar la expectativa de que se guardan.  
**Riesgo go-live:** Alto. Un recepcionista que registre acompañante o pertenencias asume que quedó guardado. Si el paciente es trasladado y alguien consulta el encuentro, la información no está.

#### H2-02 — C8 — `exchangeRateToFunc` siempre hardcodeado a `1` sin consultar `ExchangeRate` (P2 MEDIA)

**Descripción:** `encounter.router.ts:189` escribe `exchangeRateToFunc: 1` siempre. El schema `ExchangeRate` existe en la BD (confirmado en schema Prisma) pero no se consulta. Para organizaciones en El Salvador (USD funcional) esto es correcto, pero en expansión multi-país el tipo de cambio erróneo afecta todos los cálculos financieros del encuentro.  
**Líneas afectadas:** `packages/trpc/src/routers/encounter.router.ts:189`.  
**Recomendación:** Implementar `resolveExchangeRate(orgId, currencyId)` que consulte `ExchangeRate` por par de monedas y fecha. Igual que resolvió `resolveCountryCurrency` en `triage.router.ts`.  
**Riesgo go-live:** Medio para El Salvador (USD/USD = 1 siempre). Alto para expansión a Guatemala (GTQ).

#### H2-03 — C2 — Bridge ECE Admisión (`bridge-admision.router.ts`) referenciado pero no encontrado en árbol (P1 ALTA)

**Descripción:** El directorio de routers tRPC esperado para el bridge ECE de admisión (`packages/trpc/src/routers/bridge-admision.router.ts`) no existe en el worktree auditado (la búsqueda retornó error "File does not exist"). El flujo ECE de admisión hospitalaria (`ece.hoja_ingreso`, `ece.EceHojaIngreso`) queda sin bridge activo. El CLAUDE.md referencia `bridge-admision` como parte de los bridges PR #93.  
**Líneas afectadas:** worktree `agent-a0e92edece7239d0f` — ausencia de `packages/trpc/src/routers/bridge-admision.router.ts`.  
**Recomendación:** Verificar que el archivo exista en la rama `main` (puede ser que el worktree aislado no lo haya incluido). Si no existe, priorizar implementación antes de go-live para mantener sincronía HIS↔ECE en admisiones.  
**Riesgo go-live:** Alto si ECE activo. Los encuentros admitidos por HIS no quedarán reflejados en `ece.EceHojaIngreso`, rompiendo la continuidad del expediente clínico electrónico.

#### H2-04 — C12 — GSRN asignado en TX separada post-admit: falla silenciosa sin notificación al usuario (P2 MEDIA)

**Descripción:** En `encounter.router.ts:214-252`, la asignación del GSRN se realiza en una segunda transacción (`withTenantContext`) llamada con `.catch(() => {})` que silencia cualquier error. Si falla (red, constraint UNIQUE, org sin `gs1CompanyPrefix`), el encuentro queda creado sin GSRN y la UI de confirmación muestra el botón "Asignar GSRN" como fallback. Correcto como resiliencia, pero el `console.warn` de línea 234-237 no llega a Sentry/observabilidad.  
**Líneas afectadas:** `packages/trpc/src/routers/encounter.router.ts:210-252`.  
**Recomendación:** Reemplazar el `.catch(() => {})` por un `.catch((err) => logger.error({...err, context: 'GSRN_ASSIGNMENT'}))` para trazabilidad operacional. El fallback UI ya maneja correctamente el caso.  
**Riesgo go-live:** Bajo funcional, medio operacional. Sin logging, un fallo sistemático de GSRN pasa desapercibido.

#### H2-05 — C5 — `/admission/[id]/confirm` carga todos los encuentros abiertos para encontrar uno (P2 MEDIA)

**Descripción:** `apps/web/src/app/(clinical)/admission/[id]/confirm/page.tsx:19-23` llama `trpc.encounter.listOpenByOrg.useQuery({ page:1, pageSize:100 })` y luego hace `.find((e) => e.id === id)` en memoria. En organizaciones con >100 encuentros abiertos simultáneos, el encuentro buscado puede no estar en la primera página y la UI muestra "Encuentro no encontrado".  
**Líneas afectadas:** `apps/web/src/app/(clinical)/admission/[id]/confirm/page.tsx:19-23`.  
**Recomendación:** Agregar `encounter.getById` endpoint o filtrar por `id` directamente: `listOpenByOrg({ query: enc.encounterNumber })`.  
**Riesgo go-live:** Medio en hospitales con alta rotación de emergencias.

#### H2-06 — C6 — Idempotencia de admisión busca encuentro abierto por `patientId` sin límite de `admissionType` (P2 MEDIA)

**Descripción:** `encounter.router.ts:122-131` busca `existingOpen` filtrando `patientId` y `dischargedAt: null`, sin filtrar por `admissionType`. Si un paciente tiene un encuentro EMERGENCY abierto y se intenta admitir como SCHEDULED, el servidor devuelve el EMERGENCY existente en lugar de crear el SCHEDULED. La idempotencia cubre el caso de doble-clic pero no el de cambio de tipo.  
**Líneas afectadas:** `packages/trpc/src/routers/encounter.router.ts:122-131`.  
**Recomendación:** Añadir `admissionType: input.admissionType` al `where` de `existingOpen`, o bien devolver el encuentro existente con un flag `alreadyOpen: true` para que la UI advierta al recepcionista.  
**Riesgo go-live:** Medio. Puede causar confusión clínica si admisión programada queda registrada como emergencia.

---

## Flujo 3 — Triage Manchester {#flujo-3}

### 3.1 Resumen ejecutivo

El módulo cubre el ciclo completo de triage Manchester: recepción rápida (EXISTING_PATIENT / NN), captura de signos vitales con alertas en tiempo real, selección de flujograma, discriminadores y asignación de nivel. Incluye dashboard de cola y configuración admin. El router `triage.quickIntake` crea automáticamente un Encounter EMERGENCY si no existe.

**Actores:** Triagista (rol `TRIAGIST`), Enfermera.  
**CRUD principal:** CREATE `TriageEvaluation` + CREATE `TriageVitalSign` + CREATE `TriageDiscriminatorHit`.

### 3.2 Matriz de trazabilidad

| # | Campo UI | Payload tRPC | Propiedad Zod | Prop ORM Prisma | Columna DB | Tipo UI | Tipo Zod | Tipo Prisma | Tipo SQL | Req UI | NotNull Zod/ORM | NOT NULL DB | Long UI | Long ORM | Long DB | FK/Cat | Val UI | Val Zod | Constraint DB | Observación |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Paciente (modo EXISTING) | `patientId` | `z.string().uuid()` | `patientId String @db.Uuid` | `patientId uuid` | búsqueda | uuid | String | uuid | required | YES | YES | — | — | — | Patient | selección lista | uuid | NOT NULL | Alineado. |
| 2 | Edad estimada (NN) | `estimatedAge` | `z.number().int().min(0).max(130)` | usada en cálculo `birthDate` | — | number input | int 0-130 opt | — | — | — | NO | — | 0..130 | — | — | — | min 0, max 130 | — | **C8**: se convierte a `birthDate = (year - age)-01-01`. Sin columna propia para edad estimada; se pierde la distinción "edad estimada/exacta" a nivel de atributo explícito (solo `birthDateEstimated=true`). |
| 3 | Sexo NN | `sexAtBirthId` | `z.string().uuid()` | `biologicalSexId String` | `biologicalSexId uuid` | Select catálogo | uuid | String | uuid | required (NN) | YES | YES | — | — | — | BiologicalSex | — | uuid | NOT NULL | Alineado. |
| 4 | Descripción NN | `description` | `z.string().min(2).max(100)` | guarda en `lastName` | `lastName varchar(120)` | text input | string 2-100 | String | varchar(120) | required (NN) | YES | YES | maxLength=100 | 100 | 120 | — | — | min 2, max 100 | NOT NULL | **C4 menor**: descripción de 100 chars guarda en campo `lastName` de 120 — holgura de 20 chars sin efecto negativo. Semánticamente cuestionable pero funcional. |
| 5 | MRN del NN | (generado) `NN-yyyyMMdd-HHmmss` | — | `mrn String varchar(40)` | `mrn varchar(40)` | — | — | String | varchar(40) | — | YES | YES | 40 | 40 | 40 | UNIQUE (org) | — | formato hardcoded | NOT NULL, UNIQUE | **C4**: `NN-20261215-143022` = 19 chars. Dentro de 40. Alineado. |
| 6 | Signos vitales `vitalCode` | `vitalCode` | `triageVitalCodeEnum` (9 valores) | `vitalCode String varchar(40)` | `vitalCode varchar(40)` | FIELDS array (7 inputs) | enum estricto | String | varchar(40) | — | YES | YES | — | 40 | 40 | — | — | enum Zod | No CHECK DB | **C3**: `TriageVitalSign.vitalCode` es `varchar(40)` sin restricción de enum en DB. El enum solo existe en Zod. Inserciones directas pueden usar códigos arbitrarios. Además, **UI expone solo 7 de 9 códigos** definidos en el enum (faltan `GCS` y `PAIN` como inputs numéricos — tienen controles especiales, pero el `FIELDS` array no los incluye línea 39-47). |
| 7 | `valueNumeric` | `valueNumeric` | `z.number().finite().nullable()` + rango | `valueNumeric Decimal? @db.Decimal(10,3)` | `valueNumeric numeric` (sin precisión en IS) | number input | number fin opt | Decimal? | numeric | — | NO | NO | — | Decimal(10,3) | numeric | — | — | rango VITAL_REASONABLE_RANGES | No CHECK DB | **C3**: Prisma usa `Decimal(10,3)`, Zod usa `number` JS (float64). Para valores como `310.123456` la base trunca a `310.123`. Esto es correcto clínicamente pero no está documentado. |
| 8 | `unit` vital | `unit` | `z.string().max(20).optional()` | `unit String? varchar(20)` | `unit varchar(20)` | — (inferido de FIELDS) | string opt | String? | varchar(20) | — | NO | NO | — | 20 | 20 | — | — | — | NULL | **C11**: la UI infiere la unidad del array `FIELDS` local. Si el código es GCS o PAIN, usa cadena vacía (`""`). El servidor usa `VITAL_REASONABLE_RANGES[code].unit` como default si `unit` no viene. Lógica duplicada — dos fuentes de unidades. |
| 9 | `takenAt` | `takenAt` | `z.coerce.date().optional()` | `measuredAt DateTime @db.Timestamptz()` | `measuredAt timestamptz` | — | date opt | DateTime | timestamptz | — | — | YES | — | — | — | — | — | coerce | NOT NULL DEFAULT now() | **C10**: payload se llama `takenAt` (Zod/UI) pero la columna DB y prop Prisma se llama `measuredAt`. No es un bug (el mapper en el router es explícito) pero introduce confusión en naming. |
| 10 | Flowchart (discriminadores) | `flowchartId` | `z.string().uuid()` | `flowchartId String @db.Uuid` | `flowchartId uuid` | — (inferido por `quickIntake`) | uuid | String | uuid | required | YES | YES | — | — | — | TriageFlowchart | — | uuid | NOT NULL | `quickIntake` toma el primer flowchart activo por nombre. No hay UI de selección en el flujo rápido. |
| 11 | `assignedLevelId` (placeholder) | `assignedLevelId` | `z.string().uuid()` | `assignedLevelId String @db.Uuid` | `assignedLevelId uuid` | — (placeholder BLUE) | uuid | String | uuid | required | YES | YES | — | — | — | TriageLevel | — | uuid | NOT NULL | **C12**: se asigna nivel placeholder `priority=5 (BLUE)` en `quickIntake`. Debe sobreescribirse en US-6.4 (discriminadores). Si el usuario abandona sin completar discriminadores, el triage queda en `IN_PROGRESS` con nivel BLUE. |
| 12 | `overrideJustification` | `overrideJustification` | `z.string().max(2000).optional()` | `overrideJustification String? @db.Text` | `overrideJustification text` | — | string opt | String? | text | — | NO | NO | — | text | text | — | — | max 2000 | NULL | **C4**: Zod limita a 2000 chars, DB es `text` (ilimitado). Inconsistencia menor a favor de DB. |
| 13 | Discriminador `positive` | `positive` | `z.boolean()` | `positive Boolean` | `positive boolean` | radio POSITIVE/NEGATIVE | boolean | Boolean | boolean | required | YES | YES | — | — | — | — | — | — | NOT NULL | Alineado. |
| 14 | Discriminador `notes` | `notes` | `z.string().max(400).optional()` | `notes String? @db.VarChar(400)` | `notes varchar(400)` | — | string opt | String? | varchar(400) | — | NO | NO | — | 400 | 400 | — | — | — | NULL | Alineado. |
| 15 | `status` evaluación | — | — | `status TriageStatus @default(IN_PROGRESS)` | `status "TriageStatus" DEFAULT 'IN_PROGRESS'` | — | — | Enum | USER-DEFINED | — | YES | YES | — | — | — | — | — | — | NOT NULL | Correcto: `createEvaluation` lo fuerza a `COMPLETED`; `quickIntake` a `IN_PROGRESS`. |
| 16 | `triagistUserId` | — (de `ctx.user.id`) | — | `triagistUserId String?` | `triagistUserId uuid` | — | — | String? | uuid | — | — | NO | — | — | — | User | — | — | NULL | No FK a `User` en schema Prisma (columna UUID nullable sin FK declarada). **C6**. |
| 17 | `reTriageOfId` | — | — | `reTriageOfId String?` | `reTriageOfId uuid` | — | — | String? | uuid | — | — | NO | — | — | — | TriageEvaluation | — | — | NULL | Self-FK correctamente declarada. UI no expone re-triage todavía. |
| 18 | `triage.setAssignedLevel` | `assignedLevelId` | — | — | — | botón "Confirmar nivel" | — | — | — | — | — | — | — | — | — | — | — | — | **C1 P0**: el procedure `triage.setAssignedLevel` referenciado en `discriminator-list.tsx:98` NO existe en el router. La UI lo castea con `trpc as unknown as TrpcWithFlowchart` y lo trata como opcional (`setLevel?.mutate`). Si no está registrado, "Confirmar nivel" solo navega sin persistir el nivel final. |

### 3.3 Hallazgos

#### H3-01 — C1 — `triage.setAssignedLevel` no existe en el router: nivel de triage no se persiste (P0 CRITICA)

**Descripción:** `apps/web/src/app/(clinical)/triage/[id]/discriminators/discriminator-list.tsx:98` accede a `trpcAny.triage.setAssignedLevel?.useMutation(...)`. Este procedure **no está definido** en `packages/trpc/src/routers/triage.router.ts`. El código degrada silenciosamente al navegar sin llamar al servidor. El nivel asignado por discriminadores nunca se escribe en `TriageEvaluation.assignedLevelId` — solo queda el placeholder BLUE asignado en `quickIntake`.  
**Líneas afectadas:** `apps/web/src/app/(clinical)/triage/[id]/discriminators/discriminator-list.tsx:98-240`, `packages/trpc/src/routers/triage.router.ts` (ausencia de endpoint `setAssignedLevel`).  
**Recomendación:** Implementar `triage.setAssignedLevel` como `tenantProcedure` que reciba `triageEvaluationId + assignedLevelId + overrideJustification?`, valide que la evaluación sea `IN_PROGRESS` y pertenezca al tenant, actualice `assignedLevelId + status='COMPLETED' + completedAt`, y persista los `TriageDiscriminatorHit` del array de respuestas.  
**Riesgo go-live:** Crítico. Todos los triages Manchester completados por discriminadores quedan con nivel BLUE (no urgente), lo que anula el protocolo de priorización clínica.

#### H3-02 — C3 — `TriageVitalSign.vitalCode` es `varchar(40)` sin enum DB: cualquier código pasa (P2 MEDIA)

**Descripción:** El enum `triageVitalCodeEnum` con 9 valores definidos en Zod no tiene correspondencia en DB (confirmado por `information_schema`: `vitalCode varchar(40)`). Inserciones directas, scripts de seed o futuros routers que no usen el schema Zod pueden insertar códigos arbitrarios (`"SYS_BP"`, `"PULSE"`, etc.) que la UI no renderiza y las alertas clínicas no evalúan.  
**Líneas afectadas:** `packages/database/prisma/schema.prisma:1630`, `packages/contracts/src/schemas/triage.ts:9-19`.  
**Recomendación:** Crear enum Postgres `TriageVitalCode` con los 9 valores y migrar la columna, O agregar CHECK constraint: `CHECK ("vitalCode" IN ('BP_SYS','BP_DIA','HR','RR','TEMP','SPO2','GCS','PAIN','GLUCOSE'))`.  
**Riesgo go-live:** Medio. Solo el path Zod protege. Sin DB constraint, datos corruptos pueden entrar por herramientas de administración.

#### H3-03 — C12 — Evaluación queda en `IN_PROGRESS` con nivel BLUE si usuario abandona flujo (P1 ALTA)

**Descripción:** `triage.quickIntake` crea `TriageEvaluation` con `status=IN_PROGRESS` y `assignedLevelId` = nivel BLUE (placeholder). Si el triagista abandona sin completar vitales y discriminadores, la evaluación permanece abierta indefinidamente. No existe timeout, GC de evaluaciones huérfanas, ni alerta en el dashboard de cola.  
**Líneas afectadas:** `packages/trpc/src/routers/triage.router.ts:314-336`.  
**Recomendación:** Implementar job de expiración (Postgres `pg_cron` o worker) que cancele evaluaciones `IN_PROGRESS` con `startedAt > 2h`. Agregar indicador visual en `triage/dashboard` de evaluaciones estancadas.  
**Riesgo go-live:** Alto. En emergencia masiva, múltiples evaluaciones huérfanas saturan la cola de triage y enmascaran pacientes no atendidos.

#### H3-04 — C10 — Naming inconsistente: `takenAt` (Zod) vs `measuredAt` (Prisma/DB) (P3 BAJA)

**Descripción:** El input `recordVitalsInputSchema.vitals[].takenAt` (Zod) se mapea a `measuredAt` en el servidor (`triage.router.ts:367-369`). No es un bug funcional pero viola el principio de naming uniforme entre capas (Vernon, *Implementing DDD*, cap. 9 — ubiquitous language).  
**Líneas afectadas:** `packages/contracts/src/schemas/triage.ts:57`, `packages/trpc/src/routers/triage.router.ts:367-369`.  
**Recomendación:** Renombrar `takenAt` a `measuredAt` en el contrato Zod para alinearlo con ORM y DB.  
**Riesgo go-live:** Bajo. No impacta funcionalidad.

#### H3-05 — C6 — `triagistUserId` sin FK declarada a ninguna tabla de usuarios (P2 MEDIA)

**Descripción:** `TriageEvaluation.triagistUserId String?` tiene el tipo UUID pero no hay FK declarada en Prisma ni en la BD (`information_schema` no muestra FOREIGN KEY a `User` o `AuthUser`). Se escribe `ctx.user.id` pero si el usuario es eliminado el UUID queda huérfano sin integridad referencial.  
**Líneas afectadas:** `packages/database/prisma/schema.prisma:1600`.  
**Recomendación:** Agregar relación Prisma `triagist User? @relation(...)` o documentar explícitamente que es una referencia blanda al sistema de auth externo (Supabase Auth) que no puede tener FK a `public`.  
**Riesgo go-live:** Bajo. Solo afecta consultas de auditoría que intenten hacer JOIN.

#### H3-06 — C1 — UI de vitales expone 7 de 9 códigos; GCS y PAIN tienen controles ad-hoc sin enviar `unit` (P2 MEDIA)

**Descripción:** El array `FIELDS` en `vitals-form.tsx:39-47` define 7 códigos. GCS se captura con `<Select>` (línea 128-142) y PAIN con `<input type="range">` (línea 149-164), pero ambos no están en `FIELDS`, por lo que la lógica de resolución de `unit` para ellos en `onSubmit` produce cadena vacía (`""`) (`vitals-form.tsx:83`). En Zod, `unit` es opcional; en DB es nullable. Correcto funcionalmente pero la documentación de la unidad de GCS y PAIN queda vacía en BD.  
**Líneas afectadas:** `apps/web/src/app/(clinical)/triage/[id]/vitals/vitals-form.tsx:39-47, 78-88`.  
**Recomendación:** Agregar GCS y PAIN a `FIELDS` con sus units vacíos (`""`) para uniformizar el path de `unit`, o manejarlos explícitamente en `onSubmit`.  
**Riesgo go-live:** Bajo. GCS y PAIN se capturan y envían correctamente; la unidad vacía es cosmética.

#### H3-07 — C12 — `triage.quickIntake` para NN crea paciente sin `withTenantContext` — RLS bypass (P0 CRITICA)

**Descripción:** La creación del paciente NN en `triage.router.ts:241-258` usa `ctx.prisma.patient.create(...)` directamente, sin `withTenantContext`. Idéntico al H1-06 pero en el flujo de triage. El audit trigger (`trg_audit_Patient`) corre correctamente (BYPASSRLS no afecta los triggers AFTER), pero RLS no valida el tenant en escritura porque el rol tiene BYPASSRLS.  
**Líneas afectadas:** `packages/trpc/src/routers/triage.router.ts:241-258`.  
**Recomendación:** Envolver la creación del paciente NN y del Encounter en `withTenantContext`. Mismo patrón que `encounter.admit`.  
**Riesgo go-live:** Crítico en multi-tenant, por la misma razón que H1-06.

---

## Resumen final Stream A {#resumen-final}

### Tabla consolidada: hallazgos por categoría × módulo × severidad

| ID | Módulo | Categoría | Severidad | Descripción corta |
|---|---|---|---|---|
| H1-01 | Paciente | C1 | P2 MEDIA | Formulario registro captura solo 5/25 campos |
| H1-02 | Paciente | C5 | P1 ALTA | `biologicalSexId` requerido sin validación UI previa |
| H1-03 | Paciente | C5 | P1 ALTA | `birthDate` timezone shift en browser UTC-6 |
| H1-04 | Paciente | C3/C7 | P2 MEDIA | `bloodTypeAbo/bloodRh` enum sin CHECK DB |
| H1-05 | Paciente | C7 | P2 MEDIA | Teléfono sin validación de formato en ninguna capa |
| H1-06 | Paciente | C12 | P0 CRITICA | RLS bypass en todos los procedures patient (sin `withTenantContext`) |
| H1-07 | Paciente/Admisión | C11 | P2 MEDIA | `nextEncounterNumber` duplicado + race condition |
| H1-08 | Paciente | C12 | P1 ALTA | `unmerge` no restaura FKs — inconsistencia de datos post-reverso |
| H2-01 | Admisión | C1 | P1 ALTA | 4 campos UI no persisten en DB (chiefComplaint, acompañante, valuables, referencia) |
| H2-02 | Admisión | C8 | P2 MEDIA | `exchangeRateToFunc` siempre `1`, no consulta tabla ExchangeRate |
| H2-03 | Admisión | C2 | P1 ALTA | Bridge ECE admisión (`bridge-admision.router.ts`) no encontrado en worktree |
| H2-04 | Admisión | C12 | P2 MEDIA | Error GSRN silenciado sin logging a observabilidad |
| H2-05 | Admisión | C5 | P2 MEDIA | Confirm page carga hasta 100 encuentros para buscar uno por id |
| H2-06 | Admisión | C6 | P2 MEDIA | Idempotencia de admisión no filtra por `admissionType` |
| H3-01 | Triage | C1 | P0 CRITICA | `triage.setAssignedLevel` no existe: nivel discriminador nunca persiste |
| H3-02 | Triage | C3 | P2 MEDIA | `vitalCode` varchar sin enum/CHECK DB |
| H3-03 | Triage | C12 | P1 ALTA | Evaluación queda `IN_PROGRESS` indefinida si usuario abandona |
| H3-04 | Triage | C10 | P3 BAJA | `takenAt` vs `measuredAt` naming inconsistente |
| H3-05 | Triage | C6 | P2 MEDIA | `triagistUserId` sin FK declarada |
| H3-06 | Triage | C1 | P2 MEDIA | GCS/PAIN fuera de array FIELDS, `unit` vacío en BD |
| H3-07 | Triage | C12 | P0 CRITICA | RLS bypass en creación de paciente NN en triage |

### Conteo por severidad

| Severidad | Paciente | Admisión | Triage | Total |
|---|---|---|---|---|
| P0 CRITICA | 1 (H1-06) | 0 | 2 (H3-01, H3-07) | **3** |
| P1 ALTA | 3 (H1-02, H1-03, H1-08) | 2 (H2-01, H2-03) | 1 (H3-03) | **6** |
| P2 MEDIA | 4 (H1-01, H1-04, H1-05, H1-07) | 3 (H2-02, H2-04, H2-05, H2-06) | 3 (H3-02, H3-05, H3-06) | **10** |
| P3 BAJA | 0 | 0 | 1 (H3-04) | **1** |
| **Total** | **8** | **6** | **7** | **21** |

### Top-5 riesgos para Go-Live

1. **H3-01 (P0)** — `triage.setAssignedLevel` inexistente. Todos los triages quedan en nivel BLUE. El protocolo Manchester queda sin efecto clínico real. **Bloqueante de go-live.**

2. **H1-06 + H3-07 (P0)** — RLS bypass en routers de Paciente y Triage. En entorno multi-tenant, un bug de filtro `organizationId` expone toda la BD de pacientes. En entorno single-tenant (go-live Complejo Avante) el riesgo es menor pero la defensa en profundidad es un requisito del TDR §5.5. **Bloqueante si se activa segundo tenant antes de corrección.**

3. **H1-03 (P1)** — Timezone shift en fechas de nacimiento. Pacientes nacidos en diciembre/enero pueden tener fecha registrada con 1 día de desvío, afectando protocolos pediátricos, cálculos de edad y documentos oficiales. **Bloqueante para corrección antes de ingreso de datos reales.**

4. **H2-01 (P1)** — `chiefComplaint`, acompañante, pertenencias y datos de referencia no persisten. Los recepcionistas asumirán que se guardan. Riesgo operacional y legal (pertenencias del paciente). **Bloqueante operacional — requiere o persistencia o UI explícita de "no guardado".**

5. **H3-03 (P1)** — Evaluaciones `IN_PROGRESS` huérfanas saturan la cola de triage en emergencia masiva. Sin mecanismo de expiración, la cola se vuelve inutilizable. **Bloqueante para contextos de alto volumen.**

### Recomendaciones priorizadas

| Prioridad | Acción | Módulo afectado | Estimación |
|---|---|---|---|
| 1 | Implementar `triage.setAssignedLevel` con persistencia de discriminatorHits y transición a `COMPLETED` | Triage | 4h @Dev |
| 2 | Envolver `patient.*` y `triage.quickIntake` en `withTenantContext` (al menos `search`, `get`, `create`, NN path) | Paciente + Triage | 3h @Dev |
| 3 | Corregir timezone en `birthDate`: enviar string ISO, parsear en servidor sin conversión browser | Paciente + Triage NN | 1h @Dev |
| 4 | Agregar columnas `chiefComplaint`, `accompanyingPersonName`, `valuables JSON`, `isReferral`, `referralOrigin` a `Encounter` y persistirlas, o deshabilitar campos UI con mensaje explícito | Admisión | 2h @Dev + 1h @DBA (migración SQL) |
| 5 | Agregar timeout/GC de evaluaciones `IN_PROGRESS` > 2h en `pg_cron` o worker | Triage | 2h @DBA + 1h @Dev |
| 6 | Verificar/implementar `bridge-admision.router.ts` si ECE activo en go-live | Admisión | revisar @Dev |
| 7 | Agregar CHECK constraints DB para `bloodTypeAbo`, `bloodRh`, `PatientAllergy.severity`, y enum Postgres para `TriageVitalSign.vitalCode` | Todos | 1h @DBA (SQL) |
| 8 | Implementar snapshot completo en unmerge o deshabilitar en UI hasta Sprint 3 | Paciente | 1h @Dev |
| 9 | Unificar `nextEncounterNumber` en módulo compartido con `SELECT FOR UPDATE` | Paciente/Admisión | 2h @Dev |
| 10 | Reemplazar `.catch(() => {})` GSRN por logging estructurado | Admisión | 30min @Dev |

---

*Fin del reporte de auditoría Stream A.*  
*Generado por @AS — Arquitecto de Software, Inversiones Avante / 2026-05-19.*
