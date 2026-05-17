# CHANGELOG

Todos los cambios notables del proyecto HIS Multipaís se documentan en este archivo.
Formato basado en [Keep a Changelog](https://keepachangelog.com/es/1.0.0/).
Versionado semántico según [SemVer](https://semver.org/lang/es/).

---

## [Sprint F2-S3] — 2026-05-17

### Agregado

- **Atención de Emergencia (US.F2.3.16–17):** `atencionEmergenciaRouter` con procedures
  `create`, `addEvolucion`, `sign`, `close`. Página Next.js `/ece/atencion-emergencia` con
  formulario NTEC-compliant (anamnesis, examen físico, diagnóstico CIE-10, plan, firma).
  Hoja de observación (< 24h) integrada como sub-documento del episodio de emergencia.

- **RRI — Referencia, Retorno e Interconsulta (US.F2.3.26–28):** `rriRouter` con flujo
  completo: emisión de referencia a nivel secundario, retorno al nivel de origen, registro
  de respuesta de interconsulta. Página `/ece/rri` con selector de destino (establecimientos
  de la red Avante), tipo de urgencia, y firma electrónica integrada.

- **Estudios Lab/Gabinete (US.F2.3.23–25):** `estudiosRouter` con solicitud de estudio
  (RELAB), carga de resultado estructurado + adjunto PDF, y visualización cronológica en el
  episodio. Página `/ece/estudios` con tabla de estudios pendientes/completados y preview de
  adjunto en modal.

- **Seed demo ECE (`seed-ece-demo.mjs`):** script en `packages/database/scripts/` que siembra
  5 pacientes, 10 episodios y 25 documentos demo representativos para QA/UAT. Aplicado en BD
  de test E2E via `e2e.yml` job `seed-test-db`.

- **Usuarios de test ECE:** `qa.nurse@his.test`, `qa.physician@his.test`, `qa.director@his.test`
  agregados a `packages/database/scripts/seed-test-users.mjs` con roles ENF, MC, DIR en
  el establecimiento de test.

- **E2E specs sin stub (3 nuevos):**
  - `e2e/fase2/ece-atencion-emergencia.spec.ts` — happy path apertura → evolución → firma → cierre.
  - `e2e/fase2/ece-rri.spec.ts` — referencia, retorno, interconsulta con respuesta.
  - `e2e/fase2/ece-estudios.spec.ts` — solicitud, resultado, adjunto PDF, visualización episodio.

- **Workflow Designer drag-drop:** componente `<WorkflowDesigner>` en `apps/web/src/components/ece/`
  usando react-flow. Permite visualizar y editar grafos de estado de tipos de documento.
  Persistencia de posiciones de nodos. Validación visual de transiciones via
  `workflowRouter.validateTransition`.

- **Validador server-side de workflow (ADR 0013):** `workflowValidatorService` en
  `packages/trpc/src/services/workflow-validator.ts`. Verifica integridad del grafo,
  ABAC por rol, completitud de payload y sesion de firma activa antes de cada transición.
  18 casos unitarios Vitest cubiertos.

- **ABAC ECE granular:** `requireEceRole()` wrapper en `packages/trpc/src/trpc.ts` que
  verifica rol del personal (`ece.personal_salud.rol`) contra la matriz de roles permitidos
  por tipo de documento. Integrado en los 9 routers de documento.

- **Bitácora viewer avanzado:** página `/ece/bitacora` con filtros por acción, personal,
  rango de fecha y texto libre. Exportación CSV de resultados filtrados. Paginación server-side.

- **ADR `docs/adr/0013-workflow-validation-rules.md`:** decision validador centralizado
  server-side vs bpmn-validation lib vs solo client-side. Trade-offs y diseño documentados.

- **Sprint Review `docs/sprint-reviews/sprint_f2_s3_review.md`:** logros, métricas,
  retroactiva y carry-over F2-S3.

### Cambios

- **HC router shape extended:** `hcRouter` extendido con campos NTEC adicionales —
  antecedentes familiares (familiar_dm, familiar_hta, familiar_cancer, etc.),
  antecedente ginecobstétrico (gestas, partos, cesareas, abortos, fum), y Hábitos Biológicos
  y Tóxicos (HBT). Zod schema actualizado, Prisma types regenerados.

- **Bitácora viewer refactor:** reescritura del componente `<BitacoraViewer>` de tabla
  estática a tabla con filtros server-driven, paginación y exportación. La API no cambió;
  solo la capa de presentación y los query params del endpoint.

### Eliminado

- **`HCDetalleExtended` cast eliminado:** el tipo auxiliar `HCDetalleExtended` (cast interno
  en el resolver de HC) fue eliminado. El shape correcto ahora viene directo del schema Zod
  tipado — sin `as unknown as HCDetalleExtended`. Detectado y eliminado durante la extensión
  del router shape.

- **Casts `as any` residuales:** 4 instancias de `as any` restantes en routers de documento
  (detectadas por `tsc --strict`) eliminadas. Cada una fue reemplazada por el tipo correcto
  inferido del schema Prisma o del contrato Zod.

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
