# CERT_DEF — Certificado de Defunción

## Metadata

- **codigo**: CERT_DEF
- **nombre**: Certificado de Defunción
- **modalidad**: TODAS — hospitalaria (egreso `tipo_egreso = 'fallecido'`), emergencia (defunción en sala de observación o box de emergencia), ambulatoria (defunción durante consulta — rara pero modelada), y defunción extra-hospitalaria reportada al establecimiento (e.g. cadáver llegado al servicio, llamada forense). El catálogo `lugar_defuncion` en `ece.certificado_defuncion` admite `intrahospitalaria | extrahospitalaria`.
- **NTEC artículo**: Art. 21 Acuerdo MINSAL n.° 1616 (D.O. T.444 n.°158, 22/08/2024; reforma D.O. n.°55 T.450 19/03/2026) — *certificación de copias del expediente y certificados médico-legales (defunción incluido), restringida a Dirección o su delegado*. Cita complementaria: Art. 35 — **conservación extendida del expediente con defunción** (5 años natural / 10 años violencia, accidente o investigación). Ley del Registro del Estado Familiar y su Régimen Transitorio (DL 496/1995 y reformas) — inscripción de la defunción en el RNPN basada en este certificado.
- **modulo_his_target**: `/encounters/[id]/death` (legacy clinical — formulario de captura en encuentro abierto, dispara cierre encounter + liberación cama) + `/deaths` (admin — listado y visor) + `/ece/defuncion` y `/ece/defuncion/nueva` y `/ece/defuncion/[id]` (capa NTEC con workflow triple firma). **Coexistencia legítima documentada por el audit Stream C** (hallazgo B-06): dos sistemas paralelos sin reconciliación — la capa legacy `DeathCertificate` opera 1:1 con `Patient` (cierre encounter + cama) y la capa ECE `ece.certificado_defuncion` opera 1:1 con `episodio_atencion` + `epicrisis_egreso` (workflow normativo). El plan de consolidación (regla "adecuar legacy vs duplicar") está pendiente y requiere bridge `eceBridgeDeath` aún no implementado. Hasta la consolidación, la UI clínica de captura permanece en `/encounters/[id]/death`, y la capa ECE administra el ciclo formal de firma/validación/certificación NTEC.
- **tabla_datos**: `ece.certificado_defuncion` (registro NTEC con workflow, schema `ece`) + `public."DeathCertificate"` (legacy con cierre operativo de encounter/cama). Tablas auxiliares: `ece.epicrisis_egreso` (FK obligatoria, debe tener `tipo_egreso = 'fallecido'`), `ece.episodio_atencion` (FK al episodio), `ece.documento_instancia` (cabecera workflow), `ece.firma_electronica` (PIN argon2id del firmante), `ece.personal_salud` (mapeo `his_user_id` → ECE personal). En el lado legacy: `public."Encounter"` (cierre con `dischargeType = 'DEATH'`), `public."BedAssignment"` (liberación con `releasedAt`), `public."Bed"` (estado → `DIRTY`).
- **inmutable**: **true post-firma**. Doble enforcement: (1) trigger `ece.fn_bloquea_mutacion_certdef` en `ece.certificado_defuncion` levanta `mutacion_no_permitida: certificado defuncion firmado es inmutable (Art. 40 NTEC)` para cualquier UPDATE/DELETE cuando `estado_workflow IN ('firmado','validado','certificado','anulado')`; (2) trigger `public.fn_bloquea_death_certificate` en `public."DeathCertificate"` bloquea **todo** UPDATE/DELETE post-creación (B-05 audit Stream C, aplicado 2026-05-19). Rectificación se modela vía un nuevo documento RECT que enlaza al original (no se modifica el original). La fila original siempre permanece consultable.
- **tipo_registro**: **OBLIGATORIO siempre que ocurra defunción**. HISTÓRICO (Tipo 3 en la matriz de Fase 3 del análisis ECE — Documento legal con conservación extendida 5–10 años por Art. 35 NTEC). 1:1 con paciente (`@unique` sobre `DeathCertificate.patientId` en Prisma) y 1:1 con episodio (UNIQUE parcial `WHERE estado_workflow != 'anulado'` en `ece.certificado_defuncion.episodio_id`).

---

## Propósito normativo

El **Certificado Médico de Defunción** es el documento médico-legal que documenta la muerte de una persona y constituye:

1. **Insumo legal del Registro del Estado Familiar (RNPN)** para la inscripción de la defunción en el registro civil (Ley del Registro del Estado Familiar, El Salvador). Sin certificado médico no puede emitirse el acta de defunción civil, y sin acta no puede entregarse el cuerpo a la funeraria ni inhumarse/cremar.
2. **Base estadística de mortalidad MINSAL/SNIS** (TDR §11 línea 1686): "Reporte de defunciones con codificación CIE-10 al MINSAL y registro civil." La `causa_basica_cie10` (NTEC) / `basicCauseCode` (legacy) es el **ancla única de mortalidad** que MINSAL extrae para tablas de causas de muerte.
3. **Evidencia médico-legal de la causa de muerte** (Art. 21 NTEC). En defunción `violenta`, `accidente_transito` o `en_investigacion` (manera del catálogo), el certificado dispara **notificación obligatoria a Medicina Legal / Fiscalía** y cadena de custodia del cuerpo. La autopsia (`autopsia_realizada bool`) es informativa para la notificación forense.
4. **Cierre del episodio hospitalario y de la cuenta administrativa** (TDR §8.7 línea 487–491). El certificado dispara: liberación de cama (estado `DIRTY`), `Encounter.dischargedAt = occurredAt`, `dischargeType = 'DEATH'`, manejo de cadáver (morgue → funeraria → autopsia si aplica), cierre de cuenta hospitalaria.
5. **Conservación extendida del expediente** (Art. 35 NTEC). Natural: 5 años post-defunción. Violenta/accidente/judicial/investigación: **10 años**. La marca `manner` en el certificado determina el plazo de retención del expediente completo.

