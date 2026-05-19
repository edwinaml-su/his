# Consolidación de Auditorías — Top-15 P0/P1 + Plan de Remediación

**Fecha:** 2026-05-19
**Autor:** @AS — Arquitecto de Software, Unidad de Transformación Digital, Inversiones Avante
**Insumos:** 4 reportes de auditoría UI ↔ ORM ↔ DB
**Tipo:** Análisis consolidado — sin cambios de código

---

## 1. Resumen ejecutivo

Se ejecutaron 4 streams de auditoría sobre los 19 módulos más críticos del HIS Multipaís Avante (≈55% del scope clínico/admin). El resultado agregado es **101 hallazgos / 26 P0-BLOQUEANTE / 26 P1-ALTO**. La causa raíz dominante (≈70% de los P0) es **schema drift entre `schema.prisma` / routers tRPC / `ece.*` SQL DDL**: routers hablan a columnas que la BD no expone, UIs hablan a routers que no existen, y tablas declaradas en el modelo nunca fueron migradas a producción.

**Estado Go-Live:** **NO APTO**. De los 19 módulos auditados, **13 están bloqueados** por al menos un P0 que produce falla inmediata en producción o viola normativa NTEC.

| Stream | PR | Módulos | Total | P0 | P1 | P2 | P3 |
|---|---|---|---:|---:|---:|---:|---:|
| A — Paciente + Admisión + Triage | [#157 merged](https://github.com/edwinaml-su/his/pull/157) | 3 | 21 | 3 | 5 | 12 | 1 |
| B — HC + Indicaciones + eMAR + Farmacia | [#159](https://github.com/edwinaml-su/his/pull/159) | 4 | 23 | 8 | 8 | 7 | 0 |
| C — Epicrisis + Defunción + Consentimiento | [#158](https://github.com/edwinaml-su/his/pull/158) | 3 | 27 | 6 | 9 | 11 | 1 |
| D — Hospitalización (9 módulos NTEC) | [#163](https://github.com/edwinaml-su/his/pull/163) | 9 | 30 | 9 | 8 | 11 | 2 |
| **Total** | — | **19** | **101** | **26** | **30** | **41** | **4** |

**Ya remediado (3 hallazgos):**
- ✅ H3-01 P0 — `triage.setAssignedLevel` → [PR #160 merged](https://github.com/edwinaml-su/his/pull/160)
- ✅ BCMA-002 P0 — `scheduledTime = new Date()` → [PR #162 merged](https://github.com/edwinaml-su/his/pull/162)
- ✅ H1-03 P1 — `birthDate` TZ shift → [PR #161](https://github.com/edwinaml-su/his/pull/161) (pending merge)

**P0 activos: 24.** **P1 activos: 29.**

---

## 2. Top-15 P0/P1 priorizados

Criterio: **(seguridad + bloqueo Go-Live) × (1 / esfuerzo)**. Se priorizan los hallazgos cuya remediación impacta el mayor número de módulos por unidad de tiempo, comenzando por los de seguridad (RLS bypass) que son rápidos y desbloquean superficie clínica completa.

### Tier 1 — Seguridad RLS (4 hallazgos · ~1 día total)

Routers que escriben/leen sin `withTenantContext` y por tanto **bypassean RLS**. El rol Supabase `postgres.<ref>` tiene `BYPASSRLS` — el filtro `organizationId` en `where` es defensa débil que ya ha sido bypaseada en el pasado.

| # | ID | Módulo | Descripción | Esfuerzo |
|---|---|---|---|---|
| 1 | **H1-06** P0 | Paciente | `patient.search` y `patient.get` no envuelven en `withTenantContext`. Cualquier procedure tenant-scoped puede leer pacientes de otra org. | 2h |
| 2 | **H3-07** P0 | Triage NN | `triage.quickIntake` (modo NN) crea paciente fuera del callback `withTenantContext` — RLS no aplica al INSERT. | 1h |
| 3 | **HD-19** P1 | Valoración Enf. | `procedure.list` usa `ctx.prisma` directo en lugar de `withEceContext`. | 1h |
| 4 | **HD-24** P1 | Registro Enf. | `procedure.list` con `ctx.prisma` directo. | 1h |

**Remediación común:** envolver las queries en `withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {...})`. Cubierto por contrato del proyecto (`packages/trpc/src/rls-context.ts`). Agregar tests RLS en `packages/trpc/src/__tests__/rls.test.ts`.

### Tier 2 — Módulos ausentes (2 hallazgos · 4-6 días)

Documentos clínicos NTEC obligatorios sin UI ni router. Bloquea hospitalización completa.

| # | ID | Módulo | Descripción | Esfuerzo |
|---|---|---|---|---|
| 5 | **HC-001 + HC-002** P0 | Historia Clínica ECE | Ruta `/ece/historia-clinica` y router `eceHistoriaClinica` **no existen**. NTEC Art. 7 (registro obligatorio en cada atención). | 2-3d |
| 6 | **IND-001** P0 | Indicaciones Médicas | UI + router de indicaciones médicas ausentes. CPOE no operativo. | 2-3d |

**Remediación:** crear `packages/trpc/src/routers/ece/historia-clinica.router.ts` + `apps/web/src/app/(clinical)/ece/historia-clinica/[episodioId]/page.tsx`. Mapear `ece.historia_clinica` en `schema.prisma` (schema `ece`) o usar `$queryRaw` con tipado explícito siguiendo el patrón de [epicrisis.router.ts](packages/trpc/src/routers/ece/epicrisis.router.ts).

### Tier 3 — Schema drift ECE Hospitalización (7 hallazgos · 5-7 días)

Routers existentes pero hablan a columnas que la BD no expone. Cada falla produce error inmediato en producción al intentar persistir.

| # | ID | Módulo | Descripción | Esfuerzo |
|---|---|---|---|---|
| 7 | **HD-01 + HD-02** P0 | Hoja de Ingreso | 6 columnas del router (`modalidad`, `procedencia`, etc.) no existen; falta `paciente_id` (RLS roto). | 1d |
| 8 | **HD-07 + HD-08** P0/P1 | Episodio Hospitalario | Columnas `sala_id`, `gravedad`, `medico_tratante_id`, `fecha_ingreso` referenciadas en router no existen. | 1d |
| 9 | **HD-16 + HD-17** P0 | Signos Vitales | 5 columnas con nombres diferentes en router vs DB; UI nueva-toma es un **stub que no llama al router**. | 1-2d |
| 10 | **HD-22 + HD-23** P0/P1 | Registro Enfermería (MAR) | 5 columnas inexistentes; `registrarAdministracion` no invoca `computeScheduledSlot` (regresión del [PR #162](https://github.com/edwinaml-su/his/pull/162)). | 1-2d |
| 11 | **HD-25** P0 | RRI (Código azul) | 6 columnas con nombres incorrectos o inexistentes. | 1d |
| 12 | **HD-28 + HD-29** P0 | URPA | `ece.urpa_recovery` **nunca fue migrada** a la BD; UI con datos mock hardcoded. | 2d |

**Remediación común:** ejecutar `ALTER TABLE`/`CREATE TABLE` en `packages/database/sql/` numerados, sincronizar `schema.prisma` (regla CLAUDE.md), actualizar routers a usar nombres correctos, agregar tests router que verifiquen columnas reales vía mocks tipados de `PrismaClient`.

### Tier 4 — ECE Cierre + Cumplimiento NTEC (2 hallazgos · 2-3 días)

| # | ID | Módulo | Descripción | Esfuerzo |
|---|---|---|---|---|
| 13 | **A-01 + A-02 + A-03** P0 | Epicrisis | CIE-10 hard-stop referencia columna inexistente; `EpicrisisRow` referencia 8 columnas que no existen; acción "Certificar" UI nunca ejecuta mutación. | 1-2d |
| 14 | **B-01** P0 + **C-01 + C-02** P0 | Defunción + Consentimiento | Schema drift `CertDefRow`; `firmarPaciente()` siempre falla por trigger inmutabilidad; UI wizard envía a endpoint incorrecto. | 1-2d |

### Tier 5 — Pharmacy/BCMA (4 hallazgos · análisis pendiente)

Cluster con mayor incertidumbre — requiere decisión arquitectural antes de cuantificar esfuerzo.

| # | ID | Módulo | Descripción | Esfuerzo |
|---|---|---|---|---|
| 15 | **BCMA-001 + BCMA-003** P0 + **FARM-001 + FARM-002** P0 | Farmacia + BCMA | Modelo Wave 1 (`pharmacy.administer.record`, `Drug` con 6/10 campos) es código muerto: opera sobre tablas que la BD nunca tuvo. `ece.bedside_validation` sin validación GSRN/GTIN. | **3-5d con decisión arq.** |

**Decisión requerida (Edwin / @AE):** ¿Migramos Wave 1 a las tablas reales (`MedicationAdministration` + `ece.bedside_validation`) o reescribimos? La decisión define el esfuerzo (re-mapeo = 3d, reescritura = 5-7d).

---

## 3. Plan de remediación recomendado

**Hipótesis:** equipo de 2 devs full-stack disponibles. Trabajo secuencial dentro del tier, paralelizable entre tiers cuando no comparten archivos.

### Sprint S0 — Hotfix Seguridad (3-5 días) 🔴 INMEDIATO

- Tier 1 completo (Hallazgos 1-4) — RLS wrapping.
- Mergear PRs pendientes #158, #159, #161 (con audits revisados por @AE/@DBA).
- **Salida:** 0 P0 de seguridad activos. Audit reports publicados.

### Sprint S1 — Schema Drift Crítico (10-12 días) 🔴 GO-LIVE BLOCKER

- Tier 3 completo (Hallazgos 7-12) — 7 módulos de hospitalización con schema drift.
- Trabajo en paralelo por módulo (1 dev = 1 módulo a la vez).
- Aplicar SQL en `packages/database/sql/` numerados; sincronizar `schema.prisma` por PR.
- **Salida:** 13/19 módulos operables en producción.

### Sprint S2 — Módulos Ausentes + ECE Cierre (8-10 días)

- Tier 2 (Hallazgos 5-6) — Historia Clínica + Indicaciones router/UI nuevos.
- Tier 4 (Hallazgos 13-14) — Epicrisis + Defunción + Consentimiento drift.
- **Salida:** 18/19 módulos operables. Cumplimiento NTEC Art. 7, 17, 39, 40 verificable.

### Sprint S3 — Decisión Pharmacy/BCMA (3-7 días)

- Workshop @AE + @AS + @DBA + @Dev — decisión: migrar Wave 1 vs reescribir.
- Tier 5 (Hallazgo 15) según decisión.
- **Salida:** 19/19 módulos auditados + remediados. UAT clínico habilitado.

### Sprint S4+ — P1/P2 cleanup

- Quedan **30 P1 + 41 P2**. La mayoría son enum constraints faltantes, validaciones de formato, tests faltantes. Asignar a backlog técnico continuo post-Go-Live.

---

## 4. Hallazgos pendientes fuera del Top-15

Estos P0 no entran al Top-15 porque comparten cluster con un hallazgo ya incluido (mismo PR de remediación) o están en Tier 5 pendiente de decisión:

| ID | Stream | Cluster |
|---|---|---|
| HD-05, HD-06, HD-09 | D | Parte del cluster Hoja Ingreso + Episodio |
| HD-15 | D | Parte del cluster Kardex (P2 — sin RLS check en cancelAdmin) |

---

## 5. Métricas de salud post-remediación

| Métrica | Hoy | Post-S1 | Post-S2 | Post-S3 |
|---|---:|---:|---:|---:|
| P0 activos | 24 | 17 | 4 | 0 |
| Módulos operables | 6/19 | 13/19 | 18/19 | 19/19 |
| Apto Go-Live (clínico) | ❌ | ⚠️ Parcial | ✅ Sí (con riesgo BCMA) | ✅ Total |
| Cumplimiento NTEC verificable | ❌ | ⚠️ Parcial | ✅ Total | ✅ Total |

---

## 6. Apéndice — Hallazgos ya remediados

| ID | Stream | PR | Resumen |
|---|---|---|---|
| H1-03 P1 | A | [#161](https://github.com/edwinaml-su/his/pull/161) | `birthDate` TZ shift UTC-6 (form `<input type="date">` con `new Date(...)`) |
| H3-01 P0 | A | [#160 merged](https://github.com/edwinaml-su/his/pull/160) | `triage.setAssignedLevel` faltante — triages quedaban BLUE |
| BCMA-002 P0 | B | [#162 merged](https://github.com/edwinaml-su/his/pull/162) | `scheduledTime = new Date()` en eMAR — 5R Right Time siempre pasaba |

---

## 7. Próximos pasos sugeridos para @Orq

1. **Workshop priorización con Edwin (1h):** validar Sprint S0/S1/S2/S3.
2. **Asignar PRs a @Dev:** abrir 4 PRs spike para Tier 1 (RLS), 1 por módulo en Tier 3.
3. **Auditar streams restantes E-K (≈40 módulos):** quirófano, obstetricia, GS1, admin/RBAC, portal. Mantener cadencia 1 stream/día con @AS.
4. **Re-correr audit Stream A** post-remediación Tier 1 para validar cierre de H1-06 + H3-07.
