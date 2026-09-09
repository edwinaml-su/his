# RN-HIS-BOT-001 — Addendum Ola 0: cierre de los 7 "No verificado"

**Fecha:** 2026-09-09 · **Método:** lectura exhaustiva de código (@Explore, evidencia file:line en cada punto) · **Plan padre:** docs/48 (C0-1)

| # (dictamen) | Punto | Veredicto definitivo | Evidencia clave |
|---|---|---|---|
| Paso 11 | Tipo de movimiento "consumo institucional" | **No cumple** — `StockMovementType` = IN/OUT/TRANSFER/ADJUST; `OUT` mezcla consumo y despacho; único discriminador es `reason` texto libre | schema.prisma:3565-3572, contracts/inventory.ts:9 |
| Paso 20 | Cita ambulatoria distinta de Encounter | **Existe `OutpatientAppointment` pero desconectada de cuentas/farmacia** — ni PatientAccount ni Invoice ni dispensación la referencian; la cuenta sin encounter (CC-0002) cubre el ambulatorio puro | schema.prisma:1961-1993, outpatient.router.ts:313-335 |
| R10 | RX_CONTROLLED / libro de controlados | **Parcial grave** — `Drug.dispensingClass`+`requiresControlledLog` existen y el 2-eyes se VALIDA, pero se persiste como texto libre `"[CONTROLLED:…]\|[witness:uuid]"` en `MedicationDispense.notes` (sin columnas witnessUserId/justification) y **el libro de controlados no existe** (ni tabla ni reporte) | pharmacy.router.ts:448-468,499-544; schema.prisma:2220-2236 |
| H-06 | Sincronización `ece.*` ↔ `public.Stock*` | **Confirmado como defecto** — cero escritores cruzados en todo el repo: proceso A/B/C/F escriben solo `ece.*`; Stock* solo lo escriben inventory.router y dispensation.router. Único puente = lectura por convención `gs1_gtin.codigo = StockItem.sku` (existiendo `StockItem.gtin` sin usar). **Sin puente de escritura, el stock que descuenta la dispensación nunca se alimenta de la recepción GS1.** | gs1-proceso-{a,c}.router.ts, inventory.router.ts:547-656 |
| R8 | Paridad ambulatorio/hospitalizado | **Paridad por omisión** — dispensación no contiene la palabra `encounter`; `admissionType` no participa en ningún camino financiero; el pivote de precio es `TipoCuenta` (ortogonal). Aceptable para v1; documentado | dispensation.router.ts (grep=0), finance-reports.router.ts:318-350 |
| — | Otros escritores de Invoice/InvoiceItem | **Ninguno** — `invoice.router.create` es el único (2 INSERTs, líneas 354-404); el resto del repo solo lee | invoice.router.ts:354-404 |
| — | Escritores de PatientAccountService | Solo `patient-account.router` (`crear` + `agregarServicio`, este último sin call-site UI) — seguro de extender como línea de cargo canónica | patient-account.router.ts:88-127 |

## Ajustes al plan docs/48 derivados (aprobados dentro del loop)

- **C3-3 amplía**: agregar discriminador de consumo institucional a `StockMovementType` (o motivo catalogado) — nunca toca cuentas de paciente.
- **C3-4 (nuevo)**: la recepción GS1 (proceso A) debe **upsertar `StockItem`/`StockLot`** en su misma transacción, enlazando por `StockItem.gtin` (no la convención `sku`); sin esto el botiquín no opera con stock real.
- **C4-4 (nuevo)**: columnas estructuradas del 2-eyes de controlados (`witnessUserId`, `controlledJustification`, `isControlled`) en `MedicationDispense` + **reporte "libro de controlados"** (Ley Reguladora de Actividades Relativas a las Drogas).
