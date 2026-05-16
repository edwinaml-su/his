# 26 — Matriz de Trazabilidad

**Proyecto:** HIS Multipaís — Inversiones Avante
**Autor:** @QA — QA Automation Engineer (SDET)
**Versión:** 1.1 — 2026-05-16 (Wave DoD.0 — coverage baseline medido)
**Propósito:** Vincular requerimientos del TDR → User Stories → Casos de prueba → Evidencia ejecutada.
**Contexto:** Entregable DoD-bridge. EV-físico ~78 %, EV-DoD 0 % — esta matriz identifica la brecha y propone plan de cierre.
**Coverage baseline:** contracts 78.82 % lines | trpc 78.11 % lines | infrastructure 86.26 % lines | web 5.97 % lines (ver `docs/27_coverage_baseline.md`)

> Convenciones de estado:
> - ✅ criterio cumplido con evidencia verificable en el repo
> - ⚠️ cumplido físicamente, DoD incompleto (faltan UAT, A11y firmado o coverage medido)
> - ❌ no implementado o tests fallando
> - ⏳ en progreso (rama no mergeada a main)
> - ❓ sin evidencia disponible en el repo al momento de redacción

---

## 1. Estado consolidado

| Sección | Total | Cubierto físico (código) | Cubierto DoD (tests + UAT + A11y) | Gap DoD |
|---|---|---|---|---|
| TDR §3-29 (30 módulos) | 30 | 18 (~60%) | 0 formalmente firmado | 30 |
| Backlog MVP Épicas E0-E9 | 9 épicas | 9 (100%) | 0 formalmente cerradas | 9 |
| Backlog Beta.1-15 waves | 15 waves | 15 mergeadas | 0 formalmente cerradas | 15 |
| Beta.16-18 (ramas) | 3 waves | 3 ramas locales (no mergeadas) | 0 | 3 |
| Features BDD (archivos .feature) | 41 | 41 escritos | 0 ejecutados como Cucumber | 41 |
| Tests E2E (specs Playwright) | 9 specs / 32 tests | 9 specs creados | ❓ estado CI actual desconocido | ❓ |
| UAT scenarios | 16 (Phase 2) | 16 escritos | 0 ejecutados con super-usuarios reales | 16 |

**Diagnóstico raíz:** La brecha EV-DoD no es de código faltante — es de proceso: ningún wave ha completado el ciclo completo `tests automatizados verdes + A11y axe firmado + UAT con usuario real + entrada en esta matriz`. El DoD del CLAUDE.md exige los cuatro elementos.

---

## 2. Matriz por módulo TDR

