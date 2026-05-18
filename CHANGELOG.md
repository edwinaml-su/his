# CHANGELOG

Todos los cambios notables del proyecto HIS Multipaís se documentan en este archivo.
Formato basado en [Keep a Changelog](https://keepachangelog.com/es/1.0.0/).
Versionado semántico según [SemVer](https://semver.org/lang/es/).

---

## [Sprint F2-S5] — 2026-05-17

### Agregado

- **Ruta Quirúrgica cierre (US.F2.4.11–16):** preop checklist, consentimiento quirúrgico/anestésico,
  WHO Checklist Cirugía Segura (3 fases), descripción operatoria, registro anestésico transanestésico
  y hoja de recuperación URPA. Nuevas tablas: `ece.preop_checklist`, `ece.who_checklist`,
  `ece.registro_anestesico`, `ece.urpa_recovery`. Archivos SQL `67_`–`70_*.sql`.

- **Ruta Obstétrica (US.F2.4.18–21):** partograma con series temporales append-only
  (`ece.partograma_registro`), hoja de sala de expulsión con eventos múltiples
  (`ece.sala_expulsion_eventos`), atención del recién nacido con APGAR/somatometría/CUN
  (`ece.atencion_recien_nacido`) y reanimación neonatal condicional (`ece.reanimacion_neonatal`).
  Archivos SQL `71_`–`74_*.sql`.

- **~12 routers tRPC nuevos:** `notaPreoperatoriaRouter`, `consentimientoQxRouter`,
  `whoChecklistRouter`, `descripcionOperatoriaRouter`, `registroAnestesicoRouter`,
  `urpaRecoveryRouter`, `partogramaRouter`, `laborPartoRouter`, `salaExpulsionRouter`,
  `atencionRNRouter`, `reanimacionNeonatalRouter` y complementos.

- **ADR `docs/adr/0015-ece-rutas-clinicas-criticas.md`:** decisión tablas separadas por
  documento NTEC vs. `document_data jsonb`. Trade-offs type-safety, RLS, indexing series
  temporales. Precedente Vernon DDD Cap. 8 (Aggregate Boundary).

- **Sprint Review `docs/sprint-reviews/sprint_f2_s5_review.md`:** logros ~22 streams,
  ~95 SP, 8 tablas nuevas, retroactiva 4/4, carry-over F2-S6 trazado.

- **GS1 Deuda parcial (PR #105):** procesos A y D del estándar GS1 completados.

### Cambios

- **Consolidación regla "adecuar legacy":** routers de F2-S3/S4 sin `withTenantContext`
  recibieron wrapper mínimo. Sin cambios de lógica — solo adición del contexto RLS faltante.

- **Patrón series temporales estandarizado:** `UNIQUE (episodio_id, timestamp_utc)` con
  `ON CONFLICT DO NOTHING` establecido como estándar para documentos append-only ECE
  (partograma, registro anestésico). Ver ADR 0015.

### Eliminados

- Nada eliminado. Los streams de estancia general (US.F2.4.1–10, 22–25) permanecen intactos.

---

## [Sprint F2-S6] — 2026-05-17

### Agregado

- **Catálogos maestros GS1 (US.F2.5.1–5):** modelos Prisma `GtinCatalog`, `GlnLocation`,
  `SsccUnit`, `GsrnPerson`, `GiaiAsset`. Validadores de dígito verificador (modulo-10 GS1)
  en `packages/contracts/src/validators/gs1.ts` con paridad en `73_epcis_event.sql`.
  Tests fixture-based en `packages/contracts/src/validators/__tests__/gs1.test.ts`.

- **Proceso A — Recepción Inbound (US.F2.5.6–13):** router `receiving.*` con procedures
  `importDesadv`, `scanSscc`, `scanGtin`, `reportDiscrepancy`, `closeSession`. Tabla
  `RecepcionMercancia` con SQL hardening en `packages/database/sql/70_recepcion_mercancia.sql`
  (RLS + trigger inmutabilidad + FK a `GlnLocation`). Bloqueo automático de recall en
  recepción via `checkSanitaryAlert`. Acta de discrepancia en PDF con `@react-pdf/renderer`.

- **Componente `<BarcodeScanner>` PWA (US.F2.5.12):** integración de `@zxing/browser`
  en React. Parser de FNC1 (0x1D) para separar AIs GS1-128 y DataMatrix. Debounce HID
  200ms. Feedback de vibración (`navigator.vibrate([200])`) en lectura exitosa. Extracción
  correcta de AI 01 (GTIN), 17 (vencimiento), 10 (lote), 21 (serie).

- **Proceso B — Transferencias Internas (US.F2.5.14–21):** router `inventory.*` con
  procedures `dispatch`, `receiveTransfer`, `stockByGln`, `requestTransfer`, `approveRequest`.
  Tabla `TransferenciaInventario` con SQL hardening en `71_transferencia_inventario.sql`.
  Modelos `ParLevel` (niveles PAR min/max por GTIN+GLN) y `ColdChainLectura` (temperatura
  de despacho y recepción). Job cron Supabase Edge Function cada 15 min para evaluación PAR.
  Cuarentena automática por temperatura fuera de rango.

- **Proceso C — Fraccionamiento Unidosis (US.F2.5.22–28):** router `unitDose.*` con
  procedures `startRepack`, `generateUnitDose`, `printDataMatrix`, `closeSession`,
  `reverseTrace`. Tabla `PreparacionUnidosis` en `72_preparacion_unidosis.sql`.
  Herencia obligatoria de lote+vencimiento del GTIN padre al hijo. Conciliación con
  tolerancia ≤ 2% (merma aceptable). Generación ZPL/PDF con `bwip-js` para impresoras
  Zebra y genéricas. Trazabilidad inversa serial → GTIN padre via Transformation Event EPCIS.

- **Proceso F — Logística Inversa y Cuarentena (US.F2.5.29–38):** modelos `SanitaryAlert`,
  `DevolucionInventario`, `ReturnOrder`. Router `returns.*` con procedures `registerRecall`,
  `triggerSweep`, `registerReturn`, `registerMerma`, `clearLot`. Edge Function asíncrona
  de barrido de GLN (CTE recursiva sobre árbol GLN) con SLO < 30s medido via observability.
  Bloqueo transversal en `receiving`, `inventory` y `unitDose` via helper `checkSanitaryAlert`.
  Notificación outbox (patrón Beta.15) a farmacéuticos activos ante recall. Acta de devolución
  en PDF con firma digital del Director de Farmacia.

- **Motor EPCIS — Persistencia (US.F2.5.39):** tabla `EpcisEvent` inmutable con trigger
  `BEFORE UPDATE OR DELETE RAISE EXCEPTION` en `73_epcis_event.sql`. Soporta los 4 tipos
  del estándar: ObjectEvent, AggregationEvent, TransactionEvent, TransformationEvent.
  Campos WHAT/WHERE/WHEN/WHY/WHO en Json con índices GIN sobre campos críticos. RLS por
  `organizationId`. Sin `updatedAt` — inmutable por diseño (patrón audit hash chain).

- **Motor EPCIS — Consulta y Exportación (US.F2.5.40–41):** router `epcis.*` con filtros
  por GTIN, lote, GLN y rango de fechas. Exportación en JSON (compatible con EPCIS Query
  Interface 2.0) y PDF (para auditorías MINSAL). Corrección de eventos via patrón "void
  event" con referencia al evento original.

- **4 specs E2E GS1:**
  - `e2e/fase2/gs1-recepcion.spec.ts` — Proceso A: DESADV → escaneo → hard stops (5 escenarios).
  - `e2e/fase2/gs1-transferencia.spec.ts` — Proceso B: despacho → tránsito → recepción (4 escenarios).
  - `e2e/fase2/gs1-unidosis.spec.ts` — Proceso C: fraccionamiento → DataMatrix → conciliación (5 escenarios).
  - `e2e/fase2/gs1-recall.spec.ts` — Proceso F: recall → barrido → bloqueo → devolución (4 escenarios).

- **ADR `docs/adr/0017-gs1-event-sourcing.md`:** decision de tabla `EpcisEvent` dedicada
  (event sourcing) vs queries sobre tablas operacionales vs Kafka vs schema normalizado
  por tipo de evento. Alternativas rechazadas con razonamiento detallado.

- **Sprint Review `docs/sprint-reviews/sprint_f2_s6_review.md`:** logros 15 streams,
  metricas (~75 SP, 4 SQL, 13 tablas nuevas), retroactiva y carry-over F2-S7.

### Eliminados

- Nada eliminado. Los modelos GS1 son adiciones netas al schema sin afectar modelos previos.

---

## [Sprint F2-S4] — 2026-05-17

### Agregado

- **Hoja de Ingreso + Apertura de Episodio Hospitalario (US.F2.4.1–2):** UI completa
  en `app/(clinical)/hospitalizacion/nuevo`, router `hojaIngresoRouter` con procedures
  `crear`, `listar`, `detalle`. Vincula orden de ingreso a episodio hospitalario.

- **Valoración Inicial de Enfermería (US.F2.4.5):** nueva tabla
  `ece.valoracion_inicial_enfermeria` con columnas de valoracion cefalocaudal, Barthel,
  Braden, Glasgow, plan de cuidados inicial. SQL hardening completo en
  `packages/database/sql/66_valoracion_inicial_enfermeria.sql` (RLS policies +
  trigger inmutabilidad + FK a `ece.episodio_atencion`).

- **Mapa de Camas (cross-cutting):** componente `BedMap` sobre react-flow (heredado F2-S3),
  visualización de disponibilidad en tiempo real por servicio. Router `camaRouter.listar`
  con filtros por servicio, estado y piso.

- **Episodio Hospitalario con Alta Médica (US.F2.4.22):** router complementario
  `episodioHospitalarioRouter` con procedures `emitirEgreso` (transición `en_curso →
  egresado`) y `ordenEgreso`. Incluye validación de epicrisis completa antes del alta.

- **Ruta de Defunción (US.F2.4.24–25):** UI completa para `certificado-defuncion` y
  `acta-entrega-cuerpo`. Router `defuncionRouter` con procedures `registrarFallecimiento`,
  `emitirCertificado`, `registrarEntregaCuerpo`. Integración con flujo de egreso especial.

- **Bridge Admisión atómica (ADR 0014):** endpoint `admitirDesdeOrden` en
  `bridgeAdmisionRouter`. Ejecuta 5 INSERTs + 1 UPDATE en una sola transacción Postgres.
  Elimina la clase de bugs de estado parcial detectada en F2-S3.

- **3 specs E2E hospitalarios:**
  - `e2e/fase2/flujo-hospitalario.spec.ts` — happy path admisión → estancia → alta (5 escenarios).
  - `e2e/fase2/defuncion.spec.ts` — ruta fallecimiento + documentos legales (3 escenarios).
  - `e2e/fase2/mapa-camas.spec.ts` — listado, filtros, estado en tiempo real (3 escenarios).

- **Seed demo hospitalario:** `packages/database/scripts/seed-hospitalizacion-demo.mjs`.
  10 camas en servicio Medicina Interna, 3 episodios activos, personal de turno,
  datos realistas con DUI/NIT válidos (SLV).

- **ADR `docs/adr/0013-ece-mapa-camas-reactflow.md`:** decisión de renderizado client-side
  con react-flow vs SVG estático vs tabla HTML. Alternativas rechazadas con razonamiento.

- **ADR `docs/adr/0014-ece-bridge-admision-atomicidad.md`:** decisión de transacción única
  vs orquestación en cliente vs Saga pattern vs stored procedure.

- **Sprint Review `docs/sprint-reviews/sprint_f2_s4_review.md`:** logros 9 streams,
  metricas, retroactiva y carry-over F2-S5.

### Cambios

- **Epicrisis UI refinada (US.F2.4.23):** refactor del componente `EpicrisisForm`.
  Secciones colapsables, codificacion CIE-10 de egreso inline, receta digital, agenda
  de citas post-egreso. El router `epicrisisRouter` no cambia — solo la UI.

- **`episodioRouter` complementado:** procedimiento `emitirEgreso` agregado al router
  existente. No es un router nuevo, es una extension backward-compatible.

### Eliminados

- Nada eliminado. La UI de episodio ambulatorio (rutas `/ece/ambulatorio/**`) permanece
  intacta — no hay duplicacion detectada que amerite eliminacion en este sprint.

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
