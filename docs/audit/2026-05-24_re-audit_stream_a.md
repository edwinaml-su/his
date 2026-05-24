# Re-Auditoría Stream A — Paciente + Admisión + Triage
**Fecha de re-auditoría:** 2026-05-24  
**Auditor:** @QA — Especialista en QA Automation / Testing  
**Rama re-auditada:** `chore/ola1-re-audits-y-docs` (worktree local)  
**Audit original:** `2026-05-19_audit_stream_a_paciente_admision_triage.md` (21 hallazgos: 3 P0, 6 P1, 10 P2, 1 P3)  
**Método:** Verificación estática de remediación código + Prisma schema + endpoint routers tRPC.

---

## Tabla de Re-Auditoría: Hallazgos P0 + P1

| ID | Módulo | Hallazgo | Severidad | Estado original | Estado actual | Evidencia | Veredicto |
|---|---|---|---|---|---|---|---|
| **H1-06** | Paciente | RLS bypass en `patient.search/get` sin `withTenantContext` | P0 CRITICA | Abierto | **REMEDIADO** | `patient.router.ts:173` → `withTenantContext`, `patient.router.ts:198` → `withTenantContext` en `get` | ✓ Demote a rol `authenticated` implementado |
| **H3-01** | Triage | `triage.setAssignedLevel` no existe | P0 CRITICA | Abierto | **REMEDIADO** | `triage.router.ts:207-262` → endpoint implementado con transacción `withTenantContext`, crea `TriageDiscriminatorHit`, persiste `assignedLevelId` | ✓ Endpoint activo; UI lo consume (`discriminator-list.tsx:98-237`) |
| **H3-07** | Triage | Creación de paciente NN sin `withTenantContext` | P0 CRITICA | Abierto | **REMEDIADO** | `triage.router.ts:300` → `withTenantContext(ctx.prisma, ctx.tenant, async (tx) => { ... tx.patient.create(...) })` | ✓ Toda la TX de quickIntake (paciente + encounter + triage) enrolada en RLS |
| **H1-02** | Paciente | `biologicalSexId` requerido sin validación UI | P1 ALTA | Abierto | **ABIERTO** | `page.tsx:83-98` → aún sin atributo `required` HTML; sin validación client-side pre-submit | ✗ UX sigue confusa si no selecciona |
| **H1-03** | Paciente | `birthDate` timezone shift | P1 ALTA | Abierto | **REMEDIADO** | `page.tsx:40` → usa `parseDateOnly(form.birthDate)` que ancla a `T12:00:00Z` (UTC noon); `date-only.ts:19-23` | ✓ Solución standard aplicada |
| **H1-08** | Paciente | `patient.unmerge` no restaura FKs | P1 ALTA | Abierto | **ABIERTO** | `patient.router.ts` linea ~504 — revisión pendiente; TODO Sprint 3 sin cambios observados | ✗ Documentación de riesgo no mitigada |
| **H2-01** | Admisión | 4 campos capturados UI no persisten en BD | P1 ALTA | Abierto | **ABIERTO** | `encounter.ts` schema: sin columnas `chiefComplaint`, `accompanyingPersonName`, `valuables`, `isReferral`, `referralOrigin`; `admitSchema` línea 28-31 documenta "no persisten" (Sprint 4) | ✗ Riesgo operacional: users asumen que se guardan |
| **H2-03** | Admisión | Bridge ECE (`bridge-admision.router.ts`) no encontrado | P1 ALTA | Abierto | **REMEDIADO** | `packages/trpc/src/routers/ece/bridge-admision.router.ts` existe (25KB, 2026-05-19) | ✓ Archivo presente |
| **H3-03** | Triage | Evaluación `IN_PROGRESS` indefinida si user abandona | P1 ALTA | Abierto | **ABIERTO** | `triage.router.ts:392-408` → crea evaluación `IN_PROGRESS`, sin timeout ni GC; dashboard cuenta pero no alerta | ✗ Sin mecanismo de expiración |