| TDR § | Módulo | Wave/Beta | US asociadas (muestra) | Tests E2E | Tests integración | Tests unitarios | Estado DoD |
|---|---|---|---|---|---|---|---|
| §4 | Plataforma base / DevEx | Sprint 0 / PR #1-5 | US-0.1, US-0.2, US-0.3, US-0.4 | smoke-g0.spec.ts (1 test) | rls-isolation.test.ts (4) | contracts/* (271 al G0) | ⚠️ |
| §5 | Multi-país / Multi-entidad | Sprint 1-2 / MVP | US-1.1 a US-1.7 | auth.spec.ts (parcial) | cross-tenant (15) | schemas/encounter.test.ts | ⚠️ |
| §6 | Seguridad / RBAC / Auditoría | Sprint 1-3 / PR #3, #14 | US-2.1 a US-2.10 | auth.spec.ts (4 tests), audit-trail.spec.ts (1) | rls-isolation (4) | identifier.test.ts | ⚠️ |
| §7 | Catálogos maestros | Sprint 1-3 / PR #3 | US-3.7 a US-3.9 | — | catalog.router.test.ts | schemas/* | ⚠️ |
| §8.1 | MPI — Identificación paciente | Sprint 2-3 / PR #3 | US-4.1 a US-4.8 | patient-mpi.spec.ts (5) | patient.router.test.ts | patient.test.ts | ⚠️ |
| §8.2-8.7 | ADT — Admisión / Altas / Censo | Sprint 3-4 / PR #3 | US-5.1 a US-5.10 | admission-discharge.spec.ts (3), bed-map.spec.ts (2) | encounter.router.test.ts, census.router.test.ts | bed.test.ts, encounter.test.ts | ⚠️ |
| §9 | Triage Manchester | Sprint 3-5 / PR #3 | US-6.1 a US-6.10 | triage-manchester.spec.ts (2) | triage.router.test.ts, triage-dashboard.router.test.ts | triage.test.ts | ⚠️ |
| §10 | Ambulatoria / Outpatient | Beta.7 / PR #37 | — (hardening sin US explícitas) | — | outpatient.router.test.ts | outpatient.test.ts | ⚠️ |
| §11 | Hospitalización / Inpatient | Beta.1 / PR #23 | — | — | inpatient.router.test.ts | inpatient.test.ts | ⚠️ |
| §12 | Emergencias | Beta.4 / PR #26 | — | — | emergency.router.test.ts | emergency.test.ts | ⚠️ |
| §13 | Cirugía | Beta.6 / PR #36 | — | — | surgery.router.test.ts | surgery.test.ts | ⚠️ |
| §14 | Historia Clínica Electrónica | Beta.5 / PR #33 | — | — | ehr-notes.router.test.ts | ehr-notes.test.ts | ⚠️ |
| §15 | Farmacia | Beta.2 / PR #24 | — | — | pharmacy.router.test.ts | pharmacy.test.ts | ⚠️ |
| §16 | eMAR | Beta.8 / PR #37 | — | — | medication-admin.router.test.ts | medication-admin.test.ts | ⚠️ |
| §17 | Laboratorio Clínico (LIS) | Beta.3 / PR #25 | — | — | lis.router.test.ts | lis.test.ts | ⚠️ |
| §18 | Imagenología (RIS/PACS) | Beta.9 / PR #32 | — | — | imaging.router.test.ts | imaging.test.ts | ⚠️ |
| §19 | Inventario y Almacén | Beta.10 / PR #39 | — | — | inventory.router.test.ts | inventory.test.ts | ⚠️ |
| §20 | Servicios y Equipos Biomédicos | Beta.11 / PR #43 | — | — | services-equipment.router.test.ts | services-equipment.test.ts | ⚠️ |
| §21 | Terapia Respiratoria | Beta.12 / PR #41 | — | — | respiratory.router.test.ts | respiratory.test.ts | ⚠️ |
| §22 | Nutrición | Beta.13 / PR #42 | — | — | nutrition.router.test.ts | nutrition.test.ts | ⚠️ |
| §23 | Hospitalización (neonato/partos) | — | — | — | newborn.router.test.ts (parcial) | — | ❌ |
| §24 | Contabilidad multi-libro | Beta.18 / rama local | — | — | ❓ (no mergeada) | ❓ | ⏳ |
| §25 | Convenios / Aseguradoras | Beta.14 / PR #44 | — | — | insurance.router.test.ts | insurance.test.ts | ⚠️ |
| §26 | Banco de sangre / Hemoterapia | Beta.16 / rama local | — | — | blood-bank.test.ts (41 tests, rama) | — | ⏳ |
| §27 | Localización SV (DUI/NIT) | Sprint 2-3 / MVP | US-7.1 a US-7.6 | — | identifier.test.ts | identifier.test.ts (paridad TS↔SQL) | ⚠️ |
| §28 | Patología / Anatomía | Beta.17 / rama local | — | — | ❓ (no mergeada) | ❓ | ⏳ |
| §29 | Observabilidad / SRE | Sprint 0 / Fase 6 | US-8.x | smoke-production.spec.ts (11) | — | — | ⚠️ |
| §30 | Alertas / Notificaciones | Beta.15 / PR #51-63 | US.B15.1.1-4.3b | — | notifications.router.test.ts | provider.test.ts | ⚠️ |
| §3 | Multi-país base | Sprint 1 | US-1.1, US-1.2 | — | cross-tenant.integration.test.ts | — | ⚠️ |
| N/A | Vacunación / Inmunizaciones | — | — | — | vaccination.router.test.ts | — | ❌ |
| N/A | Historia clínica paciente | — | — | — | patient-history.router.test.ts | — | ❌ |

