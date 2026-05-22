# BIT — Bitácora Clínica ECE

> **Nota de modelado.** `BIT` no es un `tipo_documento` del catálogo `ece.tipo_documento` (no se llena, no se firma, no transita estados). Es el **registro inmutable y automático de eventos del expediente clínico electrónico** generado por el sistema en respuesta a operaciones sobre las tablas auditadas. Sirve como base de auditoría regulatoria (MINSAL, ISSS, autoridad judicial) y como mecanismo criptográfico de no-repudio. Físicamente la implementación HIS la divide en **tres capas complementarias**: `audit."AuditLog"` (hash chain global SHA-256 sobre tablas `public.*`), `ece.bitacora_acceso` (intentos de acceso al ECE — autorizados y denegados — Art. 45–52 NTEC) y `ece.bitacora_auditoria` (cambios en datos clínicos del expediente — Art. 42 NTEC). Este documento describe el flujo agregado tal como lo percibe la UI de bitácora y la auditoría de cumplimiento.

## Metadata

- **codigo**: `BIT` (alias funcional — **NO es código de `ece.tipo_documento`**; es el log transversal del expediente)
- **nombre**: Bitácora Clínica del Expediente (registro inmutable de eventos y accesos)
- **modalidad**: TRANSVERSAL — aplica a todas las modalidades (AMBULATORIO, EMERGENCIA, HOSPITALIZACION, HOSPITAL_DIA, TELESALUD) y a toda operación sobre tablas auditadas, incluido el flujo de break-glass.
- **NTEC artículo**: **Art. 42** (rectificación trazable: log con usuario, fecha-hora-minuto-segundo y detalle del cambio; nunca borrado físico), **Arts. 45–52** (acceso auditado al ECE: registrar todo intento autorizado/denegado, retención mínima 10 años por TDR §6.3), **Arts. 55–56** (metadatos obligatorios + bitácora de modificaciones inmutable conservada ≥ 2 años NTEC; HIS aplica 10 años por TDR §6.3) del Acuerdo n.° 1616 MINSAL (D.O. T.444 N°158, 22/08/2024; reforma D.O. n.°55 T.450 19/03/2026). TDR §6.3 sobre Auditoría y §5.5 (regla 3 — append-only) son las referencias técnicas del HIS.
- **modulo_his_target**: `/(admin)/ece/bitacora` (tabla paginada con filtros) + `/(admin)/ece/bitacora/timeline` (vista timeline agrupada por día) — visualizadores **read-only**. **NO crear** ruta de captura manual — el log se genera por trigger BD y por `bitacora.register` invocado server-side. Solo accesible para roles `DIR` y `ARCH`.
- **tabla_datos**: tres tablas complementarias del modelo de auditoría HIS, ninguna llenable por usuario directamente:
  - **`audit."AuditLog"`** (`packages/database/prisma/schema.prisma:642`) — log canónico HIS sobre tablas `public.*` (Patient, Encounter, TriageEvaluation, PatientConsent, etc., 35 tablas definidas en `02_audit_triggers.sql:98-110`). Hash chain SHA-256 implementado en `05_audit_hash_chain.sql`. Append-only enforced por trigger `trg_auditlog_no_update` (RAISE EXCEPTION ante UPDATE/DELETE/TRUNCATE).
  - **`ece.bitacora_acceso`** (`schema.prisma:5454` — `EceBitacoraAcceso`) — accesos al ECE (lectura, escritura, firma, certificación, impresión, exportación) con `autorizado boolean` para diferenciar éxito/fallo. Append-only desde la aplicación (RLS rol `authenticated` solo INSERT; SELECT requiere `DIR`/`ARCH`).
  - **`ece.bitacora_auditoria`** (`schema.prisma:5473` — `EceBitacoraAuditoria`) — cambios en datos clínicos con `datos_antes`/`datos_despues` JSONB (Art. 42 NTEC), referenciada por `EceDocumentoInstancia` para trazar rectificaciones por documento.
- **inmutable**: **TRUE SIEMPRE** — la cadena criptográfica SHA-256 es matemáticamente inmutable; cualquier UPDATE/DELETE rompe la verificación. El trigger `audit.fn_audit_log_immutable()` (`02_audit_triggers.sql:81-91`) bloquea explícitamente UPDATE/DELETE/TRUNCATE sobre `audit."AuditLog"`. Retención: **10 años** por TDR §6.3 (NTEC mínimo 2 años, política HIS más estricta).
- **tipo_registro**: **AUTOMATICO** — no llenable por usuario. Generado por:
  - Trigger BD `audit.fn_audit_row()` (`02_audit_triggers.sql:7-78`) sobre INSERT/UPDATE/DELETE de las 35 tablas auditadas — captura before/after JSONB.
  - Trigger BD `audit.fn_audit_log_chain()` (`05_audit_hash_chain.sql:56-86`) que serializa inserts con `LOCK TABLE ... IN EXCLUSIVE MODE` y encadena `prevHash` + `signatureHash` SHA-256.
  - Mutation tRPC `bitacora.register` (`packages/trpc/src/routers/ece/bitacora.router.ts:378`) invocada server-side por otros routers ECE (firma, certificación, rectificación, supresión) para registrar eventos NTEC en `ece.bitacora_acceso`.

