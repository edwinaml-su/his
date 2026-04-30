# 09 — Estrategia de Pruebas (HIS Multipaís)

> Autor: @QA — QA Automation Engineer (SDET)
> Fecha: 2026-04-30
> Referencias: TDR §29.6 (cobertura ≥ 80 %), `05_backlog.md`, `08_devops.md`.

## 1. Pirámide de pruebas

```
                  ┌──────────────┐
                  │  E2E (10 %)  │  Playwright + axe
                  └──────────────┘
            ┌──────────────────────────┐
            │ Integración (20 %) tRPC  │  Vitest + vitest-mock-extended
            └──────────────────────────┘
   ┌────────────────────────────────────────┐
   │ Unitarias (70 %) validators + Zod + UI │  Vitest
   └────────────────────────────────────────┘
```

La pirámide se respeta por **cantidad** (no por minutos de ejecución):
las pruebas unitarias son la mayoría, baratas y rápidas; los E2E son
pocos pero cubren los flujos críticos del MVP.

## 2. Cobertura objetivo por workspace

| Workspace            | Cobertura líneas | Cobertura branches | Notas |
|----------------------|------------------|---------------------|-------|
| `packages/contracts` | ≥ 90 % (validators 100 %) | ≥ 85 % | Lógica pura crítica. |
| `packages/trpc`      | ≥ 75 %                    | ≥ 70 % | Routers con Prisma mockeado. |
| `apps/web`           | ≥ 70 % (lib + componentes) | ≥ 65 % | E2E cubren los flujos no medibles por unit. |
| **Global (root)**    | **≥ 80 %**                | **≥ 75 %** | Threshold del CI. |

Excluidos del cómputo: archivos `index.ts` de re-export, `*.config.ts`,
`prisma/seed.ts`, `prisma/migrations/**`, `e2e/**` y archivos `*.d.ts`.

## 3. Estrategia de datos de prueba

- **Cero PII real.** Todos los nombres y DUIs/NITs son sintéticos.
- Los DUIs/NITs **válidos** se generan calculando el dígito verificador
  con el mismo algoritmo que `validate_dui` / `validate_nit` en
  `packages/database/prisma/migrations/sql/03_validations_sv.sql`.
  La función generadora vive en
  `packages/test-utils/src/fixtures/dui-fixtures.ts`.
- Para E2E se usa la BD `his_test` (DSN debe contener literalmente la
  palabra `test`; el helper `openTestDatabase` rechaza arrancar si no).
- Aislamiento: `reset()` trunca tablas transaccionales antes de cada
  suite, y `seedMinimal()` rehidrata el catálogo y los datos básicos.

## 4. Estrategia de paridad SQL ↔ TS

El validador de identificadores existe en dos lugares:

1. **TS** (`packages/contracts/src/validators/index.ts`) — usado por Zod
   y por la UI antes del round-trip al server.
2. **SQL** (`03_validations_sv.sql`) — trigger `BEFORE INSERT/UPDATE` en
   `PatientIdentifier` que actúa como red de seguridad si alguien
   bypassa el frontend.

La matriz `IDENTIFIER_PARITY_MATRIX` en
`packages/test-utils/src/fixtures/dui-fixtures.ts` es la fuente de
verdad de fixtures. Si alguna vez se modifica una de las dos fórmulas:

1. Actualizar la matriz.
2. Correr `npm run -w @his/contracts test`. Si falla → reconciliar.
3. Migración manual del snapshot SQL: `psql -f 03_validations_sv.sql` y
   verificar contra los mismos fixtures (test manual de paridad descrito
   en `docs/08_devops.md`, sección "Migraciones SQL").

> En Fase 5 se automatizará la paridad ejecutando la matriz contra una
> instancia Postgres efímera (Docker) en el CI.

## 5. Tests de carga (Fase 6 — fuera del MVP)

**No se automatizan en MVP.** Plan para Fase 6:

- **Herramienta:** k6 (preferida) o Artillery.
- **Escenarios mínimos:**
  - `mpi-search`: 100 RPS sostenidos, p95 < 300 ms.
  - `bed-map`: 50 RPS, p95 < 500 ms (incluye joins).
  - `triage-create`: 20 RPS, p99 < 800 ms.
- **Criterios:** sin errores 5xx; CPU < 70 %; memoria estable.
- Los scripts vivirán en `infra/perf/`. Se ejecutan en un entorno
  staging dedicado, nunca en producción.

## 6. Tests de seguridad (Fase 5 / SRE)

**Marcados como "manual / Fase 5"** — el MVP no los automatiza:

- **RLS leak:** verificar que un usuario de la organización A no puede
  leer pacientes de la organización B vía endpoints tRPC manipulados.
  Plan: pentest con Burp + script de fuzzing de tokens. Owner: @SRE.
- **SQL injection:** Prisma parametriza queries; aún así se hace pentest
  sobre los pocos `$executeRawUnsafe` (auditoría triggers, `reset()`
  helper) y los inputs Zod con caracteres extraños.
- **XSS:** React escapa por defecto, pero los campos `notes`,
  `reason`, `overrideJustification` deben pasar pruebas con payloads
  conocidos. axe-core no cubre XSS; se usará OWASP ZAP en Fase 5.