**Nota:** §23 (neonato), vacunación e historia-paciente tienen routers con tests pero sin backlog formal ni US identificadas en `docs/05_backlog.md`. Se listan como ❌ para DoD.

---

## 3. Matriz por Wave/Beta

| Wave | Descripción | PRs mergeados a main | Tests pasados (evidencia repo) | Coverage global | A11y axe críticos | UAT | DoD |
|---|---|---|---|---|---|---|---|
| Sprint 0 (G0) | Plataforma base, CI/CD, RLS, seeds | #1, #2, #4, #5 | ✅ 271 passing (G0 closure log) | ❓ (no medido en G0) | ❓ | ❓ | ⚠️ |
| Sprint 1-3 (MVP) | Multi-entidad, seguridad, MPI, ADT, Triage | #3, #4, #9-#20 | ✅ 1011+ passing (sprint review 05-13) | ❓ | ❓ | ❓ | ⚠️ |
| Beta.1 Inpatient | Hospitalización hardening layer 1 | #23 | ✅ verdes (commit: business rules + tests) | ❓ | ❓ | ❓ | ⚠️ |
| Beta.2 Pharmacy | Farmacia hardening layer 1 | #24 | ✅ verdes (interactions + FEFO + 2-eyes) | ❓ | ❓ | ❓ | ⚠️ |
| Beta.3 LIS | Laboratorio hardening layer 1 | #25 | ✅ verdes (auto-flag + reflex + state machine) | ❓ | ❓ | ❓ | ⚠️ |
| Beta.4 Emergency | Emergencias hardening layer 1 | #26 | ✅ verdes (state machine + LWBS) | ❓ | ❓ | ❓ | ⚠️ |
| Beta.5 EHR Notes | Historia clínica hardening layer 1 | #33 | ✅ verdes (immutability + addendum + CIE-10) | ❓ | ❓ | ❓ | ⚠️ |
| Beta.6 Surgery | Cirugía hardening layer 1 | #36 | ✅ verdes (WHO checklist + OR conflict) | ❓ | ❓ | ❓ | ⚠️ |
| Beta.7 Outpatient | Ambulatoria hardening layer 1 | #37 | ✅ verdes (state machine + double-booking) | ❓ | ❓ | ❓ | ⚠️ |
| Beta.8 eMAR | Administración medicamentos hardening | #37 | ✅ verdes (BCMA + 2-eyes + timing) | ❓ | ❓ | ❓ | ⚠️ |
| Beta.9 Imaging | Imagenología hardening layer 1 | #32 | ✅ verdes (DICOM + urgency SLA) | ❓ | ❓ | ❓ | ⚠️ |
| Beta.10 Inventory | Inventario hardening layer 1 | #39 | ✅ verdes (FEFO + expiry + transfer) | ❓ | ❓ | ❓ | ⚠️ |
| Beta.11 Equipment | Equipos biomédicos hardening layer 1 | #43 | ✅ verdes (state machine + PM detection) | ❓ | ❓ | ❓ | ⚠️ |
| Beta.12 Respiratory | Terapia respiratoria hardening layer 1 | #41 | ✅ verdes (vent params + gas append-only) | ❓ | ❓ | ❓ | ⚠️ |
| Beta.13 Nutrition | Nutrición hardening layer 1 | #42 | ✅ verdes (diet compatibility + exclusivity) | ❓ | ❓ | ❓ | ⚠️ |
| Beta.14 Insurance | Aseguradoras hardening layer 1 | #44 | ✅ verdes (coverage check + expiry alerts) | ❓ | ❓ | ❓ | ⚠️ |
| Beta.15 Notifications | Alertas y notificaciones (US.B15.1.1-4.3b) | #51-#63 | ✅ verdes (US.B15.3.3: 23 tests; coverage global ❓) | ❓ | ❓ | ❓ | ⚠️ |
| Beta.16 Blood Bank | Banco de sangre (41 tests, blood-bank.router.ts) | PR #65 + PR #71 (mergeados al HEAD del worktree DoD.0) | ✅ 41 tests passing — blood-bank.test.ts (99.14% lines router) | 99.14 % lines (router) / global ~78 % | ❓ | ❓ | ⚠️ |
| Beta.17 Pathology | Patología / anatomía patológica | PR #68 (mergeado al HEAD del worktree DoD.0) | ✅ 32 tests passing — pathology.router.test.ts (97.54% lines) | 97.54 % lines (router) / global ~78 % | ❓ | ❓ | ⚠️ |
| Beta.18 Accounting | Contabilidad multi-libro | ledger.router.ts en HEAD (sin PR de tests mergeado) | ❌ 0 tests — ledger.router.ts (0% coverage, 473 LOC sin test) | 0 % lines (router) | ❓ | ❓ | ❌ |

