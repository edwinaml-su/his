# FICHA_IDENT — Ficha de Identificación de Paciente

## Metadata

- **codigo**: FICHA_IDENT
- **nombre**: Ficha de Identificación de Paciente
- **modalidad**: TODAS (creada al registro inicial — ambulatorio, hospitalario, emergencia, hospital de día, telesalud)
- **NTEC artículo**: Art. 31 (Acuerdo MINSAL 1616) — *nota de paridad: en `TDR_HIS_Multipais.md`, `docs/blueprints/ece_his_bridge.md`, `packages/database/sql/58_ece_03_paciente.sql` y el backlog Fase 2 (`05_epic_ece_ambulatorio.md` US.F2.3.1) este documento se referencia consistentemente como **Art. 15** del mismo Acuerdo. La discrepancia con la solicitud (Art. 31) se documenta aquí; aplica Art. 11–15 NTEC para identificación y deduplicación, Art. 14 lit. g para unificación, Art. 42 para rectificación, Art. 55–56 para metadatos obligatorios y bitácora.*
- **modulo_his_target**: `/patients` (admin/clinical, MPI legacy) + extensión NTEC en `ece.paciente` vía bridge — **NO crear `/ece/ficha-identificacion/` como ruta paralela**; el legacy ya cubre el dominio y el bridge `eceBridgePatient` (Stream 22) sincroniza la capa documental NTEC (regla "adecuar legacy vs duplicar", CLAUDE.md §Adecuar legacy)
- **tabla_datos**: `ece.paciente` (registro DOCUMENTAL NTEC, schema `ece`) + bridge ACL `public_patient_id` UUID NULLABLE → `public."Patient"` (MPI, golden record) + tablas auxiliares `ece.identificador_paciente`, `ece.responsable_paciente`, `ece.afiliacion_isss` + `public.PatientIdentifier`, `public.PatientAddress`, `public.PatientPhone`, `public.PatientEmergencyContact`, `public.PatientAllergy`
- **inmutable**: false (actualizable, pero historizada — `audit.audit_log` con hash chain SHA-256 inmutable a 10 años, Art. 42 NTEC rectificación trazable; `numero_expediente` y `nui` sí son inmutables una vez asignados — Art. 14 lit. g)
- **tipo_registro**: OBLIGATORIO único por paciente y establecimiento (`UNIQUE(establecimiento_id, numero_expediente)`) — **MAESTRO** (Art. 4.14 NTEC); deduplicación BLOQUEANTE por NUI o DUI dentro del mismo establecimiento vía trigger `ece.fn_check_dedup_nui_dui()`

---

## Propósito normativo

Art. 15 NTEC (Acuerdo n.° 1616 MINSAL, D.O. T.444 n.°158, 22/08/2024; reforma D.O. n.°55 T.450 19/03/2026) estandariza el **conjunto mínimo de variables de identificación** que toda Ficha del Expediente Clínico Electrónico debe portar. Este documento es la **raíz del expediente médico único por usuario** (Ley SNIS Arts. 24–26) y el ancla legal de toda producción documental posterior del paciente.

Sin Ficha de Identificación válida y vigente, ningún otro documento clínico NTEC (historia clínica, hoja de triaje, indicaciones, epicrisis, defunción) puede crearse — el ECE bloquea con "El paciente requiere ficha de identificación (Art. 15 NTEC) antes del ingreso" (`docs/backlog/fase2/06_epic_ece_hospitalario.md` línea 215).

**Razones legales que la hacen indispensable:**

1. **Identificación inequívoca del titular del expediente** (Art. 11–12 NTEC): el `numero_expediente` es único por establecimiento e inmutable; prohibido duplicar (Art. 14 lit. g — si ocurre, se unifica).
2. **Cumplimiento del expediente único nacional** (Ley SNIS Art. 25): el `NUI` (Número Único de Identidad RNPN) permite consolidar el expediente del usuario entre prestadores públicos.
3. **Derechohabiencia ISSS** (Art. 15 lit. d): habilita servicios institucionales y emisión de certificados de incapacidad.
4. **Trazabilidad del responsable de captura** (Art. 15 lit. j): `responsable_toma_datos uuid` + `fecha_hora_creacion timestamptz` graban quién y cuándo. Sin firma como acto único — la integridad la da el audit hash chain.
5. **Derechos ARCO** (Ley de Protección de Datos Personales Arts. 9 y 18): el paciente puede solicitar acceso, rectificación, cancelación y oposición sobre estos datos.

