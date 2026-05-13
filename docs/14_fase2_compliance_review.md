# 14 — Compliance Review Fase 2 (Waves 6/7/8)

**Proyecto:** HIS Multipaís — Inversiones Avante
**Autor:** @AE — Arquitecto Empresarial
**Revisión:** Stream E de Fase 5 (Validación)
**Versión:** 1.0 — 2026-05-12
**Alcance:** 14 módulos skeleton entregados en PR #6, #7, #8 (commits 42f1daa, 2ea5d70, 21e1054)

---

## 1. Objetivo

Auditar que la entrega de Phase 2 (14 módulos skeleton: Outpatient §10, Inpatient §11, Emergency §12, Surgery §13, EHR Notes §14, Pharmacy §15, eMAR §16, LIS §17, Imaging §18, Inventory §19, Services & Equipment §20, Respiratory §21, Nutrition §22, Insurance §25) respeta el TDR y los principios arquitectónicos declarados en `docs/02_arquitectura_software.md`.

Criterios obligatorios revisados:

1. **4NF en los nuevos modelos Prisma.**
2. **RLS multi-tenant en todas las nuevas tablas.**
3. **Audit trail (hash chain) sin huecos en las nuevas tablas.**
4. **Ninguna decisión arquitectónica nueva sin justificación documentada.**

---

## 2. Resumen ejecutivo

| Criterio | Estado | Severidad de hallazgos |
| --- | --- | --- |
| 4NF en modelos Prisma | OK | — |
| RLS habilitado | OK | — |
| Audit trail (hash chain) | **NO** | **CRITICAL** |
| ADRs / justificación arquitectónica | Parcial | LOW |
| Validación cross-tenant en runtime | OK (cubierto por Stream A) | — |
| Aplicación SQL DDL a Supabase remoto | **NO** | HIGH |

**Veredicto:** **NO firmable como cumplido** hasta resolver el hallazgo CRITICAL.

---

## 3. Hallazgos detallados

### 3.1 CRITICAL — Audit trail incompleto en 43 tablas Phase 2

**Descripción:**
El TDR §5.5 (regla 3) y §6.3 exigen que toda mutación sobre tablas sensibles deje un registro en `audit.AuditLog` encadenado por hash. El mecanismo está implementado en `packages/database/sql/02_audit_triggers.sql` mediante la función genérica `audit.fn_audit_row()` aplicada en bucle `DO $$` a un array `audited[]` de tablas.

La lista actual incluye **34 tablas Phase 0/1** (Organization, Patient, Encounter, Triage*, etc.) pero **NO incluye ninguna de las 43 tablas Phase 2** entregadas en Waves 6/7/8:

```
OutpatientAppointment, OutpatientConsultation, Drug, Prescription,
PrescriptionItem, MedicationDispense, LabPanel, LabTest, LabOrder,
LabOrderItem, LabSpecimen, LabResult, ClinicalNote,
ClinicalNoteAttachment, EncounterDiagnosis, InpatientAdmission,
InpatientVitals, InpatientKardex, InpatientCarePlan, EmergencyVisit,
EmergencyNote, OperatingRoom, SurgeryCase, MedicationAdministration,
ImagingModality, ImagingOrder, ImagingReport, Insurer, InsurancePlan,
PatientCoverage, AuthorizationRequest, StockItem, StockLot,
StockMovement, BiomedicalEquipment, PmSchedule, CalibrationLog,
RespiratoryOrder, VentilatorSession, MedicalGasUsage, DietPlan,
NutritionAssessment, NutritionOrder
```

**Riesgo:**
- Mutaciones sobre Prescription, MedicationAdministration, ClinicalNote, SurgeryCase no quedarán en el audit log.
- Pérdida de capacidad de auditoría regulatoria (MINSAL SV, JVPM).
- Hash chain mantiene integridad pero deja huecos clínica y legalmente críticos.

**Acción requerida (bloqueante):**
Crear `packages/database/sql/22_audit_triggers_phase2.sql` que extienda el array `audited[]` con los 43 nuevos nombres y vuelva a ejecutar el bucle DO. Idempotente vía `DROP TRIGGER IF EXISTS`. Asignado a **@DBA + @Dev** (mínimo 0.5 SP).

### 3.2 HIGH — DDL Phase 2 NO aplicado a Supabase remoto

**Descripción:**
Las 19+ tablas Phase 2 viven solo en `packages/database/prisma/schema.prisma`. La instancia Supabase remota (`ejacvsgbewcerxtjtwto`) solo tiene 59 tablas Phase 0/1. Confirmado vía `mcp__supabase__list_tables`: cero tablas Phase 2 existen.

Adicionalmente, `mcp__supabase__list_migrations` retorna `[]` — Prisma migrate nunca corrió en remoto contra Supabase Migrations.

**Riesgo:**
- Cualquier `prisma generate` local desde main funciona pero el runtime app contra Supabase falla en cualquier query Phase 2.
- Stream C (apply DDL 08-21) está bloqueado: los SQL hacen `ALTER TABLE public."X"` sobre tablas inexistentes — fallan con `relation does not exist`.

