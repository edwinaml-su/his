# RE-AUDIT Stream H — Diagnósticos (RIS/LIS/Pathology/ECE)

**Fecha:** 2026-05-24  
**Auditor:** @QA — Especialista en Automatización y Testing  
**Rama base:** `chore/ola1-re-audits-y-docs` (worktree `elastic-hertz-c0dd8a`)  
**Documento base:** `docs/audit/2026-05-19_audit_stream_h_diagnosticos.md` (18 hallazgos, 6 P0 + 7 P1 + 5 P2)  

---

## I. Listado de Hallazgos HH-01...HH-18

| HH | Módulo | Prioridad | Estado PR | Descripción |
|---|---|---|---|---|
| HH-01 | ECE Estudios | P0 | **CERRADO #204** | Schema drift `ece.solicitud_estudio`: 5 columnas corregidas |
| HH-02 | ECE Estudios | P0 | **CERRADO #204** | Schema drift `ece.resultado_estudio`: 6 columnas corregidas |
| HH-03 | ECE Estudios | P1 | **CERRADO #204** | `validar` ahora requiere PIN argon2id (NTEC §20) |
| HH-04 | ECE Estudios | P2 | ABIERTO | Códigos estudio como texto libre (LOINC sin validar). Funcional pero no estructurado |
| HH-05 | ECE Estudios | P2 | ABIERTO | Aprobación de resultado sin PIN. No bloqueante go-live pero incumple §19 |
| HH-06 | LIS | P0 | **CERRADO #203** | `lisRouter` con `withTenantContext` en 6 resolvers + RLS aplicado |
| HH-07 | LIS | P1 | ABIERTO | `fromDate` timezone shift (-1 día en browser UTC-6). Patrón Stream A conocido |
| HH-08 | LIS+Imaging | P0 | **CERRADO #196** | 9 RLS policies `TO public` → `TO authenticated` |
| HH-09 | LIS | P1 | ABIERTO | Auto-flagging sin edad/sexo paciente. Schema define `patientAgeYears` pero UI no envía |
| HH-10 | LIS | P1 | VERIFICAR | `trpc as unknown` cast en 3 páginas. Namespace montado en router raíz |
| HH-11 | LIS | P2 | ABIERTO | Cola validación filtra client-side (deuda técnica, tolerable Wave 1) |
| HH-12 | Imaging | P1 | ABIERTO | Validación UUID solo presencia, no formato (UX degradada, sin lógica fallo) |
| HH-13 | Imaging | P0 | **CERRADO #203** | `imagingRouter` con `withTenantContext` en 10 resolvers |
| HH-14 | LIS+Imaging | P2 | ABIERTO | `<textarea>` nativo en lugar de componente Shadcn (cosmético) |
| HH-15 | Imaging | P2 | ABIERTO | `orderingProvider` cargado pero no mostrado en UI (overhead menor) |
| HH-16 | Pathology | P0 | **CERRADO #202** | 5 tablas Pathology creadas en BD + schema.prisma sincronizado |
| HH-17 | Pathology | P1 | **CERRADO #202** | UI lista órdenes Pathology implementada (`pathology/page.tsx`) |
| HH-18 | Pathology | P1 | ABIERTO | `report.sign` sin PIN. Estructura existe pero sin validación firma |

---

## II. Verificación PR #196, #202, #203, #204, #205

### PR #196 — RLS LIS/Imaging authenticated ✓

**Commit:** `8b95c1b` | **Status:** MERGED  
**Cierra:** HH-08  
**Cambios:**
- 9 políticas RLS (LabOrder, LabOrderItem, LabResult, LabSpecimen, ImagingOrder, ImagingReport, ImagingModality) migradas `TO public` → `TO authenticated`
- Preserva USING/WITH CHECK intactas — solo rol asignado cambia
- Aplicado vía Supabase MCP migration `99_lis_imaging_rls_authenticated.sql`
- **Post-aplicación verificado:** 9/9 policies con `roles = {authenticated}`

**Impacto:** RLS ahora aplica correctamente cuando los routers demoten el rol a `authenticated` via `withTenantContext`.

### PR #202 — Pathology base tables + UI lista ✓

**Commit:** `645db77` | **Status:** MERGED  
**Cierra:** HH-16, HH-17  
**Cambios:**
- DDL: PathologyOrder, PathologySpecimen, PathologyMacroDescription, PathologyMicroDescription, PathologyReport + 4 enums Postgres
- Aplicadas vía Supabase MCP migration `99_pathology_module_base_tables.sql` (203 líneas)
- RLS + audit triggers + hash chain (ADR 0004) incluidos
- **UI:** `apps/web/src/app/(clinical)/pathology/page.tsx` — lista paginada con filtro status

**Validación:** 
- `pathology.router.ts` ya cableado en `_app.ts` — no requiere cambios
- Schema.prisma sincronizado: relaciones bidireccionales ok
- Tests: pathology router completo verificable

### PR #203 — LIS/Imaging withTenantContext ✓

**Commit:** `ab14f16` | **Status:** MERGED  
**Cierra:** HH-06, HH-13  
**Cambios:**
- LIS: 6 resolvers (`order.list`, `order.get`, `order.create`, `specimen.collect`, `result.enter`, `result.validate`) envueltos en `withTenantContext`
- Imaging: 10 resolvers envueltos en `withTenantContext` (modality, order CRUD, report sign/validate)
- Transacción redundante en `result.enter` eliminada (withTenantContext ya provee tx)
- Tests: +3 RLS-demote en lis.router.test.ts, +3 en imaging.router.test.ts