---

## Propósito normativo

La Bitácora Clínica del ECE es el **registro inmutable de todos los accesos y modificaciones al expediente clínico** y constituye la **base probatoria para auditorías regulatorias** (MINSAL, ISSS), requerimientos judiciales, derechos ARCO del paciente (Art. 18 Ley de Protección de Datos Personales — el titular puede solicitar quién accedió a su expediente) y vigilancia interna del Comité del Expediente Clínico (Art. 32 NTEC).

Sus funciones críticas:

1. **No-repudio criptográfico**: la cadena SHA-256 encadenada (`prevHash → payload → chain_hash`) hace matemáticamente detectable cualquier inserción, modificación o borrado a posteriori. Un superusuario con `BYPASSRLS` puede técnicamente manipular las filas (rol `service_role` de Supabase tiene BYPASSRLS por diseño), pero la cadena romperá la verificación al primer `auditIntegrityRouter.verifyChain()`.
2. **Auditoría de acceso (Art. 45–52 NTEC)**: todo intento de acceso — autorizado o denegado — al ECE queda registrado con usuario, acción, resultado, IP y contexto. Habilita el flujo "auditoría de accesos a HCE" exigido por TDR §6.3 ("el paciente o su representante puede solicitar el log de quién accedió a su expediente").
3. **Trazabilidad de rectificaciones (Art. 42 NTEC)**: ninguna corrección de datos clínicos borra el original; la bitácora preserva `datos_antes` y `datos_despues` JSONB junto con `ejecutado_por`, `tabla`, `registro_id` y `ocurrido_en`. El expediente jamás pierde la versión histórica.
4. **Break-glass auditado (TDR §6.2)**: el acceso de emergencia con justificación obligatoria queda registrado con flag `break_glass = true` para revisión post-hoc por DIR. El trigger `fn_require_break_glass_justification()` (`02_audit_triggers.sql:124-133`) aborta la transacción si se invoca break-glass sin `app.justification` seteada.
5. **Detección de outliers (F2-S15 Stream D)**: el router `auditOutlierRouter` (`packages/trpc/src/routers/audit-outlier.router.ts`) escanea `ece.bitacora_acceso` buscando accesos fuera de horario clínico (22:00–06:00) o desde IPs no whitelisted, marcando `flag_outlier=true` para alerta del DIR (US.F2.7.13, US.F2.7.16).
6. **Retención legal (10 años TDR §6.3)**: la conservación supera el mínimo NTEC (2 años) y satisface los requisitos de prescripción civil/penal en El Salvador para reclamaciones por mala praxis.

---

## Dependencias

**Ninguna** desde la perspectiva del flujo documental — la bitácora es **transversal** y se activa automáticamente ante cualquier operación sobre tablas auditadas. Las dependencias técnicas son:

- **Trigger BD activo** en las tablas auditadas (35 tablas listadas en `02_audit_triggers.sql:98-110` para `public.*`; tablas ECE auditadas a su vez por triggers Art. 42 propios).
- **Extensión `pgcrypto`** disponible (Supabase la mantiene en schema `extensions`; self-hosted en `public`). El `search_path` de las funciones de hash chain incluye ambos (`SET search_path = public, extensions, audit`).
- **Sesión Postgres con GUCs seteadas**: `app.current_user_id`, `app.current_org_id`, `app.is_break_glass`, `app.justification` — vienen del wrapper `withTenantContext` (`packages/trpc/src/rls-context.ts`). Si una operación se hace fuera de `withTenantContext` la fila de auditoría queda con `userId NULL` (drift conocido — bypass del contrato RLS).

---

## Obligatoriedad

**SIEMPRE — generación automática por trigger sobre INSERT/UPDATE/DELETE de tablas auditadas.** No es opcional ni configurable a nivel operativo:

- INSERT/UPDATE/DELETE en cualquiera de las 35 tablas listadas en `02_audit_triggers.sql:98-110` dispara `audit.fn_audit_row()` que escribe en `audit."AuditLog"`.
- Operaciones críticas del ECE (firma, certificación, anulación, validación, rectificación, supresión) invocan `bitacora.register` server-side para escribir en `ece.bitacora_acceso` con la `accion` correspondiente.
- Accesos de lectura (`view`, `print`, `export`, `share`) deben registrarse desde la capa de aplicación — Postgres no soporta BEFORE SELECT triggers; el router/middleware es responsable.