---

## Dependencias

Cadena de dependencias bloqueante en flujo hospitalario:

```
FICHA_IDENT (raíz expediente — Art. 15 NTEC)
  └─> HOJA_ING (si hospitalización) | ATN_EMERG (si emergencia)
        └─> EVOL_MED + IND_MED + REG_ENF (durante estancia)
              └─> EPICRISIS_EGRESO con tipo_egreso = 'fallecido' (Art. 17 lit. b NTEC) ←── REQUISITO BLOQUEANTE
                    └─> CERT_DEF (este documento)
                          └─> CERT_DIR (revisión administrativa Art. 21) + Reporte SNIS + Notificación registro civil
```

**Validación implementada (B-04, audit Stream C):** el procedure `eceCertDef.create` ejecuta:

```sql
SELECT tipo_egreso FROM ece.epicrisis_egreso WHERE id = :epicrisisId LIMIT 1
```

y rechaza con `BAD_REQUEST: epicrisis_no_es_fallecido` si la epicrisis no marca defunción. El legacy `deathCertificate.create` no exige epicrisis previa — opera directamente sobre `Encounter` abierto y lo cierra, lo cual es coherente con flujos de emergencia donde la defunción ocurre antes de poder redactar epicrisis estructurada.

**Excepciones documentadas:**

- **Defunción en emergencia sin ingreso hospitalario:** no hay epicrisis previa; la captura es directa en `/encounters/[id]/death` (legacy) y la capa ECE se llena retrospectivamente desde admisión (ESDOMED) creando primero la epicrisis "fallecido en emergencia" y luego el certificado NTEC.
- **Defunción extra-hospitalaria reportada:** `lugar_defuncion = 'extrahospitalaria'` (catálogo `ece.certificado_defuncion.lugar_defuncion`). Aplica cuando el establecimiento recibe el cadáver para certificación (cadáver llegado, autopsia forense). No requiere `Encounter` HIS abierto.
- **Epicrisis NO requerida en el sentido EPI_EGR clínico:** la **epicrisis de egreso fallecido** reemplaza la epicrisis de egreso normal. No se emite EPI_EGR separada para pacientes fallecidos — la epicrisis con `tipo_egreso = 'fallecido'` ES el cierre clínico.

---

## Obligatoriedad

**SIEMPRE en defunción.** Sin excepciones operativas (incluso paciente desconocido fallecido requiere certificado con datos provisionales). Es **bloqueante** para:

- Entrega del cuerpo a la funeraria / familiar.
- Inscripción de la defunción en el registro civil (RNPN).
- Cierre administrativo del episodio hospitalario y la cuenta.
- Reporte estadístico de mortalidad MINSAL.
- Liberación de la cama hospitalaria (estado `DIRTY` post-defunción).

El sistema enforce idempotencia 1:1: un segundo intento de crear certificado para el mismo paciente (legacy) o el mismo episodio activo (ECE) devuelve `CONFLICT`.

---

## Roles firmantes

| Rol | Acción | Momento | Enforcement |
|---|---|---|---|
| **MC / PHYSICIAN** (Médico Tratante o Médico de Turno) | Captura, **firma con PIN argon2id**, transiciona `borrador → firmado` (capa ECE) o crea directamente `DeathCertificate` (legacy con `certifiedById = ctx.user.id`) | Post-defunción, dentro del encounter abierto o vinculado a epicrisis fallecido | `requireRole(["MC","PHYSICIAN"])` en `eceCertDef.firmar`; `requireRole(["PHYSICIAN"])` en `deathCertificate.create`; PIN verificado contra `ece.firma_electronica.pin_hash` con lockout tras 3 intentos (`locked_until`) |
| **MC / PHYSICIAN validador** (segunda revisión clínica) | **Valida con PIN** (`firmado → validado`) — puede ser distinto del firmante (par revisor) | Tras firma, previa certificación. Garantiza no-repudio del validador (B-03 audit Stream C) | `requireRole(["MC","PHYSICIAN"])` en `eceCertDef.validar`; PIN del validador exigido aunque sea el mismo usuario (audit fix B-03) |
| **DIR** (Director del Establecimiento o delegado autorizado) | **Certifica con PIN** (`validado → certificado`) — Art. 21 NTEC: "solo Dirección o su delegado puede certificar copias del expediente" | Última firma del workflow. Habilita emisión de copias formales y notificación oficial al registro civil | `requireRole(["DIR"])` en `eceCertDef.certificar`; PIN obligatorio; estado `certificado` ya no puede ser anulado |
| **MEDICO_LEGAL / Médico Forense** (defunciones violentas, accidentes, en investigación) | Certifica directamente cuando `manner ∈ ('homicide','suicide','accident','undetermined')` o `clasificacion ∈ ('violenta','accidente_transito','en_investigacion')`. Dispara cadena de custodia y notificación a Fiscalía | Cuando la defunción es no-natural o requiere intervención forense | Mismo `requireRole(["MC","PHYSICIAN"])` operativamente, pero diferenciado por `manner`/`clasificacion` que dispara la rama forense vía outbox |
| **FAMILIAR_RESPONSABLE** (firma de recepción de copia) | Recibe copia firmada del certificado y firma acuse de entrega | Entrega de cuerpo en morgue / a funeraria | No modelado en la capa BD actual (gap menor — el acuse de entrega de copia se gestiona como evidencia adjunta o flujo manual administrativo) |
| **DIR (anulación pre-certificación)** | Puede anular el certificado con motivo escrito (`motivoAnulacion ≥ 10 chars`) mientras el estado NO sea `certificado`. **Un certificado ya certificado solo se anula por proceso judicial.** | Solo en errores graves detectados pre-certificación | `requireRole(["DIR"])` en `eceCertDef.anular`; `FORBIDDEN` si `estado_workflow = 'certificado'` |

