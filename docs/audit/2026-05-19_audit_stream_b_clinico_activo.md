# Auditoría UI ↔ ORM ↔ DB — Stream B: Flujo Clínico Activo

**Fecha:** 2026-05-19
**Auditor:** @AS + @DBA (HIS Multipaís Avante)
**Rama:** `docs/audit-stream-b`
**Metodología:** Lectura de código fuente + consulta directa a Supabase (información_schema, pg_constraint, pg_trigger, pg_proc). Solo lectura — sin modificaciones.

---

## Índice

1. [Módulo 1 — Historia Clínica ECE (`ece.historia_clinica`)](#modulo-1)
2. [Módulo 2 — Indicaciones Médicas (`ece.indicaciones_medicas`)](#modulo-2)
3. [Módulo 3 — eMAR / Bedside BCMA (`pharmacy/emar`, `ece.bedside_validation`)](#modulo-3)
4. [Módulo 4 — Farmacia (`/pharmacy/*`)](#modulo-4)
5. [Resumen Stream B](#resumen-stream-b)

---

## Módulo 1 — Historia Clínica ECE {#modulo-1}

### 1.1 Resumen ejecutivo

La Historia Clínica ECE vive exclusivamente en el schema `ece` (`ece.historia_clinica`, `ece.indicacion_item`, `ece.indicaciones_medicas`). No existe una UI dedicada en `apps/web/src/app/(clinical)/ece/historia-clinica/` — la ruta especificada en el alcance no existe en el repositorio. El único componente relacionado es `ece/icd10-picker/icd10-picker.tsx`. El acceso a estos documentos se realiza a través de los routers ECE (`comite-ece.router.ts`, `epicrisis.router.ts`, `icd10.router.ts`) pero **ninguno de ellos expone procedimientos para crear/leer `ece.historia_clinica` directamente**. El modelo de datos en BD existe y está correctamente estructurado, pero la capa de presentación y la capa de acceso ORM están ausentes para este documento clínico.

### 1.2 Matriz de trazabilidad

| # | Campo UI | Atributo payload | Prop DTO/Zod | Prop Entidad ORM | Columna DB | Tipo UI | Tipo Zod | Tipo Prisma | Tipo SQL | Req UI | NotNull Zod/ORM | NOT NULL DB | Long UI | Long ORM | Long DB | FK/Catálogo | Val UI | Val Zod | Constraint DB | Observación |
|---|----------|-----------------|--------------|-----------------|-----------|---------|---------|------------|---------|--------|----------------|------------|---------|---------|---------|------------|--------|---------|--------------|-------------|
| 1 | — (sin UI) | — | — | — | `id` | — | — | — | uuid | — | — | NO | — | — | — | — | — | — | PK |
| 2 | — | — | — | — | `instancia_id` | — | — | — | uuid | — | — | NO | — | — | — | FK `documento_instancia` | — | — | FK ECE workflow | Sin ORM ni UI |
| 3 | — | — | — | — | `episodio_id` | — | — | — | uuid | — | — | NO | — | — | — | FK `episodio_hospitalario` | — | — | FK episodio | Sin ORM ni UI |
| 4 | — | — | — | — | `tipo_consulta` | — | — | — | text | — | — | NO | — | — | — | — | — | — | NTEC tipo consulta | Sin ORM ni UI |
| 5 | — | — | — | — | `motivo_consulta` | — | — | — | text | — | — | YES | — | — | — | — | — | — | NTEC campo clínico | Sin ORM ni UI |
| 6 | — | — | — | — | `enfermedad_actual` | — | — | — | text | — | — | YES | — | — | — | — | — | — | NTEC campo clínico | Sin ORM ni UI |
| 7 | — | — | — | — | `disposicion` | — | — | — | text | — | — | YES | — | — | — | — | — | — | NTEC disposición | Sin ORM ni UI |
| 8 | — | — | — | — | `plan_manejo` | — | — | — | text | — | — | YES | — | — | — | — | — | — | NTEC plan | Sin ORM ni UI |
| 9 | — | — | — | — | `antecedentes` | — | — | — | jsonb | — | — | YES | — | — | — | — | — | — | NTEC antecedentes | Sin ORM ni UI |
| 10 | — | — | — | — | `examen_fisico` | — | — | — | jsonb | — | — | YES | — | — | — | — | — | — | NTEC examen | Sin ORM ni UI |
| 11 | — | — | — | — | `diagnosticos` | — | — | — | jsonb | — | — | YES | — | — | — | Estructura interna JSON no validada | — | — | NTEC diagnósticos CIE-10 | Sin ORM ni UI |
| 12 | — | — | — | — | `registrado_por` | — | — | — | uuid | — | — | NO | — | — | — | FK `personal_salud` | — | — | FK auditoría | Sin ORM ni UI |
| 13 | — | — | — | — | `registrado_en` | — | — | — | timestamptz | — | — | NO | — | — | — | — | — | — | Timestamp registro | Sin ORM ni UI |
| 14 | — | — | — | — | `estado_registro` | — | — | — | text | — | — | NO | — | — | — | Enum NTEC no confirmado | — | — | Estados workflow | Sin ORM ni UI; tipo text sin enum constraint |

### 1.3 Hallazgos

#### HC-001 [P0 — CRÍTICO] Ruta UI completamente ausente

**Descripción:** La ruta `/ece/historia-clinica` especificada en el alcance no existe en el repositorio. No hay página, componente, ni router tRPC que exponga operaciones CRUD para `ece.historia_clinica`.

**Impacto clínico:** El médico no puede registrar la historia clínica ECE desde la aplicación. Flujo clínico bloqueado para hospitalización. Incumple NTEC Art. 7 (registro obligatorio de historia clínica en cada atención).

**Ruta afectada:** `apps/web/src/app/(clinical)/ece/` — directorio tiene solo `icd10-picker/`.

**Remediación:** Crear router tRPC `ece/historia-clinica.router.ts` con procedures `draft`, `sign`, `get`, `list`. Crear página `(clinical)/ece/historia-clinica/[episodioId]/page.tsx` con formulario NTEC. Mapear `ece.historia_clinica` en `schema.prisma` (schema `ece`) o usar `$queryRaw` con tipado explícito.

**Riesgo Go-Live:** BLOQUEANTE — el módulo no puede entrar a producción sin esta implementación.

---

#### HC-002 [P0 — CRÍTICO] Sin router tRPC para historia_clinica

**Descripción:** Los únicos routers en `packages/trpc/src/routers/ece/` son `comite-ece.router.ts`, `epicrisis.router.ts` e `icd10.router.ts`. Ninguno toca `ece.historia_clinica`.

**Impacto:** Toda escritura clínica a HC debe ir por la tabla ECE directamente (sin RLS demote, sin audit hash-chain). Riesgo de bypass de seguridad si alguien escribe directo a Supabase.

**Remediación:** Implementar router con `withTenantContext` + anclar a `audit.AuditLog`.

---

#### HC-003 [P1 — ALTO] `estado_registro` es `text` sin enum constraint en DB

**Descripción:** La columna `ece.historia_clinica.estado_registro` es `text NOT NULL` sin CHECK constraint ni enum Postgres. Los estados válidos (BORRADOR, FIRMADO, etc.) no están garantizados a nivel de BD.

**Impacto:** Inserción de valores inválidos no bloqueada por la BD. Inconsistencia en filtros de workflow.

**Remediación:** Crear enum Postgres `ece.EstadoRegistroHC` o añadir CHECK constraint con estados válidos NTEC.

---

#### HC-004 [P1 — ALTO] `diagnosticos` es JSONB sin validación de estructura CIE-10

**Descripción:** `ece.historia_clinica.diagnosticos` almacena diagnósticos como JSONB sin schema validado. No hay CHECK constraint que garantice que cada entrada tenga código CIE-10 válido.

**Impacto (C7):** La validación de formato CIE-10 existe en `packages/contracts/src/schemas/` (icd10.ts vía el picker) pero no en la BD. Un insert directo puede omitir el código CIE-10 completamente.

**Remediación:** Añadir CHECK constraint JSON schema validation o columna estructurada `codigo_cie10 VARCHAR(10) NOT NULL` con FK a `ece.icd10_combinacion_invalida` o catálogo.

---

#### HC-005 [P2 — MEDIO] Sin trigger de inmutabilidad en `historia_clinica`

**Descripción:** La tabla `ece.historia_clinica` no tiene triggers de inmutabilidad (solo `ece.bedside_validation` tiene `trg_bedside_validation_immutable`). Un documento firmado puede ser modificado directamente en BD.

**Impacto (C12):** Violación de principio NTEC Art. 7 de integridad documental. El hash-chain de audit detecta la modificación pero no la previene.

**Remediación:** Agregar trigger `BEFORE UPDATE OR DELETE` que verifique `estado_registro = 'FIRMADO'` y rechace cambios en campos clínicos.

### 1.4 Riesgo Go-Live

| Hallazgo | Severidad | Riesgo Go-Live |
|----------|-----------|---------------|
| HC-001 Sin UI | P0 | BLOQUEANTE — sin módulo funcional |
| HC-002 Sin router | P0 | BLOQUEANTE — sin acceso API |
| HC-003 estado_registro sin enum | P1 | ALTO — integridad de workflow |
| HC-004 diagnosticos sin validación CIE-10 | P1 | ALTO — compliance NTEC |
| HC-005 Sin inmutabilidad | P2 | MEDIO — integridad documental post-firma |

---

## Módulo 2 — Indicaciones Médicas ECE {#modulo-2}

### 2.1 Resumen ejecutivo

Las indicaciones médicas existen en BD (`ece.indicaciones_medicas`, `ece.indicacion_item`, `ece.administracion_medicamento`) con estructura coherente. No existe ruta UI dedicada `/ece/indicaciones` ni router tRPC específico — igual que Historia Clínica, el módulo carece de capa de presentación y acceso ORM. La tabla `ece.administracion_medicamento` es la contraparte ECE del `MedicationAdministration` público, con campos para administración de enfermería (hora_programada, hora_aplicada, estado, motivo_omision). La columna `indicacion_item.dosis` es `text` libre, a diferencia del esquema controlado (`dose DECIMAL`, `doseUnit VARCHAR`) del bounded context `pharmacy`. Esta divergencia es un hallazgo de tipo C3/C7 para el flujo BCMA.

### 2.2 Matriz de trazabilidad

| # | Campo UI | Atributo payload | Prop DTO/Zod | Prop Entidad ORM | Columna DB | Tipo UI | Tipo Zod | Tipo Prisma | Tipo SQL | Req UI | NotNull Zod/ORM | NOT NULL DB | Long UI | Long ORM | Long DB | FK/Catálogo | Val UI | Val Zod | Constraint DB | Observación |
|---|----------|-----------------|--------------|-----------------|-----------|---------|---------|------------|---------|--------|----------------|------------|---------|---------|---------|------------|--------|---------|--------------|-------------|
| 1 | — | — | — | — | `indicaciones_medicas.id` | — | — | — | uuid | — | — | NO | — | — | — | PK | — | — | — | Sin UI/ORM |
| 2 | — | — | — | — | `indicaciones_medicas.episodio_id` | — | — | — | uuid | — | — | NO | — | — | — | FK `episodio_hospitalario` | — | — | FK | Sin UI/ORM |
| 3 | — | — | — | — | `indicaciones_medicas.medico_prescriptor` | — | — | — | uuid | — | — | NO | — | — | — | FK `personal_salud` | — | — | FK | Sin UI/ORM |
| 4 | — | — | — | — | `indicaciones_medicas.version` | — | — | — | smallint | — | — | NO | — | — | — | — | — | — | Versión para optimistic lock | Sin UI/ORM |
| 5 | — | — | — | — | `indicaciones_medicas.vigencia` | — | — | — | text | — | — | NO | — | — | — | — | — | — | ACTIVA/SUSPENDIDA/CANCELADA (texto libre) | Sin enum constraint |
| 6 | — | — | — | — | `indicaciones_medicas.estado_registro` | — | — | — | text | — | — | NO | — | — | — | — | — | — | Misma anomalía que HC | Sin enum constraint |
| 7 | — | — | — | — | `indicacion_item.tipo` | — | — | — | text | — | — | NO | — | — | — | — | — | — | MEDICAMENTO/PROCEDIMIENTO/DIETA/etc. | Sin enum; tipo libre |
| 8 | — | — | — | — | `indicacion_item.descripcion` | — | — | — | text | — | — | NO | — | — | — | — | — | — | Texto libre | Desestructurado |
| 9 | — | — | — | — | `indicacion_item.dosis` | — | — | — | text | — | — | YES | — | — | — | — | — | — | "500mg" como string libre | C3: discrepa con pharmacy.dispensationInputSchema (dose: number + doseUnit: string) |
| 10 | — | — | — | — | `indicacion_item.via` | — | — | — | text | — | — | YES | — | — | — | — | — | — | Texto libre "IV", "VO", etc. | C3: discrepa con routeEnum del pharmacy schema (enum validado) |
| 11 | — | — | — | — | `indicacion_item.frecuencia` | — | — | — | text | — | — | YES | — | — | — | — | — | — | Texto libre "c/8h" | C3: discrepa con frequencyEnum (QD, BID, TID, etc.) |
| 12 | — | — | — | — | `administracion_medicamento.indicacion_item_id` | — | — | — | uuid | — | — | NO | — | — | — | FK `indicacion_item` | — | — | FK | Sin UI/ORM |
| 13 | — | — | — | — | `administracion_medicamento.hora_programada` | — | — | — | timestamptz | — | — | YES | — | — | — | — | — | — | Slot eMAR | Nullable en BD |
| 14 | — | — | — | — | `administracion_medicamento.hora_aplicada` | — | — | — | timestamptz | — | — | YES | — | — | — | — | — | — | Hora real | Nullable en BD |
| 15 | — | — | — | — | `administracion_medicamento.estado` | — | — | — | text | — | — | NO | — | — | — | — | — | — | Texto libre | Sin enum constraint; discrepa con MedAdminStatus |
| 16 | — | — | — | — | `administracion_medicamento.motivo_omision` | — | — | — | text | — | — | YES | — | — | — | — | — | — | — | Requerido lógicamente cuando estado=OMITIDA pero DB no lo fuerza |
| 17 | — | — | — | — | `administracion_medicamento.responsable` | — | — | — | uuid | — | — | NO | — | — | — | FK `personal_salud` | — | — | FK | Sin UI/ORM |

### 2.3 Hallazgos

#### IND-001 [P0 — CRÍTICO] Ruta UI y router completamente ausentes

**Descripción:** Igual que HC-001. La ruta `/ece/indicaciones` no existe. No hay router tRPC para `ece.indicaciones_medicas`.

**Impacto clínico:** El médico no puede prescribir indicaciones en formato ECE. La enfermería no puede consultar ni registrar administraciones. Flujo BCMA no puede iniciarse desde indicaciones ECE.

**Remediación:** Router `ece/indicaciones.router.ts` + páginas `(clinical)/ece/indicaciones/[episodioId]/page.tsx`.

---

#### IND-002 [P1 — ALTO] `indicacion_item.dosis/via/frecuencia` son `text` libre (C3 — tipo discrepa)

**Descripción:** Los campos farmacológicos de `ece.indicacion_item` (dosis, via, frecuencia) son `text` libre sin validación de formato, mientras que el bounded context `pharmacy` usa tipos estrictos: `dose: DECIMAL(12,4)`, `route: AdminRoute` (enum), `frequency: VARCHAR(80)` con enum Zod (`QD`, `BID`, `TID`, etc.).

**Impacto (C3):** El puente ECE↔pharmacy no puede hacer join estructurado. Si se automatiza la generación de prescripciones desde indicaciones ECE, la transformación de string a decimal/enum puede fallar silenciosamente (ej. "500mg" → NaN).

**Remediación:** Añadir columnas estructuradas `dosis_valor DECIMAL(12,4)`, `dosis_unidad VARCHAR(20)`, `via_codigo TEXT` con CHECK usando los mismos valores que `AdminRoute`. Mantener `dosis` como campo legacy para transición.

---

#### IND-003 [P1 — ALTO] `administracion_medicamento.estado` sin enum — hardstop BCMA no garantizado (C12)

**Descripción:** `ece.administracion_medicamento.estado` es `text NOT NULL` sin CHECK constraint. Un insert con estado inválido (e.g. `"DADO"` en lugar de `"ADMINISTRADO"`) no es rechazado por la BD.

**Impacto:** El trigger `fn_emar_immutable_post_administered` de `public.MedicationAdministration` garantiza inmutabilidad post-`ADMINISTERED`, pero `ece.administracion_medicamento` no tiene trigger equivalente. Un registro ECE de administración puede ser modificado post-hecho.

**Remediación:** Crear enum `ece.EstadoAdminMed` con valores normalizados + trigger de inmutabilidad análogo al de `MedicationAdministration`.

---

#### IND-004 [P2 — MEDIO] `motivo_omision` nullable sin constraint condicional

**Descripción:** Cuando `estado = 'OMITIDA'` o similar, `motivo_omision` debería ser obligatorio (NTEC exige documentar omisiones). La BD lo permite como NULL incondicionalmente.

**Remediación:** CHECK constraint `(estado NOT IN ('OMITIDA','RECHAZADA') OR motivo_omision IS NOT NULL)`.

---

#### IND-005 [P2 — MEDIO] `indicaciones_medicas.vigencia` sin enum constraint (C5)

**Descripción:** Campo `vigencia` es `text NOT NULL` sin valores controlados. Debería ser ACTIVA | SUSPENDIDA | CANCELADA per NTEC.

**Remediación:** CHECK constraint o enum Postgres.

### 2.4 Riesgo Go-Live

| Hallazgo | Severidad | Riesgo Go-Live |
|----------|-----------|---------------|
| IND-001 Sin UI/router | P0 | BLOQUEANTE |
| IND-002 Tipos dosis/via/frecuencia discrepan | P1 | ALTO — puente ECE↔pharmacy roto |
| IND-003 Sin inmutabilidad administraciones ECE | P1 | ALTO — integridad clínica |
| IND-004 motivo_omision nullable | P2 | MEDIO |
| IND-005 vigencia sin enum | P2 | MEDIO |

---

## Módulo 3 — eMAR / Bedside BCMA {#modulo-3}

### 3.1 Resumen ejecutivo

Existen **dos implementaciones paralelas del BCMA** que no están integradas:

1. **Capa `public` (Wave 1):** `pharmacy.router.ts` → `administrationEvent` (modelo **fantasma** — no existe en `schema.prisma` ni en BD). El router usa `prisma.administrationEvent` que Prisma nunca generó; el código no compila contra la BD real.

2. **Capa `ece` (ECE Wave):** `ece.bedside_validation` + `ece.administracion_medicamento`. Esta es la implementación real en BD, con triggers de inmutabilidad (`trg_bedside_validation_immutable`) y estructura completa (nurse_gsrn, patient_gsrn, gtin, lote, serie, hard_stop_code).

La UI `/pharmacy/emar` está cableada al router `pharmacy.administer.record` (Wave 1 / modelos fantasma). No está cableada a `ece.bedside_validation`. Por tanto, **el flujo BCMA activo en UI apunta a tablas que no existen en Supabase** — cualquier intento de administrar un medicamento resulta en error 500 en producción.

Los hardstops del BCMA (5R + doble verificación) están implementados correctamente en la lógica del router Wave 1 (`guardFiveRights`, `guardDoubleVerification`) pero son inaccesibles porque los modelos subyacentes no existen. Los hardstops de la capa ECE (`ece.bedside_validation.hard_stop_code`, trigger immutable) están en BD pero sin surface en la UI.

### 3.2 Matriz de trazabilidad

#### 3.2.1 UI `/pharmacy/emar` → Router `pharmacy.administer.record` (Wave 1 — modelos fantasma)

| # | Campo UI | Atributo payload | Prop DTO/Zod | Prop Entidad ORM | Columna DB | Tipo UI | Tipo Zod | Tipo Prisma | Tipo SQL | Req UI | NotNull Zod/ORM | NOT NULL DB | Long UI | Long ORM | Long DB | FK/Catálogo | Val UI | Val Zod | Constraint DB | Observación |
|---|----------|-----------------|--------------|-----------------|-----------|---------|---------|------------|---------|--------|----------------|------------|---------|---------|---------|------------|--------|---------|--------------|-------------|
| 1 | Input "Escaneo pulsera paciente" | `fiveRights.scannedPatientCode` | `z.string().min(1)` | `AdministrationEvent` (FANTASMA) | **NO EXISTE** | text | string | — | — | SI | SI | — | — | — | — | — | min(1) | — | **C1 — huérfano UI; modelo ORM inexistente** |
| 2 | Input "Escaneo barcode medicamento" | `fiveRights.scannedMedicationBarcode` | `z.string().min(1)` | `AdministrationEvent` (FANTASMA) | **NO EXISTE** | text | string | — | — | SI | SI | — | — | — | — | — | min(1) | — | **C1 — huérfano UI; modelo ORM inexistente** |
| 3 | Checkbox "Dosis confirmada" | `fiveRights.doseConfirmed` | `z.boolean()` | `AdministrationEvent` (FANTASMA) | **NO EXISTE** | checkbox | boolean | — | — | SI | SI | — | — | — | — | — | boolean | — | **C1 — huérfano UI; modelo ORM inexistente** |
| 4 | Checkbox "Vía confirmada" | `fiveRights.routeConfirmed` | `z.boolean()` | `AdministrationEvent` (FANTASMA) | **NO EXISTE** | checkbox | boolean | — | — | SI | SI | — | — | — | — | — | boolean | — | **C1 — huérfano UI; modelo ORM inexistente** |
| 5 | `administeredAt` (Date implícito) | `fiveRights.administeredAt` | `z.coerce.date()` | `AdministrationEvent` (FANTASMA) | **NO EXISTE** | — | date | — | — | SI | SI | — | — | — | — | — | date | — | **C1** |
| 6 | Input "Segundo enfermero UUID" | `secondNurseId` | `z.string().uuid().optional()` | `AdministrationEvent` (FANTASMA) | **NO EXISTE** | text | uuid | — | — | Cond (alto riesgo) | NO | — | — | — | — | — | uuid optional | — | **C1; guard doble-verificación inaccesible** |
| 7 | — | `scheduledTime` | `z.coerce.date()` | `AdministrationEvent` (FANTASMA) | **NO EXISTE** | (implícito new Date()) | date | — | — | SI | SI | — | — | — | — | — | — | — | **C1; scheduledTime = new Date() en eMAR — violación del Right Time 5R** |

#### 3.2.2 BD real `ece.bedside_validation` (sin superficie UI ni router)

| # | Campo UI | Atributo payload | Prop DTO/Zod | Prop Entidad ORM | Columna DB | Tipo UI | Tipo Zod | Tipo Prisma | Tipo SQL | Req UI | NotNull Zod/ORM | NOT NULL DB | Long UI | Long ORM | Long DB | FK/Catálogo | Val UI | Val Zod | Constraint DB | Observación |
|---|----------|-----------------|--------------|-----------------|-----------|---------|---------|------------|---------|--------|----------------|------------|---------|---------|---------|------------|--------|---------|--------------|-------------|
| 1 | — | — | — | — | `nurse_gsrn` | — | — | — | text NOT NULL | — | — | NO | — | — | — | GSRN-18 format | — | — | Sin CHECK GSRN format | **C2 — fantasma DB; sin UI** |
| 2 | — | — | — | — | `patient_gsrn` | — | — | — | text NOT NULL | — | — | NO | — | — | — | GSRN-18 format | — | — | Sin CHECK GSRN format | **C2 — fantasma DB; sin UI** |
| 3 | — | — | — | — | `gtin` | — | — | — | text NOT NULL | — | — | NO | — | — | — | GTIN-14 | — | — | Sin CHECK GTIN-14 format | **C2 + C7 — sin validación formato GTIN** |
| 4 | — | — | — | — | `hard_stop_code` | — | — | — | text NULL | — | — | YES | — | — | — | Enum lógico | — | — | Sin enum constraint | **C2 — fantasma DB; sin UI** |
| 5 | — | — | — | — | `status` | — | — | — | text NOT NULL | — | — | NO | — | — | — | PASS/FAIL/BLOCKED | — | — | Sin enum constraint | **C2 + C3 — texto libre** |

#### 3.2.3 `MedicationAdministration` (public) — tabla real en BD, usada por routers beta

| # | Campo UI | Atributo payload | Prop DTO/Zod | Prop Entidad ORM | Columna DB | Tipo UI | Tipo Zod | Tipo Prisma | Tipo SQL | Req UI | NotNull Zod/ORM | NOT NULL DB | Long UI | Long ORM | Long DB | FK/Catálogo | Val UI | Val Zod | Constraint DB | Observación |
|---|----------|-----------------|--------------|-----------------|-----------|---------|---------|------------|---------|--------|----------------|------------|---------|---------|---------|------------|--------|---------|--------------|-------------|
| 1 | — | — | — | `patientBarcodeScanned` | `patientBarcodeScanned` | — | — | Boolean | boolean | NO | NO | NO (default false) | — | — | — | — | — | — | default false | **C11 — BCMA real exige scan; la BD no lo requiere** |
| 2 | — | — | — | `drugBarcodeScanned` | `drugBarcodeScanned` | — | — | Boolean | boolean | NO | NO | NO (default false) | — | — | — | — | — | — | default false | **C11 — ídem** |
| 3 | — | — | — | `providerBadgeScanned` | `providerBadgeScanned` | — | — | Boolean | boolean | NO | NO | NO (default false) | — | — | — | — | — | — | default false | **C11 — tercer scan BCMA sin enforce NOT NULL ni CHECK** |
| 4 | — | — | — | `secondVerifierId` | `secondVerifierId` | — | — | String? | uuid NULL | — | — | YES | — | — | — | FK User | — | — | CHECK `secondVerifierId <> administeredById` | CHECK presente; correcto |
| 5 | — | — | — | `status` | `status` | — | — | MedAdminStatus | USER-DEFINED | — | — | NO | — | — | — | enum BD | — | — | enum `MedAdminStatus` | Valores: GIVEN/HELD/REFUSED/MISSED/DOCUMENTED_LATE/CANCELED — **C3 discrepa** con pharmacy Wave 1 que usa "Administered" |
| 6 | — | — | — | `scheduledTime` | `scheduledTime` | — | — | DateTime? | timestamptz NULL | — | — | YES | — | — | — | — | — | — | nullable | **C5 — nullable aunque lógicamente requerido para Right Time 5R** |

### 3.3 Hallazgos

#### BCMA-001 [P0 — CRÍTICO] Router `pharmacy.administer.record` usa modelos ORM inexistentes — BCMA no funcional en producción

**Descripción:** El router `pharmacy.router.ts` (líneas 1241-1450) invoca `prisma.administrationEvent`, `prisma.prescriptionLine` y `prisma.dispensationEvent`. Ninguno de estos modelos existe en `packages/database/prisma/schema.prisma` ni en la BD Supabase. La tabla `prescription_line`, `dispensation_event` y `administration_event` simplemente no existen. El archivo SQL `10_pharmacy_rls.sql` crea triggers sobre ellas pero nunca se aplicó el DDL de creación de las tablas.

**Impacto clínico:** Cualquier llamada a `pharmacy.administer.record` desde `/pharmacy/emar` lanza `PrismaClientKnownRequestError` o un error de modelo inexistente en runtime. Los 5R y el guard de doble verificación son código muerto. Un paro total del BCMA en producción podría derivar en errores de medicación sin registro.

**Ruta afectada:** `packages/trpc/src/routers/pharmacy.router.ts:1249`, `1277`, `1353`.

**Remediación (dos opciones):**
- **Opción A (recomendada):** Migrar `pharmacy.router.ts` para operar sobre los modelos reales: `PrescriptionItem` (en lugar de `PrescriptionLine`), `MedicationAdministration` (en lugar de `AdministrationEvent`), `MedicationDispense` (en lugar de `DispensationEvent`). Requiere adaptar el DTO mapper `toPrescriptionDto` y el módulo de contratos.
- **Opción B:** Aplicar el DDL que crea `prescription_line`, `dispensation_event`, `administration_event` y `controlled_substance_ledger` como tablas Wave 1 paralelas. Riesgo: duplicación de dominio con `PrescriptionItem`/`MedicationAdministration` ya existentes.

**Riesgo Go-Live:** P0 BLOQUEANTE.

---

#### BCMA-002 [P0 — CRÍTICO] `scheduledTime` se fija a `new Date()` en la UI eMAR — Right Time (5R) siempre pasa

**Descripción:** En `apps/web/src/app/(clinical)/pharmacy/emar/page.tsx` línea 88, cada `PendingRow` tiene `scheduledTime: new Date()`. Al enviar al servidor, `guardFiveRights` evalúa `|administeredAt - scheduledTime| ≤ 30 min` donde ambos valores son `new Date()` en el mismo request. La diferencia es siempre 0 milisegundos. El Right Time nunca falla.

**Impacto clínico:** El quinto derecho (Right Time) del BCMA está completamente bypasseado desde la UI. Un medicamento puede administrarse a cualquier hora sin que el sistema lo detecte como fuera de ventana.

**Ruta afectada:** `apps/web/src/app/(clinical)/pharmacy/emar/page.tsx:88`.

**Remediación:** `scheduledTime` debe derivarse del slot programado del eMAR (calculado desde `frequency` + `signedAt` de la prescripción). Implementar cálculo de slots en servidor o persistirlos en tabla de schedule.

**Riesgo Go-Live:** P0 BLOQUEANTE — violación directa de seguridad del paciente.

---

#### BCMA-003 [P0 — CRÍTICO] `ece.bedside_validation` sin validación GSRN/GTIN en BD (C7)

**Descripción:** `ece.bedside_validation.nurse_gsrn` y `patient_gsrn` son `text NOT NULL` sin CHECK constraint de formato GSRN-18. La columna `gtin` es `text NOT NULL` sin CHECK GTIN-14. Los validadores `validateGSRN` y `validateGTIN` existen en `packages/contracts/src/validators/gs1.ts` (con checksum módulo-10 GS1) pero no están reflejados en la BD.

**Impacto (C7):** Un insert con GSRN malformado (ej. 17 dígitos o checksum incorrecto) es aceptado por la BD. La trazabilidad GS1 del bedside queda comprometida.

**Remediación:** Añadir CHECKs:
```sql
ADD CONSTRAINT chk_nurse_gsrn CHECK (nurse_gsrn ~ '^\d{18}$');
ADD CONSTRAINT chk_patient_gsrn CHECK (patient_gsrn ~ '^\d{18}$');
ADD CONSTRAINT chk_gtin CHECK (gtin ~ '^\d{14}$');
```
Además implementar la función SQL `gs1_check_digit` equivalente a `validateGSRN` en Postgres.

---

#### BCMA-004 [P1 — ALTO] `MedicationAdministration.patientBarcodeScanned` + `drugBarcodeScanned` + `providerBadgeScanned` sin enforce (C11/C12)

**Descripción:** Los tres campos BCMA de `public.MedicationAdministration` tienen `DEFAULT false` y son `boolean`. No existe CHECK constraint ni trigger que exija que los tres sean `true` cuando `status = 'GIVEN'`. El trigger `tr_emar_immutable_post_administered` bloquea cambios post-`ADMINISTERED` pero no valida que los scans ocurrieron antes.

**Impacto:** Un registro de administración puede persistirse con `patientBarcodeScanned=false` y `status='GIVEN'` — los 3 scans BCMA son ignorables desde el servidor.

**Remediación:**
```sql
ADD CONSTRAINT chk_bcma_scans_on_given
  CHECK (status <> 'GIVEN' OR 
         (patientBarcodeScanned = true AND drugBarcodeScanned = true AND providerBadgeScanned = true));
```

---

#### BCMA-005 [P1 — ALTO] Dos tablas de administración paralelas sin integración (C9 — cardinalidad inconsistente)

**Descripción:** Existen `public.MedicationAdministration` (usada por routers beta, con hardening BCMA) y `ece.administracion_medicamento` (usada por ECE, sin hardening). No hay FK ni trigger de sincronización entre ellas. Un registro en `ece.administracion_medicamento` no tiene reflejo en `MedicationAdministration` y viceversa.

**Impacto:** Farmacéuticos ven el kardex en `/pharmacy/emar` (capa public) pero enfermería ECE ve sus propios registros en `ece.administracion_medicamento`. El cuadro de administración del médico ECE y el eMAR de farmacia están desincronizados.

**Remediación:** Definir tabla canónica (recomendado: `MedicationAdministration` pública con FK opcional a `ece.bedside_validation.id` ya existente como `bedsideValidationId`). Deprecar `ece.administracion_medicamento` o convertirla en vista/bridge.

---

#### BCMA-006 [P2 — MEDIO] `MedicationAdministration.scheduledTime` es nullable (C5)

**Descripción:** `scheduledTime timestamptz NULL` en BD. El Right Time 5R requiere el slot programado. Si es NULL, el guard `guardFiveRights` en el router Wave 1 recibe `undefined` y podría lanzar excepción no controlada o silenciar la validación.

**Remediación:** NOT NULL con migration + valor por defecto `administeredAt` en registros legacy, o CHECK `(scheduledTime IS NOT NULL WHEN status = 'GIVEN')`.

### 3.4 Riesgo Go-Live

| Hallazgo | Severidad | Riesgo Go-Live |
|----------|-----------|---------------|
| BCMA-001 Modelos ORM inexistentes | P0 | BLOQUEANTE — eMAR no funciona en producción |
| BCMA-002 scheduledTime siempre 0 | P0 | BLOQUEANTE — Right Time bypasseado |
| BCMA-003 Sin validación GSRN/GTIN en BD | P0 | BLOQUEANTE — trazabilidad GS1 comprometida |
| BCMA-004 3 scans sin enforce BD | P1 | ALTO — BCMA puede omitirse |
| BCMA-005 Dos tablas sin integración | P1 | ALTO — desincronización clínica |
| BCMA-006 scheduledTime nullable | P2 | MEDIO |

---

## Módulo 4 — Farmacia (dispensación + CPOE + ledger) {#modulo-4}

### 4.1 Resumen ejecutivo

El módulo de farmacia tiene la UI más completa del stream (7 páginas: `/pharmacy`, `/pharmacy/new`, `/pharmacy/validate`, `/pharmacy/dispense`, `/pharmacy/[id]`, `/pharmacy/emar`, `/pharmacy/ledger`). Sin embargo, sufre del mismo problema estructural que BCMA: **el router `pharmacy.router.ts` referencia un modelo de datos Wave 1 completamente desconectado de la BD real**. Los modelos `Prescription` (Wave 1 con campos `version`, `signatureRef`, `validatedById`, `rejectedById`, `discontinuedById`, `validationCheck`, `auditEntryId`, etc.) no existen en `schema.prisma`. El `Prescription` real en BD tiene solo 12 columnas (`status` enum `DRAFT/SIGNED/DISPENSED/PARTIALLY_DISPENSED/CANCELLED/EXPIRED`) vs los 7 estados Wave 1 (`Drafted/Prescribed/Validated/Dispensed/Administered/Rejected/Discontinued`). El `Drug` real en BD (`public.Drug` PascalCase) carece de campos `name`, `isHighRisk`, `controlledClass`, `defaultRoute`, `allergyFamilies`, `strength`, `form` que usa el router. Esto convierte toda la capa de CPOE+validación+dispensación en código no funcional en producción.

### 4.2 Matriz de trazabilidad

#### 4.2.1 UI `/pharmacy/new` → `pharmacy.prescription.draft` + `pharmacy.prescription.sign`

| # | Campo UI | Atributo payload | Prop DTO/Zod | Prop Entidad ORM | Columna DB | Tipo UI | Tipo Zod | Tipo Prisma | Tipo SQL | Req UI | NotNull Zod/ORM | NOT NULL DB | Long UI | Long ORM | Long DB | FK/Catálogo | Val UI | Val Zod | Constraint DB | Observación |
|---|----------|-----------------|--------------|-----------------|-----------|---------|---------|------------|---------|--------|----------------|------------|---------|---------|---------|------------|--------|---------|--------------|-------------|
| 1 | Input Encounter ID | `encounterId` | `z.string().uuid()` | `Prescription.encounterId` (FANTASMA) | **NO EXISTE en schema Wave1** | text | uuid | — | — | SI | SI | — | — | — | — | FK Encounter | uuid | — | — | **C1 — `prescription` tabla Wave 1 no existe en BD** |
| 2 | Input Patient ID | `patientId` | `z.string().uuid()` | `Prescription.patientId` (FANTASMA) | **NO EXISTE** | text | uuid | — | — | SI | SI | — | — | — | — | FK Patient | uuid | — | — | **C1** |
| 3 | Textarea Notas | `notes` | `z.string().max(2000)` | `Prescription.notes` (FANTASMA) | **NO EXISTE** | textarea | string | — | — | NO | NO | — | 2000 | — | — | — | max(2000) | — | **C1** |
| 4 | Drug search → `drugId` | `lines[].drugId` | `z.string().uuid()` | `Drug.id` | `Drug.id` uuid | select | uuid | String @Uuid | uuid | SI | SI | SI | — | — | — | FK Drug real | uuid | PK | Único campo que apunta a tabla real |
| 5 | Drug `name` display | — | `drugSchema.name` | `Drug.name` (FANTASMA en schema) | **NO EXISTE en `public.Drug`** | label | string | — | — | — | — | — | — | — | — | — | — | — | **C2 — Drug real tiene `genericName`, no `name`** |
| 6 | Drug `strength` display | — | `drugSchema.strength` | `Drug.strength` (FANTASMA) | **NO EXISTE en `public.Drug`** | label | string | — | — | — | — | — | — | — | — | — | — | — | **C2 — Drug real tiene `strengthValue`+`strengthUnit`** |
| 7 | Select Vía | `lines[].route` | `routeEnum` | `PrescriptionLine.route` (FANTASMA) | **NO EXISTE** | select | enum | — | — | SI | SI | — | — | — | — | — | enum 10 valores | — | **C1** |
| 8 | Select Frecuencia | `lines[].frequency` | `frequencyEnum` | `PrescriptionLine.frequency` (FANTASMA) | **NO EXISTE** | select | enum | — | — | SI | SI | — | — | — | — | — | enum 8 valores | — | **C1** |
| 9 | Input Dosis | `lines[].dose` | `z.number().positive().max(10000)` | `PrescriptionLine.dose` (FANTASMA) | **NO EXISTE** | number | number | — | — | SI | SI | — | — | — | — | — | positive, max 10000 | — | **C1** |
| 10 | Input Duración (h) | `lines[].durationHours` | `z.number().int().max(2160).nullable()` | `PrescriptionLine.durationHours` (FANTASMA) | **NO EXISTE** | number | int nullable | — | — | NO | NO | — | — | — | — | — | max 2160h | — | **C1** |
| 11 | Drug `isHighRisk` display | — | `drugSchema.isHighRisk` | `Drug.isHighRisk` (FANTASMA) | **NO EXISTE en `public.Drug`** | badge | boolean | — | — | — | — | — | — | — | — | — | — | — | **C2 — Drug real no tiene isHighRisk** |
| 12 | Drug `controlledClass` display | — | `drugSchema.controlledClass` | `Drug.controlledClass` (FANTASMA) | **NO EXISTE en `public.Drug`** | text | enum | — | — | — | — | — | — | — | — | — | — | — | **C2 — Drug real usa `dispensingClass` + `requiresControlledLog`** |

#### 4.2.2 `/pharmacy/[id]` → Validación + Dispensación

| # | Campo UI | Atributo payload | Prop DTO/Zod | Prop Entidad ORM | Columna DB | Tipo UI | Tipo Zod | Tipo Prisma | Tipo SQL | Req UI | NotNull Zod/ORM | NOT NULL DB | Long UI | Long ORM | Long DB | FK/Catálogo | Val UI | Val Zod | Constraint DB | Observación |
|---|----------|-----------------|--------------|-----------------|-----------|---------|---------|------------|---------|--------|----------------|------------|---------|---------|---------|------------|--------|---------|--------------|-------------|
| 1 | Checks farmacéuticos (5 checkboxes) | `checks.allergyChecked..duplicateChecked` | `z.object({...5 booleans})` | `Prescription.validationCheck` (FANTASMA) | **NO EXISTE** | checkbox | boolean | — | — | — | — | — | — | — | — | — | boolean | — | **C1 — validationCheck es JSONB en Wave1 spec, no existe en BD** |
| 2 | Input override | `overrideJustification` | `z.string().max(500).optional()` | `Prescription.validationCheck` (FANTASMA) | **NO EXISTE** | textarea | string | — | — | NO | NO | — | 500 | — | — | — | max(500) | — | **C1** |
| 3 | Select razón rechazo | `reason` | `rejectionReasonEnum` | `Prescription.rejectionReason` (FANTASMA) | **NO EXISTE** | select | enum 6 | — | — | SI | — | — | — | — | — | — | enum | — | **C1 — Prescription real solo tiene `status DRAFT/SIGNED/DISPENSED/...`** |
| 4 | Input Lote (dispensación) | `lines[].lotNumber` | `z.string().min(1).max(60)` | `DispensationEvent.lotNumber` (FANTASMA) | **NO EXISTE** | text | string | — | — | SI | SI | — | 60 | — | — | — | min(1), max(60) | — | **C1 — DispensationEvent no existe en BD** |
| 5 | Input Vencimiento (month) | `lines[].expiryDate` | `z.coerce.date()` | `DispensationEvent.expiryDate` (FANTASMA) | **NO EXISTE** | month input | date | — | — | SI | SI | — | — | — | — | — | coerce.date | — | **C1; UI usa `YYYY-MM-01` como hack de primer día de mes** |
| 6 | Input Unidades | `lines[].units` | `z.number().int().positive().max(1000)` | `DispensationEvent.units` (FANTASMA) | **NO EXISTE** | number | int | — | — | SI | SI | — | — | — | — | — | max(1000) | — | **C1** |
| 7 | Display `itemBarcode` | — | `dispensationDtoSchema.itemBarcode` | `DispensationEvent.itemBarcode` (FANTASMA) | **NO EXISTE** | text | string | — | — | — | — | — | — | — | — | — | — | — | **C2 — generado por `buildItemBarcode` (formato M-ATC-LOT-NNNN), no GTIN-14 GS1** |

#### 4.2.3 Drug model: discrepancias schema.prisma vs BD real

| # | Campo router Wave 1 | Tipo Wave 1 | Campo BD real (`public.Drug`) | Tipo BD real | Observación |
|---|--------------------|-----------|-----------------------------|------------|------------|
| 1 | `name` | string | `genericName` | VARCHAR(200) | **C10 — naming inconsistente** |
| 2 | `strength` | string | `strengthValue` + `strengthUnit` | DECIMAL(12,4) + VARCHAR(20) | **C4 — longitud discrepa; Wave1 concatena, real separa** |
| 3 | `form` | string | `pharmaceuticalForm` | USER-DEFINED (enum) | **C10 + C3 — nombre distinto, tipo distinto** |
| 4 | `defaultRoute` | routeEnum | (no existe en BD) | — | **C1 — campo huérfano** |
| 5 | `isHighRisk` | boolean | (no existe) | — | **C1 — huérfano; BD usa `requiresControlledLog` boolean** |
| 6 | `controlledClass` | enum (NONE/II/III/IV/V) | `dispensingClass` (OTC/RX/RX_CONTROLLED/CONTROLLED_II/III/IV) | USER-DEFINED | **C3 — enums distintos; Wave1 no mapeable 1:1 a BD** |
| 7 | `allergyFamilies` | string[] | (no existe en schema.prisma, pero SÍ `allergyExcipients` en BD) | ARRAY | **C1 — `allergyFamilies` no existe en BD; `allergyExcipients` sí pero sin `allergyFamilies`** |
| 8 | `allergyExcipients` | string[] | `allergyExcipients` | ARRAY | Único campo que coincide |
| 9 | `atcCode` | string | `atcCode` | VARCHAR(20) | Coincide |
| 10 | `active` | boolean | `active` | boolean | Coincide |

### 4.3 Hallazgos

#### FARM-001 [P0 — CRÍTICO] Todo el modelo Wave 1 de prescripción/dispensación es código muerto

**Descripción:** El router `pharmacy.router.ts` construye toda su lógica sobre: `prisma.prescription` (Wave 1 — 20+ campos que no existen), `prisma.prescriptionLine` (no existe en schema.prisma ni BD), `prisma.dispensationEvent` (no existe), `prisma.administrationEvent` (no existe), `prisma.controlledSubstanceLedger` (no existe), `prisma.drugInteraction` (no existe). La BD real tiene `public.Prescription` con 12 columnas y status enum `DRAFT/SIGNED/DISPENSED/PARTIALLY_DISPENSED/CANCELLED/EXPIRED` — completamente diferente a los 7 estados Wave 1.

**Impacto:** Las 5 rutas UI de farmacia (`/pharmacy/new`, `/pharmacy/validate`, `/pharmacy/dispense`, `/pharmacy/[id]`, `/pharmacy/ledger`) devuelven error 500 en producción. El CPOE, la validación farmacéutica y el libro DNM son no operativos.

**Ruta afectada:** `packages/trpc/src/routers/pharmacy.router.ts` — prácticamente todo el archivo.

**Remediación:** Bifurcación de decisión arquitectónica (requiere resolución por @Orq):

- **A — Migración al modelo legacy (recomendada para Go-Live):** Reescribir `pharmacy.router.ts` usando los modelos que sí existen: `Prescription` (legacy), `PrescriptionItem`, `MedicationDispense`, `MedicationAdministration`. Agregar los campos faltantes (`version`, `signatureRef`, `validatedById`, etc.) como migración SQL + actualización de `schema.prisma`. Tiempo estimado: 3-4 días.

- **B — Aplicar DDL Wave 1 completo:** Crear las tablas `prescription_line`, `dispensation_event`, `administration_event`, `controlled_substance_ledger`, `drug_interaction` con las columnas que el router espera. Acepta duplicación de dominio con modelos legacy. Tiempo estimado: 1-2 días DDL + refactor de relaciones.

**Riesgo Go-Live:** P0 BLOQUEANTE.

---

#### FARM-002 [P0 — CRÍTICO] `Drug` model: 6 de 10 campos usados por el router no existen en BD (C1/C2/C10)

**Descripción:** El router usa `drug.name`, `drug.isHighRisk`, `drug.controlledClass`, `drug.defaultRoute`, `drug.allergyFamilies`, `drug.strength`, `drug.form`. La tabla `public.Drug` en BD tiene `genericName`, `requiresControlledLog`, `dispensingClass`, y sin los demás. El autocomplete de drogas (`catalog.searchDrug`) devuelve un objeto donde `d.name`, `d.strength`, `d.form`, `d.isHighRisk`, `d.controlledClass` serían `undefined` en runtime.

**Impacto:** La UI de búsqueda de fármacos muestra campos vacíos. Los guards DNM (`guardControlledSubstanceRequiresPaper`) evalúan `drug.controlledClass` que siempre es `undefined` → la clase II/III/IV de controlados nunca bloquea.

**Ruta afectada:** `pharmacy.router.ts:1619-1653` (catalog.searchDrug), `pharmacy.router.ts:407-419` (guard controlados).

**Remediación:** Añadir columnas a `public.Drug`: `name VARCHAR(200)` (alias de `genericName`), `isHighRisk BOOLEAN DEFAULT false`, `controlledClass` (enum mapping desde `dispensingClass`), `defaultRoute AdminRoute NULL`, `allergyFamilies TEXT[] DEFAULT '{}'`. Alternativamente, mapear en el DTO usando `genericName` → `name`.

---

#### FARM-003 [P1 — ALTO] `buildItemBarcode` genera formato propietario, no GTIN-14 GS1 (C7)

**Descripción:** La función `buildItemBarcode` en `packages/contracts/src/schemas/pharmacy.ts:676-684` genera `M-{ATC}-{LOT}-{seq}` (máximo ~40 chars). No es un GTIN-14 GS1 válido. La BD real tiene `ece.bedside_validation.gtin` que espera un GTIN de 14 dígitos numéricos. El validator `validateGTIN` en `packages/contracts/src/validators/gs1.ts` rechazaría el barcode generado.

**Impacto (C7):** Los barcodes de dispensación generados no son escaneables por lectores GS1 estándar. El flujo de scan en bedside (`scannedMedicationBarcode` vs `itemBarcode`) nunca podría comparar un scan GS1 real con un barcode propietario.

**Remediación:** Implementar `buildItemBarcode` usando AI GS1-128: `(01){GTIN-14}(17){expiry YYMMDD}(10){lot}(21){serial}`. El GTIN-14 debe derivarse del `MedicationGtin.gtin` del catálogo GS1.

---

#### FARM-004 [P1 — ALTO] Allergy check server-side solo evalúa primera línea de prescripción

**Descripción:** En `apps/web/src/app/(clinical)/pharmacy/[id]/page.tsx:172-192`, el allergy check (`dispense.checkAllergies`) solo se ejecuta para `p.lines[0]` (primera línea). Prescripciones multi-fármaco con alergia en líneas 2, 3, ... pasan sin detección.

**Impacto:** Hard stop de alergia bypasseable en prescripciones de más de un fármaco.

**Ruta afectada:** `pharmacy/[id]/page.tsx:171`.

**Remediación:** Iterar sobre todas las líneas: `for (const line of p.lines) { await checkAllergiesMut.mutateAsync(...) }`. O mover el check al servidor dentro de `dispense.create` que ya itera líneas.

---

#### FARM-005 [P1 — ALTO] Warning de alergia en dispensación: confirmación no se persiste en audit (C12)

**Descripción:** Cuando `checkAllergies` devuelve `status='warning'`, la función `handleAllergyWarningConfirm` (línea 200-210) llama a `executeDispense()` sin persistir el motivo de confirmación. El comentario en el código dice "el motivo se enviaría como nota, pero en esta versión se registra el evento pharmacy.allergy-detected ya persistido en el outbox" — pero esto solo aplica a hardStop. Para warning, el evento `pharmacy.allergy-detected` no se publica y no hay registro de que el farmacéutico confirmó con conocimiento.

**Impacto (C12):** Ausencia de audit trail para override de warning de alergia. Incumple TDR §6.3 (trazabilidad de decisiones clínicas). Sin embargo, dado que los modelos Wave 1 no existen en BD, este escenario nunca llega a ejecutarse actualmente.

**Ruta afectada:** `pharmacy/[id]/page.tsx:200-210`, `pharmacy.router.ts:dispense.checkAllergies`.

**Remediación:** Pasar `confirmationReason` al endpoint `dispense.create` y persistirlo en `audit_log` dentro de la transacción.

---

#### FARM-006 [P2 — MEDIO] Libro DNM (`controlledSubstanceLedger`) — modelo y función SQL inexistentes en BD

**Descripción:** `ledger.recordEntry` invoca `fn_next_controlled_folio` y `prisma.controlledSubstanceLedger`. La función SQL `fn_next_controlled_folio` SÍ existe en BD (confirmado por `10_pharmacy_rls.sql`). Sin embargo, la tabla `controlled_substance_ledger` y la tabla auxiliar `controlled_ledger_seq` no aparecen en `information_schema.tables` (consulta confirmó ausencia). La función existe pero su tabla objetivo no.

**Impacto:** El libro DNM no puede recibir asientos. Ley de Estupefacientes SV (Decreto 728) exige registro inmediato de cada movimiento de controlados.

**Remediación:** Aplicar el DDL de creación de `controlled_substance_ledger` y `controlled_ledger_seq` del archivo `10_pharmacy_rls.sql` (secciones 5-4 que asumen tablas ya existentes pero no las crean). Luego mapear en `schema.prisma`.

---

#### FARM-007 [P2 — MEDIO] `PrescriptionStatus` enum en BD incompatible con Wave 1 (C3)

**Descripción:** La BD tiene `PrescriptionStatus` con valores `DRAFT | SIGNED | DISPENSED | PARTIALLY_DISPENSED | CANCELLED | EXPIRED`. El router Wave 1 usa `Drafted | Prescribed | Validated | Dispensed | Administered | Rejected | Discontinued`. Son enums completamente distintos (valores, cardinalidad, semántica). El trigger `fn_prescription_transition_guard` en `10_pharmacy_rls.sql` valida transiciones Wave 1 pero se aplica a la tabla `prescription` que no existe, por lo que tampoco está activo.

**Remediación:** Decidir qué enum es canónico. Si se elige Wave 1, migrar el enum BD con `ALTER TYPE`. Si se elige legacy, reescribir el router.

### 4.4 Riesgo Go-Live

| Hallazgo | Severidad | Riesgo Go-Live |
|----------|-----------|---------------|
| FARM-001 Todo Wave 1 es código muerto | P0 | BLOQUEANTE |
| FARM-002 Drug campos inexistentes en BD | P0 | BLOQUEANTE — guard DNM no opera |
| FARM-003 buildItemBarcode no es GTIN-14 | P1 | ALTO — scan bedside incompatible |
| FARM-004 Allergy check solo línea 1 | P1 | ALTO — riesgo paciente |
| FARM-005 Warning alergia sin audit trail | P1 | ALTO — compliance §6.3 |
| FARM-006 controlled_substance_ledger ausente | P2 | MEDIO — legal DNM |
| FARM-007 PrescriptionStatus enum incompatible | P2 | MEDIO |

---

## Resumen Stream B {#resumen-stream-b}

### Tabla consolidada de hallazgos

| # | ID | Módulo | Severidad | Categoría | Descripción breve |
|---|----|--------|-----------|-----------|------------------|
| 1 | HC-001 | Historia Clínica | P0 | C1 | Ruta UI `/ece/historia-clinica` no existe |
| 2 | HC-002 | Historia Clínica | P0 | C1 | Sin router tRPC para `ece.historia_clinica` |
| 3 | HC-003 | Historia Clínica | P1 | C5 | `estado_registro` text sin enum constraint |
| 4 | HC-004 | Historia Clínica | P1 | C7 | `diagnosticos` JSONB sin validación CIE-10 |
| 5 | HC-005 | Historia Clínica | P2 | C12 | Sin trigger inmutabilidad post-firma |
| 6 | IND-001 | Indicaciones | P0 | C1 | Ruta UI `/ece/indicaciones` no existe + sin router |
| 7 | IND-002 | Indicaciones | P1 | C3 | dosis/via/frecuencia son text libre vs enums pharmacy |
| 8 | IND-003 | Indicaciones | P1 | C12 | `administracion_medicamento.estado` sin inmutabilidad |
| 9 | IND-004 | Indicaciones | P2 | C5 | `motivo_omision` nullable sin constraint condicional |
| 10 | IND-005 | Indicaciones | P2 | C5 | `vigencia` sin enum constraint |
| 11 | BCMA-001 | BCMA/eMAR | P0 | C1 | Router usa modelos ORM inexistentes (`AdministrationEvent`, `PrescriptionLine`, etc.) |
| 12 | BCMA-002 | BCMA/eMAR | P0 | C12 | `scheduledTime = new Date()` — Right Time siempre pasa |
| 13 | BCMA-003 | BCMA/eMAR | P0 | C7 | GSRN/GTIN en `ece.bedside_validation` sin CHECK constraint formato |
| 14 | BCMA-004 | BCMA/eMAR | P1 | C12 | 3 scans BCMA sin enforce en BD |
| 15 | BCMA-005 | BCMA/eMAR | P1 | C9 | Dos tablas de administración paralelas sin integración |
| 16 | BCMA-006 | BCMA/eMAR | P2 | C5 | `scheduledTime` nullable en `MedicationAdministration` |
| 17 | FARM-001 | Farmacia | P0 | C1 | Modelo Wave 1 completo (prescription_line, dispensation_event, etc.) no existe en BD |
| 18 | FARM-002 | Farmacia | P0 | C2 | Drug: 6/10 campos usados no existen en BD |
| 19 | FARM-003 | Farmacia | P1 | C7 | `buildItemBarcode` genera formato propietario no GTIN-14 |
| 20 | FARM-004 | Farmacia | P1 | C1 | Allergy check solo evalúa primera línea |
| 21 | FARM-005 | Farmacia | P1 | C12 | Warning alergia dispensación sin audit trail |
| 22 | FARM-006 | Farmacia | P2 | C1/C2 | `controlled_substance_ledger` ausente en BD |
| 23 | FARM-007 | Farmacia | P2 | C3 | `PrescriptionStatus` enum BD incompatible con Wave 1 |

**Conteo por severidad:**

| Severidad | Cantidad |
|-----------|---------|
| P0 (CRÍTICO) | 7 |
| P1 (ALTO) | 10 |
| P2 (MEDIO) | 6 |
| **Total** | **23** |

**Conteo por categoría:**

| Categoría | Cantidad | Descripción |
|-----------|---------|-------------|
| C1 (huérfano UI/ORM) | 8 | Campos en UI sin contraparte en BD |
| C2 (fantasma DB) | 3 | Campos en BD sin UI/ORM |
| C3 (tipo discrepa) | 3 | Tipos incompatibles entre capas |
| C5 (nulabilidad) | 4 | Inconsistencias NOT NULL / nullable |
| C7 (validación en 1 sola capa) | 4 | GTIN, GSRN, CIE-10, barcode no validados en BD |
| C9 (cardinalidad) | 1 | Tablas paralelas sin integración |
| C10 (naming) | 1 | Nombres inconsistentes UI↔DB |
| C12 (inmutabilidad/trigger) | 5 | Triggers de seguridad ausentes o bypasseables |

### Top-5 Riesgos Go-Live (seguridad del paciente)

**Riesgo 1 — BCMA-001 + FARM-001 (P0): El flujo de administración de medicamentos completo es no funcional en producción**

El router `pharmacy.router.ts` (eMAR + CPOE + dispensación) opera sobre modelos Prisma inexistentes (`administrationEvent`, `prescriptionLine`, `dispensationEvent`). Todo intento de crear una prescripción, dispensar o administrar un medicamento desde la UI resulta en error. Este es el riesgo más crítico del stream: el sistema no puede registrar ni verificar ninguna administración de medicamento.

**Riesgo 2 — BCMA-002 (P0): Right Time del 5R siempre pasa — ventana terapéutica bypaseada**

`scheduledTime: new Date()` en la UI eMAR hace que el guard de Right Time nunca detecte una administración fuera de ventana. Un medicamento crítico (insulina, anticoagulante, opioide) puede administrarse 4 horas tarde sin ninguna alerta del sistema.

**Riesgo 3 — FARM-002 (P0): Guard de controlados DNM no opera**

`guardControlledSubstanceRequiresPaper` evalúa `drug.controlledClass` que el router lee de `Drug.controlledClass` — campo que no existe en `public.Drug`. El valor es siempre `undefined`, y la condición `d.controlledClass !== "NONE"` falla, dejando pasar electrónicamente prescripciones de psicotrópicos clase II/III/IV que deben obligatoriamente ir en papel.

**Riesgo 4 — BCMA-003 (P0): Trazabilidad GS1 de pulseras y medicamentos sin validación**

`ece.bedside_validation.nurse_gsrn`, `patient_gsrn` y `gtin` aceptan cualquier string. Un scan corrupto o manual erróneo queda persistido como válido. En un evento adverso, los logs de bedside no pueden usarse como evidencia forense confiable.

**Riesgo 5 — FARM-004 (P1): Hard stop de alergia se evalúa solo para el primer fármaco de la prescripción**

En prescripciones multi-fármaco, las alergias a los fármacos 2, 3, ... no son detectadas en el flujo de dispensación. Un paciente alérgico a la penicilina que recibe amoxicilina (fármaco 2 de una combinación) no activa el hard stop.

### Recomendaciones priorizadas

**Inmediatas (bloquean Go-Live):**

1. **Decisión arquitectónica urgente @Orq:** Resolver la bifurcación entre modelo Wave 1 (`prescription_line`, `dispensation_event`, etc.) y modelo legacy (`PrescriptionItem`, `MedicationDispense`, `MedicationAdministration`). Esta es la raíz del 60% de los hallazgos P0. Sin esta decisión, ningún sprint de remediación puede comenzar.

2. **Corrección BCMA-002:** Reemplazar `scheduledTime: new Date()` en `/pharmacy/emar/page.tsx:88` por el slot programado derivado de `frequency + signedAt`. Cambio de una línea con impacto crítico en seguridad.

3. **Corrección FARM-004:** Mover el allergy check al loop completo de líneas en dispensación. Cambio de ~10 líneas.

4. **Implementar UI+router para HC e Indicaciones:** P0 bloqueante para todo el flujo clínico ECE.

**Corto plazo (Sprint siguiente post-Go-Live):**

5. Agregar CHECKs de formato GSRN-18 y GTIN-14 en `ece.bedside_validation`.
6. Agregar enforce de 3 scans BCMA en `MedicationAdministration` (`CHECK status <> 'GIVEN' OR (patientBarcodeScanned AND drugBarcodeScanned AND providerBadgeScanned)`).
7. Crear enum constraints para campos `text` sin control: `estado_registro`, `vigencia`, `estado` en tablas ECE.
8. Resolver duplicación `ece.administracion_medicamento` vs `public.MedicationAdministration` — definir tabla canónica.

**Deuda técnica documentada:**

9. `buildItemBarcode`: migrar a GS1-128 real (Wave 2 per TODO en código).
10. `controlled_substance_ledger`: aplicar DDL completo y mapear en schema.prisma.
11. Warning de alergia en dispensación: agregar audit trail de confirmación.

---

*Documento generado: 2026-05-19 | Auditor: @AS + @DBA | Rama: `docs/audit-stream-b` | Solo lectura — sin modificaciones al código ni a Supabase.*
