# CC-0044 — Formularios de médico fuera de red

## Contexto

Edwin entregó 2 formularios físicos de AVANTE + el protocolo de recepción para
digitalizarlos **dentro del módulo de aseguradoras existente**
(`apps/web/src/app/(admin)/insurance/`, router `insurance.router.ts`, modelos
CC-0028: `Insurer`/`InsurancePlan`/`PatientCoverage`), no como un módulo nuevo
(regla "adecuar legacy, no duplicar" de CLAUDE.md).

Protocolo (formulario "Constancia" + entrevista de Edwin):

1. Recepción confirma pertenencia a la red ANTES de definir el tipo de ingreso.
2. Si el médico tratante está fuera de red → llenar el formulario de la
   aseguradora, o el de respaldo AVANTE ("Constancia").
3. Completar y hacer FIRMAR al asegurado/responsable ANTES de cerrar la admisión.
4. Adjuntar al expediente/caso.
5. Notificar a Cuentas/Seguros.

## Modelo (SQL 266 — NO aplicado a prod, pendiente de @Orq vía MCP)

3 tablas nuevas en `public`, RLS por `organizationId` (patrón CC-0028/sql 235),
`REVOKE ALL` explícito de `anon` (lección pagada: default privileges dan DML a
`anon` en tablas nuevas), auditoría hash-chain (`audit.fn_audit_row`):

- **`NetworkCallCensus`** + **`NetworkCallCensusEntry`** — "Censo de llamada
  seguro médico": cabecera (paciente, aseguradora o texto libre, diagnóstico,
  estado) + filas (médico llamado, teléfono, atendió Sí/No/sin registrar,
  comentarios). Estado `BORRADOR -> FIRMADO -> ANULADO`. `medicoTurnoUserId` +
  `firmadoAt` se asignan en `sign()`, no en la creación — el formulario físico
  se llena antes de que el médico de turno firme el pie.
- **`OutOfNetworkAttestation`** — "Constancia de atención por médico fuera de
  red" (respaldo AVANTE, usado cuando la aseguradora no exige su propio
  formulario). Estado `PENDIENTE_FIRMA -> FIRMADO -> ANULADO`. `markFirmado`
  registra que el impreso físico fue firmado por el asegurado/responsable —
  **no hay firma digital en v1** (ver Decisiones).

Ambas tablas aceptan `insurerId` (catálogo `Insurer`, global o del tenant) O
`aseguradoraNombre` (texto libre) — CHECK exige al menos uno, igual que
`InsurancePlan`/`PatientCoverage` no fuerzan catálogo cerrado de aseguradoras
en el flujo de admisión.

`schema.prisma` sincronizado en el mismo PR (modelos + relaciones a
`Insurer`/`Patient`/`PatientAccount`/`Organization`/`Establishment`/`User`).

## API (`packages/trpc/src/routers/insurance.router.ts`)

Dos sub-routers nuevos: `insurance.callCensus.*` y `insurance.outOfNetwork.*`.
Todo dentro de `withTenantContext` (contrato RLS del repo). Zod schemas en
`packages/contracts/src/schemas/insurance-out-of-network.ts` (agregado a
`schemas/index.ts` en el mismo commit).

- `callCensus`: `create` (con `entries` embebidas), `update`/`addEntry`/
  `updateEntry`/`removeEntry` (sólo en `BORRADOR`), `sign` (**requireRole
  PHYSICIAN** — el "médico de turno" del protocolo; además exige ≥1 fila en
  el censo, ver §Hallazgos de la revisión adversarial), `anular` (desde
  `BORRADOR`/`FIRMADO`, guarda `motivoAnulacion`), `list`, `byId`.
- `outOfNetwork`: `create`, `update` (sólo en `PENDIENTE_FIRMA`),
  `markFirmado`, `anular`, `list`, `byId`.