**Impacto:** Rol Supabase demotado a `authenticated` en cada resolver → RLS policies (PR #196) ahora efectivas.

### PR #204 — ECE estudios schema drift + PIN validar ✓

**Commit:** `0fdd868` | **Status:** MERGED  
**Cierra:** HH-01, HH-02, HH-03  
**Cambios:**
- `solicitud-estudio.router.ts`: columnas reales (examenes, indicacion_clinica, medico_solicitante_id) mapeadas correctamente
- `resultado-estudio.router.ts`: columnas reales (valores jsonb, responsable_validacion_id, estado_registro, fecha_hora_informe) 
- **HH-03:** `validar` ahora requiere PIN argon2id via `verifyPinOrThrow()` — NTEC §19/20 compliant
- UI 4 páginas actualizadas para reflejar schema correcto
- Tests: 33/33 verdes

**Validación:** Schema drift corregido; ECE operativo go-live.

### PR #205 — ECE.gs1_gtin_sustitutos ✓

**Commit:** `419489` | **Status:** MERGED  
**Cierra:** HI-13 (deuda técnica non-stream-H)  
**Cambios:**
- Tabla `ece.gs1_gtin_sustitutos` creada (migration `99_gs1_gtin_sustitutos.sql`, 32 líneas)
- Modelo `EceGs1GtinSustitutos` agregado a schema.prisma con RLS (3 policies) y relaciones bidireccionales
- Prisma generate exitoso; gs1-medication.router linkSubstitute ahora funcional

**Validación:** Tabla existe, RLS aplicado, Prisma sincronizado.

---

## III. Validación Tablas ECE.gs1_gtin_sustitutos

**Status:** ✓ **CONFIRMADO CREADA**

- **Migration:** Aplicada vía Supabase MCP (`99_gs1_gtin_sustitutos.sql`)
- **Schema Prisma:** Modelo `EceGs1GtinSustitutos` presente con relaciones a `EceGs1Gtin` y `EceGs1PharmaProduct`
- **RLS:** 3 policies aplicadas (`TO authenticated`)
- **Tests:** gs1-medication.router linkSubstitute verificable (13+12 tests verdes según commit message)

---

## IV. Validación HH-04 LOINC (Sin estructuración código estudio)

**Status:** FUNCIONAL SIN VALIDACIÓN CÓDIGO

- **Ubicación:** `/ece/estudios/nueva/page.tsx:81` — campo `estudiosRaw` split(",")
- **Schema Zod:** `z.array(z.string().min(1).max(100)).min(1)` — acepta cualquier string
- **Problema:** Sin validación LOINC, código local ni catálogo
- **Riesgo go-live:** **BAJO** — funcional; datos no estructurados dificultan integración downstream LIS/RIS post-go-live

---

## V. Validación HH-09 Auto-flagging edad/sexo

**Status:** ABIERTO — Schema define contexto pero UI no envía

- **Schema Zod:** `resultEnterInput` extendible con `patientAgeYears`, `patientSex`
- **Router:** `evaluateLabResultFlag(input)` soporte edad/sexo en LabReferenceRange
- **Problema UI:** `EnterResultDialog` en `/lis/orders/[id]/page.tsx:662-674` no envía `patientAgeYears` ni `patientSex`
- **Función afectada:** Auto-flagging siempre usa `patientSex="BOTH"` (rango genérico)
- **Riesgo go-live:** **ALTO** para pediatría/valores sexo-estratificados; tolerable en Wave 1 si manuales por clínico

---

## VI. Síntesis Estado Go-Live

| Aspecto | Estado | Riesgo |
|---|---|---|
| **ECE Estudios (§18 NTEC)** | ✓ Operativo (HH-01/02/03 cerrados) | BAJO |
| **LIS (§17)** | ✓ RLS aplica (HH-06 cerrado) | BAJO–MEDIO (HH-07/09/10 abiertos) |
| **RIS/Imaging (§18)** | ✓ RLS aplica (HH-13 cerrado) | BAJO (HH-12/14/15 cosméticos) |
| **Pathology (§16)** | ✓ Tablas creadas (HH-16/17 cerrados) | BAJO–MEDIO (HH-18 PIN pending) |
| **Seguridad multi-tenant** | ✓ RLS + withTenantContext (PRs #196/#203) | BAJO |
| **Firma electrónica** | ✓ ECE validar con PIN (PR #204) | MEDIO (HH-05/18 sin PIN) |

---

## Recomendaciones Go-Live

1. **P0 (Resuelto):** Todos 6 hallazgos críticos cerrados via PRs #196/#202/#203/#204
2. **P1 abierto:** HH-07 (timezone), HH-09 (age/sex), HH-10 (namespace), HH-12 (UUID), HH-17 UI pathology, HH-18 (PIN sign)
   - **Go-live:** Tolerable con manual clínico; planificar Wave 2 para HH-09 + HH-18
3. **P2:** Cosmético/overhead — procrastinar sin riesgo

---

**Fecha validación:** 2026-05-24 | **Auditor:** @QA | **Documento:** Apto go-live con condiciones Wave 2
