# 27 — Coverage Baseline (Wave DoD.0)

**Proyecto:** HIS Multipaís — Inversiones Avante
**Autor:** @QA — QA Automation Engineer (SDET)
**Fecha del snapshot:** 2026-05-16
**Rama medida:** `dod/0-baseline-coverage-a11y` (head = main + Beta.15/16/17 merged)
**Propósito:** Primera medición real post-Beta.18. Desbloquea EV-DoD de 0 % a positivo.

> Referencia de thresholds (CLAUDE.md §Vitest):
> - Lines ≥ 80 % | Functions ≥ 80 % | Branches ≥ 75 % | Statements ≥ 80 %

---

## 1. Método de medición

El comando `npm run test:coverage` raíz falla por dos bugs pre-existentes
(no relacionados con este wave):

1. **E2E specs incluidos por Vitest** — el modo `projects` del vitest raíz no
   respeta el `exclude: ["e2e/**"]` del vitest de `apps/web`, causando que
   Playwright specs sean parseados como Vitest tests.
2. **`notifications-badge.test.tsx`** — se ejecuta con ambiente `node` en lugar
   de `jsdom` por colisión del modo `projects`. Bug introducido en Beta.15
   (US.B15.3.2).

Por esta razón los números se obtuvieron **por workspace individualmente**
desde el directorio de cada paquete:

```bash
cd packages/contracts  && npm test -- --coverage
cd packages/trpc       && npm test -- --coverage
cd packages/infrastructure && npm test -- --coverage
cd apps/web            && npm test -- --coverage
```

Los tests **pasan** en todos los workspaces cuando se ejecutan así (1655 passing
en el run raíz, con los 3 fallos atribuibles a los bugs arriba descritos).

---

## 2. Resumen por workspace

| Workspace | Tests passing | Lines % | Functions % | Branches % | Statements % | Threshold (L/F/B/S) | Estado |
|---|---|---|---|---|---|---|---|
| `packages/contracts` | 967 / 967 | 78.82 % | 52.85 % | 95.88 % | 78.82 % | 30/8/70/30 (rebajados) | ✅ pasa |
| `packages/trpc` | 613 / 622 (9 skip) | 78.11 % | 72.54 % | 86.93 % | 78.11 % | (sin threshold local explícito) | ⚠️ bajo global |
| `packages/infrastructure` | 63 / 63 | 86.26 % | 96.00 % | 76.07 % | 86.26 % | (sin threshold local explícito) | ✅ sobre global |
| `apps/web` | 6 / 6 (solo unit) | 5.97 % | 43.47 % | 66.66 % | 5.97 % | 0/30/30/0 (rebajados) | ⚠️ declarado bajo |

### Coverage global estimado (ponderado por LOC)

El modo raíz con `--coverage` no termina exitosamente (bugs arriba). La
estimación ponderada con base en los números por workspace:

| Métrica | Estimación | Threshold CI (CLAUDE.md) | Estado global |
|---|---|---|---|
| Lines | ~72 % | 80 % | ❌ BAJO |
| Functions | ~66 % | 80 % | ❌ BAJO |
| Branches | ~88 % | 75 % | ✅ OK |
| Statements | ~72 % | 80 % | ❌ BAJO |

**Diagnóstico:** Las 3 métricas en rojo están arrastradas por `apps/web` (5.97 %
lines) y por schemas sin tests en `packages/contracts` (schemas `abac`, `allergy`,
`audit`, `auth`, `break-glass`, `catalog`, `consent`, `country`, etc. — todos en
0 % porque no hay test file dedicado). `packages/trpc` también contribuye con
routers sin tests (ver sección 3).

---

## 3. Top 10 archivos con menor coverage (prioridad de remediación)

Ordenados por impacto: volumen de LOC × criticidad clínica.

| # | Archivo | Lines % | Razón de criticidad | LOC aprox |
|---|---|---|---|---|
| 1 | `packages/trpc/src/routers/mfa.router.ts` | 0 % | Seguridad: 2FA/MFA — riesgo alto sin tests | 405 |
| 2 | `packages/trpc/src/routers/rbac.router.ts` | 0 % | Seguridad: control de acceso por rol | 347 |
| 3 | `packages/trpc/src/routers/audit.router.ts` | 0 % | Regulatorio: integridad de la cadena de auditoría | 199 |
| 4 | `packages/trpc/src/routers/ledger.router.ts` | 0 % | Financiero: contabilidad multi-libro (Beta.18) | 473 |
| 5 | `packages/contracts/src/schemas/mfa.ts` | 0 % | Seguridad: schemas Zod de MFA sin tests | 121 |
| 6 | `packages/contracts/src/schemas/notifications.ts` | 0 % | Beta.15: schemas del sistema de alertas | 178 |
| 7 | `packages/contracts/src/schemas/password.ts` | 0 % | Seguridad: validación de contraseñas | 226 |
| 8 | `packages/trpc/src/routers/locale.router.ts` | 0 % | Localización SV: feriados, moneda, idioma | 117 |
| 9 | `packages/trpc/src/context.ts` | 0 % | Infraestructura: contexto tRPC (tenant + RLS) | 42 |
| 10 | `packages/trpc/src/routers/newborn.router.ts` | 45.85 % | Clínico: neonatos / partos sin tests completos | 294 |

**Nota:** `apps/web/src/lib/**` y `apps/web/src/components/**` tienen coverage
5.97 % lines pero se midieron solo contra el 1 test de componente existente
(`notifications-badge.test.tsx`, que además falla en el run raíz por bug de
config). El bajo coverage de `apps/web` es declarado y esperado hasta Sprint 5+.