**Acción requerida:**
1. Coordinar con **@DBA** ejecutar `prisma migrate deploy` (o `db push` para staging) contra Supabase remoto.
2. Después de migrar, **@DBA** aplica los SQL 08→21 + el 22 (audit triggers Phase 2 cuando exista).
3. Validar con `mcp__supabase__get_advisors` que las 43 nuevas tablas tengan RLS habilitado.

### 3.3 LOW — Sin ADRs explícitos para Phase 2

**Descripción:**
No existe carpeta `docs/adr/` ni encabezados `ADR-NN` en `docs/02_arquitectura_software.md`. Las decisiones de Phase 2 (e.g. denormalización de `organizationId` + `establishmentId` en cada modelo, uso de OR-tenancy con AND-compose para evitar overwrite por search, regla 4-eyes en `lis.result.validate`, time-out obligatorio en `surgery.case.start`) viven implícitas en los routers y en comentarios de skeleton.

**Riesgo:**
- Pérdida de trazabilidad de por qué se eligió cada patrón.
- Difícil onboarding de nuevos miembros.

**Acción recomendada (no bloqueante):**
- Crear `docs/adr/` con plantilla ADR-MADR (Markdown Architectural Decision Records).
- Documentar mínimo 5 ADRs Phase 2:
  - ADR-Phase2-01: AND-compose en filtros de catálogo global + tenant-private.
  - ADR-Phase2-02: 4-eyes obligatorio en LIS result.validate (TDR §17.5).
  - ADR-Phase2-03: Time-out previo a start en SurgeryCase (TDR §13.4 — checklist OMS).
  - ADR-Phase2-04: Inmutabilidad post-firma en ClinicalNote (TDR §14.3).
  - ADR-Phase2-05: Catálogo global (organizationId NULL) en Drug/Insurer/StockItem/LabPanel.

### 3.4 INFO — 4NF revisado y cumplido

**Verificado:**

| Modelo | Llaves candidatas / Dependencias funcionales | Veredicto 4NF |
| --- | --- | --- |
| `OutpatientAppointment` | PK=id; FK organizationId+establishmentId+patientId+providerId | OK — sin dependencias multivaluadas |
| `OutpatientConsultation` | PK=id; encounterId UNIQUE | OK |
| `InpatientAdmission` | PK=id; encounterId UNIQUE | OK |
| `Prescription / PrescriptionItem` | 1:N adecuado | OK |
| `LabOrder / LabOrderItem / LabResult` | 1:N:N adecuado | OK |
| `Insurer / InsurancePlan / PatientCoverage` | jerarquía 3 niveles, sin redundancia | OK |
| `StockItem / StockLot / StockMovement` | atómicos | OK |

La denormalización de `organizationId` y `establishmentId` en cada tabla **es intencional** (multi-tenant performance) y está respaldada por RLS — no viola 4NF porque no introduce dependencias multivaluadas.

### 3.5 INFO — Validación cross-tenant verificada (Stream A)

PR #9 abrió cobertura de tests `cross-tenant.integration.test.ts` con 15 tests que cubren los 14 módulos. Verificado: cada router siempre filtra por `ctx.tenant.organizationId` y nunca devuelve datos cross-tenant. **Cumple TDR §5 y §6.**

---

## 4. Matriz de severidad

| ID | Severidad | Módulo afectado | Estado | Responsable | Bloquea Fase 5 |
| --- | --- | --- | --- | --- | --- |
| AE-PHASE2-01 | CRITICAL | Los 14 (audit trail) | Abierto | @DBA + @Dev | **SÍ** |
| AE-PHASE2-02 | HIGH | Infra (Supabase migrations) | Abierto | @DBA + @SRE | NO (solo afecta runtime, no las pruebas unit/integration) |
| AE-PHASE2-03 | LOW | Documentación (ADRs) | Abierto | @AS | NO |

---

## 5. Recomendación a @Orq

**NO firmar Fase 5 como cumplida** hasta cerrar AE-PHASE2-01.

Plan mínimo de remediación:

1. **@Dev + @DBA** crean `22_audit_triggers_phase2.sql` extendiendo `audited[]` con los 43 nombres. Cambio < 30 líneas. Idempotente.
2. **@DBA** ejecuta `prisma migrate deploy` contra Supabase remoto (resuelve AE-PHASE2-02).
3. **@DBA** aplica via `mcp__supabase__apply_migration` los SQL 08→22 en orden.
4. **@DBA** valida con `mcp__supabase__get_advisors` que no haya `rls_disabled_in_public` para las 43 nuevas tablas.
5. **@AE** firma este reporte con estatus "Cumplido".

Estimación: **2 SP** (medio sprint), bloqueante para avance a Fase 6.

---

## 6. Firmas

- [ ] **@AE** — Arquitecto Empresarial — Cumplimiento estratégico y normativo
- [ ] **@AS** — Arquitecto de Software — ADRs Phase 2 (LOW, opcional)
- [ ] **@DBA** — Data Architect — Migración + RLS + audit triggers
- [ ] **@SRE** — Aplicación de migraciones a Supabase remoto

**Versión:** 1.0 — 2026-05-12
**Próxima revisión:** tras remediación AE-PHASE2-01.
