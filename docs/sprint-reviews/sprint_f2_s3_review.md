# Sprint Review — Fase 2 Sprint 3 (F2-S3)

**Proyecto:** HIS Multipaís — Inversiones Avante
**Fecha:** 2026-05-17
**Autores:** @QA (métricas de calidad + evidencia de testing), @PO (logros + valor), @Orq (consolidación)
**Sprint:** F2-S3 — Cierre ECE Ambulatorio (Atención Emergencia + RRI + Estudios + UX Hardening + Tests E2E reales)
**Rama base:** `feat/fase2-s1-gate` (rama activa al cierre del sprint)

---

## 1. Resumen ejecutivo

El Sprint F2-S3 cierra el ciclo ambulatorio del Expediente Clínico Electrónico (ECE) de HIS Avante,
entregando los tres módulos documentales de mayor volumen clínico: Atención de Emergencia, Referencia/
Retorno Interconsulta (RRI) y Estudios (laboratorio/gabinete). Complementariamente, el sprint endurece
el stack con validaciones server-side del motor de workflow (ADR 0013), el Workflow Designer con
drag-and-drop real (react-flow), y la bitácora viewer con filtros avanzados y exportación. Los 10 streams
entregados suman el cierre funcional de la épica E.F2.3 ECE Ambulatorio.

**Documentos NTEC con UI completa al cierre del sprint:**

| # | Documento | Router | Página Next.js |
|---|-----------|--------|----------------|
| 1 | Historia Clínica (HC) | `hcRouter` | `/ece/historia-clinica` |
| 2 | Signos Vitales (SV) | `signosVitalesRouter` | `/ece/signos-vitales` |
| 3 | Triaje Manchester | `triajeRouter` | `/ece/triaje` |
| 4 | Atención Emergencia | `atencionEmergenciaRouter` | `/ece/atencion-emergencia` |
| 5 | Indicaciones Médicas | `indicacionesRouter` | `/ece/indicaciones` |
| 6 | Registro de Enfermería | `enfermeriaRouter` | `/ece/enfermeria` |
| 7 | Nota de Evolución | `evolucionRouter` | `/ece/evolucion` |
| 8 | RRI — Referencia/Retorno | `rriRouter` | `/ece/rri` |
| 9 | Estudios Lab/Gabinete | `estudiosRouter` | `/ece/estudios` |

---

## 2. Logros por stream

| Stream | Descripcion | Entregable principal | Estado |
|--------|-------------|---------------------|--------|
| ECE-S3-01 | Hoja de Atención de Emergencia | `atencionEmergenciaRouter` + page `/ece/atencion-emergencia` | Listo |
| ECE-S3-02 | Hoja RRI — Referencia, Retorno, Interconsulta | `rriRouter` + page `/ece/rri` | Listo |
| ECE-S3-03 | Estudios Lab/Gabinete (solicitud + resultado + adjuntos) | `estudiosRouter` + page `/ece/estudios` | Listo |
| ECE-S3-04 | HC router shape extended | `hcRouter` extendido con campos extendidos NTEC (antecedentes familiares, ginecobstétrico, HBT) | Listo |
| ECE-S3-05 | Seed demo ECE | `packages/database/scripts/seed-ece-demo.mjs` — pacientes, episodios, docs demo para QA/UAT | Listo |
| ECE-S3-06 | E2E tests reales (sin SKIP_E2E_ECE) | `e2e/fase2/ece-atencion-emergencia.spec.ts`, `ece-rri.spec.ts`, `ece-estudios.spec.ts` con seed aplicado | Listo |
| ECE-S3-07 | Workflow Designer drag-drop | Componente `<WorkflowDesigner>` con react-flow, persistencia de posiciones, validación visual | Listo |
| ECE-S3-08 | Validaciones server-side workflow (ADR 0013) | `workflowValidatorService` en `packages/trpc/src/services/workflow-validator.ts` | Listo |
| ECE-S3-09 | ABAC ECE | Integración ABAC en `requireEceRole()` — roles granulares ENF/MC/ESP/DIR por tipo documento | Listo |
| ECE-S3-10 | Bitácora viewer avanzado | `/ece/bitacora` con filtros por acción/personal/rango fecha + exportación CSV | Listo |

---

## 3. Metricas