**Coverage baseline real (Wave DoD.0 — 2026-05-16):** Medido por workspace desde branch `dod/0-baseline-coverage-a11y` (HEAD = main + Beta.15/16/17 mergeados). contracts: 78.82 % lines / 95.88 % branches. trpc: 78.11 % lines / 86.93 % branches. infrastructure: 86.26 % lines / 76.07 % branches. apps/web: 5.97 % lines (intencional, thresholds rebajados). Coverage global estimado: ~72 % lines — BAJO el threshold CI de 80 %. Ver `docs/27_coverage_baseline.md` para análisis completo y plan de remediación. Dos bugs pre-existentes impiden que `npm run test:coverage` raíz termine con éxito (BUG-DOD-001: E2E specs incluidos por Vitest; BUG-DOD-002: ambiente jsdom/node en notifications-badge.test.tsx).

---

## 4. Mapeo Features BDD → Tests automatizados

### Phase 1 — MVP (tests E2E existentes)

| Feature | Escenarios | Test E2E asociado | Test integración asociado | Estado |
|---|---|---|---|---|
| 01-multi-entidad/moneda-funcional.feature | 4 | — | cross-tenant.integration.test.ts | ⚠️ sin E2E |
| 01-multi-entidad/seleccion-organizacion.feature | 5 | auth.spec.ts (parcial) | cross-tenant.integration.test.ts | ⚠️ parcial |
| 02-seguridad/auditoria.feature | 12 | audit-trail.spec.ts (1 test) | rls-isolation.test.ts | ⚠️ cobertura parcial |
| 02-seguridad/autenticacion.feature | 14 | auth.spec.ts (4 tests) | rls-isolation.test.ts | ⚠️ parcial |
| 02-seguridad/autorizacion-rbac.feature | 7 | — | rls-isolation.test.ts | ⚠️ sin E2E |
| 02-seguridad/break-the-glass.feature | 6 | — | rls-isolation.test.ts (break-glass) | ⚠️ sin E2E |
| 03-catalogos/crud-catalogo.feature | 6 | — | catalog.router.test.ts | ⚠️ sin E2E |
| 03-catalogos/i18n-catalogo.feature | 4 | — | — | ❌ sin cobertura |
| 04-mpi/alergias-criticas.feature | 4 | — | patient.router.test.ts | ⚠️ sin E2E |
| 04-mpi/busqueda-paciente.feature | 5 | patient-mpi.spec.ts (5 tests) | patient.router.test.ts | ⚠️ E2E existe |
| 04-mpi/consentimiento.feature | 5 | — | — | ❌ sin cobertura |
| 04-mpi/deduplicacion.feature | 7 | patient-mpi.spec.ts (parcial) | patient.router.test.ts | ⚠️ parcial |
| 04-mpi/registro-paciente-sv.feature | 10 | patient-mpi.spec.ts (parcial) | patient.router.test.ts, identifier.test.ts | ⚠️ parcial |
| 05-adt/admision-emergencia.feature | 7 | admission-discharge.spec.ts (3) | encounter.router.test.ts | ⚠️ parcial |
| 05-adt/admision-programada.feature | 4 | admission-discharge.spec.ts (parcial) | encounter.router.test.ts | ⚠️ parcial |
| 05-adt/alta-medica.feature | 5 | admission-discharge.spec.ts (parcial) | encounter-discharge.router.test.ts | ⚠️ parcial |
| 05-adt/censo-camas.feature | 4 | bed-map.spec.ts (2 tests) | census.router.test.ts | ⚠️ parcial |
| 05-adt/defuncion.feature | 4 | — | death-certificate.router.test.ts | ⚠️ sin E2E |
| 05-adt/traslado-interno.feature | 5 | — | encounter-transfer.router.test.ts | ⚠️ sin E2E |
| 06-triage-manchester/codigos-rojos.feature | 6 | — | triage.router.test.ts | ⚠️ sin E2E |
| 06-triage-manchester/re-triage.feature | 4 | — | triage.router.test.ts | ⚠️ sin E2E |
| 06-triage-manchester/tiempos-maximos.feature | 5 | — | triage-dashboard.router.test.ts | ⚠️ sin E2E |
| 06-triage-manchester/triage-adulto.feature | 11 | triage-manchester.spec.ts (2 tests) | triage.router.test.ts, triage-flowchart.router.test.ts | ⚠️ parcial |
| 06-triage-manchester/triage-pediatrico.feature | 4 | — | triage.router.test.ts | ⚠️ sin E2E |
| 07-localizacion-sv/feriados-sv.feature | 4 | — | — | ❌ sin cobertura |
| 07-localizacion-sv/validacion-dui.feature | 1 | — | identifier.test.ts | ⚠️ sin E2E |
| 07-localizacion-sv/validacion-nit.feature | 1 | — | identifier.test.ts | ⚠️ sin E2E |