---

## Dependencias

**Ninguna.** Es el documento raíz del expediente.

- En MINSAL, para recién nacidos de parto hospitalario se habilita **automáticamente** desde el flujo obstétrico (creación de Ficha del recién nacido al cierre del parto, con CUN si está disponible y vínculo `motherPatientId` al expediente de la madre — `Patient.motherPatientId` ya modelado en `packages/database/prisma/schema.prisma:998`).
- En registro retrospectivo (papel migrado): puede crearse `ece.paciente` con `public_patient_id NULL` mientras se hace el matching MPI a posteriori (Opción B documentada en `docs/blueprints/ece_his_bridge.md`).

---

## Obligatoriedad

**SIEMPRE**, primer documento al registrar paciente en cualquier modalidad (ambulatoria presencial, ambulatoria telesalud, hospitalaria, hospital de día, emergencia). Es **bloqueante** para la atención clínica formal — la única excepción documentada es el flujo de emergencia con paciente desconocido/inconsciente, que crea la Ficha en modo `tipo_registro_identidad = 'desconocido'` o `'sin_documento'` con `numero_expediente` provisional prefijo "DESC-" (US.F2.3.4).

---

## Roles firmantes

| Rol | Acción | Momento |
|---|---|---|
| ARCH (Archivo Clínico / ESDOMED) | Captura datos demográficos completos y genera `numero_expediente` | Registro inicial en ventanilla de admisión |
| ADM / AC (Admisión / Atención al Cliente) | Verificación de derechohabiencia ISSS (`numero_afiliado`, `tipo_derechohabiente`, `numero_patronal`) | Mismo evento de registro o al primer contacto institucional |
| PACIENTE (titular) o RESPONSABLE LEGAL (menor/incapaz) | Declara datos personales y firma autorización de tratamiento de datos (cruza con `/consents` admin) | Registro inicial; cada vez que cambie un responsable se historiza con `vigente = false` en el registro anterior |
| MT / MC (Médico de turno / cabecera) | Validación clínica inicial — completa alergias conocidas, grupo sanguíneo declarado, antecedentes relevantes; firma electrónica simple del médico en la primera consulta | Primera consulta o ingreso hospitalario |
| DIR (Dirección del establecimiento) | Autoriza la unificación cuando se detecta expediente duplicado (Art. 14 lit. g) | Solo en flujo de unificación |

**Importante:** la Ficha de Identificación **no se firma como acto único** (a diferencia de un consentimiento o una epicrisis). La integridad jurídica del registro se sostiene por:

- `responsable_toma_datos uuid` (FK a `public."User"`) — quien capturó.
- `fecha_hora_creacion timestamptz` (Art. 55–56 metadatos obligatorios).
- Trigger `audit.audit_log` con `prev_hash` / `payload_hash` / `chain_hash` SHA-256 sobre cada INSERT/UPDATE.

---

## Campos obligatorios NTEC

Conjunto mínimo Art. 15 NTEC, mapeado a la implementación actual:

### Identificadores nacionales (Art. 15 lit. a)

- **NUI** (Número Único de Identidad RNPN) — `ece.paciente.nui text CHECK (nui ~ '^[A-Z0-9]{20}$')`. Obligatorio salvo `tipo_registro_identidad IN ('sin_documento', 'desconocido')`.
- **DUI** — `ece.paciente.dui text CHECK (dui ~ '^\d{8}-\d$')`. Paridad TS↔SQL del check digit en `packages/contracts/src/validators/index.ts` ↔ `packages/database/sql/03_validations_sv.sql` (función `fn_validate_patient_identifier` + trigger `trg_validate_patient_identifier`).
- **CUN** (Código Único de Nacimiento) — `ece.paciente.cun text` — neonatos antes de tener DUI.
- **Carnet de minoridad** — `ece.paciente.carnet_minoridad text` — menores de 18 sin DUI.
- **Pasaporte** — `ece.paciente.pasaporte text` — extranjeros.
- **Tipo de registro de identidad** — `ece.paciente.tipo_registro_identidad text NOT NULL DEFAULT 'verificado' CHECK (... IN ('verificado','version_paciente','version_responsable','sin_documento','desconocido'))`.