**Excepción:** updates idempotentes (NEW = OLD) se omiten por optimización en `audit.fn_audit_row()` (línea 35-37) para no inflar la tabla con eventos sin cambio real.

---

## Roles firmantes

**N/A — generado por sistema.** La Bitácora **no se firma como acto único** (a diferencia de un consentimiento o una epicrisis). La integridad jurídica del log se sostiene por:

- **Hash chain SHA-256** (`prevHash` + `signatureHash`) — inmutabilidad criptográfica, calculada en trigger BEFORE INSERT.
- **Timestamp con precisión segundo** (`occurredAt`, `ocurrido_en`, `registrado_en` — Art. 55 NTEC).
- **`userId` / `auth_user_id` / `ejecutado_por`** — usuario que originó el evento (FK a `public."User"` o `auth.users`).
- **`ip` / `ipOrigen` + `userAgent`** — captura desde `current_setting('request.headers.x-forwarded-for')` y `current_setting('request.headers.user-agent')` en el trigger.
- **`justification`** — texto libre obligatorio en break-glass (`app.justification`).

**Roles autorizados a consultar la bitácora** (no firmar):

| Rol | Capacidad | Restricción |
|---|---|---|
| DIR (Dirección Médica) | Lectura completa, exportación CSV/PDF, métricas, marcado manual de outliers | Sin restricción de paciente o módulo |
| ARCH (Archivo Clínico / ESDOMED) | Lectura completa con filtros, exportación CSV | Lectura y exportación; no puede marcar outliers manualmente |
| super_admin / admin_clinico | Verificación de cadena (`auditIntegrityRouter.verifyChain`, `chainStats`) | Solo integridad técnica, no consulta operativa |
| TITULAR del expediente (paciente) o representante legal | Solicitud de log de accesos a su propio expediente (derecho ARCO Art. 18 LPDP) | A través de flujo formal `/(admin)/ece/arco` (no acceso directo a la UI de bitácora) |

---

## Campos obligatorios

### Capa 1 — `audit."AuditLog"` (`schema.prisma:642`, hash chain global HIS)

| Columna | Tipo | NULL | Origen | Notas |
|---|---|---|---|---|
| `id` | `BigInt @id @default(autoincrement())` | NO | bigserial | PK, monotónica creciente — ordena la cadena |
| `occurredAt` | `Timestamptz` | NO | `now()` | Precisión segundo (Art. 55 NTEC) |
| `userId` | `Uuid` | SI (cuando sesión no se demota) | `public.current_user_id()` | FK lógico a `public."User".id`; NULL bajo rol bypass-RLS o servicios |
| `organizationId` | `Uuid` | SI | extraído de `to_jsonb(NEW)->>'organizationId'` | Multi-tenant; NULL si la tabla no tiene esa columna |
| `establishmentId` | `Uuid` | SI | extraído de `to_jsonb(NEW)->>'establishmentId'` | Multi-establecimiento |
| `ip` | `Inet` | SI | `current_setting('request.headers.x-forwarded-for')` | Origen de la conexión |
| `userAgent` | `VarChar(400)` | SI | `current_setting('request.headers.user-agent')` | Cliente / navegador |
| `action` | `AuditAction` enum | NO | derivado de `TG_OP` | `CREATE` / `UPDATE` / `DELETE` |
| `entity` | `VarChar(80)` | NO | `TG_TABLE_NAME` | Nombre de tabla origen |
| `entityId` | `VarChar(80)` | SI | `(NEW.id)::text` o `(OLD.id)::text` | ID del registro afectado |
| `beforeJson` | `Json` | SI (en INSERT) | `to_jsonb(OLD)` | Estado previo |
| `afterJson` | `Json` | SI (en DELETE) | `to_jsonb(NEW)` | Estado posterior |
| `justification` | `Text` | SI (obligatoria en break-glass) | `current_setting('app.justification')` | Razón en break-glass / eliminación |
| `signatureHash` | `VarChar(120)` | SI | `audit.fn_compute_chain_hash(NEW)` | SHA-256 hex de la fila + prevHash |
| `prevHash` | `VarChar(120)` | SI (NULL en primer registro) | `SELECT signatureHash FROM AuditLog ORDER BY id DESC LIMIT 1` (bajo LOCK EXCLUSIVE) | Hash del registro anterior |

### Capa 2 — `ece.bitacora_acceso` (`schema.prisma:5454` — `EceBitacoraAcceso`)