**Roles (`formsWriterProc`/`formsReaderProc`, packages/trpc/src/routers/insurance.router.ts):**
`create`/`update`/`addEntry`/`updateEntry`/`removeEntry`/`markFirmado`/`anular`
de ambos sub-routers exigen `["ADMIN", "ADMISION", "ACCOUNTANT", "BILLING"]`
(`formsWriterProc`); `list`/`byId` exigen esos mismos roles + `PHYSICIAN`
(`formsReaderProc`, para que el médico de turno pueda leer el censo antes de
decidir si firma). `sign` sigue exclusivo de `PHYSICIAN`
(`physicianProc`). `ADMISION` es el código real de admisión del catálogo RBAC
(sql/194, ya usado en `patient-identification.router.ts`).

## UI (`apps/web/src/app/(admin)/insurance/formularios/`)

- `page.tsx` — índice combinado (tabs Censos/Constancias) + el protocolo de
  recepción como `<details>` colapsable (no se agregó dependencia de UI nueva).
- `censo/new`, `censo/[id]`, `constancia/new`, `constancia/[id]`.
- Selector de paciente: `BuscadorPaciente` (compartido, ya usado en
  `/insurance/polizas`). Selector de cuenta: `patientAccount.listarPorPaciente`
  (mismo query que `selector-cuenta.tsx`, sin reusar el componente completo —
  aquí la cuenta es opcional y no hace falta el flujo "crear cuenta inline").
- **Imprimir**: vista imprimible renderizada como **React** (`CensoPrintView`/
  `ConstanciaPrintView`, componentes locales en cada `[id]/page.tsx`), oculta
  en pantalla y visible sólo bajo `@media print` vía Tailwind `hidden
  print:block` — mismo patrón que
  `apps/web/src/components/epicrisis-pdf-preview.tsx`. El botón "Imprimir"
  llama `window.print()` directo, sin ventana nueva. Cabecera con
  `/avante-logo.svg` (asset ya existente en `apps/web/public/`), tabla de
  censo con relleno hasta 10 filas, líneas de firma. **Ya NO usa
  `window.open`+`document.write`** — ver §Hallazgos de la revisión adversarial.
- Sidebar: **sin item nuevo** — se navega desde el toolbar de `/insurance` y
  `/insurance/polizas` ("Formularios fuera de red"), mismo patrón que
  "Planes"/"Pólizas". `nav-sections.ts` sólo actualiza la descripción del item
  existente "Aseguradoras".
- **Botones de mutación no se ocultan por rol** (P2 aceptado): no existe un
  patrón client-side barato para leer `roleCodes` sin prop-drilling desde un
  Server Component (el único hook existente, `useEcePermissions`, requiere
  que el padre resuelva `getTenantContext()` y pase `roleCodes` como prop —
  las 5 páginas de este CC son Client Components hoja sin ese wiring). Un
  usuario sin el rol requerido ve el error `FORBIDDEN` del servidor
  (`Rol requerido: ADMIN, ADMISION, ACCOUNTANT, BILLING`) al intentar la
  acción. Ocultar los botones proactivamente queda para cuando exista un
  contexto de roles global reusable — no se justifica construirlo sólo para
  este CC.

## Hallazgos de la revisión adversarial (NO-GO inicial, corregidos en commits posteriores)