### Datos del paciente (Art. 15 lit. b)

- **Nombre completo** — `public.Patient.firstName`, `middleName?`, `lastName`, `secondLastName?`, `preferredName?` (varchar(120) cada uno).
- **Fecha de nacimiento** — `public.Patient.birthDate Date` + `birthDateEstimated Boolean` para casos sin certeza.
- **Sexo biológico** — `public.Patient.biologicalSexId uuid` (FK catálogo `BiologicalSex`, requerido NTEC).
- **Género (autopercibido)** — `public.Patient.genderId uuid?` (FK catálogo `Gender`, opcional, separado del sexo biológico por TDR §8.1).
- **Estado civil / familiar** — `public.Patient.maritalStatusId uuid?` (FK `MaritalStatus`) o `ece.paciente.estado_familiar text` (soltero, casado, acompañado, divorciado, viudo).
- **Nacionalidad** — `ece.paciente.nacionalidad text` (texto libre) + `public.Patient.birthPlaceGeoId uuid?` (FK a `GeoDivision`).
- **Ocupación** — `public.Patient.occupationId uuid?` (FK `Occupation`) y/o `ece.paciente.ocupacion text` (texto libre).
- **Domicilio actual** — `public.PatientAddress` (1:N, multivalor 4NF) con `line1`, `line2?`, `postalCode?`, `geoDivisionId`, `isPrimary`, `validFrom`, `validTo?`. La Ficha también almacena `ece.paciente.direccion text` como snapshot declarado en esta visita.
- **Teléfono** — `public.PatientPhone` (1:N) con `phone varchar(40)`, `kind` (móvil/casa/trabajo), `isPrimary`. Snapshot en `ece.paciente.telefono`.
- **Correo electrónico** — `public.PatientEmail` (1:N, opcional).

### Responsable / familiar (Art. 15 lit. c)

- **Tabla auxiliar 1:N** — `ece.responsable_paciente` con `nombre`, `parentesco` (madre/padre/tutor/cónyuge/otro), `documento`, `telefono`, `vigente boolean`, `registrado_en timestamptz`.
- También `public.PatientEmergencyContact` (1:N) en el lado MPI: `fullName`, `relationship`, `phone?`, `email?`, `priority`.
- Para **menores de 18**: el responsable legal con sus datos completos es obligatorio.

### Derechohabiencia ISSS (Art. 15 lit. d)

- `ece.afiliacion_isss` (1:1 con `ece.paciente`, UNIQUE sobre `paciente_id`): `numero_afiliado`, `tipo_derechohabiente CHECK IN ('cotizante','beneficiario','pensionado')`, `numero_patronal?`, `vigente`, `verificado_en`.

### Datos clínicos básicos (Art. 15 lit. e–f)

- **Grupo sanguíneo + RH** — `public.Patient.bloodTypeAbo varchar(3)` (`A`/`B`/`AB`/`O`) + `public.Patient.bloodRh varchar(3)` (`+`/`-`). El enum Zod está enforced en `patientCreateSchema`; la columna DB no tiene CHECK constraint (drift documentado, ver §"Drift conocido").
- **Alergias conocidas** — `public.PatientAllergy` (1:N) con `substanceText varchar(200)`, `severity` (mild/moderate/severe/life-threatening), `reactionDescription?`, `verifiedAt?`, `verifiedById?`.
- **Antecedentes relevantes** — capturados en módulos contiguos (`apps/web/src/app/(clinical)/patients/[id]/history/personal.tsx`, `familial.tsx`, `gyneco.tsx`, `pediatric.tsx`). La Ficha referencia su existencia, no los duplica.

### Identificación física opcional

