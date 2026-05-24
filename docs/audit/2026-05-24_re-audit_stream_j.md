# Re-auditoría Stream J — Verificación de Hallazgos Críticos

**Fecha:** 2026-05-24  
**Auditor:** @QA — Automatización QA (SDET), Unidad de Transformación Digital, Inversiones Avante  
**Rama:** `chore/ola1-re-audits-y-docs` (basada en `feat/fase2-s1-gate`)  
**Método:** Grep de patterns RLS + verificación de filtros tenant en `audit-outlier.router.ts`  
**Scope:** 5 hallazgos críticos/altos identificados en Stream J (2026-05-19)

---

## Índice

1. [HJ-04 — Cross-tenant read](#hj-04)
2. [HJ-06 — Cross-tenant write](#hj-06)
3. [HJ-20 — TOTP replay](#hj-20)
4. [HJ-30 — PIN texto plano](#hj-30)
5. [HJ-31 — Quorum de roles](#hj-31)
6. [Resumen de estado](#resumen)

---

## HJ-04 — Queries `bitacora_acceso` sin filtro de tenant (P0 CRITICO) {#hj-04}

### Estado actual

**ABIERTO — SIN CORREGIR**

### Verificación

```sql
-- audit-outlier.router.ts:143-147 (listOutliers)
SELECT COUNT(*) AS total 
FROM ece.bitacora_acceso b 
WHERE b.flag_outlier = true
```

**Hallazgo:** No hay cláusula `AND b.organization_id = ...`. Esto permite que un DIR del Hospital A vea accesos registrados en `ece.bitacora_acceso` del Hospital B.

### Líneas afectadas

- `packages/trpc/src/routers/audit-outlier.router.ts:143-147` (listOutliers)
- `packages/trpc/src/routers/audit-outlier.router.ts:264-309` (dashboardStats)
- `packages/trpc/src/routers/audit-outlier.router.ts:314-331` (topUsers)
- `packages/trpc/src/routers/audit-outlier.router.ts:337-379` (sensitiveAccess)

### Recomendación

Añadir filtro `AND b.organization_id = ${ctx.tenant.organizationId}::uuid` en todas las queries SQL de estas 4 procedures.

### Riesgo go-live

**CRITICO**. Violación de aislamiento multi-tenant. Datos de acceso de expedientes de otras organizaciones son visibles al personal de cualquier organización.

---

## HJ-06 — `scanAndFlag` UPDATE sin filtro de tenant (P0 CRITICO) {#hj-06}

### Estado actual

**ABIERTO — SIN CORREGIR**

### Verificación

```sql
-- audit-outlier.router.ts:239-254 (scanAndFlag)
UPDATE ece.bitacora_acceso b
SET flag_outlier = true,
    motivo_outlier = CASE ...
WHERE b.ocurrido_en BETWEEN $1::timestamptz AND $2::timestamptz
  AND b.flag_outlier = false
  AND (... fueraHorario OR ... ipCondition)
```

**Hallazgo:** La cláusula `WHERE` no incluye `b.organization_id = ...`. Un DIR del Hospital A puede ejecutar `scanAndFlag` y marcar accesos del Hospital B como "outlier fuera de horario".

### Líneas afectadas

- `packages/trpc/src/routers/audit-outlier.router.ts:239-256`

### Recomendación

Añadir `AND b.organization_id = ${orgId}::uuid` en la cláusula WHERE del UPDATE.

### Riesgo go-live

**CRITICO**. Escritura cross-tenant. Un usuario malicioso puede contaminar la bitácora de auditoría de otras organizaciones, comprometiendo la integridad de los registros de acceso.

---

## HJ-20 — MFA: Sin protección contra replay de TOTP (P1 ALTA) {#hj-20}

### Estado actual

**ABIERTO — SIN CORREGIR** (verificación informal por código: RFC 6238)

### Descripción

El `verifyTotp` en `apps/web/src/app/actions/mfa.ts:241-253` y `packages/trpc/src/routers/mfa.router.ts:193-205` valida el token contra la ventana `±1 step` (90 segundos). Sin embargo, no hay mecanismo que rechace el reutilización del mismo token dentro de la ventana. RFC 6238 §5.2 recomienda almacenar el último contador y rechazar tokens con contador ≤ anterior.

### Riesgo go-live

**ALTO**. En entornos con MitM interno, un atacante podría capturar el token TOTP y reutilizarlo antes de que expire la ventana.

---

## HJ-30 — PIN enviado como texto plano (P1 ALTA) {#hj-30}

### Estado actual

**ABIERTO — SIN CORREGIR** (verificación informal por código: `firmaDir1.trim()`)

### Descripción

En `apps/web/src/app/(admin)/patients/merge-queue/page.tsx:121-126`, el PIN del Director se envía en texto plano desde el cliente sin hashear. Aunque la UI sugiere "hash" (label `firmaDir1Id`), el código hace `.trim()` sin cifrado.

### Riesgo go-live

**ALTO**. El PIN de autorización de fusión de expedientes (acción irreversible) viaja en texto plano por la red. Si hay intercepción TLS o logging del request, el PIN queda expuesto.

---

## HJ-31 — Sin verificación de quorum de roles (P1 ALTA) {#hj-31}

### Estado actual

**ABIERTO — SIN CORREGIR** (verificación informal por código: cliente sin validación server)

### Descripción

La UI muestra dos campos de PIN (Director + Director Médico) asumiendo dos usuarios distintos. Sin embargo, `patientDedup.confirmEceMerge` envía dos strings `firmaDir1Id` y `firmaDir2Id` sin verificar:
1. Que provengan de usuarios distintos.
2. Que tengan roles distintos (DIR vs DIR_MEDICO).
3. Que no sean el mismo Director firmando dos veces.

### Riesgo go-live

**ALTO**. Un Director podría auto-aprobar fusiones de expedientes llenando ambos campos con su propio PIN, comprometiendo la integridad de la historia clínica del paciente.

---

## Resumen de estado {#resumen}

| HJ-ID | Severidad | Módulo | Título | Hallazgo | Recomendación |
|---|---|---|---|---|---|
| HJ-04 | P0 CRITICO | Audit Outlier | Queries cross-tenant read | ABIERTO | Añadir filtro `organization_id` a 4 procedures SQL |
| HJ-06 | P0 CRITICO | Audit Outlier | UPDATE cross-tenant write | ABIERTO | Añadir filtro `organization_id` a WHERE del UPDATE |
| HJ-20 | P1 ALTA | MFA | Replay TOTP sin contador | ABIERTO | Persistir último counter; rechazar si counter ≤ anterior |
| HJ-30 | P1 ALTA | Merge-Queue | PIN texto plano | ABIERTO | Hashear o implementar challenge-response |
| HJ-31 | P1 ALTA | Merge-Queue | Sin quorum de roles | ABIERTO | Validar server-side: roles distintos, usuarios distintos |

### Conteo por severidad

- **P0 CRITICO:** 2 hallazgos (HJ-04, HJ-06) — ambos en `audit-outlier.router.ts`
- **P1 ALTA:** 3 hallazgos (HJ-20, HJ-30, HJ-31) — MFA, merge-queue

### Impacto agregado

**Bloqueador go-live.** Los 2 hallazgos P0 CRITICO (HJ-04, HJ-06) son violaciones de aislamiento multi-tenant que comprometen la confidencialidad y integridad de datos en toda la plataforma. Los 3 hallazgos P1 ALTA son riesgos de seguridad sistémicos en flujos críticos (autenticación MFA, gestión de expedientes).

**Recomendación:** No liberar a producción sin:
1. Implementar filtros `organization_id` en todas las queries y updates de `ece.bitacora_acceso`.
2. Implementar protección contra replay de TOTP (lastCounter persistido).
3. Hashear o cifrar el PIN en merge-queue.
4. Validar quorum de roles server-side.

---

*Documento generado por @QA el 2026-05-24.*
