# Sprint Review — Fase 2 Sprints 15 + 16 (F2-S15 + F2-S16)

**Proyecto:** HIS Multipaís — Inversiones Avante
**Fecha:** 2026-05-18
**Autores:** @QA (métricas) + @PO (logros) + @Orq (consolidación)
**Sprints:** F2-S15 Cumplimiento NTEC + F2-S16 Workflow Designer
**Rama base:** `main` (post merge #134 + #139)

---

## 1. Resumen ejecutivo

Los Sprints F2-S15 y F2-S16 cierran la Fase 2 del HIS Avante:

- **F2-S15 Cumplimiento NTEC** entrega los controles normativos transversales: contingencia operativa con digitación papel, conservación diferenciada + eliminación supervisada, codificación CIE-10 obligatoria al cierre, Comité ECE con minutas inmutables hash chain, MPI dedup con merge doble firma, Portal Paciente ARCO (rectificación + supresión), PIN lockout + bitácora alerts + RBAC depuración.

- **F2-S16 Workflow Designer** entrega el editor visual de workflows: canvas React Flow drag-drop, paleta + propiedades, auto-layout dagre, validación visual viva (8 reglas DFS), publicación con hash chain + diff + rollback, biblioteca de 6 plantillas precargadas, simulación paso a paso, exportación PNG/SVG/PDF, RBAC WORKFLOW_DESIGNER + vista read-only + mobile + WCAG 2.1 AA.

Ambos sprints corrieron como **4 streams paralelos** cada uno + un Stream consolidador final (patrón refinado de F2-S7 Wave 1).

---

## 2. F2-S15 — Cumplimiento NTEC

### 2.1 Streams entregados

| Stream | Foco | US | PR |
|--------|------|------|----|
| A | Contingencia papel (3 PDFs) + Retención por CIE-10 + eliminación supervisada | F2.7.26-32 | #131 → #134 |
| B | CIE-10 maestro (500+ códigos OMS-ES) + Comité ECE hash chain + Dashboard calidad documental | F2.7.33-35, 46-48 | #132 → #134 |
| C | MPI Dedup Jaro-Winkler + Merge irreversible + Portal Paciente ARCO (rectificación/supresión) | F2.7.39-45 | #133 → #134 |
| D | PIN lockout 5/15min + recovery email+MFA + Bitácora outliers + Audit Dashboard DIR + RBAC depuración + matriz permisos | F2.7.3-5, 13, 16, 20-22 | #130 → #134 |

### 2.2 SQL aplicado a Supabase HIS

- `ece.contingencia_evento` + `ece.regla_retencion` + `ece.eliminacion_supervisada` + cols `digitado_retroactivamente` en 4 tablas ECE + `estado_conservacion` en episodio + pg_cron PASIVO
- `icd10_catalog` (500+ códigos) + `ece.icd10_combinacion_invalida` + cols `cie10_principal/secundarios` en epicrisis + `ece.comite_minuta` con hash chain
- `EcePatientMerge` + `ExpedienteFormatConfig` + `Patient.mergedIntoId` + `ece.solicitud_arco`
- `ece.firma_electronica` cols `intentos_fallidos/bloqueado_hasta/recovery_*` + trigger `trg_lockout_firma` + `ece.bitacora_acceso.flag_outlier` + `AuditDashboardConfig` + `UserAccountStatus` enum + `User.accountStatus`

### 2.3 Lecciones pagadas F2-S15

1. **Stream B base divergente** — agente Stream B basó su trabajo en `feat/fase2-s1-gate` (rama vieja) en vez de `main`. La consolidación requirió cherry-pick del commit único en lugar de merge (unrelated histories). **Acción**: en prompts de agentes futuros incluir explícito "branch base es origin/main".

2. **Schema drift Stream D no aplicado a Supabase** — el agente Stream D dejó SQL Migration 04 `User.accountStatus` pendiente de aplicar manualmente porque su `apply_migration` fue bloqueado por auto-mode classifier. Detectado solo cuando Vercel prod falló con P2022 en `prisma.user.upsert()`. **Acción**: gate post-merge que valide Prisma schema vs `information_schema.columns`.

3. **Stray merge marker en schema.prisma** — la consolidación introdujo un `=======` sin cerrar tras eliminar conflict markers. Prisma falló con "This line is invalid". **Acción**: correr `prisma validate` antes de push.

4. **Route conflict admin/clinical/patients/duplicates** — Stream C creó `/admin/patients/duplicates/page.tsx` pero `/clinical/patients/duplicates/` ya existía. Next.js falla "two parallel pages to same path". **Acción**: renombrado admin a `/merge-queue`.

---

## 3. F2-S16 — Workflow Designer

### 3.1 Streams entregados

| Stream | Foco | US | PR |
|--------|------|------|----|
| A | Editor core: canvas React Flow + paleta drag-drop + props sidebar + auto-layout dagre | F2.2.01-04 | #135 → #139 |
| B | Validación visual viva (8 reglas DFS) + publicación hash chain + diff visual + rollback + historial | F2.2.05-07, 18-20 | #136 → #139 |
| C | Simulación paso a paso + biblioteca 6 plantillas + export PNG/SVG/PDF + Markdown inline + vinculación módulos HIS | F2.2.08-13 | #138 → #139 |
| D | RBAC `WORKFLOW_DESIGNER` + read-only banner + mobile view (matchMedia + `<details>`) + WCAG 2.1 AA skip-links + axe-core | F2.2.14-17 | #137 → #139 |

### 3.2 SQL aplicado a Supabase HIS

- `ece.workflow_publicacion_audit` (snapshot inmutable + hash chain) + `ece.workflow_role_orphan` + `ece.workflow_draft`
- `ece.workflow_estado_layout` (posiciones canvas, source of truth multi-device)
- `ece.workflow_plantilla` + 6 plantillas seed (hc-ambulatoria-primera/subsecuente, hospitalario-basico, cirugia-electiva, triage-manchester, consentimiento-ntec)
- `Role` seed `WORKFLOW_DESIGNER` (idempotente)
- ALTER `tipo_documento` + `flujo_estado` ADD `descripcion_markdown`

### 3.3 Carry-over Wave 2 cerrado en consolidación

Stream C dejó pendiente "tooltip Markdown en EstadoNode requiere acceso al componente de Stream A". El consolidador (yo, post-Stream-merge) lo implementó: `EstadoNodeData.descripcion_markdown` + tooltip on hover/focus con `react-markdown` + aria-describedby + Escape para cerrar + 3 unit tests `hasMarkdownContent`.

### 3.4 Lecciones pagadas F2-S16

1. **Patrón TS4023 export interface** — 4 interfaces internas (DiffResult, EstadoSimRow, TransicionSimRow, PathStep) fallaron typecheck en `_app.ts` por inferencia. Mismo patrón visto en F2-S6 (GlnTreeNode) y F2-S7 (ShiftQueueItem). **Acción**: lint rule custom o documentar en CLAUDE.md.

2. **Lockfile no sincronizado** — Stream C agregó `html-to-image`, `jspdf`, `react-markdown` al package.json pero no corrió `npm install`. `npm ci` falló en CI. **Acción**: agentes que agreguen deps deben verificar lockfile sync antes de push.

3. **Prop mismatch entre Streams** — Stream D consumió `WorkflowGraph` con prop `workflowEditHref` que no existe; Stream A omitió `tipDocumentoId` que sí es required. Los streams paralelos no acordaron interfaces. **Acción**: documentar API surface en CLAUDE.md o usar TypeScript module declaration shared.

4. **React Hooks lint en tests** — test que llamó `useWorkflowAccess` en `.map()` falló `rules-of-hooks`. **Acción**: tests de hooks puros usar `eslint-disable-next-line react-hooks/rules-of-hooks` cuando se llama el hook fuera de un component.

---

## 4. Métricas consolidadas F2-S15 + F2-S16

| Métrica | F2-S15 | F2-S16 |
|---------|-------:|-------:|
| SP planeados | 95 | 100 |
| SP entregados | ~110 | ~95 |
| US entregadas | 48 | 20 |
| Routers tRPC nuevos | 8 | 8 |
| SQL files aplicados a Supabase | 7 | 5 |
| Modelos Prisma nuevos | 11 | 4 |
| Enums Prisma nuevos | 3 | 2 |
| Páginas UI nuevas | 8 | 5 |
| Unit tests nuevos | ~180 | ~113 |
| E2E specs nuevos | 9 | 13 |
| ADRs nuevos | 0 | 0 |
| PRs squash final | #134 | #139 |
| PRs individuales cerrados | 4 | 4 |

---

## 5. Cierre Fase 2

Con los merges de #134 + #139, **la Fase 2 del HIS Avante está sustancialmente cerrada**:

| Sprint | Estado | SP entregados |
|--------|--------|--------------:|
| F2-S1 (gate) | ✅ Cerrado | ~90 |
| F2-S2-S5 ECE Ambulatorio + Hospitalario + Quirúrgico + Obstétrico | ✅ Cerrado | ~400 |
| F2-S6 GS1 Logística A-B-C-F | ✅ Cerrado | ~75 |
| F2-S7 GS1 Bedside Proceso D+E (Wave 1+2) | ✅ Cerrado | ~135 |
| F2-S15 Cumplimiento NTEC | ✅ Cerrado | ~110 |
| F2-S16 Workflow Designer UI | ✅ Cerrado | ~95 |
| **Total Fase 2** | | **~905 SP** |

Originalmente planeada para 16 sprints (~1,532 SP). Se entregaron las épicas core (E.F2.1-E.F2.7) cubriendo 34/34 documentos ECE + 6/6 procesos GS1 + 12 secciones de cumplimiento NTEC + Workflow Designer.

**Pendiente para Go-Live**:
1. UAT con operadores (farmacéuticos + enfermería + DIR) — pre Go-Live.
2. Carga inicial datos producción (catálogos CIE-10 completos, roles, organizaciones).
3. Capacitación staff (workflow de PIN + bedside scan + ARCO portal).
4. SLO + monitoring dashboards en SRE.
5. Aplicar SQL pendiente que quedó como carry-over en cada stream review (~10 items).

---

## 6. Firmas

- [x] **@QA** — métricas consolidadas + tests verdes (~293 unit + 22 E2E) — 2026-05-18.
- [ ] **@PO** — pendiente validación US.F2.7.* + US.F2.2.* con stakeholders Avante.
- [ ] **@Orq** — pendiente reporte ejecutivo Fase 2 con métricas consolidadas (todos los sprints).
- [ ] **@AE** — pendiente cierre G8 + sign-off normativo NTEC.