- **Foto del paciente** — recomendada por NTEC y TDR §8.3, no obligatoria. Almacenamiento: bucket Supabase Storage privado, URL firmada por TTL corto (no se persiste el binario en BD).
- **Huella digital** — opcional Art. 15. TDR §8.3 línea 460 menciona "Captura biométrica opcional (huella, foto)" en flujo de admisión. No implementada actualmente en HIS (gap).
- **Pulsera GSRN** — `public.GsrnHistory` (1:N por paciente, una sola fila `ACTIVE`) con `gsrn char(18)` AI(8018) GS1. Asignada automáticamente al confirmar admisión hospitalaria (US.F2.6.1, F2-S7). Inmutable una vez emitida; revocable con `motivoRevocacion`.

### Metadatos obligatorios (Art. 55–56 NTEC)

- `responsable_toma_datos uuid` (FK `public."User"`) — usuario ARCH/ADM que captura.
- `fecha_hora_creacion timestamptz DEFAULT now()` — timestamp con segundos.
- `establecimiento_id uuid NOT NULL` (FK `public."Establishment"`) — Art. 15 lit. j.
- `organizationId uuid` (en `public.Patient`) — institución/red propietaria.
- Bitácora de modificaciones inmutable en `audit.audit_log` (hash chain SHA-256), conservación ≥ 2 años obligatoria NTEC; el HIS aplica 10 años por TDR §6.3.

### Identificador interno HIS

- `numero_expediente text NOT NULL UNIQUE(establecimiento_id, numero_expediente)` — Art. 11 NTEC. Patrón configurable por establecimiento (`public."Establishment".patron_num_expediente`, definido en `56_ece_01_catalogos.sql:73`). Función generadora prevista `ece.gen_numero_expediente()` (referenciada en backlog US.F2.3.1).
- `public.Patient.mrn varchar(40)` — Medical Record Number del MPI, único por `organizationId`.

---

## Estados

`ACTIVO` — es expediente vivo. No se firma como acto único; solo se actualiza.

Modelados en dos columnas independientes:

| Columna | Valores | Significado |
|---|---|---|
| `estado_expediente` | `activo`, `pasivo` | Activo = registros continuos. Pasivo = sin registro en los últimos 5 años (Art. 4.15/4.16 y Art. 34 NTEC). |
| `estado_registro` | `vigente`, `rectificado`, `unificado` | Vigente = en uso. Rectificado = corregido con trazabilidad (Art. 42). Unificado = absorbido por `expediente_maestro_id` (Art. 14 lit. g). |
| `fallecido` | `boolean` | Marca de defunción; no impide consulta histórica del expediente. |

Constraints:

- `CHECK (estado_registro <> 'unificado' OR expediente_maestro_id IS NOT NULL)` — un expediente unificado debe apuntar a su maestro.
- `CHECK (expediente_maestro_id <> id)` — no autorreferencial.

---

## Transiciones

**N/A** — la Ficha de Identificación es expediente vivo. No tiene máquina de estados de aprobación. Las únicas transiciones formales son:

1. `vigente → rectificado` (Art. 42 NTEC) — el campo modificado, su valor anterior y el nuevo, junto con `usuario` y `timestamp`, quedan en `audit.audit_log`. El registro continúa siendo consultable.
2. `vigente → unificado` (Art. 14 lit. g NTEC) — cuando se detecta duplicado, ARCH ejecuta el flujo de unificación: el expediente absorbido pasa a `estado_registro = 'unificado'` y se fija `expediente_maestro_id`, las FK clínicas (Encounter, TriageEvaluation, PatientAllergy, etc.) se reasignan al maestro. Audit log captura snapshot completo (`PatientMerge.snapshotJson`).
3. `activo → pasivo` — proceso automático batch tras 5 años sin actividad clínica registrada. Reversible al primer nuevo registro.

**Campos inmutables** una vez asignados:

- `numero_expediente` — Art. 14 lit. g, UI lo presenta solo lectura.
- `nui` — solo modificable por flujo de rectificación con auditoría.

Todas las demás actualizaciones (dirección, teléfono, estado familiar, responsable) son **operaciones de UPDATE normales** con captura en `audit.audit_log` (diff campo→valor_anterior→valor_nuevo).

---

## Eventos

Patrón outbox transaccional (`packages/database/src/outbox/emit.ts`, payloads validados por discriminated union en `packages/contracts/src/events/payloads.ts`):

