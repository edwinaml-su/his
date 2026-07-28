# REQ-LIS-EX-001 — Asignación de exámenes por cuenta + tablero + catálogo con precio estándar

| Campo | Valor |
|---|---|
| Control de cambios | **CC-0013** |
| Fecha | 2026-07-28 |
| Solicitante | Edwin Martínez (Inversiones Avante) |
| Mockup (fuente de verdad) | `docs/CC/0013/mockup_examenes_laboratorio.html` (PORTAFOLIO_EX: 157 prestaciones / 10 secciones) |
| Rama | `feat/cc-0013-lab-examenes` |
| SQL | `packages/database/sql/189_cc0013_lab_examenes_cuenta_precio.sql` — **APLICADO a prod 2026-07-28 vía MCP (no re-aplicar)** |

## 1. Requerimiento
Verificar y corregir el módulo de laboratorio para **asignación y creación de exámenes a pacientes**, y **catálogo con CRUD** para mantenimiento de exámenes **incluyendo precios estándar**.

## 2. Diseño (adecuar legacy, no duplicar)
- **Pantalla de escogitación** = rework de `/lis/orders/new` fiel al mockup: selector de cuenta activa (`?cuentaId=`), grid de secciones (catálogo `lis.test.listByArea`), toggle búsqueda por nombre con badge de sección, checkboxes con contador, panel «Solicitud de laboratorio» con chips, modal resumen de confirmación → `order.create`.
- **Tablero** = vista nueva en `/lis/orders` (`?vista=tablero`): KPIs (cuentas activas / exámenes totales / pendientes / urgentes), tabla por cuenta, modal de solicitud con instrucción general (`LabOrder.clinicalIndication`), estado por examen (`LabOrderItem.status`: Pendiente=ORDERED·COLLECTED, En proceso=IN_PROCESS, Realizado=RESULTED·VALIDATED) e instrucción por examen (`LabOrderItem.notes`).
- **Ancla a cuenta**: `LabOrder.patientAccountId` FK (patrón CC-0012); `encounterId` ahora nullable (cuentas ambulatorias sin admisión). El create resuelve cuenta↔paciente en ambos sentidos.
- **Precio estándar**: `LabTest.standardPrice numeric(12,2)` editable en el CRUD admin `/catalogs/laboratorio`. El tarifario (`ServicePriceListItem` por `code`, SQL 133) queda como override de facturación.
- **Catálogo PORTAFOLIO_EX**: sembrado como filas **del tenant** (una copia por organización real) para que precio/altas/bajas sean parametrizables por el CRUD (las filas globales son read-only por diseño CC-0011). Los 10 paneles LABORATORIO globales de CC-0011 quedaron desactivados (reversible). Radiología/cardiología globales sin cambios. HC misceláneos consume el catálogo nuevo automáticamente.
- `ece.solicitud_estudio` (flujo NTEC firmado) fuera de alcance — la asignación LIS se construye sobre `LabOrder`/`LabOrderItem` que ya traían estado y nota por ítem.

## 3. Desviaciones documentadas
- Sin titlebar falsa de ventana del mockup (se implementa dentro del shell del HIS); paleta distintiva del mockup (teal/naranja/pills) aplicada en el módulo.
- El modal del tablero edita la orden más reciente de la cuenta (el mockup modela una solicitud por cuenta).
- Precios sembrados en NULL — los parametriza el cliente vía CRUD (el mockup no trae precios).

## 4. Seguimiento
- Migrar catálogos RADIOLOGIA/CARDIOLOGIA globales a tenant si también requieren precios.
- E2E Playwright del flujo selección→guardar→tablero→cambio de estado.
- Integración facturación: resolver precio tarifario→standardPrice al facturar exámenes.
