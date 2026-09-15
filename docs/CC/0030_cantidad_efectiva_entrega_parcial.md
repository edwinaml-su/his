# CC-0030 — Cantidad efectiva de entrega (R6 de RN-HIS-BOT-001)

| | |
|---|---|
| Solicitante | Edwin Martínez (Avante) |
| Fecha | 2026-09-15 |
| SQL | `packages/database/sql/237_cc0030_cantidad_efectiva_entrega.sql` — **APLICADO a prod 2026-09-15 vía MCP (proyecto `ejacvsgbewcerxtjtwto`) — NO re-aplicar.** |
| Estado | Implementado — backend + UI + conciliación + tests + E2E. |

## Directiva del solicitante (verbatim, docs/47 §4)

**R6 — Cantidad efectiva.** Se carga la cantidad **entregada**, no la
solicitada. La entrega parcial genera cargo parcial y deja el pendiente
visible.

Era el único renglón "No cumple" de la matriz de cumplimiento RN-HIS-BOT-001
(`docs/qa/drhis/RN-HIS-BOT-001-reverificacion-post-remediacion.md`, fila R6),
confirmado fuera del alcance de docs/48 y con la prueba de aceptación #5
(`apps/web/e2e/cargos-rn-bot-001.spec.ts`) en `test.fixme`.

## Estado previo (verificado antes de construir)

- El HIS ya cobraba por unidad escaneada — `capturarCargo` recibe siempre
  `quantity: 1` en `dispensation.router.ts` (`reserveItem`/`scanItem`). El
  "cargo parcial" de facto YA existía: cada scan genera su propia línea.
  Lo que faltaba era el **tope** ("no existe la unidad 11 de 10 prescritas")
  y el **pendiente visible** ("solicitado vs. entregado" expuesto en algún
  lado).
- `PrescriptionItem.prescribedQty` ya existía en `schema.prisma` (Beta.8,
  para el enforcement de `administeredQty` en eMAR) — CC-0030 lo reutiliza
  como base de comparación en vez de introducir un campo nuevo.
- `PrescriptionStatus` ya tenía `PARTIALLY_DISPENSED`/`DISPENSED` en el
  enum, pero **ningún código de aplicación los seteaba jamás** (verificado
  por grep antes de construir: 0 matches de `status: "PARTIALLY_DISPENSED"`
  o `"DISPENSED"` fuera de tests/fixtures). La cola de picking ya listaba
  `PARTIALLY_DISPENSED` como elegible, pero nada producía ese estado.
- `PharmacyReservation` NO tenía enlace directo a `PrescriptionItem` — el
  fármaco se resolvía tomando "el primer ítem de la receta"
  (`prescription.items[0]`, limitación documentada docs/48 Ola 4b H-13,
  pendiente `Drug.gtin` para matchear exacto). Verificado vía MCP
  `execute_sql` (read-only) antes de decidir el diseño: **0 filas** en
  `PharmacyReservation` y en `PrescriptionItem` en prod — sin backfill de
  datos que hacer ni riesgo de qty inconsistente.

## Diseño

### Modelo de datos (SQL 237)

- **`PrescriptionItem.dispensedQty`** (`Decimal @default(0)`) — qty NETA
  entregada (reservas/scans vivos, no `CANCELLED`/`RETURNED`). A diferencia
  de `administeredQty` (mantenida por trigger SQL `32_emar_hardening.sql`),
  esta la mantiene la **app** (`dispensation.router.ts`) dentro de la MISMA
  transacción que `capturarCargo`/`revertirCargo` — el neteo vive junto al
  cargo, un trigger reimplementaría esa lógica en SQL sin ganar nada.
- **`PharmacyReservation.prescriptionItemId`** (`uuid NULL`, FK) — enlace
  explícito al ítem que la reserva entrega, seteado por `reserveItem` desde
  este cambio en adelante. Reservas legacy (ninguna en prod) quedan NULL —
  `returnItem`/`cancelReservation` omiten el decremento para ellas (no hay a
  qué ítem atribuirlo), no es un error.

### Backend (`dispensation.router.ts`)

- **`assertItemNotComplete`** — hard stop `CONFLICT ITEM_COMPLETO` si
  `prescribedQty > 0 && dispensedQty >= prescribedQty`. `prescribedQty = 0`
  (recetas legacy sin cantidad capturada) = sin tope, compatibilidad hacia
  atrás. Cableado en `reserveItem` y `scanItem` (mismo criterio, antes de
  tocar inventario/cargo — un throw revierte toda la transacción).