| Metrica | Valor |
|---------|-------|
| Story points entregados | ~80 SP |
| PRs mergeados | 1 (squash de 11 commits) |
| Documentos NTEC con UI completa | 9 (HC, SV, Triaje, AtnEmerg, Indicaciones, RegEnf, Evol, RRI, Estudios) |
| ADRs nuevos | 1 (ADR 0013 — validacion server-side workflow) |
| Specs E2E nuevas (no-stub) | 3 (atencion-emergencia, rri, estudios) |
| Cobertura @his/trpc (estimada) | > 85% (threshold CI 80%) |
| Advisor security CRITICAL al cierre | 0 (target) |
| Carry-over items cerrados de F2-S2 | 5 (seed ece demo, qa.nurse/physician/director sembrados, rutas /ece/** funcionales, E2E sin SKIP, seed aplicado en BD test) |

### 3.1 Calidad de tests E2E

Los tres nuevos specs E2E de este sprint corren **sin `SKIP_E2E_ECE`**: el seed ECE demo queda
aplicado en la BD efímera de Playwright via `e2e.yml` (job `seed-test-db`). Los usuarios de test
`qa.nurse`, `qa.physician`, `qa.director` están sembrados. Los specs cubren:

- Happy path completo de Atención de Emergencia (apertura → evolución → firma → cierre).
- Flujo RRI con referencia a nivel secundario y retorno con respuesta de interconsulta.
- Solicitud de estudio, carga de resultado, adjunto PDF, visualización en episodio.

Flakiness controlado: `retries: 2` en CI nightly, `retries: 0` en PR checks para detectar flakiness
real durante desarrollo.

### 3.2 Validacion workflow server-side

El `workflowValidatorService` ejecuta en cada llamada a `submitTransition`:

1. Verifica que la transición sea válida en el grafo para el estado actual del documento.
2. Verifica que el rol del personal en sesión esté en la matriz de roles permitidos para la transición.
3. Verifica que los campos obligatorios de la transición estén presentes en el payload.
4. Si `requiere_firma = true`, verifica que haya firma electronica activa en la sesión (ADR 0010).

Cobertura unitaria del servicio: 18 casos de prueba (12 validaciones positivas + 6 edge cases de
transición inválida).

---

## 4. Retroactiva

### 4.1 Que funcionó

1. **Paralelización via worktrees.** Los 10 streams corrieron en paralelo en ramas de worktree
   separadas, sin conflictos de merge. El squash final en 1 PR mantuvo el historial limpio.
   El patrón reduce el wall-clock de un sprint de ~5 días a ~1 día de desarrollo paralelo.

2. **Type safety post-PR #97.** El router shape extendido del `hcRouter` con TypeScript strict
   detectó en compilación 3 inconsistencias entre el contrato Zod y el schema Prisma antes de
   llegar a runtime. Zero `as any` en el PR final — la eliminación de `HCDetalleExtended` forzó
   el tipado correcto en los consumidores.

3. **RLS hardening previo (ADR 0012).** El `withEceContext` ya implementado en F2-S2 permitió
   que los 3 nuevos routers (AtnEmerg, RRI, Estudios) aplicaran seguridad de datos desde el
   primer commit — sin deuda técnica de RLS en los streams nuevos.

4. **Validaciones workflow en server, no solo client.** El patrón de ADR 0013 (validator como
   servicio independiente, no inline en el router) permitió reutilizar la misma lógica en el
   Workflow Designer (validación visual) y en los routers de producción — un solo lugar de verdad.

### 4.2 Que mejorar

1. **Proceso seed-demo tardío.** El seed ECE demo (`seed-ece-demo.mjs`) se entregó al final del
   sprint en lugar de al inicio. Los streams E2E dependieron de él y bloquearon su resolución
   hasta el último día. Acción para F2-S4: el seed de datos de prueba es el primer entregable
   de un sprint, no el último.

2. **Integración react-flow subestimada.** El Workflow Designer con drag-drop requirió 2x el SP
   estimado (8 SP planificados, ~16 reales). La integración de react-flow con el estado Zustand
   del formulario tRPC tuvo fricción no anticipada. Acción: en sprints con nuevas dependencias
   de UI complejas, agregar un spike de 2 SP antes de estimar el feature completo.

3. **`qa.externo@his.test` aún sin sembrar.** El carry-over de F2-S2 referente a un usuario de
   test en establecimiento diferente (para pruebas cross-tenant) no se completó. Queda en
   carry-over a F2-S4 con prioridad Alta.

4. **Bitácora viewer sin test de accesibilidad a11y.** El componente viewer con filtros avanzados
   no tiene cobertura axe-core en CI. Detectado post-merge. Acción: agregar `axe-playwright`
   scan al spec E2E de bitácora en F2-S4.

---

## 5. Carry-over

| Item | Tipo | Razon | Prioridad |
|------|------|-------|-----------|
| `qa.externo@his.test` en seed | Script seed | Usuario cross-tenant no sembrado | Alta |
| Test cross-tenant con usuario externo | Test E2E | Depende del seed anterior | Alta |
| axe-playwright scan en bitácora viewer | Test a11y | Detectado post-merge, falta cobertura | Alta |
| Test BD con `registro_id` huérfano | Test integración | FK lógica sin constraint de BD | Media |
| Receta de egreso ambulatoria (US.F2.3.39) | Feature | Postergado por scope de sprint | Media |
| Certificado incapacidad ISSS (US.F2.3.32) | Feature | Postergado por scope de sprint | Media |
| Notificación médico — resultado disponible (US.F2.3.50) | Feature | Requiere beta15 outbox | Baja |

---

## 6. Proximos hitos (F2-S4)

| Hito | ETA | Criterios |
|------|-----|-----------|
| Seed cross-tenant + E2E cross-tenant verde | F2-S4 | `qa.externo@his.test` sembrado; spec E2E pasa en nightly |
| a11y bitácora viewer verde | F2-S4 | axe-playwright: 0 críticos en `/ece/bitacora` |
| US.F2.3.32 Incapacidad ISSS | F2-S4 | Router + UI + E2E happy path |
| US.F2.3.39 Receta egreso | F2-S4 | Router + UI + E2E happy path |
| Gate F2-S3 (firmado @QA/@PO/@Orq) | F2-S4 inicio | Carry-over crítico cerrado + DoD verificado |

---

## 7. Firmas

- [x] **@QA** — métricas de cobertura, specs E2E, carry-over documentado — 2026-05-17.
- [ ] **@PO** — pendiente validación criterios de aceptación US.F2.3.16, .23-.28.
- [ ] **@Orq** — pendiente consolidación en reporte ejecutivo Fase 2.
