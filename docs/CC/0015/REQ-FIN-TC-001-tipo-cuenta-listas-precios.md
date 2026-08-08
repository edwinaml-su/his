# REQ-FIN-TC-001 — Tipo de cuenta del paciente → lista de precios (pivote de cargos)

| Campo | Valor |
|---|---|
| Control de cambios | **CC-0015** |
| Fecha | 2026-08-04 |
| Solicitante | Edwin Martínez (Inversiones Avante) |
| Rama | `feat/cc-0015-tipo-cuenta-precios` |
| SQL | `packages/database/sql/191_cc0015_tipo_cuenta_listas_precios.sql` — **APLICADO a prod 2026-08-04 (no re-aplicar)** |
| Seed | `packages/database/scripts/seed-tarifario-odoo.mjs` — **EJECUTADO contra prod 2026-08-04 (idempotente)** |
| Insumo | `docs/CC/0015/odoo-pricelists-dump.json` (extracción read-only de odoo.complejoavante.com, Odoo 18.0) |

## 1. Requerimiento (regla de negocio confirmada por el cliente)
El **pivote para asignar la lista de precios es el TIPO DE CUENTA** con que se abre la atención del paciente: cuenta tipo ISBM → lista «PRECIOS ISBM»; tipo MAPFRE → lista MAPFRE; PARTICULAR → lista general de Avante. Los cargos de la cuenta se valoran con esa lista; si el ítem no está, cae al precio estándar del catálogo (CC-0013); si tampoco, precio manual con aviso. Réplica del mecanismo operativo del Odoo actual.

## 2. Entregado

### Modelo de datos (SQL 191, aplicado)
- **`TipoCuenta`** (por organización, RLS tenant): `code`, `nombre`, `priceListId` → ServicePriceList, `insurerId?` → Insurer, `esParticular`, `active`. Seed: **16 tipos × 3 orgs** (PARTICULAR + 15 pagadores: ISBM, MAPFRE, ABANK, ASESUISA, SISA VIDA, CIGNA, PAN AMERICAN LIFE, DAVIVIENDA, CEL, MEDIPROCESOS, AGRÍCOLA, ASSA, ENLACES, DRSV, DRSV IMÁGENES).
- **`PatientAccount.tipoCuentaId`** — la cuenta nace anclada a su tipo (obligatorio al crear cuentas nuevas).
- **`Invoice.patientAccountId`** — los cargos facturados quedan anclados a la cuenta de origen.
- Fixes de drift del tarifario (SQL 133): columna `updatedAt` faltante en `ServicePriceListItem` + índice único `(priceListId, code)` para upserts.

### Importación de listas reales de Odoo (seed ejecutado)
- **60 `ServicePriceList`** («ODOO — {nombre}», 20 listas × 3 orgs) con **10,602 precios** (3,610 reglas del dump; 2 omitidas por ser de categoría/fórmula, 74 duplicados por tiers de cantidad → se conserva el último). Códigos: `default_code` de Odoo → prefijo `[COD]` del nombre → sintético `ODOO-{id}`.
- **48 TipoCuenta enlazados** a su lista (16 × 3 orgs). «DrSV - IMAGENES» queda con 0 items (en Odoo solo tiene una regla de categoría — dato real).

### Backend
- Router `tipoCuenta` (CRUD admin, rol ADMIN/ACCOUNTANT) + schemas en contracts.
- **Resolver de precios server-side** (`price-resolver.ts`): lista del tipo de cuenta → fallback `LabTest.standardPrice` → null. Procedure `servicePriceList.resolverPorCuenta({cuentaId, codes[]})`.
- `patientAccount.crear` exige `tipoCuentaId` (+ servicio opcional en un paso); `listarPorPaciente` y `patient.contextoCuenta` exponen el tipo.
- `servicePriceList.listActiveItems({priceListId?})` — filtro nuevo sin romper consumidores.
- `invoice.create` acepta `patientAccountId` (valida tenant + paciente).

### UI
- **Admin → Finanzas → Tipos de cuenta** (`/finance/tipos-cuenta`): CRUD con select de listas de precios reales.
- **Selector de cuenta compartido** (HC y LIS): ahora permite **crear la cuenta inline** eligiendo tipo de cuenta + tipo de servicio (cierra el hueco: `patientAccount.crear` no tenía ningún caller — las cuentas solo se creaban por SQL).
- **Pill «Tipo de cuenta» de la HC** muestra el tipo real (Particular/ISBM/…) — cierra la desviación documentada en CC-0011.
- **Facturación** (`/finance/invoices/nuevo`): selector de cuenta del paciente; al elegirla el tarifario se filtra a la lista del tipo de cuenta (banner «Lista aplicada»), resolución de precio por código, y el cargo queda anclado a la cuenta.

## 3. Cascada de resolución de precio (definida)
1. Ítem activo en la **lista del tipo de cuenta** (match por código).
2. **`LabTest.standardPrice`** (precio estándar del catálogo, CC-0013).
3. Sin precio → captura manual con aviso.

## 4. UAT preparado
Cuenta de pruebas `CTA00002` (paciente DUI 01490916-9) quedó con tipo **ISBM** → sus cargos deben valorarse con «ODOO — PRECIOS ISBM» (ej. real importado: VEROLAX GOTAS 7.5MG = $6.45).

## 5. Fuera de alcance / seguimiento
- Vincular `TipoCuenta.insurerId` (el catálogo Insurer no tenía filas de estos pagadores) y el flujo de claims.
- Rework de admisión según mockups `admision-avante-v3_1/2.html` (selector tipo de cuenta en admisión) — CC futuro.
- Mapeo producto Odoo ↔ examen/servicio HIS (los códigos importados son de Odoo; el match con PORT-*/servicios internos es manual o CC futuro).
- Enforcement del precio en toda creación de cargos (hoy la factura permite override manual — igual que Odoo).
- Sincronización periódica de listas desde Odoo (el seed es one-shot idempotente, reejecutable a demanda).
- Nota operativa: el password de BD fue reseteado el 2026-08-04 — variables `DATABASE_URL`/`DIRECT_URL` actualizadas en `.env.local` y pendiente confirmar redeploy de Vercel con los valores nuevos.