- `ficha_ident.creada` — INSERT en `ece.paciente`. Payload: `{ ecePacienteId, publicPatientId, establecimientoId, organizationId, numeroExpediente, tipoRegistroIdentidad, registradoPorId, creadoEn }`.
- `ficha_ident.actualizada` — UPDATE con `{ ecePacienteId, organizationId, fieldsUpdated[], previousValues, newValues, modificadoPorId, modificadoEn }`. Por NTEC Art. 42 debe registrar campo + valor anterior + valor nuevo.
- `ficha_ident.unificada` — emitida al ejecutar Art. 14 lit. g, con `{ expedienteAbsorbidoId, expedienteMaestroId, snapshotJson, unificadoPorId, unificadoEn, motivo }`.
- `ficha_ident.rectificada` — emitida al cambiar `estado_registro` a `'rectificado'`, con `{ ecePacienteId, fieldsRectified[], rectificadoPorId, rectificadoEn, justificacion }`.

Eventos del bridge ECE↔HIS (ya implementados, `docs/blueprints/ece_his_bridge.md`):

- `ece.paciente.linked` — al vincular `ece.paciente.public_patient_id` con un `public.Patient` existente.
- `ece.paciente.synced` — sincronización bidireccional con `direction: "fromHis" | "toHis"` y `fieldsUpdated[]`.

Todos los eventos persisten en `DomainEvent` dentro de la misma transacción del INSERT/UPDATE (outbox atómico, Beta.15).

---

## Drift conocido (audit)

Hallazgos de `docs/audit/2026-05-19_audit_stream_a_paciente_admision_triage.md` Flujo 1 (Paciente):

- **H1-01 (P2 MEDIA)** — Formulario `/patients/new` solo captura 5 de los ~25 campos del contrato `patientCreateSchema`. Los datos NTEC adicionales (segundo nombre, lugar de nacimiento, género, estado civil, ocupación, nivel educativo, tipo de sangre, RH) se visualizan en la vista 360° pero **no tienen UI de edición/registro directo**. Estado: bloquea cobertura NTEC Art. 15. Recomendación: agregar sección "Datos adicionales" colapsable en `/patients/new` o ruta `/patients/[id]/edit`.
- **H1-02 (P1 ALTA)** — `biologicalSexId` requerido en Zod/ORM/DB pero no validado como `required` en el `<Select>` UI; al fallar genera error de servidor sin feedback visual previo.
- **H1-03 (P1 ALTA)** — Bug de zona horaria en `birthDate`: `new Date("1990-03-15")` en browser UTC-6 (America/El_Salvador) produce `1990-03-14T18:00:00Z`, que al guardarse como `@db.Date` resulta en `1990-03-14`, un día antes del valor ingresado. Afecta cálculos de edad, elegibilidad pediátrica y certificados.
- **H1-04 (P2 MEDIA)** — `bloodTypeAbo` y `bloodRh` tienen enum Zod (`A/B/AB/O`, `+/-`) pero la columna DB es `varchar(3)` sin CHECK constraint ni tipo enum Postgres. INSERT directo por seed/herramienta externa puede persistir valores inválidos.
- **H1-05 (P2 MEDIA)** — Teléfono `PatientPhone.phone` sin validación de formato (E.164 ni patrón salvadoreño 8 dígitos) en Zod ni UI ni DB.
- **H1-06 (P0 CRITICA)** — Todos los procedures `patient.*` (`search`, `get`, `create`, `update`, `mergePatients`, `unmerge`, `findDuplicates`) usan `ctx.prisma` directo **sin `withTenantContext`**. El rol Supabase `postgres.<ref>` tiene `BYPASSRLS`, por lo que las políticas RLS (`tenant_isolation_select`, `patient_soft_delete`) **no aplican en producción**. El filtro `where: { organizationId }` en aplicación es la única barrera. Bloqueante en entorno multi-tenant.
- **H1-08 (P1 ALTA)** — `patient.unmerge` restaura `deletedAt=null` pero **no restaura las FK reasignadas** (encounters, triages, alergias). El código lo reconoce (`TODO Sprint 3`). El paciente restaurado queda sin historial clínico — riesgo de duplicidad y pérdida de continuidad asistencial.

