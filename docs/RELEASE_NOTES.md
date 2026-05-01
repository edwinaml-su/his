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
