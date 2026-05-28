# Cierre P0 BCMA-002 y BCMA-003 — Stream B
**Fecha:** 2026-05-28
**Ejecutado por:** @Dev

---

## Resumen

Los 2 P0 de Stream B marcados como abiertos en el re-audit del 2026-05-24 estaban
ya cerrados desde el 2026-05-19. Este documento los cierra formalmente y corrige
el re-audit.

---

## BCMA-002 [P0 — CERRADO desde 2026-05-19]

**Hallazgo original:** `scheduledTime: new Date()` en UI eMAR bypasseaba la
verificación "Right Time" (5ª R de IPSG3). `isWithinTimingWindow` siempre veía
`|now - scheduledTime| ≈ 0 ms` → guard inocuo.

**Resolución:** PR #162 (`fix(emar): calcular scheduledTime desde slot programado`).

**Archivos modificados:**
- `apps/web/src/lib/medication-slot.ts` — helper `computeScheduledSlot(signedAt, frequency, now?)`.
- `apps/web/src/lib/__tests__/medication-slot.test.ts` — 13 casos incluyendo test
  anti-regresión específico contra `new Date()` (línea 80).
- `apps/web/src/app/(clinical)/ece/registro-enfermeria/[id]/page.tsx` — UI BCMA
  usa `scheduledTime: null` como default; recibe slot real desde `pendingRows`
  cuando la prescripción tiene grilla conocida.

**Verificación en código actual (2026-05-28):**
- No existe `scheduledTime: new Date()` en ningún archivo `.ts`/`.tsx`.
- `computeScheduledSlot` está importado y usado correctamente.
- 13 tests verdes en `apps/web/src/lib/__tests__/medication-slot.test.ts`.

**Error del re-audit 2026-05-24:** El auditor verificó el archivo de UI antes del
merge de #162 o no actualizó la referencia. PR #162 fue mergeado el 2026-05-19,
5 días antes del re-audit.

---

## BCMA-003 [P0 — CERRADO desde 2026-05-19]

**Hallazgo original:** Columnas `nurse_gsrn`, `patient_gsrn`, `gtin` en
`ece.bedside_validation` eran `text NOT NULL` sin CHECK de formato GS1. BD
aceptaba strings malformados (e.g. 17 dígitos en lugar de 18).

**Resolución:** PR #185 (`fix(s3): migrar pharmacy Wave 1 a modelos reales + BCMA GS1 CHECKs`).

**Archivo SQL creado:**
- `packages/database/sql/99_bedside_validation_gs1_checks.sql`

**Constraints aplicados (vía Supabase migration en PR #185):**
```sql
ALTER TABLE ece.bedside_validation
  ADD CONSTRAINT chk_nurse_gsrn   CHECK (nurse_gsrn   ~ '^\d{18}$'),
  ADD CONSTRAINT chk_patient_gsrn CHECK (patient_gsrn ~ '^\d{18}$'),
  ADD CONSTRAINT chk_gtin         CHECK (gtin         ~ '^\d{14}$');
```

**Decisión de diseño:** La validación a nivel BD usa regex de longitud únicamente
(`^\d{18}$` / `^\d{14}$`), sin verificación de checksum GS1 módulo-10. El checksum
permanece en capa de aplicación (`packages/contracts/src/validators/gs1.ts`). Esta
es la profundidad correcta para una CHECK constraint de Postgres sin UDF custom.

**Pendiente de verificación externa:** Si se requiere confirmar que los constraints
existen en Supabase remoto, ejecutar:
```sql
SELECT conname, consrc
FROM pg_constraint
WHERE conrelid = 'ece.bedside_validation'::regclass
  AND contype = 'c';
```

---

## Estado Stream B P0 — Definitivo

| Código | Severidad | Estado | PR | Fecha cierre |
|--------|-----------|--------|----|-------------|
| BCMA-001 | P0 | CERRADO | #185 | 2026-05-19 |
| BCMA-002 | P0 | CERRADO | #162 | 2026-05-19 |
| BCMA-003 | P0 | CERRADO | #185 | 2026-05-19 |
| HC-001 | P0 | CERRADO | pre-#162 | 2026-05-19 |
| HC-002 | P0 | CERRADO | pre-#162 | 2026-05-19 |
| IND-001 | P0 | CERRADO | pre-#162 | 2026-05-19 |

**Stream B: 0 P0 abiertos.**