## 7. Test traceability matrix (resumen)

| User Story (backlog)              | Tipo  | Test/Archivo                                                        |
|-----------------------------------|-------|---------------------------------------------------------------------|
| AUTH-01 login exitoso             | E2E   | `apps/web/e2e/auth.spec.ts`                                         |
| AUTH-02 login inválido            | E2E   | `apps/web/e2e/auth.spec.ts`                                         |
| AUTH-03 signup deshabilitado      | E2E   | `apps/web/e2e/auth.spec.ts`                                         |
| AUTH-04 logout                    | E2E   | `apps/web/e2e/auth.spec.ts`                                         |
| MPI-01 registrar paciente         | E2E   | `apps/web/e2e/patient-mpi.spec.ts`                                  |
| MPI-02 búsqueda nombre/DUI        | E2E + Int | `patient-mpi.spec.ts` + `patient.router.test.ts`               |
| MPI-03 vista 360°                 | E2E   | `patient-mpi.spec.ts`                                               |
| MPI-04 alergia destacada          | E2E + a11y | `patient-mpi.spec.ts` + `a11y.spec.ts`                         |
| ID-01 validar DUI/NIT/NIE         | Unit  | `packages/contracts/src/validators/__tests__/identifier.test.ts`    |
| ID-02 paridad SQL ↔ TS            | Unit  | `identifier.test.ts` (matriz)                                       |
| ADM-01 admisión                   | E2E + Int | `admission-discharge.spec.ts` + `encounter.router.test.ts`     |
| ADM-02 traslado interno           | E2E + Int | idem                                                            |
| ADM-03 alta médica                | E2E + Int | idem                                                            |
| TRI-01..03 evaluación Manchester  | E2E + Int | `triage-manchester.spec.ts` + `triage.router.test.ts`           |
| TRI-04 alerta nivel rojo          | E2E + a11y | `triage-manchester.spec.ts` + `a11y.spec.ts`                   |
| BED-01 mapa de camas              | E2E + Int | `bed-map.spec.ts` + `bed.router.test.ts`                        |
| BED-02 detalle ocupante           | E2E   | `bed-map.spec.ts`                                                   |
| BED-08 transición de estados      | Int (skip) | `bed.router.test.ts` — pendiente de @Dev                       |
| AUD-01 mutaciones auditadas       | E2E   | `audit-trail.spec.ts`                                               |
| AUD-02 visor de auditoría         | E2E + Int | `audit-trail.spec.ts` + `audit.router` (smoke vía routers)      |
| CAT-01..N CRUD catálogos          | Int   | `catalog.router.test.ts`                                            |
| A11Y-01 WCAG 2.1 AA páginas MVP   | E2E   | `a11y.spec.ts`                                                      |

> El backlog completo (`05_backlog.md`) tiene 74 historias. Las restantes
> (DTE Hacienda, prescripción electrónica con receta digital,
> facturación a aseguradoras, CIE-10 sugerido por NLP) están en fases
> posteriores y se trazarán cuando entren al MVP+1.

## 8. Limitaciones honestas (NO automatizado en MVP)

| Área | Por qué | Cuándo |
|------|---------|--------|
| Integración real con DTE Hacienda | Sandbox DTE requiere acuerdo legal. | Fase 5 — manual primero. |
| Tests de carga reales (k6) | No hay entorno staging dedicado aún. | Fase 6. |
| Pentest RLS / OWASP ZAP / XSS profundo | Requiere ventana con SRE y herramientas externas. | Fase 5 (@SRE). |
| Deduplicación probabilística del MPI | Algoritmo no implementado (Fase 4). | Fase 4. |
| Bed state machine (transiciones legales) | Lógica no implementada en `bed.router`. Test marcado `.skip`. | Sprint siguiente. |
| Tests de carga UI (LCP, CLS) reales | Lighthouse-CI requerido; pendiente de pipeline. | Fase 4. |

## 9. Definition of Done (DoD) por historia

Para que una historia pase de `In Progress` a `Done`:

1. ✅ **Tests passing** en el workspace tocado (`npm run -w <pkg> test`).
2. ✅ **Cobertura ≥ umbral** del workspace (definido en §2).
3. ✅ **A11y axe-core** sin violaciones `serious` o `critical` en la
   página tocada (si la historia toca UI).
4. ✅ **Lint + typecheck** sin warnings nuevos.
5. ✅ Trazabilidad: la historia aparece en la matriz de §7 con archivo
   de test apuntado.
6. ✅ Si la historia introduce regla SQL o trigger, **paridad SQL↔TS**
   verificada por la matriz de fixtures.

## 10. Comandos de referencia

```bash
# Todos los tests del repo (Vitest projects).
npm run test

# Cobertura combinada con thresholds.
npm run test:coverage

# Solo un workspace.
npm run -w @his/contracts test
npm run -w @his/trpc test
npm run -w @his/web test

# E2E Playwright (requiere DB his_test arrancada).
npm run -w @his/web test:e2e

# Solo accesibilidad.
npm run -w @his/web test:a11y
```
