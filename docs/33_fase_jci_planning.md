# 33 — Fase JCI: Planning Maestro

> **Estado**: planning aprobado por @AE / @AS / @PO / @QA — pendiente priorización ejecutiva (Sponsor + CMO).
> **Fecha**: 2026-05-24
> **Origen**: gap assessment JCI 7th Edition documentado en `docs/32_gap_jci_assessment.md` (PR #219).
> **Activado por**: `/orq` directiva ejecutiva del 2026-05-24 — "levantar nueva fase para cerrar brecha con Joint Commission".

---

## Documento maestro — índice

Este documento es el **punto de entrada único** de la Fase JCI. Resume las salidas de cada especialista y enlaza a los entregables detallados.

| Doc | Contenido | Autor |
|---|---|---|
| `33_fase_jci_planning.md` (este) | Síntesis ejecutiva + governance + decisión Go/No-Go | @Orq |
| `33a_jci_releases_y_roadmap.md` | 3 releases (JCI-1.0, JCI-2.0, JCI-3.0) con fechas y outcomes | @PO |
| `33b_jci_backlog.md` | 20 épicas + ~100 US con criterios de aceptación Gherkin | @PO |
| `33c_matriz_trazabilidad_jci.md` | JCI standard → US → test case → estado | @QA |
| `33d_matriz_trazabilidad_proyecto.md` | Matriz consolidada de todo el proyecto (TDR + NTEC + JCI) | @QA |

---

## 1. Síntesis ejecutiva

**Decisión recomendada**: **GO**. Iniciar Fase JCI-1 con módulos PCI + PFE + IPSG + SQE en paralelo. Cobertura natural ~70-75% gracias al motor de workflow ECE y NTEC ya implementados.

**Esfuerzo total estimado**: ~807 SP en 20 épicas, 3 releases, 6-9 meses.

**Sponsor recomendado**: CEO (firma convenio con JCO). **Director de Programa**: CMO (autoridad clínica). **Steering Committee** quincenal en JCI-1/2, mensual en JCI-3 y post-acreditación.

**Habilitadores ya en main** (no requieren trabajo nuevo):
- Motor workflow ECE data-driven (PRs #211-#218)
- Audit hash chain SHA-256 + bitácora acceso
- Firma electrónica PIN argon2id + TOTP MFA
- BCMA 5R + GS1 logística
- WHO Surgical Safety Checklist
- RLS multi-tenant + `withTenantContext`

**Brechas concentradas** en 4 capítulos JCI:
1. **PCI** (Infection Control) — del 5% al 95% — épicas E-01, E-10, E-14
2. **PFE** (Patient Education) — del 10% al 90% — épica E-02
3. **QPS** (Quality Dashboard) — del 40% al 90% — épicas E-03, E-09
4. **SQE** (Credentialing) — del 35% al 90% — épicas E-04, E-13

---

## 2. Análisis estratégico — @AE (resumen)

> Documento completo en `docs/33_fase_jci_planning.md` — abajo, sección 2 detallada.

**Alineación negocio-TI** (TOGAF Phase B):
- **Medical tourism y seguros internacionales**: condición para in-network con Blue Cross, Cigna Global, Aetna International. Sin JCI, exclusión de red.
- **Posicionamiento competitivo**: Hospital Herrera Llerandi (GT), CIMA (CR), Clínica Bíblica (CR) ya tienen JCI. Ventana de 18-24 meses para ser primero en El Salvador.
- **Reducción de eventos adversos**: literatura muestra 25-40% reducción post-JCI.
- **Licitaciones BID/BCIE/USAID**: precalificación condicionada a acreditación reconocida.
- **Talento médico**: especialistas formados en centros JCI prefieren centros acreditados.

**Stakeholders impactados**: pacientes/familias, personal clínico, dirección médica, aseguradoras locales/internacionales, MINSAL/ISSS, comunidad.

**Riesgos de NO acreditarse** (Top 3):
1. Pérdida oportunidad medical tourism — USD 2-5M/año no capturados (12-18 meses).
2. Competidor regional obtiene JCI primero — diferenciador perdido irreversiblemente (18-24 meses).
3. Exclusión de redes de seguros internacionales — out-of-network ~30-40% no-cobro (inmediato).

**Cumplimiento normativo cruzado**: JCI es **superconjunto** de NTEC SV. Cumplir JCI implica cumplir NTEC. Convergencia natural ~70-75%. JCI es compatible con ISO 27001 (declarado en `docs/01_arquitectura_empresarial.md`).

**Decisión Go**: GO. Priorizar JCI-1 (PCI + PFE + IPSG + SQE). Mock Survey al mes 7-8 como gate G8 antes de encuesta JCI oficial.

---

## 3. Arquitectura técnica — @AS (resumen)

> Documento completo abajo, sección 3 detallada. Implementación: `packages/database/sql/100-105_jci_*.sql`.

**Decisión arquitectónica**: 4 schemas dentro del mismo Postgres (no microservicios independientes — ADR-JCI-001). Cada uno reutiliza el motor existente: `withTenantContext`, audit hash chain, outbox `DomainEvent`.

### Módulo PCI (Schema `pci.*`)
- Tablas: `infection_case`, `hygiene_audit`, `isolation_order`, `infection_type` (catálogo)
- Eventos: `pci.infection_case.opened/resolved`, `pci.hygiene_audit.recorded`, `pci.isolation_order.placed/lifted`
- Integraciones: `Encounter`, `MedicationAdministration` (alerta BCMA si aislamiento), `LabResult` (detección MRSA/VRE/C.diff auto-abre caso)
- Routers tRPC: `infectionCase`, `hygieneAudit`, `isolationOrder`
- UI: `/clinical/pci/[caseId]`, `/admin/pci/hygiene`, `/admin/pci/reports`

### Módulo PFE (Schema `pfe.*`)
- Tablas: `education_material` (catálogo), `education_session` (instancia paciente), `discharge_education`
- Storage: Supabase Storage bucket `pfe-materials` con RLS por `organization_id`
- Teach-back workflow: 3 intentos máx, barreras (LANGUAGE/LITERACY/COGNITIVE/HEARING/VISION), firma paciente
- Eventos: `pfe.session.completed`, `pfe.discharge.completed`, `pfe.teachback.failed`
- UI: `/clinical/pfe/[encounterId]`, `/admin/pfe/materials`, `/admin/pfe/reports`

### Módulo QPS (Schema `analytics.kpi_*`)
- ADR-JCI-002: **dbt + Metabase** sobre Postgres (no Cube.js — ya hay matviews + `analytics.dim_*` existentes)
- Medallion: Bronze (OLTP) → Silver (matviews actuales) → Gold (`analytics.kpi_*` nuevos)
- 25 indicadores JCI Library of Measures con datos ya en BD (tasa HAI, hand hygiene compliance, teach-back rate, mortalidad, readmisión 30d, etc.)
- Embedding Metabase signed URLs en `/admin/qps/dashboard`

### Módulo SQE (Schema `sqe.*`)
- Tablas: `credential_type` (catálogo), `credential` (instancia personal), `clinical_privilege` (FULL/SUPERVISED/PROVISIONAL), `oppe_review` (semestral)
- Extiende `ece.personal_salud` + `ece.rol` (NO duplica — regla CLAUDE.md "adecuar legacy")
- Alertas pre-vencimiento: 90d / 30d / 0d vía pg_cron + outbox + Beta.15
- UI: `/admin/sqe/staff/[staffId]`, `/admin/sqe/credentials/expiring`, `/admin/sqe/oppe/[reviewId]`

### Cross-cutting
- Audit hash chain registra: `pci.infection_case`, `pci.isolation_order`, `pfe.education_session`, `pfe.discharge_education`, `sqe.credential`, `sqe.clinical_privilege`, `sqe.oppe_review`
- RLS multi-tenant en TODAS las tablas nuevas (`organization_id` obligatorio)
- Performance: matviews Gold con refresh pg_cron 15 min para QPS
- ADRs: JCI-001 (schemas vs microservicios), JCI-002 (dbt + Metabase), JCI-003 (columna generada vs subquery), JCI-004 (Supabase Storage vs S3)

---

## 4. Backlog técnico — @PO (resumen)

> Backlog completo en `docs/33b_jci_backlog.md` y plan de releases en `docs/33a_jci_releases_y_roadmap.md`.

**20 épicas** mapeadas a capítulos JCI, **~807 SP**, organizadas en 3 releases:

| Release | Épicas | SP | Foco |
|---|---|---|---|
| **JCI-1.0** | E-01, E-02, E-04, E-05, E-06, E-07, E-09, E-11, E-14, E-16 | ~514 | Brechas críticas + IPSG + módulos base PCI/PFE/SQE/QPS |
| **JCI-2.0** | E-03, E-08, E-10, E-12, E-13, E-17, E-18 | ~227 | Dashboard QPS completo + continuidad asistencial + capacitación |
| **JCI-3.0** | E-15, E-19, E-20 | ~66 | Gestión documental + emergencias + satisfacción paciente |

**Top 5 épicas por WSJF**:
1. JCI-E-05 (IPSG 1-6) — WSJF 9.5 — Must
2. JCI-E-01 (PCI vigilancia) — WSJF 9.2 — Must
3. JCI-E-16 (WHO Surgical Checklist refuerzo) — WSJF 9.1 — Must
4. JCI-E-04 (SQE credentialing) — WSJF 9.0 — Must
5. JCI-E-02 (PFE educación paciente) — WSJF 8.8 — Must

**Criterios de aceptación**: cada US incluye 3+ escenarios Gherkin (Given/When/Then). Trazabilidad explícita JCI standard → ME → US.

---

## 5. Estrategia de testing — @QA (resumen)

> Estrategia completa abajo, sección 5 detallada.

**Pirámide**: 70% unit / 20% integración / 10% E2E + **compliance test suite paralela**.

**Coverage targets JCI**:
- Módulos PCI/SQE: ≥85% lines/functions, ≥80% branches
- Módulos PFE/QPS: ≥80% lines/functions, ≥75% branches
- Global post-JCI-1: mantener ≥80% lines (no regresión)

**Pre-requisito**: cerrar deuda coverage actual ~72% global → ≥80% antes del primer PR JCI-1. Sprint 0 dedicado.

**Compliance Test Suite** (job CI `compliance.yml` dedicado, bloquea merges JCI):
- IPSG.4 WHO Checklist 3 pausas obligatorias
- IPSG.6 Tamizaje caídas ≤24h post-admisión
- MMU.6 BCMA 5R completo
- MOI.13 firma electrónica argon2id verificable
- PCI bundles + hand hygiene
- Audit chain SHA-256 sin rupturas
- IPSG.1 validateDUI/NIT
- SQE credencial vigente bloquea acto quirúrgico

**Test users adicionales**:
- `qa.infection.control@his.test` (rol `INFECTION_CONTROL_NURSE`)
- `qa.epidemiologo@his.test` (rol `EPIDEMIOLOGIST`)
- `qa.educator@his.test` (rol `PATIENT_EDUCATOR`)
- `qa.paciente.portal@his.test` (rol `PATIENT`)
- `qa.qps.manager@his.test` (rol `QPS_MANAGER`)
- `qa.comite.credencialing@his.test` (rol `CREDENTIALING_COMMITTEE`)
- `qa.director.medico@his.test` (rol `MEDICAL_DIRECTOR`)

**Definition of Done JCI** (extiende DoD actual con 8 criterios D-JCI-1 a D-JCI-8):
- D-JCI-1: compliance test pasa
- D-JCI-2: audit trail cubre lifecycle completo
- D-JCI-3: RLS smoke pasa para nuevas tablas
- D-JCI-4: documentación clínica del módulo en `docs/`
- D-JCI-5: trazabilidad JCI standard documentada
- D-JCI-6: axe-core sin critical/serious en PFE (paciente/familia)
- D-JCI-7: latencia notificación clínica ≤30s verificada
- D-JCI-8: UAT clínico ejecutado con usuario real

**KPIs de calidad**: DRE ≥85% (JCI-1) → ≥95% (JCI-3); MTTR P0 ≤4h → ≤1h; Flakiness ≤2% → ≤0.5%; Compliance job pass rate ≥95% → ≥99%.

**Top 3 riesgos QA**:
1. Coverage cae <80% con skeletons sin tests (mitigación: regla "test trivial obligatorio")
2. Compliance tests acoplados a schema (mitigación: ejecutar en `db-migrate.yml`)
3. UAT clínico bloqueado por disponibilidad usuario real (mitigación: ventana fija 2h/semana)

---

## 6. Governance del programa JCI

| Rol | Perfil | Responsabilidad |
|---|---|---|
| Sponsor ejecutivo | CEO | Autorización presupuestaria, firma convenio JCO |
| Director de Programa | CMO | Líder clínico y operativo, gap remediation |
| Director de Calidad | Jefe Gestión de Calidad | Operación QPS, contacto surveyor JCI |
| Director TI / @Orq | CIO | Desarrollo HIS-JCI, representa equipo técnico |
| Coordinador Enfermería | Jefatura Enfermería | Implementación PCI + PFE en piso clínico |
| Compliance Legal | Asesoría Legal | Alineación normativa, contratos JCO |

**Cadencia Steering Committee**: quincenal en JCI-1/2, mensual en JCI-3 y post-acreditación.

**Métricas clave de progreso**:
| Métrica | Frecuencia | Verde | Rojo |
|---|---|---|---|
| Cobertura JCI acumulada (%) | Mensual | Plan vs real | Desvío >10pp |
| SP completados del roadmap | Quincenal | ≥90% | <75% |
| Hallazgos PCI activos | Mensual | 0 críticos | ≥1 abierto >30d |
| Cumplimiento IPSG (%) | Mensual | ≥95% | <90% |
| Adherencia PFE (%) | Mensual | ≥90% | <80% |
| Cobertura SQE credentialing (%) | Mensual | 100% | <95% |
| Tasa eventos adversos (/1000 d-cama) | Mensual | Decreciente | +20% baseline |

---

## 7. Integración con SDLC del HIS

- Sprints JCI bajo mismo backlog @PO con etiqueta `[JCI]`
- Gates G0-G8 aplican a entregables JCI
- @AE emite criterios arquitectónicos antes de @Dev implementar
- Validación clínica PCI/PFE la realiza Director de Calidad como UAT (no sustituible por @QAF)
- Mock Survey JCI (con JCO o consultor) = gate G8 antes de encuesta oficial

---

## 8. Decisión Go/No-Go — Pendiente del Sponsor

**Recomendación @Orq**: **GO**. Iniciar JCI-1 con priorización por WSJF.

**Próximo paso**: Priorizar primer epic a implementar y arrancar Fase 4 (Construcción).

Ver `docs/33a_jci_releases_y_roadmap.md` para fechas y outcomes esperados.

---

## Anexos

### A. Análisis estratégico completo @AE

Ver sección 2 de este documento (resumen) + el análisis completo se conserva como insumo en el prompt original al especialista. Los puntos clave están en la síntesis ejecutiva (sección 1).

### B. Arquitectura técnica completa @AS

Ver sección 3 de este documento. SQL DDL skeleton + ADRs incluidos. Implementación detallada en archivos `packages/database/sql/100-105_*.sql` (por crear en Fase 4).

### C. Estrategia testing completa @QA

Ver sección 5 de este documento. Compliance test suite + DoD extendido + KPIs definidos.

### D. Backlog completo @PO

Ver `docs/33b_jci_backlog.md` (20 épicas + ~100 US con AC Gherkin).
