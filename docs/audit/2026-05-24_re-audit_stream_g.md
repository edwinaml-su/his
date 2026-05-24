# Re-Audit Stream G — Bitácora / Seguridad / Workflow Designer (2026-05-24)

**Auditor**: @QA — SDET (Re-audit mode)
**Rama**: `chore/ola1-re-audits-y-docs`
**Input**: `docs/audit/2026-05-19_audit_stream_g_*.md`
**Alcance**: 29 hallazgos HG-XX

## Hallazgos cerrados (6/29 = 21%)

| HG | Severidad | PR cierre | Verificación |
|---|---|---|---|
| **HG-05** | P1 ALTO | PR #198 (16a2413) | `certificarBulk` procesa TODO el Set (no solo primer documento); PIN 1× + serie; progress bar; errores granulares. 187 tests pasan. |
| **HG-08** | P0 CRITICO | PR #199 (08484dd) | Router `comiteEce.firmar`: elimina firmaPresidenteId del input. PIN 6-8 dígitos server-side (lookup personal_salud → firma_electronica + argon2id). |
| **HG-10** | P2 MEDIO | PR #199 (08484dd) | UI reemplaza `prompt()` con `FirmarMinutaModal` (Dialog WCAG 2.2 AA). Reemplaza `alert()` con inline formError. 14+4 tests verdes. |
| **HG-16** | P2 MEDIO | PR #197 (081fa31) | Router rectificación `aprobar/rechazar` agrega `pinSchema`; helpers `loadFirmaDir + checkPinDir` argon2id. UI muestra `PinInputModal`. 15 tests nuevos. |
| **HG-18** | P1 ALTO | PR #195 (ee1ed66) | Workflow designer reemplaza `trpc as any` con `workflowTipoDoc.*`, `workflowEstado.estado.*`, `workflowEstado.transicion.*`. Inputs corregidos. |
| **HG-19** | P1 ALTO | PR #195 | Elimina casts `as any` en workflow-designer/[codigo]/page.tsx. Namespaces correctos. |
| **HG-20** | P2 MEDIO | PR #195 | Elimina cast innecesario en workflow-designer/page.tsx. |

## Hallazgos abiertos críticos (bloqueantes go-live)

| HG | Severidad | Descripción | Acción |
|---|---|---|---|
| **HG-24** | P0 CRITICO | MFA dummy en `firma.completeRecovery` | Sprint 0 / Ola 3 |
| **HG-22** | P1 ALTO | `firma.status` falsos positivos | Sprint posterior |
| **HG-28** | P1 ALTO | RLS ARCO sin tenant filter | Ola 3 |

## Hallazgos abiertos no críticos (23 total)

Distribución:
- Bitácora (HG-01..04): filtros + export PDF
- Certificación (HG-06, HG-07): mejoras UX
- Comité (HG-09): policy mejoras
- Calidad doc (HG-11, HG-12): auditoría programa
- Admisiones (HG-13, HG-14): UI mejoras
- Rectificaciones (HG-15, HG-17): notificación + UI
- Workflows runtime (HG-21): performance
- Firma setup (HG-23): UX
- Contingencia (HG-25, HG-29): runbooks
- Retención (HG-26, HG-27): SLA documentado

## Validación auditIntegrityRouter.verifyChain

✅ **FUNCIONAL Y VERIFICADO**:
- `audit.fn_verify_chain(from_id)` con pgcrypto.digest SHA-256
- LOCK TABLE EXCLUSIVE evita race conditions
- BEFORE INSERT calcula signatureHash hex canónico
- `verifyChain` recorre tabla, recalcula cada hash; retorna solo filas rotas
- 6 tests Vitest: cadena íntegra (ok=true, breaks=[]) y rota (ok=false, breaks=[...])
- BigInt serializado como string para JSON

## Validación cadena hash SHA-256 (05_audit_hash_chain.sql)

✅ **IMPLEMENTADO CONFORME TDR §6.3**:
- Algoritmo: `pgcrypto.digest(..., 'sha256') → encode(..., 'hex')`
- Orden canónico: `prevHash | id | action | entity | entityId | beforeJson | afterJson | userId | occurredAt`
- `fn_compute_chain_hash` IMMUTABLE → determinístico
- `coalesce()` de NULLs a '' evita rupturas
- Trigger BEFORE INSERT con LOCK TABLE EXCLUSIVE
- `fn_chain_stats()` optimizado para UI

## Resumen

| Severidad | Total | Cerrados | Abiertos |
|---|---|---|---|
| P0 | 1 | 1 ✅ (HG-08) | 1 abierto crítico (HG-24 MFA) |
| P1 | 9 | 3 ✅ | 6 |
| P2 | 19 | 2 ✅ | 17 |

## Veredicto

**Stream G: PARCIALMENTE APTO PARA GO-LIVE.** Workflow Designer 100% remediado. Audit hash chain operativo. Bitácora funcional pero con gaps de filtrado/export. **HG-24 (MFA dummy) bloqueante** — debe cerrarse en Ola 3 antes de go-live.