| Columna | Tipo | NULL | Notas |
|---|---|---|---|
| `id` | `BigInt @id @default(autoincrement())` | NO | bigserial (volumen ~2M/año) |
| `authUserId` (`auth_user_id`) | `Uuid` | SI | FK lógico a `auth.users.id` (Supabase) |
| `personalId` (`personal_id`) | `Uuid` | SI | FK a `ece.personal_salud` |
| `componente` | `VarChar(100)` | NO | Módulo origen (ej. `firma-electronica`, `certificacion`) |
| `tipoAcceso` (`tipo_acceso`) | `VarChar(30)` | NO | `FIRMAR`/`VALIDAR`/`CERTIFICAR`/`ANULAR`/`view`/`create`/`update`/`delete`/`export`/`print`/`share` |
| `autorizado` | `Boolean` | NO | Éxito/fallo del intento (Art. 45 NTEC) |
| `recursoId` (`recurso_id`) | `Uuid` | SI | ID del recurso accedido (documento, paciente) |
| `ipOrigen` (`ip_origen`) | `VarChar(45)` | SI | IPv4/IPv6 origen |
| `ocurridoEn` (`ocurrido_en`) | `Timestamptz` | NO `DEFAULT now()` | Precisión segundo |
| `flag_outlier` (migración F2-S15) | `Boolean` | NO `DEFAULT false` | Marca de outlier por escaneo `auditOutlier.scanAndFlag` |
| `motivo_outlier` | `Text` | SI | Razón del marcado (fuera de horario, IP no whitelisted) |

Index: `(personalId, ocurridoEn)` para listados por personal.

### Capa 3 — `ece.bitacora_auditoria` (`schema.prisma:5473` — `EceBitacoraAuditoria`)

| Columna | Tipo | NULL | Notas |
|---|---|---|---|
| `id` | `BigInt @id @default(autoincrement())` | NO | |
| `instanciaId` (`instancia_id`) | `Uuid` | SI | FK a `ece.documento_instancia` |
| `tabla` | `VarChar(80)` | NO | Tabla cambiada |
| `registroId` (`registro_id`) | `Uuid` | NO | UUID del registro modificado |
| `operacion` | `VarChar(20)` | NO | `INSERT`/`UPDATE`/`DELETE` |
| `datosAntes` (`datos_antes`) | `Json` | SI | Estado previo (Art. 42 NTEC) |
| `datosDespues` (`datos_despues`) | `Json` | SI | Estado posterior |
| `ejecutadoPorId` (`ejecutado_por`) | `Uuid` | SI | FK a `ece.personal_salud` |
| `authUserId` (`auth_user_id`) | `Uuid` | SI | FK lógico a `auth.users.id` |
| `ocurridoEn` (`ocurrido_en`) | `Timestamptz` | NO `DEFAULT now()` | |

---

## Estados

**N/A — registros inmutables continuos.** No hay máquina de estados ni flujo de aprobación. Cada fila es:

- Creada por trigger BD o por `bitacora.register` (INSERT atómico dentro de la transacción de la operación auditada).
- Encadenada al hash de la fila anterior (en `audit."AuditLog"`).
- Conservada indefinidamente; el retention policy (10 años, TDR §6.3) se aplica por job batch externo al ciclo operativo, no por flujo de estado.

Las tablas operacionales (`ece.documento_instancia`) sí tienen estados (`borrador → firmado → validado → certificado`), pero esos estados son de los **documentos**, no de la bitácora. La bitácora simplemente **registra las transiciones** sin tener estado propio.

---

## Transiciones

**N/A** — la bitácora es append-only por diseño. Las únicas transiciones físicas posibles son INSERT:

- INSERT en `audit."AuditLog"` por trigger `trg_audit_<tabla>` AFTER INSERT/UPDATE/DELETE.
- INSERT en `ece.bitacora_acceso` por `bitacora.register` server-side.
- INSERT en `ece.bitacora_auditoria` por trigger Art. 42 NTEC sobre tablas `ece.*` clínicas.

UPDATE/DELETE/TRUNCATE están **bloqueados** por:

- Trigger `trg_auditlog_no_update` en `audit."AuditLog"` → `RAISE EXCEPTION 'audit.AuditLog es append-only (TDR §6.3)'`.
- Política RLS sobre `ece.bitacora_acceso` que limita a rol `authenticated` solo INSERT (sin UPDATE ni DELETE en RLS GRANT).
- Política RLS análoga sobre `ece.bitacora_auditoria`.

El único caso documentado de "borrado" es la **purga por retention** (10 años TDR §6.3) que se ejecuta con rol `service_role` por job batch — esto rompe la cadena por diseño, requiere ventana de mantenimiento documentada y emite alerta al DIR.

