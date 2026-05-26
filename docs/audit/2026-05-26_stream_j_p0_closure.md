# Cierre Stream J P0 — HJ-04 + HJ-06

**Fecha verificación:** 2026-05-26  
**Verificado por:** @Dev  
**Estado:** CERRADO

---

## Hallazgos verificados

### HJ-04 — Queries `bitacora_acceso` sin filtro de tenant (P0 CRITICO)

**Resuelto en:** PR #224 (`cedbca4`) — 2026-05-24  
**Mecanismo de cierre:** Se introdujo la constante `ORG_JOIN` en `audit-outlier.router.ts` que hace JOIN explícito `ece.bitacora_acceso → ece.establecimiento → ece.institucion` y filtra por `i.organization_id = $1::uuid` en las 4 procedures afectadas: `listOutliers`, `dashboardStats`, `topUsers`, `sensitiveAccess`.

### HJ-06 — `scanAndFlag` UPDATE sin filtro de tenant (P0 CRITICO)

**Resuelto en:** PR #224 (`cedbca4`) — 2026-05-24  
**Mecanismo de cierre:** El UPDATE en `scanAndFlag` usa `FROM ece.establecimiento est JOIN ece.institucion i ON est.institucion_id = i.id` con `AND i.organization_id = ${orgPlaceholder}::uuid` en la cláusula WHERE, garantizando que el escaneo solo afecta registros de la organización del caller.

---

## Verificación técnica

Archivo: `packages/trpc/src/routers/audit-outlier.router.ts`

- Líneas 78–81: constante `ORG_JOIN` (JOIN defensivo)
- Líneas 148–150: `listOutliers` filtra por `i.organization_id = $1::uuid`
- Líneas 268–288: `scanAndFlag` UPDATE incluye `i.organization_id = ${orgPlaceholder}::uuid`
- Líneas 304–305: `dashboardStats` filtra por `i.organization_id = $1::uuid`
- Líneas 357–360: `topUsers` filtra por `i.organization_id = $1::uuid`
- Líneas 381–383: `sensitiveAccess` filtra por `i.organization_id = $1::uuid`

PR #224 mergeado a `main` el 2026-05-24. Confirmado con `git merge-base --is-ancestor`.

---

## Nota sobre re-audit 2026-05-24

El documento `docs/audit/2026-05-24_re-audit_stream_j.md` marcó ambos hallazgos como "ABIERTO — SIN CORREGIR", pero el PR #224 fue mergeado el mismo 2026-05-24 a las 17:08 -0600. El re-audit se generó antes del merge; los hallazgos estaban ya en proceso de corrección en esa misma sesión.