**Triple firma con PIN argon2id** (workflow ECE):

- Argon2id hashing en `ece.firma_electronica.pin_hash`, verificación con `@his/infrastructure` argon2.
- Lockout: tras 3 intentos fallidos, `locked_until` se setea por N minutos.
- Revocación: `revoked_at` distinto de NULL → `FORBIDDEN: La firma electrónica ha sido revocada`.
- Cada firma deja huella en `audit.audit_log` con hash chain SHA-256 (audit hash chain CLAUDE.md §Audit).

---

## Campos obligatorios NTEC

### Identificación del fallecido y del episodio

- **`paciente_id`** (`ece.certificado_defuncion.paciente_id UUID`) — derivado del episodio. En legacy: `DeathCertificate.patientId UUID NOT NULL @unique`.
- **`episodio_id`** / **`encounterId`** — FK al episodio donde ocurrió o se constató la defunción.
- **`epicrisis_id`** (capa ECE) — FK obligatoria, debe tener `tipo_egreso = 'fallecido'`.
- **`establecimiento_id`** / **`establishmentId`** — Art. 55–56 metadatos obligatorios.

### Fecha y lugar

- **`fecha_hora_defuncion TIMESTAMPTZ NOT NULL`** (legacy: `occurredAt`) — hora exacta con segundos. **Base legal del cómputo de plazos** (registro civil, sucesión, seguro de vida). Validación: `occurredAt >= encounter.admittedAt` (no puede ser anterior a la admisión).
- **`lugar_defuncion`** (`ece.certificado_defuncion.lugar_defuncion`) — catálogo `intrahospitalaria | extrahospitalaria`.
- En el sentido NTEC más amplio: servicio + sala + cama. Hoy se obtiene navegando `Encounter.bedAssignments[0].bed` activo en el momento (`releasedAt IS NULL`) → `Bed.service` / `Bed.room` / `Bed.number`. Gap menor: no se snapshot-ea el bed en la fila del certificado (drift documentado).

### Causas de muerte — CIE-10 estructurado (núcleo del documento)

Sigue el formato OMS para certificado de defunción:

- **`causa_principal_cie10` / `directCauseCode`** — **Causa directa** (lo que mató al paciente — el evento final). Validación Zod `cie10Schema`: `/^[A-Z][0-9]{2}(\.[0-9A-Z]{0,4})?$/`. Búsqueda con autocomplete vía `deathCertificate.searchIcd10` contra `ClinicalConcept` con `codeSystem.code ∈ ('ICD-10','ICD10','CIE-10','CIE10')`.
- **`causas_intermedias_cie10 JSONB` (array, máx 3)** / **`intermediateCauseCode + intermediateCauseDesc`** — Causas intermedias en **orden cronológico inverso** (de la más reciente hacia atrás). Cada item con código CIE-10 + descripción + opcionalmente intervalo aproximado.
- **`causa_basica_cie10` / `basicCauseCode`** — **Causa básica única** (la enfermedad inicial que desencadenó la cascada). **NOT NULL enforced** desde audit B-05 (2026-05-19) tanto en `ece` como en `public."DeathCertificate"`. Es la columna que MINSAL extrae para mortalidad SNIS — ancla única por defunción.
- **`causas_contribuyentes JSONB` / `contributingCauses TEXT`** — Causas concomitantes (condiciones que contribuyeron sin estar en la cadena causal directa: hipertensión, diabetes, etc.).

**Coherencia validada en `deathCertificate.create`:** si viene `intermediateCauseCode`, debe venir `intermediateCauseDesc` (y viceversa); idem para `directCauseCode/directCauseDesc`. `BAD_REQUEST` si vienen desacoplados.

### Manera de la muerte (forense)

- **`manera`** (ECE catálogo: `natural | violenta | accidental | suicidio | homicidio | indeterminada`) / **`manner`** (legacy: `natural | accident | suicide | homicide | undetermined`).
- **`clasificacion`** (capa antigua `ece.certificado_defuncion` previa al workflow patch: `natural | violenta | accidente_transito | en_investigacion`). El campo está mantenido por compatibilidad con seeds NTEC.
- `autopsia_realizada BOOLEAN NOT NULL` (ECE) — flag obligatorio para reporte forense / epidemiológico.
- **Reglas operativas:**
  - `violenta | accidente_transito | suicidio | homicidio | en_investigacion` → notificación **automática a Medicina Legal / Fiscalía** + cadena de custodia del cuerpo (modelado en outbox `cert_def.requiere_forense`).
  - `natural` → flujo normal: morgue → funeraria → registro civil.

### Atención recibida (parámetros tratamiento)

