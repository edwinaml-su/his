# Auditoría Stream D — Hospitalización (9 módulos NTEC)

**Fecha:** 2026-05-19  
**Auditor:** @AS — Arquitecto de Software, Unidad de Transformación Digital, Inversiones Avante  
**Rama auditada:** `feat/fase2-s1-gate` (commit `6532a92`)  
**Método:** Lectura estática UI + routers tRPC + contratos Zod + consultas directas a Supabase (`information_schema.columns`, `pg_policies`, triggers). Solo lectura — sin modificaciones.  
**Scope:** 9 módulos de hospitalización — Hoja de ingreso, Episodio hospitalario (+alta), Notas de evolución, Kardex, Signos vitales, Valoración inicial enfermería, Registro de enfermería (MAR), RRI, URPA.

---

## Índice

1. [Módulo 1 — Hoja de Ingreso](#módulo-1)
2. [Módulo 2 — Episodio Hospitalario + Alta](#módulo-2)
3. [Módulo 3 — Notas de Evolución Médica](#módulo-3)
4. [Módulo 4 — Kardex](#módulo-4)
5. [Módulo 5 — Signos Vitales](#módulo-5)
6. [Módulo 6 — Valoración Inicial Enfermería](#módulo-6)
7. [Módulo 7 — Registro de Enfermería (MAR)](#módulo-7)
8. [Módulo 8 — RRI — Referencia/Retorno/Interconsulta](#módulo-8)
9. [Módulo 9 — URPA — Recuperación Post-Anestésica](#módulo-9)
10. [Resumen Consolidado Stream D](#resumen-consolidado)

---

## Metodología

| Cat | Nombre |
|-----|--------|
| C1  | Trazabilidad UI → ORM → DB (matriz por campo) |
| C2  | Contratos tRPC (input/output Zod schemas) |
| C3  | Seguridad: RLS + tenant isolation + withTenantContext |
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

## Módulo 1 — Hoja de Ingreso {#módulo-1}

### 1.1 Resumen ejecutivo

La Hoja de Ingreso (HOJA_ING) es el documento administrativo-clínico que formaliza el ingreso al establecimiento hospitalario. El módulo implementa un wizard de 3 pasos en UI (`nueva/page.tsx`): selección de orden, datos de admisión y confirmación con PIN electrónico. El router (`hoja-ingreso.router.ts`) implementa el workflow ECE completo con firma argon2id y eventos de dominio.

**El hallazgo crítico es un schema drift masivo entre el router y la BD real.** El router asume una estructura de tabla con hasta 11 columnas nombradas explícitamente (`paciente_id`, `episodio_hospitalario_id`, `servicio_ingreso_id`, `cama_asignada_id`, `modalidad`, `procedencia`, `diagnostico_ingreso`, `motivo_consulta`, `notas_adicionales`, `admisionista_id`), pero la tabla `ece.hoja_ingreso` en Supabase tiene únicamente 11 columnas con nombres completamente distintos: `episodio_id`, `orden_ingreso_id`, `servicio_id`, `cama_id`, `datos_administrativos` (JSONB), `responsable_admision`, `estado_registro`. Toda operación de escritura del router fallará con error `42703: column not found` en producción.

### 1.2 Archivos auditados

| Capa | Archivo |
|------|---------|
| UI — wizard nueva | `apps/web/src/app/(clinical)/ece/hoja-ingreso/nueva/page.tsx` |
| UI — lista | `apps/web/src/app/(clinical)/ece/hoja-ingreso/page.tsx` |
| tRPC router | `packages/trpc/src/routers/ece/hoja-ingreso.router.ts` |
| Schemas Zod | `packages/trpc/src/routers/ece/hoja-ingreso.schemas.ts` |
| bridge admisión | `packages/trpc/src/routers/ece/bridge-admision.router.ts` |
| SQL DDL (BD) | `ece.hoja_ingreso` (consultado via MCP Supabase) |
| Tests | `packages/trpc/src/routers/ece/__tests__/hoja-ingreso.router.test.ts` |

### 1.3 Matriz de trazabilidad — Hoja de Ingreso

| # | Campo UI | Payload tRPC | Prop Zod | Columna Router SQL | Columna DB Real | Tipo Zod | Tipo DB | NOT NULL DB | Alineado | Observación |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | PIN firma | `pin` | `z.string().trim().regex(/^\d{6,8}$/)` | — | — | string 6-8 dig | — | — | — | PIN validado client-side + argon2id server |
| 2 | Fecha/hora ingreso | `fechaHoraIngreso` | `z.coerce.date()` | `fecha_hora_ingreso` | `fecha_hora_ingreso` | Date | timestamptz | YES | OK | Alineado |
| 3 | Cama ID | `camaAsignadaId` | `z.string().uuid().optional()` | `cama_asignada_id` | `cama_id` | uuid opt | uuid | NO | NO | **C7**: columna en router = `cama_asignada_id`, DB = `cama_id` |
| 4 | Servicio ingreso | `servicioIngresoId` | `z.string().uuid()` | `servicio_ingreso_id` | `servicio_id` | uuid | uuid | NO | NO | **C7**: `servicio_ingreso_id` vs `servicio_id` |
| 5 | Modalidad | `modalidad` | `z.enum(["urgente","programado"])` | `modalidad` | **AUSENTE** | string | — | — | NO | **C7-P0**: columna no existe en DB; redirigida a `datos_administrativos` JSONB sin validación |
| 6 | Procedencia | `procedencia` | `z.string().min(1).max(500)` | `procedencia` | **AUSENTE** | string | — | — | NO | **C7-P0**: columna no existe en DB |
| 7 | Diagnóstico ingreso | `diagnosticoIngreso` | `z.string().min(1).max(2000).optional()` | `diagnostico_ingreso` | **AUSENTE** | string opt | — | — | NO | **C7-P0**: columna no existe en DB |
| 8 | Motivo consulta | `motivoConsulta` | `z.string().min(1).max(2000).optional()` | `motivo_consulta` | **AUSENTE** | string opt | — | — | NO | **C7-P0**: columna no existe en DB |
| 9 | Notas adicionales | `notasAdicionales` | `z.string().max(2000).optional()` | `notas_adicionales` | **AUSENTE** | string opt | — | — | NO | **C7-P0**: columna no existe en DB |
| 10 | Paciente ID | — (derivado de orden) | — | `paciente_id` | **AUSENTE** | uuid | — | — | NO | **C7-P0**: columna no existe en DB |
| 11 | Admisionista | `personal.id` | — | `admisionista_id` | `responsable_admision` | uuid | uuid | YES | NO | **C7**: nombre de columna distinto |
| 12 | Orden ingreso | `ordenIngresoId` | `z.string().uuid()` | `orden_ingreso_id` | `orden_ingreso_id` | uuid | uuid | YES | OK | Alineado |
| 13 | Estado | — | — | `estado_codigo` (join) | `estado_registro` (text) | — | text | YES | PARCIAL | Estado en columna propia vs join instancia |

### 1.4 Hallazgos

#### HD-01 — C7 — P0-BLOQUEANTE — Schema drift masivo en `ece.hoja_ingreso`: 6 columnas del router no existen en DB

**Descripción:** El router `hoja-ingreso.router.ts` genera INSERT/UPDATE/SELECT con columnas que no existen en la tabla `ece.hoja_ingreso` real:
- Router usa `paciente_id` → no existe en DB (sin columna dedicada de paciente)
- Router usa `episodio_hospitalario_id` → BD tiene `episodio_id`
- Router usa `servicio_ingreso_id` → BD tiene `servicio_id`
- Router usa `cama_asignada_id` → BD tiene `cama_id`
- Router usa `modalidad`, `procedencia`, `diagnostico_ingreso`, `motivo_consulta`, `notas_adicionales`, `admisionista_id` → **no existen en DB** (aparentemente serializados en `datos_administrativos JSONB` sin que el router lo sepa)
- Router usa `admisionista_id` → BD tiene `responsable_admision`

Todo `create`, `update`, `firmar`, `anular` fallará con `ERROR 42703: column "paciente_id" of relation "hoja_ingreso" does not exist`.

**Impacto:** Módulo completamente no funcional. El wizard de admisión falla en el paso 3 (Paso de mutación) sin excepción manejada en UI.  
**Ruta afectada:** `packages/trpc/src/routers/ece/hoja-ingreso.router.ts:533-558` (INSERT), `:585-598` (UPDATE)  
**Remediación:** Sincronizar el router con la estructura DB real. O bien: (a) agregar las columnas faltantes a `ece.hoja_ingreso` via migración, o (b) reescribir el router para serializar `modalidad`, `procedencia`, etc. dentro de `datos_administrativos JSONB`. El bridge `bridge-admision.router.ts` que usa `admitirDesdeOrden` debe igualmente corregirse.  
**Riesgo Go-Live:** BLOQUEANTE. Admisión hospitalaria completamente rota.

---

#### HD-02 — C7 — P0-BLOQUEANTE — `hoja_ingreso` carece de `paciente_id` — RLS `by_episodio_estab` opera pero sin columna de paciente

**Descripción:** La política RLS `by_episodio_estab` en `ece.hoja_ingreso` funciona correctamente (join via `episodio_id → episodio_atencion.establecimiento_id`). Sin embargo, el router intenta insertar `paciente_id` como columna explícita, lo que generará el error 42703 antes de que RLS opere. Adicionalmente, varios SELECTs en `findHojaIngreso` leen columnas inexistentes (`paciente_id`, `servicio_ingreso_id`, etc.).

**Impacto:** Las operaciones de lectura también fallan. El módulo completo es inoperable.  
**Ruta afectada:** `packages/trpc/src/routers/ece/hoja-ingreso.router.ts:138-166` (findHojaIngreso)  
**Remediación:** Corregir alias de columnas en todas las queries SQL del router para que coincidan con la BD.  
**Riesgo Go-Live:** BLOQUEANTE.

---

#### HD-03 — C7 — P1-ALTO — UI Paso 2 envía `modalidad` y `procedencia` como texto libre sin catálogo

**Descripción:** El `<Input>` de modalidad en `nueva/page.tsx:283-295` acepta texto libre con placeholder "internamiento, hospital_dia…", pero el schema Zod define `modalidadIngresoSchema = z.enum(["urgente", "programado"])`. El usuario puede ingresar "internamiento" (texto no válido para el enum) y el error solo aparecerá en el servidor como `ZodError` sin indicación visual previa.

**Impacto:** UX confusa; formulario no comunica los valores aceptados.  
**Ruta afectada:** `apps/web/src/app/(clinical)/ece/hoja-ingreso/nueva/page.tsx:278-295`  
**Remediación:** Reemplazar `<Input>` de modalidad por `<Select>` con las opciones del enum `MODALIDAD_INGRESO`.  
**Riesgo Go-Live:** P1. Si el drift de schema (HD-01) se corrige, este bug causará errores en producción.

---

#### HD-04 — C6 — P2-MEDIO — PIN mínimo 4 dígitos en UI vs regex 6-8 dígitos en Zod

**Descripción:** El botón "Admitir paciente" en `nueva/page.tsx:446` se habilita con `pin.length >= 4`, pero el schema `eceHojaIngresoFirmarSchema` exige regex `/^\d{6,8}$/` (6 a 8 dígitos). Un PIN de 4 o 5 dígitos pasará la validación de UI pero fallará en el servidor.

**Impacto:** Error en servidor al intentar firmar con PIN de 4-5 dígitos sin feedback visual previo.  
**Ruta afectada:** `apps/web/src/app/(clinical)/ece/hoja-ingreso/nueva/page.tsx:446`  
**Remediación:** Cambiar condición de habilitación a `pin.length >= 6`.  
**Riesgo Go-Live:** P2.

---

#### HD-05 — C8 — P2-MEDIO — Hash de payload en `firmar` usa campos que no existen en DB real

**Descripción:** `computePayloadHash` en `hoja-ingreso.router.ts:359-371` hashea campos como `servicio_ingreso_id`, `modalidad` que no existen en la fila DB real. El hash resultante no refleja el documento persistido. Esto rompe la cadena de auditoría criptográfica de NTEC §6.3.

**Impacto:** Hash incoherente con el documento real; la verificación de integridad fallará.  
**Ruta afectada:** `packages/trpc/src/routers/ece/hoja-ingreso.router.ts:359-371`  
**Remediación:** Calcular el hash sobre las columnas reales de la BD tras corregir el schema drift.  
**Riesgo Go-Live:** P2 (solo si HD-01 se resuelve).

---

#### HD-06 — C11 — P2-MEDIO — Tests `hoja-ingreso.router.test.ts` validan schema incorrecto

**Descripción:** Los tests unitarios mockean `$queryRaw` y `$executeRaw` con la estructura de columnas del router (la incorrecta), no con la estructura real de la BD. Pasan localmente pero no detectan el drift. El test de `create` happy-path verifica que se llama INSERT con `paciente_id`, `modalidad` etc. — columnas que no existen.

**Impacto:** Coverage artificial; false positive que oculta P0.  
**Ruta afectada:** `packages/trpc/src/routers/ece/__tests__/hoja-ingreso.router.test.ts`  
**Remediación:** Tras corregir el router, actualizar fixtures de test con columnas reales. Agregar test de integración contra BD real (o snapshot de schema).  
**Riesgo Go-Live:** P2.

---

## Módulo 2 — Episodio Hospitalario + Alta {#módulo-2}

### 2.1 Resumen ejecutivo

El router `episodio-hospitalario.router.ts` gestiona el ciclo de vida de hospitalización activa: listado de activos, detalle, inicio de alta (`iniciarAltaMedica`) y confirmación (`confirmarAlta`). La capa de datos opera vía `$queryRaw` sobre `ece.episodio_hospitalario` y `ece.episodio_atencion`. La BD confirma que `ece.episodio_hospitalario` tiene columnas distintas a las esperadas por el router: `episodio_id` (FK a `ece.episodio_atencion`) en lugar de `episodio_atencion_id`, y las columnas `circunstancia_ingreso`, `procedencia_ingreso`, `modalidad_hospitalaria` existen pero el router consulta `motivo_consulta` (que está en `episodio_atencion`, no en `episodio_hospitalario`). El módulo también gestiona la epicrisis de egreso integrada en el flujo de alta.

### 2.2 Archivos auditados

| Capa | Archivo |
|------|---------|
| UI — lista activos | `apps/web/src/app/(clinical)/ece/episodio-hospitalario/page.tsx` |
| UI — detalle | `apps/web/src/app/(clinical)/ece/episodio-hospitalario/[id]/page.tsx` |
| UI — alta | `apps/web/src/app/(clinical)/ece/episodio-hospitalario/[id]/alta/page.tsx` |
| tRPC router | `packages/trpc/src/routers/ece/episodio-hospitalario.router.ts` |
| SQL DDL | `ece.episodio_hospitalario` (MCP Supabase) |
| Tests | `packages/trpc/src/routers/ece/__tests__/episodio-hospitalario.router.test.ts` |

### 2.3 Matriz de trazabilidad — Episodio Hospitalario

| # | Campo UI | Payload tRPC | Prop Zod | Columna Router SQL | Columna DB Real | Alineado | Observación |
|---|---|---|---|---|---|---|---|
| 1 | Estado episodio | — | `z.string()` | `ea.estado` | `ea.estado` (text) | OK | En `episodio_atencion` |
| 2 | Gravedad | `gravedad` | `z.enum(["leve","moderado","grave","critico"])` | `eh.gravedad` | **AUSENTE** en DB (columna no retornada por `information_schema`) | NO | **C7**: columna no confirmada en DB |
| 3 | Médico tratante | `medicoTratanteId` | `z.string().uuid()` | `eh.medico_tratante_id` | **AUSENTE** en DB schema devuelto | NO | **C7**: columna no confirmada |
| 4 | Sala | `salaId` | `z.string().uuid()` | `eh.sala_id` | **AUSENTE** en DB (DB tiene `servicio_id`, no `sala_id`) | NO | **C7**: nombre distinto |
| 5 | Fecha ingreso | — | `z.coerce.date()` | `eh.fecha_ingreso` | `fecha_hora_orden_ingreso` | NO | **C7**: nombre de columna distinto |
| 6 | Fecha egreso | — | `z.coerce.date()` | `eh.fecha_egreso` → `SET fecha_egreso = NOW()` | `fecha_hora_egreso` | NO | **C7**: nombre distinto |
| 7 | Motivo alta | `motivoAlta` | `z.enum(["mejoria","traslado","alta_voluntaria","defuncion"])` | — | — | N/A | Solo para epicrisis, no persiste en episodio |
| 8 | Tipo egreso | derivado de `motivoAlta` | — | `tipo_egreso` (epicrisis) | `tipo_egreso` (en `episodio_hospitalario`) | OK | Alineado |
| 9 | Cama código | — | — | `c.codigo` (join) | Join `ece.asignacion_cama → ece.cama` | OK | Patrón correcto |
| 10 | `FOR UPDATE` lock | — | — | `FOR UPDATE` en `iniciarAltaMedica` | — | OK | Patrón correcto para concurrencia |

### 2.4 Hallazgos

#### HD-07 — C7 — P0-BLOQUEANTE — `episodio_hospitalario` router usa columnas `sala_id`, `gravedad`, `medico_tratante_id`, `fecha_ingreso` que no existen en BD

**Descripción:** La BD confirmada vía MCP Supabase muestra que `ece.episodio_hospitalario` contiene las columnas: `episodio_id`, `circunstancia_ingreso`, `procedencia_ingreso`, `modalidad_hospitalaria`, `servicio_id`, `cama_id`, `fecha_hora_orden_ingreso`, `fecha_hora_egreso`, `tipo_egreso`, `circunstancia_alta`. El router `episodio-hospitalario.router.ts` hace JOIN y SELECT de columnas que no existen:
- `eh.sala_id` → DB usa `eh.servicio_id`
- `eh.gravedad` → no existe en schema DB
- `eh.medico_tratante_id` → no existe en schema DB
- `eh.fecha_ingreso` → DB usa `fecha_hora_orden_ingreso`
- `eh.episodio_atencion_id` → DB usa `eh.episodio_id`
- En `confirmarAlta`: `UPDATE ece.episodio_hospitalario SET fecha_egreso = NOW()` → columna es `fecha_hora_egreso`

Todas las queries del router fallarán con error `42703`.

**Impacto:** Listado de pacientes hospitalizados, detalle, inicio de alta y confirmación de alta completamente no funcionales.  
**Ruta afectada:** `packages/trpc/src/routers/ece/episodio-hospitalario.router.ts:150-184` (listActivos), `:200-234` (getDetalle), `:295-344` (iniciarAltaMedica), `:382-464` (confirmarAlta)  
**Remediación:** Sincronizar alias de columnas del router con la BD real. Especialmente: `sala_id` → `servicio_id`, `fecha_ingreso` → `fecha_hora_orden_ingreso`, `fecha_egreso` → `fecha_hora_egreso`, `episodio_atencion_id` → `episodio_id`.  
**Riesgo Go-Live:** BLOQUEANTE.

---

#### HD-08 — C7 — P1-ALTO — Columna `gravedad` referenciada en router no existe en `ece.episodio_hospitalario` DB

**Descripción:** El schema Zod `gravedadEnum = z.enum(["leve","moderado","grave","critico"])` existe en el router y la UI renderiza filtro de gravedad, pero la columna `gravedad` no fue confirmada en la BD por `information_schema.columns`. Si la columna no existe, el filtro de gravedad en `listActivos` genera error en tiempo de ejecución.

**Impacto:** Filtro de gravedad en la lista de hospitalizados fallará silenciosamente o con error 500.  
**Ruta afectada:** `packages/trpc/src/routers/ece/episodio-hospitalario.router.ts:174-179`  
**Remediación:** Verificar si `gravedad` existe en una migración no aplicada; si no, crear la migración o eliminar el filtro de la UI.  
**Riesgo Go-Live:** P1 (dependiente de HD-07).

---

#### HD-09 — C4 — P2-MEDIO — `confirmarAlta` no verifica que la epicrisis está firmada **por el mismo médico** que inició el alta

**Descripción:** `confirmarAlta` valida que `estado_epicrisis NOT IN ('borrador','anulado')` — una epicrisis puede estar firmada por cualquier PHYSICIAN. NTEC Art. 40 requiere que el médico que firma el alta sea quien completó la epicrisis. No hay verificación de `epicrisis.medico_tratante_id == ctx.user.id`.

**Impacto:** Un médico puede confirmar el alta con la epicrisis firmada por otro médico, potencialmente violando el flujo clínico.  
**Ruta afectada:** `packages/trpc/src/routers/ece/episodio-hospitalario.router.ts:424-429`  
**Remediación:** Agregar validación `epi.medico_tratante_id = ${ece.personalId}::uuid` a la query de confirmación de alta, o documentar explícitamente la decisión de negocio que permita cualquier PHYSICIAN.  
**Riesgo Go-Live:** P2.

---

#### HD-10 — C9 — P2-MEDIO — Evento `altaIniciada` emitido en transacción separada puede quedar huérfano

**Descripción:** En `iniciarAltaMedica`, el bloque transaccional con `withWorkflowContext` ejecuta los cambios de BD en la primera transacción; el `emitDomainEvent` se hace en `ctx.prisma.$transaction(...)` separada (líneas 350-366). Si el proceso crashea entre ambas transacciones, el evento `ece.episodio.altaIniciada` se pierde pero el episodio ya avanzó a estado `alta_iniciada`. Mismo patrón en `confirmarAlta`.

**Impacto:** Inconsistencia entre estado del episodio y eventos outbox en caso de fallo parcial.  
**Ruta afectada:** `packages/trpc/src/routers/ece/episodio-hospitalario.router.ts:349-366`, `:473-487`  
**Remediación:** Unir ambos bloques en una sola transacción, usando el mismo `tx` para `withWorkflowContext` y `emitDomainEvent`. Mismo patrón recomendado en Streams A-C.  
**Riesgo Go-Live:** P2.

---

## Módulo 3 — Notas de Evolución Médica {#módulo-3}

### 3.1 Resumen ejecutivo

Las notas de evolución SOAP están implementadas en el router `evolucion-medica.router.ts` (bajo namespace `eceEvolucion`) y la UI `evolucion/nueva/page.tsx`. El router opera sobre `ece.evolucion_medica` confirmada en BD con columnas `subjetivo`, `objetivo`, `analisis`, `plan`, `diagnostico_cie10` (JSONB), `estado_registro`. La UI implementa autosave a localStorage cada 30 segundos con Ctrl+S. La trazabilidad de columnas entre router y BD está bien alineada excepto en el campo `diagnostico_cie10`.

### 3.2 Archivos auditados

| Capa | Archivo |
|------|---------|
| UI — nueva | `apps/web/src/app/(clinical)/ece/evolucion/nueva/page.tsx` |
| UI — lista | `apps/web/src/app/(clinical)/ece/evolucion/page.tsx` |
| UI — detalle | `apps/web/src/app/(clinical)/ece/evolucion/[id]/page.tsx` |
| tRPC router | `packages/trpc/src/routers/evolucion-medica.router.ts` |
| Schemas Zod | `@his/contracts` — `eceEvolucionCreateSchema` |
| SQL DDL | `ece.evolucion_medica` (MCP Supabase) |

### 3.3 Matriz de trazabilidad — Evolución Médica

| # | Campo UI | Payload tRPC | Prop Zod | Columna Router | Columna DB | Tipo Zod | Tipo DB | NOT NULL | Alineado | Observación |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Subjetivo (S) | `soapSubjetivo` | `z.string()` | `subjetivo` | `subjetivo` | string | text | NO | OK | Alineado |
| 2 | Objetivo (O) | `soapObjetivo` | `z.string()` | `objetivo` | `objetivo` | string | text | NO | OK | Alineado |
| 3 | Evaluación (A) | `soapAnalisis` | `z.string()` | `analisis` | `analisis` | string | text | NO | OK | Alineado |
| 4 | Plan (P) | `soapPlan` | `z.string()` | `plan` | `plan` | string | text | NO | OK | Alineado |
| 5 | CIE-10 | — (ausente en UI) | — | `diagnostico_cie10` | `diagnostico_cie10` (jsonb) | — | jsonb | NO | PARCIAL | **C5**: columna existe en DB pero no expuesta en UI ni en `create` schema |
| 6 | Episodio | `episodioId` | `z.string().uuid()` | `episodio_id` | `episodio_id` | uuid | uuid | YES | OK | Alineado |
| 7 | Fecha | `fecha` | `z.coerce.date()` | `fecha_hora` | `fecha_hora` | Date | timestamptz | YES | OK | Alineado |
| 8 | Estado | derivado (join) | — | `estado_codigo` (join instancia) | `estado_registro` + join | — | text | YES | PARCIAL | Dos fuentes de estado (columna propia + instancia) |
| 9 | Retroactivo | — | — | `digitado_retroactivamente` | `digitado_retroactivamente` (bool) | — | boolean | YES | NO | **C1**: campo en DB no expuesto en schema create ni UI |
| 10 | Contingencia | — | — | `contingencia_evento_id` | `contingencia_evento_id` (uuid) | — | uuid | NO | NO | **C1**: campo en DB no mapeado en router |

### 3.4 Hallazgos

#### HD-11 — C5 — P1-ALTO — CIE-10 en evoluciones médicas: columna `diagnostico_cie10` existe en DB pero no está expuesta en UI ni en el contrato `create`

**Descripción:** La tabla `ece.evolucion_medica` tiene columna `diagnostico_cie10 JSONB`. El schema `eceEvolucionCreateSchema` no incluye este campo, y la UI de nueva evolución (`nueva/page.tsx`) no presenta selector CIE-10. NTEC Art. 17 exige diagnóstico CIE-10 en toda nota de evolución que incluya diagnóstico.

**Impacto:** Las notas de evolución quedan sin diagnóstico codificado. El requisito NTEC Art. 17 se incumple para evoluciones con impresión diagnóstica.  
**Ruta afectada:** `packages/trpc/src/routers/evolucion-medica.router.ts` (create procedure), `apps/web/src/app/(clinical)/ece/evolucion/nueva/page.tsx`  
**Remediación:** Agregar campo opcional `diagnosticosCIE10: z.array(icd10Schema).optional()` a `eceEvolucionCreateSchema`. Integrar el componente `icd10-picker` (existente en `/ece/icd10-picker/`) en el formulario de nueva evolución. Hacer obligatorio cuando el campo "Evaluación (A)" contiene texto de diagnóstico.  
**Riesgo Go-Live:** P1. Incumplimiento NTEC documentable en auditoría.

---

#### HD-12 — C1 — P2-MEDIO — Campo `digitado_retroactivamente` en DB no mapeado en UI ni router

**Descripción:** La columna `digitado_retroactivamente BOOLEAN DEFAULT false` en `ece.evolucion_medica` tiene una ruta dedicada `/ece/registro-retroactivo/` en la aplicación, pero el router `evolucion-medica.router.ts` no pasa este campo en el INSERT (siempre queda `false`). El flujo de registro retroactivo no alimenta la columna de trazabilidad.

**Impacto:** No hay distinción entre notas registradas en tiempo real y retroactivas. Requerimiento NTEC de trazabilidad de documentación retroactiva no cubierto.  
**Ruta afectada:** `packages/trpc/src/routers/evolucion-medica.router.ts` (INSERT en create)  
**Remediación:** Agregar `digitado_retroactivamente: z.boolean().default(false)` al schema create y al INSERT.  
**Riesgo Go-Live:** P2.

---

#### HD-13 — C12 — P3-BAJO — Autosave a localStorage no comunica pérdida en modo privado/sin storage

**Descripción:** El efecto de autosave en `nueva/page.tsx:125-141` captura errores de localStorage silenciosamente (`// localStorage no disponible — no bloqueante`). En navegación privada o con quotaExceeded, el borrador se pierde sin notificar al usuario.

**Impacto:** Pérdida silenciosa de trabajo en entornos restringidos (ej. tablets hospitalarias en modo kiosk).  
**Ruta afectada:** `apps/web/src/app/(clinical)/ece/evolucion/nueva/page.tsx:128-134`  
**Remediación:** Añadir aviso visible cuando `localStorage` no está disponible: `setAutosaveMsg("Advertencia: no se puede guardar borrador local — use 'Guardar borrador' para persistir.")`.  
**Riesgo Go-Live:** P3.

---

## Módulo 4 — Kardex {#módulo-4}

### 4.1 Resumen ejecutivo

El módulo Kardex (`/ece/kardex/[patientId]/page.tsx`) es una vista de solo lectura + cancelación de administraciones de medicamento, consumiendo `trpc.medicationAdmin.listByPatient` y `trpc.medicationAdmin.cancelAdmin`. Opera sobre el modelo Prisma `MedicationAdministration` del schema `public` (no sobre `ece.*`). Es el módulo legacy de ejecución de MAR por paciente, correctamente diferenciado del MAR ECE (`/ece/registro-enfermeria`). No hay problema de duplicación.

### 4.2 Archivos auditados

| Capa | Archivo |
|------|---------|
| UI — kardex paciente | `apps/web/src/app/(clinical)/ece/kardex/[patientId]/page.tsx` |
| UI — lista | `apps/web/src/app/(clinical)/ece/kardex/page.tsx` |
| tRPC router | `packages/trpc/src/routers/medicationAdmin.router.ts` (legacy) |
| SQL DDL | `public."MedicationAdministration"` (MCP Supabase) |

### 4.3 Matriz de trazabilidad — Kardex

| # | Campo UI | Router | Prop Zod | Columna DB | Tipo DB | Alineado | Observación |
|---|---|---|---|---|---|---|---|
| 1 | Fecha/hora | `administeredAt` | `z.date()` | `administeredAt` (timestamptz NOT NULL) | timestamptz | OK | Alineado |
| 2 | Estado | `status` | `z.enum(MedAdminStatus)` | `status` (USER-DEFINED enum) | enum | OK | Enum Postgres alineado |
| 3 | BCMA verificado | `gtinScanned` (presencia) | — | `gtinScanned` (nullable) | text/varchar | OK | `null` = manual; presente = BCMA |
| 4 | Lote | `loteScanned` | — | `loteScanned` | text | OK | Alineado |
| 5 | Motivo cancelación | `cancelReason` | `z.string().min(10)` | `cancelReason` | text | OK | Validación min 10 en UI y router |
| 6 | Fecha filtro `fromDate` | `fromDate` | `z.coerce.date().optional()` | — (filtro `WHERE administeredAt >= fromDate`) | — | OK | Filtro correcto |
| 7 | `scheduledTime` | — | — | `scheduledTime` (timestamptz NULL) | timestamptz | N/A | Solo escritura via `computeScheduledSlot`, no lectura en Kardex |

### 4.4 Hallazgos

#### HD-14 — C1 — P2-MEDIO — Kardex usa cast inseguro de tipo con `as Record<string, unknown>` para acceder a `gtinScanned`, `loteScanned`, `serieScanned`

**Descripción:** En `kardex/[patientId]/page.tsx:279-332` el componente accede a `(row as Record<string, unknown>).gtinScanned`, `loteScanned`, `serieScanned` mediante cast ancho. El tipo devuelto por `medicationAdmin.listByPatient` no incluye explícitamente estos campos en su output type, forzando el cast sin verificación de tipo en tiempo de compilación.

**Impacto:** Si el router cambia el nombre de los campos o los elimina, la UI compila sin error pero renderiza `undefined` silenciosamente.  
**Ruta afectada:** `apps/web/src/app/(clinical)/ece/kardex/[patientId]/page.tsx:279-332`  
**Remediación:** Agregar `gtinScanned: z.string().nullable().optional()`, `loteScanned: z.string().nullable().optional()` al output schema de `medicationAdmin.listByPatient`.  
**Riesgo Go-Live:** P2.

---

#### HD-15 — C10 — P2-MEDIO — `cancelAdmin` no verifica si el `adminId` pertenece al tenant activo antes del UPDATE

**Descripción:** La operación `trpc.medicationAdmin.cancelAdmin` en el dialog de cancelación pasa `adminId` directamente. Verificar si el router valida `organizationId` o `patientId` antes de ejecutar `UPDATE MedicationAdministration SET status = 'CANCELED'`. Según el contrato CLAUDE.md, las escrituras sin `withTenantContext` solo tienen defensa débil `where: { organizationId }`.

**Impacto potencial:** Si el router no filtra por tenant, un usuario podría cancelar administraciones de otro paciente de otra organización conociendo solo el UUID.  
**Ruta afectada:** `packages/trpc/src/routers/medicationAdmin.router.ts` (cancelAdmin procedure)  
**Remediación:** Verificar que `cancelAdmin` incluye `WHERE id = $id AND organizationId = $orgId` o usa `withTenantContext`.  
**Riesgo Go-Live:** P2. Requiere revisión de router legacy.

---

## Módulo 5 — Signos Vitales {#módulo-5}

### 5.1 Resumen ejecutivo

El router `signos-vitales.router.ts` cubre create/update/firmar/validar/anular sobre `ece.signos_vitales`. La tabla en DB está confirmada. **Se detecta drift grave de nombres de columnas** entre lo que el router inserta y los nombres reales en BD. El formulario de nueva toma (`signos-vitales/nueva/page.tsx`) es un prototipo stub que llama `setTimeout` en lugar del router tRPC real — el botón "Registrar y Firmar" no hace nada.

### 5.2 Archivos auditados

| Capa | Archivo |
|------|---------|
| UI — nueva toma | `apps/web/src/app/(clinical)/ece/signos-vitales/nueva/page.tsx` |
| UI — lista | `apps/web/src/app/(clinical)/ece/signos-vitales/page.tsx` |
| tRPC router | `packages/trpc/src/routers/ece/signos-vitales.router.ts` |
| Schemas Zod | `@his/contracts` — `eceSignosVitalesCreateSchema` |
| SQL DDL | `ece.signos_vitales` (MCP Supabase) |
| Tests | `packages/trpc/src/routers/ece/__tests__/signos-vitales.test.ts` |

### 5.3 Matriz de trazabilidad — Signos Vitales

| # | Campo UI | Payload tRPC | Prop Zod | Columna Router SQL | Columna DB Real | Tipo DB | NOT NULL | Alineado | Observación |
|---|---|---|---|---|---|---|---|---|---|
| 1 | TA Sistólica | `taSistolica` | `numRange(60,260)` | `ta_sistolica` | `presion_sistolica` | smallint | NO | NO | **C7-P0**: nombre de columna distinto |
| 2 | TA Diastólica | `taDiastolica` | `numRange(40,160)` | `ta_diastolica` | `presion_diastolica` | smallint | NO | NO | **C7-P0**: nombre de columna distinto |
| 3 | FC | `frecuenciaCardiaca` | `numRange(30,220)` | `frecuencia_cardiaca` | `frecuencia_cardiaca` | smallint | NO | OK | Alineado |
| 4 | FR | `frecuenciaRespiratoria` | `numRange(4,60)` | `frecuencia_respiratoria` | `frecuencia_respiratoria` | smallint | NO | OK | Alineado |
| 5 | Temperatura | `temperatura` | `numRange(30,43)` | `temperatura` | `temperatura` | numeric | NO | OK | Alineado |
| 6 | SpO2 | `saturacionO2` | `numRange(50,100)` | `saturacion_o2` | `saturacion_o2` | smallint | NO | OK | Alineado |
| 7 | Dolor EVA | `dolorEva` | `numRange(0,10)` | `dolor_eva` | `escala_dolor` | smallint | NO | NO | **C7-P0**: `dolor_eva` vs `escala_dolor` |
| 8 | Observaciones | `observaciones` | `z.string().max(2000)` | `observaciones` | **AUSENTE** en DB | — | — | NO | **C7-P0**: columna no existe en DB |
| 9 | Fecha/hora toma | `tomadoEn` | `z.string().datetime()` | `tomado_en` | `fecha_hora_toma` | timestamptz | YES | NO | **C7-P0**: `tomado_en` vs `fecha_hora_toma` |
| 10 | Personal | `personalId` | `z.string().uuid()` | `personal_id` | `registrado_por` | uuid | YES | NO | **C7**: `personal_id` vs `registrado_por` |
| 11 | Establecimiento | `establecimientoId` | `z.string().uuid()` | `establecimiento_id` | **AUSENTE** en DB | — | — | NO | **C7-P0**: columna no existe |
| 12 | Peso kg | — | — | — | `peso_kg` (numeric) | numeric | NO | N/A | Campo DB no expuesto |
| 13 | Talla cm | — | — | — | `talla_cm` (numeric) | numeric | NO | N/A | Campo DB no expuesto |
| 14 | IMC | — | — | — | `imc` (numeric) | numeric | NO | N/A | Calculable, no expuesto |
| 15 | Glucometría | — | — | — | `glucometria_mgdl` (numeric) | numeric | NO | N/A | Campo DB no expuesto |
| 16 | Retroactivo | — | — | — | `digitado_retroactivamente` (bool) | boolean | YES (default false) | N/A | No expuesto |

### 5.4 Hallazgos

#### HD-16 — C7 — P0-BLOQUEANTE — Schema drift masivo en `ece.signos_vitales`: 5 columnas del router no coinciden con la BD

**Descripción:** El router genera INSERT/UPDATE con columnas cuyo nombre no existe en `ece.signos_vitales`:
- `ta_sistolica` → DB: `presion_sistolica`
- `ta_diastolica` → DB: `presion_diastolica`
- `dolor_eva` → DB: `escala_dolor`
- `tomado_en` → DB: `fecha_hora_toma`
- `observaciones` → **no existe** en DB
- `personal_id` → DB: `registrado_por`
- `establecimiento_id` → **no existe** en DB

Todas las operaciones de escritura (`create`, `update`, `firmar`) fallarán con error `42703`.

**Impacto:** Módulo de signos vitales completamente no funcional. El registro de parámetros hemodinámicos — de alta frecuencia en hospitalización — queda bloqueado.  
**Ruta afectada:** `packages/trpc/src/routers/ece/signos-vitales.router.ts:341-373` (INSERT en create), `:407-420` (UPDATE)  
**Remediación:** Corregir los nombres de columnas en el router para que coincidan con la BD: `ta_sistolica` → `presion_sistolica`, etc. Evaluar si `observaciones` y `establecimiento_id` deben agregarse a la BD o eliminarse del schema Zod.  
**Riesgo Go-Live:** BLOQUEANTE.

---

#### HD-17 — C1 — P0-BLOQUEANTE — UI de nueva toma de signos vitales es un stub: no llama al router tRPC

**Descripción:** `signos-vitales/nueva/page.tsx:227-234` contiene:
```javascript
// TODO: llamar api.eceSignosVitales.create + firmar en una sola acción
// cuando el router tRPC esté conectado al cliente.
await new Promise((r) => setTimeout(r, 600)); // stub
router.push("/ece/signos-vitales");
```
El formulario completo de signos vitales con alertas críticas es funcional en UI, pero el submit hace un sleep y redirige sin persistir nada.

**Impacto:** La captura de signos vitales es completamente no funcional. Las alertas críticas (SpO2 < 90%, FC > 130) se muestran en pantalla pero el registro no se persiste.  
**Ruta afectada:** `apps/web/src/app/(clinical)/ece/signos-vitales/nueva/page.tsx:216-235`  
**Remediación:** Conectar el handler `handleSubmit` con `trpc.eceSignosVitales.create.mutateAsync(...)` (tras corregir HD-16).  
**Riesgo Go-Live:** BLOQUEANTE.

---

#### HD-18 — C1 — P1-ALTO — Campos clínicos `peso_kg`, `talla_cm`, `glucometria_mgdl` en DB no están expuestos en UI ni contrato

**Descripción:** La tabla `ece.signos_vitales` incluye `peso_kg`, `talla_cm`, `imc`, `perimetro_cefalico_cm`, `glucometria_mgdl` — todos relevantes para hospitalización pediátrica y monitoreo metabólico. Ninguno está en el schema Zod ni en el formulario UI.

**Impacto:** Datos clínicos requeridos por NTEC Art. 28 (monitoreo integral) no se capturan. Impacta cálculos de IMC para ajuste de dosis pediátrica.  
**Ruta afectada:** `apps/web/src/app/(clinical)/ece/signos-vitales/nueva/page.tsx` (formulario incompleto)  
**Remediación:** Agregar sección "Datos antropométricos" con `peso_kg`, `talla_cm` al formulario; calcular `imc` automáticamente.  
**Riesgo Go-Live:** P1. Datos requeridos NTEC no capturados.

---

## Módulo 6 — Valoración Inicial Enfermería {#módulo-6}

### 6.1 Resumen ejecutivo

El router `valoracion-inicial-enfermeria.router.ts` implementa el documento VAL_INI_ENF con cardinalidad 1:1 por episodio hospitalario. La trazabilidad UI→ORM→DB es la más limpia del Stream D: todos los campos del INSERT coinciden con las columnas confirmadas en BD. El módulo tiene RLS activa (`val_ini_enf_by_episodio_estab`). Sin embargo, la firma no usa PIN electrónico (solo sesión activa), y existe un problema de tenant isolation en el procedure `list`.

### 6.2 Archivos auditados

| Capa | Archivo |
|------|---------|
| UI — nueva | `apps/web/src/app/(clinical)/ece/valoracion-inicial-enfermeria/nueva/page.tsx` |
| UI — lista | `apps/web/src/app/(clinical)/ece/valoracion-inicial-enfermeria/page.tsx` |
| UI — detalle | `apps/web/src/app/(clinical)/ece/valoracion-inicial-enfermeria/[id]/page.tsx` |
| tRPC router | `packages/trpc/src/routers/ece/valoracion-inicial-enfermeria.router.ts` |
| SQL DDL | `ece.valoracion_inicial_enfermeria` (MCP Supabase) |

### 6.3 Matriz de trazabilidad — Valoración Inicial Enfermería

| # | Campo UI | Payload tRPC | Prop Zod | Columna Router | Columna DB | Tipo DB | NOT NULL | Alineado | Observación |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Episodio hospitalario | `episodioHospitalarioId` | `z.string().uuid()` | `episodio_hospitalario_id` | `episodio_hospitalario_id` | uuid | YES | OK | Alineado |
| 2 | Fecha/hora | `fechaHora` | `z.coerce.date()` | `fecha_hora` | `fecha_hora` | timestamptz | YES | OK | Alineado |
| 3 | Antecedentes personales | `antecedentesPersonales` | `z.string().max(4000)` | `antecedentes_personales` | `antecedentes_personales` | text | NO | OK | Alineado |
| 4 | Antecedentes familiares | `antecedentesFamiliares` | `z.string().max(4000)` | `antecedentes_familiares` | `antecedentes_familiares` | text | NO | OK | Alineado |
| 5 | Alergias | `alergiasConocidas` | `z.string().max(2000)` | `alergias_conocidas` | `alergias_conocidas` | text | NO | OK | Alineado |
| 6 | Medicamentos actuales | `medicamentosActuales` | `z.string().max(2000)` | `medicamentos_actuales` | `medicamentos_actuales` | text | NO | OK | Alineado |
| 7 | Escala Braden | `escalaBraden` | `z.number().int().min(6).max(23)` | `escala_braden` | `escala_braden` | smallint | NO | OK | Alineado |
| 8 | Escala Morse | `escalaMorse` | `z.number().int().min(0).max(125)` | `escala_morse` | `escala_morse` | smallint | NO | OK | Alineado |
| 9 | Escala dolor | `escalaDolor` | `z.number().int().min(0).max(10)` | `escala_dolor` | `escala_dolor` | smallint | NO | OK | Alineado |
| 10 | Estado consciencia | `estadoConsciencia` | `z.string().max(500)` | `estado_consciencia` | `estado_consciencia` | text | NO | OK | Alineado |
| 11 | Dispositivos invasivos | `dispositivosInvasivos` | `z.string().max(1000)` | `dispositivos_invasivos` | `dispositivos_invasivos` | text | NO | OK | Alineado |
| 12 | Educación brindada | `educacionBrindada` | `z.string().max(2000)` | `educacion_brindada` | `educacion_brindada` | text | NO | OK | Alineado |
| 13 | Plan cuidados | `planCuidadosInicial` | `z.string().max(4000)` | `plan_cuidados_inicial` | `plan_cuidados_inicial` | text | NO | OK | Alineado |
| 14 | Estado registro | `estado_registro` (write) | — | `estado_registro` | `estado_registro` | text | YES (default 'borrador') | OK | Alineado |

### 6.4 Hallazgos

#### HD-19 — C3 — P1-ALTO — Procedure `list` usa `ctx.prisma` sin `withEceContext` — RLS no aplica

**Descripción:** El procedure `list` en `valoracion-inicial-enfermeria.router.ts:200-221` ejecuta `ctx.prisma.$queryRaw` directamente, fuera de `withEceContext`. La RLS `val_ini_enf_by_episodio_estab` requiere rol `authenticated` y el GUC `ece.current_establecimiento_id_safe()`. El rol Supabase con BYPASSRLS activo no pasa por la política. El filtro de tenant es solo por `episodio_hospitalario_id` si se provee, pero no hay filtro de establecimiento explícito en la query.

**Impacto:** Un usuario autenticado podría listar valoraciones de otros establecimientos si conoce el `episodio_hospitalario_id`. En multi-tenant, es una fuga de datos clínicos.  
**Ruta afectada:** `packages/trpc/src/routers/ece/valoracion-inicial-enfermeria.router.ts:200-221`  
**Remediación:** Envolver la query de `list` dentro de `withEceContext(ctx.prisma, ctx.tenant, ctx.user.id, async (tx) => { ... })` para que RLS aplique.  
**Riesgo Go-Live:** P1.

---

#### HD-20 — C6 — P2-MEDIO — Firma de valoración inicial no requiere PIN — solo sesión activa

**Descripción:** El procedure `firmar` de `valoracion-inicial-enfermeria.router.ts:354-393` firma simplemente con `UPDATE SET estado_registro = 'firmado', firmado_por = ${userId}` sin verificar PIN electrónico. NTEC Art. 39 exige firma electrónica con autenticación para documentos de hospitalización. La firma sin PIN es inconsistente con `hoja-ingreso.router.ts` (usa argon2id) y `registro-enfermeria.router.ts` (tampoco usa PIN).

**Impacto:** Cualquier sesión activa puede firmar la valoración de cualquier enfermero. La inmutabilidad post-firma depende solo del cambio de estado, no de autenticación.  
**Ruta afectada:** `packages/trpc/src/routers/ece/valoracion-inicial-enfermeria.router.ts:354-393`  
**Remediación:** Agregar verificación de PIN argon2id (patrón de `hoja-ingreso.router.ts:232-288`). Si se decide no requerir PIN para firma de enfermería, documentarlo como ADR con justificación regulatoria.  
**Riesgo Go-Live:** P2. Inconsistencia con NTEC Art. 39.

---

#### HD-21 — C4 — P2-MEDIO — Sin trigger DB que bloquee UPDATE post-firma en `valoracion_inicial_enfermeria`

**Descripción:** La consulta de triggers en BD (`information_schema.triggers` para `ece.*`) devuelve 0 filas. El router rechaza updates post-firma en JS (`if (row.estado_registro !== 'borrador')`), pero no existe trigger DB que prevenga un UPDATE directo bypaseando la capa de aplicación. NTEC Art. 40 exige inmutabilidad técnica.

**Impacto:** Un acceso directo a BD o un bug en el router podría modificar una valoración firmada sin dejar rastro.  
**Ruta afectada:** `packages/database/sql/` (trigger faltante para `ece.valoracion_inicial_enfermeria`)  
**Remediación:** Crear trigger `BEFORE UPDATE ON ece.valoracion_inicial_enfermeria FOR EACH ROW EXECUTE FUNCTION fn_bloquea_mutacion()` cuando `estado_registro IN ('firmado', 'validado')`. Mismo patrón de `ece.epicrisis_egreso`.  
**Riesgo Go-Live:** P2. Protección solo en capa de aplicación.

---

## Módulo 7 — Registro de Enfermería (MAR) {#módulo-7}

### 7.1 Resumen ejecutivo

El router `registro-enfermeria.router.ts` implementa el registro de jornada de enfermería (cabecera) y la administración de medicamentos (`registrarAdministracion`). **Se detecta schema drift crítico entre el router y la BD.** El router inserta `fecha`, `observaciones`, `personal_id`, `organization_id` en `ece.registro_enfermeria`, pero la BD real tiene columnas `nota_evolucion`, `plan_cuidados`, `valoracion_enf (JSONB)`, `registrado_por` — sin `fecha`, `personal_id`, `organization_id`. Adicionalmente, la operación `registrarAdministracion` NO usa `computeScheduledSlot` de `medication-slot.ts`, lo que constituye la regresión documentada en PR #162.

### 7.2 Archivos auditados

| Capa | Archivo |
|------|---------|
| UI — lista | `apps/web/src/app/(clinical)/ece/registro-enfermeria/page.tsx` |
| UI — detalle | `apps/web/src/app/(clinical)/ece/registro-enfermeria/[id]/page.tsx` |
| UI — nueva | `apps/web/src/app/(clinical)/ece/registro-enfermeria/nuevo/page.tsx` |
| tRPC router | `packages/trpc/src/routers/ece/registro-enfermeria.router.ts` |
| SQL DDL | `ece.registro_enfermeria` (MCP Supabase) |
| Tests | `packages/trpc/src/routers/ece/__tests__/registro-enfermeria.router.test.ts` |

### 7.3 Matriz de trazabilidad — Registro Enfermería

| # | Campo Router | Prop Zod | Columna Router INSERT | Columna DB Real | Tipo DB | NOT NULL | Alineado | Observación |
|---|---|---|---|---|---|---|---|---|
| 1 | `episodioId` | `z.string().uuid()` | `episodio_id` | `episodio_id` | uuid | YES | OK | Alineado |
| 2 | `fecha` | `z.coerce.date()` | `fecha` | **AUSENTE** | — | — | NO | **C7-P0**: columna no existe en DB |
| 3 | `turno` | `z.enum(["matutino","vespertino","nocturno"])` | `turno` | `turno` | text | YES | OK | Alineado |
| 4 | `observaciones` | `z.string().max(2000)` | `observaciones` | **AUSENTE** | — | — | NO | **C7-P0**: DB tiene `nota_evolucion`, no `observaciones` |
| 5 | — | — | `personal_id` | **AUSENTE** | — | — | NO | **C7-P0**: DB tiene `registrado_por` |
| 6 | — | — | `organization_id` | **AUSENTE** | — | — | NO | **C7-P0**: columna no existe en DB |
| 7 | `estado` | — | `estado = 'borrador'` | `estado_registro` | text | YES | NO | **C7**: nombre distinto |
| 8 | — | — | — | `nota_evolucion` (text) | text | NO | N/A | Campo DB no expuesto en schema create |
| 9 | — | — | — | `plan_cuidados` (text) | text | NO | N/A | Campo DB no expuesto |
| 10 | — | — | — | `valoracion_enf` (jsonb) | jsonb | NO | N/A | Campo DB no expuesto |
| 11 | `firmado_por` | — | `firmado_por = ${userId}` | **AUSENTE** en DB | — | — | NO | **C7**: DB usa `registrado_por` como único actor |
| 12 | `horaAdministrada` (MAR) | `z.coerce.date()` | `hora_administrada` | `hora_administrada` | timestamptz | YES | OK | Alineado |
| 13 | `scheduledTime` | **AUSENTE** | **AUSENTE** | — | — | — | NO | **C10-P1**: `computeScheduledSlot` no invocado |

### 7.4 Hallazgos

#### HD-22 — C7 — P0-BLOQUEANTE — Schema drift crítico en `ece.registro_enfermeria`: columnas `fecha`, `observaciones`, `personal_id`, `organization_id`, `firmado_por` no existen en BD

**Descripción:** El router genera INSERT con `fecha`, `personal_id`, `organization_id`, `observaciones`, `estado` y UPDATE con `firmado_por`, `validado_por` — ninguna de estas columnas existe en `ece.registro_enfermeria` real. La BD tiene: `turno`, `nota_evolucion`, `plan_cuidados`, `valoracion_enf (jsonb)`, `registrado_por`, `estado_registro`. El campo `estado_registro` existe pero el router usa `estado` sin el sufijo.

Todas las operaciones de escritura (`create`, `firmar`, `validar`) del registro de enfermería fallarán con `42703`.

**Impacto:** El MAR de enfermería — módulo de mayor frecuencia en hospitalización — es completamente no funcional. Ningún turno puede registrarse.  
**Ruta afectada:** `packages/trpc/src/routers/ece/registro-enfermeria.router.ts:270-295` (INSERT create), `:424-436` (UPDATE firmar), `:460-471` (UPDATE validar)  
**Remediación:** Sincronizar completamente el router con la estructura DB: `fecha` → eliminar (no existe en DB); `observaciones` → mapear a `nota_evolucion`; `personal_id` → `registrado_por`; `organization_id` → no existe (RLS via `episodio_id`); `estado` → `estado_registro`; `firmado_por` → no existe (registrar en `registrado_por` o agregar columna). Evaluar si se agregan columnas `fecha`, `firmado_por` a la BD.  
**Riesgo Go-Live:** BLOQUEANTE.

---

#### HD-23 — C10 — P1-ALTO — `registrarAdministracion` no invoca `computeScheduledSlot` — regresión del fix PR #162

**Descripción:** El procedure `registrarAdministracion` en `registro-enfermeria.router.ts:304-400` inserta `hora_administrada` directamente desde `input.horaAdministrada` sin derivar `scheduledTime` desde `computeScheduledSlot` (definido en `apps/web/src/lib/medication-slot.ts`). Según las instrucciones del proyecto, cualquier llamada `medicationAdmin.record` SIN `scheduledTime` derivado de `computeScheduledSlot` constituye regresión del bug remediado en PR #162.

**Nota:** Este router `ece.registro_enfermeria` usa `ece.administracion_medicamento`, no `public.MedicationAdministration`. El fix PR #162 apuntó a `medicationAdmin.record` en el router legacy. Sin embargo, el principio es el mismo: la hora de administración debe tener un slot programado de referencia para conciliación de omisiones.

**Impacto:** Sin `scheduledTime` derivado del schedule de indicaciones, la conciliación de administraciones vs. indicaciones médicas es imposible. Las omisiones (MISSED) no pueden calcularse.  
**Ruta afectada:** `packages/trpc/src/routers/ece/registro-enfermeria.router.ts:354-399`  
**Remediación:** Al registrar `administracion_medicamento`, derivar el slot programado de `ece.indicacion_item.hora_indicada` (o equivalente) y persistirlo en un campo `scheduled_slot_id` o `hora_programada`. Si la BD no tiene esta columna, agregar la migración.  
**Riesgo Go-Live:** P1. Conciliación MAR incompleta.

---

#### HD-24 — C3 — P1-ALTO — `list` del registro de enfermería usa `ctx.prisma` directo — RLS no aplica

**Descripción:** El procedure `list` (`registro-enfermeria.router.ts:209-228`) usa `ctx.prisma.$queryRaw` directamente con `organization_id = ${orgId}::uuid` como único filtro de tenant. La columna `organization_id` no existe en BD — el filtro siempre es `NULL::uuid = ${orgId}` y retorna 0 filas (o error 42703). Adicionalmente, al no usar `withEceContext`, la política RLS `by_episodio_estab` no aplica.

**Impacto:** El listado de registros de enfermería está roto tanto por el drift de columna como por la ausencia de RLS.  
**Ruta afectada:** `packages/trpc/src/routers/ece/registro-enfermeria.router.ts:209-228`  
**Remediación:** Corregir el filtro (usar `episodio_id` o join a `episodio_atencion.establecimiento_id`) y envolver en `withEceContext`.  
**Riesgo Go-Live:** P1.

---

## Módulo 8 — RRI — Referencia/Retorno/Interconsulta {#módulo-8}

### 8.1 Resumen ejecutivo

El router `rri.router.ts` implementa el documento RRI con workflow completo de doble firma (MC crea y firma; IC responde y firma). El módulo es funcionalmente más completo que los anteriores en términos de workflow. **Sin embargo, existe schema drift significativo entre columnas del router y la BD real.** El router usa `destino_servicio_id`, `datos_clinicos_relevantes`, `urgencia`, `diagnostico_ic`, `plan_ic`, `respuesta`, `fecha_solicitud`, `estado_codigo` — mientras la BD tiene `establecimiento_destino_id`, `resumen_clinico`, sin columna `urgencia`, sin `diagnostico_ic`, sin `plan_ic`, `respuesta_interconsultante`, sin `fecha_solicitud`.

### 8.2 Archivos auditados

| Capa | Archivo |
|------|---------|
| UI — nueva solicitud | `apps/web/src/app/(clinical)/ece/rri/nueva/page.tsx` |
| UI — lista | `apps/web/src/app/(clinical)/ece/rri/page.tsx` |
| UI — detalle | `apps/web/src/app/(clinical)/ece/rri/[id]/page.tsx` |
| UI — responder | `apps/web/src/app/(clinical)/ece/rri/[id]/responder/page.tsx` |
| tRPC router | `packages/trpc/src/routers/ece/rri.router.ts` |
| Schemas Zod | `packages/trpc/src/routers/ece/rri.schemas.ts` |
| SQL DDL | `ece.rri` (MCP Supabase) |
| Tests | `packages/trpc/src/routers/ece/__tests__/rri.router.test.ts` |

### 8.3 Matriz de trazabilidad — RRI

| # | Campo UI | Payload tRPC | Prop Zod | Columna Router SQL | Columna DB Real | Alineado | Observación |
|---|---|---|---|---|---|---|---|
| 1 | Tipo | `tipo` | `z.enum(["referencia","retorno","interconsulta"])` | `tipo` | `tipo` (text) | OK | Alineado |
| 2 | Servicio destino | `destinoServicioId` | `z.string().uuid()` | `destino_servicio_id` | `establecimiento_destino_id` | NO | **C7-P0**: nombre distinto |
| 3 | Urgencia | `urgencia` | `z.enum(["rutinaria","prioritaria","urgente"])` | `urgencia` | **AUSENTE** en DB | NO | **C7-P0**: columna no existe en DB |
| 4 | Motivo | `motivo` | `z.string().min(1).max(2000)` | `motivo` | `motivo` (text) | OK | Alineado |
| 5 | Datos clínicos | `datosClinicosRelevantes` | `z.string().min(1)` | `datos_clinicos_relevantes` | `resumen_clinico` | NO | **C7-P0**: nombre distinto |
| 6 | Respuesta IC | `respuesta` | `z.string()` | `respuesta` | `respuesta_interconsultante` | NO | **C7-P0**: nombre distinto |
| 7 | Diagnóstico IC | `diagnostico` | `z.string()` | `diagnostico_ic` | **AUSENTE** en DB | NO | **C7-P0**: columna no existe |
| 8 | Plan IC | `plan` | `z.string()` | `plan_ic` | **AUSENTE** en DB | NO | **C7-P0**: columna no existe |
| 9 | Fecha solicitud | — | — | `fecha_solicitud` | **AUSENTE** en DB | NO | **C7-P0**: router usa `fecha_solicitud`, DB usa `registrado_en` |
| 10 | Paciente ID | derivado de episodio | — | `paciente_id` | `paciente_id` | OK | Alineado |
| 11 | Establecimiento origen | — | — | — | `establecimiento_origen_id` (uuid NULL) | N/A | Campo DB no mapeado en router |
| 12 | Especialidad solicitada | — | — | `especialidad_solicitada` (rri.schemas.ts) | `especialidad_solicitada` (text NULL) | OK | Solo en schema; no en UI |

### 8.4 Hallazgos

#### HD-25 — C7 — P0-BLOQUEANTE — Schema drift masivo en `ece.rri`: 6 columnas del router con nombres incorrectos o inexistentes en BD

**Descripción:** El router `rri.router.ts` genera INSERT/UPDATE/SELECT con columnas que difieren de la BD:
- `destino_servicio_id` → DB: `establecimiento_destino_id`
- `urgencia` → **no existe** en BD
- `datos_clinicos_relevantes` → DB: `resumen_clinico`
- `diagnostico_ic` → **no existe** en BD
- `plan_ic` → **no existe** en BD
- `respuesta` → DB: `respuesta_interconsultante`
- `fecha_solicitud` → DB: `registrado_en` (campo gestionado por DB)

Todo INSERT de `create` y UPDATE de `responder` fallará con `42703`.

**Impacto:** El sistema de referencia y contrarreferencia entre niveles de atención — requisito NTEC §3.10 para continuidad asistencial — es completamente no funcional.  
**Ruta afectada:** `packages/trpc/src/routers/ece/rri.router.ts:524-544` (INSERT), `:628-638` (UPDATE responder)  
**Remediación:** Sincronizar el router con la BD: renombrar columnas incorrectas y eliminar o migrar las columnas `urgencia`, `diagnostico_ic`, `plan_ic` (agregar a BD o serializar en `resumen_clinico` JSONB).  
**Riesgo Go-Live:** BLOQUEANTE.

---

#### HD-26 — C6 — P1-ALTO — UI RRI acepta `episodioId` como texto libre sin validación UUID client-side

**Descripción:** En `rri/nueva/page.tsx:112-121`, el campo "Episodio (UUID)" es un `<Input type="text">` con placeholder. La UI solo valida `datos.episodioId.trim().length > 0`. Si el usuario escribe texto no-UUID, el error vendrá del servidor como `ZodError` sin indicación visual previa.

**Impacto:** UX confusa; el médico puede intentar firmar con un episodio inválido.  
**Ruta afectada:** `apps/web/src/app/(clinical)/ece/rri/nueva/page.tsx:112-121`  
**Remediación:** Reemplazar el campo libre por un selector de episodio activo del paciente (llamada a `eceEpisodioHospitalario.listActivos`). Como mínimo, agregar validación UUID client-side.  
**Riesgo Go-Live:** P1.

---

#### HD-27 — C5 — P2-MEDIO — RRI no captura diagnóstico CIE-10 en la solicitud

**Descripción:** NTEC §3.10 especifica que el formulario de referencia debe incluir diagnóstico CIE-10 del motivo de referencia. El schema `eceRriCreateSchema` no incluye `diagnosticoCIE10`. La columna `especialidad_solicitada` existe en BD pero no hay campo de diagnóstico codificado.

**Impacto:** Las referencias no incluyen código diagnóstico; el centro receptor no puede priorizar correctamente.  
**Ruta afectada:** `packages/trpc/src/routers/ece/rri.schemas.ts` (eceRriCreateSchema)  
**Remediación:** Agregar `diagnosticosCIE10: z.array(icd10CodeSchema).min(1)` al schema de creación de RRI.  
**Riesgo Go-Live:** P2.

---

## Módulo 9 — URPA — Recuperación Post-Anestésica {#módulo-9}

### 9.1 Resumen ejecutivo

El módulo URPA presenta dos capas con estados radicalmente distintos: el router `urpa-recovery.router.ts` está bien implementado (workflow Aldrete, validación cruzada, emisión de eventos), pero **la tabla `ece.urpa_recovery` no existe en la BD de producción** — consultada vía MCP Supabase con resultado vacío. La UI `urpa/page.tsx` usa datos mock hardcoded (`MOCK_ROWS`) y un enlace a `/ece/urpa/nuevo` que no existe como ruta. El módulo completo es no funcional en producción.

### 9.2 Archivos auditados

| Capa | Archivo |
|------|---------|
| UI — lista (mock) | `apps/web/src/app/(clinical)/ece/urpa/page.tsx` |
| tRPC router | `packages/trpc/src/routers/ece/urpa-recovery.router.ts` |
| Schemas Zod | `packages/contracts/src/schemas/ece-urpa.ts` |
| SQL DDL | `ece.urpa_recovery` → **NO EXISTE** en BD (MCP: 0 filas) |
| Tests | `packages/trpc/src/routers/ece/__tests__/urpa-recovery.router.test.ts` |

### 9.3 Matriz de trazabilidad — URPA

| # | Campo | Prop Zod | Columna Router | Columna DB Real | Alineado | Observación |
|---|---|---|---|---|---|---|
| 1 | Acto quirúrgico | `actoQuirurgicoId` | `acto_quirurgico_id` | **TABLA NO EXISTE** | NO | P0 bloqueante |
| 2 | Escala Aldrete ingreso | `escalaAldreteIngreso` | `escala_aldrete_ingreso` | **TABLA NO EXISTE** | NO | P0 bloqueante |
| 3 | Escala Aldrete alta | `escalaAldreteAlta` | `escala_aldrete_alta` | **TABLA NO EXISTE** | NO | P0 bloqueante |
| 4 | Criterio alta | `criterioAlta` | `criterio_alta` | **TABLA NO EXISTE** | NO | P0 bloqueante |
| 5 | Medicamentos admin. | `medicamentosAdministrados` | `medicamentos_administrados` (jsonb) | **TABLA NO EXISTE** | NO | P0 bloqueante |

### 9.4 Hallazgos

#### HD-28 — C7 — P0-BLOQUEANTE — `ece.urpa_recovery` no existe en la BD de producción

**Descripción:** La consulta `SELECT table_name FROM information_schema.tables WHERE table_name = 'urpa_recovery'` devuelve 0 filas. La migración que crea la tabla URPA nunca fue aplicada al proyecto Supabase. El router `urpa-recovery.router.ts` está completamente implementado y sus tests unitarios de schema pasan, pero toda operación de runtime fallará con `ERROR: relation "ece.urpa_recovery" does not exist`.

**Impacto:** El registro URPA — obligatorio por NTEC Art. 36 para todo procedimiento anestésico — es completamente no funcional.  
**Ruta afectada:** `packages/trpc/src/routers/ece/urpa-recovery.router.ts` (todas las procedures)  
**Remediación:** Aplicar la migración SQL que crea `ece.urpa_recovery` vía `mcp__supabase__apply_migration`. Verificar si existe el DDL en `packages/database/sql/` y aplicarlo.  
**Riesgo Go-Live:** BLOQUEANTE.

---

#### HD-29 — C1 — P0-BLOQUEANTE — UI `urpa/page.tsx` usa datos mock hardcoded — no conectada al router

**Descripción:** `apps/web/src/app/(clinical)/ece/urpa/page.tsx:28-55` define `MOCK_ROWS` con 3 pacientes ficticios (María López, Carlos Rivas, Ana Pérez) con UUIDs ficticios. El comentario explica "reemplazar con api.eceUrpa.list en el RSC cuando esté cableado". La página nunca carga datos reales. El enlace "Registrar ingreso" apunta a `/ece/urpa/nuevo` que no existe como ruta.

**Impacto:** La URPA siempre muestra los mismos 3 pacientes ficticios independientemente del estado real. Los usuarios reales no pueden ver ni registrar pacientes URPA.  
**Ruta afectada:** `apps/web/src/app/(clinical)/ece/urpa/page.tsx`  
**Remediación:** Reemplazar `MOCK_ROWS` con `await api.eceUrpaRecovery.list({...})` (RSC) o `trpc.eceUrpaRecovery.list.useQuery()` (client component). Crear ruta `/ece/urpa/nuevo/page.tsx` con formulario de ingreso URPA.  
**Riesgo Go-Live:** BLOQUEANTE.

---

#### HD-30 — C9 — P2-MEDIO — `darAlta` emite evento a `notifications_outbox` en lugar de `domain_events` (outbox unificado)

**Descripción:** `urpa-recovery.router.ts:368-373` inserta directamente en `notifications_outbox` con `$executeRaw`:
```sql
INSERT INTO notifications_outbox (event_type, payload, created_at)
VALUES ('ece.urpa.alta_otorgada', ${payload}::jsonb, now())
```
El resto del proyecto usa `emitDomainEvent` de `@his/database` que escribe en `domain_events` con el patrón outbox transaccional unificado.

**Impacto:** El evento URPA no pasa por el mecanismo de replay y retry del outbox unificado. No es consumido por los suscriptores del bus de eventos del HIS.  
**Ruta afectada:** `packages/trpc/src/routers/ece/urpa-recovery.router.ts:358-373`  
**Remediación:** Reemplazar el INSERT manual por `emitDomainEvent(tx, { eventType: "ece.urpa.alta_otorgada", ... })`.  
**Riesgo Go-Live:** P2.

---

## Resumen Consolidado Stream D {#resumen-consolidado}

### Tabla global de hallazgos

| ID | Módulo | Cat | Sev | Título breve |
|----|--------|-----|-----|--------------|
| HD-01 | Hoja Ingreso | C7 | P0 | Schema drift masivo: 6 columnas `hoja_ingreso` no existen en BD |
| HD-02 | Hoja Ingreso | C7/C3 | P0 | `findHojaIngreso` lee columnas inexistentes — queries de lectura fallan |
| HD-03 | Hoja Ingreso | C2 | P1 | UI modalidad: texto libre vs enum Zod |
| HD-04 | Hoja Ingreso | C6 | P2 | PIN mínimo 4 UI vs 6 Zod |
| HD-05 | Hoja Ingreso | C8 | P2 | Hash payload usa columnas inexistentes en BD |
| HD-06 | Hoja Ingreso | C11 | P2 | Tests validan schema incorrecto — falso positivo |
| HD-07 | Episodio Hosp. | C7 | P0 | Schema drift: `sala_id`, `gravedad`, `medico_tratante_id`, `fecha_ingreso` no existen en BD |
| HD-08 | Episodio Hosp. | C7 | P1 | Columna `gravedad` no confirmada en BD |
| HD-09 | Episodio Hosp. | C4 | P2 | `confirmarAlta` no verifica médico firmante de epicrisis |
| HD-10 | Episodio Hosp. | C9 | P2 | Evento outbox en tx separada — riesgo de huérfano |
| HD-11 | Evolución Méd. | C5 | P1 | CIE-10 ausente en UI y schema create de evoluciones |
| HD-12 | Evolución Méd. | C1 | P2 | `digitado_retroactivamente` no mapeado en router |
| HD-13 | Evolución Méd. | C12 | P3 | Autosave localStorage sin aviso en modo privado |
| HD-14 | Kardex | C1 | P2 | Cast inseguro `as Record<string,unknown>` para campos BCMA |
| HD-15 | Kardex | C10 | P2 | `cancelAdmin` sin verificación explícita de tenant |
| HD-16 | Signos Vitales | C7 | P0 | Schema drift: `ta_sistolica`, `ta_diastolica`, `dolor_eva`, `tomado_en`, `observaciones`, `personal_id`, `establecimiento_id` no coinciden con BD |
| HD-17 | Signos Vitales | C1 | P0 | UI nueva toma es stub — `setTimeout` en lugar de llamada tRPC |
| HD-18 | Signos Vitales | C1 | P1 | `peso_kg`, `talla_cm`, `glucometria_mgdl` en BD sin exponer en UI |
| HD-19 | Val. Ini. Enf. | C3 | P1 | `list` sin `withEceContext` — RLS no aplica |
| HD-20 | Val. Ini. Enf. | C6 | P2 | Firma sin PIN electrónico — inconsistente con NTEC Art. 39 |
| HD-21 | Val. Ini. Enf. | C4 | P2 | Sin trigger DB de inmutabilidad post-firma |
| HD-22 | Reg. Enfermería | C7 | P0 | Schema drift crítico: `fecha`, `observaciones`, `personal_id`, `organization_id`, `firmado_por` no existen en BD |
| HD-23 | Reg. Enfermería | C10 | P1 | `registrarAdministracion` sin `scheduledTime` derivado — regresión PR #162 |
| HD-24 | Reg. Enfermería | C3 | P1 | `list` usa `ctx.prisma` directo — RLS no aplica y filtro usa columna inexistente |
| HD-25 | RRI | C7 | P0 | Schema drift masivo: 6 columnas RRI con nombres incorrectos o inexistentes en BD |
| HD-26 | RRI | C6 | P1 | UI acepta `episodioId` como texto libre sin validación UUID |
| HD-27 | RRI | C5 | P2 | RRI sin diagnóstico CIE-10 obligatorio (NTEC §3.10) |
| HD-28 | URPA | C7 | P0 | `ece.urpa_recovery` no existe en BD — migración no aplicada |
| HD-29 | URPA | C1 | P0 | UI usa datos mock hardcoded — nunca conectada a router real |
| HD-30 | URPA | C9 | P2 | Evento outbox directo a `notifications_outbox` en lugar de `emitDomainEvent` |

### Conteo por severidad

| Severidad | Cantidad | Módulos más afectados |
|-----------|----------|----------------------|
| **P0-BLOQUEANTE** | **9** | Hoja Ingreso (HD-01, HD-02), Episodio Hosp. (HD-07), Signos Vitales (HD-16, HD-17), Reg. Enfermería (HD-22), RRI (HD-25), URPA (HD-28, HD-29) |
| **P1-ALTO** | **8** | Episodio Hosp. (HD-08), Evolución (HD-11), Signos Vitales (HD-18), Val.Enf. (HD-19), Reg.Enf. (HD-23, HD-24), RRI (HD-26) |
| **P2-MEDIO** | **11** | Distribuidos entre todos los módulos |
| **P3-BAJO** | **2** | Evolución Médica (HD-13) |
| **Total** | **30** | |

### Análisis de causa raíz

La causa raíz de los P0 de schema drift es sistemática: los routers ECE del Stream D fueron desarrollados contra un schema de BD de diseño previo que evolucionó durante la implementación (Sprint F2-S1), pero los routers no se actualizaron cuando las migraciones SQL cambiaron los nombres de columnas. Afecta a 5 de los 9 módulos auditados. Los tests unitarios con mocks no detectan este drift porque mockean la capa de BD con la misma estructura incorrecta.

### Estado de Go-Live

| Módulo | Estado | Bloqueantes |
|--------|--------|-------------|
| Hoja de Ingreso | BLOQUEADO | HD-01, HD-02 |
| Episodio Hospitalario | BLOQUEADO | HD-07 |
| Notas de Evolución | OPERATIVO CON RIESGOS | HD-11 (P1) |
| Kardex | OPERATIVO CON RIESGOS | HD-14, HD-15 (P2) |
| Signos Vitales | BLOQUEADO | HD-16, HD-17 |
| Valoración Inicial Enf. | OPERATIVO CON RIESGOS | HD-19 (P1) |
| Registro Enfermería (MAR) | BLOQUEADO | HD-22 |
| RRI | BLOQUEADO | HD-25 |
| URPA | BLOQUEADO | HD-28, HD-29 |

**Módulos bloqueados para go-live: 6 de 9.** Solo Evolución Médica, Kardex y Valoración Inicial Enfermería tienen path a producción con remediación de hallazgos P1/P2.

---

*Fin del documento de auditoría Stream D — Hospitalización.*  
*Auditor: @AS — Arquitecto de Software, Unidad de Transformación Digital, Inversiones Avante.*  
*Generado: 2026-05-19*
