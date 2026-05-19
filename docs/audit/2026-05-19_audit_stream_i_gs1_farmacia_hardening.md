# Auditoría Stream I — GS1 + Farmacia Hardening

**Fecha:** 2026-05-19
**Auditor:** @AS — Arquitecto de Software, Unidad de Transformación Digital, Inversiones Avante
**Rama auditada:** `feat/fase2-s1-gate` (commit `6532a92`)
**Método:** lectura estática de UI + routers tRPC + contratos Zod + schema Prisma + consultas `information_schema` / `pg_policies` / `pg_proc` al proyecto Supabase (read-only). Sin modificaciones.
**Scope:** 12 módulos — GS1 Dashboard, Devoluciones, GLN, Inbound, Lote detail, Medicamentos, Transfers, Trazabilidad, Staff GSRN, Farmacovigilancia, Inventory + Alertas, Equipment.

---

## Índice

1. [Flujo 1 — GS1 Dashboard](#flujo-1)
2. [Flujo 2 — GS1 Devoluciones](#flujo-2)
3. [Flujo 3 — GS1 GLN](#flujo-3)
4. [Flujo 4 — GS1 Inbound](#flujo-4)
5. [Flujo 5 — GS1 Lote detail](#flujo-5)
6. [Flujo 6 — GS1 Medicamentos](#flujo-6)
7. [Flujo 7 — GS1 Transfers](#flujo-7)
8. [Flujo 8 — GS1 Trazabilidad](#flujo-8)
9. [Flujo 9 — Staff GSRN](#flujo-9)
10. [Flujo 10 — Farmacovigilancia](#flujo-10)
11. [Flujo 11 — Inventory + Alertas](#flujo-11)
12. [Flujo 12 — Equipment](#flujo-12)
13. [Resumen Consolidado Stream I](#resumen-consolidado)

---

## Flujo 1 — GS1 Dashboard {#flujo-1}

### 1.1 Resumen ejecutivo

`/gs1/dashboard` implementa US.F2.6.5: 3 cards de conteo (GSRN activos, GLN registrados, GTIN con lotes) + tabla de vencimientos próximos + tabla de GSRN pendientes de renovación. El router `gs1DashboardRouter.summary` agrega 3 queries rawUnsafe a tablas `ece.*`. La UI es `"use client"` limpio con accesibilidad adecuada (`aria-label`, `data-testid`, `role="status"`).

**Actores:** Administrador logístico, Farmacéutico jefe.
**CRUD:** Solo lectura.

### 1.2 Archivos auditados

- `apps/web/src/app/(admin)/gs1/dashboard/page.tsx`
- `packages/trpc/src/routers/gs1-dashboard.router.ts`

### 1.3 Matriz de trazabilidad

| # | Campo UI | Payload tRPC | Prop Zod | Prop ORM | Columna DB | Tipo UI | Tipo Zod | Tipo Prisma | Tipo SQL | Req UI | NotNull Zod | NotNull DB | Observación |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `vencimientosDias` | `vencimientosDias` | `z.number().int().min(1).max(365).default(30)` | — | parámetro SQL | select | number | — | interval | No | Yes (default) | N/A | `default(30)` correcto. |
| 2 | `counts.gsrnActivos` | output | — | — | `COUNT(*) FROM ece.gs1_gsrn` | text | — | — | bigint→text | No | — | — | `parseInt` en el router convierte correctamente. |
| 3 | `loteVencimiento` (tabla) | output | — | — | `lote_vencimiento timestamptz` | Date.getTime() comparación | — | — | timestamptz | No | — | — | **C5**: la comparación `new Date(item.loteVencimiento).getTime() - now` en línea 208 puede mostrar fecha incorrecta si el servidor devuelve UTC y el cliente interpreta como local. Impacto: clasificación rojo/amarillo errónea. |
| 4 | selector `vencimientosDias` | `{vencimientosDias}` | `z.number()` | — | cast `($1 \|\| ' days')::interval` | select HTML | number | — | interval | No | — | — | **C6**: concatenación de entero como string para construir interval. Funciona para valores controlados (7/30/90). |

### 1.4 Hallazgos

#### HI-01 — C5 — Dashboard: comparación de vencimiento client-side ignora zona horaria (P2 MEDIA)

**Descripción:** En `page.tsx:208`:

```ts
new Date(item.loteVencimiento).getTime() - now < DIAS_ROJO * 86400000
```

`item.loteVencimiento` llega como `Date` serializado del servidor (ISO UTC). El cliente compara con `Date.now()` que también es UTC. El resultado numérico es correcto, pero `toLocaleDateString("es-SV")` en la celda siguiente muestra la fecha en UTC-6, lo que puede causar discrepancia visual de ±1 día respecto al servidor.

**Líneas afectadas:** `apps/web/src/app/(admin)/gs1/dashboard/page.tsx:99,208,221`
**Recomendación:** Usar `toLocaleDateString("es-SV", { timeZone: "America/El_Salvador" })` explícito al renderizar. La comparación numérica en UTC es correcta — solo afecta la presentación.
**Riesgo go-live:** Bajo-Medio. No produce datos incorrectos en BD, solo puede mostrar "Vencimiento: 31-mar" cuando el servidor calcula "01-abr" si el umbral cae a medianoche UTC.

---

#### HI-02 — C7 — Dashboard: queries rawUnsafe sin aislamiento RLS (P2 MEDIA)

**Descripción:** El router `gs1DashboardRouter.summary` usa `ctx.prisma.$queryRawUnsafe` directamente sobre tablas `ece.*` **sin** `withTenantContext`. El comentario del router indica explícitamente: "no requiere `withTenantContext` porque son queries de solo lectura con `tenantProcedure` (RLS aplica si el rol `authenticated` tiene permisos SELECT)". Este argumento es incorrecto: Prisma ejecuta como `postgres.<ref>` con `BYPASSRLS` — RLS **nunca aplica** en queries Prisma directas. No hay filtro `WHERE organization_id = ...` en ninguna de las 3 queries del dashboard.

**Impacto:** Un usuario de la org A puede ver conteos de GSRN/GLN/GTIN de la org B si comparte el mismo proyecto Supabase en modo multitenancy.

**Líneas afectadas:** `packages/trpc/src/routers/gs1-dashboard.router.ts:62-99`
**Recomendación:** Agregar `WHERE organization_id = ${ctx.tenant.organizationId}::uuid` en las 3 queries de conteo, o — si `ece.gs1_gtin/gsrn/gln` no tienen `organization_id` — documentar explícitamente que son catálogos globales y no tenant-scoped. Si son globales, el hallazgo es P3/informativo. Necesita verificación contra schema DDL.
**Riesgo go-live:** Medio. Afecta confidencialidad de datos de inventario entre tenants.

---

## Flujo 2 — GS1 Devoluciones {#flujo-2}

### 2.1 Resumen ejecutivo

`/gs1/devoluciones` es un **Server Component wrapper** que delega a `DevolucionesView` (cliente) no incluida en el scope de archivos proporcionados. El router asociado es `gs1-proceso-f.router.ts`. La página de entrada no tiene lógica propia.

### 2.2 Archivos auditados

- `apps/web/src/app/(admin)/gs1/devoluciones/page.tsx`

### 2.3 Hallazgos

#### HI-03 — C1 — Devoluciones: componente `DevolucionesView` no auditado — schema drift potencial (P3 INFORMATIVO)

**Descripción:** La página delega a `"./_components/devoluciones-view"`. No fue incluido en el scope de archivos del encargo. La auditoría no cubre este componente. El router `gs1ProcesoF` no fue incluido en los archivos de scope.

**Recomendación:** Incluir `devoluciones-view.tsx` y `gs1-proceso-f.router.ts` en auditoría posterior (Stream J si se planifica).
**Riesgo go-live:** Desconocido — pendiente de auditoría de componente hijo.

---

## Flujo 3 — GS1 GLN {#flujo-3}

### 3.1 Resumen ejecutivo

`/gs1/gln` implementa US.F2.6.3: árbol jerárquico de ubicaciones GLN (almacén→farmacia→servicio→cama) con panel de detalle y diálogo `GlnForm`. La UI usa `"use client"`, maneja selección de nodo, y llama `trpc.gs1GlnHierarchy.tree.useQuery`. El formulario de alta se delega a `GlnForm` (componente hijo no incluido en scope).

### 3.2 Archivos auditados

- `apps/web/src/app/(admin)/gs1/gln/page.tsx`
- `packages/trpc/src/routers/gs1-gln-hierarchy.router.ts`

### 3.3 Hallazgos

#### HI-04 — C1 — GLN: panel de detalle sin botón de edición/inactivación (P2 MEDIA)

**Descripción:** El panel derecho muestra `codigo`, `descripcion`, `tipo`, `nivel`, `activo` y un botón "Agregar sub-ubicación". No existe botón para editar el nodo seleccionado ni para inactivarlo (`activo → false`). GS1 GS1-417 requiere que los GLN puedan ser desactivados con registro de motivo.

**Líneas afectadas:** `apps/web/src/app/(admin)/gs1/gln/page.tsx:87-147`
**Recomendación:** Agregar botón "Editar" que abra `GlnForm` en modo edición y botón "Inactivar" que llame al procedure correspondiente.
**Riesgo go-live:** Medio. Sin inactivación de GLN el catálogo crece sin control y puede causar errores logísticos al reasignar espacios físicos.

#### HI-05 — C7 — GLN: `GlnForm` no auditado — falta de validación GS1 check-digit en formulario de alta (P2 MEDIA)

**Descripción:** El componente `GlnForm` que procesa el alta de nuevos GLN no fue incluido en el scope de archivos. No es posible confirmar si el campo `codigo` tiene validación GS1 Módulo-10 en el cliente. El router `gs1GlnHierarchy` aplica validación en el servidor (verificable en tests), pero la ausencia de validación client-side implica que el usuario puede recibir errores de servidor sin feedback previo.

**Recomendación:** Verificar que `GlnForm` aplique `.refine(gs1CheckDigitValid)` en el schema Zod del formulario (mismo patrón de `gs1-medication.router.ts:40-44`).
**Riesgo go-live:** Bajo-Medio. Funcional pero UX degradada.

---

## Flujo 4 — GS1 Inbound {#flujo-4}

### 4.1 Resumen ejecutivo

`/gs1/inbound` implementa el Proceso A completo: registro de recepción de pallets con SSCC + productos (GTIN+lote+vencimiento) + verificación de 5 correctos + acción de verificar/rechazar sobre recepciones pendientes. Usa `react-hook-form` + `zodResolver` con el schema `recibirMercanciaInput` importado de `@his/contracts`. El router `gs1ProcesoARouter` opera sobre `ece.recepcion_mercancia` con `$queryRaw` / `$queryRawUnsafe`.

### 4.2 Archivos auditados

- `apps/web/src/app/(admin)/gs1/inbound/page.tsx`
- `packages/trpc/src/routers/gs1-proceso-a.router.ts`

### 4.3 Matriz de trazabilidad

| # | Campo UI | Payload tRPC | Prop Zod | Columna DB | Tipo UI | Tipo Zod | Tipo SQL | Observación |
|---|---|---|---|---|---|---|---|---|
| 1 | `numero_documento_recepcion` | `numero_documento_recepcion` | `z.string()` (via `recibirMercanciaInput`) | `numero_documento_recepcion text` | text | string | text | Alineado. |
| 2 | `proveedor_gln` | `proveedor_gln` | `z.string().length(13)` (contrato) | `proveedor_gln text` | text | string 13 | text | UI: `maxLength={13}` correcto. |
| 3 | `sscc_pallet` | `sscc_pallet` | `z.string().length(18).optional()` | `sscc_pallet text` | text | string 18 opt | text | **C7**: sin validación GS1 check-digit en UI (solo maxLength). El router no valida check-digit SSCC-18. |
| 4 | `productos[].gtin` | `gtin` | `z.string().length(14)` (contrato) | `productos jsonb` | text maxLength 14 | string 14 | jsonb | **C7**: sin validación GS1 Módulo-10 en UI ni en este router (ver HI-08). Medication router sí valida. |
| 5 | `productos[].expiry` | `expiry` | `z.string()` (contrato) | `productos jsonb (expiry)` | `type="date"` | string | jsonb text | **C4**: campo `type="date"` + Zod string. No hay conversión `new Date()` — se envía como string ISO. Sin riesgo de TZ shift. Bien. |
| 6 | `verificacion_5correctos` | `verificacion_5correctos` | `z.object({...boolean})` | `verificacion_5correctos jsonb` | checkboxes | object booleans | jsonb | `paciente_n_a`, `dosis_n_a`, `via_n_a`, `hora_n_a` se pre-marcan como `true` hardcodeado en la UI. |
| 7 | `establecimiento_id` | `establecimiento_id` | `z.string().uuid()` | `establecimiento_id uuid` | text libre | uuid | uuid | **C1**: UI pide UUID crudo al usuario. Sin selector de establecimiento del tenant. |
| 8 | `registrado_por` | `registrado_por` | `z.string().uuid()` | `registrado_por uuid` | text libre | uuid | uuid | **C1**: UI pide UUID crudo de personal. Sin integración con sesión. |

### 4.4 Hallazgos

#### HI-06 — C1/C8 — Inbound: `establecimiento_id` y `registrado_por` se ingresan como UUID libre (P1 ALTA)

**Descripción:** El bloque "Contexto ECE" en `page.tsx:247-272` pide al operador que ingrese manualmente el UUID del establecimiento y el UUID del personal de salud. El comentario en el código dice "temporal hasta que se integre con el contexto ECE real". En producción, si un operador ingresa un UUID de otro establecimiento, las recepciones quedarán mal atribuidas en `ece.recepcion_mercancia`, rompiendo la trazabilidad GS1.

**Líneas afectadas:** `apps/web/src/app/(admin)/gs1/inbound/page.tsx:141-142,253-270`
**Recomendación:** Reemplazar los inputs libres con valores del `ctx.tenant` (establecimiento del tenant activo) y `ctx.user.id` (usuario autenticado). En el router: `input.establecimiento_id` ya existe — el contexto de sesión debería proveerlo automáticamente, no el usuario.
**Riesgo go-live:** Alto. Produce datos de trazabilidad incorrectos desde el primer día operativo.

#### HI-07 — C7 — Inbound: SQL injection potencial en `listar` via `$queryRawUnsafe` con interpolación de estado (P0 BLOQUEANTE)

**Descripción:** El procedure `listar` en `gs1-proceso-a.router.ts:193-220` construye el filtro de estado así:

```ts
const estadoFilter = input.estado
  ? `AND estado = '${input.estado}'`
  : "";
// ...
await ctx.prisma.$queryRawUnsafe<...>(
  `SELECT ... FROM ece.recepcion_mercancia
   WHERE establecimiento_id = $1::uuid ${estadoFilter}
   ORDER BY ...`,
  input.establecimiento_id, input.limit, input.offset,
);
```

`input.estado` se interpola directamente en el string SQL sin parametrización. Si bien el schema Zod `listarRecepcionesInput` restringe el enum a valores conocidos (`pendiente|verificado|rechazado`), la ausencia de parametrización crea un riesgo de inyección si el contrato es relajado en el futuro o si el Zod está incompleto. El patrón correcto es usar un parámetro posicional `$4` para el estado.

**Líneas afectadas:** `packages/trpc/src/routers/gs1-proceso-a.router.ts:189-217`
**Recomendación:** Mover `estado` a un parámetro posicional:

```ts
const params: unknown[] = [input.establecimiento_id, input.limit, input.offset];
let idx = 4;
const estadoFilter = input.estado ? `AND estado = $${idx++}` : "";
if (input.estado) params.splice(3, 0, input.estado); // antes de limit/offset
```

O simplemente construir la query con el estado como parámetro posicional separado.
**Riesgo go-live:** P0 — aunque el enum Zod mitiga el riesgo actual, el patrón es incorrecto y constituye una vulnerabilidad latente. Precedente negativo para otros desarrolladores que copien el patrón.

#### HI-08 — C7 — Inbound: GTIN-14 sin validación check-digit en el Proceso A (P1 ALTA)

**Descripción:** El router `gs1ProcesoARouter.recibirMercancia` acepta GTINs en `input.productos[].gtin` como strings sin verificar el dígito GS1 Módulo-10. El contrato `recibirMercanciaInput` solo valida longitud. En contraste, `gs1-medication.router.ts:29-44` sí implementa `gs1CheckDigitValid`. Esta inconsistencia permite registrar GTINs con dígito verificador inválido en `ece.recepcion_mercancia.productos` (JSONB), contaminando el inventario desde el origen.

**Líneas afectadas:** `packages/trpc/src/routers/gs1-proceso-a.router.ts:46-99`, `packages/contracts/src/schemas/gs1.ts` (schema del contrato)
**Recomendación:** Añadir validación check-digit al schema Zod del contrato `recibirMercanciaInput.productos[].gtin` usando el mismo helper `gs1CheckDigitValid`. Aplicar también al SSCC-18 en `sscc_pallet`. Esto requiere que el helper esté en `@his/contracts` (actualmente vive en el router de medicamentos — extraer a `packages/contracts/src/validators/gs1.ts`).
**Riesgo go-live:** Alto. GS1 §7.4 (GS1 General Specifications) requiere verificación del dígito en todo punto de lectura/escritura.

#### HI-09 — C7 — Inbound: sin validación de no-negatividad en `cantidad` de productos (P2 MEDIA)

**Descripción:** `productos[].cantidad` usa `{ valueAsNumber: true }` en el input number, con `min={1}` en HTML. Sin embargo, el schema Zod del contrato `recibirMercanciaInput` no verifica `.positive()` ni `.min(1)`. Si el usuario manipula el DOM o envía la petición directamente, puede ingresar cantidad 0 o negativa, creando un movimiento de inventario incorrecto en `ece.recepcion_mercancia.productos`.

**Líneas afectadas:** `apps/web/src/app/(admin)/gs1/inbound/page.tsx:84-87`, schema del contrato.
**Recomendación:** Agregar `.min(1)` o `.positive()` al schema Zod de `cantidad` en `recibirMercanciaInput`.
**Riesgo go-live:** Medio. La validación HTML puede ser bypasseada.

---

## Flujo 5 — GS1 Lote detail {#flujo-5}

### 5.1 Resumen ejecutivo

`/gs1/lote/[lote]` muestra la trazabilidad GS1-128 de un lote: timeline (recepción→almacenamiento→unidosis→dispensación→administración→paciente), pacientes afectados (solo MRN), y botón "Iniciar recall". **El módulo opera exclusivamente con datos de demostración (`buildDemoData`)**: no hay llamada a `trpc.gs1.loteTrace` porque el router no existe (la UI tiene un TODO). El botón "Iniciar recall" también es un stub con `setTimeout`.

### 5.2 Archivos auditados

- `apps/web/src/app/(admin)/gs1/lote/[lote]/page.tsx`

### 5.3 Hallazgos

#### HI-10 — C1 — Lote detail: módulo completo opera con datos hardcodeados — router `gs1.loteTrace` no existe (P0 BLOQUEANTE)

**Descripción:** La página `LotTracePage` usa datos de demostración (`buildDemoData(lotNumber)`) en lugar de `trpc.gs1.loteTrace.useQuery({ lotNumber })`. El router `gs1.loteTrace` no existe en `packages/trpc/src/routers/`. El botón "Iniciar recall" llama `setTimeout(() => setRecallDone(true), 800)` sin mutar ningún dato en la BD.

**Consecuencia directa:** El módulo de trazabilidad de lotes — que es el punto de entrada para el flujo de recall GS1 (obligatorio RTCA) — no tiene ninguna funcionalidad real. En producción, un operador que busque el lote `XYZ-001` siempre verá los mismos datos de demostración de Amoxicilina 500mg, y un recall "iniciado" desde la UI no tendrá ningún efecto en la BD.

**Líneas afectadas:** `apps/web/src/app/(admin)/gs1/lote/[lote]/page.tsx:53-105`
**Recomendación:** Implementar `packages/trpc/src/routers/gs1-lote-trace.router.ts` con:
- `loteTrace` query: busca en `ece.recepcion_mercancia.productos` (JSONB) por número de lote, cruza con `ece.gs1_gtin`, cruza eventos EPCIS en `ece.epcis_event`.
- `initiateRecall` mutation: marca el lote como recall en `ece.gs1_gtin.recall_status` y emite evento de dominio `gs1.recall.iniciado`.
**Riesgo go-live:** P0. Módulo no funcional — viola TDR §19 y GS1 recall traceability.

#### HI-11 — C3 — Lote detail: RBAC del botón "Iniciar recall" no se verifica (P1 ALTA)

**Descripción:** El comentario del botón `aria-label` indica "requiere autorización DIR". Sin embargo, no hay verificación de rol en la UI ni existe el procedure de servidor. Cuando se implemente el router, el control de acceso debe implementarse con `requireRole(["DIRECTOR"])` o equivalente.

**Líneas afectadas:** `apps/web/src/app/(admin)/gs1/lote/[lote]/page.tsx:119-136`
**Recomendación:** Al implementar el router, usar `requireRole(["ADMIN", "DIRECTOR", "PHARM"])`. En UI: no mostrar el botón si el usuario no tiene el rol.
**Riesgo go-live:** Alto (cuando se implemente). Sin control de acceso, cualquier usuario del tenant puede iniciar un recall.

---

## Flujo 6 — GS1 Medicamentos {#flujo-6}

### 6.1 Resumen ejecutivo

`/gs1/medicamentos` implementa US.F2.6.4: catálogo GTIN con filtros de recall y vencimiento. El router `gs1MedicationRouter` tiene la implementación más robusta de todo el módulo GS1: validación GS1 Módulo-10 para GTIN-14, `withTenantContext` en mutaciones, `requireRole` para operaciones sensibles. `MedicationForm` usa Zod safeParse manual (sin react-hook-form) de forma correcta.

### 6.2 Archivos auditados

- `apps/web/src/app/(admin)/gs1/medicamentos/page.tsx`
- `apps/web/src/app/(admin)/gs1/medicamentos/_components/medication-form.tsx`
- `packages/trpc/src/routers/gs1-medication.router.ts`

### 6.3 Matriz de trazabilidad

| # | Campo UI | Payload tRPC | Prop Zod | Tipo UI | Tipo Zod | Observación |
|---|---|---|---|---|---|---|
| 1 | GTIN-14 `codigo` | output (solo lectura) | — | font-mono | — | Solo display. Sin edición de código — correcto (GTIN es inmutable). |
| 2 | `descripcion` | `descripcion` | `z.string().min(1).max(500)` | text | string 1-500 | Alineado. |
| 3 | `fabricante` | `fabricante` | `z.string().min(1).max(300)` | text | string 1-300 | Alineado. |
| 4 | `codigoAtc` | `codigoAtc` | `z.string().regex(/^[A-Z]\d{2}[A-Z]{2}\d{2}$/).optional()` | text + .or(z.literal("")) | regex | **C7 menor**: regex ATC `[A-Z]\d{2}[A-Z]{2}\d{2}` (7 chars) vs WHO ATC que puede ser hasta 7 chars. Correcto para nivel 5 ATC. |
| 5 | `loteVencimiento` | `loteVencimiento` | `z.string().optional()` → `.datetime({offset:true})` en router | `type="date"` | string → ISO string | **C4**: formulario envía string ISO de date input. Router recibe `z.string().datetime({offset:true})` pero el cliente envía `"2026-03-31"` (sin time). Mismatch Zod: `datetime({offset:true})` rechaza strings sin tiempo. Ver HI-12. |
| 6 | `principiosActivos` (array) | `principiosActivos` | `z.array(z.string().min(1).max(200))` | StringArrayEditor | array strings | Alineado. `.filter(Boolean)` antes del mutate evita strings vacíos. |
| 7 | `excipientesAlergenos` (array) | `excipientesAlergenos` | `z.array(z.string().min(1).max(200))` | StringArrayEditor | array strings | Alineado. |
| 8 | `recallStatus` | `status` (markRecall) | `recallStatusEnum.exclude(["NONE"])` | Badge readonly | enum | Solo ADMIN. Correcto. |

### 6.4 Hallazgos

#### HI-12 — C5 — MedicationForm: `loteVencimiento` falla validación Zod en servidor (P1 ALTA)

**Descripción:** `MedicationForm` envía `loteVencimiento` como:

```ts
loteVencimiento: parsed.data.loteVencimiento
  ? new Date(parsed.data.loteVencimiento).toISOString()
  : undefined
```

Esto convierte `"2026-03-31"` en `"2026-03-31T06:00:00.000Z"` (UTC+0 de un browser UTC-6), que sí cumple `z.string().datetime({offset:true})`. Sin embargo, hay un riesgo oculto: el `new Date("YYYY-MM-DD")` en el browser UTC-6 (America/El_Salvador) produce `"2026-03-30T18:00:00.000Z"` (1 día antes). La fecha guardada en BD es la del día anterior.

**Líneas afectadas:** `apps/web/src/app/(admin)/gs1/medicamentos/_components/medication-form.tsx:211-213`
**Recomendación:** Enviar la fecha de vencimiento de lote como string puro `"YYYY-MM-DD"` sin convertir a `Date`. En el router, aceptar con `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)` y castear con `::date` en PostgreSQL. Mismo patrón del hallazgo H1-03 del Stream A (birthDate).
**Riesgo go-live:** Alto. Fechas de vencimiento de medicamentos incorrectas generan alertas desalineadas con la fecha real.

#### HI-13 — C9 — Medicamentos: tabla `ece.gs1_gtin_sustitutos` referenciada en router pero no existe en BD (P0 BLOQUEANTE)

**Descripción:** El procedure `gs1MedicationRouter.linkSubstitute` hace:

```ts
await tx.$executeRawUnsafe(
  `INSERT INTO ece.gs1_gtin_sustitutos (gtin_a_id, gtin_b_id, autorizada) VALUES ...`,
  ...
);
```

La tabla `ece.gs1_gtin_sustitutos` **no existe en ningún archivo SQL** del directorio `packages/database/sql/`. La búsqueda en el repo (ruta `packages/database/sql/**`) no devuelve ninguna coincidencia para este nombre. El router incluye el comentario: "Si no existe, la mutación falla con 42P01". Esto es un schema drift activo: el procedure `linkSubstitute` fallará con `relation "ece.gs1_gtin_sustitutos" does not exist` en producción.

**Líneas afectadas:** `packages/trpc/src/routers/gs1-medication.router.ts:262-279`
**Recomendación:** Crear el DDL de la tabla en `packages/database/sql/95_gs1_gtin_sustitutos.sql`:
```sql
CREATE TABLE IF NOT EXISTS ece.gs1_gtin_sustitutos (
  gtin_a_id     uuid NOT NULL REFERENCES ece.gs1_gtin(id),
  gtin_b_id     uuid NOT NULL REFERENCES ece.gs1_gtin(id),
  autorizada    boolean NOT NULL DEFAULT false,
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_gtin_sustitutos PRIMARY KEY (gtin_a_id, gtin_b_id),
  CONSTRAINT chk_gtin_sustitutos_distinct CHECK (gtin_a_id <> gtin_b_id)
);
```
**Riesgo go-live:** P0 — `linkSubstitute` falla en producción con error 42P01. El módulo de sustituciones de medicamentos no es operable.

#### HI-14 — C7 — Medicamentos: `gs1Medication.list` y `gs1Medication.get` sin `withTenantContext` (P1 ALTA)

**Descripción:** Las queries de lectura `list` y `get` usan `ctx.prisma.$queryRawUnsafe` directo sobre `ece.gs1_gtin` sin `withTenantContext`. Si la tabla tiene RLS policies con `organization_id`, el rol `postgres.<ref>` las bypasea (BYPASSRLS). Si la tabla es un catálogo global (sin org segregation), no hay problema. El router reconoce explícitamente esta inconsistencia en el comentario ("si esas columnas no existen aún en la BD..."). Sin conocer el DDL de `ece.gs1_gtin` es imposible confirmar si hay segregación por org — pero el patrón es riesgoso.

**Líneas afectadas:** `packages/trpc/src/routers/gs1-medication.router.ts:108-165`
**Recomendación:** Verificar el DDL de `ece.gs1_gtin`. Si tiene `organization_id`, envolver las queries en `withTenantContext` o agregar `WHERE organization_id = ${ctx.tenant.organizationId}::uuid`. Si es catálogo global compartido, documentar explícitamente.
**Riesgo go-live:** Medio (pendiente confirmación del DDL).

---

## Flujo 7 — GS1 Transfers {#flujo-7}

### 7.1 Resumen ejecutivo

`/gs1/transfers` muestra lista de transferencias con tabs (en_tránsito / programadas). `/gs1/transfers/nueva` implementa creación con escáner GS1 simulado (input HID). El router `gs1ProcesoB` maneja los estados: `programado → en_transito → recibido | rechazado` con emisión de eventos de dominio.

### 7.2 Archivos auditados

- `apps/web/src/app/(admin)/gs1/transfers/page.tsx`
- `apps/web/src/app/(admin)/gs1/transfers/nueva/page.tsx`
- `packages/trpc/src/routers/gs1-proceso-b.router.ts` (parcial — primeros 60 líneas)

### 7.3 Hallazgos

#### HI-15 — C7 — Transfers: validación GLN en `nueva` page solo es formato HTML (P2 MEDIA)

**Descripción:** Los campos `origen-gln` y `destino-gln` en `NuevaTransferenciaPage` tienen `pattern="\d{13}"` y `maxLength={13}` en HTML, pero no validan dígito GS1 Módulo-10 en el cliente. El router `gs1ProcesoB.enviarTransferencia` valida longitud pero no check-digit (la validación en `enviarTransferenciaInput` usa `z.string().min(13).max(13)` — ver línea 34-37 del router).

**Líneas afectadas:** `apps/web/src/app/(admin)/gs1/transfers/nueva/page.tsx:238-262`, `packages/trpc/src/routers/gs1-proceso-b.router.ts:34-37`
**Recomendación:** Aplicar el mismo helper `gs1CheckDigitValid` al schema Zod de GLN (13 dígitos). GS1 GLN-13 usa Módulo-10 igual que GTIN-14.
**Riesgo go-live:** Medio. Permite registrar transferencias a GLN inválidos.

#### HI-16 — C4 — Transfers: `fechaVencimiento` de productos como string raw sin validación de fecha futura (P2 MEDIA)

**Descripción:** En `NuevaTransferenciaPage`, `fechaVencimiento` de cada producto se envía como string `"YYYY-MM-DD"` a `gs1ProcesoB.enviarTransferencia`. El schema `productoTransferenciaSchema` valida el formato regex `^\d{4}-\d{2}-\d{2}$` (correcto) pero no valida que la fecha sea futura (no se puede transferir un medicamento ya vencido). El router tampoco verifica que `fechaVencimiento >= today`.

**Líneas afectadas:** `packages/trpc/src/routers/gs1-proceso-b.router.ts:28-33`
**Recomendación:** Agregar `.refine(d => new Date(d) > new Date(), "Fecha vencimiento debe ser futura")` al schema del contrato. Complementar con CHECK constraint en BD si `fechaVencimiento` se persiste en columna tipada.
**Riesgo go-live:** Medio. Permite registrar transferencias de medicamentos vencidos.

#### HI-17 — C1 — Transfers lista: `productos` tipado como `unknown` con acceso sin guardia (P2 MEDIA)

**Descripción:** En `transfers/page.tsx:45` el tipo `TransferenciaRow.productos` es `unknown`. La función `cantidadProductos` aplica guardia correcta (`Array.isArray` + `typeof`). Sin embargo, el tipo `unknown` en la interfaz indica schema drift: el router devuelve el campo JSONB de PostgreSQL sin tipar fuertemente. Si el schema de productos cambia en el router del Proceso A (donde se origina), la función `cantidadProductos` puede calcular 0 sin error visible.

**Líneas afectadas:** `apps/web/src/app/(admin)/gs1/transfers/page.tsx:45,74-83`
**Recomendación:** Definir un tipo explícito `ProductoTransferencia` con `gtin`, `cantidad`, etc. y usar `z.array(productoTransferenciaSchema).parse()` en el mapper del router para garantizar el tipo en tiempo de ejecución.
**Riesgo go-live:** Bajo. Funcional en el estado actual, pero frágil ante cambios de schema.

---

## Flujo 8 — GS1 Trazabilidad {#flujo-8}

### 8.1 Resumen ejecutivo

`/gs1/trazabilidad` implementa consultas EPCIS con 3 modos de búsqueda (por GLN, por equipo UUID, origen→destino). El comentario de la página aclara que el schema `ece.epcis_event` es legacy de movimientos de equipos, **sin GTIN/lote/GSRN de paciente**. Usa `trpc.epcisQuery.*` que existe en el router. La UI es correcta: on-demand query (no autoFetch), reset de estado al cambiar modo.

### 8.2 Archivos auditados

- `apps/web/src/app/(admin)/gs1/trazabilidad/page.tsx`
- `packages/trpc/src/routers/epcis-query.router.ts`

### 8.3 Hallazgos

#### HI-18 — C1 — Trazabilidad: scope EPCIS limitado a movimientos de equipos — sin trazabilidad GS1 de medicamentos (P1 ALTA)

**Descripción:** La tabla `ece.epcis_event` que subyace a este módulo tiene schema de movimiento de equipos (`equipment_id`, `gln_destino`, `gln_origen`). La trazabilidad de medicamentos GS1 (GTIN+lote → dispensación → administración → paciente) **no existe** en esta tabla. El router `farmacovigilanciaRouter.recallImpact` consulta `ece.gs1_epcis_event` (tabla diferente, probablemente inexistente — ver HI-21). En consecuencia, el módulo de trazabilidad de la UI cubre únicamente activos fijos (equipos), no el flujo completo GS1 de medicamentos.

**Líneas afectadas:** `apps/web/src/app/(admin)/gs1/trazabilidad/page.tsx:8-13`, `packages/trpc/src/routers/epcis-query.router.ts`
**Recomendación:** Implementar tabla `ece.gs1_epcis_event` diferenciada de `ece.epcis_event` con campos GS1 estándar (`what.gtin`, `what.lote`, `who.gsrn`, `where.gln_origen/destino`, `why.disposition`). Actualizar la UI de Trazabilidad para incluir modo de búsqueda por GTIN+lote. Ver también HI-21.
**Riesgo go-live:** Alto. El módulo de trazabilidad GS1 de medicamentos no está implementado, incumpliendo GS1 EPCIS 1.2 requerido por TDR §19.

#### HI-19 — C4 — Trazabilidad: `fechaDesde`/`fechaHasta` como `new Date(string)` desde input datetime-local (P2 MEDIA)

**Descripción:** En `trazabilidad/page.tsx:77-79`:

```ts
const commonDateRange = {
  fechaDesde: fechaDesde ? new Date(fechaDesde) : undefined,
  fechaHasta: fechaHasta ? new Date(fechaHasta) : undefined,
};
```

`fechaDesde` viene de `<Input type="datetime-local">` como `"2026-05-01T08:00"` (sin timezone). `new Date("2026-05-01T08:00")` en browser UTC-6 produce `2026-05-01T14:00:00Z`. El servidor interpreta como UTC. El rango de búsqueda queda desplazado 6 horas respecto a la intención del usuario.

**Líneas afectadas:** `apps/web/src/app/(admin)/gs1/trazabilidad/page.tsx:77-79`
**Recomendación:** Convertir a string con timezone explícito antes de enviar: `new Date(fechaDesde).toISOString()` — o mejor, construir la fecha con `"${fechaDesde}:00-06:00"` para forzar el offset de El Salvador. Ver patrón de `parseDateOnly` mencionado en el TDR.
**Riesgo go-live:** Medio. Rango de búsqueda temporal incorrecto puede omitir o incluir eventos fuera del rango deseado.

---

## Flujo 9 — Staff GSRN {#flujo-9}

### 9.1 Resumen ejecutivo

`/staff-gsrn` implementa US.F2.6.2: catálogo de GSRN profesionales con alta, revocación, validación de badge y generación de payload DataMatrix. El router `staffGsrnRouter` es el más completo del módulo GS1: valida GSRN-18 con Módulo-10, genera el código automáticamente, implementa hard-stop para GSRN revocados, y produce el payload GS1 `(8018)GSRN-18` para DataMatrix.

### 9.2 Archivos auditados

- `apps/web/src/app/(admin)/staff-gsrn/page.tsx`
- `packages/trpc/src/routers/staff-gsrn.router.ts`

### 9.3 Hallazgos

#### HI-20 — C3 — Staff GSRN: función `generateGsrn` usa `Math.random()` — no criptográficamente seguro (P1 ALTA)

**Descripción:** `generateGsrn()` en `staff-gsrn.router.ts:37-50` genera la parte aleatoria del GSRN usando `Math.random()`:

```ts
const random5 = Math.floor(Math.random() * 100000)
  .toString()
  .padStart(5, "0");
```

`Math.random()` no es criptográficamente seguro (PRNG). En un contexto de identificadores de personal médico (AI 8018), la predecibilidad del GSRN generado puede permitir enumeración de badges válidos. GS1 no exige que la parte de referencia sea impredecible, pero las mejores prácticas de seguridad para identificadores de autenticación lo recomiendan.

**Líneas afectadas:** `packages/trpc/src/routers/staff-gsrn.router.ts:37-50`
**Recomendación:** Reemplazar con `crypto.getRandomValues(new Uint32Array(1))[0] % 100000` (ya disponible en Node 19+) o usar `randomInt` de la librería `crypto` ya importada en el codebase (`import { randomUUID } from "crypto"` en inventory.router.ts).
**Riesgo go-live:** Bajo-Medio. No bloquea go-live, pero es una deuda de seguridad en identificadores institucionales.

#### HI-21 — C3/C8 — Staff GSRN: `revoke` silencia el error de columna `motivo_revocacion` faltante (P2 MEDIA)

**Descripción:** En `staffGsrnRouter.revoke` (líneas 222-232):

```ts
try {
  await ctx.prisma.$executeRawUnsafe(
    `UPDATE ece.gs1_gsrn SET motivo_revocacion = $1 WHERE id = $2::uuid`,
    ...
  );
} catch {
  // columna opcional — no bloquear si no existe en esta versión del schema
}
```

El motivo de revocación (dato de compliance) se pierde silenciosamente si la columna no existe en la BD. El catch vacío enmascara el error. No hay log ni alerta. El audit trail solo queda en `audit_log` vía trigger, pero sin el campo `motivo_revocacion` el registro es incompleto.

**Líneas afectadas:** `packages/trpc/src/routers/staff-gsrn.router.ts:222-232`
**Recomendación:** Agregar `console.error` o mejor `ctx.logger.warn` en el catch. Crear la migración que añade `motivo_revocacion text` a `ece.gs1_gsrn`. Alternativamente, si el log de audit ya captura el payload completo del UPDATE, documentar que el motivo está en audit_log.
**Riesgo go-live:** Medio. Compliance de revocación de credenciales requiere motivo documentado.

#### HI-22 — C3 — Staff GSRN: sin CHECK constraint GSRN-18 en BD (P1 ALTA)

**Descripción:** El router `staffGsrnRouter.create` valida el GSRN con el schema Zod `gsrnSchema` (longitud 18, regex numérico, dígito GS1). Sin embargo, no hay evidencia de un CHECK constraint correspondiente en `ece.gs1_gsrn` (`CHECK (codigo ~ '^\d{18}$')`). Si se insertan GSRNs directamente en la BD (backfill, seed, migración manual), pueden registrarse códigos inválidos que luego producen errores en la validación de badges.

**Recomendación:** Agregar en el DDL de `ece.gs1_gsrn`:
```sql
ALTER TABLE ece.gs1_gsrn
  ADD CONSTRAINT chk_gsrn_formato
  CHECK (codigo ~ '^\d{18}$' AND length(codigo) = 18);
```
**Riesgo go-live:** Medio. Sin el constraint, los datos de BD no están protegidos de escritura directa.

---

## Flujo 10 — Farmacovigilancia {#flujo-10}

### 10.1 Resumen ejecutivo

`/farmacovigilancia` implementa US.F2.6.56: tabla de incidentes de seguridad farmacéutica con filtros y reconocimiento. El router `farmacovigilanciaRouter` tiene procedures `list`, `get`, `create`, `acknowledge`, `escalate`, `summary` y `recallImpact`. La UI es correcta: filtros por estado y severidad, acción "Reconocer" por incidente, contadores en tiempo real.

### 10.2 Archivos auditados

- `apps/web/src/app/(admin)/farmacovigilancia/page.tsx`
- `packages/trpc/src/routers/farmacovigilancia.router.ts`

### 10.3 Hallazgos

#### HI-23 — C6 — Farmacovigilancia: `create` y `acknowledge` sin `withTenantContext` — RLS bypass en mutaciones (P0 BLOQUEANTE)

**Descripción:** Los procedures `create` y `acknowledge` (y `escalate`) ejecutan `$queryRawUnsafe` y `$executeRawUnsafe` directamente sobre `ece.farmacovigilancia_incident` **sin** `withTenantContext`. El rol `postgres.<ref>` tiene `BYPASSRLS`. Si la tabla tiene RLS policies basadas en `organization_id`, estas queries las saltan. En particular:

- `create` (línea 186-202): inserta sin `withTenantContext`. Usa `ctx.tenant.organizationId` en el valor de `establecimiento_id` — la defensa es la columna, no el modo del rol.
- `acknowledge` (línea 211-233): `SELECT status` y `UPDATE` sobre `ece.farmacovigilancia_incident` sin filtro de organización en la query SELECT. Un farmacéutico de org A podría reconocer un incidente de org B si conoce el UUID.

**Líneas afectadas:** `packages/trpc/src/routers/farmacovigilancia.router.ts:182-235`
**Recomendación:** Envolver mutaciones en `withTenantContext`. Agregar `AND establecimiento_id = ${ctx.tenant.organizationId}::uuid` al SELECT de `acknowledge` y `escalate`.
**Riesgo go-live:** P0 — cross-tenant acknowledge de incidentes farmacéuticos viola multi-tenancy. Es una vulnerabilidad de seguridad.

#### HI-24 — C1 — Farmacovigilancia: `escalate` tiene `$transaction` vacío — evento de dominio nunca se emite (P1 ALTA)

**Descripción:** El procedure `escalate` en `farmacovigilancia.router.ts:257-273`:

```ts
await ctx.prisma.$transaction(async (tx) => {
  await tx.$executeRawUnsafe(
    `UPDATE ece.farmacovigilancia_incident SET status = 'ESCALADO' ...`,
    ...
  );
  // TODO: US.F2.6.58 — eventType propio "farmacovigilancia.escalado"
});
```

El `$transaction` actualiza el estado pero **no emite el evento de dominio**. El comentario TODO indica que se planeó pero no se implementó. El resultado: al escalar un incidente, el Comité de Farmacovigilancia no recibe notificación (Beta.15 no se activa), violando el flujo US.F2.6.57.

**Líneas afectadas:** `packages/trpc/src/routers/farmacovigilancia.router.ts:255-275`
**Recomendación:** Implementar `emitDomainEvent(tx, { eventType: "farmacovigilancia.escalado", ... })` dentro del `$transaction`, usando el `emitDomainEvent` ya importado.
**Riesgo go-live:** Alto. El flujo de escalación no notifica al receptor designado.

#### HI-25 — C9 — Farmacovigilancia: tabla `ece.gs1_epcis_event` referenciada en `recallImpact` — potencialmente inexistente (P0 BLOQUEANTE)

**Descripción:** El procedure `recallImpact` (línea 321) consulta `ece.gs1_epcis_event`:

```sql
SELECT id, event_time, who, where_data, subtipo
FROM ece.gs1_epcis_event
WHERE what->>'gtin' = $1 AND what->>'lote' = $2 ...
```

La tabla `ece.gs1_epcis_event` **no aparece en ningún archivo SQL del directorio `packages/database/sql/`**. La tabla que sí existe (según el módulo de Trazabilidad) es `ece.epcis_event` (movimientos de equipos, sin campos GTIN/lote). `ece.gs1_epcis_event` es una tabla diferente con schema EPCIS GS1 completo que nunca fue creada.

**Consecuencia:** `recallImpact` falla con error 42P01 en producción. La trazabilidad inversa de recall (GTIN+lote → pacientes afectados) no funciona.

**Líneas afectadas:** `packages/trpc/src/routers/farmacovigilancia.router.ts:320-346`
**Recomendación:** Crear la tabla `ece.gs1_epcis_event` con schema EPCIS GS1 (campos JSONB: `what`, `who`, `where_data`, `why`), o usar la tabla `ece.epcis_event` existente si se puede extender con los campos GS1 necesarios.
**Riesgo go-live:** P0 — `recallImpact` falla en producción. La trazabilidad de recall de lotes es obligatoria para la cadena de farmacovigilancia.

#### HI-26 — C3 — Farmacovigilancia: `summary` accesible desde UI con rol ANY (P2 MEDIA)

**Descripción:** El procedure `summary` usa `requireRole(["ADMIN", "PHARM", "DIRECTOR"])` — correcto para el servidor. Sin embargo, en la UI `FarmacovigilanciaPage`, `summaryQuery = trpc.farmacovigilancia.summary.useQuery()` se llama **incondicionalmente** desde la página que también está accesible a usuarios `NURSE` o `LOGISTIC` (no hay guardia de rol en la página). Si un usuario sin el rol accede, el query fallará con `FORBIDDEN` y la UI mostrará un error silencioso en el contador "Tipos".

**Líneas afectadas:** `apps/web/src/app/(admin)/farmacovigilancia/page.tsx:61`, `packages/trpc/src/routers/farmacovigilancia.router.ts:281-296`
**Recomendación:** Mover la query `summary` a una sección protegida por guardia de rol en la UI, o cambiar `requireRole` a `tenantProcedure` y aplicar el filtro de rol solo en el campo `total` (para no exponer datos sensibles). Alternativamente, que la UI solo llame `summary` si `ctx.user.roles.includes("PHARM" | "DIRECTOR")`.
**Riesgo go-live:** Bajo. El error es silencioso — no bloquea la funcionalidad principal.

---

## Flujo 11 — Inventory + Alertas {#flujo-11}

### 11.1 Resumen ejecutivo

`/inventory` (lista items), `/inventory/new` (crear item) y `/inventory/alertas` (alertas GS1 de stock y caducidad) implementan §19 del TDR. El router `inventoryRouter` es el más completo del módulo: movimientos append-only, cumplimiento FEFO, atomicidad de transferencias, alertas por threshold. Usa Prisma ORM (no raw SQL) para las tablas `StockItem`, `StockLot`, `StockMovement` — bien integrado con RLS a través del filtro `organizationId: ctx.tenant.organizationId`.

### 11.2 Archivos auditados

- `apps/web/src/app/(admin)/inventory/page.tsx`
- `apps/web/src/app/(admin)/inventory/alertas/page.tsx`
- `apps/web/src/app/(admin)/inventory/new/page.tsx`
- `packages/trpc/src/routers/inventory.router.ts`

### 11.3 Hallazgos

#### HI-27 — C3 — Inventory Alertas: `generarOrden` llama `alert()` nativo del browser (P1 ALTA)

**Descripción:** En `inventory/alertas/page.tsx:111`:

```ts
alert(`Orden de compra para: ${gtins}`);
```

Esta llamada usa el diálogo bloqueante nativo del navegador para una acción de negocio crítica (inicio de orden de compra). Es inaccesible (falla en navegadores sin UI nativa como JSDOM en tests), bloquea el event loop, y viola la guía UX del proyecto (los patrones anteriores usan `toast` o navegación a ruta).

**Líneas afectadas:** `apps/web/src/app/(admin)/inventory/alertas/page.tsx:111`
**Recomendación:** Reemplazar con navegación a `router.push("/compras/new?gtins=...")` o abrir un modal/toast con el resumen. El TODO indica que se conectará a §30 Compras — mientras tanto, al menos eliminar `alert()` y mostrar un mensaje en pantalla.
**Riesgo go-live:** Alto. Viola HH-11 pattern (uso de `alert()`/`prompt()` para auth o acciones de negocio). Bloqueante en entornos sin UI nativa (tests E2E).

#### HI-28 — C3 — Inventory Alertas: FEFO enforcement aplica solo a queries ORM — la lógica `listAlertas` usa loop N+1 (P2 MEDIA)

**Descripción:** El procedure `inventory.gs1.listAlertas` en `inventory.router.ts:582-595` ejecuta, por cada threshold:

```ts
for (const th of thresholds) {
  const items = await ctx.prisma.stockItem.findMany(...);
  const lots  = await ctx.prisma.stockLot.findMany(...);
  ...
}
```

Esto es un query N+1: si hay 100 thresholds configurados, se ejecutan 200 queries a Postgres en el mismo request HTTP. Con 10+ thresholds (caso real en farmacia), la latencia puede superar 5 segundos.

**Líneas afectadas:** `packages/trpc/src/routers/inventory.router.ts:582-699`
**Recomendación:** Reemplazar el loop con una query SQL única que haga el join entre `inventory_threshold`, `gs1_gtin`, `StockItem` (via `sku = gtin_codigo`), y `StockLot`. El comentario del código dice "el volumen es acotado (<10k filas)" pero no aborda la latencia del N+1.
**Riesgo go-live:** Medio. En producción con catálogos grandes, la página de Alertas puede timeout.

#### HI-29 — C6 — Inventory item.create: sin `withTenantContext` en mutación (P1 ALTA)

**Descripción:** `inventoryRouter.item.create` usa `ctx.prisma.stockItem.create(...)` directamente sin `withTenantContext`. El `organizationId` se asigna desde `ctx.tenant.organizationId` (defensa a nivel aplicación), pero el rol Prisma tiene `BYPASSRLS`. Si `StockItem` tiene RLS policies para INSERT (que limiten quién puede insertar items globales), estas se saltean.

Adicionalmente, `input.organizationId === null` permite crear items globales (catálogo compartido) desde la UI. Esta lógica debería estar restringida a `requireRole(["ADMIN"])`.

**Líneas afectadas:** `packages/trpc/src/routers/inventory.router.ts:65-85`
**Recomendación:** Envolver en `withTenantContext`. Agregar `requireRole(["ADMIN"])` para creación de items globales (`organizationId: null`).
**Riesgo go-live:** Medio. Sin `withTenantContext`, la creación de items globales queda fuera del scope RLS.

---

## Flujo 12 — Equipment {#flujo-12}

### 12.1 Resumen ejecutivo

`/equipment` lista equipos biomédicos con filtros por estado y búsqueda. El router `servicesEquipment.equipment.list` fue implementado en Wave 8. No se encontró el módulo `/equipment/cold-chain/` — la ruta no existe como archivo en el repo.

### 12.2 Archivos auditados

- `apps/web/src/app/(admin)/equipment/page.tsx`

### 12.3 Hallazgos

#### HI-30 — C1 — Equipment: ruta `/equipment/cold-chain/` no existe (P2 MEDIA)

**Descripción:** La UI no tiene la ruta `/equipment/cold-chain/` que fue mencionada en el scope del encargo. El archivo `apps/web/src/app/(admin)/equipment/cold-chain/page.tsx` no existe. Si el sidebar o el módulo de equipment referencia esta ruta, produce un error 404.

**Recomendación:** Verificar si el sidebar incluye el link a cold-chain. Si está enlazado, crear el stub con `getStaticProps: not-found` o implementar el módulo mínimo. Si no está enlazado, marcar como pendiente en el backlog.
**Riesgo go-live:** Bajo-Medio. Depende de si hay navegación enlazada.

#### HI-31 — C1 — Equipment: listado sin link a detalle — ruta `/equipment/[id]/` no auditada (P2 MEDIA)

**Descripción:** La tabla de equipos en `equipment/page.tsx` no tiene botón "Ver detalle" ni enlace a `/equipment/[id]/`. Los equipos se listan pero no hay navegación al detalle para ver PM (mantenimiento preventivo), calibraciones, e historial EPCIS. El scope indicaba auditar `/equipment/[id]/` pero el archivo no fue provisto.

**Líneas afectadas:** `apps/web/src/app/(admin)/equipment/page.tsx:120-148`
**Recomendación:** Agregar columna "Acciones" con botón `<Link href={/equipment/${e.id}}>` al igual que en el módulo Transfers.
**Riesgo go-live:** Medio. Sin acceso al detalle, la gestión de equipos biomédicos es incompleta.

---

## Resumen Consolidado Stream I {#resumen-consolidado}

### Tabla de hallazgos

| ID | Severidad | Módulo | Categoría | Título |
|---|---|---|---|---|
| HI-01 | P2 MEDIA | GS1 Dashboard | C5 | Comparación de vencimiento client-side ignora TZ El Salvador |
| HI-02 | P2 MEDIA | GS1 Dashboard | C7 | Queries rawUnsafe sin aislamiento RLS — conteos cross-tenant |
| HI-03 | P3 INFO | GS1 Devoluciones | C1 | `DevolucionesView` no auditado |
| HI-04 | P2 MEDIA | GS1 GLN | C1 | Sin botón editar/inactivar nodo GLN |
| HI-05 | P2 MEDIA | GS1 GLN | C7 | `GlnForm` no auditado — check-digit GLN incierto |
| HI-06 | P1 ALTA | GS1 Inbound | C1/C8 | UUID establecimiento y registrado_por ingresados manualmente |
| HI-07 | P0 BLOQUEANTE | GS1 Inbound | C7 | SQL injection latente en `listar` — interpolación de estado sin parametrizar |
| HI-08 | P1 ALTA | GS1 Inbound | C7 | GTIN-14 sin check-digit en Proceso A (inconsistente con Medicamentos) |
| HI-09 | P2 MEDIA | GS1 Inbound | C7 | `cantidad` productos sin validación positiva en contrato Zod |
| HI-10 | P0 BLOQUEANTE | GS1 Lote detail | C1 | Módulo completo usa datos hardcodeados — router `gs1.loteTrace` no existe |
| HI-11 | P1 ALTA | GS1 Lote detail | C3 | RBAC botón "Iniciar recall" no verificado |
| HI-12 | P1 ALTA | GS1 Medicamentos | C5 | `loteVencimiento` TZ shift: `new Date("YYYY-MM-DD")` en UTC-6 |
| HI-13 | P0 BLOQUEANTE | GS1 Medicamentos | C9 | Tabla `ece.gs1_gtin_sustitutos` no existe en BD |
| HI-14 | P1 ALTA | GS1 Medicamentos | C7 | `gs1Medication.list/get` sin `withTenantContext` |
| HI-15 | P2 MEDIA | GS1 Transfers | C7 | GLN-13 sin check-digit en formulario Nueva transferencia |
| HI-16 | P2 MEDIA | GS1 Transfers | C4 | `fechaVencimiento` de productos sin validación de fecha futura |
| HI-17 | P2 MEDIA | GS1 Transfers | C1 | `productos` tipado como `unknown` — frágil ante cambios de schema |
| HI-18 | P1 ALTA | GS1 Trazabilidad | C1 | Scope EPCIS solo cubre equipos — sin trazabilidad GS1 de medicamentos |
| HI-19 | P2 MEDIA | GS1 Trazabilidad | C4 | `fechaDesde`/`fechaHasta` TZ shift desde `datetime-local` |
| HI-20 | P1 ALTA | Staff GSRN | C3 | `generateGsrn` usa `Math.random()` — no criptográfico |
| HI-21 | P2 MEDIA | Staff GSRN | C3/C8 | `revoke` silencia error de `motivo_revocacion` faltante |
| HI-22 | P1 ALTA | Staff GSRN | C3 | Sin CHECK constraint GSRN-18 en BD |
| HI-23 | P0 BLOQUEANTE | Farmacovigilancia | C6 | `create`/`acknowledge` sin `withTenantContext` — RLS bypass cross-tenant |
| HI-24 | P1 ALTA | Farmacovigilancia | C1 | `escalate` no emite evento de dominio — notificación nunca enviada |
| HI-25 | P0 BLOQUEANTE | Farmacovigilancia | C9 | Tabla `ece.gs1_epcis_event` referenciada pero no existe |
| HI-26 | P2 MEDIA | Farmacovigilancia | C3 | `summary` accesible sin guardia de rol en UI |
| HI-27 | P1 ALTA | Inventory Alertas | C3 | `generarOrden` llama `alert()` nativo del browser |
| HI-28 | P2 MEDIA | Inventory Alertas | C3 | `listAlertas` ejecuta loop N+1 — latencia en catálogos grandes |
| HI-29 | P1 ALTA | Inventory item | C6 | `item.create` sin `withTenantContext` — items globales sin RLS |
| HI-30 | P2 MEDIA | Equipment | C1 | Ruta `/equipment/cold-chain/` no existe |
| HI-31 | P2 MEDIA | Equipment | C1 | Tabla sin link a detalle — `/equipment/[id]/` no auditado |

### Conteo por severidad

| Severidad | Cantidad |
|---|---|
| P0 BLOQUEANTE | **5** |
| P1 ALTA | **11** |
| P2 MEDIA | **14** |
| P3 INFORMATIVO | **1** |
| **Total** | **31** |

### P0 prioritizados para remediación inmediata

| # | ID | Módulo | Esfuerzo estimado | Impacto |
|---|---|---|---|---|
| 1 | HI-07 | GS1 Inbound | 30 min | SQL injection latente — parametrizar `estado` en `listar` |
| 2 | HI-23 | Farmacovigilancia | 1h | RLS bypass en `create`/`acknowledge` — agregar `withTenantContext` |
| 3 | HI-13 | GS1 Medicamentos | 1h | Crear DDL `ece.gs1_gtin_sustitutos` |
| 4 | HI-25 | Farmacovigilancia | 2h | Crear DDL `ece.gs1_epcis_event` con schema GS1 EPCIS |
| 5 | HI-10 | GS1 Lote detail | 2-3d | Implementar router `gs1-lote-trace` + conectar UI |

### Patrones sistémicos detectados

1. **Inconsistencia en validación GS1 check-digit:** `gs1-medication.router.ts` sí valida (excelente), pero `gs1-proceso-a.router.ts` y `gs1-proceso-b.router.ts` no. El helper `gs1CheckDigitValid` debe extraerse a `@his/contracts` y aplicarse en todos los puntos de entrada GS1.

2. **Schema drift `ece.*`:** Al menos 2 tablas (`ece.gs1_gtin_sustitutos`, `ece.gs1_epcis_event`) están referenciadas por routers pero no existen en el DDL del repositorio. Este es el patrón dominante de los P0 del proyecto (ver también HI-10 del Stream A, HH-09 del Stream D).

3. **Falta sistemática de `withTenantContext` en routers GS1/Farmacia:** Los routers que operan sobre tablas `ece.*` utilizan `$queryRawUnsafe` directo. Las tablas `ece.*` no son accedidas via Prisma ORM (no hay modelo en `schema.prisma`), por lo que `withTenantContext` no aplica para demotar el rol — pero el filtro `WHERE organization_id = ...` es igualmente necesario para evitar cross-tenant reads.

4. **TZ shift en campos de fecha:** Mismo patrón del Stream A (HI-03) y Stream B (BCMA-002). `new Date("YYYY-MM-DD")` en browser UTC-6 produce desplazamiento. Afecta: `loteVencimiento` (HI-12) y los campos de fecha de transfers.

5. **`alert()`/`prompt()` en flujos de negocio:** Mismo patrón del Stream C (`/ece/comite`) y Stream A. HI-27 es la tercera instancia encontrada en el proyecto.

### ADR-I-01 (short): Separar tablas EPCIS de equipos vs. GS1 medicamentos

**Contexto:** `ece.epcis_event` fue diseñada para movimientos de equipos biomédicos. Los routers de farmacovigilancia y trazabilidad GS1 de medicamentos referencian `ece.gs1_epcis_event` (inexistente) con schema diferente.

**Decisión:** Crear `ece.gs1_epcis_event` con schema EPCIS 1.2 estándar (campos JSONB: `what`, `who`, `where_data`, `why`, `when`). Mantener `ece.epcis_event` para equipos. No fusionar — los dominios son distintos (activos fijos vs. cadena de medicamentos).

**Consecuencias:** +1 tabla DDL, +1 router `epcis-gs1-query`, unificación del módulo de Trazabilidad para soportar ambos dominios con un selector de modo.

### ADR-I-02 (short): Centralizar validación GS1 en `@his/contracts`

**Contexto:** `gs1CheckDigitValid` existe en `gs1-medication.router.ts` y `staff-gsrn.router.ts` como función local. Los routers Proceso A y B no la usan. La UI no la usa.

**Decisión:** Mover `gs1CheckDigitValid` a `packages/contracts/src/validators/gs1.ts` y exportar desde `@his/contracts`. Aplicar a todos los schemas Zod que aceptan GTIN-8/13/14, GLN-13, SSCC-18, GSRN-18.

**Consecuencias:** Paridad TS↔SQL (hay trigger `fn_validate_gs1_check_digit` en SQL — confirmar existencia). Reduce duplicación de código. Los routers importan del contrato en lugar de tener helpers locales.

---

*Fin del informe Stream I. Auditorías anteriores: Streams A, B, C, D, E, F + Consolidación Top-15 P0/P1 en `docs/audit/`. Próximo stream recomendado: Stream J — Devoluciones GS1 + Equipment detail + cold-chain.*
