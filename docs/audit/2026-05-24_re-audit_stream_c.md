# Re-Audit Stream C — Defunción (2026-05-24)

**Auditor**: @QA — SDET (Re-audit mode)
**Rama**: `chore/ola1-re-audits-y-docs`
**Input**: `docs/audit/2026-05-19_audit_stream_c_cierre_cumplimiento.md`
**Alcance**: hallazgos B-01..B-08

## Estado de hallazgos

| ID | Severidad original | Estado 2026-05-24 | Evidencia |
|---|---|---|---|
| **B-01** | P0 schema drift | ✅ CERRADO | `99_certificado_defuncion_workflow.sql` L5-13 agrega todas las 7 columnas (estado_workflow, firmado_en, validado_en, certificado_en, anulado_en, payload_hash, medico_firmante_id) |
| **B-02** | P1 RLS sin demote | ✅ CERRADO | `certificado-defuncion.router.ts` L363/480/588 usa `withWorkflowContext()` en todas las mutaciones |
| **B-03** | P1 firma doble sin PIN | ✅ CERRADO | `validarCertDefInput` requiere `firmaPin: pinSchema`; `verifyPin()` con argon2id en L564-566 |
| **B-04** | P1 validación tipo_egreso | ✅ CERRADO | L379-397: valida explícitamente `tipo_egreso === "fallecido"` |
| **B-05** | P1 legacy inmutabilidad + audit | ✅ CERRADO | `99_death_certificate_immutability.sql` trigger `fn_bloquea_death_certificate()` + `basicCauseCode NOT NULL` |
| **B-06** | P2 dos sistemas paralelos | ⚠️ ABIERTO | Coexisten `death-certificate.router.ts` (legacy) y `eceCertDefRouter` sin bridge ni sunset |
| **B-07** | P2 CIE-10 hardcodeado | ⚠️ PARCIAL | Lista local `CIE10_COMUNES` (10 ítems) en `nueva/page.tsx` L25-36; sin integración `trpc.icd10.search` |
| **B-08** | P2 parseo frágil CIE-10 | ⚠️ MITIGADO | `split(" ")[0]` mantenido pero entrada formateada controladamente |

## Verificaciones críticas

### Inmutabilidad CERT_DEF post-firma
✅ Trigger `ece.fn_bloquea_mutacion_certdef()` (L16-23 SQL) — bloquea UPDATE/DELETE solo si `estado_workflow IN ('firmado','validado','certificado','anulado')`. Permite borrador editable.

### Workflow triple firma argon2id
✅ Cadena MC firma → MC valida → DIR certifica. Cada paso requiere `pinSchema` + `verifyPin()` con argon2id. `resolvePersonal()` (L237-255) obtiene pin_hash de `ece.firma_electronica`.

## Resumen

| Severidad | Total | Cerrados | Pendientes |
|---|---|---|---|
| P0 | 1 | 1 ✅ | 0 |
| P1 | 4 | 4 ✅ | 0 |
| P2 | 3 | 0 | 2 abiertos + 1 mitigado |

## Veredicto

**Stream C: APTO PARA GO-LIVE** con observaciones menores (B-06 bridge legacy, B-07 catálogo CIE-10 completo) — no bloquean operación.

**Pendiente sprint posterior**: definir sunset legacy `death-certificate.router.ts` o bridge formal hacia ECE.
