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
  PHYSICIAN** — el "médico de turno" del protocolo), `anular` (desde
  `BORRADOR`/`FIRMADO`, guarda `motivoAnulacion`), `list`, `byId`.
- `outOfNetwork`: `create`, `update` (sólo en `PENDIENTE_FIRMA`),
  `markFirmado`, `anular`, `list`, `byId`.

`create`/`update` no están gateados a un rol específico (recepción, no
facturación, los llena) — sólo `sign` exige rol médico, siguiendo la letra del
protocolo ("Médico de turno... firma").

## UI (`apps/web/src/app/(admin)/insurance/formularios/`)

- `page.tsx` — índice combinado (tabs Censos/Constancias) + el protocolo de
  recepción como `<details>` colapsable (no se agregó dependencia de UI nueva).
- `censo/new`, `censo/[id]`, `constancia/new`, `constancia/[id]`.
- Selector de paciente: `BuscadorPaciente` (compartido, ya usado en
  `/insurance/polizas`). Selector de cuenta: `patientAccount.listarPorPaciente`
  (mismo query que `selector-cuenta.tsx`, sin reusar el componente completo —
  aquí la cuenta es opcional y no hace falta el flujo "crear cuenta inline").
- Imprimir: `window.open` + `document.write` + botón `window.print()`, mismo
  patrón que `apps/web/src/app/(admin)/ece/bitacora/page.tsx`. Cabecera con
  `/avante-logo.svg` (asset ya existente en `apps/web/public/`), tabla de
  censo con relleno hasta 10 filas, líneas de firma.
- Sidebar: **sin item nuevo** — se navega desde el toolbar de `/insurance` y
  `/insurance/polizas` ("Formularios fuera de red"), mismo patrón que
  "Planes"/"Pólizas". `nav-sections.ts` sólo actualiza la descripción del item
  existente "Aseguradoras".

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

## Verificación

- `npm run -w @his/database generate` — OK (schema.prisma válido).
- `npm run -w @his/trpc typecheck` — OK.
- `npm run -w @his/contracts typecheck` — OK.
- `npm run -w @his/web typecheck` — OK.
- `npm run -w @his/trpc test` — 249 archivos / 3869 tests OK (incluye los 21
  tests nuevos de `insurance-out-of-network.router.test.ts`).
- `npm run -w @his/web test` — 93 archivos / 848 tests OK.
- `npm run -w @his/web lint` — 0 errores (warnings preexistentes, ninguno en
  archivos de este CC).