1. **P0 — XSS almacenado en las vistas imprimibles.** El diseño original
   usaba `window.open("") + document.write(...)` interpolando strings de BD
   (`doctorNombre`, `comentarios`, `aseguradora`, etc.) sin escapar dentro de
   HTML crudo. Con el CSP de prod (`script-src 'self' 'unsafe-inline'`, #427)
   y la ventana nueva heredando el origen de la app, un valor tipo
   `<img src=x onerror=...>` guardado en `comentarios` habría ejecutado con
   la sesión de quien imprime. **Corregido**: la vista imprimible es ahora
   JSX (`CensoPrintView`/`ConstanciaPrintView`), React escapa todo el texto
   por default; no hay `document.write` en el CC.
2. **P1 — gate de roles insuficiente.** Sólo `sign` tenía `requireRole`; el
   resto (`create`/`update`/`addEntry`/`updateEntry`/`removeEntry`/
   `markFirmado`/`anular`/`list`/`byId`) corría en `tenantProcedure` (abierto
   a cualquier rol del tenant). **Corregido** con `formsWriterProc`/
   `formsReaderProc` (ver §API). Abrir el acceso a más roles (ej. `NURSE`,
   `MT` para lectura) es **decisión pendiente de Edwin** — el default actual
   es deliberadamente restrictivo.
3. **P1 — `addEntry` con `ordenIndex` roto.** El schema de contracts
   defaulteaba `ordenIndex` a `0` vía Zod, así que el fallback `?? i` del
   router nunca corría — toda fila agregada después del `create` inicial
   quedaba con `ordenIndex=0`. **Corregido**: `ordenIndex` es opcional (sin
   default) en el schema; cuando el caller no lo envía, el router calcula
   `max(ordenIndex existente en el censo) + 1` dentro de la misma
   transacción. Test: "addEntry asigna ordenIndex incremental... (dos
   llamadas seguidas)".
4. **P2 — `sign` sin exigir filas.** Un censo `BORRADOR` con 0 entries podía
   firmarse — sin valor probatorio (el propósito es documentar los intentos
   de localizar un médico de la red). **Corregido**: `sign` ahora valida
   `_count.entries > 0` antes de transicionar (`BAD_REQUEST` si no hay filas).
5. **P2 — typo `patienteNombre`.** Ambas vistas imprimibles usaban
   `patienteNombre` (con "e") como nombre de variable/prop. **Corregido** a
   `pacienteNombre` en `CensoPrintView`/`ConstanciaPrintView`.

## Decisiones tomadas (el briefing dejaba libertad)

1. **`motivoAnulacion` (columna nueva, no estaba en el briefing literal):**
   la acción `anular` no tenía dónde persistir el motivo en el modelo
   original. Se agregó `motivoAnulacion varchar(400)` a ambas tablas —
   espejo de `AuthorizationRequest.denialReason` — en vez de descartar el
   motivo o sobrecargar `notas`.
2. **`create`/`update`/`anular` sin gate de rol:** el DoD del briefing sólo
   pide "sign exige rol médico" y "markFirmado sólo desde PENDIENTE_FIRMA" —
   no se agregó `requireRole` especulativo a las demás mutations.
3. **Auditoría hash-chain incluida** en las 3 tablas (no pedida explícitamente,
   pero consistente con CC-0028/CC-0027 para datos de respaldo legal de
   aseguradoras) — costo marginal, mismo patrón `DO $$ ... audit.fn_audit_row`.