---

## Eventos del sistema (que generan entradas)

Cada uno de estos eventos produce una o más filas en una de las tres capas de bitácora:

### Operaciones de datos (capa `audit."AuditLog"`)

- **INSERT** en cualquier tabla auditada → `action=CREATE`, `beforeJson=NULL`, `afterJson=NEW`.
- **UPDATE** en cualquier tabla auditada (no idempotente) → `action=UPDATE`, `beforeJson=OLD`, `afterJson=NEW`.
- **DELETE** físico (cuando permitido) → `action=DELETE`, `beforeJson=OLD`, `afterJson=NULL`. **Bloqueado por trigger en `Patient`** (`fn_block_hard_delete_patient` — TDR §5.5 regla 7, soft-delete obligatorio).
- **35 tablas cubiertas en `02_audit_triggers.sql:98-110`**: Organization, Establishment, Ledger, ServiceUnit, Bed, User, UserCredential, UserExternalIdentity, Session, Role, Permission, RolePermission, UserOrganizationRole, Patient, PatientIdentifier, PatientAddress, PatientPhone, PatientEmail, PatientEmergencyContact, PatientEthnicity, PatientReligion, PatientLanguage, PatientAllergy, PatientConsent, PatientMerge, Encounter, BedAssignment, EncounterTransfer, TriageLevel, TriageFlowchart, TriageDiscriminator, TriageFlowchartVitalSign, TriageEvaluation, TriageVitalSign, TriageDiscriminatorHit.

### Accesos al ECE (capa `ece.bitacora_acceso`)

- **Acceso al expediente** (READ con sesión rastreable) — registrado vía middleware o explícitamente desde el router (`accion=view`).
- **Login / Logout** — emitidos por capa de autenticación (Supabase Auth + capa custom).
- **Activación de break-glass** — `accion=view` con `contexto` que incluye `app.justification`; trigger `fn_require_break_glass_justification` aborta si falta justificación.
- **Firma electrónica** — `accion=FIRMAR` con `firma_id` referenciando `ece.firma_electronica.id`.
- **Validación** — `accion=VALIDAR` (segunda firma por médico revisor).
- **Certificación DIR** — `accion=CERTIFICAR` (Art. 21 NTEC, solo DIR).
- **Anulación** — `accion=ANULAR` (transición universal del workflow, requiere firma + motivo).
- **Exportación / Impresión / Compartir** — `accion=export/print/share` con `contexto` indicando el documento exportado.
- **Acceso denegado** — INSERT con `autorizado=false` y `contexto` describiendo el motivo (rol insuficiente, paciente fuera de scope, etc.).

### Rectificaciones y cambios clínicos (capa `ece.bitacora_auditoria`)

- **Rectificación** (Art. 42 NTEC) — captura `datos_antes` + `datos_despues` JSONB con la diff campo→valor_anterior→valor_nuevo. Vinculada a `instancia_id` del documento ECE.
- **Supresión** — eliminación lógica con captura del snapshot previo.
- **Unificación de expedientes duplicados** (Art. 14 lit. g NTEC) — `PatientMerge.snapshotJson` adicional + entradas en bitácora con la reasignación de FK.

### Verificación de integridad (cadena)

- **`auditIntegrity.verifyChain(fromId)`** (`packages/trpc/src/routers/audit-integrity.router.ts:44`) — recorre `audit."AuditLog"` desde `fromId`, recalcula cada `signatureHash` con `audit.fn_compute_chain_hash(rec)` y devuelve filas con hash inválido (vacío si íntegro). Roles `super_admin`/`admin_clinico` exclusivamente.
- **`auditIntegrity.chainStats()`** — devuelve `totalRows`, `lastId`, `lastHash` para UI de integridad.
- Manipulación detectada → ALERTA crítica enviada al DIR (Beta.15 notifications canal email + in-app).

---

## Verificación de integridad

El mecanismo criptográfico está en `packages/database/sql/05_audit_hash_chain.sql`:

1. **Cálculo del hash** (`audit.fn_compute_chain_hash`): `SHA-256(prevHash || id || action || entity || entityId || beforeJson || afterJson || userId || occurredAt)`, retornado hex. `coalesce(..., '')` para tolerar NULLs.
2. **Trigger BEFORE INSERT** (`audit.fn_audit_log_chain`): toma `LOCK TABLE audit."AuditLog" IN EXCLUSIVE MODE` (serializa escritores, permite SELECT concurrente, justificado por append-only), lee `signatureHash` de la última fila (`ORDER BY id DESC LIMIT 1`), asigna `NEW.prevHash` y calcula `NEW.signatureHash`.
3. **Función de verificación** (`audit.fn_verify_chain(from_id)`): recorre filas desde `from_id` y devuelve solo aquellas donde `signatureHash IS DISTINCT FROM audit.fn_compute_chain_hash(a)` — tabla sana → 0 filas.
4. **Estadística ligera** (`audit.fn_chain_stats`): `count(*)`, `max(id)`, `last_hash` — usado por la UI de integridad sin escanear toda la tabla.

