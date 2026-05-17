# CHANGELOG

Todos los cambios notables del proyecto HIS Multipaís se documentan en este archivo.
Formato basado en [Keep a Changelog](https://keepachangelog.com/es/1.0.0/).
Versionado semántico según [SemVer](https://semver.org/lang/es/).

---

## [Sprint F2-S2] — 2026-05-17

### Agregado

- **ECE — Schema completo (SQL 55–63):** 9 archivos SQL que construyen el Expediente
  Clínico Electrónico: extensions + schema `ece`, catálogos (roles, establecimientos,
  servicios), seguridad (personal_salud, firma_electronica), paciente, episodios,
  motor de workflow data-driven, documentos (HC, notas, epicrisis), RLS + bitácora
  + triggers inmutabilidad, y seed de 30 tipos de documento NTEC.

- **Motor de workflow data-driven (ADR 0011):** los 30 flujos de documento ECE
  (estados, transiciones, roles, requisitos de firma) son datos en tablas relacionales
  (`ece.tipo_documento`, `ece.flujo_estado`, `ece.flujo_transicion`, `ece.documento_rol`).
  Cambiar un workflow = modificar filas, no código.

- **RLS ECE via GUC SET LOCAL (ADR 0012):** aislamiento por `ece_personal_id` +
  `ece_establecimiento_id` con `ece.set_ece_context()` + policies coherentes con el
  patrón `withTenantContext` del módulo HIS principal. Trigger `fn_check_dir_certificar`
  restringe la transición `certificar` al rol DIR.

- **Bitácora de acceso (Art. 55 NTEC):** tabla `ece.bitacora_acceso` append-only con
  retención de 2 años. Registra todo acceso (autorizado o denegado) con personal_id,
  acción, IP, timestamp y justificación para acciones sensibles.

- **Triggers de inmutabilidad (Art. 42 NTEC):** `ece.fn_bloquea_mutacion` aplicado a
  10 tablas históricas/legales. Correcciones via `ece.rectificacion` con hash_original.

- **E2E `e2e/fase2/ece-workflow-completo.spec.ts`:** happy path multi-rol completo
  (ENF → signos vitales + firma; MC → HC + firma + valida; DIR → certifica FICHA_ID +
  EPICRISIS; ADMIN → bitácora muestra los tres accesos). Tolerante a stub con
  SKIP_E2E_ECE=1.

- **E2E `e2e/fase2/ece-rls-enforcement.spec.ts`:** tres escenarios de enforcement RLS
  (sin contexto ECE → 0 filas; PHYSICIAN no certifica; usuario otro establecimiento no
  ve cross-tenant).

- **ADR `docs/adr/0011-ece-motor-workflow-datadriven.md`:** decisión data-driven vs
  hard-coded vs XState vs BPMN externo. Alternativas rechazadas con razonamiento.

- **ADR `docs/adr/0012-ece-rls-strategy.md`:** decisión GUC SET LOCAL vs JWT claims
  vs WHERE en aplicación vs schema separado. Trade-offs y diseño de `withEceContext`.

- **Sprint Review `docs/sprint-reviews/sprint_f2_s2_review.md`:** logros, métricas,
  retroactiva y carry-over F2-S2.

### Cambios (respecto a F2-S1)

- Firma electrónica (ADR 0010, F2-S1) integrada como requisito en
  `ece.flujo_transicion.requiere_firma`; el motor ECE llama al `firmaRouter` existente.

### Pendiente (carry-over a F2-S3)

- Apply SQL 55–63 en Supabase prod y BD de test E2E.
- Seed de usuarios de test: `qa.nurse`, `qa.physician`, `qa.director`, `qa.externo`.
- Rutas `/ece/**` Next.js (actualmente skeleton).
- E2E ECE verde end-to-end (bloqueado por seed y rutas UI).

---

## [Sprint F2-S1] — 2026-05-16

### Agregado

- **Firma electronica simple (ADR 0010):** PIN argon2id + cache sesion 15 min.
  Tablas `ece.firma_config`, `ece.firma_session_cache`, `ece.firma_electronica`.
  Router `firmaRouter` con procedures `enrollPin`, `initSession`, `signDocument`,
  `verifySignature`.
- **Gate F2-S1:** schema ECE base + firma electrónica + motor workflow (30 streams).
- E2E `e2e/fase2/firma-workflow-gate.spec.ts`: setup PIN, crear paciente, crear nota
  SOAP + firma, bloqueo sin firma.

---

## [Maratón 2026-05-12/13] — Sprint 0 → Fase 6

### Agregado

- PRs #6–#20 mergeados: 14 módulos Phase 2 skeleton + Fase 5 cross-tenant +
  remediación CRITICAL AE-PHASE2-01 + SQL 22–24 hardening + 6 streams Fase 6.
- ADRs 0001–0010.
- Production runbook, UAT scenarios, release notes v0.1.0.
- 96 tablas en Supabase prod, 1011+ tests passing.

---

## [Sprint 3] — 2026-05-07

### Agregado

- PR #3: 9 routers cableados, RLS demote runtime, 5 E2E reescritos, 31 FK indexes.

---

## [Sprint 0 / G0] — 2026-05-04

### Agregado

- Setup inicial Turborepo + monorepo: Next.js 14 + tRPC v11 + Prisma 5 + Supabase.
- Schema.prisma 3343 líneas (4NF), RLS multi-tenancy, audit hash chain.
- CI/CD: ci.yml + e2e.yml + db-migrate.yml + security.yml.
- Identidad visual AVANTE, sidebar agrupado (5 secciones, 39 items).