4. **Selector de cuenta simplificado:** se reusa el query de
   `selector-cuenta.tsx` pero no el componente completo (sin flujo "crear
   cuenta inline") — la cuenta es opcional en ambos formularios.
5. **Sin firma digital ni adjunto de imagen del impreso firmado en v1** — el
   formulario físico se firma en papel; `sign`/`markFirmado` sólo dejan
   constancia electrónica de que ocurrió (usuario + timestamp).

## Pendiente explícito para v2 (fuera de alcance de este CC)

- **Enforcement en admisión:** hoy nada bloquea cerrar una admisión con
  médico fuera de red sin censo/constancia. Requiere decisión de producto
  (¿bloqueo duro o warning?) + integración con el flujo de admisión/alta.
- **Notificación automática a Cuentas/Seguros** (paso 5 del protocolo) — no
  hay `DomainEvent` nuevo en esta v1 (briefing lo excluyó explícitamente para
  no tocar `payloads.ts`, punto caliente de conflictos).
- **Adjuntar el impreso escaneado/firmado al expediente** — no hay upload de
  archivo en v1; sólo el estado y quién/cuándo firmó.
- **UAT visual de Edwin** — no se validó pixel-a-pixel contra los formularios
  físicos originales (no se entregó mockup HTML/CSS, sólo la descripción de
  campos); layout de impresión es una aproximación razonable, no una
  digitalización exacta del PDF/papel original.
- **Botones de mutación no se ocultan por rol en la UI** (ver §UI arriba) —
  el servidor sí enforcea (`formsWriterProc`/`formsReaderProc`); falta un
  contexto de roles global reusable en el cliente para ocultar proactivamente.
- **Ampliar roles de `formsWriterProc`/`formsReaderProc`** (ej. `NURSE`, `MT`
  para lectura) es decisión de Edwin, no tomada unilateralmente en este CC.
- **Deuda aceptada de la revisión adversarial (P2 restantes, no bloqueantes):**
  - Filas de `audit.audit_log` de `NetworkCallCensusEntry` quedan con
    `organizationId` no resuelto directamente en la fila auditada (la tabla
    hereda tenancy vía `censusId`, no tiene columna propia) — mismo precedente
    que `InsurancePlanCoverage`/`PatientCoverageOverride` (sql/235); no se
    corrigió ahí tampoco.
  - Los 29 tests del router son unitarios con Prisma mockeado — no hay un
    test de integración cross-tenant real (org A no puede leer/escribir
    censos de org B) para este CC específico, aunque el patrón de filtro
    (`organizationId: ctx.tenant.organizationId` dentro de
    `withTenantContext`) es idéntico al resto del router, ya cubierto por
    `cross-tenant.integration.test.ts` a nivel de repo.
  - Campos opcionales de `update` (`aseguradoraNombre`, `polizaNumero`, etc.)
    no tienen forma de "limpiarse" a NULL explícito desde la UI — un
    `undefined` es no-op en Prisma (mismo patrón pre-existente que
    `patientCoverageUpdateInput`, que sí resolvió esto sólo para `validTo`).
  - `parentescoOtro` puede quedar con un valor obsoleto en BD si el usuario
    cambia `parentesco` de `OTRO` a otro valor en un `update` (el router no
    lo limpia automáticamente).
  - No hay "smoke SQL" (aplicar el 266 contra una BD efímera y correr los
    queries de verificación del propio archivo) — se validó por lectura y
    por los tests unitarios del router únicamente.
  - Las policies RLS de las 3 tablas no incluyen la excepción de
    `is_break_glass()` que sí tienen otras tablas clínicas — consistente con
    el precedente de sql/235 (CoverageRule y hermanas tampoco la tienen).
  - `docs/04_modelo_datos.md` no fue actualizado con las 3 tablas nuevas.

## Verificación

Primera entrega (antes de la revisión adversarial):
- `npm run -w @his/database generate` — OK (schema.prisma válido).
- `npm run -w @his/trpc typecheck` / `@his/contracts typecheck` / `@his/web typecheck` — OK.
- `npm run -w @his/trpc test` — 249 archivos / 3869 tests OK.
- `npm run -w @his/web test` — 93 archivos / 848 tests OK.
- `npm run -w @his/web lint` — 0 errores.

Tras las correcciones de la revisión adversarial (P0-1 XSS, P1-1 roles, P1-2
ordenIndex, P2 sign≥1 entry, typo):
- `npm run typecheck` (raíz, 7 workspaces vía turbo) — **7/7 verdes**.
- `npm run -w @his/trpc test` — **249 archivos / 3877 tests OK** (8 skipped
  preexistentes; +8 tests nuevos: gates de rol FORBIDDEN/OK, `sign`
  BAD_REQUEST sin entries, `addEntry` ordenIndex incremental y explícito).
- `npm run -w @his/web test` — **93 archivos / 848 tests OK** (sin cambios —
  el fix de impresión no tiene test dedicado, ver deuda aceptada arriba).
- `npm run -w @his/web lint` — **0 errores** (59 warnings preexistentes en
  otros archivos, ninguno en los tocados por este CC).
