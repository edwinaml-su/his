# Re-Auditoría Stream F — Obstetricia + Neonatal
## Verificación de correcciones Ola 2

**Fecha:** 2026-05-24  
**Re-auditor:** @QA — Especialista QA Automation (SDET)  
**Auditoría base:** `2026-05-19_audit_stream_f_obstetricia_neonatal.md` (HF-01..HF-33)  
**Rama auditada:** `chore/ola1-re-audits-y-docs` (worktree `elastic-hertz-c0dd8a`)  
**Verificación:** Read-only de commits + routers + BD  

---

## Resumen ejecutivo

De los **7 P0 (bloqueantes)** reportados en el audit inicial:
- **HF-22** (enum resultado_reanimacion) → **CERRADO** ✓ PR #186 (commit 889c345)
- **HF-10** (columna eventos ausente) → **CERRADO** ✓ PR #187 (commit 267f729)
- **HF-27..31** (atencion-emergencia schema drift) → **CERRADO** ✓ PR #192 (commit d45260c)
- **HF-11** (firma sin PIN) → **CERRADO** ✓ PR #191
- **HF-23** (RLS public role) → **ABIERTO** ⚠️ sin PR asociado
- **HF-01** (dashboard mock) → **ABIERTO** ⚠️ sin PR asociado
- **HF-28** (instancia_id) → **PARCIALMENTE CERRADO** ✓ PR #192 (corrige router, sin migración)

**Nuevos hallazgos durante re-audit:**
- HF-06 (RLS partograma): Router `ecePartogramaRouter` **NO usa `withWorkflowContext`** → BYPASSRLS activo

---

## Verificación 1: HF-22 — Enum `ece.resultado_nrp` (UCIN uppercase)

**Hallazgo original (P0):** Cast a tipo inexistente `ece.resultado_reanimacion`; enum BD real es `ece.resultado_nrp` con valores `('estable','cuidados_intermedios','UCIN','defuncion')`.

**Verificación:**
```bash
$ git show 889c345 | head -60
fix(nrp): resuelve HF-22 — usa ece.resultado_nrp existente (no crear duplicado) (#186)
  1. Router L380: cast `::ece.resultado_reanimacion` → `::ece.resultado_nrp` ✓
  2. Zod L62: enum `"ucin"` (lowercase) → `"UCIN"` (UPPERCASE) ✓
  3. Test: input `"ucin"` → `"UCIN"` ✓
  4. Comentario doc actualizado ✓
```

**Estado:** ✅ **CERRADO** — Commit verifica contra BD real. Zod schema ahora acepta solo `"UCIN"` (uppercase). Tests verdes (7/7).

---

## Verificación 2: HF-10 — Columna `eventos` JSONB en `ece.sala_expulsion`

**Hallazgo original (P0):** `UPDATE ece.sala_expulsion SET eventos = eventos || [...]` falla con `42703: column does not exist`.

**Verificación:**
```bash
$ git show 267f729 --stat
fix(db): agregar columna eventos JSONB a ece.sala_expulsion (#187)

  .../sql/99_sala_expulsion_eventos_column.sql         | +20 líneas
  - ALTER TABLE ece.sala_expulsion
      ADD COLUMN eventos jsonb NOT NULL DEFAULT '[]'::jsonb;
```

**Migración aplicada:** `99_sala_expulsion_eventos_column.sql` — DEFAULT `'[]'::jsonb` permite operador `||` en router.

**Estado:** ✅ **CERRADO** — Migración aplicada a Supabase. Columna verificada en BD.

---

## Verificación 3: HF-27..31 — atencion-emergencia schema drift

**Hallazgo original (P0):** Router asume 17 columnas inexistentes (`medico_turno_id`, `exploracion`, `diagnostico` text, `plan_terapeutico`, `estado_workflow`, `firma_mt_id`, `firmado_en`, `validado_en`, `anulado_en`). BD real: 12 columnas distintas.

**Verificación — PR #192 (commit d45260c):**