Drift normativo de nomenclatura: el TDR, los blueprints, el SQL y el backlog identifican consistentemente este documento como **Art. 15** del Acuerdo 1616. La metadata del presente fichero registra "Art. 31" tal como fue solicitada — aclaración explícita en §Metadata para mantener integridad documental sin perder rastreabilidad con la fuente primaria.

---

## Descripción markdown rica

### El documento raíz del expediente

La Ficha de Identificación es la **piedra angular del Expediente Clínico Electrónico NTEC**. No es un acto clínico — es la matrícula legal del paciente en el sistema. Sin Ficha vigente, ningún acto médico documental puede vincularse al paciente correcto. Por eso el ECE la trata como **registro MAESTRO**: una sola por paciente y establecimiento, deduplicación bloqueante, número de expediente inmutable, y unificación documentada cuando un duplicado ocurre.

**No se firma como acto único.** A diferencia de un consentimiento informado (acto discreto con doble firma paciente+médico) o una epicrisis (firma del médico al alta), la Ficha es un **registro vivo**: se crea una vez, se actualiza muchas, y la integridad jurídica la sostiene el audit hash chain (SHA-256 encadenado) — no una firma electrónica simple sobre el documento completo. La firma puntual aplica al **acto de captura** (`responsable_toma_datos` + `fecha_hora_creacion`) y al **acto de actualización** (cada UPDATE deja huella en `audit.audit_log` con usuario, timestamp y diff campo→valor).

### Validación TS↔SQL de DUI / NIE / NIT

`validateDUI`, `validateNIE` y `validateNIT` viven en `packages/contracts/src/validators/index.ts` (TypeScript, ejecución en cliente y servidor tRPC) y **deben mantener paridad estricta** con `packages/database/sql/03_validations_sv.sql` (PL/pgSQL, ejecución en trigger BEFORE INSERT/UPDATE sobre `public."PatientIdentifier"`).

El algoritmo de check digit del DUI (`^\d{8}-\d$`) está duplicado intencionalmente:

- **Capa Zod (tRPC):** rechazo temprano con mensaje de UI en español es-SV.
- **Capa DB (trigger):** defensa en profundidad — si alguien inserta directo (seed, herramienta externa, MCP), el trigger aborta la transacción.

Tests fixture-based en `packages/contracts/src/validators/__tests__/dui.test.ts` cubren válidos e inválidos. **Si modificas el algoritmo en un lado, actualizas el otro en el mismo PR** (CLAUDE.md regla explícita).

El **NUI** (RNPN, 20 caracteres alfanuméricos mayúsculas) se valida en DB con `CHECK (nui ~ '^[A-Z0-9]{20}$')` y debería tener una validación TS paralela en `validators/` (gap menor — el contrato Zod actual solo restringe longitud).

### Grupo sanguíneo obligatorio Art. 15

El **tipo de sangre + RH** son campos NTEC del conjunto mínimo. Se modelan en el MPI (`public.Patient.bloodTypeAbo`, `bloodRh`) y no en `ece.paciente` para evitar duplicación. El audit H1-04 marca el gap: el enum Zod no está reforzado por CHECK constraint en DB. Recomendación pendiente: crear enums Postgres `BloodTypeAbo` (`A`,`B`,`AB`,`O`) y `BloodRh` (`+`,`-`) y migrar.

En MVP están como opcionales en el formulario; clínicamente, el grupo sanguíneo se confirma con prueba de laboratorio antes de transfusión (módulo Banco de Sangre tiene su propia validación con `TransfusionRequest`).

### Foto del paciente — recomendada, no obligatoria

NTEC permite foto en la Ficha; TDR §8.3 línea 460 la lista como captura biométrica **opcional** junto con huella digital. El HIS aún no implementa upload de foto en el formulario `/patients/new` (gap menor). Diseño previsto: bucket Supabase Storage privado por organización, URL firmada con TTL de 5 minutos, ruta `patients/{patientId}/photo.jpg`, máximo 2 MB, conversión a WebP, sin almacenar EXIF (privacy by design).

### Bridge ECE↔HIS — por qué dos tablas

El HIS pre-existente usa `public.Patient` como **MPI (Master Patient Index)** — el golden record demográfico. El Acuerdo 1616 exige `ece.paciente` como **registro documental NTEC** con campos específicos (NUI, CUN, número de expediente por establecimiento, derechohabiencia ISSS, responsable, etc.).