### Phase 2 — Módulos clínicos (todos sin E2E dedicado)

| Feature | Escenarios | Test integración asociado | Estado |
|---|---|---|---|
| phase2/10-ambulatoria.feature | 2 | outpatient.router.test.ts | ⚠️ sin E2E |
| phase2/11-hospitalizacion.feature | 2 | inpatient.router.test.ts | ⚠️ sin E2E |
| phase2/12-emergencia.feature | 2 | emergency.router.test.ts | ⚠️ sin E2E |
| phase2/13-cirugia.feature | 2 | surgery.router.test.ts | ⚠️ sin E2E |
| phase2/14-historia-clinica.feature | 3 | ehr-notes.router.test.ts | ⚠️ sin E2E |
| phase2/15-farmacia.feature | 2 | pharmacy.router.test.ts | ⚠️ sin E2E |
| phase2/16-emar.feature | 3 | medication-admin.router.test.ts | ⚠️ sin E2E |
| phase2/17-laboratorio.feature | 2 | lis.router.test.ts | ⚠️ sin E2E |
| phase2/18-imagenologia.feature | 2 | imaging.router.test.ts | ⚠️ sin E2E |
| phase2/19-inventario.feature | 2 | inventory.router.test.ts | ⚠️ sin E2E |
| phase2/20-servicios-equipos.feature | 2 | services-equipment.router.test.ts | ⚠️ sin E2E |
| phase2/21-respiratoria.feature | 2 | respiratory.router.test.ts | ⚠️ sin E2E |
| phase2/22-nutricion.feature | 2 | nutrition.router.test.ts | ⚠️ sin E2E |
| phase2/25-aseguradoras.feature | 2 | insurance.router.test.ts | ⚠️ sin E2E |
| phase2/30-notificaciones-inbox.feature | 8 | notifications.router.test.ts | ⚠️ sin E2E |

**Resumen BDD:** 41 features / 187 escenarios totales. Ninguno ejecutado como Cucumber automático. 9 specs Playwright cubren parcialmente 32 tests para flujos MVP. Todos los módulos Phase 2 tienen integración pero cero E2E.

---

## 5. Gaps críticos para cierre DoD

Los siguientes gaps están ordenados por impacto regulatorio y riesgo.

### GAP-1 — Coverage global medido por primera vez en Wave DoD.0 (PARCIALMENTE RESUELTO)

