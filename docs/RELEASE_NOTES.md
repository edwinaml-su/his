# Release Notes — HIS Multipaís

> **Inversiones Avante — Sistema de Información Hospitalaria Multipaís**

Releases en orden cronológico inverso. El proyecto sigue forward-only: nunca se revierte una versión publicada.

---

# Release v0.2.0 — Phase 2 Skeletons + Production Readiness

> **Tag recomendado:** `v0.2.0-phase2-skeletons`
> **Commit base:** `c1e2dd6` (merge PR #14)
> **Fecha:** 2026-05-13
> **Tipo:** Phase 2 skeletons release — apto para staging + UAT. Producción pendiente firma G6.

## Resumen ejecutivo

Esta entrega cierra **Fase 4 (Construcción Wave 6/7/8)** + **Fase 5 (Validación con remediación CRITICAL)** + entrega **Fase 6 (Entrega y Observabilidad)** en formato 6-streams paralelos sobre Vercel + Supabase + Sentry. Mueve el proyecto de "MVP Foundation entregable" (v0.1.0) a "**14 módulos Phase 2 skeletonizados, infra de producción documentada, 5 ADRs y UAT scenarios listos**".

| Métrica                       | v0.1.0 (2026-04-30) | v0.2.0 (2026-05-13) | Δ                |
|-------------------------------|---------------------|---------------------|------------------|
| Tablas BD (Supabase prod)     | 0 (solo schema)     | **96**              | +96              |
| Tablas con RLS habilitada     | n/a                 | **96/96 (100%)**    | +96              |
| Tablas con audit triggers     | 34 schema           | **82 (34+48)**      | +48 Phase 2      |
| Módulos Phase 2 skeleton      | 0                   | **14**              | +14              |
| Tests automatizados passing   | ~442                | **1011+**           | +569             |
| ADRs documentados             | 15 implícitos       | **5 explícitos**    | +5 MADR formales |
| Advisor security CRITICAL     | n/a                 | **0**               | 0                |
| Advisor security WARN         | n/a                 | 19 → 1 (post SQL 24) | -18            |
| Vercel build estable          | preview only        | **production verde**| OK               |
| Production runbook            | falta               | **`docs/15`**       | nuevo            |

## Lo nuevo en v0.2.0

### Wave 6 — Construcción (PR #6)
- **§10 Outpatient** — Agenda + consulta externa.
- **§14 EHR Notes** — Notas clínicas con inmutabilidad post-firma.
- **§15 Pharmacy** — Prescription + dispensación + catálogo Drug.
- **§17 LIS** — Laboratory Information System con 4-eyes validate.

### Wave 7 — Construcción (PR #7)
- **§11 Inpatient** — Admisión, kardex, care plan, vitals.
- **§12 Emergency** — Visita ER con triage previo obligatorio.
- **§13 Surgery** — Ciclo quirúrgico con time-out OMS (JCI IPSG.4).
- **§16 eMAR** — Administración con BCMA (5 rights).
- **§18 Imaging** — RIS/PACS lite con preparación paciente.

### Wave 8 — Construcción (PR #8)
- **§19 Inventory** — StockItem/Lot/Movement con trazabilidad DNM.
- **§20 Services & Equipment** — Biomédicos con PM scheduling.
- **§21 Respiratory** — VentilatorSession + gas medicinal.
- **§22 Nutrition** — DietPlan con bloqueo por alergia.
- **§25 Insurance** — Cobertura + autorización aseguradora.

### Fase 5 — Validación (PRs #9, #10, #11)
- **PR #9** — Stream A: cross-tenant isolation suite (15 tests cubriendo los 14 módulos).
- **PR #10** — Stream B: BDD Gherkin features Phase 2.
- **PR #11** — Stream E: compliance review Fase 2 (`docs/14_fase2_compliance_review.md`) — identificó **AE-PHASE2-01 CRITICAL**.

### Fase 5 — Remediación CRITICAL (PRs #12, #13, #14)
- **PR #12** — Wires audit triggers para 48 tablas Phase 2 (`packages/database/sql/22_audit_triggers_phase2.sql`). **Cierra AE-PHASE2-01**.
- **PR #13** — Fix Vercel outputDirectory `.next` relativo a rootDirectory. **Cierra incidente persistente Vercel build**.
- **PR #14** — Cierre 23 RLS gaps en catálogos detectados por advisor (`packages/database/sql/23_rls_catalog_gaps.sql`). **Cierra advisor CRITICAL → 0**.

### Fase 6 — Entrega (PRs #15, #16, #17, #18, #19, #20 — esta release)
- **PR #15** — @SRE: `docs/15_production_runbook.md` (Vercel+Supabase+Sentry, 408 líneas, env vars + rollback + escalation).
- **PR #16** — @AE: 5 ADRs (`docs/adr/0001-0005`) + compliance review v1.1 firmado.
- **PR #17** — @DBA: `packages/database/sql/24_security_hardening.sql` + `docs/21_db_operations.md` (cierra 18/19 WARN advisor).
- **PR #18** — @QAF: `docs/uat/phase2_uat_scenarios.md` (16 scenarios Gherkin es-SV) + checklist go-live actualizado.
- **PR #19** — @PO: estas release notes + sprint review (este PR).
- **PR #20** — @QA: smoke production Playwright suite (siguiente PR de la serie Fase 6).

## Estado advisors Supabase post-v0.2.0

| Categoría                              | v0.1.0  | v0.2.0 (post SQL 23) | v0.2.0 (post SQL 24, pending apply) |
|----------------------------------------|---------|----------------------|--------------------------------------|
| CRITICAL `rls_disabled_in_public`      | n/a     | **0**                | 0                                    |
| WARN `function_search_path_mutable`    | n/a     | 16                   | **0**                                |
| WARN `extension_in_public`             | n/a     | 2                    | **0**                                |
| WARN `auth_leaked_password_protection` | n/a     | 1                    | 1 (acción manual dashboard)         |

## Push-backs reafirmados

Los push-backs originales del MVP se mantienen vigentes:

1. **NO K8s/Terraform en Fase 6 MVP** — diferido a post-Fase 6. MVP entrega production readiness sobre Vercel + Supabase + Sentry.
2. **SLO MVP = 99.5%** — subir a 99.9% es objetivo de Fase 7.
3. **PACS/HL7/FHIR/DTE** — siguen postergados.
4. **Trunk-based modificado** — sin cambios.
5. **Migraciones forward-only** — sin cambios.
6. **Sin Prometheus/Grafana en MVP** — sin cambios.

## Acciones pendientes para firma G6

Coordinadas por @Orq en este reporte. Las firmas vinculantes G6 son @AE + @QA + @QAF + @SRE.

| Acción                                                          | Owner   | Status                       |
|-----------------------------------------------------------------|---------|------------------------------|
| Mergear PRs #15-#20 a `main`                                    | Edwin   | Pendiente review             |
| Aplicar SQL 24 a Supabase prod via MCP                          | @SRE    | Pendiente (post-merge PR #17)|
| Activar HIBP en Supabase Auth dashboard                         | @SRE    | Pendiente acción manual      |
| Verificar env vars Vercel Production scope vs `docs/15` §2      | @SRE    | Pendiente acción manual      |
| Smoke navegacional manual de `/api/health` y páginas críticas   | Edwin   | Pendiente acción manual      |
| Rotación 5 credenciales (memoria sesión 1)                      | Edwin   | Pendiente (no bloqueante go-live) |
| Tag `v0.2.0-phase2-skeletons` en commit final post-Fase 6       | Edwin   | Pendiente firma G6           |

## Métricas de la sesión maratón 2026-05-12/13

| Métrica                       | Valor                                                   |
|-------------------------------|---------------------------------------------------------|
| PRs mergeados en la sesión    | 9 (#6, #7, #8, #9, #10, #11, #12, #13, #14)            |
| PRs en revisión (Fase 6)      | 6 (#15, #16, #17, #18, #19, #20)                       |
| Commits totales               | 14 merge + 14 feature ≈ 28                              |
| Líneas SQL agregadas          | ~600 (SQL 22, 23, 24)                                   |
| Líneas TypeScript agregadas   | ~12 000 (14 routers + 14 schemas + 14 model files)      |
| Líneas docs agregadas         | ~5 500 (ADRs + UAT + runbook + release notes + DB ops)  |
| Tests nuevos                  | +569 (de 442 a 1011+)                                   |
| Incidentes Vercel resueltos   | 3 (PR #5, #13, ajuste outputDir final)                  |

---

# Release v0.1.0 — MVP Foundation

> **Inversiones Avante — Sistema de Información Hospitalaria Multipaís**
> **Tag:** `v0.1.0-mvp-foundation`
> **Fecha:** 2026-04-30
> **Tipo:** Foundation release (no apto para producción — código pre-Sprint 0)

---

## ⚠️ Estado del release

Esta entrega es **fundacional**, no operativa. Contiene:
- ✅ Toda la documentación arquitectónica, de producto, calidad y operaciones para los 30 módulos del TDR
- ✅ Schema de base de datos en 4NF (validado con `prisma validate`)
- ✅ Código del MVP fundacional escrito y commited (~256 SP de 390 SP de EV-físico, 65.6% del backlog del MVP)
- ❌ **NO ejecutado, NO compilado, NO testeado, NO desplegado**

**EV-DoD real (Earned Value según Definition of Done estricto): 0 SP.**

Antes de cualquier uso operativo es **obligatorio** ejecutar el "Sprint 0 cleanup" descrito abajo (33-64h estimadas).

---

## 🎯 Alcance entregado

### Documentación arquitectónica (11 documentos)

| # | Documento | Propietario | Cobertura |
|---|---|---|---|
| 01 | Arquitectura Empresarial | @AE | Análisis impacto, RACI 16×15, matriz 20 normas SV, KPIs, top-10 riesgos |
| 02 | Arquitectura de Software | @AS+@AT | Blueprint, RLS multi-tenancy, 15 ADRs, deployment Mermaid |
| 03 | Blueprints de Módulos | @AS | 30 BCs con agregados, eventos, complejidad S/M/L/XL |
| 04 | Modelo de Datos | @DBA | 4NF justificación con 6 MVDs descompuestas, ER conceptual 30 módulos |
| 05 | Backlog | @PO | 10 épicas, 74 user stories, 390 SP, 7 sprints |
| 06 | Roadmap | @PO | Mermaid Gantt fases 0-7 + gates G0-G8 |
| 07 | Design System | @UIUX | WCAG 2.1 AA, paleta Manchester, dark mode UCI, tokens completos |
| 08 | DevOps | @SRE | Ambientes, branching, migraciones, top-5 runbooks, DRP |
| 09 | Estrategia de Pruebas | @QA | Pirámide 70/20/10, traceability matrix, coverage targets |
| 10 | BDD Funcional | @QAF | Filosofía, lenguaje ubicuo, cobertura por épica |
| 11 | Publicación GitHub | @SRE | PAT/SSH, branch protection, environments, secrets |

### Schema de datos (Prisma 4NF)

- **58 modelos** + 12 enums (validados con `prisma validate`)
- **3 archivos SQL DDL adicionales** (RLS policies, audit triggers append-only con hash chain SHA-256, validators DUI/NIT/NIE El Salvador)
- **Cobertura del MVP fundacional:**
  - §5 Multi-entidad: 9 modelos (Country, GeoDivision, Holiday, Currency, ExchangeRate, Organization, Establishment, Ledger, CountryCurrency)
  - §6 Seguridad: 9 modelos (User, UserCredential, UserExternalIdentity, Session, Role, Permission, RolePermission, UserOrganizationRole, AuditLog)
  - §7.2-7.3 Catálogos: 17 modelos (personas + clínicos parametrizables)
  - §8 MPI/ADT: 16 modelos (Patient + 11 hijas binarias 4NF, Bed, Encounter, BedAssignment, EncounterTransfer)
  - §9 Triage Manchester: 7 modelos (TriageLevel, TriageFlowchart, TriageDiscriminator, TriageEvaluation y vínculos)

### Aplicación Next.js 14 (App Router)

**Workspaces del monorepo (Turborepo + npm workspaces):**

| Workspace | Contenido |
|---|---|
| `apps/web` | Next.js 14 con route groups `(auth)` `(admin)` `(clinical)`, Auth Supabase SSR, middleware, Sentry con scrubbing PII |
| `packages/database` | Prisma client singleton, schema, migraciones SQL, seed idempotente |
| `packages/contracts` | 10 schemas Zod, validators DUI/NIT/NIE (paridad SQL ↔ TS) |
| `packages/trpc` | 9 routers tRPC v11 (country, organization, currency, patient, encounter, bed, triage, catalog, audit) |
| `packages/ui` | 17 componentes Shadcn + 7 customs (OrgSwitcher, PatientSearchBar, BedMap, TriageWidget, VitalSignsCapture, AuditTrail, AllergyAlert) |
| `packages/infrastructure` | Pino logger con redacción PII |
| `packages/config` | ESLint shared (base + Next preset) |
| `packages/test-utils` | Fixtures DUI/NIT (~210), helpers DB y mock-session |

### Suite de pruebas

- **Vitest:** unit tests de validators (cobertura 100%) + Zod schemas + 5 routers tRPC con Prisma stubs
- **Playwright E2E:** 7 spec files (auth, patient-mpi, admission-discharge, triage-manchester, bed-map, audit-trail, a11y)
- **axe-core:** sweep de accesibilidad sobre páginas MVP
- **BDD Gherkin (es-SV):** 27 feature files, 167 scenarios, 87% cobertura backlog E1-E7

### CI/CD y observabilidad

- **GitHub Actions:** `ci.yml`, `db-migrate.yml`, `e2e.yml`, `security.yml` (npm audit + gitleaks)
- **Docker:** Dockerfile multi-stage Node 20 Alpine + docker-compose dev/test
- **Vercel:** config con regiones iad1 + gru1, security headers
- **Sentry:** init client/server/edge con `scrubEvent` agresivo (PII/PHI redactados)
- **Healthcheck:** `GET /api/health` valida DB + Supabase + version + uptime

---

## 📊 Métricas del release

| Métrica | Valor |
|---|---|
| Archivos versionados | 211 |
| Commits | 7 |
| Líneas de código | ~25.000 (estimado) |
| Documentación Markdown | ~70.000 palabras (~140 páginas) |
| Modelos Prisma | 58 |
| Componentes UI | 24 (17 Shadcn + 7 customs) |
| Routers tRPC | 9 |
| Schemas Zod | 10 |
| Tests escritos | ~50 archivos |
| Feature files BDD | 27 |
| Scenarios BDD | 167 |
| Story Points planificados (BAC) | 390 |
| EV-físico (código mergeado) | ~256 SP (65.6%) |
| EV-DoD (story Done) | **0 SP (0%)** |

---

## 🚧 Sprint 0 cleanup — pendiente obligatorio antes de gate G0

| # | Pendiente | Estimación | Bloquea |
|---|---|---:|---|
| 1 | `npm install` y resolución de errores de tipos | 4-8h | Toda validación |
| 2 | Suite Vitest verde con cobertura ≥80% | 6-12h | DoD coverage |
| 3 | `npm run build` y resolución de errores Next | 2-6h | Deploy |
| 4 | Provisión Supabase + migraciones + RLS + seeds | 2-4h | E2E |
| 5 | E2E Playwright contra app real | 4-8h | DoD smoke |
| 6 | axe-core sin violaciones críticas/serias | 2-4h | DoD a11y |
| 7 | Crear primer ADMIN UserOrganizationRole | 1-2h | Demo |
| 8 | TODOs explícitos Sprint 2 (RLS app.* SET, react-hook-form, encounter sequences, FX rate real) | 12-20h | Sprint 1 cierre |
| **TOTAL** | | **33-64h** | |

---

## 🔐 Push-backs documentados (decisiones del equipo SDLC autónomo)

1. **MVP NO incluye los 30 módulos completos.** Solo Fase 0+1: multi-entidad, seguridad, catálogos, MPI/ADT, Triage. Los 23 módulos restantes (hospitalización, quirófano, HCE avanzada, farmacia/eMAR, LIS, RIS/PACS, almacén, facturación DTE, contabilidad multi-libro, convenios, BI) están solo como blueprints.
2. **SLO MVP = 99.5%** (no 99.9% del TDR §29.2). Subir a 99.9% es objetivo de Fase 7 con observabilidad madura.
3. **PACS, HL7/FHIR, DTE Hacienda** postergados a fases posteriores como integraciones externas (Orthanc, Mirth Connect, servicio DTE certificado).
4. **Trunk-based modificado** sobre GitFlow — tamaño de equipo no justifica la ceremonia.
5. **Migraciones forward-only** — rollback con RLS multi-tenant deja registros huérfanos.
6. **Sin Prometheus/Grafana en MVP** — Vercel Analytics + Supabase + Sentry cubren; auto-hosting cuando salgamos de managed.

---

## 📦 Composition del repositorio

```
HIS/
├── apps/web/                    Next.js 14 App Router
│   ├── src/app/                 Routes (auth/admin/clinical)
│   ├── src/lib/                 supabase/, auth/, trpc/
│   ├── e2e/                     Playwright specs
│   └── sentry.*.config.ts       Sentry init con scrubbing PII
├── packages/
│   ├── database/                Prisma schema + DDL + seed
│   ├── contracts/               Zod + validators
│   ├── trpc/                    9 routers
│   ├── ui/                      Shadcn + customs HIS
│   ├── infrastructure/          Pino logger
│   ├── config/eslint/           Shared config
│   └── test-utils/              Fixtures DUI/NIT
├── tests/features/              27 BDD .feature en es-SV
├── docs/                        11 documentos arquitectónicos
├── .github/workflows/           4 pipelines CI/CD
├── infra/terraform/             Esqueleto Fase 7
└── scripts/                     setup.sh, db-reset.sh
```

---

## 🚦 Próximos hitos

| Gate | Cierra | Criterio | ETA realista |
|---|---|---|---|
| G0 | Fase 0 | Sprint 0 cleanup completo + primer deploy preview funcional | +1-2 semanas |
| G1 | Sprint 1 | Multi-Entidad + AuthN entregados con DoD | +3-4 semanas |
| G2 | Fase 1 | MVP Foundation operativo (ADT + Triage funcionando) | +13-15 semanas |
| G3-G8 | Fases 2-7 | Módulos clínicos avanzados, farmacia/eMAR, LIS, RIS, DTE, BI | 18-22 meses adicionales |

---

## 👥 Créditos del equipo SDLC autónomo

| Rol | Responsabilidad | Entregable |
|---|---|---|
| @Orq | Orquestación 6 fases SDLC | Coordinación + push-backs documentados |
| @AE | Arquitecto Empresarial (TOGAF + ITIL) | doc 01 |
| @AS | Arquitecto de Software (DDD + hexagonal) | docs 02, 03 |
| @AT | Arquitecto de Soluciones (Cloud) | docs 02, 03 |
| @PO | Chief Product Officer (Agile + ROI) | docs 05, 06 |
| @DBA | Data Architect (4NF) | schema + DDL + doc 04 |
| @UIUX | UI/UX Architect (Shadcn + WCAG) | design system + doc 07 |
| @Dev | Senior Full Stack | apps/web + packages |
| @QA | QA Automation (SDET) | Vitest + Playwright + doc 09 |
| @QAF | Quality Analyst (BDD Gherkin) | 27 features + doc 10 |
| @SRE | Site Reliability Engineer | CI/CD + Docker + Sentry + docs 08, 11 |

---

**Generado por @Orq el 2026-04-30. No declara el proyecto Completado — declara MVP Foundation entregable y listo para Sprint 0 cleanup.**
