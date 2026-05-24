# 33c — Matriz de Trazabilidad JCI

> **Estado**: planning — se completará con test cases reales durante Fase 4.
> **Trazabilidad**: JCI Standard → Measurable Element (ME) → Épica → US → Test case → Estado.
> **Fuente**: JCI Hospital Accreditation Standards 7th Edition (2021).

---

## Cómo leer esta matriz

| Columna | Significado |
|---|---|
| **JCI Standard** | Código del estándar (ej. `IPSG.1`, `PCI.5`, `MOI.13`) |
| **ME** | Measurable Element específico dentro del standard (ej. `IPSG.1 ME 1`) |
| **Capítulo** | Capítulo JCI (IPSG / PFR / AOP / COP / ASC / MMU / PFE / QPS / PCI / GLD / FMS / SQE / MOI / MPE / HRP) |
| **Cobertura HIS** | Estado: ✅ Cubierto | ⚠️ Parcial | ❌ Brecha | 🆕 Nuevo en Fase JCI |
| **Épica/US** | Referencia al backlog (`docs/33b_jci_backlog.md`) |
| **Test case** | ID del test que valida el ME (compliance/unit/integ/e2e) |
| **Estado** | TODO / In Progress / Done |

---

## IPSG — International Patient Safety Goals

| JCI Standard | ME | Capítulo | Cobertura HIS | Épica/US | Test case | Estado |
|---|---|---|---|---|---|---|
| IPSG.1 | ME 1: 2 identificadores únicos | IPSG | ✅ | E-05 / US.JCI.5.1 | `compliance/ipsg1-patient-id.test.ts` | TODO |
| IPSG.1 | ME 2: Validación pre-medicamento | IPSG | ✅ BCMA 5R | E-05 / US.JCI.5.2 | `compliance/mmu6-bcma.test.ts` | TODO |
| IPSG.1 | ME 3: Validación pre-procedimiento | IPSG | ✅ WHO Sign-In | E-05 / US.JCI.5.3 | `compliance/ipsg4-who-checklist.test.ts` | TODO |
| IPSG.1 | ME 4: Validación pre-transfusión | IPSG | ✅ Crossmatch | E-05 / US.JCI.5.4 | `compliance/blood-bank.test.ts` | TODO |
| IPSG.2 | ME 1: Read-back órdenes verbales | IPSG | ❌ | E-05 / US.JCI.5.5 | `compliance/ipsg2-readback.test.ts` | TODO |
| IPSG.2 | ME 2: Read-back resultados críticos | IPSG | ⚠️ Auto-flag sin RB | E-18 / US.JCI.18.1 | `compliance/ipsg2-critical-results.test.ts` | TODO |
| IPSG.2 | ME 3: Abreviaciones prohibidas | IPSG | ❌ | E-05 / US.JCI.5.6 | `compliance/ipsg2-abbreviations.test.ts` | TODO |
| IPSG.2 | ME 4: Handoff SBAR | IPSG | ⚠️ REG_ENF turno | E-08 / US.JCI.8.3 | `e2e/ipsg2-sbar-handoff.spec.ts` | TODO |
| IPSG.3 | ME 1: Lista high-alert codificada | IPSG | ❌ | E-05 / US.JCI.5.7 | `compliance/ipsg3-high-alert.test.ts` | TODO |
| IPSG.3 | ME 2: LASA alerts | IPSG | ❌ | E-05 / US.JCI.5.8 | `e2e/ipsg3-lasa.spec.ts` | TODO |
| IPSG.3 | ME 3: Electrolitos concentrados | IPSG | ❌ | E-05 / US.JCI.5.9 | `compliance/ipsg3-electrolytes.test.ts` | TODO |
| IPSG.3 | ME 4: Double-check insulina/heparina/opioides | IPSG | ❌ | E-05 / US.JCI.5.10 | `e2e/ipsg3-double-check.spec.ts` | TODO |
| IPSG.3 | ME 5: Dosis máximas pediátricas | IPSG | ❌ | E-05 / US.JCI.5.11 | `compliance/ipsg3-pediatric-max.test.ts` | TODO |
| IPSG.4 | ME 1: Marcado sitio quirúrgico | IPSG | ✅ WHO Sign-In | E-16 / US.JCI.16.1 | `compliance/ipsg4-site-marking.test.ts` | TODO |
| IPSG.4 | ME 2: Pre-procedure verification | IPSG | ✅ PREOP_CHECK | E-16 / US.JCI.16.2 | `compliance/ipsg4-preop.test.ts` | TODO |
| IPSG.4 | ME 3: Time-out pre-incisión | IPSG | ✅ WHO Time-Out | E-16 / US.JCI.16.3 | `compliance/ipsg4-time-out.test.ts` | TODO |
| IPSG.4 | ME 4: Sign-out + conteo | IPSG | ✅ WHO Sign-Out | E-16 / US.JCI.16.4 | `compliance/ipsg4-sign-out.test.ts` | TODO |
| IPSG.4 | ME 5: Consentimiento quirúrgico | IPSG | ✅ CONS_QX | E-16 / US.JCI.16.5 | `compliance/cons-qx.test.ts` | TODO |
| **IPSG.5** | ME 1: Hand hygiene OMS 5 momentos | IPSG | ❌ | **E-10** / US.JCI.10.1 | `e2e/ipsg5-hand-hygiene.spec.ts` | **TODO** |
| **IPSG.5** | ME 2: Surveillance IAAS | IPSG | ❌ | **E-01** / US.JCI.1.1 | `compliance/pci-bundle.test.ts` | **TODO** |
| **IPSG.5** | ME 3: Bundles CVC/Vent/UTI | IPSG | ❌ | **E-01** / US.JCI.1.2 | `compliance/pci-bundles.test.ts` | **TODO** |
| **IPSG.5** | ME 4: Aislamiento | IPSG | ⚠️ Solo flag | **E-01** / US.JCI.1.3 | `e2e/pci-isolation.spec.ts` | **TODO** |
| **IPSG.5** | ME 5: Alertas MDR | IPSG | ❌ | **E-14** / US.JCI.14.1 | `compliance/pci-mdr-alert.test.ts` | **TODO** |
| IPSG.6 | ME 1: Tamizaje Morse al ingreso | IPSG | ✅ VAL_INI_ENF | E-05 / US.JCI.5.12 | `compliance/ipsg6-falls.test.ts` | TODO |
| IPSG.6 | ME 2: Re-evaluación periódica | IPSG | ⚠️ Sin SLA | E-11 / US.JCI.11.1 | `e2e/ipsg6-reassessment.spec.ts` | TODO |
| IPSG.6 | ME 3: Intervenciones por nivel | IPSG | ⚠️ Sin protocolo | E-05 / US.JCI.5.13 | `e2e/ipsg6-interventions.spec.ts` | TODO |
| IPSG.6 | ME 4: Reporte estructurado de caídas | IPSG | ⚠️ Solo texto libre | E-09 / US.JCI.9.1 | `compliance/ipsg6-fall-report.test.ts` | TODO |