**Descripción:** Medido el 2026-05-16 en branch `dod/0-baseline-coverage-a11y`. Coverage global estimado: ~72 % lines — **BAJO el threshold CI de 80 %**. El threshold de branches (75 %) sí se cumple (~88 %). Dos bugs impiden la medición desde la raíz (`npm run test:coverage`): BUG-DOD-001 (E2E specs incluidos por Vitest) y BUG-DOD-002 (ambiente jsdom en modo projects).

**Riesgo:** CI actualmente no bloquea por coverage (el comando raíz falla antes de llegar al threshold). Merges pueden degradar coverage sin detección.

**Acción:** Wave DoD.1 — (1) Fix BUG-DOD-001 y BUG-DOD-002. (2) Agregar tests para mfa.router.ts, rbac.router.ts, audit.router.ts (los 3 routers sin tests de mayor criticidad). Meta: ≥ 80 % lines.

**Evidencia:** `docs/27_coverage_baseline.md` — snapshot 2026-05-16. Estado: ⚠️ medido, por debajo del threshold.

---

### GAP-2 — Ningún spec E2E cubre módulos Phase 2 (CRÍTICO para UAT)

**Descripción:** 15 módulos Phase 2 (§10-§22, §25, §30) tienen features BDD y routers con tests de integración, pero cero specs Playwright. Los únicos E2E son flujos MVP (auth, triage, admisión, MPI, bed-map, smoke).

**Riesgo:** Errores de integración UI↔router no se detectan. A11y (axe) nunca corre contra estas páginas.

**Acción:** Wave DoD.1 — E2E mínimos para los 5 flujos de mayor riesgo clínico: eMAR/BCMA, LIS valor crítico, farmacia 2-eyes, cirugía time-out, notificaciones críticas.

**Evidencia faltante:** Cualquier spec en `apps/web/e2e/` con nombre de módulo Phase 2.

---

### GAP-3 — A11y (axe) nunca ejecutado ni firmado en ningún wave (CRÍTICO DoD)

**Descripción:** `apps/web/e2e/a11y.spec.ts` existe (3 tests) pero cubre solo las páginas del MVP. El DoD de CLAUDE.md exige "axe sin críticos/serios". No hay evidencia de ejecución en CI ni reporte de 0 violaciones para ningún módulo.

**Riesgo:** Violaciones de accesibilidad WCAG en producción. Riesgo legal en entorno hospitalario (TDR §6 cumplimiento).

**Acción:** Extender `a11y.spec.ts` para cubrir al menos login, triage queue, bed-map, notifications inbox. Ejecutar en e2e.yml y documentar resultado.

**Evidencia faltante:** Output de axe con 0 violaciones críticas/serias en cualquier página.

---

### GAP-4 — UAT formal con super-usuarios no ejecutado (ALTO)

**Descripción:** `docs/uat/phase2_uat_scenarios.md` tiene 16 scenarios Gherkin escritos por @QAF para Phase 2, pero ninguno fue ejecutado con usuarios reales de Inversiones Avante. El go-live checklist en `docs/18_golive_checklist.md` requiere UAT firmado.

**Riesgo:** Bugs de usabilidad y flujo que solo detecta el usuario final no serán descubiertos antes de go-live.

**Acción:** Programar sesión UAT con al menos: (1) recepcionista — flujo admisión, (2) enfermería — eMAR/BCMA, (3) médico — triage + nota clínica. Documentar resultado en `docs/uat/`.

**Evidencia faltante:** Cualquier archivo en `docs/uat/` con resultado firmado.

---

### GAP-5 — Beta.16 y Beta.17 mergeadas, Beta.18 sin tests (PARCIALMENTE RESUELTO)

