# JCI Compliance Test Suite

> Tests que validan **cumplimiento normativo** Joint Commission International (JCI 7th Edition).

## Por qué un suite separado

Estos tests NO son tests funcionales — son **gates regulatorios**. Su lógica:

- Fallar un compliance test es **bloqueo de release** (no un bug de sprint)
- Validan invariantes que el surveyor JCI verificará: "todo `MedicationAdministration` debe tener los 5R", "todo `documento_instancia` firmado debe tener `firma_id` no nulo", etc.
- Se ejecutan en CI separado (`.github/workflows/compliance.yml`)
- Bloquean merges a `main` desde branches `feat/jci-*`

## Estructura

```
packages/trpc/src/compliance/
  __tests__/
    ipsg1-patient-id.test.ts        — IPSG.1 (2 identificadores + check digits)
    ipsg2-readback.test.ts          — IPSG.2 (read-back órdenes verbales)
    ipsg3-high-alert.test.ts        — IPSG.3 (medicamentos alto riesgo)
    ipsg4-who-checklist.test.ts     — IPSG.4 (WHO Surgical Safety 3 pausas)
    ipsg5-hand-hygiene.test.ts      — IPSG.5 (hand hygiene compliance)
    ipsg6-falls.test.ts             — IPSG.6 (tamizaje caídas ≤24h)
    mmu6-bcma.test.ts               — MMU.6 (BCMA 5R completo)
    moi13-esign.test.ts             — MOI.13 (firma electrónica argon2id)
    moi14-audit-chain.test.ts       — MOI.14 (cadena SHA-256 sin rupturas)
    pci-bundle.test.ts              — PCI bundles + surveillance IAAS
    pfe-teachback.test.ts           — PFE.3 (teach-back verification)
    sqe-credential.test.ts          — SQE.9-12 (credencial vigente bloquea ops clínicas)
    rls-smoke-jci.test.ts           — RLS smoke para schemas nuevos JCI
```

## Convención de naming

| Patrón | Significado |
|---|---|
| `{capítulo}{número}-{tema}.test.ts` | Test compliance directo de un standard JCI |
| `cross-{tema}.test.ts` | Validación transversal (eg. audit chain) |
| `rls-smoke-{schema}.test.ts` | Smoke RLS para un schema nuevo |

## Cómo ejecutar

```bash
# Suite completa (local)
npx vitest run --project compliance

# Un test específico
npx vitest run packages/trpc/src/compliance/__tests__/ipsg4-who-checklist.test.ts

# Modo watch para desarrollo
npx vitest packages/trpc/src/compliance/__tests__/
```

## Definition of Done JCI (D-JCI-1)

Un PR JCI no puede mergearse si **algún** test compliance del standard que cubre falla. Verificación en `.github/workflows/compliance.yml`.

## Test users adicionales

Ver `packages/database/scripts/seed-test-users.mjs` — Sprint 0 de la Fase JCI agrega:
- `qa.infection.control@his.test` (rol `INFECTION_CONTROL_NURSE`)
- `qa.epidemiologo@his.test` (rol `EPIDEMIOLOGIST`)
- `qa.educator@his.test` (rol `PATIENT_EDUCATOR`)
- `qa.paciente.portal@his.test` (rol `PATIENT`)
- `qa.qps.manager@his.test` (rol `QPS_MANAGER`)
- `qa.comite.credencialing@his.test` (rol `CREDENTIALING_COMMITTEE`)
- `qa.director.medico@his.test` (rol `MEDICAL_DIRECTOR`)

## Referencias

- `docs/33c_matriz_trazabilidad_jci.md` — qué test cubre qué standard/ME
- `docs/33_fase_jci_planning.md` § Estrategia testing @QA — política completa
- JCI Hospital Accreditation Standards 7th Edition (2021)