**Total IPSG**: 27 ME — 7 ✅ cubiertos, 6 ⚠️ parciales, 14 ❌ brechas — TODOS van a Fase JCI-1.

---

## PCI — Prevention and Control of Infections

| JCI Standard | ME | Cobertura | Épica/US | Test case |
|---|---|---|---|---|
| PCI.1 | Programa formal IC | ❌ | E-01 / US.JCI.1.4 | UAT clinical |
| PCI.2 | IC Coordinator nombrado | ❌ | E-01 / US.JCI.1.5 | UAT clinical |
| PCI.3 | Risk assessment anual | ❌ | E-01 / US.JCI.1.6 | UAT clinical |
| PCI.4 | Reducción riesgos asistenciales | ⚠️ | E-01 / US.JCI.1.7 | `compliance/pci-risk-reduction.test.ts` |
| PCI.5 | Surveillance IAAS | ❌ | E-01 / US.JCI.1.1, 1.8 | `compliance/pci-surveillance.test.ts` |
| PCI.6 | Vigilancia epidemiológica reporte | ❌ | E-14 / US.JCI.14.1, 14.2 | `compliance/pci-epi-reporting.test.ts` |
| PCI.7 | Procedimientos invasivos | ⚠️ | E-01 / US.JCI.1.9 | `e2e/pci-invasive-procedures.spec.ts` |
| PCI.8 | Aislamiento + cohortización | ⚠️ | E-01 / US.JCI.1.3 | `e2e/pci-isolation-cohort.spec.ts` |
| **PCI.9** | Hand hygiene compliance | ❌ | **E-10** / US.JCI.10.1-3 | `e2e/pci-hand-hygiene.spec.ts` |
| PCI.10 | Limpieza ambiental | ❌ | E-01 / US.JCI.1.10 | Manual proceso |
| PCI.11 | Esterilización + reuso instrumental | ❌ | E-01 / US.JCI.1.11 | Manual proceso |

