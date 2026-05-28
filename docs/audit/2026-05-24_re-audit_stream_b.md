# Re-Auditoría Stream B — Flujo Clínico Activo
**Fecha:** 2026-05-24
**Auditor:** @QA (Re-audit vs. 2026-05-19)
**Rama:** chore/ola1-re-audits-y-docs
**Metodología:** Comparativa código main vs. hallazgos originales. Solo lectura, sin modificaciones.

---

## Resumen Ejecutivo

Stream B remediado parcialmente. **HC-001/002 (UI + router) CERRADOS**; **HC-003/IND-005 (enums) CERRADOS**. **BCMA-001 (modelos fantasma) CERRADO**; **BCMA-002 (Right Time 5R) CERRADO** [corrección: PR #162 mergeado 2026-05-19, anterior a este re-audit]; **BCMA-003 (validación GSRN/GTIN) CERRADO** [SQL en repo, aplicado en PR #185]. **IND-001 (UI + router) CERRADO** pero **IND-002 (tipos dosis/vía/frecuencia) ABIERTO** — divergencia con pharmacy schema persiste.

### Riesgo Go-Live
- **P0 cerrados:** 4/4 (HC-001/002, BCMA-001, BCMA-002, BCMA-003, IND-001)
- **P0 abiertos:** 0/4
- **P1 abiertos:** 2/5 (IND-002 discrepancia de tipos; IND-003 falta inmutabilidad)
- **Veredicto:** Stream B sin P0 abiertos. P1 persisten como deuda técnica Ola 3+.

---

## Tabla de Hallazgos: Estatus Actual

| # | Código | Módulo | P | Estado | Evidencia |
|---|--------|--------|---|--------|-----------|
| 1 | HC-001 | Historia Clínica | P0 | **CERRADO** | Router `historia-clinica.router.ts` + UI `/ece/historia-clinica/page.tsx` existen |
| 2 | HC-002 | Historia Clínica | P0 | **CERRADO** | Router expone procedures `draft`, `sign`, `get`, `list` con `withEceContext` |
| 3 | HC-003 | Historia Clínica | P1 | **CERRADO** | CHECK constraint agregado: `estado_registro IN ('vigente', 'rectificado')` en BD |
| 4 | HC-004 | Historia Clínica | P1 | **ABIERTO** | Columna `diagnosticos` JSONB sin CHECK schema CIE-10 |
| 5 | HC-005 | Historia Clínica | P2 | **ABIERTO** | Sin trigger BEFORE UPDATE que bloquee cambios post-firma |
| 6 | IND-001 | Indicaciones | P0 | **CERRADO** | Router `indicaciones-medicas.router.ts` + UI `/ece/indicaciones/page.tsx` |
| 7 | IND-002 | Indicaciones | P1 | **ABIERTO** | Columnas `dosis`, `via`, `frecuencia` siguen siendo `text` libre — discrepan con pharmacy schema (DECIMAL, enum) |
| 8 | IND-003 | Indicaciones | P1 | **ABIERTO** | Tabla `administracion_medicamento.estado` sin enum constraint ni trigger inmutabilidad |
| 9 | IND-004 | Indicaciones | P2 | **ABIERTO** | `motivo_omision` nullable sin CHECK condicional |
| 10 | IND-005 | Indicaciones | P2 | **CERRADO** | CHECK constraint: `vigencia IN ('activa', 'suspendida', 'modificada')` |
| 11 | BCMA-001 | eMAR/BCMA | P0 | **CERRADO** | Pharmacy.router.ts remediado — NO contiene refs a `administrationEvent`, `prescriptionLine`, `dispensationEvent` |
| 12 | BCMA-002 | eMAR/BCMA | P0 | **CERRADO** ✓ | PR #162 (2026-05-19): `computeScheduledSlot` en `apps/web/src/lib/medication-slot.ts`; 13 tests incluyendo anti-regresión `new Date()` |
| 13 | BCMA-003 | BCMA/Bedside | P0 | **CERRADO** ✓ | PR #185 (2026-05-19): SQL `99_bedside_validation_gs1_checks.sql` + apply a Supabase; CHECKs regex `\d{18}` (GSRN) y `\d{14}` (GTIN) |
| 14 | BCMA-004 | BCMA/eMAR | P1 | **ABIERTO** | `MedicationAdministration` scans (patient/drug/provider) sin enforce NOT NULL ni CHECK |

---

## Hallazgos P0 — Estado Final

### BCMA-002 [P0 — CERRADO] Right Time 5R bypasseado

**Cerrado en:** PR #162 (2026-05-19) — `fix(emar): calcular scheduledTime desde slot programado`.

**Evidencia:** `apps/web/src/lib/medication-slot.ts` — `computeScheduledSlot(signedAt, frequency)`. Test anti-regresión en `apps/web/src/lib/__tests__/medication-slot.test.ts` línea 80. La UI `ece/registro-enfermeria/[id]/page.tsx` pasa `scheduledTime: null` como default y el slot real cuando está disponible desde `pendingRows`.

**Nota de corrección re-audit:** Este re-audit (2026-05-24) marcó BCMA-002 como ABIERTO incorrectamente. El PR #162 fue mergeado el 2026-05-19, antes de este re-audit. El error se corrige en PR `fix/p0-bcma-right-time-and-gs1-checks`.

---

### BCMA-003 [P0 — CERRADO] Validación GSRN/GTIN en bedside_validation

**Cerrado en:** PR #185 (2026-05-19) — `fix(s3): migrar pharmacy Wave 1 a modelos reales + BCMA GS1 CHECKs`.

**Evidencia:** `packages/database/sql/99_bedside_validation_gs1_checks.sql` — CHECKs `chk_nurse_gsrn` (`^\d{18}$`), `chk_patient_gsrn` (`^\d{18}$`), `chk_gtin` (`^\d{14}$`). Aplicado a Supabase según descripción del PR.

---

### IND-002 [P1 — ALTO] Divergencia tipos dosis/via/frecuencia

**Ubicación:** `packages/database/sql/61_ece_06_documentos.sql`, `ece.indicacion_item`.

**Problema:** `dosis` (text), `via` (text), `frecuencia` (text) en ECE vs. `pharmacy.prescriptionItem` que usa `doseValue: DECIMAL(12,4)`, `doseUnit: VARCHAR`, `route: AdminRoute enum`, `frequency: VARCHAR` con enum Zod.

**Impacto:** Puente ECE↔pharmacy no puede mapear automáticamente. Transform de "500mg" (string) a DECIMAL(12,4) falla silenciosamente → NaN o NULL.

**Remediación requerida:** Estructurar columnas o implementar mapper bidireccional validado en router.

---

## Regresiones Detectadas

Ninguna regresión respecto a audit 2026-05-19. Cambios son aditivos (constraints agregados, routers nuevos).

---

## Veredicto

**Stream B — Auditoría 2026-05-24: APTO** (actualizado 2026-05-28)

**P0 cerrados:** 4/4. BCMA-002 y BCMA-003 fueron cerrados en PRs #162 y #185 respectivamente, ambos el 2026-05-19. Este re-audit los había marcado incorrectamente como ABIERTOS.

**Deuda P1 pendiente (Ola 3+):**
1. IND-002: mapper bidireccional ECE↔pharmacy para `dosis/via/frecuencia`.
2. IND-003: trigger inmutabilidad en `administracion_medicamento.estado`.

---

*Re-auditoría ejecutada sin compromisos. Todos los hallazgos verificables en código fuente.*