- **`applyDispensedQtyDelta`** — aplica ±1 a `dispensedQty` (floor 0) y
  recomputa `Prescription.status` a partir del agregado de **todos** los
  ítems de la receta (no solo el tocado — una receta con varios
  medicamentos solo pasa a `DISPENSED` cuando TODOS quedan completos):
  - todos los ítems con `dispensedQty >= prescribedQty` (y `prescribedQty >
    0`) ⇒ `DISPENSED`.
  - algún ítem con `dispensedQty > 0` sin llegar al tope ⇒
    `PARTIALLY_DISPENSED`.
  - ningún ítem con `dispensedQty > 0` ⇒ `SIGNED`.
  No toca el status fuera de `{SIGNED, PARTIALLY_DISPENSED, DISPENSED}` —
  `CANCELLED`/`EXPIRED` quedan intactos. Cableado en `reserveItem`/
  `scanItem` (+1, tras capturar el cargo) y `returnItem`/`cancelReservation`
  (-1, tras revertirlo) — recompute en **ambas direcciones**, porque este CC
  introduce la primera vía que puede bajar `dispensedQty` después de subirlo
  (una devolución/cancelación reabre la receta).
- **`orderDetail`** — expone `prescribedQty`/`dispensedQty`/`pendiente` por
  ítem (`pendiente = null` si `prescribedQty = 0`, para no mostrar
  "pendiente 0" engañoso en recetas sin tope).

### UI (`/pharmacy/dispense/[orderId]`)

- Badge "Entregado X de Y — pendiente Z" por medicamento (Select + debajo
  del ítem seleccionado).
- Botón "Validar y reservar" deshabilitado + alerta explícita cuando el
  ítem seleccionado ya está completo (`pendiente <= 0`).
- `reserveItem`/`cancelReservation`/`returnItem` invalidan `orderDetail` en
  `onSuccess` — el badge se actualiza sin recargar la página.

### Conciliación (`conciliacionCargosRouter`)

- 7º reporte **`entregasParciales`**: ítems con `0 < dispensedQty <
  prescribedQty` de recetas `SIGNED`/`PARTIALLY_DISPENSED`, con
  paciente/medicamento/prescrito/entregado/pendiente. Sumado a `resumen` y a
  un 7º bloque en `/finance/conciliacion`.

## Decisión de diseño — el pendiente NO bloquea el cierre de cuenta

A diferencia de los otros 6 reportes de `conciliacionCargosRouter` (que SÍ
son brechas financieras y bloquean `patientAccount.cerrar`), una entrega
parcial **no es una inconsistencia financiera**: lo no entregado nunca se
cobró (el cargo es por unidad efectivamente escaneada), así que no hay nada
que reconciliar contra el dinero. Es visibilidad **clínico-logística** — un
pendiente de farmacia, no una brecha de facturación. Las 6 causas de bloqueo
de cierre existentes (docs/48 C4-1, extendidas en #636/#638) quedan
intactas; `entregasParciales` es solo lectura en el tablero de conciliación.

**Fuera de alcance de esta v1:** cancelación/expiración automática de
pendientes al alta del paciente. El estado de la receta ya gobierna su
dispensabilidad (`SIGNED`/`PARTIALLY_DISPENSED` vs. `CANCELLED`/`EXPIRED`) —
si una receta se cancela o expira por otro flujo, sus ítems dejan de ser
elegibles para `reserveItem`/`scanItem` (el `where` de ambos ya filtra por
status) sin que CC-0030 necesite tocar ese ciclo de vida.

## Pruebas

- **Unitarias** (`packages/trpc/src/routers/__tests__/dispensation-reservas.router.test.ts`):
  reserva 3/3 ok + 4ª `CONFLICT ITEM_COMPLETO`; `returnItem`/
  `cancelReservation` decrementan `dispensedQty` y reabren el status;
  recompute de `Prescription.status` en ambas direcciones (`SIGNED` →
  `PARTIALLY_DISPENSED` → `DISPENSED` → de vuelta a `PARTIALLY_DISPENSED`
  tras una devolución); `prescribedQty = 0` sin tope.
- **Unitarias** (`conciliacion-cargos.router.test.ts`): `entregasParciales`
  + su conteo en `resumen`.
- **E2E** (`apps/web/e2e/cargos-rn-bot-001.spec.ts`, prueba #5): el
  `test.fixme` se reemplaza por el spec real contra la fixture dedicada
  `E2E_BOT.entregaParcial` (`prescribedQty = 3`, seed-e2e-fixtures.mjs §7,
  escena 8) — 3 dispensaciones exitosas con badge "Entregado X de 3 —
  pendiente Z" visible en UI tras cada una, 4ª rechazada `ITEM_COMPLETO`
  server-side. Tag `@smoke` (mismo costo que las pruebas #1-4/#8, que
  también escanean GS1 y verifican precio).

## Reverificación @DrHIS

`docs/qa/drhis/RN-HIS-BOT-001-reverificacion-post-remediacion.md` §8
(addendum 2026-09-15): R6 pasa de "No cumple" a "Cumple" con CC-0030.