**Total PCI**: 11 standards — 0 ✅, 3 ⚠️, 8 ❌ — brecha crítica cubierta en E-01 + E-10 + E-14.

---

## PFE — Patient and Family Education

| JCI Standard | ME | Cobertura | Épica/US | Test case |
|---|---|---|---|---|
| PFE.1 | Education needs assessment | ❌ | E-02 / US.JCI.2.1 | `compliance/pfe-needs-assess.test.ts` |
| PFE.2 | Education provided + documented | ❌ | E-02 / US.JCI.2.2 | `e2e/pfe-session.spec.ts` |
| PFE.3 | Teach-back verification | ❌ | E-02 / US.JCI.2.3 | `compliance/pfe-teachback.test.ts` |
| PFE.4 | Discharge education | ⚠️ Solo EPI_EGR | E-02 / US.JCI.2.4 | `compliance/pfe-discharge.test.ts` |

**Total PFE**: 4 standards — 0 ✅, 1 ⚠️, 3 ❌ — brecha crítica cubierta en E-02.

---

## QPS — Quality and Patient Safety

| JCI Standard | ME | Cobertura | Épica/US | Test case |
|---|---|---|---|---|
| QPS.1 | QI program structure | ⚠️ | E-03 / US.JCI.3.1 | UAT directorial |
| QPS.2 | Data collection indicators | ⚠️ | E-03 / US.JCI.3.2 | `e2e/qps-indicators.spec.ts` |
| QPS.3 | Statistical analysis | ❌ | E-03 / US.JCI.3.3 | `e2e/qps-dashboard.spec.ts` |
| QPS.4 | Improvement implementation | ❌ | E-03 / US.JCI.3.4 | UAT directorial |
| QPS.5 | Sentinel events + RCA | ⚠️ | E-09 / US.JCI.9.2 | `compliance/qps-sentinel.test.ts` |
| QPS.6 | Adverse events / near misses | ⚠️ | E-09 / US.JCI.9.3 | `e2e/qps-adverse-events.spec.ts` |
| QPS.7 | Patient safety culture | ❌ | E-03 / US.JCI.3.5 | Survey externa |
| QPS.8 | Risk management | ⚠️ | E-09 / US.JCI.9.4 | `compliance/qps-risk.test.ts` |
| QPS.11 | Event reporting + analysis | ⚠️ | E-09 / US.JCI.9.5 | `compliance/qps-reporting.test.ts` |

**Total QPS**: 9 standards (subset) — 0 ✅, 6 ⚠️, 3 ❌ — cubierto en E-03 + E-09.

---

## SQE — Staff Qualifications and Education

| JCI Standard | ME | Cobertura | Épica/US | Test case |
|---|---|---|---|---|
| SQE.1 | Job descriptions | ❌ | E-04 / US.JCI.4.1 | UAT HR |
| SQE.2 | Verification credentials | ❌ | E-04 / US.JCI.4.2 | `compliance/sqe-verify.test.ts` |
| SQE.3 | Education and training records | ❌ | E-13 / US.JCI.13.1 | `e2e/sqe-training.spec.ts` |
| SQE.8 | Continuing education | ❌ | E-13 / US.JCI.13.2 | `e2e/sqe-ce.spec.ts` |
| SQE.9 | Credentialing process | ❌ | E-04 / US.JCI.4.3 | `compliance/sqe-credential.test.ts` |
| SQE.10 | Privileging clínico | ❌ | E-04 / US.JCI.4.4 | `compliance/sqe-privilege.test.ts` |
| SQE.11 | OPPE | ❌ | E-04 / US.JCI.4.5 | `compliance/sqe-oppe.test.ts` |
| SQE.12 | Re-credentialing periódico | ❌ | E-04 / US.JCI.4.6 | `e2e/sqe-renewal.spec.ts` |

