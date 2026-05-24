# 33d — Matriz de Trazabilidad Consolidada del Proyecto

> **Alcance**: matriz integrada **TDR → NTEC → JCI → US → Tests** para el proyecto completo HIS Multipaís Avante.
> **Mantenedor**: @QA + @PO.
> **Actualización**: al cierre de cada sprint + al cierre de cada release.

---

## 1. Introducción

Esta matriz consolida la trazabilidad de TODO el proyecto en cuatro capas:

| Capa | Origen | Mantenida en |
|---|---|---|
| **TDR** | Términos de Referencia HIS Multipaís | `TDR_HIS_Multipais.md` (1923 líneas, 30 módulos) |
| **NTEC SV** | Acuerdo MINSAL 1616/2024 | `docs/31_flujos_operativos_consolidado.md` + `docs/flujos/` |
| **JCI** | Joint Commission International 7th Edition (2021) | `docs/32_gap_jci_assessment.md` + `docs/33c_matriz_trazabilidad_jci.md` |
| **Implementación** | User stories + test cases del backlog | `docs/05_backlog.md` + `docs/backlog/` + `docs/26_trazabilidad_matrix.md` |

---

## 2. Cobertura por módulo (resumen ejecutivo)

| Módulo HIS | TDR | NTEC | JCI | Implementación | Tests |
|---|---|---|---|---|---|
| Triage Manchester | §9 | TRIAJE | IPSG.5 (mínimo) | ✅ PRs #1-#100 | E2E `triage-manchester.spec.ts` |
| Admisión hospitalaria | §10 | HOJA_ING | ACC.1, ACC.2 | ✅ PRs + bridge-admision | E2E `admission.spec.ts` |
| Historia clínica ambulatoria | §11 | HC_AMB | AOP.1 | ⚠️ HC-001 P0 (sin UI/router) | Pendiente |
| Nota de evolución | §11 | EVOL_MED | AOP.2 | ✅ evolucion-medica router | Unit + integ |
| Indicaciones médicas | §13 | IND_MED | MMU.4 | ✅ ind-medicas router | Unit + integ |
| Registros enfermería | §14 | REG_ENF | AOP.7, COP.6 | ✅ registro-enfermeria router | Unit + integ |
| Signos vitales | §15 | SIG_VIT | AOP.5, IPSG.6 | ✅ signos-vitales router | Unit + integ |
| Consentimiento informado | §16 | CONS_INF, CONS_QX | PFR.3 | ✅ ece/consentimiento | E2E + compliance |
| Epicrisis de egreso | §17 | EPICRISIS | ACC.5, ACC.6 | ✅ epicrisis router | Unit + integ |
| RRI (referencia/interconsulta) | §18 | RRI | ACC.3 | ✅ rri router | Unit + integ |
| Solicitud/Resultado estudio | §19 | SOL_EST, RES_EST | COP.7, AOP.3-4 | ✅ con drift HH-01..17 | Unit + integ |
| Acto quirúrgico | §20 | ACTO_QX | ASC.6, IPSG.4 | ✅ acto-quirurgico + WHO | Compliance |
| Registro anestésico | §20 | REG_ANEST | ASC.3, ASC.4 | ✅ registro-anestesico | Unit + integ |
| URPA | §20 | URPA | ASC.5 | ✅ urpa-recovery | Unit + integ |
| Partograma | §21 | PARTOGRAMA | COP.6 (obst) | ✅ partograma router | Unit + integ |
| Sala de expulsión | §21 | SALA_EXP | COP.6 (obst) | ✅ sala-expulsion + HF-10 ALTER pendiente | Unit + integ |
| Atención RN | §22 | ATN_RN | COP.6 (neo) | ✅ atencion-rn router | Unit + integ |
| Reanimación neonatal | §22 | NRP | COP.3 | ✅ reanimacion-neonatal | Unit + integ |
| Certificado defunción | §23 | CERT_DEF | (sin std JCI explícito) | ✅ ece/certificado-defuncion | E2E + compliance |
| Bitácora ECE | §24 | BIT | MOI.14 | ✅ auto (audit hash chain) | Audit chain test |
| Rectificación | §25 | RECT | MOI.12 | ⚠️ Router/UI no existe (drift Fase 1) | Pendiente |
| GS1 Bedside (BCMA) | §27 | (anexo) | IPSG.3, MMU.6 | ✅ bedside + pulsera | Compliance |
| GS1 Logística | §27 | (anexo) | MMU.2, MMU.3 | ✅ gs1-proceso-A/B/C/F | Unit + integ |
| Farmacovigilancia | §28 | (anexo) | MMU.7 | ✅ farmacovigilancia router | Unit + integ |
| Cold chain | §29 | (anexo) | MMU.3 | ✅ cold-chain monitoring | Unit |
| **PCI Infection Control** | **(no TDR)** | **(no NTEC explícito)** | **IPSG.5, PCI.1-11** | 🆕 **Fase JCI-1 (E-01, E-10, E-14)** | Compliance + E2E |
| **PFE Patient Education** | **(no TDR)** | **(no NTEC explícito)** | **PFE.1-4** | 🆕 **Fase JCI-1 (E-02)** | Compliance + E2E + WCAG |
| **QPS Dashboard** | §16 (BI) parcial | (no NTEC) | **QPS.1-11** | 🆕 **Fase JCI-1/2 (E-03, E-09)** | Snapshot + perf |
| **SQE Credentialing** | **(no TDR)** | **(no NTEC explícito)** | **SQE.1-12** | 🆕 **Fase JCI-1 (E-04, E-13)** | Compliance + E2E |
| Workflow designer | §16 (planning) | Motor ECE | MOI.7, MOI.11 | ✅ Fases 1-6 (#211-#218) | Unit + integ |

**Total módulos**: 30 (NTEC) + 4 (JCI nuevos) = **34 módulos**

---

## 3. Trazabilidad por área funcional

### 3.1 Seguridad del Paciente (IPSG)

| Requisito | TDR | NTEC | JCI Std | Estado Implementación | Fase JCI |
|---|---|---|---|---|---|
| Identificación correcta | §9 | DUI/NIE/NIT | IPSG.1 | ✅ + GSRN BCMA | (mejoras E-05) |
| Comunicación efectiva | §18 | RRI | IPSG.2 | ⚠️ sin SBAR/read-back | E-05, E-08, E-18 |
| Medicamentos alto riesgo | §13 | IND_MED | IPSG.3 | ⚠️ sin LASA/double-check | E-05 |
| Cirugía segura | §20 | ACTO_QX + WHO | IPSG.4 | ✅ | E-16 (refuerzo) |
| Hand hygiene + IAAS | (no TDR) | (no NTEC) | IPSG.5 | ❌ | **E-01, E-10, E-14** |
| Prevención caídas | §14 | VAL_INI_ENF Morse | IPSG.6 | ✅ tamizaje, ⚠️ intervenciones | E-05, E-09, E-11 |

### 3.2 Información Clínica (MOI)

| Requisito | TDR | NTEC | JCI Std | Estado |
|---|---|---|---|---|
| Expediente estructurado | §6 | Arts. 28-39 | MOI.1, MOI.6 | ✅ |
| Privacidad/confidencialidad | §6.3 | Arts. 45-52 | MOI.2 | ✅ RLS + bitácora |
| Integridad criptográfica | §6.3 | Art. 55 | MOI.3 | ✅ hash chain SHA-256 |
| Retención 10 años | §6.3 | Art. 55 | MOI.4 | ✅ |
| DR / backup formal | §6.4 | (parcial) | MOI.5 | ⚠️ Supabase managed, plan DR pendiente |
| Firma electrónica | §6.3 | Art. 40 | MOI.13 | ✅ PIN argon2id + TOTP |
| Audit trail completo | §6.3 | Arts. 51-56 | MOI.14 | ✅ |
| Rectificación trazable | §6.3 | Art. 42 | MOI.12 | ⚠️ schema sí, UI/router no |

### 3.3 Calidad y Mejora (QPS)

| Requisito | TDR | NTEC | JCI Std | Estado |
|---|---|---|---|---|
| Indicadores calidad | §16 (BI) | (no NTEC) | QPS.2, QPS.3 | ⚠️ datos sí, dashboard no |
| Eventos centinela | §17 | (no NTEC) | QPS.5 | ⚠️ outbox sí, RCA formal no |
| Adverse events | §17 | (no NTEC) | QPS.6 | ⚠️ Beta.15 alerts, sin formulario |
| Patient safety culture | (no TDR) | (no NTEC) | QPS.7 | ❌ survey pendiente |

### 3.4 Educación al Paciente (PFE)

| Requisito | TDR | NTEC | JCI Std | Estado |
|---|---|---|---|---|
| Needs assessment | (no TDR) | (no NTEC) | PFE.1 | ❌ |
| Education provided | (no TDR) | (no NTEC) | PFE.2 | ❌ (solo DOC_ASOC adjuntos) |
| Teach-back | (no TDR) | (no NTEC) | PFE.3 | ❌ |
| Discharge education | §17 (parcial) | EPICRISIS | PFE.4 | ⚠️ recomendaciones sí, teach-back no |

### 3.5 Credentialing y Privilegios (SQE)

| Requisito | TDR | NTEC | JCI Std | Estado |
|---|---|---|---|---|
| Job descriptions | (no TDR) | (no NTEC) | SQE.1 | ❌ |
| Credentials verification | (no TDR) | colegio_medico_no | SQE.2, SQE.9 | ❌ campo sí, workflow no |
| Education records | (no TDR) | (no NTEC) | SQE.3, SQE.8 | ❌ |
| Privilegios clínicos | (no TDR) | (no NTEC) | SQE.10 | ❌ RBAC ≠ privilegios clínicos |
| OPPE | (no TDR) | (no NTEC) | SQE.11 | ❌ |
| Re-credentialing | (no TDR) | (no NTEC) | SQE.12 | ❌ |

---

## 4. Trazabilidad PRs → Módulos → Standards

### 4.1 PRs por módulo (selección representativa)

| Módulo | PRs principales (último año) | Cobertura JCI directa |
|---|---|---|
| Triage | #1-3, #101 | IPSG.5 mínimo |
| Workflow Designer | #211-#218 | MOI.7, MOI.11, MOI.12 |
| Audit hash chain | #20 (Beta hardening) | MOI.3, MOI.14 |
| Firma electrónica | #134 (F2-S15) | MOI.13 |
| BCMA + GS1 | #125 (F2-S7), #149 | IPSG.3, MMU.6, MMU.2 |
| Acto quirúrgico + WHO | F2-S4 | IPSG.4, ASC.6 |
| Consentimiento informado | F2-S15 | PFR.3 |
| Defunción | F2-S2, #20 | (no JCI específico) |
| Atención emergencia | F2-S3 | ACC.1 |
| Hoja ingreso hospitalario | F2-S4 | ACC.2 |
| **PCI Infection Control** | **🆕 JCI-1.S1-S2 (a crear)** | **IPSG.5, PCI.1-11** |
| **PFE Patient Education** | **🆕 JCI-1.S1-S2 (a crear)** | **PFE.1-4** |
| **QPS Dashboard** | **🆕 JCI-1.S2-S3 + JCI-2.S4-S5** | **QPS.1-11** |
| **SQE Credentialing** | **🆕 JCI-1.S1-S3 (a crear)** | **SQE.1-12** |

### 4.2 PRs Fase JCI (a crear)

| PR | Branch | Épica | Outcome |
|---|---|---|---|
| #220 | `docs/fase-jci-planning` | — | Planning maestro (este PR) |
| #221 | `feat/jci-s0-deuda-coverage` | Sprint 0 | Coverage ≥80% + compliance.yml stub |
| #222 | `feat/jci-e05-ipsg-foundations` | E-05 | IPSG.1-6 schemas + compliance suite base |
| #223 | `feat/jci-e01-pci-schema` | E-01 | Schema pci.* + RLS + outbox events |
| #224 | `feat/jci-e02-pfe-schema` | E-02 | Schema pfe.* + Storage bucket |
| #225 | `feat/jci-e04-sqe-schema` | E-04 | Schema sqe.* + alertas pg_cron |
| #226+ | `feat/jci-e0X-*` | E-06..E-20 | Implementaciones US por US |

---

## 5. Matriz cuantitativa de cobertura

### Pre-Fase JCI (estado actual al 2026-05-24)

| Capa | Módulos | Cobertura |
|---|---|---|
| TDR | 30/30 módulos implementados (≥50%) | 87% |
| NTEC | 30/30 tipos sembrados + workflow designer | 95% |
| JCI 7th Ed. | 70-75% por overlap natural | 72% |
| Tests | Global ~72% lines (debajo target 80%) | 72% |

### Post-Fase JCI (objetivo 2027-02-28)

| Capa | Cobertura objetivo | Mejora |
|---|---|---|
| TDR | 95% | +8 pp |
| NTEC | 100% (cierra MOI.5, RECT router/UI) | +5 pp |
| JCI 7th Ed. | 95% (acreditación) | +23 pp |
| Tests | Global ≥85% lines | +13 pp |

---

## 6. Trazabilidad inversa — qué normas/standards cubre cada PR

**Plantilla para PRs futuros** (a incluir en template de PR):

```markdown
## Trazabilidad regulatoria
- **TDR**: §X.Y (si aplica)
- **NTEC SV**: Art. Z (si aplica)
- **JCI 7th Edition**: Standard X.Y (si aplica) + ME N
- **US**: US.JCI.X.Y / US.F2.X.Y
- **Test cases**: list de test files validando
- **DoD JCI**: D-JCI-1, D-JCI-3, D-JCI-5 (mínimo)
```

Este patrón permite generar la matriz semi-automáticamente con `gh pr list --json title,body | jq` parseando los bloques "Trazabilidad regulatoria".

---

## 7. Mantenimiento

### Frecuencia de actualización

| Evento | Acción | Responsable |
|---|---|---|
| Cierre de US | Actualizar fila `Estado` en `docs/33c_*.md` + esta matriz | @QA |
| Cierre de sprint | Demo + actualizar % cobertura | @PO + @Orq |
| Cierre de release | Mock Survey + cierre de capítulo JCI | Steering Committee |
| Cambio de normativa | Re-evaluación (ej. JCI 8th Edition) | @AE |
| Hallazgo de auditoría | Agregar US correctiva + link al hallazgo | @QA |

### Sincronización con otras matrices

Esta matriz reemplaza progresivamente:
- `docs/26_trazabilidad_matrix.md` (actualmente solo TDR → US)
- `docs/12_rls_validation.md` (RLS validation table)
- Tablas de cobertura dispersas en otros docs

Al final de JCI-1.0 se consolida `docs/26_*.md` dentro de este documento (este pasa a ser la única matriz del proyecto).

---

## 8. Apéndice — Convenciones

- **ME**: Measurable Element (sub-requisito de un standard JCI)
- **WSJF**: Weighted Shortest Job First (priorización SAFe)
- **MoSCoW**: Must / Should / Could / Won't
- **DoD**: Definition of Done
- **DRE**: Defect Removal Efficiency
- **MTTR**: Mean Time To Repair
- **OPPE**: Ongoing Professional Practice Evaluation
- **IAAS**: Infección Asociada a la Atención Sanitaria
- **MDR**: Multi-Drug Resistant organism
- **LASA**: Look-Alike Sound-Alike (medicamentos)
- **CLABSI**: Central Line-Associated Bloodstream Infection
- **CAUTI**: Catheter-Associated Urinary Tract Infection
- **SSI**: Surgical Site Infection
- **VAP**: Ventilator-Associated Pneumonia