**Descripción actualizada (Wave DoD.0 — 2026-05-16):** Beta.16 (PR #65, #71) y Beta.17 (PR #68) están mergeadas en el HEAD del worktree. Beta.16 tiene 41 tests con 99.14 % lines en blood-bank.router.ts. Beta.17 tiene 32 tests con 97.54 % lines en pathology.router.ts. Beta.18 tiene `ledger.router.ts` (473 LOC) en el HEAD pero sin ningún test — 0 % coverage, sin PR de tests.

**Riesgo activo:** `ledger.router.ts` en 0 % es el archivo de mayor LOC sin cobertura. La contabilidad multi-libro no tiene verificación automatizada.

**Acción:** Wave DoD.3 — crear `ledger.router.test.ts` con al menos los flujos críticos del libro mayor (creación de asiento, balance de cuenta, cierre de período). PR independiente.

---

### GAP-6 — US asociadas a Beta.1-15 no documentadas en backlog (MEDIO)

**Descripción:** Las waves Beta.1-14 tienen PRs mergeados con "hardening layer 1" pero sus commits no referencian User Stories del `docs/05_backlog.md`. El backlog MVP cubre E0-E9 (390 SP) y Beta.15 tiene US.B15.x explícitas. Beta.1-14 no tienen US formales en backlog — son "hardening" sin historia asociada.

**Riesgo:** Imposible trazar requerimiento TDR → US → test para esos módulos. La columna "US asociadas" en §2 está vacía para §10-§25.

**Acción:** @PO debe crear épicas E10-E25 con US mínimas que mapeen al código ya entregado (retroactive story creation). Mínimo 1 US por módulo con criterios de aceptación.

---

### GAP-7 — Consentimiento, i18n-catálogo y feriados-SV sin cobertura de tests (MEDIO)

**Descripción:** Tres features BDD del MVP no tienen ningún test asociado: `03-catalogos/i18n-catalogo.feature` (4 escenarios), `04-mpi/consentimiento.feature` (5 escenarios), `07-localizacion-sv/feriados-sv.feature` (4 escenarios).

**Riesgo:** Funcionalidad regulatoria (consentimiento informado TDR §6, localización SV TDR §27) sin verificación automatizada.

**Acción:** Wave DoD.2 — 3 tests de integración mínimos para cada feature sin cobertura.

---

## 6. Plan de cierre DoD

El objetivo es llevar EV-DoD del 0% al 100% de las waves ya mergeadas a main.

### Wave DoD.0 — Baseline de coverage (BLOQUEANTE, 1-2 días)

**Alcance:** Ejecutar `npm run test:coverage` en main. Publicar número. Reparar si < 80%.
**Artefacto:** Screenshot de salida de coverage + número publicado en este documento sección 3.
**Criterio de cierre:** Coverage global ≥ 80% lines verificado y documentado.
**Propietario:** @QA
**Dependencias:** Ninguna. Ejecutar primero.

---

### Wave DoD.1 — E2E flujos críticos Phase 2 (5-7 días)

**Alcance:** 5 nuevos specs Playwright para módulos de mayor riesgo clínico:
- `emar-bcma.spec.ts` — administración de medicamento con identificación paciente-droga
- `lis-critical-value.spec.ts` — ingreso de resultado crítico + notificación disparada
- `pharmacy-2eyes.spec.ts` — prescripción psicotrópico con doble verificación
- `surgery-timeout.spec.ts` — time-out OMS pre-incisión
- `notifications-inbox.spec.ts` — inbox, mark-read, unread count badge

**Artefacto:** 5 specs en `apps/web/e2e/`, integrados en `e2e.yml`, con axe incluido.
**Criterio de cierre:** Los 5 specs pasan en CI (nightly run). axe sin violaciones críticas.
**Propietario:** @QA
**Dependencias:** Wave DoD.0 completada.

---

### Wave DoD.2 — Cobertura de gaps BDD (3-5 días)

**Alcance:** Tests de integración para los 3 features sin ninguna cobertura:
- `consent.router.test.ts` (consentimiento informado)
- `locale.router.test.ts` extendido (feriados SV)
- `catalog.router.test.ts` extendido (i18n, multi-idioma)

**Artefacto:** Tests en `packages/trpc/src/routers/__tests__/`, PR a main con CI verde.
**Criterio de cierre:** 0 features BDD con 0 cobertura.
**Propietario:** @QA
**Dependencias:** Wave DoD.0 completada.

---

### Wave DoD.3 — UAT formal Phase 2 (5-10 días, depende de agenda usuarios)

**Alcance:** Ejecutar los 16 scenarios de `docs/uat/phase2_uat_scenarios.md` con super-usuarios de Inversiones Avante en staging.
**Artefacto:** `docs/uat/phase2_uat_results.md` con firma de @QAF y al menos 3 usuarios clínicos.
**Criterio de cierre:** Todos los scenarios con resultado PASS o defecto documentado con severidad.
**Propietario:** @QAF (facilita) + Edwin (coordina agenda)
**Dependencias:** Ambiente staging estable. Beta.16 mergeada opcionalmente.

---

### Wave DoD.4 — Merge y verificación Beta.16-18 (2-3 días)

**Alcance:**
1. Verificar contenido real de feat/beta17-pathology y feat/beta18-accounting (¿tienen código propio?).
2. Mergear Beta.16 via PR con CI verde y coverage global verificado.
3. Si Beta.17 y Beta.18 están vacías, documentarlo y cerrar las ramas.
**Artefacto:** PR de Beta.16 mergeado. Decisión documentada sobre Beta.17/18.
**Criterio de cierre:** 0 ramas con código productivo sin PR ni decisión documentada.
**Propietario:** @Dev + @QA
**Dependencias:** Wave DoD.0 completada.

---

### Wave DoD.5 — Retroactive US para Beta.1-14 + firma @QA (5 días)

**Alcance:** @PO crea US retroactivas para §10-§25 (mínimo 1 US por módulo). @QA firma que cada US tiene test asociado en la matriz.
**Artefacto:** PR a `docs/05_backlog.md` con sección Beta.1-14 + actualización de columnas "US asociadas" en esta matriz.
**Criterio de cierre:** Todas las filas de la matriz §2 tienen al menos 1 US identificada.
**Propietario:** @PO (US), @QA (firma)
**Dependencias:** Ninguna técnica. Puede ejecutarse en paralelo.

---

### Secuencia recomendada

```
DoD.0 (coverage baseline) → paralelo: DoD.1 + DoD.2 + DoD.5
                          → DoD.4 (Beta.16 merge)
                          → DoD.3 (UAT, depende de agenda)
                          → Firma @QA de cierre DoD global
```

---

## 7. Mantenimiento

### Quién actualiza

Esta matriz es responsabilidad de **@QA** como artefacto vivo del DoD. No es un documento de archivo.

### Cuándo actualizar

- **Cada PR mergeado a main:** quien hace el PR actualiza al menos 1 fila de la sección §3 (Wave/Beta). Si el PR añade tests, actualiza también §4.
- **Cada wave DoD completada:** @QA actualiza sección §5 (Gaps) y sección §6 (Plan), marcando el gap como resuelto.
- **Cada UAT ejecutado:** @QAF actualiza columna UAT en sección §3.
- **Inicio de cada sprint:** @Orq revisa la sección §1 (Estado consolidado) y determina si el EV-DoD mejoró.

### Cómo actualizar

1. Crear rama `docs/traceability-<fecha>` desde main.
2. Editar este archivo con datos reales (no estimaciones).
3. PR pequeño, merge directo sin review bloqueante si solo actualiza estado.
4. La columna "DoD" de cualquier wave pasa de ⚠️ a ✅ **solo cuando todos los elementos del DoD de CLAUDE.md estén cumplidos**: tests verdes + coverage ≥80% + axe sin críticos/serios + UAT firmado + entry en esta matriz.

### Política de honestidad

Un ❓ en esta matriz es preferible a un ✅ sin evidencia. Si no hay evidencia verificable en el repo (commit, PR body, CI log, archivo en docs/), el estado es ❓ o ⚠️. **Nunca promover a ✅ sin evidencia.**

---

*Versión 1.0: @QA — 2026-05-16 — Snapshot inicial.*
*Versión 1.1: @QA — 2026-05-16 — Wave DoD.0: coverage baseline medido, Beta.16/17 actualizadas a mergeadas, Beta.18 marcada ❌ sin tests, GAP-1 y GAP-5 actualizados con datos reales. Próxima revisión: al completar Wave DoD.1 (fix BUG-DOD-001/002 + tests mfa/rbac/audit).*