**Total SQE**: 8 standards (subset relevante) — 0 ✅, 0 ⚠️, 8 ❌ — cubierto en E-04 + E-13.

---

## MOI — Management of Information (referencia, ya 95% cubierto)

| JCI Standard | Cobertura | Evidencia HIS |
|---|---|---|
| MOI.1 | ✅ | Schema 4NF |
| MOI.2 | ✅ | RLS + bitácora |
| MOI.3 | ✅ | Audit hash SHA-256 + triggers inmutabilidad |
| MOI.4 | ✅ | 10 años retención TDR §6.3 |
| MOI.5 | ⚠️ | Supabase managed; sin DR documentado formal |
| MOI.6 | ✅ | 30 tipos NTEC sembrados |
| MOI.7 | ✅ | Wizard proximosDocumentos + enforcement Fase 4 |
| MOI.8 | ⚠️ | CERT_DIR sí; programa de auditoría faltante |
| MOI.9 | ✅ | CIE-10 + LOINC parcial + CIE-9/10 PCS |
| MOI.10 | ✅ | `docs/04_modelo_datos.md` |
| MOI.11 | ✅ | DIR overrides workflow Fase 6 |
| MOI.12 | ✅ | RECT rectificación trazable |
| MOI.13 | ✅ | PIN argon2id + bitácora firma |
| MOI.14 | ✅ | audit.audit_log + bitacora_acceso |
| MOI.15 | ⚠️ | Sin programa de auditoría de calidad de expediente formal |

**Trabajo Fase JCI en MOI**: solo cerrar MOI.5 (DR plan), MOI.8 + MOI.15 (auditoría calidad expediente).

---

## Resumen ejecutivo de la matriz

| Capítulo | Total ME | ✅ Cubierto | ⚠️ Parcial | ❌ Brecha | Brecha → Épicas |
|---|---|---|---|---|---|
| IPSG | 27 | 7 | 6 | 14 | E-05, E-10, E-16, E-01, E-14, E-09, E-11, E-18 |
| PCI | 11 | 0 | 3 | 8 | E-01, E-10, E-14 |
| PFE | 4 | 0 | 1 | 3 | E-02 |
| QPS | 9 | 0 | 6 | 3 | E-03, E-09 |
| SQE | 8 | 0 | 0 | 8 | E-04, E-13 |
| MOI | 15 | 12 | 3 | 0 | (mantenimiento) |
| ACC | 6 | 5 | 1 | 0 | E-08 (continuidad) |
| PFR | 6 | 4 | 0 | 2 | E-06 |
| AOP | 7 | 6 | 1 | 0 | E-11 |
| COP | 8 | 5 | 2 | 1 | E-08, E-11, E-17 |
| ASC | 7 | 7 | 0 | 0 | (ya cubierto) |
| MMU | 7 | 6 | 1 | 0 | E-07 |
| GLD | 18 | 11 | 4 | 3 | E-15 (mayoría fuera scope software) |
| FMS | 11 | N/A | N/A | N/A | E-12, E-19 (parcial) |

**Cobertura total estimada**:
- Pre-JCI: ~70-75% (overlap natural con NTEC)
- Post-JCI-1: ~85%
- Post-JCI-2: ~92%
- Post-JCI-3: ~95% (target acreditación)

---

## Actualización de la matriz

Esta matriz se actualiza:
- Al cierre de cada US (estado `Done` + link al test case real)
- Quincenalmente en Steering Committee
- Al cierre de cada Mock Survey con hallazgos del consultor

Mantenedor: @QA + @PO conjuntamente.