Decisión de arquitectura (Opción B, `docs/blueprints/ece_his_bridge.md`): **NO duplicar datos demográficos**. `ece.paciente.public_patient_id UUID NULLABLE` actúa como ACL (Application Control Link) al MPI. Los datos demográficos base (`firstName`, `lastName`, `birthDate`, `biologicalSexId`) viven solo en `public.Patient`; `ece.paciente` solo persiste lo que NTEC requiere y MPI no tiene (NUI, CUN, número de expediente, estado familiar declarado en visita, dirección/teléfono snapshot de captura, derechohabiencia).

El bridge `eceBridgePatient` (router tRPC, `requireRole(["ARCH","ADM","DIR"])`) expone:

- `linkPatient(ecePacienteId, publicPatientId)` — vincula una Ficha ECE existente a un Patient HIS existente.
- `unlinkPatient(ecePacienteId)` — SET NULL sobre la ACL.
- `syncFromHis(publicPatientId, ecePacienteId?)` — crea/actualiza `ece.paciente` desde Patient HIS.
- `syncToHis(ecePacienteId)` — actualiza Patient HIS desde Ficha ECE.
- `listLinkedPatients(cursor, limit)` — paginado.

Los procedures validan **consistencia de identificadores**: si HIS y ECE tienen el mismo tipo (DUI/NIE) con valores distintos, lanzan `BAD_REQUEST` con mensaje explícito. Todos emiten outbox (`ece.paciente.linked`, `ece.paciente.synced` con `direction` y `fieldsUpdated[]`).

### Por qué NO crear `/ece/ficha-identificacion/` como ruta paralela

Aplicación literal de la regla "adecuar legacy vs duplicar" (CLAUDE.md §Adecuar legacy):

1. **El dominio ya está cubierto** por `/patients` (admin y clinical) — formulario `/patients/new`, vista 360° `/patients/[id]`, deduplicación MPI con scoring Jaro-Winkler, merge con auditoría, módulos contiguos para alergias / vacunas / consentimientos / historial personal-familiar-pediátrico-gineco.
2. **Lo que NTEC requiere y el legacy no cubre** se inyecta al legacy (campos colapsables en `/patients/new`, sección "Identificadores NTEC" en `/patients/[id]`, sub-página `/patients/[id]/afiliacion-isss`) y se persiste en `ece.paciente` mediante el bridge.
3. **Sidebar:** un solo item "Pacientes" — no aparece "Ficha NTEC" como ruta separada. Si el día de mañana hay un documento NTEC formal sin equivalente legacy (e.g. epicrisis NTEC estructurada, defunción CIE-10 con campos extra), entonces sí justifica `/ece/<X>`.

**Precedente positivo:** `/ece/triaje` fue eliminado en PR #101 porque duplicaba `/triage` legacy. El bridge `eceBridgeTriage` ya sincroniza con `ece.hoja_triaje`. Misma filosofía aplica aquí.

### Cobertura normativa actual y plan

Métrica del backlog (`docs/backlog/fase2/01_ae_impacto_normativo.md:211`): cobertura NTEC = variables obligatorias presentes / total requeridas por Art. 15–17. Estado actual 0% formal (no se mide aún en producción), meta ≥ 98% en expedientes cerrados, auditoría trimestral interna. El gap H1-01 (5/25 campos en UI de captura) es el bloqueante principal para alcanzar la meta.

User Stories del epic Fase 2 que cubren este documento (`docs/backlog/fase2/05_epic_ece_ambulatorio.md`):

- US.F2.3.1 (8 SP, Must) — Crear ficha de identificación para paciente nuevo.
- US.F2.3.2 (5 SP, Must) — Buscar y recuperar expediente por NUI/DUI/nombre (trigram GIN).
- US.F2.3.3 (3 SP, Must) — Actualizar datos demográficos con trazabilidad Art. 42.
- US.F2.3.4 (3 SP, Must) — Registrar paciente desconocido o sin documentos.
- US.F2.3.5 (5 SP, Must) — Gestionar afiliación ISSS.
- US.F2.3.6 (referenciada) — Unificación de expedientes duplicados Art. 14 lit. g.