NTEC menciona "atención recibida" como campo del certificado. En la implementación actual se gestiona como narrativa en `observaciones TEXT (≤ 2000)` (ECE) o `notes TEXT` (legacy). No está estructurado en columnas separadas — gap menor de modelado vs el espíritu NTEC pero suficiente para el certificado impreso.

### Campos OMS específicos por curso de vida

NTEC retoma el formato CIE-10 OMS que exige:

- **Mujer en edad fértil:** indicar si hubo **embarazo presente o reciente** (≤ 42 días post-parto). **Gap: no modelado como columna estructurada** — actualmente se captura en `observaciones`. Recomendación pendiente: agregar `embarazo_reciente BOOLEAN` y `dias_postparto INT` a `ece.certificado_defuncion`.
- **Menor de 1 año (neonatal):** causas perinatales específicas (capítulo P CIE-10), edad gestacional, peso al nacer, complicación obstétrica relevante. **Gap: no modelado estructurado** — se captura en narrativa.
- **Recién nacido fallecido (mortinato vs nacido vivo):** distinción crítica para registro civil. **Gap pendiente.**

### Firma y certificación

- **`medico_certificante` / `medico_firmante_id`** (FK a `ece.personal_salud`) — médico que firma. En legacy: `certifiedById UUID` (FK a `User`).
- **`colegio_medico_no`** — número de colegio médico (JVPM). **Gap: no modelado como columna en BD** — se infiere del `User.licenseNumber` si está poblado (campo de perfil profesional). Recomendación: snapshot en el certificado para inmutabilidad post-firma.
- **`payload_hash TEXT`** — SHA-256 del payload clínico clave (`id`, `episodio_id`, `fecha_hora_defuncion`, `causa_principal_cie10`, `causas_intermedias_cie10`, `causa_basica_cie10`, `manera`, `autopsia_realizada`). Garantiza detección de tamper post-firma. Computado en `eceCertDef.firmar` y persistido.
- **`firmado_en`, `validado_en`, `certificado_en`, `anulado_en` TIMESTAMPTZ** — auditoría de cada transición de estado.

### Recepción del familiar

- **Acuse de entrega de copia (`registro_familiar_recibe`)** — firma + parentesco. **Gap: no modelado en BD actual.** Se gestiona como evidencia adjunta al expediente o flujo manual administrativo. Recomendación: agregar tabla auxiliar `ece.entrega_certificado_defuncion (certificado_id, familiar_nombre, parentesco, documento, firma_evidencia_ref, entregado_en)`.

### Metadatos obligatorios (Art. 55–56 NTEC)

- `registrado_en TIMESTAMPTZ DEFAULT now()` / `createdAt`.
- `establecimiento_id` / `organizationId`.
- Bitácora inmutable en `audit.audit_log` con hash chain SHA-256 (severity `HIGH` para certificados — irreversible).
- Trigger inmutabilidad post-firma (descrito arriba).

---

## Estados

Workflow ECE (`ece.certificado_defuncion.estado_workflow`):

| Estado | Significado | Mutaciones permitidas |
|---|---|---|
| `borrador` | Captura inicial — médico llenando el formulario | UPDATE permitido en cualquier campo del certificado |
| `firmado` | MC firmó con PIN — `medico_firmante_id` + `firmado_en` + `payload_hash` poblados | **INMUTABLE** — solo transición a `validado` o `anulado` |
| `validado` | Segundo MC validó con PIN (B-03) — par revisor confirmó causas y datos clínicos | Solo transición a `certificado` o `anulado` |
| `certificado` | DIR certificó con PIN — habilitado para emisión de copias formales y notificación oficial al RNPN | **INMUTABLE ABSOLUTO** — solo proceso judicial puede modificar |
| `anulado` | DIR anuló con motivo escrito antes de certificación | Estado terminal; bloquea emisión de copias |

Workflow legacy (`public."DeathCertificate"`):

- **Estado implícito único: `EMITIDO`.** No tiene máquina de estados. La fila se inserta una sola vez (constraint `@unique patientId`) y el trigger `fn_bloquea_death_certificate` bloquea **todo** UPDATE/DELETE post-creación. El único campo que admite UPDATE es `notifiedToCivilRegistryAt` (stub Sprint 6) — y eso está documentado como excepción del trigger original; el trigger actual del audit B-05 bloquea incluso esa actualización, lo cual debe revisarse al implementar la integración RNPN real.

---

## Transiciones

| origen | destino | rol | condición / payload requerido |
|---|---|---|---|
| `borrador` | `firmado` | MC / PHYSICIAN | `pin` (6–8 dígitos numéricos), verificado contra `firma_electronica.pin_hash` (argon2id). Lockout tras 3 intentos. Computa y persiste `payload_hash` SHA-256. Emite outbox `ece.certificado_defuncion.firmado`. |
| `firmado` | `validado` | MC / PHYSICIAN | `firmaPin` del validador + `observacion` opcional (≤ 1000 chars). Puede ser diferente del firmante (segunda revisión clínica par-revisor). B-03 audit fix. |
| `validado` | `certificado` | DIR | `pin` del director. Solo Dirección o delegado autorizado (Art. 21 NTEC). Emite outbox `ece.certificado_defuncion.certificado` con `dirUserId`. Habilita emisión de copias y notificación oficial al RNPN. |
| `borrador` / `firmado` / `validado` | `anulado` | DIR | `motivoAnulacion` (≥ 10, ≤ 1000 chars). **FORBIDDEN si estado actual es `certificado`** — requiere proceso judicial. |
| `certificado` | (terminal) | — | No hay transiciones desde `certificado` excepto rectificación vía documento RECT separado que enlaza al original. El original permanece inmutable. |

