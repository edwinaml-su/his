# Remediación de cumplimiento GS1 El Salvador — HIS Multipaís

**Fecha:** 2026-06-16
**Norma:** Guía GS1 El Salvador v2.0 — *Arquitectura y Gestión de Datos de Insumos y Medicamentos* (MDM 3 niveles).
**Alcance:** cierre de las brechas detectadas en la auditoría del mismo día.

## Dictamen

| | Antes | Después |
|---|---|---|
| Cumplimiento estimado | ~65% (parcial) | ~98% (GDSN diferido) |
| Bloqueantes 🔴 | 3 (jerarquía empaque, enlace GTIN↔inventario, GDSN) | 1 (GDSN, push-back aprobado) |

Las dos bloqueantes técnicas (jerarquía de empaque y enlace GTIN↔inventario) quedan cerradas. GDSN se difiere como push-back arquitectónico.

## PRs ejecutados (commits locales, sin push)

| Commit | PR | Resumen | SQL |
|---|---|---|---|
| 45fb15b | PR-0 | Des-drift modelo Prisma `EceGs1Gtin` (4→17 columnas; `codigo` ≠ `gtin`); `ece.gs1_gtin` = catálogo Nivel 2 canónico | — |
| 513284d | PR-1 | Jerarquía de empaque recursiva (Caja→Blister→Unidosis) + factor de conversión + helper CTE | 169 |
| 1c047e4 | PR-2 | Enlace GTIN↔inventario: `StockItem.gtin` (FK), `StockLot/Movement.gtin_fisico` | 170 |
| 8cb6dc8 | PR-3 | `StockLot.quality_status` + bloqueo de salida si cuarentena/recall/caducado | 171 |
| f5b45af | PR-4 | `DrugClassifier` N:M (ATC/SNOMED/UNSPSC/RxNorm) + router | 172 |
| e9a6c00 | PR-5 | EPCIS logística: subtipos RECEPTION/QUARANTINE/STORAGE/FRACTIONATION + `buildLogisticsEvent` | 173 |
| c1f98b2 | PR-6 | `Drug.margin_tolerance` + helpers `buildInternalGtin` / `buildGs1DataMatrix` | 174 |

## Matriz de cumplimiento por nivel

- **Nivel 1 (Clínico):** principio activo, forma, concentración ✅; **margen de tolerancia ✅ (nuevo)**; **mapeo N:M ATC+SNOMED+UNSPSC ✅ (nuevo)**.
- **Nivel 2 (Comercial/GTIN):** GTIN-14 + mod-10 ✅; **jerarquía recursiva padre→hijo + conversión ✅ (nuevo)**; FK al Nivel 1 ✅; GTIN interno unidosis ✅ (helper).
- **Nivel 3 (Inventario):** lote, vencimiento, FEFO ✅; **GTIN físico ✅ (nuevo)**; **estado de calidad cuarentena/recall ✅ (nuevo)**; EPCIS farmacia/bedside ✅ + **logística ✅ (nuevo)**.

## Verificación

- `npm run typecheck`: **7/7 workspaces verde**.
- Suite `@his/trpc` + `@his/contracts`: **4131 tests verde, 0 fallos** (incluye ~26 nuevos).

## Aplicación a Supabase (pendiente, deliberada)

Los SQL **169–174** NO se aplicaron a producción (flujo del proyecto: aplicación manual vía MCP/SQL Editor). Aplicar en orden con `mcp__supabase__apply_migration`. Todos son idempotentes. Tras aplicarlos, regenerar tipos no es necesario (el modelo Prisma ya está sincronizado).

## GDSN — push-back aprobado

La sincronización con un Data Pool GDSN certificado (Sinapsis u otro) **no se implementa nativa**: requiere contrato externo y es un servicio dedicado, mismo patrón que HL7/FHIR/DICOM (§28) y DTE Hacienda (§23). El catálogo `ece.gs1_gtin` queda API-ready (tRPC modular) para consumir GDSN cuando se provisione.

## Integración incremental (capacidad lista, cableado pendiente)

- **Emisión EPCIS logística por punto:** `buildLogisticsEvent` existe; cablear la emisión en `gs1-proceso-a/b/c` e `inventory.movement` requiere mapeo `establishmentId→GLN` en el contexto del router.
- **GTIN interno en fraccionamiento:** `buildInternalGtin`/`buildGs1DataMatrix` listos; cablear en `gs1-proceso-c` (reemplazar el código `UD-N`+QR-JSON).
- **`marginTolerance` en UI/input:** columna y modelo listos; exponer en `drugCreateInput` + formulario.
- **Enforce FK Nivel2→Nivel1:** `id_clinico_rel` nullable; promover a NOT NULL tras backfill de datos reales.
- **Consolidación `MedicationGtin`→`ece.gs1_gtin`:** documentada; `MedicationGtin` sigue como caché bedside.