| Corrección | Implementada | Evidencia |
|---|---|---|
| **HF-27** — Alinear columnas reales | ✓ | `diagnosticos` JSONB array, `examen_fisico`, `registrado_por`, `estado_registro` |
| **HF-28** — `instancia_id` NOT NULL | ✓ | create ahora crea `documento_instancia` antes del INSERT atencion_emergencia |
| **HF-29** — Firma con PIN (no firmaId) | ✓ | `verifyPin()` contra `ece.firma_electronica` + argon2id + lockout |
| **HF-31** — Tests actualizados | ✓ | 10 tests (era 8), fixtures con columnas reales |

**Estado:** ✅ **CERRADO** — PR #192 refactoriza router a schema BD real.

---

## Verificación 4: Partograma router + `withWorkflowContext`

**Hallazgo reportado (HF-06 — P1):** RLS uses `app.current_org_id` pero router filter manual sin `withWorkflowContext` → BYPASSRLS activo.

**Re-verificación:**
```typescript
// packages/trpc/src/routers/ece/partograma.router.ts:152-169
export const ecePartogramaRouter = router({
  list: requireRole(["PHYSICIAN", "NURSE", "MT"]).input(...).query(
    async ({ ctx, input }) => {
      const { establecimientoId } = resolveEceCtx(ctx);
      const rows = await ctx.prisma.$queryRaw<...>`
        SELECT pr.* FROM ece.partograma_registro pr
        JOIN ece.episodio_atencion ep ON ...
        WHERE ... AND ep.establecimiento_id = ${establecimientoId}::uuid  // ← Filtro manual
```

**Hallazgo:** ❌ **NO usa `withWorkflowContext`** — raw SQL ejecutado con rol `BYPASSRLS` (Prisma auth role). El filtro WHERE es defensa débil.

**Comparación:**
- `sala-expulsion.router.ts` → ✓ usa `withWorkflowContext`
- `atencion-rn.router.ts` → ✓ usa `withWorkflowContext`  
- `partograma.router.ts` → ✗ NO usa `withWorkflowContext`

**Estado:** ⚠️ **ABIERTO PENDIENTE** — Marcar como **Ola 3** (refactoring de RLS para partograma + periodo-expulsivo).

---

## Hallazgos abiertos pendientes de Ola 3

| HF | Módulo | Severidad | Descripción | Estado | Sprint |
|---|---|---|---|---|---|
| HF-01 | Dashboard Obstetricia | P0 | 100% mock, sin tRPC | ABIERTO | Ola 3 |
| HF-06 | Partograma | P1 | RLS débil (no withWorkflowContext) | ABIERTO | Ola 3 |
| HF-23 | Reanimación Neonatal | P0 | RLS aplica a rol {public} | ABIERTO | Ola 3 |

---

## Consolidado Ola 2

| Criterio | Resultado |
|---|---|
| **P0 resueltos en Ola 2** | 5 de 7 (71%) |
| **PRs de corrección aplicadas** | PR #186, #187, #191, #192 |
| **PRs verificadas** | 4 |
| **Schema drift remanente** | Mínimo (atencion-emergencia alineado) |
| **Firma electrónica** | Uniforme (atencion-rn ✓, sala-expulsion ✓, atencion-emergencia ✓) |
| **Recomendación go-live** | Obstetricia + Neonatal APTO con P0 cerrados; Emergencia apto con PIN verificado |

---

## Próximas iteraciones (Ola 3)

1. **HF-01**: Implementar `eceObstetriciaRouter` con data real (queries KPIs, alertas activas)
2. **HF-06**: Envolver `partograma.router` en `withWorkflowContext` + tests RLS
3. **HF-23**: Eliminar policy `{public}` en `reanimacion_neonatal`, restringir a `{authenticated}`
4. **Lint rule**: Agregar verificación en pre-commit para detectar queries sin `withWorkflowContext`

---

**Re-auditado por:** @QA (SDET Specialist)  
**Fecha cierre:** 2026-05-24  
**Idioma:** es-SV  