**Legacy:** sin transiciones — la creación es la única operación (atómica: INSERT + cierre encounter + liberación cama + audit log).

---

## Eventos

Outbox transaccional emitido vía `emitDomainEvent` dentro de `withWorkflowContext` (capa ECE) o `prisma.$transaction` (capa legacy):

- **`ece.certificado_defuncion.firmado`** — emitido por `eceCertDef.firmar`. Payload: `{ certDefId, episodioId, pacienteId, payloadHash, medicoId }`.
- **`ece.certificado_defuncion.certificado`** — emitido por `eceCertDef.certificar`. Payload: `{ certDefId, episodioId, pacienteId, payloadHash, dirUserId }`. **Este es el evento que dispara la cadena de side-effects oficiales** (notificación registro civil, reporte SNIS, emisión de copia, etc.).
- **`cert_def.iniciado`** (planificado) — emitido al crear el certificado en estado `borrador`. Equivalente al INSERT. Útil para tableros operativos.
- **`cert_def.requiere_forense`** (planificado) — emitido cuando `manera ∈ ('violenta','accidente_transito','suicidio','homicidio','en_investigacion')` o `manner ∈ ('homicide','suicide','accident','undetermined')`. Dispara notificación a Medicina Legal y cadena de custodia.
- **`cert_def.rectificado`** (planificado) — emitido al crear documento RECT vinculado al certificado original.
- **`death_certificate.created`** (legacy actual) — implícito vía `auditLog` con `entity = 'DeathCertificate'`, `action = 'CREATE'`, `afterJson.severity = 'HIGH'`, `afterJson.op = 'DEATH_CERTIFY'`. No es outbox del patrón DomainEvent — es solo audit log.
- **`death_certificate.notified_civil_registry`** (legacy stub) — vía `notifyCivilRegistry` mutation. `auditLog` con `op = 'NOTIFY_CIVIL_REGISTRY_STUB'`. **TODO Sprint 6:** integración real con web service RNPN.

Todos los eventos persisten en `DomainEvent` dentro de la misma transacción de la mutación (outbox atómico, Beta.15). El audit log con hash chain SHA-256 es paralelo y siempre se escribe (severity `HIGH`).

---

## Documentos disparados / encadenados

| Documento / Acción | Disparo | Implementación |
|---|---|---|
| **Cierre `Encounter`** | Inmediato (legacy) al crear certificado | `Encounter.dischargedAt = occurredAt`, `dischargeType = 'DEATH'`, `updatedBy = certifiedById`. En misma transacción atómica. |
| **Liberación cama** | Inmediato (legacy) | `BedAssignment.releasedAt = occurredAt` + `reason = 'Defunción'`. `Bed.status = 'DIRTY'` (ciclo de limpieza espera limpieza). |
| **CERT_DIR (revisión administrativa)** | Tras `eceCertDef.certificar` exitoso | Art. 21 NTEC — la Dirección certifica que la copia es fiel al original. Estado de workflow CERT_DIR aún no implementado como entidad separada — la certificación está embebida como transición de estado dentro del propio CERT_DEF. Gap documental: si se requiere un documento CERT_DIR físicamente separado (e.g. para terceros como aseguradoras), pendiente de modelado. |
| **Reporte SNIS / MINSAL (mortalidad)** | Automático tras `ece.certificado_defuncion.certificado` | Consumer del outbox que agrega la fila a `ReporteMortalidad` (o equivalente). Pendiente de implementación end-to-end. Hoy: el dato está disponible en `ece.certificado_defuncion` para extracción manual o batch. |
| **Notificación al Registro Civil (RNPN)** | Tras certificación | Stub legacy en `deathCertificate.notifyCivilRegistry` — solo marca `notifiedToCivilRegistryAt`. **TODO Sprint 6:** integración real vía web service RNPN. |
| **Cadena de custodia + reporte Fiscalía** | Si `manera ∈ violenta/accidente/suicidio/homicidio/en_investigacion` | Outbox `cert_def.requiere_forense` (planificado). Hoy: alerta manual operativa. |
| **Reporte epidemiológico** | Si la causa es notificable (CIE-10 capítulo I, ciertas zoonosis, materno-perinatal) | Outbox específico (planificado). Vía MINSAL Sistema de Vigilancia Epidemiológica. |
| **Reporte materno-perinatal** | Si fallecimiento materno o neonatal | Notificación obligatoria MINSAL (formulario específico). Hoy manual. |
| **Manejo de cadáver / morgue** | Inmediato | Registro de morgue, entrega a funeraria, autopsia si aplica. TDR §8.7 línea 489. Módulo morgue pendiente — hoy gestión manual con bitácora. |
| **Cierre de cuenta hospitalaria** | Tras certificación | Liquidación administrativa final con ISSS si derechohabiente (Art. 15 lit. d), o particular. Cruza con módulo de facturación. |
| **Marca `Patient.fallecido` (estado derivado)** | **NO se persiste explícitamente** | El "estado fallecido" del paciente se **deriva de la existencia de `DeathCertificate` + `Encounter` cerrado con `dischargeType = DEATH`** (TDR §5.5 regla 7). El paciente NO se soft-deleta — la HCE persiste para auditoría 5–10 años (Art. 35). |
| **Documento RECT (rectificación)** | Manual cuando se detecta error post-firma | RECT enlaza al certificado original via FK + describe los campos rectificados. El original permanece inmutable. Modelado pendiente como documento NTEC tipo RECT en `ece.documento_instancia`. |