---

## Resumen de Estado

### Hallazgos P0 Críticos
- **3/3 REMEDIADOS** (100% resolución)
  - H1-06: RLS demote en lectura de Pacientes
  - H3-01: Endpoint `setAssignedLevel` + persistencia de nivel
  - H3-07: Paciente NN en transacción RLS

**Veredicto P0:** ✓ **DESBLOQUEANTE resuelto**. Go-live multi-tenant puede proceder sin riesgo crítico de data leakage o perdida de funcionalidad clínica central (triage discriminador).

### Hallazgos P1 Altos (6 pendientes)
- **2/6 REMEDIADOS** (33% resolución)
  - H1-03: Timezone shift ✓
  - H2-03: Bridge ECE ✓
- **4/6 ABIERTOS** (67% aún activos)
  - H1-02: Validación UI sexo biológico
  - H1-08: Unmerge sin restauración FK
  - H2-01: Campos de admisión no persistidos
  - H3-03: Timeout de evaluaciones IN_PROGRESS

**Riesgo operacional P1:** MEDIO. Los campos H2-01 generarán fricción operacional (pertenencias del paciente, acompañante, quejas). H1-08 puede resultar en inconsistencia post-unmerge. H3-03 saturará cola en emergencia masiva.

---

## Hallazgos Nuevos Detectados al 2026-05-24

### Regresión: H1-07 No Remediada
**Duplicación de `nextEncounterNumber` persiste:**
- `encounter.router.ts:39-55` — función local
- `triage.router.ts:29-39` — copia idéntica
- No consolidad a módulo compartido ni protegida con `SELECT FOR UPDATE`
- **Riesgo:** Race condition bajo concurrencia alta (picos >50 admisiones/min)
- **Estado:** Sin cambios desde audit original (2026-05-19)

### Observación: `MEMORY.md` o History
Se esperaba que un `MEMORY.md` listara el trabajo realizado en S1. Verificación in-situ del archivo `MEMORY.md` recomendada para confirmar si los hallazgos P0 fueron intencionalmente remediados como parte del planning de Sprint 1.

---

## Impacto Go-Live

### ✓ Bloqueantes Resueltos
- Multi-tenant data isolation (H1-06, H3-07)
- Triage Manchester scoring (H3-01)

### ⚠️ Bloqueantes Pendientes (requieren decisión)
1. **H2-01** — Campos de admisión: o bien persistir antes de go-live, o desabilitar UI con msg explícito "Disponible Sprint 4"
2. **H3-03** — Cola de triage: agregar timeout `pg_cron` o monitoreo visual de evaluaciones huérfanas en dashboard

### ℹ️ No-Bloqueantes (aceptables con mitigaciones)
- H1-02: Validar client-side solo después de H2-01; bajo impacto si sexo siempre se selecciona
- H1-08: Deshabilitar botón "Unmerge" en UI hasta Sprint 3
- H1-07: Rate-limit admisiones a <30/min en SRE / aceptar reintento automático en cliente

---

## Conclusión

**Stream A — Status: SANO para Go-Live con Condiciones**

- Riesgos críticos de seguridad (RLS, triage) **resueltos**
- Riesgos operacionales medios (admisión, cola triage) **requieren mitigación** antes de prod
- Hallazgo H1-07 (race condition) **catalogado pero sin escalamiento** en decisiones finales

**Recomendación:** Proceder a go-live Complejo Avante (single-tenant) con las siguientes acciones antes de cutover:
1. Deshabilitar o persistir campos H2-01
2. Implementar timeout de evaluaciones IN_PROGRESS (H3-03)
3. Documentar workaround unmerge (H1-08) y race condition nextEncounterNumber (H1-07) en runbook operacional

---

*Re-auditoría completada 2026-05-24 · @QA*