**Modelo de amenaza:**

- ✅ **Inserción no autorizada** post-hoc: rompería el `prevHash` de la fila siguiente — detectable.
- ✅ **Modificación de fila existente**: cambiaría el hash recalculado vs el almacenado — detectable.
- ✅ **Borrado de fila intermedia**: rompería el encadenamiento entre fila previa y posterior — detectable.
- ✅ **UPDATE/DELETE/TRUNCATE intentado por aplicación**: bloqueado por `trg_auditlog_no_update`.
- ⚠️ **Borrado consecutivo desde el final** por superusuario `service_role`: técnicamente no rompe la cadena (las filas restantes siguen siendo consistentes), pero `chainStats.totalRows` decrementaría y `lastId` retrocedería — detectable por comparación con snapshot externo (idealmente exportación periódica a SIEM, TDR §6.3 "Exportación a SIEM externo").
- ⚠️ **Manipulación coordinada de prevHash + signatureHash**: posible solo desde rol con BYPASSRLS y conocimiento del algoritmo; requiere acceso DBA. No prevenible al 100% por diseño Supabase (rol `service_role` por definición salta RLS y triggers AFTER pueden ser deshabilitados con `ALTER TABLE ... DISABLE TRIGGER`). Mitigación: rotación de credenciales `service_role`, auditoría de uso del rol, exportación periódica a SIEM externo (idealmente WORM storage).

---

## Drift conocido (audit)

Hallazgos relacionados con la bitácora, derivados de `docs/audit/2026-05-19_audit_stream_g_cumplimiento_ntec.md` (Módulo 1) y el contexto de `audit-outlier.router.ts`:

- **HG-01 (P1 ALTA)** — Filtros `pacienteId` y `personalId` en `/ece/bitacora` reciben texto libre desde la UI pero `bitacora.list` espera `z.string().uuid().optional()`. Si el usuario escribe un nombre, Zod rechaza o el campo se omite — el filtro resulta en no-op silencioso. Bloquea el requerimiento NTEC Art. 48 (auditar accesos por paciente individual).
- **HG-02 (P1 ALTA)** — `bitacoraListInput.accion` acepta un solo valor; la UI permite multi-selección de 16 acciones. Con múltiples selecciones aplica filtro client-side sobre 50 filas paginadas, rompiendo la paginación (página 1 puede mostrar 0 visibles con 1000 registros pendientes). Recomendación: extender a `z.array(accionEnum).optional()` + `b.accion = ANY($N::text[])`.
- **HG-03 (P2 MEDIA)** — Export PDF generado solo con `window.print()` (`bitacora/page.tsx:526-528`) sin firma DIR ni hash SHA-256 del reporte. Art. 52 NTEC y TDR §6.3 requieren firma digital del director en reportes entregables a reguladores. Recomendación: endpoint server-side `/api/bitacora/report.pdf` con membrete MINSAL + PIN DIR + hash de la consulta.
- **HG-04 (P2 MEDIA)** — Filtros de fecha con `new Date(string).toISOString()` en `buildListInput`/`buildMetricsInput`/`timeline` aplican shift de ±1 día en `America/El_Salvador` (UTC-6). Mismo patrón ya conocido en otros módulos (H1-03 en `/patients`). Recomendación: enviar `"YYYY-MM-DDT00:00:00"` sin zona o usar helper `parseDateOnly`.
- **HJ-04 / HJ-06 (Stream J)** — `audit-outlier.router` opera sobre `ece.bitacora_acceso` sin filtro `organization_id` en algunos procedures (la tabla no expone `organization_id` directamente, depende de la sesión Postgres). Implicación: en entornos multi-tenant un DIR podría ver outliers de otra organización si la sesión bypasea `withTenantContext`. PENDIENTE — añadir filtro derivado por `personal_id → personal_salud.organization_id` o agregar columna `organization_id` a `bitacora_acceso`.
- **Drift retroactivo** — `bitacora.register` requiere que el caller pase `userId` y valida igualdad con `ctx.user.id` salvo que `firmaId` sea nulo. Procedures con `firmaId !== undefined` pueden registrar eventos en nombre del usuario sin verificación adicional — confianza implícita en el caller server-side. No es una vulnerabilidad si los callers son routers propios, pero la superficie crece con cada nuevo router que invoca `bitacora.register`.
- **Cobertura tablas ECE** — `02_audit_triggers.sql` cubre 35 tablas `public.*` pero **no** las tablas `ece.*` directamente; la cobertura de éstas se hace vía `ece.bitacora_auditoria` con triggers separados (Art. 42). Validar paridad entre las dos capas durante consolidación documental Comité ECE.
- **Bug volumen** — Las tres tablas tienen `id BigInt @default(autoincrement())` — bigserial para volumen esperado ~2M/año (`schema.prisma:5453`). El índice `(personalId, ocurridoEn)` cubre el listado por personal pero queries amplias por rango de fecha sin filtro de personal pueden ser lentas; falta índice GIN o BRIN sobre `ocurrido_en` para grandes ventanas temporales.