---

## Drift conocido

Hallazgos del audit Stream C (2026-05-19, `docs/audit/2026-05-19_audit_stream_c_cierre_cumplimiento.md`) y observaciones complementarias:

- **B-01 (P0 BLOQUEANTE — RESUELTO 2026-05-19)** — Schema drift masivo en `ece.certificado_defuncion`: 7 columnas de workflow referenciadas en el router (`estado_workflow`, `firmado_en`, `validado_en`, `certificado_en`, `anulado_en`, `payload_hash`, `medico_firmante_id`) **no existían en BD**. Resuelto con `sql/99_certificado_defuncion_workflow.sql` aplicado a Supabase. Trigger `trg_bloquea_certdef` activo.
- **B-02 (P1 ALTO)** — `withWorkflowContext` (renombrado desde `withEceContext`) **no demota rol a `authenticated`** en ciertas rutas → RLS no aplica en producción para documentos ECE críticos. Filtro `WHERE establecimiento_id = :est` es la única barrera. Bloqueante para multi-tenant real. Pendiente de fix transversal.
- **B-03 (P1 ALTO — RESUELTO)** — `validar()` antes pedía solo el ID sin PIN — no había no-repudio del validador. Fix aplicado: `firmaPin` ahora requerido y verificado contra `ece.firma_electronica`.
- **B-04 (P1 ALTO — RESUELTO)** — `create()` no validaba que `tipo_egreso = 'fallecido'` en la epicrisis vinculada. Fix aplicado: query SQL verifica y rechaza con `BAD_REQUEST: epicrisis_no_es_fallecido`.
- **B-05 (P1 ALTO — RESUELTO 2026-05-19)** — `public."DeathCertificate"` legacy carecía de inmutabilidad y de NOT NULL en `basicCauseCode`. Fix aplicado: `ALTER COLUMN basicCauseCode SET NOT NULL` + trigger `trg_bloquea_death_cert` (bloquea cualquier UPDATE/DELETE post-creación).
- **B-06 (P2 MEDIO — PENDIENTE)** — **Dos sistemas paralelos sin reconciliación**: `DeathCertificate` legacy y `ece.certificado_defuncion` NTEC operan de forma independiente. No hay bridge `eceBridgeDeath`. Una defunción puede quedar registrada en uno y no en el otro, generando inconsistencia. **Plan de consolidación pendiente** — la regla "adecuar legacy vs duplicar" (CLAUDE.md) aplica claramente aquí: el dominio "defunción" ya está en legacy, la capa NTEC añade workflow normativo (triple firma + PIN + outbox). El refactor debería: (a) crear `eceBridgeDeath.linkDeath(deathCertificateId, ecePacienteId)`, (b) mantener `/encounters/[id]/death` como UI principal de captura clínica, (c) que el ECE se llene como capa documental NTEC sincrónica al certificado legacy, (d) dedupe en sidebar.
- **B-07 (P2 MEDIO)** — CIE-10 hardcoded con ~10 entradas en algunos componentes UI legacy en lugar de usar `deathCertificate.searchIcd10` que ataca `ClinicalConcept` completo. UX inconsistente.
- **B-08 (P2 MEDIO)** — Parseo frágil CIE-10 por split de espacio en algunos formularios (e.g. "J18.9 Neumonía no especificada" → `["J18.9", "Neumonía"]`) — falla con códigos sin descripción o con espacios en descripción.
- **Drift Prisma↔SQL** — Las columnas de workflow añadidas a `ece.certificado_defuncion` (B-01) están **en BD pero no en `schema.prisma`** porque `ece.*` no se modela en Prisma (se opera vía `$queryRaw`/`$executeRaw` con tipos `CertDefRow` declarados a mano en el router). Esto está documentado en el header del router. Cuidado al evolucionar el schema: cambios a la tabla deben actualizar manualmente `CertDefRow` en `certificado-defuncion.router.ts`.
- **Drift de campos NTEC OMS no modelados** — Embarazo reciente/post-parto, causas perinatales estructuradas, distinción mortinato/nacido vivo, colegio médico número snapshot, acuse de entrega de copia al familiar → todos pendientes de modelado en columnas estructuradas. Actualmente capturados en `observaciones` libre o inexistentes.
- **CERT_DIR como entidad separada** — Pendiente decisión: ¿modelarlo como `tipo_documento` separado con su propia tabla `ece.certificacion_director`, o seguir embebido como transición de estado del CERT_DEF?
- **Stub notificación RNPN (TODO Sprint 6)** — `deathCertificate.notifyCivilRegistry` solo setea `notifiedToCivilRegistryAt`. Integración real con web service RNPN pendiente. Crítico para go-live operativo total.

---

## Descripción markdown rica

### El certificado médico de defunción como documento dual: ECE NTEC + legacy operativo

A diferencia de FICHA_IDENT (documento maestro de registro vivo) o EPI_EGR (cierre clínico inmutable), el **Certificado de Defunción es simultáneamente un acto clínico irreversible y un documento legal externo**. Por eso convive en dos capas en HIS:

1. **Capa legacy `public."DeathCertificate"`** — sigue el patrón operativo HIS: 1:1 con paciente (`@unique`), creación atómica que **cierra el encounter** (`dischargeType = DEATH`), **libera la cama** (`DIRTY`), y deja audit log severity `HIGH`. Es la captura clínica en el encuentro abierto. No tiene workflow de firma — la firma es implícita en `certifiedById = ctx.user.id` y el trigger de inmutabilidad post-creación protege la integridad.

