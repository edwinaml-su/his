# REQ-FIN-LIB-001 — Activación del multi-libro contable (cerrar drift + seed)

| Campo | Valor |
|---|---|
| Control de cambios | **CC-0018** |
| Fecha | 2026-08-08 |
| Solicitante | Edwin Martínez (Inversiones Avante) — verificación "¿múltiples libros?" |
| Rama | `feat/cc-0018-multilibro` |
| SQL | `packages/database/sql/193_cc0018_multilibro_contable.sql` — **NO aplicado a prod** (worktree aislado, sin permisos de escritura remota; lo aplica @Orq) |
| Precondición de otro archivo | `packages/database/sql/47_accounting_hardening.sql` (PR #69, Beta.18) — **debe reaplicarse inmediatamente después de 193** (ver §4) |

## 1. Requerimiento

Edwin preguntó si el HIS ya soporta múltiples libros contables. Verificación en prod (`mcp supabase list_tables`, proyecto `ejacvsgbewcerxtjtwto`): `public."Ledger"` existe pero con **0 filas** — el multi-libro nunca se activó, a pesar de que el módulo admin `/ledgers` (page + ledger-form + ledger-table + rounding-policy-form) y el router `ledger.router.ts` (473 líneas, 36 tests verdes) ya están completos y en producción desde antes.

## 2. Hallazgo — drift preexistente de Beta.18 (no introducido por este CC)

Al investigar por qué `Ledger` está vacío se encontró un drift más profundo que el módulo `/ledgers`:

- `packages/database/prisma/schema.prisma` declara los modelos **`Account`, `AccountingPeriod`, `JournalEntry`, `JournalLine`** (líneas ~4416-4540, ADR 0007) y el router **`packages/trpc/src/routers/accounting.router.ts`** (chart / period / journal / costCenter, 4 sub-routers, `requireRole(["ACCOUNTANT", ...])`, `withTenantContext` en cada procedure) ya los consume — con **23/23 tests verdes** (`accounting.test.ts`, mocks) desde que se mergeó Beta.18 (PR #69).
- Las 4 tablas **nunca se crearon físicamente** en la BD de prod (confirmado: ausentes de `information_schema` / `list_tables`). El código compila y los tests pasan porque usan Prisma Client generado desde `schema.prisma` (correcto) contra un mock de `PrismaClient` — nunca tocan la BD real.
- `packages/database/sql/47_accounting_hardening.sql` (también del PR #69) ya contiene TODO el hardening que faltaría — RLS, audit triggers, hash-chain criptográfico en `JournalEntry.chainHash`, CHECK constraints regulatorios (partida doble, `fxRate>0`, `periodMonth` 0-12), triggers de inmutabilidad POSTED y bloqueo de período CLOSED, índices parciales, grants. Pero su propio encabezado declara como **precondición** "el schema Prisma ya aplicó la migración que crea las tablas" — precondición que nunca se cumplió, porque este repo **no usa `prisma migrate deploy` contra el Supabase de prod** (flujo deliberado: `schema.prisma` + `sql/` numerados vía SQL Editor/MCP).
- **Evidencia concluyente** de que 47 nunca se ejecutó con éxito: la policy RLS real de `CostCenter` en prod es `cost_center_tenant` (creada por `sql/128_cost_center_table_and_invoice_fk.sql`), **no** `cost_center_tenant_isolation` (el nombre que crearía 47 línea 88-92). Como 47 corre como un único script, su primera sentencia sobre una tabla inexistente (`ALTER TABLE "Account" ENABLE ROW LEVEL SECURITY`, línea 42) habría abortado toda la transacción antes de llegar a la policy de `CostCenter`.

## 3. Entregado (SQL 193)

Alcance deliberadamente acotado a **desbloquear 47**, sin duplicar lo que 47 ya resuelve:

- **Enums faltantes**: `AccountType`, `PeriodStatus`, `JournalStatus`, `JournalOrigin` (guard `DO $$ ... EXCEPTION WHEN duplicate_object`). `LedgerKind` NO se toca — ya existe físicamente y `Ledger.kind` lo usa hoy.
- **`CREATE TABLE IF NOT EXISTS`** de `Account`, `AccountingPeriod`, `JournalEntry`, `JournalLine` — espejo exacto de `schema.prisma`: mismas columnas/tipos/NOT NULL/uniques (`@@unique`)/índices (`@@index`)/FKs, con las referential actions por defecto de Prisma (relación requerida sin `onDelete` explícito → `RESTRICT`; opcional → `SET NULL`; las que el schema declara explícitamente respetan esa declaración). Columnas `@updatedAt` (gestionadas por Prisma en runtime, sin default físico en el schema) reciben `DEFAULT now()` en el DDL para permitir INSERT directo por SQL.
- **RLS de arranque**: `ENABLE ROW LEVEL SECURITY` + una policy tenant por tabla, usando **los mismos nombres** que definirá 47 (`account_tenant_isolation`, `period_tenant_isolation`, `journal_entry_tenant_isolation`, `journal_line_tenant_isolation` — esta última con `EXISTS` sobre `JournalEntry` porque `JournalLine` no tiene `organizationId` propio). `GRANT SELECT, INSERT, UPDATE` a `authenticated` (sin `DELETE` — append-only), igual que 47. Esto evita que las tablas queden expuestas sin RLS en la ventana entre aplicar 193 y reaplicar 47, y hace que el `DROP POLICY IF EXISTS` + `CREATE POLICY` de 47 reemplace limpiamente sin dejar policies huérfanas.
- **Seed**: **2 libros por organización real** (excluye `legalName LIKE 'RLS-Test%'`) — `FISCAL-SV` (kind `FISCAL_LOCAL`, "Libro Fiscal El Salvador") + `IFRS` (kind `IFRS`, "Libro IFRS Grupo"), moneda funcional USD, idempotente (`WHERE NOT EXISTS`).

### Deliberadamente FUERA de 193 (ya cubierto por 47 — no se duplica)
Audit triggers, hash-chain (`chainPrevHash`/`chainHash`), CHECK constraints regulatorios, trigger de inmutabilidad POSTED, trigger de período CLOSED, trigger de cuenta-hoja, índices parciales operacionales, autovacuum tuning.

## 4. Orden de aplicación (@Orq)

1. `packages/database/sql/193_cc0018_multilibro_contable.sql`.
2. **Reaplicar `packages/database/sql/47_accounting_hardening.sql` completo** — es idempotente (`DO $$` guards, `DROP POLICY IF EXISTS`, `CREATE OR REPLACE FUNCTION`). Sin este paso, las 4 tablas quedan sin audit trail, sin hash-chain y sin los CHECK/triggers regulatorios de partida doble — **no dar el CC por cerrado sin este paso**.
3. Verificar: `SELECT count(*) FROM "Ledger"` (esperado: 2 × #orgs reales); `get_advisors(security)` sin RLS-disabled en las 4 tablas nuevas; `SELECT relrowsecurity FROM pg_class WHERE relname IN ('Account','AccountingPeriod','JournalEntry','JournalLine')` → todas `t`.

## 5. Código — hallazgos del drift en router / rounding-policy

- **`ledger.router.ts`** y **`rounding-policy-form.tsx`**: no referencian ninguna columna/tabla inexistente. `roundingPolicy` es un stub autocontenido (`{decimals:2, mode:'HALF_EVEN'}`, TODO explícito "Sprint 5: tabla `LedgerRoundingPolicy`" — esa tabla **no existe ni en Prisma ni en SQL**; es deuda documentada, no drift). No requiere cambios.
- **`accounting.router.ts`**: ya usa `withTenantContext` en TODOS los procedures (patrón RLS correcto, a diferencia de `ledger.router.ts` que usa `ctx.prisma` directo con filtro `where: organizationId` — defensa débil documentada como TODO en el propio archivo desde Beta.18; no es parte de este CC, se reporta como hallazgo).
- **`apps/web/src/app/(admin)/ledgers/[id]/page.tsx`**: el tab "Plan de cuentas" es un Empty State deshabilitado con comentario "la tabla `ChartOfAccounts` aún no existe (no hay schema)" — **esto ya es incorrecto/desactualizado**: el schema (`Account`) sí existe y el backend (`accounting.router.chart.*`) ya está implementado y testeado. No se tocó (fuera de alcance — "no agregar features nuevas"; construir esa UI es CC futuro), pero se deja documentado para no repetir la confusión.
- **Ningún cambio de código fue necesario** en `packages/trpc`, `apps/web` más allá de agregar cobertura de smoke test (ver §6). `schema.prisma` no se tocó — ya estaba completo y compilando correctamente contra el drift (evidencia: `npm run -w @his/database generate` + `npm run typecheck` verdes antes de cualquier cambio de este CC).

## 6. Tests / checks ejecutados

| Check | Resultado |
|---|---|
| `npm run -w @his/database generate` | OK, Prisma Client 5.22.0 generado sin errores |
| `npm run typecheck` (7 workspaces) | **7/7 verde** |
| `packages/trpc/.../accounting.test.ts` (baseline, sin tocar código) | **23/23 verde** |
| `packages/trpc/.../ledger.router.test.ts` (baseline, sin tocar código) | **36/36 verde** |
| `npm run -w @his/contracts test` | 44 files / **1698 tests** verde |
| `npm run -w @his/database test` | 6 files / **83 tests** verde (incluye 1 test nuevo, ver abajo) |
| `npm run -w @his/trpc test` | 179 files / **2717 tests** verde (8 files / 24 tests skipped — preexistente, integración) |
| `npm run -w @his/web test` | 49 files / **575 tests** verde |
| `npm run -w @his/infrastructure test` | 8 files / **143 tests** verde |
| Lint (`@his/database`) | Sin config de lint en el workspace (preexistente) — nada que lintear |

**Único cambio de código**: `packages/database/src/__tests__/ece-drift-models.test.ts` — se agregó un `it()` (patrón ya establecido en el archivo para "modelos añadidos en el sync de drift") que verifica que `prisma.account`, `prisma.accountingPeriod`, `prisma.journalEntry`, `prisma.journalLine` existen como delegados compilados del Prisma Client. Smoke test, sin conexión a BD.

## 7. Fuera de alcance / seguimiento

- **Integración contable con Odoo** (496k `account.move` en Odoo real) — decisión @AE/@Orq: el HIS lleva sus propios libros; la integración/reconciliación con Odoo es fase posterior, sin fecha.
- **Catálogo de cuentas** (`Account` rows) — se captura vía UI/`accounting.router.chart.create`, no seed SQL. El tab "Plan de cuentas" en `/ledgers/[id]` sigue siendo un placeholder deshabilitado (ver §5) — construirlo es CC futuro.
- **Apertura de períodos** (`AccountingPeriod` rows) y **asientos** (`JournalEntry`/`JournalLine`) — ídem, vía `accounting.router.period.create` / `journal.draft`, no seed.
- **Motor de mapeo de reglas** (ADR 0007 D7 — outpatient/inpatient/surgery/pharmacy/LIS → asientos automáticos por evento HIS) — Wave 2 completa, no iniciado.
- **`LedgerRoundingPolicy`** — tabla no existe (Prisma ni SQL); `roundingPolicy` sigue siendo stub.
- **UI de chart-of-accounts / períodos / asientos** — el backend (`accounting.router`) está completo y testeado desde Beta.18 pero **sin ninguna pantalla que lo consuma** (`apps/web/src` no tiene ninguna referencia a `accounting.chart|period|journal|costCenter`). Backlog para @PO.
- **`ledger.router.ts` no usa `withTenantContext`** (filtro `where: organizationId` directo) — inconsistente con `accounting.router.ts` que sí lo usa en todos sus procedures. No es parte de este CC (no se tocó código de `ledger.router.ts`), se reporta como hallazgo de seguridad/consistencia para un CC de hardening futuro.