---

## 4. Análisis de gaps por workspace

### 4.1 `packages/contracts` — 78.82 % lines

**Pasa** el threshold rebajado (30 %) pero **no** el threshold global CI (80 %).

Causa: los schemas Zod de módulos sin test dedicado arrastran el promedio.
Solo los schemas con `__tests__/` dedicado (bed, ehr-notes, emergency, encounter,
imaging, insurance, inventory, lis, medication-admin, nutrition, outpatient,
patient, pharmacy, respiratory, services-equipment, surgery, triage) tienen
coverage. Los schemas sin test (21 archivos) aportan 0 %.

Plan: Wave DoD.2 — tests para los 5 schemas de mayor criticidad:
`notifications.ts`, `mfa.ts`, `password.ts`, `consent.ts`, `rbac.ts`.

### 4.2 `packages/trpc` — 78.11 % lines

**Pasa** los routers con tests (la mayoría de módulos clínicos Beta.1-14
tienen tests de integración). Los routers en 0 % son los de seguridad
y financiero que no tenían hardening dedicado:

- `mfa.router.ts` (0 %) — sin test
- `rbac.router.ts` (0 %) — sin test
- `audit.router.ts` (0 %) — sin test
- `ledger.router.ts` (0 %) — Beta.18, sin test
- `locale.router.ts` (0 %) — sin test
- `context.ts` (0 %) — sin test

Routers con coverage bajo-medio que necesitan mejora:
- `newborn.router.ts` (45.85 %) — branches sin cubrir
- `encounter-catalog.router.ts` (44.5 %) — paths de error no cubiertos
- `encounter-transfer.router.ts` (44 %) — flujos de traslado parciales

### 4.3 `packages/infrastructure` — 86.26 % lines

**Cumple** el threshold global. Un solo gap:
- `observability/logger.ts` (0 %) — adaptador de logging sin test

### 4.4 `apps/web` — 5.97 % lines

**Declarado intencional** (threshold local rebajado a 0 % lines / 30 % functions).
El único test de componente existente (`notifications-badge.test.tsx`) falla en el
run raíz por bug de ambiente jsdom/node — pasa correctamente en run por workspace.
Pendiente hasta Sprint 5+.

---

## 5. Bugs pre-existentes identificados (no introducidos por este wave)

### BUG-DOD-001 — Vitest raíz incluye E2E specs (severidad: HIGH)
- **Archivo afectado:** `vitest.config.ts` raíz — modo `projects`
- **Síntoma:** `apps/web/e2e/*.spec.ts` procesados por Vitest, causando
  error "Playwright Test did not expect test.describe() to be called here."
- **Afecta:** `npm run test:coverage` desde raíz — no genera reporte
- **No en lista prohibida:** el `vitest.config.ts` raíz puede modificarse
- **Remediación:** agregar `exclude: ["**/e2e/**"]` al nivel raíz de `projects`
  o mover `apps/web` a configuración con `testPathPattern` que excluya e2e.
  Pendiente de Wave DoD.1 o fix independiente.

### BUG-DOD-002 — `notifications-badge.test.tsx` corre en ambiente `node` (severidad: MEDIUM)
- **Archivo afectado:** `apps/web/src/components/__tests__/notifications-badge.test.tsx`
- **Síntoma:** `ReferenceError: document is not defined` — el test requiere jsdom
  pero corre en node en el modo `projects` raíz.
- **Causa raíz:** colisión entre la config raíz (sin environment) y la de
  `apps/web` (environment: jsdom). En el run por workspace pasa correctamente.
- **Remediación:** añadir `@vitest-environment jsdom` como comentario docblock
  al archivo de test, o corregir la config raíz para que el proyecto `web`
  herede correctamente el ambiente.

---

## 6. Plan de remediación

| Wave | Acción | Impacto estimado en coverage | Propietario |
|---|---|---|---|
| DoD.1 (próxima) | Fix BUG-DOD-001 + BUG-DOD-002 para que `npm run test:coverage` raíz funcione | Habilita medición oficial en CI | @QA |
| DoD.1 | Tests para `mfa.router.ts`, `rbac.router.ts`, `audit.router.ts` | +3-5 % global lines | @QA |
| DoD.2 | Tests para schemas sin cobertura (`notifications.ts`, `mfa.ts`, `password.ts`, `consent.ts`) | +2-4 % global lines/functions | @QA |
| DoD.2 | Tests para `locale.router.ts` (feriados SV — feature BDD sin tests) | +0.5 % + cierra GAP-7 | @QA |
| DoD.3 | Tests de componentes React en `apps/web` (Budget Sprint 5+) | +10-20 % lines web | @Dev + @QA |
| DoD.3 | `ledger.router.ts` tests (Beta.18 contabilidad) | +2 % global lines | @QA |

**Meta:** llevar coverage global estimado de ~72 % a ≥ 80 % en Lines/Functions
tras Wave DoD.1 + DoD.2 (~5 días de trabajo).

---

## 7. Comandos de referencia

```bash
# Por workspace (funciona ahora, sin bugs):
npm run -w @his/contracts test -- --coverage
npm run -w @his/trpc test -- --coverage
npm run -w @his/infrastructure test -- --coverage
npm run -w @his/web test -- --coverage

# Raíz (NO funciona hasta que se resuelva BUG-DOD-001):
npm run test:coverage
```

---

*Próxima revisión: Wave DoD.1 — tras fix BUG-DOD-001 y tests de mfa/rbac/audit.*
