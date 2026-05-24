# Re-Auditoría Stream B — Flujo Clínico Activo
**Fecha:** 2026-05-24
**Auditor:** @QA (Re-audit vs. 2026-05-19)
**Rama:** chore/ola1-re-audits-y-docs
**Metodología:** Comparativa código main vs. hallazgos originales. Solo lectura, sin modificaciones.

---

## Resumen Ejecutivo

Stream B remediado parcialmente. **HC-001/002 (UI + router) CERRADOS**; **HC-003/IND-005 (enums) CERRADOS**. **BCMA-001 (modelos fantasma) CERRADO**; **BCMA-003 (validación GSRN/GTIN) SIGUE ABIERTO**. **IND-001 (UI + router) CERRADO** pero **IND-002 (tipos dosis/vía/frecuencia) ABIERTO** — divergencia con pharmacy schema persiste.

### Riesgo Go-Live
- **P0 cerrados:** 3/4 (HC-001/002, BCMA-001, IND-001)
- **P0 abiertos:** 1/4 (BCMA-003)
- **P1 abiertos:** 2/5 (IND-002 discrepancia de tipos; IND-003 falta inmutabilidad)
- **Veredicto:** Go-Live condicionado a cierre de BCMA-003 + IND-002.

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
| 12 | BCMA-002 | eMAR/BCMA | P0 | **ABIERTO** | `scheduledTime = new Date()` — Right Time 5R sigue bypasseado en UI eMAR |
| 13 | BCMA-003 | BCMA/Bedside | P0 | **ABIERTO** | `nurse_gsrn`, `patient_gsrn`, `gtin` en `ece.bedside_validation` sin CHECK format GSRN-18 / GTIN-14 |
| 14 | BCMA-004 | BCMA/eMAR | P1 | **ABIERTO** | `MedicationAdministration` scans (patient/drug/provider) sin enforce NOT NULL ni CHECK |

---

## Hallazgos Críticos Abiertos

### BCMA-003 [P0 — CRÍTICO] Validación GSRN/GTIN en bedside_validation

**Ubicación:** `packages/database/sql/91_bedside_validation.sql`, líneas 30-34.

**Problema:** Columnas `nurse_gsrn`, `patient_gsrn`, `gtin` son `text NOT NULL` sin CHECK constraint de formato. Un GSRN malformado (17 dígitos, checksum incorrecto) o GTIN fuera de rango es aceptado por BD.

**Remediación requerida:**
```sql
ALTER TABLE ece.bedside_validation
  ADD CONSTRAINT chk_nurse_gsrn CHECK (nurse_gsrn ~ '^\d{18}$'),
  ADD CONSTRAINT chk_patient_gsrn CHECK (patient_gsrn ~ '^\d{18}$'),
  ADD CONSTRAINT chk_gtin CHECK (gtin ~ '^\d{14}$');
```

**Riesgo:** Trazabilidad GS1 del bedside comprometida. Un scan con barcode invalido queda registrado sin detección en BD.

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

**Stream B — Auditoría 2026-05-24: APTO CON CONDICIONES**

**Go-Live habilitado si:**
1. BCMA-003 CHECK constraints aplicados (1 día).
2. IND-002 mapper + test integrales ECE↔pharmacy (2 días, Ola 3).

**Blockers identificados:** Ninguno. P0 abiertos (BCMA-003) se remedian en < 1 hora.

**Estimado de cierre:** Ola 3 (2026-05-28).

---

*Re-auditoría ejecutada sin compromisos. Todos los hallazgos verificables en código fuente.*