---

## Descripción markdown rica

### El log que sostiene la confianza jurídica del expediente

La Bitácora Clínica ECE no es un documento que un humano llena — es la **infraestructura de auditoría** sobre la que descansa la validez probatoria de todo el expediente. Sin bitácora íntegra, la firma electrónica simple del Art. 23 NTEC pierde valor: una firma sin trazabilidad es una declaración no verificable. Por eso la NTEC dedica los Arts. 42 (rectificación trazable), 45–52 (acceso auditado) y 55–56 (metadatos + retención) al diseño de este registro, y por eso el HIS lo implementa con **tres capas complementarias y un mecanismo criptográfico de hash chain**.

### AUTOMATICO — no llenable, no firmable

A diferencia de FICHA_IDENT (registro maestro vivo, actualizable), HC_AMB (transaccional firmado por médico) o EPI_EGR (histórico firmado al alta), la Bitácora **no admite intervención humana directa**. No hay UI de captura, no hay ruta `/ece/bitacora/new`, no hay procedure `bitacora.create` accesible al cliente. Los únicos endpoints públicos del `bitacoraRouter` son consulta (`list`, `exportCsv`, `metrics`) o invocación server-side por otros routers (`register`). Esta restricción es deliberada — cualquier "creación manual" de entradas de bitácora sería falsificación probatoria.

### La cadena SHA-256 — inmutabilidad matemática

El núcleo técnico vive en `packages/database/sql/05_audit_hash_chain.sql`. Cada fila de `audit."AuditLog"` lleva:

- `prevHash` — SHA-256 hex de la fila anterior (NULL en el primer registro de la tabla).
- `signatureHash` — SHA-256 hex de `(prevHash || id || action || entity || entityId || beforeJson || afterJson || userId || occurredAt)`.

La construcción es **determinística e inviolable bajo el modelo de amenaza estándar**: alterar cualquier campo del payload o reescribir `prevHash` cambia el hash esperado de toda la cadena hacia adelante. El `LOCK TABLE ... IN EXCLUSIVE MODE` en el trigger BEFORE INSERT serializa los escritores (impide que dos transacciones lean el mismo "último" y escriban ambas con el mismo `prevHash` → cadena bifurcada) y, dado que la tabla es append-only por contrato, no hay UPDATE/DELETE legítimo que el lock pueda perjudicar — el costo concurrente es aceptable.

La función pública `audit.fn_verify_chain(from_id)` permite escaneo incremental: el router `auditIntegrityRouter.verifyChain` la invoca con `fromId` opcional para no escanear toda la tabla en chequeos rutinarios. La verificación es STABLE (idempotente, sin side effects), apta para cron job nocturno + ejecución on-demand del DIR.

### Retención 10 años — TDR §6.3 sobre NTEC

La NTEC exige mínimo 2 años de conservación (Art. 56), pero el TDR §6.3 ("Conservación de logs por mínimo 10 años, configurable") aplica la política más estricta del HIS, alineada con:

- Plazo de prescripción civil/penal por reclamaciones de mala praxis en El Salvador.
- Requisitos de auditoría regulatoria SNIS (Sistema Nacional Integrado de Salud).
- Prácticas de la industria para datos clínicos sensibles (HIPAA, GDPR Art. 17 derecho al olvido + excepciones por interés público).

La purga por retention se ejecuta con `service_role` desde job batch externo. Es la **única operación legítima** que rompe la cadena (por borrado, no por modificación), debe estar documentada, supervisada y emitir alerta a DIR antes de su ejecución. La salida natural del log es la exportación a SIEM externo (TDR §6.3) — idealmente storage WORM para auditoría regulatoria, donde la cadena se preserva indefinidamente.

### Break-glass auditado — el caso excepcional

El break-the-glass (acceso de emergencia, TDR §6.2) es la única vía por la que un usuario puede acceder a un expediente fuera de su scope normal. El flujo:

1. Usuario activa break-glass en UI con justificación obligatoria (mín. 10 caracteres, texto libre validado).
2. Capa de aplicación setea `SET LOCAL app.is_break_glass = true` y `SET LOCAL app.justification = '...'` antes de la query.
3. Trigger `fn_require_break_glass_justification` (`02_audit_triggers.sql:124-133`) sobre UPDATE/DELETE de `Patient` verifica que `app.justification` no sea NULL — RAISE EXCEPTION si falta.
4. Cada fila de `audit."AuditLog"` registra `justification` y `userId`, marcando el evento como excepcional.
5. Job nocturno o dashboard del DIR (`auditOutlier.dashboardStats`) destaca los accesos con `justification IS NOT NULL` para revisión post-hoc.

Postgres no soporta BEFORE SELECT triggers, por lo que el control en lecturas se hace desde middleware de aplicación (capa Next.js / tRPC) que setea las GUCs antes del query. Si un atacante logra ejecutar SELECT sin pasar por el middleware (acceso directo BD con `service_role`), el evento NO se loggea — esta es una limitación arquitectónica conocida, mitigada por rotación de credenciales y monitoreo de uso del rol `service_role` (idealmente cero accesos humanos, solo jobs automatizados firmados).

### Detección de outliers — F2-S15 Stream D

El módulo `auditOutlierRouter` (US.F2.7.13, US.F2.7.16) agrega inteligencia sobre los datos crudos de `ece.bitacora_acceso`:

- Escaneo periódico (`scanAndFlag`) — marca `flag_outlier=true` y `motivo_outlier` en accesos fuera de horario clínico (configurable por organización, default 22:00–06:00) o desde IPs fuera de la whitelist organizacional.
- Dashboard DIR (`dashboardStats`) — métricas agregadas para detección de patrones anómalos (incremento súbito de accesos por un usuario, accesos masivos a expedientes VIP/mental/HIV).
- Marcado manual (`flagOutlier`) — DIR puede marcar un evento puntual como outlier con motivo libre, integrado al flujo de quejas/reclamos.

La detección automática **no bloquea** el acceso (sería falso positivo costoso para personal de turno nocturno legítimo); solo lo destaca para revisión. La decisión disciplinaria queda en el DIR + Comité del Expediente Clínico (Art. 32 NTEC).

### Por qué NO crear `/ece/bitacora-acceso/` separado de `/ece/bitacora/`

La ruta actual `/(admin)/ece/bitacora` cubre ya las tres capas (vista unificada con filtros por tipo de evento). Crear una ruta separada para "accesos" vs "modificaciones" duplicaría la UI sin valor añadido — desde la perspectiva del DIR/ARCH lo que importa es el rastro cronológico unificado por paciente o por usuario, no la capa técnica de origen. La distinción interna (`audit."AuditLog"` vs `ece.bitacora_acceso` vs `ece.bitacora_auditoria`) es transparente al usuario final; el router las consolida en la respuesta del `list`.

Coherente con la regla "adecuar legacy vs duplicar" del CLAUDE.md: el dominio "auditoría del expediente" tiene una sola UI, las tres tablas son detalle de implementación.

### Cobertura normativa y plan

Estado actual:

- **35 tablas `public.*`** con triggers AFTER INSERT/UPDATE/DELETE + hash chain SHA-256.
- **`ece.*` cubierto** vía `ece.bitacora_auditoria` (Art. 42) + `ece.bitacora_acceso` (Arts. 45–52).
- **Retención 10 años** configurada (TDR §6.3) — purga batch pendiente de implementación operativa.
- **Verificación cadena** — `auditIntegrityRouter` activo, sin scheduler nocturno automático aún.
- **Exportación SIEM** — pendiente (TDR §6.3 línea 287); previsto F2-S16 o sprint posterior.

Cobertura objetivo (TDR §6.3 + NTEC Arts. 42, 45–52, 55–56): 100% de operaciones sensibles auditadas, verificación de cadena diaria automatizada, exportación incremental a SIEM. Los hallazgos HG-01 a HG-04 son los bloqueantes operativos para pasar de "log técnico" a "herramienta de auditoría usable por DIR/ARCH"; los hallazgos HJ-04/HJ-06 son los bloqueantes de seguridad multi-tenant.

User Stories del epic Fase 2 relevantes (`docs/backlog/fase2/`):

- US.F2.7.13 (8 SP, Must) — Alerta acceso fuera de horario o IP inusual.
- US.F2.7.16 (5 SP, Must) — Dashboard auditoría accesos para DIR.
- US.F2.7.17 (referenciada) — Exportación CSV/PDF firmada con membrete MINSAL.
- US.F2.7.18 (referenciada) — Verificación cadena hash automatizada con alerta crítica.
