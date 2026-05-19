# Auditoría Stream E — Quirófano + Anestesia (6 módulos NTEC)

**Fecha:** 2026-05-19  
**Auditor:** @AS — Arquitecto de Software, Unidad de Transformación Digital, Inversiones Avante  
**Rama auditada:** `feat/fase2-s1-gate` (commit `6532a92`)  
**Método:** Lectura estática UI + routers tRPC + contratos Zod + consultas directas a Supabase (`information_schema.columns`, `pg_policies`, `information_schema.triggers`, `pg_proc`). Solo lectura — sin modificaciones.  
**Scope:** 6 módulos de quirófano y anestesia — Programación de cirugías, Acto quirúrgico, Pre-operatorio (checklist), WHO checklist, Consentimiento quirúrgico, Registro anestésico.

---

## Índice

1. [Módulo 1 — Programación de Cirugías (bridge-cirugia)](#módulo-1)
2. [Módulo 2 — Acto Quirúrgico (ACT_QX)](#módulo-2)
3. [Módulo 3 — Pre-operatorio / Checklist (PREOP_CHECK)](#módulo-3)
4. [Módulo 4 — WHO Surgical Safety Checklist](#módulo-4)
5. [Módulo 5 — Consentimiento Quirúrgico (CONS_QX)](#módulo-5)
6. [Módulo 6 — Registro Anestésico (REG_ANEST)](#módulo-6)
7. [Resumen Consolidado Stream E](#resumen-consolidado)

---

## Metodología

| Cat | Nombre |
|-----|--------|
| C1  | Trazabilidad UI → ORM → DB (matriz por campo) |
| C2  | Contratos tRPC (input/output Zod schemas) |
| C3  | Seguridad: RLS + tenant isolation + withWorkflowContext |
| C4  | Inmutabilidad post-firma (NTEC Art. 40) |
| C5  | CIE-10 obligatorio (NTEC Art. 17) |
| C6  | Firma electrónica — single/doble firma (NTEC Art. 39) |
| C7  | Schema drift (Prisma vs SQL DDL vs router types) |
| C8  | Audit hash chain (writes registradas en audit.audit_log) |
| C9  | Eventos de dominio (emitDomainEvent) |
| C10 | Manejo de errores y rollback transaccional |
| C11 | Tests y cobertura |
| C12 | Accesibilidad / UX compliance (WCAG 2.2 AA) |

**Severidades:**
- `P0-BLOQUEANTE`: Falla en producción garantizada o violación regulatoria irremediable
- `P1-ALTO`: Riesgo alto, falla probable, vulnerabilidad de seguridad o cumplimiento
- `P2-MEDIO`: Degradación funcional, cobertura incompleta, deuda técnica significativa
- `P3-BAJO`: Mejora recomendable, no bloquea go-live

---

## Módulo 1 — Programación de Cirugías {#módulo-1}

### 1.1 Resumen ejecutivo

La programación quirúrgica se implementa como un bridge atómico (`eceBridgeCirugiaRouter`) que en una sola transacción crea `orden_ingreso` + `episodio_atencion` + `episodio_hospitalario` + `preop_checklist` + `reserva_sala_qx` y emite el evento de dominio `ece.cirugia.programada`. La UI en `/ece/quirofano/programacion/nueva` es funcional y correctamente maneja la zona horaria de El Salvador.

El hallazgo crítico es que las tablas `ece.reserva_sala_qx` y `ece.sala_qx` **no existen en la base de datos de producción** (confirmado vía `information_schema.tables`). Todo el flujo de reserva de sala — que es el núcleo funcional de la programación — fallará con `42P01: relation "ece.reserva_sala_qx" does not exist` en runtime. Adicionalmente, el bridge usa `$transaction` de Prisma directamente (sin `withWorkflowContext`) exponiendo una brecha de aislamiento de tenant.

### 1.2 Archivos auditados

| Capa | Archivo |
|------|---------|
| UI — lista | `apps/web/src/app/(clinical)/ece/quirofano/programacion/page.tsx` |
| UI — nueva | `apps/web/src/app/(clinical)/ece/quirofano/programacion/nueva/page.tsx` |
| tRPC router | `packages/trpc/src/routers/ece/bridge-cirugia.router.ts` |
| SQL DDL (BD) | `ece.orden_ingreso`, `ece.episodio_atencion`, `ece.episodio_hospitalario`, `ece.preop_checklist` (consultados via MCP Supabase) |
| Tablas ausentes | `ece.reserva_sala_qx`, `ece.sala_qx` (confirmado ausencia) |

### 1.3 Matriz de trazabilidad — Programación de cirugías

| # | Campo UI | Payload tRPC | Prop Zod | Columna SQL router | Columna DB Real | Tipo Zod | Tipo DB | NOT NULL DB | Alineado | Observación |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Paciente (UUID) | `pacienteId` | `z.string().uuid()` | `paciente_id` | `paciente_id` (orden_ingreso) | uuid | uuid | YES | OK | Alineado |
| 2 | CIE-10 | `procedimientoCie10` | `z.string().trim().min(1).max(20)` | `procedimiento_cie10` | `procedimiento_cie10` (orden_ingreso) | string 1-20 | text | YES | OK | Alineado |
| 3 | Fecha programada | `fechaProgramada` | `z.string().datetime({offset:true})` | `fecha_hora_orden` | `fecha_hora_orden` (orden_ingreso) | timestamptz string | timestamptz | YES | OK | UI usa `toIsoOffset()` que añade `-06:00` — correcto |
| 4 | Cirujano ID | `cirujanoId` | `z.string().uuid()` | `cirujano_id` | `cirujano_id` (reserva_sala_qx) | uuid | — | — | NO | **C7-P0**: tabla destino `reserva_sala_qx` no existe en DB |
| 5 | Anestesiólogo ID | `anestesiologoId` | `z.string().uuid()` | `anestesiologo_id` | `anestesiologo_id` (reserva_sala_qx) | uuid | — | — | NO | **C7-P0**: tabla destino no existe |
| 6 | Sala QX ID | `salaQxId` | `z.string().uuid()` | `sala_qx_id` | `sala_qx_id` (reserva_sala_qx) | uuid | — | — | NO | **C7-P0**: tabla `reserva_sala_qx` y `sala_qx` ausentes |
| 7 | Duración (min) | `duracionEstimadaMin` | `z.number().int().min(1).max(1440)` | `duracion_estimada_min` | `duracion_estimada_min` (reserva_sala_qx) | int | — | — | NO | **C7-P0**: tabla destino no existe |
| 8 | Motivo ingreso | `motivoIngreso` | `z.string().trim().min(1).max(2000).optional()` | `motivo_ingreso` | `motivo_ingreso` (orden_ingreso) | text opt | text | YES | OK | Se construye con fallback a CIE-10 si omitido |
| 9 | Sala filtro (lista) | `salaQxId` (listProgramacionDia) | `z.string().uuid().optional()` | `r.sala_qx_id` | — | uuid opt | — | — | NO | **C7-P0**: query JOIN con `reserva_sala_qx` fallará |

### 1.4 Hallazgos

#### HE-01 — C7 — P0-BLOQUEANTE — Tablas `ece.reserva_sala_qx` y `ece.sala_qx` no existen en producción

**Descripción:** El router `bridge-cirugia.router.ts` ejecuta INSERT/SELECT sobre `ece.reserva_sala_qx` (pasos 6-7 de la transacción) y hace JOIN con `ece.sala_qx` en `listProgramacionDia`. Ninguna de estas dos tablas existe en el schema `ece` de producción (confirmado vía `information_schema.tables` — solo existe `ece.sala_expulsion`). Toda llamada a `programarCirugia` o `listProgramacionDia` fallará con `42P01: relation "ece.reserva_sala_qx" does not exist`.  
**Archivos afectados:**  
- `packages/trpc/src/routers/ece/bridge-cirugia.router.ts:364-398` (INSERT reserva)  
- `packages/trpc/src/routers/ece/bridge-cirugia.router.ts:451-479` (JOIN sala_qx en list)  
**Impacto:** El flujo de programación quirúrgica está completamente inoperativo en producción. Sin reserva de sala no hay programación, sin programación no hay cirugía ECE.  
**Recomendación:** Crear `ece.sala_qx` y `ece.reserva_sala_qx` con DDL equivalente al que el router asume, o refactorizar el bridge para usar las tablas existentes.  
**Riesgo go-live:** Bloqueante. La funcionalidad de programación quirúrgica (módulo 1 del stream E) es inoperable.

#### HE-02 — C3 — P1-ALTO — `programarCirugia` usa `ctx.prisma.$transaction` sin `withWorkflowContext` — tenant isolation degradado

**Descripción:** El flujo atómico en `bridge-cirugia.router.ts:236` usa `ctx.prisma.$transaction(async (tx) => {...})` directamente, no `withWorkflowContext`. El comentario en el archivo declara explícitamente: "withTenantContext NO se usa: la tx Prisma garantiza atomicidad". Sin embargo, esto significa que el rol de BD es `postgres.<ref>` con `BYPASSRLS`, y las políticas RLS de `ece.orden_ingreso`, `ece.episodio_atencion`, etc. no se aplican. El establecimiento se valida solo en JS vía `personal.establecimiento_id`, que es defensa débil: si `personal_salud` devuelve un resultado cross-tenant (bug o data corruption), se crearían registros en el tenant incorrecto sin que RLS lo detecte.  
**Archivo afectado:** `packages/trpc/src/routers/ece/bridge-cirugia.router.ts:236`  
**Recomendación:** Reemplazar `ctx.prisma.$transaction` por `withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {...})` para que la transacción opere en rol `authenticated` con RLS activo. Requiere construir `eceCtx` antes de la tx.  
**Riesgo go-live:** Alto. Sin RLS enforcement, un usuario de establecimiento A podría (en escenario de corrupción de datos) crear cirugías en establecimiento B.

#### HE-03 — C10 — P1-ALTO — Verificación de disponibilidad de sala fuera de transacción (race condition)

**Descripción:** La función `detectarConflictoSala` (`bridge-cirugia.router.ts:221-232`) se invoca **antes** de abrir la transacción atómica. Esto crea una ventana de TOCTOU (time-of-check, time-of-use): dos solicitudes concurrentes pueden pasar la verificación simultaneamente y ambas insertar reservas solapadas. El check de solapamiento debería ejecutarse dentro de la transacción con `SELECT ... FOR UPDATE` o `LOCK TABLE` para serializar el acceso.  
**Archivo afectado:** `packages/trpc/src/routers/ece/bridge-cirugia.router.ts:221-233`  
**Recomendación:** Mover `detectarConflictoSala` dentro de la transacción Prisma, o usar un advisory lock por `salaQxId` antes de la verificación: `SELECT pg_advisory_xact_lock(hashtext(salaQxId))`.  
**Riesgo go-live:** Alto. En un entorno hospitalario con múltiples usuarios programando cirugías simultáneamente, la probabilidad de doble-reserva es real.

#### HE-04 — C1 — P2-MEDIO — UI acepta UUID de cirujano/anestesiólogo como texto libre sin validación

**Descripción:** Los campos "Cirujano (UUID)", "Anestesiólogo (UUID)" y "Sala QX (UUID)" en `/ece/quirofano/programacion/nueva/page.tsx` son `<Input type="text">` sin lookup ni autocomplete. El usuario debe copiar/pegar UUIDs manualmente. Si el UUID es válido pero referencia a una persona incorrecta o una sala inexistente, el error solo aparece en runtime (FK violation). No hay selector de personal ni de sala que filtre por el establecimiento del usuario.  
**Archivo afectado:** `apps/web/src/app/(clinical)/ece/quirofano/programacion/nueva/page.tsx:184-218`  
**Recomendación:** Añadir endpoints `eceBridgeCirugia.listPersonalQx` y `eceBridgeCirugia.listSalasQx` con `<Combobox>` en UI para selección tipada. Mientras tanto, añadir validación UUID client-side con regex.  
**Riesgo go-live:** Medio. La UI es funcional pero prone a errores operativos graves.

#### HE-05 — C11 — P2-MEDIO — Sin tests para `bridge-cirugia.router.ts`

**Descripción:** No existe archivo `packages/trpc/src/routers/ece/__tests__/bridge-cirugia.router.test.ts` (verificado con `Glob`). El flujo de 8 pasos incluyendo la reserva de sala, detección de conflictos y outbox carece de cobertura de tests. El archivo `__tests__/bridge-cirugia.router.test.ts` aparece en el directorio pero con contenido que prueba el router de bridge-admision, no el de cirugía (error de copia/pegado en el nombre del archivo — se confirma que el test existente en ese directorio prueba el bridge-admision).

**Archivo afectado:** `packages/trpc/src/routers/ece/__tests__/bridge-cirugia.router.test.ts` (ausente o vacío de casos relevantes)  
**Recomendación:** Escribir tests para: (1) `programarCirugia` happy path, (2) detección de conflicto de sala, (3) rollback si episodio_atencion falla, (4) `cancelarPrograma` cascade.  
**Riesgo go-live:** Medio. El flujo más complejo del stream E sin cobertura.

---

## Módulo 2 — Acto Quirúrgico (ACT_QX) {#módulo-2}

### 2.1 Resumen ejecutivo

El router `eceActoQuirurgicoRouter` es uno de los más completos y bien implementados del proyecto. Usa correctamente `withWorkflowContext` (a través del alias local `withEce`), tiene manejo de PIN con lockout argon2id, emite eventos de dominio transaccionales, y verifica inmutabilidad en application layer antes de intentar la escritura. Tiene 15 tests unitarios que cubren los escenarios principales.

El hallazgo crítico de este módulo es el **trigger incondicional** `trg_inmutable_acto_quirurgico` que ejecuta `fn_bloquea_mutacion()` (la cual lanza excepción incondicionalmente) en cualquier UPDATE o DELETE sobre `ece.acto_quirurgico`, sin condición WHEN. Esto significa que el procedure `update` del router — que está correctamente diseñado para funcionar solo en borradores — fallará en DB con `ERRCODE 2F003` incluso cuando el estado es `borrador`. El router verifica el estado en application layer, pero el trigger en BD lo bloquea antes de que la escritura ocurra.

Adicionalmente, la UI de creación (wizard de 4 pasos) acepta `tecnica`, `complicaciones`, `sangrado_estimado_ml`, `muestras_enviadas` y `tiempo_quirurgico_min` en el Zod schema, pero estos campos **no existen como columnas** en `ece.acto_quirurgico` de producción: la tabla solo tiene columnas de texto libre (`diagnostico_pre`, `diagnostico_post`, `procedimiento_realizado`, `hallazgos`) y JSONBs. El router no incluye esos campos en el INSERT ni en el UPDATE — correcto — pero la UI y el schema Zod los definen, creando expectativa falsa.

### 2.2 Archivos auditados

| Capa | Archivo |
|------|---------|
| UI — lista | `apps/web/src/app/(clinical)/ece/quirofano/acto-quirurgico/page.tsx` |
| UI — nueva | `apps/web/src/app/(clinical)/ece/quirofano/acto-quirurgico/nueva/page.tsx` |
| UI — detalle | `apps/web/src/app/(clinical)/ece/quirofano/acto-quirurgico/[id]/page.tsx` |
| tRPC router | `packages/trpc/src/routers/ece/acto-quirurgico.router.ts` |
| Schemas Zod | `packages/trpc/src/routers/ece/acto-quirurgico.schemas.ts` |
| Tests | `packages/trpc/src/routers/ece/__tests__/acto-quirurgico.router.test.ts` |
| SQL DDL (BD) | `ece.acto_quirurgico` (consultado via MCP Supabase) |
| Triggers | `trg_inmutable_acto_quirurgico` → `fn_bloquea_mutacion()` (consultado via MCP) |

### 2.3 Matriz de trazabilidad — Acto quirúrgico

| # | Campo UI | Payload tRPC | Prop Zod | Columna SQL router | Columna DB Real | Tipo Zod | Tipo DB | NOT NULL DB | Alineado | Observación |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Episodio ID | `episodioId` | `z.string().uuid()` | `episodio_id` | `episodio_id` | uuid | uuid | YES | OK | Alineado |
| 2 | Cirujano ID | `cirujanoId` | `z.string().uuid()` | `cirujano_id` | `cirujano_id` | uuid | uuid | YES | OK | Alineado |
| 3 | Anestesiólogo ID | `anestesiologoId` | `z.string().uuid().optional()` | `anestesiologo_id` | `anestesiologo_id` | uuid opt | uuid | NO | OK | Alineado |
| 4 | Diagnóstico pre | `diagnosticoPre` | `z.string().trim().min(1).max(2000)` | `diagnostico_pre` | `diagnostico_pre` | string | text | NO (nullable) | OK | DB es nullable; Zod requiere min(1). Funciona pero DB permite NULL |
| 5 | Diagnóstico post | `diagnosticoPost` | `z.string().trim().max(2000).optional()` | `diagnostico_post` | `diagnostico_post` | string opt | text | NO | OK | Alineado |
| 6 | Procedimiento | `procedimientoRealizado` | `z.string().trim().min(1).max(4000)` | `procedimiento_realizado` | `procedimiento_realizado` | string | text | NO (nullable) | OK | DB es nullable; requerido por Zod |
| 7 | Hallazgos | `hallazgos` | `z.string().trim().max(4000).optional()` | `hallazgos` | `hallazgos` | string opt | text | NO | OK | Alineado |
| 8 | Técnica | `tecnica` | `z.string().trim().max(4000).optional()` | — | **AUSENTE** | string opt | — | — | NO | **C7-P2**: campo en Zod y UI pero no hay columna en DB; el router no lo escribe en SQL |
| 9 | Complicaciones | `complicaciones` | `z.string().trim().max(2000).optional()` | — | **AUSENTE** | string opt | — | — | NO | **C7-P2**: ídem — dato perdido silenciosamente |
| 10 | Sangrado (ml) | `sangradoEstimadoMl` | `z.number().int().min(0).optional()` | — | **AUSENTE** | int opt | — | — | NO | **C7-P2**: ídem — dato clínico perdido sin error |
| 11 | Muestras enviadas | `muestrasEnviadas` | `z.string().trim().max(1000).optional()` | — | **AUSENTE** | string opt | — | — | NO | **C7-P2**: ídem |
| 12 | Tiempo QX (min) | `tiempoQuirurgicoMin` | `z.number().int().min(1).optional()` | — | **AUSENTE** | int opt | — | — | NO | **C7-P2**: ídem |
| 13 | Hora inicio | `horaInicio` | `z.coerce.date().optional()` | `hora_inicio` | `hora_inicio` | Date opt | timestamptz | NO | OK | UI envía `new Date(string)` — ver HE-07 |
| 14 | Hora fin | `horaFin` | `z.coerce.date().optional()` | `hora_fin` | `hora_fin` | Date opt | timestamptz | NO | OK | Ídem |
| 15 | Valoración preop | `valoracionPreop` | `z.object({asaClase, ayunoHoras, alergiasRelevantes}).optional()` | `valoracion_preop` | `valoracion_preop` | object opt | jsonb | NO | OK | Serializado correctamente como JSONB |
| 16 | Ayudantes | `ayudantes` | `z.array(ayudanteSchema).max(10)` | `ayudantes` | `ayudantes` | array | jsonb | NO | OK | Alineado |
| 17 | PIN firma | `pin` | `z.string().regex(/^\d{6,8}$/)` | — (verificación in-memory) | `firma_electronica.pin_hash` | string 6-8 dig | text (hash argon2id) | YES | OK | Verificación con lockout implementada |
| 18 | Checklist salida | `checklistSalidaConfirmado` | `z.boolean().default(false)` | — (solo en outbox payload) | — | boolean | — | — | N/A | Solo se registra en outbox, no en tabla |
| 19 | Registro anestésico | `registroAnestesico` | `z.any().optional()` | `registro_anestesico` | `registro_anestesico` | any | jsonb | NO | RIESGO | **C2-P2**: schema `z.any()` sin validación — acepta cualquier estructura |
| 20 | Recuperación URPA | `recuperacionUrpa` | `z.any().optional()` | `recuperacion_urpa` | `recuperacion_urpa` | any | jsonb | NO | RIESGO | **C2-P2**: schema `z.any()` sin validación |

### 2.4 Hallazgos

#### HE-06 — C4 — P0-BLOQUEANTE — Trigger `trg_inmutable_acto_quirurgico` bloquea TODA mutación incluyendo borradores

**Descripción:** El trigger `trg_inmutable_acto_quirurgico` (BEFORE UPDATE, BEFORE DELETE, sin condición WHEN) ejecuta `fn_bloquea_mutacion()`, la cual lanza `RAISE EXCEPTION 'Registro inmutable (Art. 42 NTEC).' USING ERRCODE='2F003'` incondicionalmente, **sin verificar el estado del documento**. El router `eceActoQx.update` verifica en application layer que `estado_codigo === 'borrador'` antes de ejecutar el UPDATE, pero el trigger en BD lo rechaza independientemente del estado.  
**Consecuencia directa:** `eceActoQx.update` jamás puede completarse — el UPDATE a `ece.acto_quirurgico` siempre falla con `2F003` en BD, sin importar que el documento esté en borrador. El router `firmar` también ejecuta un UPDATE (`estado_registro`) sobre la tabla a través de `avanzarEstado` → UPDATE a `documento_instancia`, pero si algún código auxiliar intenta actualizar `acto_quirurgico` directamente, también fallará.  
**Antecedente conocido:** Este es exactamente el patrón documentado en CLAUDE.md como "Trigger `fn_bloquea_mutacion` incondicional sobre tablas que necesitan UPDATE en borrador — patrón Epicrisis A-05 → C4 P1". El acto quirúrgico replica el mismo anti-patrón con severidad P0 porque bloquea la funcionalidad completa de edición de borradores.  
**Archivos afectados:** Trigger `ece.trg_inmutable_acto_quirurgico` (BD), `packages/trpc/src/routers/ece/acto-quirurgico.router.ts:555-591`  
**Recomendación:** Modificar `fn_bloquea_mutacion` para que verifique el estado antes de bloquear, o crear una función específica `fn_bloquea_mutacion_acto_qx` que solo bloquee cuando `OLD.estado_registro IN ('firmado', 'validado')`. Patrón correcto ya implementado en `fn_bloquea_mutacion_consentimiento` que verifica `OLD.estado IN ('firmado', 'revocado')`.  
**Riesgo go-live:** Bloqueante. El módulo de acto quirúrgico no puede actualizar borradores.

#### HE-07 — C7 — P1-ALTO — 5 campos clínicos en Zod/UI sin columna correspondiente en DB: datos perdidos silenciosamente

**Descripción:** Los campos `tecnica`, `complicaciones`, `sangradoEstimadoMl`, `muestrasEnviadas` y `tiempoQuirurgicoMin` están definidos en `actoQxCreateSchema` y en la UI del wizard (paso 3), pero no existen como columnas en `ece.acto_quirurgico`. El router no los incluye en el INSERT ni en el UPDATE. El usuario los ingresa, el sistema los acepta sin error, pero los datos nunca se persisten.  
**Implicación NTEC:** `complicaciones` es un campo de registro intraoperatorio requerido por Art. 34 (NTEC). `sangradoEstimadoMl` y `tiempoQuirurgicoMin` son métricas quirúrgicas obligatorias para el informe operatorio. Estos datos se pierden silenciosamente.  
**Archivos afectados:**  
- `packages/trpc/src/routers/ece/acto-quirurgico.schemas.ts:69-79` (campos en Zod sin columna DB)  
- `packages/trpc/src/routers/ece/acto-quirurgico.router.ts:506-541` (INSERT sin estos campos)  
- `apps/web/src/app/(clinical)/ece/quirofano/acto-quirurgico/nueva/page.tsx:285-395` (campos en UI)  
**Recomendación:** Agregar columnas `tecnica text`, `complicaciones text`, `sangrado_estimado_ml integer`, `muestras_enviadas text`, `tiempo_quirurgico_min integer` a `ece.acto_quirurgico`, y actualizar el INSERT/UPDATE del router para incluirlas.  
**Riesgo go-live:** Alto. Datos clínicos requeridos por NTEC Art. 34 se pierden sin error visible.

#### HE-08 — C6 — P1-ALTO — UI permite firmar en el mismo wizard de creación con PIN en texto claro visible

**Descripción:** En el paso 4 del wizard (`nueva/page.tsx:483-496`), cuando el usuario marca "Firmar al guardar", el PIN se captura en un `<Input type="password">` con `maxLength={8}`. Sin embargo, el flujo crea primero el documento con `createMut.mutateAsync` y luego llama separadamente a `firmarMut.mutateAsync`. Si la creación tiene éxito pero la firma falla (fallo de red, PIN incorrecto), el documento queda en borrador con ID `createdId` pero sin firma, y el wizard muestra pantalla de éxito genérica. No hay manejo diferenciado del estado parcial (creado-sin-firmar vs creado-y-firmado).  
**Archivo afectado:** `apps/web/src/app/(clinical)/ece/quirofano/acto-quirurgico/nueva/page.tsx:399-440`  
**Recomendación:** Mostrar al usuario el estado real del documento post-submit: "Guardado en borrador (firma pendiente)" vs "Firmado correctamente". Manejar explícitamente el caso creado-sin-firmar en el estado `"success"`.  
**Riesgo go-live:** Alto. Confusión operativa sobre el estado final del documento tras el wizard.

#### HE-09 — C2 — P2-MEDIO — `registroAnestesico` y `recuperacionUrpa` usan `z.any()` sin validación de estructura

**Descripción:** En `actoQxCreateSchema` (líneas 77-78) ambos campos se definen como `z.any().optional()`. En el INSERT del router se serializan directamente como JSONB. Cualquier estructura arbitraria puede almacenarse, incluyendo XSS payloads si se renderiza en UI sin sanitización. Estos campos son clínicamente críticos (registro de medicamentos de anestesia, parámetros URPA).  
**Archivo afectado:** `packages/trpc/src/routers/ece/acto-quirurgico.schemas.ts:77-78`  
**Recomendación:** Definir schemas Zod tipados para el registro anestésico y la recuperación URPA. El `eceRegistroAnestesicoCreateSchema` en `@his/contracts` es el modelo a seguir.  
**Riesgo go-live:** Medio. Sin validación de estructura, la integridad de datos clínicos críticos no está garantizada.

#### HE-10 — C8 — P2-MEDIO — Sin audit triggers en `ece.acto_quirurgico`: hash chain no aplica

**Descripción:** La consulta a `information_schema.triggers` confirma que `ece.acto_quirurgico` solo tiene `trg_inmutable_acto_quirurgico` (inmutabilidad). No existe trigger de audit que inserte en `audit.audit_log` con hash chain. El TDR §6.3 requiere trazabilidad criptográfica para todos los documentos clínicos de alta criticidad. El acto quirúrgico (con firma electrónica) es el documento clínico de mayor criticidad del stream.  
**Recomendación:** Agregar trigger de audit `trg_audit_acto_quirurgico` equivalente al patrón `02_audit_triggers.sql` del proyecto.  
**Riesgo go-live:** Medio. La cadena de custodia criptográfica del acto quirúrgico no está implementada en BD.

---

## Módulo 3 — Pre-operatorio / Checklist (PREOP_CHECK) {#módulo-3}

### 3.1 Resumen ejecutivo

El módulo Pre-operatorio implementa la Lista de Verificación Preoperatoria (NTEC Art. 28) con el router `eceCirugiaPreopRouter`. La estructura es sólida: usa `withWorkflowContext` correctamente vía alias `withEceCtx`, tiene verificación PIN con lockout argon2id, emite eventos de dominio transaccionales, e implementa inmutabilidad en application layer.

El hallazgo principal es un **schema drift de tabla**: el router crea el checklist usando el campo `episodio_hospitalario_id` como FK (correcto según la tabla en BD), pero el bridge-cirugia (Módulo 1) crea el `preop_checklist` con campos `orden_id`, `episodio_id` y `paciente_id` que no corresponden a las columnas reales de la tabla `ece.preop_checklist`. El bridge-cirugia inserta en `ece.preop_checklist` usando columnas que no existen (`orden_id`, `episodio_id` como FK primaria), mientras que el router del módulo 3 usa `episodio_hospitalario_id` que sí existe. Esto crea dos flujos de creación inconsistentes para la misma tabla.

Un segundo hallazgo importante es que el router `preop-checklist` usa `episodio_hospitalario_id` como campo `episodio_id` en el INSERT a `documento_instancia`, lo cual es semánticamente incorrecto (la instancia espera el ID del episodio_atencion, no del episodio_hospitalario).

### 3.2 Archivos auditados

| Capa | Archivo |
|------|---------|
| UI — lista | `apps/web/src/app/(clinical)/ece/quirofano/preop/page.tsx` |
| UI — nueva | `apps/web/src/app/(clinical)/ece/quirofano/preop/nueva/page.tsx` |
| UI — detalle | `apps/web/src/app/(clinical)/ece/quirofano/preop/[id]/page.tsx` |
| tRPC router | `packages/trpc/src/routers/ece/preop-checklist.router.ts` |
| Tests | `packages/trpc/src/routers/ece/__tests__/preop-checklist.router.test.ts` |
| SQL DDL (BD) | `ece.preop_checklist` (consultado via MCP Supabase) |

### 3.3 Matriz de trazabilidad — Pre-operatorio

| # | Campo UI | Payload tRPC | Prop Zod | Columna SQL router | Columna DB Real | Tipo Zod | Tipo DB | NOT NULL DB | Alineado | Observación |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | UUID episodio hosp. | `episodioHospitalarioId` | `z.string().uuid()` | `episodio_hospitalario_id` | `episodio_hospitalario_id` | uuid | uuid | YES | OK | Alineado. Columna existe y coincide |
| 2 | Ayuno (horas) | `ayunoHoras` | `z.number().int().min(0).max(24).optional()` | `ayuno_horas` | `ayuno_horas` | int 0-24 opt | smallint | NO | OK | Tipo en DB: smallint; Zod: number. Compatible. Límite 24h coincide |
| 3 | Marcapasos | `marcapasos` | `z.boolean().optional()` | `marcapasos` | `marcapasos` | boolean opt | boolean | NO | OK | Alineado |
| 4 | Alergias | `alergias` | `z.string().max(2000).optional()` | `alergias` | `alergias` | string opt | text | NO | OK | Sin límite en DB; Zod limita a 2000 chars. Seguro |
| 5 | Anticoagulantes | `anticoagulantes` | `z.boolean().optional()` | `anticoagulantes` | `anticoagulantes` | boolean opt | boolean | NO | OK | Alineado |
| 6 | Retiro prótesis | `retiroProtesis` | `z.boolean().optional()` | `retiro_protesis` | `retiro_protesis` | boolean opt | boolean | NO | OK | Alineado |
| 7 | ID paciente verificada | `identificacionPacienteVerificada` | `z.boolean().optional()` | `identificacion_paciente_verificada` | `identificacion_paciente_verificada` | boolean opt | boolean | NO | OK | Alineado |
| 8 | Sitio marcado | `sitioMarcado` | `z.boolean().optional()` | `sitio_marcado` | `sitio_marcado` | boolean opt | boolean | NO | OK | Alineado |
| 9 | Consentimiento firmado | `consentimientoFirmado` | `z.boolean().optional()` | `consentimiento_firmado` | `consentimiento_firmado` | boolean opt | boolean | NO | OK | Es campo de verificación local, no FK |
| 10 | ASA | `riesgoAnestesicoAsa` | `z.number().int().min(1).max(5).optional()` | `riesgo_anestesico_asa` | `riesgo_anestesico_asa` | int 1-5 opt | smallint | NO | OK | Alineado |
| 11 | PIN firma | `pin` | `z.string().regex(/^\d{6,8}$/)` | — | `firma_electronica.pin_hash` | string 6-8 | text hash | YES | OK | Argon2id correcto |
| 12 | `instancia_id` | — (resuelto server-side) | — | `instancia_id` | `instancia_id` | uuid | uuid | YES | OK | Creado en server, no expuesto en UI |
| 13 | Firmado por | — (server-side) | — | `firmado_por` | `firmado_por` | uuid | uuid | NO | OK | Actualizado en firma |
| 14 | Firmado en | — (server-side) | — | `firmado_en` | `firmado_en` | — | timestamptz | NO | OK | Trigger `trg_preop_immutable` verifica `OLD.firmado_en IS NOT NULL` |

### 3.4 Hallazgos

#### HE-11 — C7 — P0-BLOQUEANTE — Bridge-cirugia inserta en `preop_checklist` con columnas inexistentes

**Descripción:** El bridge `bridge-cirugia.router.ts:339-360` ejecuta INSERT a `ece.preop_checklist` usando columnas `orden_id`, `episodio_id`, `paciente_id`, `estado`, `creado_por` y `creado_en`. Sin embargo, la tabla real `ece.preop_checklist` tiene `instancia_id`, `episodio_hospitalario_id` (NOT NULL), `registrado_por` y `registrado_en`. Las columnas `orden_id`, `paciente_id`, `estado`, `creado_por` y `creado_en` **no existen** en la tabla. El INSERT del bridge falla con `42703: column "orden_id" of relation "preop_checklist" does not exist`.  
**Consecuencia:** El paso 5 de la transacción `programarCirugia` falla, causando rollback completo — ningún componente de la programación quirúrgica se crea.  
**Archivos afectados:**  
- `packages/trpc/src/routers/ece/bridge-cirugia.router.ts:339-360`  
- Tabla `ece.preop_checklist` en BD (columnas reales verificadas via MCP)  
**Recomendación:** El bridge-cirugia debe crear la instancia de documento primero (`documento_instancia`) y luego insertar en `preop_checklist` con `instancia_id` y `episodio_hospitalario_id`. Requiere que el bridge conozca el `episodio_hospitalario_id` del episodio recién creado.  
**Riesgo go-live:** Bloqueante. Acumula con HE-01 para hacer inoperable la totalidad del flujo de programación quirúrgica.

#### HE-12 — C3 — P1-ALTO — RLS INSERT en `preop_checklist` sin política `WITH CHECK`

**Descripción:** La política `preop_insert_by_estab` (confirmada vía `pg_policies`) tiene `cmd=INSERT` y `qual=null`. En PostgreSQL, para INSERT la columna `qual` contiene la política `WITH CHECK`. `qual=null` significa que la política no tiene restricción de `WITH CHECK` — cualquier fila puede insertarse independientemente del establecimiento. El contexto `ece.current_establecimiento_id_safe()` no se verifica en INSERT. Solo SELECT y UPDATE tienen políticas con `qual` condicional.  
**Archivo afectado:** Política `preop_insert_by_estab` en `ece.preop_checklist` (BD)  
**Recomendación:** Añadir `WITH CHECK` a la política INSERT: `WITH CHECK (EXISTS (SELECT 1 FROM ece.episodio_hospitalario eh JOIN ece.episodio_atencion ea ON ea.id = eh.episodio_id WHERE eh.episodio_id = preop_checklist.episodio_hospitalario_id AND ea.establecimiento_id = ece.current_establecimiento_id_safe()))`.  
**Riesgo go-live:** Alto. Un usuario autenticado de establecimiento A podría insertar un preop checklist referenciando un episodio_hospitalario de establecimiento B.

#### HE-13 — C7 — P1-ALTO — `episodio_hospitalario_id` pasado como `episodio_id` en `documento_instancia`

**Descripción:** En `preop-checklist.router.ts:413-420`, el INSERT a `ece.documento_instancia` usa `episodio_id = ${input.episodioHospitalarioId}`. El campo `episodioHospitalarioId` es el ID de la tabla `ece.episodio_hospitalario`, pero `documento_instancia.episodio_id` es FK a `ece.episodio_atencion.id`. Estos son IDs distintos: `episodio_hospitalario.episodio_id` apunta al `episodio_atencion`, pero `episodio_hospitalario.id` no es un `episodio_atencion.id`. El INSERT puede fallar con FK violation, o peor, referenciar un episodio de otro contexto si los UUIDs colisionan por accidente.  
**Archivo afectado:** `packages/trpc/src/routers/ece/preop-checklist.router.ts:410-422`  
**Recomendación:** Resolver primero el `episodio_id` correcto del `episodio_atencion` a partir del `episodio_hospitalario`:  
```sql
SELECT episodio_id FROM ece.episodio_hospitalario WHERE episodio_id = $1
```
y usar ese ID en el INSERT a `documento_instancia`.  
**Riesgo go-live:** Alto. El workflow ECE quedará con instancias apuntando a episodios incorrectos.

#### HE-14 — C11 — P2-MEDIO — Tests del preop-checklist solo validan schemas Zod, no el router

**Descripción:** `preop-checklist.router.test.ts` contiene exclusivamente tests de schema Zod (schemas definidos localmente en el test, no los del router importado). No hay tests de comportamiento del router: no se prueba el CREATE, el UPDATE post-firma, el flujo firmar, ni los casos de error (episodio no encontrado, tipo de documento no configurado, PIN incorrecto). El comentario del archivo lista explícitamente que "los tests de comportamiento del router" son PR pendientes.  
**Archivo afectado:** `packages/trpc/src/routers/ece/__tests__/preop-checklist.router.test.ts`  
**Recomendación:** Añadir tests con `mockDeep<PrismaClient>()` para los 4 flujos principales del router (list, create, update, firmar) y casos de error.  
**Riesgo go-live:** Medio. El módulo con mayor complejidad transaccional del stream carece de tests de comportamiento.

---

## Módulo 4 — WHO Surgical Safety Checklist {#módulo-4}

### 4.1 Resumen ejecutivo

El módulo WHO implementa el checklist de cirugía segura OMS 2009 con 3 fases secuenciales (Sign-In / Time-Out / Sign-Out). La implementación es correcta en su mayoría: los 20 ítems canónicos están definidos en la UI, el flujo de transiciones es lineal y bien validado, y la tabla `ece.who_checklist` existe con la estructura correcta.

El hallazgo de mayor impacto es que el router `eceWhoChecklistRouter` opera **completamente fuera** del contexto de `withWorkflowContext`: lee y escribe sobre `ctx.prisma` directamente (sin `withWorkflowContext`), lo que significa que opera con el rol de BD de bypass RLS. La política RLS de SELECT/UPDATE existe en la tabla, pero con el rol `postgres.<ref>` (BYPASSRLS) estas políticas son ignoradas. El segundo hallazgo crítico es que el evento de dominio en `marcarSignOut` usa una función `emitOutbox` local que escribe directamente a `public.outbox` sin schema explícito, y no usa el patrón canónico `emitDomainEvent` del proyecto — lo que rompe el contrato de outbox transaccional.

Adicionalmente, la UI envía `responsableId: "00000000-0000-0000-0000-000000000000"` (UUID hardcodeado nulo) en las tres fases — el responsable de cada fase no se registra con el ID real del usuario.

### 4.2 Archivos auditados

| Capa | Archivo |
|------|---------|
| UI — checklist | `apps/web/src/app/(clinical)/ece/quirofano/who-check/page.tsx` |
| UI — panel | `apps/web/src/app/(clinical)/ece/quirofano/who-check/_components/fase-panel.tsx` |
| tRPC router | `packages/trpc/src/routers/ece/who-checklist.router.ts` |
| Tests | `packages/trpc/src/routers/ece/__tests__/who-checklist.test.ts` |
| SQL DDL (BD) | `ece.who_checklist` (consultado via MCP Supabase) |

### 4.3 Matriz de trazabilidad — WHO Checklist

| # | Campo UI | Payload tRPC | Prop Zod | Columna SQL router | Columna DB Real | Tipo Zod | Tipo DB | NOT NULL DB | Alineado | Observación |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Acto QX ID (URL param) | `actoQuirurgicoId` | `z.string().uuid()` | `acto_quirurgico_id` | `acto_quirurgico_id` | uuid | uuid | YES | OK | Pasado vía `?actoId=` query param |
| 2 | Responsable ID | `responsableId` | `z.string().uuid()` | — (solo en JSONB) | — | uuid | jsonb serialized | — | RIESGO | **C6-P1**: UI hardcodea `"00000000-..."` — no se registra el usuario real |
| 3 | Responsable nombre | `responsableNombre` | `z.string().min(1).max(200)` | — (solo en JSONB) | — | string | jsonb serialized | — | OK | Se serializa en `fase_sign_in/time_out/sign_out` JSONB |
| 4 | Ítems Sign-In (8) | `items` (signIn) | `z.array(whoItemSchema).min(1).max(20)` | — (solo en JSONB) | `fase_sign_in` jsonb | array | jsonb | NO | OK | 8 ítems WHO canónicos definidos en UI |
| 5 | Ítems Time-Out (7) | `items` (timeOut) | `z.array(whoItemSchema).min(1).max(20)` | — (solo en JSONB) | `fase_time_out` jsonb | array | jsonb | NO | OK | 7 ítems WHO canónicos |
| 6 | Ítems Sign-Out (5) | `items` (signOut) | `z.array(whoItemSchema).min(1).max(20)` | — (solo en JSONB) | `fase_sign_out` jsonb | array | jsonb | NO | OK | 5 ítems WHO canónicos |
| 7 | Estado | — (server-side) | — | `estado` | `estado` | text enum | text | YES (default 'iniciado') | OK | Transiciones controladas por el router |
| 8 | Registrado por | — (ctx.user.id) | — | `registrado_por` | `registrado_por` | uuid | uuid | YES | OK | Asignado desde ctx.user.id en CREATE |
| 9 | Actualizado en | — (server-side) | — | `actualizado_en` | `actualizado_en` | — | timestamptz | YES | OK | Trigger `fn_who_checklist_updated_en` actualiza automáticamente |

### 4.4 Hallazgos

#### HE-15 — C3 — P1-ALTO — WHO router opera sin `withWorkflowContext` — RLS bypassed para todas las operaciones

**Descripción:** El router `eceWhoChecklistRouter` no usa `withWorkflowContext` en ninguna de sus operaciones. Lee y escribe directamente sobre `ctx.prisma` (rol `postgres.<ref>` con BYPASSRLS). Las políticas RLS `who_checklist_select`, `who_checklist_update`, `who_checklist_insert` existen en BD pero son ignoradas. Un usuario de establecimiento A puede leer/modificar checklists de cualquier establecimiento si conoce el `actoQuirurgicoId`.  
**Archivo afectado:** `packages/trpc/src/routers/ece/who-checklist.router.ts:132-344` (todos los procedures)  
**Recomendación:** Envolver todas las operaciones en `withWorkflowContext(ctx.prisma, buildEceCtx(ctx), async (tx) => {...})`. El `list` ya filtra por `ea.establecimiento_id = ${ctx.tenant!.organizationId}` pero al operar con BYPASSRLS no se garantiza el aislamiento.  
**Riesgo go-live:** Alto. Violación de tenant isolation en un módulo clínico de seguridad quirúrgica.

#### HE-16 — C9 — P1-ALTO — `emitOutbox` local en lugar de `emitDomainEvent` — contrato de outbox roto

**Descripción:** El procedure `marcarSignOut` usa una función helper local `emitOutbox` (`who-checklist.router.ts:112-122`) que ejecuta INSERT directo a `public.outbox` (`INSERT INTO public.outbox (event_type, payload, created_at) VALUES (...)`). El resto del proyecto usa `emitDomainEvent` de `@his/database`, que registra en la tabla de outbox con el schema completo incluyendo `organization_id`, `aggregate_type`, `aggregate_id` y `emitted_by_id`. El schema real de `public.outbox` puede tener columnas `NOT NULL` adicionales que esta función no provee (como `organization_id`), causando un error de inserción silencioso o de runtime.  
**Archivo afectado:** `packages/trpc/src/routers/ece/who-checklist.router.ts:112-122` y `:337`  
**Recomendación:** Reemplazar `emitOutbox` por `emitDomainEvent` del patrón canónico:  
```ts
await emitDomainEvent(tx, {
  organizationId: ctx.tenant.organizationId,
  eventType: "ece.who_checklist.completado",
  aggregateType: "WhoChecklist",
  aggregateId: rows[0].id,
  emittedById: ctx.user.id,
  payload: { ... }
});
```
**Riesgo go-live:** Alto. El evento de completado del checklist WHO puede no persistirse, rompiendo integraciones downstream que dependen del outbox.

#### HE-17 — C6 — P1-ALTO — `responsableId` hardcodeado como UUID-cero en UI — responsable de cada fase no identificado

**Descripción:** En `who-check/page.tsx:175`, `:193` y `:212`, el campo `responsableId` se envía con valor fijo `"00000000-0000-0000-0000-000000000000"` para las tres fases. El router acepta y persiste este UUID-cero en el JSONB de cada fase (`fase_sign_in`, `fase_time_out`, `fase_sign_out`). El registro de quién verificó cada fase (médico de turno, anestesiólogo, enfermera circulante) es un requisito de trazabilidad del WHO checklist OMS 2009. Con UUID-cero, no es posible determinar qué personal firmó cada fase.  
**Archivo afectado:** `apps/web/src/app/(clinical)/ece/quirofano/who-check/page.tsx:175,193,212`  
**Recomendación:** Usar `ctx.user.id` desde el servidor como `responsableId`, o añadir un selector de personal en el `FasePanel`. La forma más simple: ignorar `responsableId` del cliente y derivarlo de `ctx.user.id` en el router.  
**Riesgo go-live:** Alto. El checklist WHO carece de trazabilidad de responsables — requisito del protocolo OMS 2009 y NTEC Art. 35.

#### HE-18 — C3 — P2-MEDIO — Política RLS INSERT de `who_checklist` sin `WITH CHECK`

**Descripción:** La política `who_checklist_insert` tiene `qual=null` (sin `WITH CHECK`), equivalente a HE-12. INSERT sin restricción de establecimiento permite crear checklists WHO para actos quirúrgicos de cualquier establecimiento.  
**Recomendación:** Añadir `WITH CHECK` equivalente al de SELECT/UPDATE:  
```sql
WITH CHECK (EXISTS (
  SELECT 1 FROM ece.acto_quirurgico aq
  JOIN ece.episodio_atencion ea ON ea.id = aq.episodio_id
  WHERE aq.id = who_checklist.acto_quirurgico_id
    AND ea.establecimiento_id = ece.current_establecimiento_id()
))
```
**Riesgo go-live:** Medio en este módulo (combinado con HE-15 es Alto de facto).

#### HE-19 — C11 — P3-BAJO — Tests WHO solo validan schemas y lógica de transición local, no el router

**Descripción:** `who-checklist.test.ts` cubre schemas Zod y una función `validateTransition` local definida en el propio test (no es la lógica del router real). No hay tests que prueben el UPSERT de Sign-In, la secuencia ordenada Sign-In→Time-Out→Sign-Out, ni el `emitOutbox` en Sign-Out.  
**Recomendación:** Añadir tests de integración con mock de Prisma para los 3 procedures de marcado.  
**Riesgo go-live:** Bajo. La lógica es sencilla pero el outbox y los errores de secuencia no están cubiertos.

---

## Módulo 5 — Consentimiento Quirúrgico (CONS_QX) {#módulo-5}

### 5.1 Resumen ejecutivo

El consentimiento quirúrgico se implementa sobre el router `eceConsentimientoRouter` existente, mediante el procedure adicional `crearQuirurgico` que inserta en `ece.consentimiento_informado` (tabla base) y luego en `ece.consentimiento_quirurgico` (tabla satélite). La UI en `/ece/quirofano/consentimiento-qx/nuevo` es el wizard de 4 pasos más completo del stream E, con doble firma (canvas de paciente + PIN de médico).

El hallazgo P0 es que **`ece.consentimiento_quirurgico` no existe en producción** (tabla satélite para los campos específicos de CONS_QX). El paso 5b del `crearQuirurgico` —INSERT a `ece.consentimiento_quirurgico`— fallará con `42P01`. El resto del flujo (base en `consentimiento_informado`) funcionaría, pero los campos específicos del CONS_QX (tipo de anestesia, autorizaciones de transfusión/ampliación/fotografía) se perderían.

Un segundo hallazgo importante es que el wizard UI completa los 4 pasos incluida la firma del paciente en canvas, pero llama solo a `crearQuirurgico` —que crea el borrador— sin llamar a `firmarPaciente` ni a `firmar` del router. La firma del paciente (Step 2) queda en `s2.firmaDataUrl` en estado local del cliente y **nunca se envía al servidor**. El consentimiento quirúrgico se crea siempre en borrador, ignorando la firma del canvas del paciente.

### 5.2 Archivos auditados

| Capa | Archivo |
|------|---------|
| UI — nueva | `apps/web/src/app/(clinical)/ece/quirofano/consentimiento-qx/nuevo/page.tsx` |
| UI — lista | `apps/web/src/app/(clinical)/ece/quirofano/consentimiento-qx/page.tsx` |
| tRPC router | `packages/trpc/src/routers/ece/consentimiento.router.ts` |
| Schemas Zod | `packages/trpc/src/routers/ece/schemas.ts` |
| SQL DDL (BD) | `ece.consentimiento_informado` (consultado via MCP Supabase) |
| Tabla ausente | `ece.consentimiento_quirurgico` (confirmado ausente via MCP) |

### 5.3 Matriz de trazabilidad — Consentimiento quirúrgico

| # | Campo UI | Payload tRPC | Prop Zod | Columna SQL router | Columna DB Real | Tipo Zod | Tipo DB | NOT NULL DB | Alineado | Observación |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Episodio ID | `episodioId` | `z.string().uuid()` | `episodio_id` | `episodio_id` | uuid | uuid | NO | OK | Alineado |
| 2 | Tipo consentimiento | `tipoConsentimiento` | — (fijo: "quirurgico") | `tipo` | `tipo` | text | text | YES | OK | Hardcodeado a "quirurgico" en payload |
| 3 | Procedimiento | `procedimientoDescrito` | `z.string()` | `procedimiento_descrito` | `procedimiento_descrito` | text | text | YES | OK | Alineado |
| 4 | Riesgos | `riesgos` | `z.string().optional()` | `riesgos_explicados` | `riesgos_explicados` | text opt | text | NO | OK | Alineado |
| 5 | Alternativas | `alternativas` | `z.string().optional()` | `alternativas` | `alternativas` | text opt | text | NO | OK | Alineado |
| 6 | Tipo anestesia | `tipoAnestesia` | `z.enum([...])` | `tipo_anestesia` | **AUSENTE** | string | — | — | NO | **C7-P0**: tabla `ece.consentimiento_quirurgico` no existe |
| 7 | Transfusión autorizada | `transfusionAutorizada` | `z.boolean()` | `transfusion_autorizada` | **AUSENTE** | boolean | — | — | NO | **C7-P0**: ídem |
| 8 | Ampliación QX | `ampliacionQuirurgicaAutorizada` | `z.boolean()` | `ampliacion_quirurgica_autorizada` | **AUSENTE** | boolean | — | — | NO | **C7-P0**: ídem |
| 9 | Fotografía | `fotografiaGrabacionAutorizada` | `z.boolean()` | `fotografia_grabacion_autorizada` | **AUSENTE** | boolean | — | — | NO | **C7-P0**: ídem |
| 10 | Firma paciente (canvas) | `firmaImagenUri` (firmarPaciente) | `z.string()` | `evidencia_firma_ref` | `evidencia_firma_ref` | text | text | NO | NO | **C6-P0**: UI no llama a `firmarPaciente` — firma canvas nunca llega al servidor |
| 11 | PIN médico | `pin` (firmar) | `z.string().regex(/^\d{6,8}$/)` | — (argon2id) | `firma_electronica.pin_hash` | string | text hash | YES | PARCIAL | UI verifica PIN vía `PinConfirmModal` pero solo llama a `crearQuirurgico`, no a `firmar` |
| 12 | Estado | — (borrador siempre) | — | `estado` | `estado` | text | text | YES (default 'borrador') | RIESGO | Siempre queda en borrador por HE-21 |
| 13 | `firma_mc_id` | — | — | — | `firma_mc_id` | — | uuid | NO | N/A | Campo en BD no usado por el router (diferencia de schema) |
| 14 | Médico que informa | — (personal.id) | — | `medico_que_informa` | `medico_que_informa` | uuid | uuid | YES | OK | Derivado de `findPersonal(ctx.user.id)` |

### 5.4 Hallazgos

#### HE-20 — C7 — P0-BLOQUEANTE — `ece.consentimiento_quirurgico` no existe en producción

**Descripción:** El procedure `crearQuirurgico` (`consentimiento.router.ts:840-857`) ejecuta INSERT a `ece.consentimiento_quirurgico` con columnas `consentimiento_id`, `tipo_anestesia`, `transfusion_autorizada`, `ampliacion_quirurgica_autorizada`, `fotografia_grabacion_autorizada`. Esta tabla no existe en producción (confirmado: count=0 en `information_schema.tables`). El step 5b falla con `42P01`, causando rollback total — ni la fila base en `consentimiento_informado` se persiste.  
**Archivos afectados:**  
- `packages/trpc/src/routers/ece/consentimiento.router.ts:840-857`  
**Recomendación:** Crear la tabla `ece.consentimiento_quirurgico` con DDL que incluya los 4 campos que el router asume, o — si se prefiere evitar la tabla satélite — almacenar los campos quirúrgicos adicionales en un JSONB `datos_qx` de `consentimiento_informado`.  
**Riesgo go-live:** Bloqueante. El consentimiento quirúrgico CONS_QX no puede crearse.

#### HE-21 — C6 — P0-BLOQUEANTE — La firma del paciente (canvas) nunca se envía al servidor: CONS_QX siempre queda en borrador

**Descripción:** El wizard UI (`consentimiento-qx/nuevo/page.tsx:298-315`) captura la firma del paciente en `s2.firmaDataUrl` (Step 2) y valida el PIN del médico en `s3.pinConfirmado` (Step 3). Sin embargo, el submit final (`onSubmit`) solo llama a `crearQx.mutate(...)` — es decir, solo `eceConsentimiento.crearQuirurgico` — sin llamar a `eceConsentimiento.firmarPaciente(firmaDataUrl)` ni a `eceConsentimiento.firmar(pin)`. El consentimiento se crea siempre en estado `borrador`, la firma del canvas del paciente se descarta, y el PIN del médico (ya verificado en `PinConfirmModal`) no se usa para avanzar el workflow.  
**Consecuencia NTEC:** El Art. 40 exige que el consentimiento esté firmado (doble firma) para ser legalmente válido. Un sistema que siempre deja el consentimiento en borrador no cumple con el Art. 40, y un procedimiento quirúrgico sobre un consentimiento en borrador carece de validez legal.  
**Archivos afectados:**  
- `apps/web/src/app/(clinical)/ece/quirofano/consentimiento-qx/nuevo/page.tsx:298-315`  
**Recomendación:** Añadir las llamadas en secuencia dentro de `onSubmit`:  
1. `crearQx` → obtener `consentimientoId`  
2. `firmarPaciente({ consentimientoId, firmaImagenUri: s2.firmaDataUrl, ... })`  
3. `firmar({ consentimientoId, pin: s3.firmaId })` (donde `firmaId` es el resultado de `PinConfirmModal`)  
**Riesgo go-live:** Bloqueante. Violación regulatoria del Art. 40 NTEC — consentimientos quirúrgicos siempre sin firma válida.

#### HE-22 — C7 — P1-ALTO — `consentimiento_informado` tiene columna `estado` nativa Y columna `estado_codigo` en el router (JOIN `flujo_estado`)

**Descripción:** La tabla `ece.consentimiento_informado` tiene columna propia `estado text NOT NULL DEFAULT 'borrador'`. El router hace JOIN con `ece.documento_instancia` → `ece.flujo_estado` y devuelve `fe.codigo AS estado_codigo`. Hay dos fuentes de estado: la columna nativa `estado` y el estado derivado del workflow `documento_instancia`. El trigger `fn_bloquea_mutacion_consentimiento` usa `OLD.estado` para verificar inmutabilidad. Si ambos estados se dessincronizan (ej. el workflow avanza a "firmado" pero `estado` sigue en "borrador"), el trigger no bloqueará correctamente.  
**Archivos afectados:**  
- `packages/trpc/src/routers/ece/consentimiento.router.ts` (usa `fe.codigo AS estado_codigo`)  
- Trigger `fn_bloquea_mutacion_consentimiento` (usa `OLD.estado`)  
**Recomendación:** Agregar UPDATE de `estado` nativo sincronizado con el avance del workflow en `avanzarEstado()`, o eliminar la columna nativa `estado` y refactorizar el trigger para consultar `documento_instancia`.  
**Riesgo go-live:** Alto. Inconsistencia de estado puede dejar consentimientos firmados mutables o borradores inmutables.

#### HE-23 — C8 — P2-MEDIO — Sin audit triggers en `ece.consentimiento_informado`

**Descripción:** Solo existe `trg_inmutable_consentimiento_informado` (inmutabilidad). No hay trigger de audit que inserte en `audit.audit_log`. Para un documento con validez legal del Art. 40, la cadena de custodia criptográfica es especialmente crítica.  
**Recomendación:** Agregar trigger de audit equivalente al patrón `02_audit_triggers.sql`.  
**Riesgo go-live:** Medio. Sin audit chain, las modificaciones pre-firma no quedan trazadas criptográficamente.

---

## Módulo 6 — Registro Anestésico (REG_ANEST) {#módulo-6}

### 6.1 Resumen ejecutivo

El router `eceRegistroAnestesicoRouter` es el módulo con mayor desviación arquitectónica del stream E. Importa directamente desde `@his/contracts` (`eceRegistroAnestesicoCreateSchema`, `eceRegistroAnestesicoListSchema`, `registrarSignoVitalSchema`) y `@prisma/client`, en lugar de usar los schemas locales del worktree. Usa `withWorkflowContext` correctamente via alias `withEceContext`, emite eventos de dominio transaccionales con `emitDomainEvent`, y tiene manejo de error robusto.

Los hallazgos principales son: (1) el procedure `list` opera **sin** `withWorkflowContext`, sin filtro de establecimiento — devuelve todos los registros anestésicos de todos los establecimientos para cualquier usuario autenticado; (2) el procedure `firmar` no requiere PIN — cualquier usuario con rol `ESP` puede firmar con solo enviar el ID del registro, sin verificación de identidad argon2id; (3) `instancia_id` en BD es nullable (NO tiene instancia de workflow), lo que excluye el registro anestésico del motor de workflow ECE.

### 6.2 Archivos auditados

| Capa | Archivo |
|------|---------|
| UI — lista | `apps/web/src/app/(clinical)/ece/registro-anestesico/page.tsx` |
| UI — nueva | `apps/web/src/app/(clinical)/ece/registro-anestesico/nuevo/page.tsx` |
| UI — detalle | `apps/web/src/app/(clinical)/ece/registro-anestesico/[id]/page.tsx` |
| tRPC router | `packages/trpc/src/routers/ece/registro-anestesico.router.ts` |
| SQL DDL (BD) | `ece.registro_anestesico` (consultado via MCP Supabase) |

### 6.3 Matriz de trazabilidad — Registro anestésico

| # | Campo UI | Payload tRPC | Prop Zod | Columna SQL router | Columna DB Real | Tipo Zod | Tipo DB | NOT NULL DB | Alineado | Observación |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Acto QX ID | `actoQuirurgicoId` | `z.string().uuid()` | `acto_quirurgico_id` | `acto_quirurgico_id` | uuid | uuid | YES | OK | Alineado |
| 2 | ASA | `asa` | `z.number().int().min(1).max(5)` | `asa::smallint` | `asa` | int 1-5 | smallint | YES | OK | Alineado |
| 3 | Tipo anestesia | `tipoAnestesia` | enum Zod (ver contracts) | `tipo_anestesia` | `tipo_anestesia` | text | text | YES | OK | Sin CHECK constraint en DB |
| 4 | Vía aérea | `viaAerea` | enum Zod (ver contracts) | `via_aerea` | `via_aerea` | text | text | YES | OK | Sin CHECK constraint en DB |
| 5 | Medicamentos | `medicamentosAdministrados` | schema en contracts | `medicamentos_administrados` | `medicamentos_administrados` | array | jsonb | YES (default `[]`) | OK | Alineado |
| 6 | Signos vitales | `signosVitalesIntraop` | schema en contracts | `signos_vitales_intraop` | `signos_vitales_intraop` | array | jsonb | YES (default `[]`) | OK | Append via `registrarSignoVital` |
| 7 | Complicaciones | `complicaciones` | `z.string().optional()` | `complicaciones` | `complicaciones` | text opt | text | NO | OK | Alineado |
| 8 | Fluidoterapia (ml) | `fluidoterapiaMl` | `z.number().int()` | `fluidoterapia_ml` | `fluidoterapia_ml` | int | integer | NO | OK | Alineado |
| 9 | Pérdidas sanguíneas (ml) | `perdidasSanguineasMl` | `z.number().int()` | `perdidas_sanguineas_ml` | `perdidas_sanguineas_ml` | int | integer | NO | OK | Alineado |
| 10 | Registrado por | — (personalId) | — | `registrado_por` | `registrado_por` | uuid | uuid | YES | OK | Derivado de `findPersonalId(ctx.user.id)` |
| 11 | Estado registro | — (borrador) | — | `estado_registro` | `estado_registro` | text | text | YES (default 'borrador') | OK | Alineado |
| 12 | `instancia_id` | — | — | — | `instancia_id` | — | uuid | NO (nullable) | RIESGO | **C3-P1**: nullable → sin workflow ECE |
| 13 | Firmado por | — (server-side) | — | `firmado_por` | `firmado_por` | uuid | uuid | NO | OK | Asignado en `firmar` |
| 14 | Firmado en | — (server-side) | — | `firmado_en` | `firmado_en` | — | timestamptz | NO | OK | Asignado en `firmar` |

### 6.4 Hallazgos

#### HE-24 — C3 — P1-ALTO — `list` y `get` sin filtro de establecimiento — cross-tenant data exposure

**Descripción:** El procedure `list` (`registro-anestesico.router.ts:136-157`) ejecuta SELECT sobre `ece.registro_anestesico` **directamente sobre `ctx.prisma`** (sin `withWorkflowContext`) con solo los filtros opcionales `actoQuirurgicoId` y `estado`. No hay filtro por `establecimiento_id`. La política RLS `reg_anest_by_acto_estab` verifica el establecimiento, pero al operar con rol BYPASSRLS, esta política se omite. Un usuario de cualquier establecimiento puede listar registros anestésicos de todos los hospitales de la red con solo omitir el filtro `actoQuirurgicoId`.  
**Archivo afectado:** `packages/trpc/src/routers/ece/registro-anestesico.router.ts:136-157`  
**Recomendación:** Envolver en `withEceContext` y añadir JOIN con `ece.episodio_atencion` para filtrar por `establecimiento_id = ctx.tenant.establishmentId`.  
**Riesgo go-live:** Alto. Exposición de datos anestésicos cross-tenant.

#### HE-25 — C6 — P1-ALTO — `firmar` no requiere PIN — firma sin verificación de identidad

**Descripción:** El procedure `firmar` (`registro-anestesico.router.ts:289-341`) recibe solo `{ id: z.string().uuid() }` — sin `pin`. La firma del registro anestésico se completa actualizando `estado_registro = 'firmado'`, `firmado_por = personalId`, `firmado_en = now()`, y emitiendo el evento, sin verificar ninguna credencial del anestesiólogo. Cualquier usuario con rol `ESP` puede firmar el registro anestésico de cualquier acto quirúrgico sin autenticación adicional. Esto viola el requisito de firma electrónica con autenticación fuerte del NTEC Art. 36.  
**Comparación:** `eceActoQx.firmar` requiere PIN argon2id. `eceCirugiaPreop.firmar` requiere PIN argon2id. Solo el registro anestésico omite la verificación.  
**Archivo afectado:** `packages/trpc/src/routers/ece/registro-anestesico.router.ts:289-341`  
**Recomendación:** Añadir `pin: z.string().regex(/^\d{6,8}$/)` al input de `firmar` y ejecutar `verifyPinOrThrow` equivalente al de los demás routers del stream antes de actualizar el estado.  
**Riesgo go-live:** Alto. Violación del Art. 36 NTEC — firma sin autenticación fuerte.

#### HE-26 — C3 — P1-ALTO — `instancia_id` nullable: registro anestésico excluido del motor de workflow ECE

**Descripción:** La columna `ece.registro_anestesico.instancia_id` es nullable (confirmado: `is_nullable='YES'`). El CREATE no crea instancia de workflow (`documento_instancia`) ni registra en `documento_instancia_historial`. El registro anestésico gestiona su estado mediante `estado_registro text DEFAULT 'borrador'` directamente en la tabla, fuera del motor de workflow ECE. Esto significa que: (1) las transiciones de estado no están controladas por `flujo_transicion`, (2) no hay historial de cambios de estado, (3) el trigger de inmutabilidad no existe para esta tabla (verificado: no hay `trg_inmutable_registro_anestesico`).  
**Archivos afectados:** Tabla `ece.registro_anestesico` (BD), `packages/trpc/src/routers/ece/registro-anestesico.router.ts`  
**Recomendación:** Crear instancia de workflow en el CREATE del registro anestésico (tipo `REG_ANEST`), equivalente al patrón de `acto_quirurgico.router.ts:441-489`. Esto requiere que `REG_ANEST` esté configurado en `ece.tipo_documento`.  
**Riesgo go-live:** Alto. Sin workflow, el registro anestésico no participa en el motor de estados ECE y carece de historial de transiciones.

#### HE-27 — C5 — P2-MEDIO — `tipo_anestesia` y `via_aerea`: enum en contracts sin CHECK constraint en DB

**Descripción:** Los campos `tipo_anestesia` y `via_aerea` en `ece.registro_anestesico` son `text` sin CHECK constraint. Los enums Zod en `@his/contracts` restringen los valores, pero si el dato se inserta por otro canal (SQL directo, migración, integración), valores inválidos pasan sin error.  
**Recomendación:** Añadir CHECK constraints: `CHECK (tipo_anestesia IN ('general','regional','local','sedacion'))` y `CHECK (via_aerea IN ('intubacion','mascarilla','lma'))`.  
**Riesgo go-live:** Medio. Integridad referencial de enums no enforced en BD.

#### HE-28 — C11 — P2-MEDIO — Sin tests para `registro-anestesico.router.ts`

**Descripción:** No existe archivo de tests para el router de registro anestésico en `packages/trpc/src/routers/ece/__tests__/`. El módulo con mayor número de hallazgos de seguridad del stream E carece de cobertura de tests.  
**Recomendación:** Añadir tests que cubran especialmente: (1) `list` sin filtro devuelve solo registros del establecimiento, (2) `firmar` sin PIN en un contexto POST-HE-25, (3) `registrarSignoVital` en estado firmado devuelve CONFLICT, (4) doble-create para mismo `actoQuirurgicoId` devuelve CONFLICT.  
**Riesgo go-live:** Medio.

---

## Resumen Consolidado Stream E {#resumen-consolidado}

### Tabla global de hallazgos

| ID | Módulo | Cat | Severidad | Título breve |
|----|--------|-----|-----------|--------------|
| HE-01 | Programación | C7 | P0-BLOQUEANTE | Tablas `reserva_sala_qx` y `sala_qx` inexistentes en producción |
| HE-06 | Acto QX | C4 | P0-BLOQUEANTE | Trigger `trg_inmutable_acto_quirurgico` bloquea UPDATE en borradores |
| HE-11 | Pre-operatorio | C7 | P0-BLOQUEANTE | Bridge-cirugia INSERT en preop_checklist con columnas inexistentes |
| HE-20 | Consent. QX | C7 | P0-BLOQUEANTE | `ece.consentimiento_quirurgico` no existe en producción |
| HE-21 | Consent. QX | C6 | P0-BLOQUEANTE | Firma paciente (canvas) nunca llega al servidor — CONS_QX siempre en borrador |
| HE-02 | Programación | C3 | P1-ALTO | `programarCirugia` sin `withWorkflowContext` — RLS degradado |
| HE-03 | Programación | C10 | P1-ALTO | Race condition en verificación de disponibilidad de sala |
| HE-07 | Acto QX | C7 | P1-ALTO | 5 campos clínicos NTEC Art. 34 en Zod/UI sin columna en DB — datos perdidos |
| HE-08 | Acto QX | C6 | P1-ALTO | Estado parcial create-sin-firma no manejado en wizard |
| HE-12 | Pre-operatorio | C3 | P1-ALTO | RLS INSERT en `preop_checklist` sin `WITH CHECK` |
| HE-13 | Pre-operatorio | C7 | P1-ALTO | `episodio_hospitalario_id` usado como `episodio_id` en `documento_instancia` |
| HE-15 | WHO | C3 | P1-ALTO | WHO router sin `withWorkflowContext` — RLS bypassed completamente |
| HE-16 | WHO | C9 | P1-ALTO | `emitOutbox` local reemplaza `emitDomainEvent` — contrato outbox roto |
| HE-17 | WHO | C6 | P1-ALTO | `responsableId` hardcodeado UUID-cero — trazabilidad WHO perdida |
| HE-22 | Consent. QX | C7 | P1-ALTO | Doble fuente de estado (columna `estado` vs workflow `flujo_estado`) |
| HE-24 | Reg. Anestésico | C3 | P1-ALTO | `list`/`get` sin filtro de establecimiento — cross-tenant exposure |
| HE-25 | Reg. Anestésico | C6 | P1-ALTO | `firmar` sin PIN — firma sin autenticación fuerte (viola NTEC Art. 36) |
| HE-26 | Reg. Anestésico | C3 | P1-ALTO | `instancia_id` nullable — registro anestésico fuera del motor workflow ECE |
| HE-04 | Programación | C1 | P2-MEDIO | UUID de personal/sala como texto libre en UI sin lookup |
| HE-05 | Programación | C11 | P2-MEDIO | Sin tests para bridge-cirugia.router.ts |
| HE-09 | Acto QX | C2 | P2-MEDIO | `registroAnestesico`/`recuperacionUrpa` con `z.any()` sin validación |
| HE-10 | Acto QX | C8 | P2-MEDIO | Sin audit triggers en `ece.acto_quirurgico` |
| HE-14 | Pre-operatorio | C11 | P2-MEDIO | Tests preop solo validan schemas Zod, no el router |
| HE-18 | WHO | C3 | P2-MEDIO | RLS INSERT `who_checklist` sin `WITH CHECK` |
| HE-23 | Consent. QX | C8 | P2-MEDIO | Sin audit triggers en `ece.consentimiento_informado` |
| HE-27 | Reg. Anestésico | C5 | P2-MEDIO | `tipo_anestesia`/`via_aerea` sin CHECK constraint en DB |
| HE-28 | Reg. Anestésico | C11 | P2-MEDIO | Sin tests para registro-anestesico.router.ts |
| HE-19 | WHO | C11 | P3-BAJO | Tests WHO solo validan lógica de transición local |

### Conteo de hallazgos por severidad

| Severidad | Cantidad |
|-----------|----------|
| P0-BLOQUEANTE | 5 |
| P1-ALTO | 13 |
| P2-MEDIO | 9 |
| P3-BAJO | 1 |
| **TOTAL** | **28** |

### Criticidad go-live

Los 5 hallazgos P0 hacen que **4 de los 6 módulos del Stream E sean completamente inoperativos en producción**:

| Módulo | Estado go-live | P0 bloqueante |
|--------|---------------|---------------|
| Programación de cirugías | INOPERABLE | HE-01 (tablas inexistentes) + HE-11 (preop_checklist columnas) |
| Acto quirúrgico | DEGRADADO — borrador ineditable | HE-06 (trigger incondicional) |
| Pre-operatorio | PARCIAL — solo lectura | HE-11 (creación desde bridge) |
| WHO Checklist | FUNCIONAL con riesgos | HE-15 (RLS bypass), HE-16 (outbox roto), HE-17 (UUID-cero) |
| Consentimiento QX | INOPERABLE | HE-20 (tabla ausente) + HE-21 (firma nunca enviada) |
| Registro anestésico | FUNCIONAL sin PIN firma | HE-25 (firma sin autenticación) |

### Prioridades de remediación inmediata (pre-go-live)

1. **HE-01 + HE-11**: Crear DDL para `ece.reserva_sala_qx`, `ece.sala_qx` y corregir INSERT de bridge a `preop_checklist` con columnas correctas.
2. **HE-06**: Modificar `fn_bloquea_mutacion` para verificar estado antes de bloquear (patrón ya implementado en `fn_bloquea_mutacion_consentimiento`).
3. **HE-20**: Crear DDL para `ece.consentimiento_quirurgico`.
4. **HE-21**: Completar el `onSubmit` del wizard CONS_QX para llamar a `firmarPaciente` y `firmar` tras la creación.
5. **HE-07**: Agregar columnas `tecnica`, `complicaciones`, `sangrado_estimado_ml`, `muestras_enviadas`, `tiempo_quirurgico_min` a `ece.acto_quirurgico` y actualizar INSERT/UPDATE.
6. **HE-25**: Añadir verificación de PIN argon2id al procedure `firmar` del registro anestésico.
7. **HE-15 + HE-02 + HE-24**: Envolver operaciones de escritura en `withWorkflowContext` en WHO router, bridge-cirugia y registro anestésico.

---

*Auditoría realizada con metodología de lectura estática + consulta directa a Supabase (read-only). Ningún código fue modificado durante este proceso. Stream E — Quirófano + Anestesia representa el dominio clínico de mayor complejidad regulatoria (NTEC Arts. 32-36, 39-40) y el de mayor concentración de hallazgos P0 de los 5 streams auditados.*
