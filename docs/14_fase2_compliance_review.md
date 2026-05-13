# 14 — Compliance Review Fase 2 (Waves 6/7/8)

**Proyecto:** HIS Multipaís — Inversiones Avante
**Autor:** @AE — Arquitecto Empresarial
**Revisión:** Stream E de Fase 5 (Validación) — actualización Fase 6 Stream B
**Versión:** 1.1 — 2026-05-13 (cierre Fase 5 + addendum Fase 6)
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

**Veredicto inicial (v1.0, 2026-05-12):** **NO firmable como cumplido** hasta resolver el hallazgo CRITICAL.

**Veredicto actualizado (v1.1, 2026-05-13):** **FIRMABLE** — AE-PHASE2-01 CLOSED en PR #12 (`packages/database/sql/22_audit_triggers_phase2.sql`); AE-PHASE2-02 CLOSED por aplicación de migraciones a Supabase remoto + SQL 22 + SQL 23 (RLS gaps catálogos); AE-PHASE2-03 CLOSED en Fase 6 Stream B con ADR-0001 a ADR-0005 en `docs/adr/`.

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

| ID | Severidad | Módulo afectado | Estado | Responsable | Bloquea Fase 5 | Evidencia de cierre |
| --- | --- | --- | --- | --- | --- | --- |
| AE-PHASE2-01 | CRITICAL | Los 14 (audit trail) | **CLOSED** | @DBA + @Dev | **SÍ** | PR #12 — `packages/database/sql/22_audit_triggers_phase2.sql` aplicado a Supabase remoto. 48 tablas Phase 2 con trigger `audit.fn_audit_row`. |
| AE-PHASE2-02 | HIGH | Infra (Supabase migrations) | **CLOSED** | @DBA + @SRE | NO | Schema Phase 2 (96 tablas) en Supabase prod. SQL 08→23 aplicados. `list_tables` retorna 96 entradas; `get_advisors` security retorna 0 CRITICAL, ≤19 WARN no bloqueantes. |
| AE-PHASE2-03 | LOW | Documentación (ADRs) | **CLOSED** | @AS | NO | Fase 6 Stream B — `docs/adr/0001-and-compose-tenant-search.md` a `docs/adr/0005-global-vs-tenant-catalogs.md`. |

---

## 5. Recomendación a @Orq

**ACTUALIZADO 2026-05-13:** los 3 hallazgos están CLOSED. Fase 5 firmable y Fase 6 desbloqueada.

Cierre histórico del plan de remediación:

1. **@Dev + @DBA** crearon `22_audit_triggers_phase2.sql` extendiendo `audited[]` con los 48 nombres Phase 2 (aplicado vía PR #12).
2. **@DBA** ejecutó `prisma migrate deploy` contra Supabase remoto + aplicación SQL 08→23 idempotente.
3. **@DBA** validó con `mcp__supabase__get_advisors` — 0 CRITICAL findings post-aplicación.
4. **@AS** documentó los 5 ADRs Phase 2 en Fase 6 Stream B (ADR-0001 a ADR-0005).

## 6. Cobertura normativa final post-Fase 2 (TDR §27.1)

Re-evaluación de la matriz de §3 de `docs/01_arquitectura_empresarial.md` tras entrega de Wave 6/7/8:

| # | Norma                                          | Cobertura previa MVP | Cobertura post Phase 2 | Δ |
|---|-------------------------------------------------|----------------------|------------------------|---|
| 1 | Ley Protección Datos Personales SV              | Marco estructural    | Reforzado (RLS catálogos, audit trail Phase 2) | +RLS 23 |
| 2 | HIPAA-equivalente                               | Audit Phase 0/1      | **Audit completo Phase 2** (48 tablas)        | +Audit Phase 2 |
| 3 | Ley Firma Electrónica                           | Firma básica         | **Inmutabilidad post-firma ClinicalNote**     | ADR-0004 |
| 4 | Código de Salud + Reglamento                    | Marco                | Estructuras EHR + Surgery + LIS               | Phase 2 |
| 5 | Ley SNIS                                        | Catálogos MINSAL     | Catálogos labs (LabPanel) habilitados         | ADR-0005 |
| 7 | Normativa MINSAL — habilitación                 | Estructura           | Modelo establecimiento + servicios            | Wave 8 |
| 11 | Ley Medicamentos (DNM)                         | Pendiente F4         | **Habilitado** (Drug catalog + Prescription)  | Phase 2 |
| 12 | Ley Drogas — psicotrópicos                     | Pendiente F4         | **Modelo base** (MedicationDispense, eMAR §16)| Phase 2 |
| 17 | ISO 15189 (laboratorios)                       | n/a (no aplicable MVP) | **4-eyes en LIS validate**                    | ADR-0002 |
| 18 | OMS Surgical Safety Checklist / JCI IPSG.4     | n/a                  | **Time-out obligatorio SurgeryCase**          | ADR-0003 |
| 20 | ISO 27001 / SOC 2                              | Transversal F1+      | RLS 100% (96 tablas), audit hash chain        | SQL 22+23 |

**Conclusión:** las 14 entregas Phase 2 amplían cobertura normativa de MVP estructural a soporte real de las normas DNM, Firma Electrónica, ISO 15189 y OMS. La cobertura DTE (§3 #14-15) sigue diferida a Fase 5 (financiera) según el push-back original.

## 7. Firmas

- [x] **@AE** — Arquitecto Empresarial — Cumplimiento estratégico y normativo — firmado 2026-05-13 (v1.1)
- [x] **@AS** — Arquitecto de Software — ADR-0001 a ADR-0005 documentados — Fase 6 Stream B
- [x] **@DBA** — Data Architect — Migración + RLS + audit triggers — PR #11, #12, #14
- [x] **@SRE** — Aplicación de migraciones a Supabase remoto — PR #12 + advisors CLEAN

**Versión:** 1.1 — 2026-05-13
**Cierre:** Fase 5 firmada. Fase 6 desbloqueada. Próxima revisión: post-go-live, T+30d (hipercuidado).
