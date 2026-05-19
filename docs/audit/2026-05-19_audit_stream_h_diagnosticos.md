# Auditoría Stream H — Diagnósticos (RIS / LIS / Pathology / ECE Estudios)

**Fecha:** 2026-05-19
**Auditor:** @AS — Arquitecto de Software, Unidad de Transformación Digital, Inversiones Avante
**Rama auditada:** `feat/fase2-s1-gate` (commit `6532a92`)
**Método:** lectura estática de UI + routers tRPC + contratos Zod + consultas `information_schema` / `pg_policies` / `pg_enum` al proyecto Supabase de producción. Sin modificaciones.
**Scope:** 4 módulos — ECE Estudios diagnósticos, LIS (Laboratorio), RIS/PACS (Imagenología), Pathology (Anatomía Patológica).

---

## Índice

1. [Flujo 1 — ECE Estudios diagnósticos (Doc 18 NTEC)](#flujo-1)
2. [Flujo 2 — LIS (§17 Laboratorio)](#flujo-2)
3. [Flujo 3 — RIS/PACS (§18 Imagenología)](#flujo-3)
4. [Flujo 4 — Pathology (§16 Anatomía Patológica)](#flujo-4)
5. [Resumen consolidado Stream H](#resumen-final)

---

## Flujo 1 — ECE Estudios diagnósticos (Doc 18 NTEC) {#flujo-1}

### 1.1 Resumen ejecutivo

El módulo cubre el Doc 18 NTEC: solicitud de estudio diagnóstico (`SOL_EST`) y registro de resultado (`RES_EST`). La ruta UI vive en `(clinical)/ece/estudios/` con 4 páginas: lista, nueva solicitud (con firma PIN MC), detalle con acciones de validar/aprobar resultado, y registro de resultado.

El router `ece/solicitud-estudio.router.ts` integra correctamente `withWorkflowContext`, verifica PIN argon2id, emite eventos de dominio y respeta la máquina de estados (borrador → firmado → validado). Sin embargo, presenta **schema drift masivo**: las columnas que el router asume en `ece.solicitud_estudio` no coinciden con las que existen en la BD. El mismo patrón se repite en `ece/resultado-estudio.router.ts`.

**Actores:** MC (médico certificador), ESP (especialista), TEC (técnico de diagnóstico), PROF_DX (profesional diagnóstico), ENF, DIR, ARCH.

### 1.2 Archivos auditados

| Archivo | Rol |
|---|---|
| `apps/web/src/app/(clinical)/ece/estudios/page.tsx` | Lista split pendientes/con resultado |
| `apps/web/src/app/(clinical)/ece/estudios/nueva/page.tsx` | Formulario creación + firma PIN |
| `apps/web/src/app/(clinical)/ece/estudios/[id]/page.tsx` | Detalle + validar + aprobar resultado |
| `apps/web/src/app/(clinical)/ece/estudios/[id]/registrar-resultado/page.tsx` | Formulario registro resultado |
| `packages/trpc/src/routers/ece/solicitud-estudio.router.ts` | Router SOL_EST |
| `packages/trpc/src/routers/ece/resultado-estudio.router.ts` | Router RES_EST |

### 1.3 Matriz de trazabilidad — Solicitud de Estudio

| # | Campo UI | Payload tRPC | Schema Zod | ORM/RAW SQL | Columna DB real | Tipo UI | Tipo Zod | Req UI | NotNull Zod | NOT NULL DB | Observación |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Episodio (UUID) | `episodioId` | `z.string().uuid()` | `$queryRaw: episodio_id` | `episodio_id uuid` | text/UUID | string uuid | SI | SI | SI | Alineado. Validado client-side con regex. |
| 2 | Tipo de estudio | `tipo` | `z.enum(["laboratorio","imagenologia","otro"])` | `$queryRaw: tipo` | `tipo text` | Select | enum 3 val | SI | SI | SI | Enum Zod no respaldado por CHECK DB. Ver HH-02. |
| 3 | Estudios solicitados | `estudiosSolicitados` | `z.array(z.string()).min(1).max(50)` | `$queryRaw: estudios_solicitados` | **NO EXISTE** — BD tiene `examenes jsonb` | textarea | array | SI | SI | SI (examenes) | **C7 P0** — columna asumida por router difiere en nombre. Ver HH-01. |
| 4 | Prioridad | `prioridad` | `z.enum(["rutina","urgente","stat"])` | `$queryRaw: prioridad` | **NO EXISTE** — BD tiene sin columna separada (embebida en estado) | Select | enum 3 val | SI | SI | — | **C7 P0** — columna `prioridad` no existe en `ece.solicitud_estudio`. |
| 5 | Observaciones | `observacionesClinicas` | `z.string().max(4000).optional()` | `$queryRaw: observaciones_clinicas` | **NO EXISTE** — BD tiene `indicacion_clinica text` | textarea | string opt | NO | NO | NO | **C7 P0** — nombre de columna distinto. Router falla silenciosamente en INSERT. |
| 6 | PIN MC | `pin` | `z.string().regex(/^\d{6,8}$/)` | `verifyPinOrThrow(tx, userId, pin)` | `ece.firma_electronica.pin_hash` | password | string 6-8 | SI | SI | SI | Correcto. Argon2id + lockout + reset en éxito. |
| 7 | Paciente | — | — | `$queryRaw: paciente_id` | **NO EXISTE** en `ece.solicitud_estudio` | — | — | — | — | — | **C7 P0** — `paciente_id` no es columna de la tabla; la BD requiere resolver desde `episodio_id`. |
| 8 | Solicitado por | — | — | `$queryRaw: solicitado_por` | **NO EXISTE** — BD tiene `medico_solicitante_id uuid` | — | — | — | — | SI | **C7 P0** — nombre de columna distinto. INSERT falla. |

### 1.4 Matriz de trazabilidad — Resultado de Estudio

| # | Campo UI | Payload tRPC | Schema Zod | Columna asumida (router) | Columna DB real | Observación |
|---|---|---|---|---|---|---|
| 1 | Resultado (texto) | `resultado` | `z.string().min(1).max(10000)` | `resultado text` | **NO EXISTE** — BD tiene `valores jsonb` | **C7 P0** — nombre y tipo difieren. |
| 2 | Adjunto URL | `adjuntoUri` | `z.string().url().max(2000).optional()` | `adjunto_uri text` | **NO EXISTE** en `ece.resultado_estudio` | **C7 P0** — columna no existe. |
| 3 | Registrado por | — | — | `registrado_por uuid` | **NO EXISTE** — BD tiene `responsable_validacion_id uuid` | **C7 P0** — nombre distinto. |
| 4 | Aprobado por | — | — | `aprobado_por uuid` | **NO EXISTE** | **C7 P0** — columna no existe. |
| 5 | Aprobado en | — | — | `aprobado_en timestamptz` | **NO EXISTE** | **C7 P0** — columna no existe. |
| 6 | Comentario médico | `comentarioMedico` | `z.string().max(2000).optional()` | `comentario_medico text` | **NO EXISTE** | **C7 P0** — columna no existe. |
| 7 | Estado | — | — | `estado text` | `estado_registro text` | **C7 P0** — nombre distinto (`estado` vs `estado_registro`). |
| 8 | Registrado en | — | — | `registrado_en timestamptz` | `fecha_hora_informe timestamptz` | **C7 P0** — nombre distinto. |

### 1.5 Hallazgos Flujo 1

#### HH-01 — [P0] — Schema drift masivo en `ece.solicitud_estudio`: 5 columnas no existen en BD

**Categoría:** C7 — Contrato schema drift.
**Descripción:** El router `ece/solicitud-estudio.router.ts` asume un schema que difiere del que existe en la BD. Columnas asumidas que no existen en `ece.solicitud_estudio`:
- `paciente_id` (BD: no tiene esta columna directamente)
- `estudios_solicitados` (BD: `examenes jsonb`)
- `prioridad` (BD: no tiene columna separada)
- `observaciones_clinicas` (BD: `indicacion_clinica text`)
- `solicitado_por` (BD: `medico_solicitante_id uuid`)

Confirmado vía `information_schema.columns` en Supabase. Los INSERT/SELECT del router producirán errores de columna inexistente en runtime (`column "estudios_solicitados" does not exist`).
**Líneas afectadas:** `packages/trpc/src/routers/ece/solicitud-estudio.router.ts:452-468` (INSERT), `:300-320` (SELECT `findSolicitud`).
**Recomendación:** Alinear el router con la BD o migrar la BD para agregar las columnas faltantes. Si la BD es la fuente de verdad, el router debe usar `examenes`, `indicacion_clinica`, `medico_solicitante_id`. Aplicar la misma lógica del precedente `fix/firma-electronica-schema-drift`.
**Riesgo go-live:** Crítico. La creación de solicitudes ECE falla en producción al primer intento.

#### HH-02 — [P0] — Schema drift masivo en `ece.resultado_estudio`: 6 columnas no existen en BD

**Categoría:** C7 — Contrato schema drift.
**Descripción:** El router `ece/resultado-estudio.router.ts` asume 6 columnas inexistentes en `ece.resultado_estudio`:
- `resultado` (BD: `valores jsonb`)
- `adjunto_uri` (BD: no existe)
- `registrado_por` (BD: `responsable_validacion_id uuid`)
- `aprobado_por`, `aprobado_en`, `comentario_medico` (BD: no existen)
- `estado` (BD: `estado_registro`)
- `registrado_en` (BD: `fecha_hora_informe`)

Los procedimientos `registrar` y `aprobar` emitirán errores de columna en runtime. La UI que llama a `trpc.eceResultadoEstudio.registrar` siempre fallará.
**Líneas afectadas:** `packages/trpc/src/routers/ece/resultado-estudio.router.ts:272-288` (INSERT), `:150-172` (SELECT `findResultado`).
**Recomendación:** Corregir el router para usar los nombres reales de columna. Verificar si `adjunto_uri` y `comentario_medico` son nuevos campos que requieren migración DDL.
**Riesgo go-live:** Crítico. El flujo completo de registro y aprobación de resultados ECE no funciona.

#### HH-03 — [P1] — Validación (`validar`) sin PIN del MC: el firmante puede auto-validar

**Categoría:** C6 — Autenticación/autorización.
**Descripción:** El procedimiento `validar` en `ece/solicitud-estudio.router.ts` (línea 519) avanza el estado de `firmado → validado` sin requerir PIN del MC. El mismo usuario que firmó puede llamar inmediatamente a `validar` sin volver a autenticarse. No hay verificación de identidad adicional ni restricción de que el validador sea distinto del firmante (a diferencia del LIS que implementa regla 4-eyes en `result.validate`).
**Líneas afectadas:** `packages/trpc/src/routers/ece/solicitud-estudio.router.ts:519-553`.
**Recomendación:** Requerir PIN en `validar` (igual que en `firmar`), o implementar regla 4-eyes (el validador debe ser un MC diferente al firmante). La NTEC Doc 18 exige control de la cadena de custodia.
**Riesgo go-live:** Alto. Un MC puede autorizar y autovalidar sus propias solicitudes sin segundo factor.

#### HH-04 — [P2] — `estudiosRaw` en UI separado por comas, router espera array separado por comas

**Categoría:** C1 — Campo omitido/incompleto.
**Descripción:** En `/ece/estudios/nueva/page.tsx:81`, el campo `estudiosRaw` se parsea con `split(",")` produciendo un array de strings (códigos de estudio). No hay validación del formato de cada código (LOINC, local, libre texto). El campo acepta cualquier cadena, incluyendo cadenas vacías si el usuario ingresa comas consecutivas (`,,,`). El router Zod tiene `z.array(z.string().min(1).max(100)).min(1)` pero el `.filter(Boolean)` en UI evita que se envíen strings vacías, lo que es correcto.
**Líneas afectadas:** `apps/web/src/app/(clinical)/ece/estudios/nueva/page.tsx:81`, `:48`.
**Recomendación:** Agregar instrucción sobre formato esperado (LOINC vs código local vs texto libre). Considerar un selector catálogo para la integración LIS/RIS si el `tipo` es `laboratorio` o `imagenologia`.
**Riesgo go-live:** Medio. Datos no estructurados dificultan la integración downstream con LIS/RIS.

#### HH-05 — [P2] — `canRegistrarResultado` permite estado `validado` pero el modal de aprobación usa `aprobar` sin PIN

**Categoría:** C6 — Autenticación/autorización.
**Descripción:** En `/ece/estudios/[id]/page.tsx:229`, el botón "Aprobar" llama a `trpc.eceResultadoEstudio.aprobar` directamente sin solicitar PIN al MC. El flujo de aprobación (rol clínico superior) debería requerir firma electrónica, especialmente para estudios de tipo `laboratorio` o `imagenologia` con implicaciones de tratamiento.
**Líneas afectadas:** `apps/web/src/app/(clinical)/ece/estudios/[id]/page.tsx:225-231`.
**Recomendación:** Agregar diálogo de confirmación con PIN antes de `aprobar`, alineando con el patrón de `firmar` en la misma ruta.
**Riesgo go-live:** Medio. La aprobación es un acto médico que debe quedar acreditado con firma.

---

## Flujo 2 — LIS (§17 Laboratorio) {#flujo-2}

### 2.1 Resumen ejecutivo

El módulo LIS cubre la gestión completa del laboratorio clínico (§17 TDR): órdenes con multi-test, recolección de especímenes con barcode, ingreso de resultados con auto-flagging por rangos de referencia, regla 4-eyes para validación, y cola de resultados pendientes. La UI tiene 4 rutas: lista órdenes, nueva orden (buscador debounced de tests), detalle (con dialogs para espécimen y resultado), y cola de validación.

El router `lis.router.ts` es el más maduro del stream: implementa estado de máquina, auto-flagging desde reference ranges, eventos de dominio `lab.criticalValue`, y regla 4-eyes correcta. El problema crítico es estructural: el router usa `tenantProcedure` directo en lugar de `withTenantContext`, lo que significa que aunque RLS está habilitado en BD, el rol `postgres` tiene BYPASSRLS y **las políticas no se aplican en runtime**.

### 2.2 Archivos auditados

| Archivo | Rol |
|---|---|
| `apps/web/src/app/(clinical)/lis/orders/page.tsx` | Lista órdenes con filtros |
| `apps/web/src/app/(clinical)/lis/orders/new/page.tsx` | Crear orden con test-search debounced |
| `apps/web/src/app/(clinical)/lis/orders/[id]/page.tsx` | Detalle con dialogs espécimen/resultado |
| `apps/web/src/app/(clinical)/lis/results/page.tsx` | Cola de validación |
| `apps/web/src/app/(clinical)/lis/_components/result-flag-badge.tsx` | Badge de flag visual |
| `packages/trpc/src/routers/lis.router.ts` | Router LIS completo |
| `packages/contracts/src/schemas/lis.ts` | Schemas Zod + helpers de negocio |

### 2.3 Matriz de trazabilidad — LabOrder Create

| # | Campo UI | Payload tRPC | Schema Zod | ORM Prisma | Columna DB | Tipo Zod | Req UI | NotNull ORM | NOT NULL DB | Observación |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Encuentro | `encounterId` | `z.string().uuid()` | `encounterId String` | `encounterId uuid` | uuid | SI | SI | SI | Alineado. Router valida existencia en tenant. |
| 2 | Paciente | `patientId` | `z.string().uuid()` | `patientId String` | `patientId uuid` | uuid | SI | SI | SI | Alineado. Router valida concordancia con encounter. |
| 3 | Prioridad | `priority` | `labPriorityEnum` (ROUTINE/URGENT/STAT) | `priority LabPriority` | `priority "LabPriority"` enum | enum | SI | SI | SI | Alineado. Enum DB confirma los 3 valores. |
| 4 | Indicación clínica | `clinicalIndication` | `z.string().trim().max(2000).optional()` | `clinicalIndication String?` | `clinicalIndication text` | string opt | NO | NO | NO | Alineado. |
| 5 | Tests seleccionados | `items` | `z.array(labOrderItemInput).min(1).max(50)` | `items LabOrderItem[]` (nested create) | `LabOrderItem` tabla | array 1-50 | SI (≥1) | SI | — | Alineado. Router crea items en cascade. |
| 6 | `fromDate` filtro | `fromDate` | `z.coerce.date().optional()` | — (filtro de lista) | `orderedAt timestamptz` | Date opt | — | — | — | **C5 P1** — `new Date(fromDate)` en UI (string date) → mismo problema timezone que H1-03. Ver HH-07. |

### 2.4 Matriz de trazabilidad — LabResult Enter

| # | Campo UI | Payload tRPC | Schema Zod | ORM Prisma | Columna DB | Observación |
|---|---|---|---|---|---|---|
| 1 | Valor numérico | `valueNumeric` | `z.number().optional()` | `valueNumeric Decimal?` | `valueNumeric numeric` | Alineado. Prisma serializa Decimal; `decimalToNullableNumber` lo maneja. |
| 2 | Valor texto | `valueText` | `z.string().trim().max(800).optional()` | `valueText String?` | `valueText varchar(800)` | Alineado. |
| 3 | Unidad | `valueUnit` | `z.string().trim().max(40).optional()` | `valueUnit String?` | `valueUnit varchar(40)` | Alineado. |
| 4 | Flag | `flag` | `resultFlagEnum` (6 valores) | `flag LabResultFlag` | `flag "LabResultFlag"` enum | Alineado. Auto-calculado si `!forceFlagOverride` y `valueNumeric` existe. |
| 5 | Espécimen | `specimenId` | `z.string().uuid().optional()` | `specimenId String?` | `specimenId uuid` | Alineado. Opcional — vinculado desde selector en dialog. |
| 6 | Edad paciente | `patientAgeYears` | `z.number().int().min(0).max(120).optional()` | — (contexto auto-flag) | — | **C1 P1** — la UI NO envía `patientAgeYears` ni `patientSex`. El auto-flag siempre opera sin estratificación. Ver HH-09. |
| 7 | Sexo paciente | `patientSex` | `z.enum(["MALE","FEMALE","BOTH"]).optional()` | — (contexto auto-flag) | — | **C1 P1** — igual que #6. |

### 2.5 Hallazgos Flujo 2

#### HH-06 — [P0] — `lisRouter` sin `withTenantContext`: RLS no aplica en runtime para tablas LIS

**Categoría:** C3 — RLS/seguridad multi-tenant.
**Descripción:** El router `lis.router.ts` usa `tenantProcedure` directamente (0 ocurrencias de `withTenantContext` verificado con grep). Dado que el rol Prisma en Supabase es `postgres.<ref>` con atributo `BYPASSRLS`, las políticas RLS habilitadas en `LabOrder`, `LabResult`, `LabSpecimen`, `LabOrderItem` no se aplican. Un usuario con tenant A podría, a través de una query manipulada, acceder a datos de tenant B. El filtro `where: { organizationId: ctx.tenant.organizationId }` es defensa en profundidad legítima pero insuficiente por sí solo (puede ser bypasseado con cambios al router sin audit trail de RLS).

Verificado: `rowsecurity=true` en las 6 tablas LIS, pero las 9 políticas tienen `roles={public}` en lugar de `{authenticated}` — la demote de rol que hace `withTenantContext` nunca ocurre en este router.
**Líneas afectadas:** `packages/trpc/src/routers/lis.router.ts` — todos los resolvers (order.list:95, order.get:111, order.create:125, specimen.collect:153, result.enter:193, result.validate:296).
**Recomendación:** Envolver cada resolver en `withTenantContext(ctx.prisma, ctx.tenant, async (tx) => { ... })` y operar sobre `tx` en lugar de `ctx.prisma`. Patrón documentado en CLAUDE.md §RLS.
**Riesgo go-live:** Crítico. Equivalente al hallazgo HS4-07 (hospitalizacion) y el patrón S0 original que motivó el PR #3.

#### HH-07 — [P1] — `fromDate` en filtro LIS: `new Date(string)` en browser genera timezone shift

**Categoría:** C5 — Transformación de tipos.
**Descripción:** En `/lis/orders/page.tsx:113`, el estado `fromDate` (string "YYYY-MM-DD" de `<input type="date">`) se convierte con `new Date(fromDate)` y se pasa al schema `z.coerce.date()`. En browser UTC-6 (El Salvador), `new Date("2026-05-19")` produce `2026-05-18T18:00:00Z` — el filtro excluye un día de órdenes. El mismo patrón fue documentado como H1-03 en Stream A.
**Líneas afectadas:** `apps/web/src/app/(clinical)/lis/orders/page.tsx:113`.
**Recomendación:** Adjuntar `T00:00:00` al string antes de construir el Date (`new Date(fromDate + "T00:00:00")`), o usar `date-fns/parseISO` en el servidor. Consistente con la corrección recomendada en Stream A.
**Riesgo go-live:** Alto. Los filtros de fecha en la cola de trabajo del laboratorio pueden ocultar órdenes del día anterior.

#### HH-08 — [P0] — RLS policies con `roles={public}` en tablas LIS e Imaging: 9 políticas afectadas

**Categoría:** C3 — RLS/seguridad multi-tenant.
**Descripción:** Verificado en BD que 9 políticas RLS sobre tablas del dominio diagnóstico tienen `roles={public}` en lugar de `{authenticated}`:
- `LabOrder`: `lab_order_tenant_modify`, `lab_order_tenant_select`
- `LabOrderItem`: `lab_order_item_inherit`
- `LabResult`: `lab_result_inherit`
- `LabSpecimen`: `lab_specimen_inherit`
- `ImagingOrder`: `imaging_order_tenant_modify`, `imaging_order_tenant_select`
- `ImagingReport`: `imaging_report_inherit_order`
- `ImagingModality`: `imaging_modality_inherit_establishment`

Con `roles={public}`, el rol `anon` (no autenticado) tendría las políticas aplicadas. Combinado con HH-06 (sin demote a `authenticated`), las políticas son inoperantes para el objetivo de aislamiento tenant.
**Recomendación:** Modificar cada política para usar `TO authenticated` en lugar del default `TO public`. Patrón documentado en el hallazgo HF-23 (Stream F). Aplicar vía `mcp__supabase__apply_migration` con ALTER POLICY.
**Riesgo go-live:** Crítico. Combinado con HH-06, el aislamiento multi-tenant LIS/Imaging es inexistente en la capa RLS.

#### HH-09 — [P1] — Auto-flagging LIS sin contexto paciente: age/sex siempre null, estratificación ignorada

**Categoría:** C1 — Funcionalidad incompleta.
**Descripción:** El schema `resultEnterWithPatientContextInput` extiende `resultEnterInput` con `patientAgeYears` y `patientSex` para estratificar los rangos de referencia. Sin embargo, el formulario `EnterResultDialog` en `lis/orders/[id]/page.tsx:662-674` nunca envía estos campos. En consecuencia, `evaluateLabResultFlag` siempre opera con `patientAgeYears=null` y `patientSex="BOTH"`, usando el rango más genérico. Los valores críticos para pediatría o para valores distintos entre sexos se calcularán incorrectamente.

Ejemplo: hemoglobina normal MALE adult 13.5-17.5 g/dL vs FEMALE 12.0-15.5 g/dL — sin sexo del paciente el auto-flag puede no detectar anemia en mujeres.
**Líneas afectadas:** `apps/web/src/app/(clinical)/lis/orders/[id]/page.tsx:662-674` (submit del `EnterResultDialog`), `packages/trpc/src/routers/lis.router.ts:210-225`.
**Recomendación:** El router ya carga `order` con `prescriberId`. Extender el include de `order.get` para traer `patient.biologicalSexId` y `patient.birthDate`, calcular age en el servidor y determinar flag sin depender del cliente.
**Riesgo go-live:** Alto. Los valores críticos pueden no detectarse correctamente para ~50% de la población.

#### HH-10 — [P1] — `trpc as unknown as { lis: ... }` cast en 3 páginas LIS: namespace probablemente no montado

**Categoría:** C7 — Contrato tipo/namespace.
**Descripción:** Las páginas `lis/orders/page.tsx:106`, `lis/orders/new/page.tsx:85`, y `lis/results/page.tsx:104` usan `(trpc as unknown as { lis: LisAccess }).lis.*` para acceder al router. El propio comentario del código dice: "Cast `trpc as any` mientras `lis.router` se monta en `_app.ts` en team4 (mismo patrón que vaccination/transfer en este sprint)". Este patrón fue catalogado como P1 en Stream G (HG-18). Si el namespace `lis` no está montado en el router raíz de tRPC, todas las queries fallan silenciosamente en producción con "trpc.lis is not a function".
**Líneas afectadas:** `apps/web/src/app/(clinical)/lis/orders/page.tsx:106`, `lis/orders/new/page.tsx:85`, `lis/results/page.tsx:104`.
**Recomendación:** Verificar que `lisRouter` esté montado en `packages/trpc/src/root.ts` (o equivalente) como `lis: lisRouter`. Si no está montado, el módulo LIS no funciona en producción.
**Riesgo go-live:** Alto. Si el namespace no está montado, el módulo LIS completo es inoperativo.

#### HH-11 — [P2] — Cola de validación (`results/page.tsx`) deriva resultados pendientes del cliente: scalability y stale data

**Categoría:** C1 — Diseño funcional.
**Descripción:** `/lis/results/page.tsx` carga todas las órdenes con `status=RESULTED` (hasta 100) y filtra client-side los `LabResult` con `validatedAt=null`. El propio código documenta el problema en el comentario (línea 14-17): cuando se agregue `result.listPending` con join a `User` para nombre completo, reemplazar. Con volumen de laboratorio hospitalario (potencialmente miles de resultados diarios), esta estrategia descarga toda la data al cliente y la paginación es inoperante.
**Líneas afectadas:** `apps/web/src/app/(clinical)/lis/results/page.tsx:107-138`.
**Recomendación:** Implementar `lis.result.listPending` server-side con paginación cursor. Documentado como deuda técnica en el propio comentario del archivo.
**Riesgo go-live:** Medio. En go-live con volumen limitado puede ser tolerable, pero debe resolverse antes de escalar.

---

## Flujo 3 — RIS/PACS (§18 Imagenología) {#flujo-3}

### 3.1 Resumen ejecutivo

El módulo RIS cubre órdenes de imagen con gestión del ciclo completo: ORDERED → SCHEDULED → IN_PROGRESS → COMPLETED → REPORTED → VALIDATED → CANCELLED. Incluye soporte para modalidades DICOM (9 tipos), reporte radiológico con inmutabilidad post-firma, enmiendas append-only, detección de SLA breaches, y dosis de radiación. La UI tiene 2 rutas: lista filtrable por status/modalidad, y nueva orden.

El router `imaging.router.ts` es el más completo del stream: implementa correctamente la máquina de estados, valida existencia en tenant, emite sin conflictos de nombre. El hallazgo crítico es el mismo que LIS: sin `withTenantContext`, RLS no aplica.

### 3.2 Archivos auditados

| Archivo | Rol |
|---|---|
| `apps/web/src/app/(clinical)/imaging/page.tsx` | Lista órdenes |
| `apps/web/src/app/(clinical)/imaging/new/page.tsx` | Nueva orden |
| `packages/trpc/src/routers/imaging.router.ts` | Router RIS completo |
| `packages/contracts/src/schemas/imaging.ts` | Schemas Zod + state machine |

### 3.3 Matriz de trazabilidad — ImagingOrder Create

| # | Campo UI | Payload tRPC | Schema Zod | ORM Prisma | Columna DB | Tipo UI | Tipo Zod | Req UI | NOT NULL DB | Observación |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Encuentro | `encounterId` | `z.string().uuid()` | `encounterId String` | `encounterId uuid` | text | uuid | SI | SI | Alineado. Router valida existencia en tenant. |
| 2 | Establecimiento | `establishmentId` | `z.string().uuid()` | `establishmentId String` | `establishmentId uuid` | text | uuid | SI | SI | Alineado. |
| 3 | Paciente | `patientId` | `z.string().uuid()` | `patientId String` | `patientId uuid` | text | uuid | SI | SI | Alineado. Router valida concordancia. |
| 4 | Modalidad | `modalityType` | `imagingModalityTypeEnum` (9 valores) | `modalityType ImagingModalityType` | `modalityType "ImagingModalityType"` enum | Select | enum | SI | SI | Alineado. Enum DB confirma 9 valores (CR/CT/MR/US/XA/MG/NM/PT/OTHER). |
| 5 | Descripción estudio | `studyDescription` | `z.string().min(1).max(500)` | `studyDescription String` | `studyDescription varchar` | text | string | SI | SI | Alineado. |
| 6 | Sitio anatómico | `bodySite` | `z.string().max(200).optional()` | `bodySite String?` | `bodySite varchar` | text | string opt | NO | NO | Alineado. |
| 7 | Indicación clínica | `clinicalIndication` | `z.string().min(1).max(2000)` | `clinicalIndication String` | `clinicalIndication text` | textarea | string | SI | SI | Alineado. UI usa `<textarea>` nativo (no el componente Shadcn). |
| 8 | Prioridad | `priority` | `imagingPriorityEnum` (STAT/URGENT/ROUTINE) | `priority ImagingPriority` | `priority "ImagingPriority"` enum | Select | enum | SI | SI | Alineado. |
| 9 | `modalityId` | — | `z.string().uuid().optional()` | `modalityId String?` | `modalityId uuid` | — | uuid opt | NO | NO | UI no expone campo — siempre `null`. Intencional (Wave 1 sin selector de modalidad). |
| 10 | Validación UUID UI | — | — | — | — | text | — | — | — | **C5 P2** — formulario `new/page.tsx` valida presencia de campos (`!f.encounterId.trim()`) pero NO valida formato UUID antes de enviar. A diferencia de LIS, no usa `UUID_RE`. Ver HH-12. |

### 3.4 Hallazgos Flujo 3

#### HH-12 — [P1] — Formulario nueva orden imagen: validación de presencia pero no de formato UUID

**Categoría:** C5 — Validación UI.
**Descripción:** En `imaging/new/page.tsx:75-82`, la función `validate` solo verifica que los campos no estén vacíos (`!f.encounterId.trim()`), pero no valida que sean UUIDs válidos. Un operador que ingrese texto libre en los campos de `encounterId`, `establishmentId` o `patientId` verá el error solo del servidor (después de una round-trip). En contraste, `lis/orders/new/page.tsx` usa `UUID_RE` client-side con feedback inmediato.
**Líneas afectadas:** `apps/web/src/app/(clinical)/imaging/new/page.tsx:75-82`.
**Recomendación:** Agregar validación UUID client-side antes del submit, consistente con el patrón LIS.
**Riesgo go-live:** Medio. UX degradada; el error llega tarde al usuario.

#### HH-13 — [P0] — `imagingRouter` sin `withTenantContext`: mismo patrón RLS bypass que HH-06

**Categoría:** C3 — RLS/seguridad multi-tenant.
**Descripción:** El router `imaging.router.ts` usa `tenantProcedure` directamente en todos sus resolvers, sin `withTenantContext`. Las políticas RLS `imaging_order_tenant_modify` e `imaging_order_tenant_select` (con `roles={public}`) no se aplican en runtime porque el rol `postgres.<ref>` tiene BYPASSRLS. El filtro `where: { organizationId: ctx.tenant.organizationId }` es la única barrera de aislamiento.
**Líneas afectadas:** `packages/trpc/src/routers/imaging.router.ts` — todos los resolvers.
**Recomendación:** Mismo que HH-06: envolver en `withTenantContext`. El único resolvedor que ya tiene un modelo correcto de verificación de tenant es `report.sign` (revisa que la orden exista en la org), pero igualmente requiere RLS a nivel BD para garantía de aislamiento.
**Riesgo go-live:** Crítico. Aislamiento multi-tenant inexistente en capa RLS para Imaging.

#### HH-14 — [P2] — `imaging/new/page.tsx` usa `<textarea>` nativo en lugar del componente Shadcn `Textarea`

**Categoría:** C9 — Calidad UI/accesibilidad.
**Descripción:** En `imaging/new/page.tsx:200-207`, el campo `clinicalIndication` usa `<textarea>` HTML nativo con estilos Tailwind manuales en lugar de `import { Textarea } from "@his/ui/components/textarea"` que es el estándar del design system. El mismo patrón existe en `lis/orders/new/page.tsx:211-218`. Esto rompe la consistencia visual y los overrides de tema (dark mode, accesibilidad focus-ring).
**Líneas afectadas:** `apps/web/src/app/(clinical)/imaging/new/page.tsx:200-207`, `apps/web/src/app/(clinical)/lis/orders/new/page.tsx:211-218`.
**Recomendación:** Reemplazar `<textarea ...>` con `<Textarea ...>` del design system. Cambio trivial.
**Riesgo go-live:** Bajo. Cosmético, pero incoherente con el design system.

#### HH-15 — [P2] — `imaging.order.list` carga incluye `orderingProvider` pero UI no muestra el nombre

**Categoría:** C1 — Funcionalidad incompleta.
**Descripción:** El router `imaging.order.list` incluye `orderingProvider: { select: { id: true, fullName: true } }` (línea 102) pero la UI `/imaging/page.tsx:168-196` no muestra el nombre del proveedor en la tabla (solo Fecha, Paciente, Modalidad, Estudio, Prioridad, Estado). Esto implica una columna DB cargada innecesariamente (JOIN extra) sin uso.
**Líneas afectadas:** `packages/trpc/src/routers/imaging.router.ts:100-103`, `apps/web/src/app/(clinical)/imaging/page.tsx:168`.
**Recomendación:** Agregar columna "Ordenado por" en la tabla UI o eliminar el include del router.
**Riesgo go-live:** Bajo. Overhead de query menor; sin impacto funcional.

---

## Flujo 4 — Pathology (§16 Anatomía Patológica) {#flujo-4}

### 4.1 Resumen ejecutivo

El módulo Pathology (`pathology.router.ts`) implementa el ciclo completo de anatomía patológica (§16 TDR): órdenes por tipo de estudio histopatológico, recepción y descripción macro/micro de especímenes, reportes DRAFT → FINAL con firma patólogo, emisión de eventos `pathology.reportSigned` y `pathology.criticalFinding`, enmiendas append-only (ADR 0004), y uso correcto de `withTenantContext` en todos los resolvers.

**Sin embargo, no existe ninguna ruta UI para este módulo** (no hay `apps/web/src/app/(clinical)/pathology/`), y — hallazgo crítico — **ninguna de las tablas Prisma que el router referencia existe en la base de datos** de Supabase.

### 4.2 Archivos auditados

| Archivo | Rol |
|---|---|
| `packages/trpc/src/routers/pathology.router.ts` | Router Pathology completo |
| BD: búsqueda `information_schema.tables ILIKE '%athology%'` | Confirmación ausencia de tablas |

### 4.3 Matriz de trazabilidad — PathologyOrder Create

| # | Campo | Schema Zod | ORM Prisma | Tabla DB | Observación |
|---|---|---|---|---|---|
| 1 | `encounterId` | `z.string().uuid()` | `tx.pathologyOrder.create(...)` | **`PathologyOrder` — NO EXISTE en BD** | **C7 P0** — toda la operación falla. |
| 2 | `studyType` | `z.enum(["HISTOPATHOLOGY","CYTOLOGY","BIOPSY","IMMUNOHISTOCHEMISTRY","AUTOPSY"])` | `studyType` | **NO EXISTE** | **C7 P0** |
| 3 | `PathologySpecimen` | `z.object({anatomicSite,...})` | `tx.pathologySpecimen.create(...)` | **NO EXISTE en BD** | **C7 P0** |
| 4 | `PathologyReport` | `reportDraftInput` | `tx.pathologyReport.create(...)` | **NO EXISTE en BD** | **C7 P0** |
| 5 | `PathologyMacroDescription` | `specimenGrossInput` | `tx.pathologyMacroDescription.create(...)` | **NO EXISTE en BD** | **C7 P0** |
| 6 | `PathologyMicroDescription` | `specimenMicroInput` | `tx.pathologyMicroDescription.create(...)` | **NO EXISTE en BD** | **C7 P0** |

### 4.4 Hallazgos Flujo 4

#### HH-16 — [P0] — Pathology: 5 tablas Prisma referenciadas no existen en BD

**Categoría:** C7 — Contrato schema/BD.
**Descripción:** El router `pathology.router.ts` hace referencia a 5 tablas Prisma que no existen en la base de datos de Supabase:
- `PathologyOrder`
- `PathologySpecimen`
- `PathologyReport`
- `PathologyMacroDescription`
- `PathologyMicroDescription`

Verificado con `information_schema.tables WHERE table_name ILIKE '%athology%'` — resultado vacío. El router nunca puede ejecutarse en producción: Prisma lanzará `PrismaClientKnownRequestError: The table 'public.PathologyOrder' does not exist in the current database.` en el primer acceso.
**Líneas afectadas:** `packages/trpc/src/routers/pathology.router.ts` — todos los resolvers.
**Recomendación:** Aplicar la migración DDL que crea las tablas de Pathology. Las tablas deben definirse en `schema.prisma` y sincronizarse con la BD a través del flujo de migraciones SQL del proyecto (patrón `packages/database/sql/XX_pathology.sql` aplicado vía `mcp__supabase__apply_migration`).
**Riesgo go-live:** Crítico. El módulo de Anatomía Patológica es completamente inoperativo.

#### HH-17 — [P1] — Pathology sin UI: el router existe pero no hay ninguna ruta en `(clinical)/pathology/`

**Categoría:** C1 — Funcionalidad incompleta.
**Descripción:** No existe ningún archivo bajo `apps/web/src/app/(clinical)/pathology/`. El módulo §16 (Anatomía Patológica) no es accesible desde la interfaz. Si el sidebar referencia una ruta `/pathology`, producirá 404.
**Recomendación:** Crear las páginas UI básicas (lista órdenes, nueva orden, detalle con especímenes y reporte). Hasta que existan las tablas (HH-16), el desarrollo UI puede usar mocks o el router puede fallar con error controlado.
**Riesgo go-live:** Alto. Módulo no disponible para el personal de Anatomía Patológica.

#### HH-18 — [P1] — `pathology.report.sign` no requiere PIN: firma del patólogo sin factor de autenticación

**Categoría:** C6 — Autenticación/firma.
**Descripción:** El procedimiento `report.sign` (`pathology.router.ts:406`) firma el reporte de patología (`DRAFT/PRELIMINARY → FINAL`) sin requerir PIN ni segundo factor de autenticación. La firma es un acto médico-legal de alta consecuencia (diagnósticos de cáncer, biopsias oncológicas). El patrón establecido en ECE para firma de documentos médicos (HH-03, `eceSolicitudEstudio.firmar`) usa PIN argon2id contra `ece.firma_electronica`.
**Líneas afectadas:** `packages/trpc/src/routers/pathology.router.ts:406-490`.
**Recomendación:** Agregar verificación de PIN del patólogo antes de transicionar a FINAL, o integrar con el mecanismo `ece.firma_electronica` si el patólogo está registrado como `personal_salud`.
**Riesgo go-live:** Alto. La firma de reportes de patología sin segundo factor incumple TDR §8.16 (firma electrónica de documentos médicos).

---

## Resumen Consolidado Stream H {#resumen-final}

### Conteo de hallazgos por severidad

| Prioridad | Cantidad | Hallazgos |
|---|---|---|
| **P0 — Crítico** | 6 | HH-01, HH-02, HH-06, HH-08, HH-13, HH-16 |
| **P1 — Alto** | 7 | HH-03, HH-07, HH-09, HH-10, HH-11, HH-17, HH-18 |
| **P2 — Medio** | 5 | HH-04, HH-05, HH-12, HH-14, HH-15 |
| **Total** | **18** | |

### Tabla global de hallazgos

| ID | Módulo | Prioridad | Categoría | Título | Archivo principal |
|---|---|---|---|---|---|
| HH-01 | ECE Estudios | P0 | C7 | Schema drift masivo `ece.solicitud_estudio`: 5 columnas no existen | `ece/solicitud-estudio.router.ts` |
| HH-02 | ECE Estudios | P0 | C7 | Schema drift masivo `ece.resultado_estudio`: 6 columnas no existen | `ece/resultado-estudio.router.ts` |
| HH-03 | ECE Estudios | P1 | C6 | `validar` sin PIN — mismo MC puede auto-validar su solicitud | `ece/solicitud-estudio.router.ts:519` |
| HH-04 | ECE Estudios | P2 | C1 | Códigos de estudio como texto libre — sin validación de formato LOINC/catálogo | `ece/estudios/nueva/page.tsx:81` |
| HH-05 | ECE Estudios | P2 | C6 | Aprobación de resultado sin PIN — acto médico sin segundo factor | `ece/estudios/[id]/page.tsx:229` |
| HH-06 | LIS | P0 | C3 | `lisRouter` sin `withTenantContext` — RLS no aplica en 6 resolvers | `lis.router.ts` (todos) |
| HH-07 | LIS | P1 | C5 | `fromDate` `new Date(string)` → timezone shift de 1 día en filtros | `lis/orders/page.tsx:113` |
| HH-08 | LIS+Imaging | P0 | C3 | 9 policies RLS con `roles={public}` en lugar de `{authenticated}` | BD: `pg_policies` |
| HH-09 | LIS | P1 | C1 | Auto-flagging sin edad/sexo del paciente — estratificación ignorada | `lis/orders/[id]/page.tsx:662-674` |
| HH-10 | LIS | P1 | C7 | `trpc as unknown` cast en 3 páginas LIS — namespace probablemente no montado | `lis/orders/page.tsx:106`, `results/page.tsx:104` |
| HH-11 | LIS | P2 | C1 | Cola de validación filtra resultados client-side — scalability limitada | `lis/results/page.tsx:107-138` |
| HH-12 | Imaging | P1 | C5 | Formulario nueva orden imagen: validación presencia sin formato UUID | `imaging/new/page.tsx:75-82` |
| HH-13 | Imaging | P0 | C3 | `imagingRouter` sin `withTenantContext` — mismo bypass RLS que HH-06 | `imaging.router.ts` (todos) |
| HH-14 | LIS+Imaging | P2 | C9 | `<textarea>` nativo en lugar de componente Shadcn en 2 formularios | `imaging/new/page.tsx:200`, `lis/orders/new/page.tsx:211` |
| HH-15 | Imaging | P2 | C1 | `orderingProvider` incluido en lista pero no mostrado en UI | `imaging.router.ts:100`, `imaging/page.tsx` |
| HH-16 | Pathology | P0 | C7 | 5 tablas Prisma de Pathology no existen en BD | `pathology.router.ts` (todos) |
| HH-17 | Pathology | P1 | C1 | Pathology sin UI — ninguna ruta en `(clinical)/pathology/` | `apps/web/src/app/(clinical)/` |
| HH-18 | Pathology | P1 | C6 | `report.sign` sin PIN — firma de reporte patológico sin segundo factor | `pathology.router.ts:406` |

### ADR de hallazgos

#### ADR-H-001 — RLS Demotion en routers LIS e Imaging

**Contexto:** Los routers `lisRouter` e `imagingRouter` no invocan `withTenantContext`, dejando el aislamiento multi-tenant exclusivamente en filtros JS (`where: { organizationId }`).
**Decisión:** Envolver todos los resolvers con acceso a tablas tenant-scoped en `withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {...})`. Prioridad para go-live: P0.
**Consecuencias:** (a) Las políticas RLS con `roles={public}` deberán corregirse a `TO authenticated` antes de que la demote sea efectiva. (b) Los resolvers que actualmente usan `ctx.prisma.X.findMany(...)` deberán cambiar a `tx.X.findMany(...)`.

#### ADR-H-002 — Schema drift ECE Diagnósticos

**Contexto:** Los routers `ece/solicitud-estudio` y `ece/resultado-estudio` asumen un schema DDL que difiere del implementado en BD (11 columnas entre ambas tablas con nombres diferentes o inexistentes).
**Decisión:** Aplicar una de dos estrategias: (A) corregir el router para usar los nombres reales de columna de BD — sin migración — más rápido; (B) migrar BD con ALTER TABLE para agregar/renombrar columnas — mayor deuda a largo plazo. Se recomienda la opción A dado el patrón del proyecto (precedentes `fix/firma-electronica-schema-drift`, `fix/rri-escritura-schema-drift`).
**Consecuencias:** La opción A requiere revisar si las columnas `prioridad` y `adjunto_uri` son necesidades funcionales reales — si lo son, aplicar DDL en la BD además del ajuste del router.

#### ADR-H-003 — Pathology: tablas faltantes en BD

**Contexto:** El módulo Pathology tiene router completo y contratos Zod, pero las tablas en BD no existen.
**Decisión:** Crear schema DDL `packages/database/sql/XX_pathology.sql` con las 5 tablas (`PathologyOrder`, `PathologySpecimen`, `PathologyReport`, `PathologyMacroDescription`, `PathologyMicroDescription`) siguiendo el patrón de `schema.prisma` existente para LIS e Imaging. Sincronizar `schema.prisma` y aplicar vía `mcp__supabase__apply_migration`.
**Consecuencias:** Sin esta migración, el módulo §16 es inoperativo en producción. La UI puede construirse en paralelo contra stubs una vez exista el schema.

### Comparativa de madurez por módulo

| Módulo | Router | UI | BD | RLS | Firma | Eventos | Madurez |
|---|---|---|---|---|---|---|---|
| ECE Estudios | Maduro (workflow completo, PIN) | Completa | **Schema drift P0** | OK (ece.* scope) | SI (firmar) | SI | Rojo — BD incompatible |
| LIS | Maduro (4-eyes, auto-flag, criticalValue) | Completa | OK | **Sin demote P0** | No aplica | SI (criticalValue) | Naranja — RLS bypass |
| RIS/PACS | Maduro (state machine, DICOM, SLA) | Parcial (lista + nueva) | OK | **Sin demote P0** | Report.sign (sin PIN) | Parcial | Naranja — RLS bypass |
| Pathology | Maduro (full cycle, events, amend) | **Ausente** | **Tablas no existen P0** | OK (usa withTenantContext) | Sin PIN | SI | Rojo — inoperativo |

---

*Documento generado por @AS — Arquitecto de Software, Unidad de Transformación Digital, Inversiones Avante. 2026-05-19.*
*Metodología: 12 categorías C1-C12. Severidad: P0 (crítico/bloqueante go-live), P1 (alto/go-live con riesgo), P2 (medio/deuda técnica controlada).*