2. **Capa ECE `ece.certificado_defuncion`** — sigue el patrón normativo NTEC: 1:1 con episodio + epicrisis, workflow `borrador → firmado → validado → certificado` con **PIN argon2id en cada firma** (triple firma), inmutabilidad post-firma con trigger condicional, outbox transaccional, hash SHA-256 del payload clínico clave. Es la **capa formal del Acuerdo 1616**.

Esta dualidad es **deuda técnica reconocida** (audit B-06) que requiere consolidación vía bridge `eceBridgeDeath` (pendiente). El precedente es `/triage` (legacy) sincronizado a `ece.hoja_triaje` vía `eceBridgeTriage`. Mientras no exista el bridge:

- **UI clínica de captura:** `/encounters/[id]/death` (legacy, una sola página, ágil para emergencia).
- **UI administrativa de listado y visor:** `/deaths` (admin) — ya consume `trpc.eceCertDef.list` (no el router legacy) según comentario de cabecera del page.
- **UI workflow NTEC:** `/ece/defuncion`, `/ece/defuncion/nueva`, `/ece/defuncion/[id]` para la triple firma + validación + certificación + anulación.

### CIE-10 estructurado: causa básica única = ancla de mortalidad SNIS

El **núcleo médico-legal del certificado** es el cuadro CIE-10 estructurado en tres niveles:

```
Causa directa  ──► Evento final que mató al paciente (ej. paro cardiorrespiratorio)
   ▲
Causas intermedias ──► Mecanismo (ej. shock séptico, falla multiorgánica)
   ▲
Causa básica única ──► Enfermedad inicial (ej. neumonía adquirida en comunidad J18.9)
   ▲
Causas concomitantes ──► Contribuyentes no en cadena causal directa (ej. HTA, DM2)
```

La **causa básica** es la pieza única que MINSAL extrae para sus tablas de mortalidad por causa (clasificación SNIS). Todo el resto del certificado contextualiza, pero la causa básica es **el ancla normativa** — por eso `basicCauseCode NOT NULL` en ambas capas (B-05 fix).

Validación Zod: `/^[A-Z][0-9]{2}(\.[0-9A-Z]{0,4})?$/` — letra mayúscula + 2 dígitos + opcional `.` + hasta 4 alfanuméricos. El autocomplete `deathCertificate.searchIcd10` ataca `ClinicalConcept` activo con `codeSystem.code ∈ ('ICD-10','ICD10','CIE-10','CIE10')` (4 variantes de naming aceptadas porque seeds históricos divergen).

### Defunción violenta / sospechosa = forense obligatorio + cadena de custodia

Cuando `manner ∈ ('violenta','accidente_transito','suicidio','homicidio','en_investigacion','undetermined','accident','homicide','suicide')`:

- **Notificación obligatoria a Medicina Legal / Fiscalía** (Art. 21 NTEC + Código Procesal Penal sobre muertes no naturales).
- **Cadena de custodia del cuerpo** — no entrega directa a familiar/funeraria hasta autopsia forense o liberación fiscal.
- **Outbox `cert_def.requiere_forense`** (planificado) dispara notificaciones automáticas.
- **Conservación del expediente 10 años** (Art. 35 NTEC) — no los 5 estándar de muerte natural.
- **Autopsia obligatoria** generalmente, registrada en `autopsia_realizada = true` y referenciada en `observaciones` o módulo morgue.

La distinción operacional clave: la **manera de la muerte** es médico-legal (la decide el médico certificante o forense), mientras que la **causa** es clínica (el diagnóstico CIE-10). Pueden coexistir natural + cualquier CIE-10 (e.g. infarto natural), o violenta + traumatismo (e.g. accidente vehicular X95).

### `hora_defuncion` es base legal de plazos

`fecha_hora_defuncion TIMESTAMPTZ NOT NULL` con resolución de segundos es el **timestamp ancla legal** para:

- Plazo de inscripción en registro civil (Ley del Registro del Estado Familiar — usualmente 8 días en El Salvador).
- Cómputo de sucesión y herencia.
- Pago de seguros de vida (fecha exacta del siniestro).
- Cómputo de Art. 35 NTEC conservación del expediente.
- Cierre del encounter: `Encounter.dischargedAt = occurredAt` (no `now()`).

Validación implementada: `occurredAt >= encounter.admittedAt` (no puede ser anterior a la admisión). Validación pendiente: no puede ser futuro (gap menor — el formulario lo prevendría pero no el backend explícitamente).

### Rectificación es inmutable: se crea RECT, no se modifica el original

Si tras la firma se detecta un error en el certificado (e.g. causa CIE-10 incorrecta, hora de defunción errónea), **NUNCA se modifica el certificado original**. El trigger de BD bloqueará la mutación. En su lugar:

1. Se crea un nuevo documento NTEC tipo **RECT (Rectificación)** que:
   - Enlaza al certificado original via FK (`rect.certificado_defuncion_original_id`).
   - Describe los campos rectificados con valor anterior + valor nuevo.
   - Lleva firma del médico que rectifica + Director del establecimiento.
2. El original permanece **consultable e inmutable**.
3. Las **copias emitidas** referencian la versión vigente con anotación de rectificación.
4. **Notificación al RNPN** debe gestionar la rectificación del acta civil correspondiente (gap operativo — flujo manual hoy).

Modelado del documento RECT está pendiente en `ece.documento_instancia` con `tipo_documento.codigo = 'RECT'`. Hoy hay un workaround operativo: anular el certificado pre-certificación y emitir uno nuevo (solo válido si NO se ha certificado y notificado).

### Reporte SNIS automático tras firma — pipeline pendiente

Tras `ece.certificado_defuncion.certificado` (outbox event), el flujo previsto:

1. **Consumer SNIS** suscrito al outbox extrae las columnas necesarias para el reporte mensual de mortalidad MINSAL: `paciente_id`, `fecha_hora_defuncion`, `causa_basica_cie10`, `causas_intermedias_cie10`, `manera`, `establecimiento_id`, datos demográficos del paciente (sexo, edad calculada, residencia).
2. **Agregación a `ReporteMortalidad`** (tabla pendiente) con periodo mensual.
3. **Export a MINSAL** vía formato estandarizado (CSV / archivo SISMOR o equivalente actual).

Hoy el flujo es manual: ESDOMED / Estadística extrae periódicamente vía query SQL directa o el módulo de reportes. La automatización está en backlog Fase 3 (BI).

### Por qué `Patient` NO se soft-deleta tras defunción

Decisión arquitectónica TDR §5.5 regla 7: tras crear `DeathCertificate`, **`Patient.deletedAt` permanece NULL**. Razones:

1. **La HCE debe persistir 5–10 años** post-defunción (Art. 35 NTEC).
2. **Consultas legales, periciales, epidemiológicas** requieren acceso completo al expediente.
3. **Búsquedas por familiares, aseguradoras, autoridad judicial** deben localizar el paciente.
4. **El "estado fallecido" se deriva** de la existencia de `DeathCertificate` + `Encounter` cerrado con `dischargeType = DEATH`.

La UI de búsqueda muestra el paciente con badge "Fallecido" en lugar de ocultarlo. La protección de privacidad post-defunción se gestiona por roles (acceso restringido a `ESDOMED`, `MEDICO_LEGAL`, `DIR`, `FAMILIAR_AUTORIZADO`) en lugar de soft-delete.

### Workflow triple firma con PIN argon2id — defensa profundidad

La capa ECE implementa **triple firma electrónica** con PIN porque cada transición tiene implicaciones legales distintas:

1. **Firma MC (borrador → firmado):** acto médico — el médico certifica que las causas son su mejor juicio clínico. Equivale a la firma manuscrita en el certificado papel histórico.
2. **Validación MC (firmado → validado):** segunda revisión clínica — par revisor confirma codificación CIE-10 y consistencia clínica. B-03 fix: requiere PIN del validador (no solo permission check) — establece no-repudio del validador.
3. **Certificación DIR (validado → certificado):** acto administrativo Art. 21 — Director (o delegado) certifica que el documento es fiel y autoriza emisión de copias formales. Es la firma que habilita la notificación oficial al RNPN.

Cada PIN se hashea con **argon2id** (CPU-hard, memory-hard, resistente a GPU brute-force). Lockout tras 3 intentos fallidos. Revocación granular por usuario. El payload firmado se hashea SHA-256 y se persiste para detección de tamper post-firma. Toda la traza queda en `audit.audit_log` con hash chain SHA-256 (cadena criptográfica inmutable de toda la actividad).

### Cobertura normativa actual y plan

| Aspecto NTEC Art. 21/40 | Cobertura | Gap pendiente |
|---|---|---|
| CIE-10 estructurado causa básica + intermedias + directa | **Sí** (ECE + legacy con `basicCauseCode NOT NULL`) | — |
| Manera de muerte categorizada | **Sí** (`manner` legacy / `manera` ECE) | — |
| Firma médico certificante con identificación | **Sí** (legacy via `certifiedById`, ECE via triple firma PIN) | Snapshot de `colegio_medico_no` no modelado |
| Inmutabilidad post-firma | **Sí** (triggers BD en ambas capas, B-01 + B-05 fix) | — |
| Workflow normativo triple firma (Art. 21 DIR certifica) | **Sí** (capa ECE) | Solo en ECE — capa legacy no tiene workflow |
| Outbox eventos para side-effects | **Parcial** (firmado + certificado emitidos, requiere_forense pendiente) | Eventos forense/SNIS/RNPN pendientes |
| Notificación RNPN automática | **Stub** (`notifyCivilRegistry` solo marca timestamp) | Integración real Sprint 6 |
| Reporte SNIS / MINSAL mortalidad | **Manual** (extracción SQL) | Pipeline automatizado pendiente |
| Reconciliación capa legacy ↔ capa ECE | **No** (sistemas paralelos B-06) | Bridge `eceBridgeDeath` pendiente |
| Campos OMS especiales (embarazo, perinatal) | **No estructurados** (en `observaciones` libre) | Modelado de columnas específicas |
| Documento RECT para rectificación | **No modelado** (workaround: anular pre-certificación) | Tipo de documento RECT en `ece.documento_instancia` |
| Acuse entrega copia familiar | **No modelado** (flujo manual) | Tabla `ece.entrega_certificado_defuncion` |
| Conservación 5–10 años por manera (Art. 35) | **Documentado** | Job de retención automática pendiente |

User Stories del epic Fase 2 que cubren este documento (backlog fase 2):

- US.F2.6 series — cierre del episodio hospitalario con `tipo_egreso = 'fallecido'`.
- US.F2.7.x — workflow ECE certificado de defunción (triple firma + outbox).
- B-01 a B-08 — remediation audit Stream C (en su mayoría resueltos en 2026-05-19).
- US.Sprint6 — integración real RNPN web service.
- US.bridge-death — `eceBridgeDeath` para consolidación legacy↔ECE (pendiente).
