# 33a — Plan de Releases y Roadmap JCI

> **Origen**: planning @PO (backlog detallado en `docs/33b_jci_backlog.md`).
> **Estado**: pendiente priorización del Sponsor + CMO.
> **Total**: 20 épicas / ~807 SP / 3 releases / 6-9 meses.

---

## Resumen de releases

| Release | Fecha objetivo | SP | Épicas | Outcome | "Ready for evaluator" |
|---|---|---|---|---|---|
| **JCI-1.0** | 2026-08-31 (3 meses) | ~514 | E-01, E-02, E-04, E-05, E-06, E-07, E-09, E-11, E-14, E-16 | Cierre brechas críticas: PCI vigilancia, PFE educación, SQE credentialing, IPSG.1-6, MMU trazabilidad, QPS eventos adversos | Mock Survey parcial — capítulos PCI/PFE/SQE/IPSG/MMU listos |
| **JCI-2.0** | 2026-11-30 (6 meses) | ~227 | E-03, E-08, E-10, E-12, E-13, E-17, E-18 | Dashboard QPS completo, continuidad asistencial, higiene de manos, equipamiento, capacitación, lab cierre del loop | Mock Survey completo — todos los capítulos Must cerrados |
| **JCI-3.0** | 2027-02-28 (9 meses) | ~66 | E-15, E-19, E-20 | Gestión documental, emergencias, satisfacción paciente | **Encuesta JCI oficial** programada |

---

## Sprint 0 — Deuda técnica (pre-JCI-1)

**Duración**: 1 sprint (2 semanas) | **SP**: ~30

Bloquea inicio de JCI-1. Requerido por @QA antes de cualquier feature nueva.

| ID | Tarea | SP | Responsable |
|---|---|---|---|
| JCI-S0-01 | Elevar coverage global de ~72% a ≥80% (deuda Fase 2) | 13 | @Dev + @QA |
| JCI-S0-02 | Crear job `compliance.yml` (estructura vacía pasante) | 3 | @QA + @SRE |
| JCI-S0-03 | Agregar 7 test users nuevos a `seed-test-users.mjs` | 2 | @QA |
| JCI-S0-04 | Fixtures base JCI en `packages/test-utils/` | 5 | @QA |
| JCI-S0-05 | Arreglar 42 errores TS preexistentes en pages UI (`deaths`, `workflows`, `atencion-emergencia`, etc.) | 7 | @Dev |

**Gate G0 JCI**: typecheck verde + coverage ≥80% + compliance job estructura lista.

---

## Release JCI-1.0 — Brechas críticas (3 meses)

**Sprints**: JCI-1.S1 a JCI-1.S6 (12 semanas, 2 semanas/sprint)
**Fecha objetivo**: 2026-08-31

### Épicas incluidas

| ID | Épica | Cap. JCI | SP | Sprint |
|---|---|---|---|---|
| JCI-E-05 | IPSG.1-6 metas internacionales seguridad | IPSG.1-6 | 89 | S1-S3 |
| JCI-E-01 | PCI vigilancia y reporte | PCI.5, PCI.6 | 55 | S1-S2 |
| JCI-E-04 | SQE credentialing y privilegios | SQE.9-12 | 55 | S1-S3 |
| JCI-E-07 | MMU trazabilidad medicamentos | MMU.4, 5, 7 | 55 | S2-S3 |
| JCI-E-09 | QPS gestión riesgo + eventos adversos | QPS.8, 11 | 47 | S3 |
| JCI-E-02 | PFE educación paciente y familia | PFE.1-4 | 42 | S1-S2 |
| JCI-E-11 | Evaluación inicial y revaloración | COP.1, 2.1 | 42 | S2-S3 |
| JCI-E-14 | Vigilancia epidemiológica automatizada | PCI.6, QPS.4 | 42 | S2-S3 |
| JCI-E-16 | Cirugía segura — WHO Checklist refuerzo | IPSG.4, COP.6 | 34 | S2 |
| JCI-E-06 | Derechos paciente + consentimiento | PFR.2, 3, 5 | 34 | S2 |

**Total JCI-1.0**: ~514 SP

### Distribución por sprint

| Sprint | Foco | SP | Épicas activas |
|---|---|---|---|
| S1 (2026-06-09 → 06-22) | Schemas BD + skeletons routers + RLS + audit | ~85 | E-05, E-01, E-04, E-02 |
| S2 (2026-06-23 → 07-06) | UI base + workflows core + outbox events | ~95 | E-05, E-01, E-04, E-02, E-07, E-11, E-14, E-16, E-06 |
| S3 (2026-07-07 → 07-20) | UAT clínico + correcciones + integración cruzada | ~85 | E-05, E-04, E-07, E-09, E-11, E-14 |
| S4 (2026-07-21 → 08-03) | Compliance tests + audit chain + RLS smoke | ~80 | Cross-cutting |
| S5 (2026-08-04 → 08-17) | Refinement + accesibilidad WCAG PFE + perf SLA | ~85 | Cross-cutting + bug fixes |
| S6 (2026-08-18 → 08-31) | Hardening + UAT extendido + Mock Survey parcial | ~84 | Hardening + handoff |

### Outcome esperado JCI-1.0

- ✅ Capítulo PCI: 95% cobertura (faltaba 5%)
- ✅ Capítulo PFE: 90% cobertura (faltaba 90%)
- ✅ Capítulo SQE: 90% cobertura (faltaba 65%)
- ✅ IPSG 1-6: 100% cobertura con compliance tests
- ✅ MMU.4/5/7: 95% cobertura (ya estaba alto)
- ✅ PFR.2/3/5: 95% cobertura
- ✅ Compliance job CI verde
- ⚠️ QPS dashboard: 60% (full dashboard en JCI-2.0)

### "Ready for evaluator" (Mock Survey parcial)

Al cierre de JCI-1.0 se puede invitar a un consultor JCI para Mock Survey **parcial** de capítulos cerrados. Resultado esperado: validar que los módulos PCI/PFE/SQE/IPSG cumplen ME (Measurable Elements) antes de proceder a JCI-2.0.

---

## Release JCI-2.0 — Completitud (3 meses adicionales)

**Sprints**: JCI-2.S4 a JCI-2.S9 (12 semanas)
**Fecha objetivo**: 2026-11-30

### Épicas incluidas

| ID | Épica | Cap. JCI | SP | Sprint |
|---|---|---|---|---|
| JCI-E-03 | Dashboard QPS completo + métricas | QPS.4, 7 | 63 | S4-S5 |
| JCI-E-08 | Continuidad asistencial + plan alta | COP.2, 3, 8 | 42 | S4-S5 |
| JCI-E-13 | Capacitación y competencia personal | SQE.3, 8 | 34 | S4-S5 |
| JCI-E-12 | Gestión equipamiento + mantenimiento preventivo | FMS.8 | 34 | S5 |
| JCI-E-17 | Lab manejo muestras + resultados críticos | COP.7, IPSG.2 | 34 | S4 |
| JCI-E-10 | Higiene de manos — auditoría digital | PCI.9 | 21 | S4 |
| JCI-E-18 | Comunicación resultados — cierre loop | IPSG.2, COP.7 | 21 | S5 |

**Total JCI-2.0**: ~249 SP

### Outcome esperado JCI-2.0

- ✅ QPS dashboard 90% (Metabase embed + 25 KPIs)
- ✅ Higiene de manos compliance digital (PCI.9)
- ✅ Continuidad asistencial (COP completo)
- ✅ Capacitación personal con evidencia (SQE.3, 8)
- ✅ Equipamiento + PM preventivo (FMS.8 parcial)
- ✅ Lab cierre del loop (IPSG.2)

### "Ready for evaluator" (Mock Survey completo)

Mock Survey completo de TODOS los capítulos Must. Si pasa, se programa la **encuesta JCI oficial** para JCI-3.0 + meses 7-9 de preparación operativa.

---

## Release JCI-3.0 — Deseables + Encuesta oficial (3 meses adicionales)

**Sprints**: JCI-3.S6 a JCI-3.S9 (8 semanas + 4 semanas hipercuidado)
**Fecha objetivo**: 2027-02-28

### Épicas incluidas

| ID | Épica | Cap. JCI | SP | Sprint |
|---|---|---|---|---|
| JCI-E-15 | Gestión documental + control de políticas | GLD.11 | 21 | S6 |
| JCI-E-19 | Preparación emergencias + continuidad | FMS.6 | 21 | S7 |
| JCI-E-20 | Satisfacción paciente — encuestas | PFR.1, QPS.6 | 21 | S7 |

**Total JCI-3.0**: ~63 SP (módulos deseables)

### Sprints adicionales: Preparación encuesta JCI oficial

| Sprint | Foco | SP |
|---|---|---|
| S8 (2027-01-12 → 01-25) | Mock Survey final (3-day simulation con consultor JCO) | 21 |
| S9 (2027-01-26 → 02-08) | Correcciones post-Mock Survey | 21 |
| **Encuesta JCI oficial** | 2027-02-09 → 02-13 | — |
| S10 (2027-02-16 → 02-28) | Hipercuidado + acciones correctivas | — |

### Outcome esperado JCI-3.0

- ✅ Todos los capítulos JCI ≥85% cobertura
- ✅ Mock Survey final aprobado
- ✅ **Encuesta JCI oficial ejecutada** (semana 2027-02-09)
- ✅ Acreditación JCI obtenida (sujeto a resultado encuesta)

---

## Hitos transversales

| Hito | Fecha | Responsable |
|---|---|---|
| Aprobación Go/No-Go del Sponsor | 2026-05-31 | CEO |
| Contratación consultor JCI | 2026-06-15 | CMO + Compras |
| Sprint 0 deuda técnica | 2026-06-09 → 06-22 | @QA + @Dev |
| Inicio JCI-1.S1 | 2026-06-23 | @Orq |
| Mock Survey parcial | 2026-09-15 | Consultor JCI |
| Inicio JCI-2.S4 | 2026-09-01 | @Orq |
| Mock Survey completo | 2026-12-15 | Consultor JCI |
| Inicio JCI-3.S6 | 2026-12-01 | @Orq |
| Mock Survey final (3-day simulation) | 2027-01-19 | Consultor JCI |
| **Encuesta JCI oficial** | 2027-02-09 → 02-13 | JCO |
| Acreditación notificada | 2027-03-30 (estimado) | JCO |

---

## Dependencias externas y riesgos cronograma

| Dependencia | Impacto | Mitigación |
|---|---|---|
| Contratación consultor JCI certificado | Crítico — sin él no hay Mock Survey | Iniciar RFP a consultoras (DNV, JCO directo) en mes 1 |
| Firma del CEO en convenio JCO | Crítico — JCO no acepta encuesta sin convenio | Acordar firma pre-JCI-2.0 (mes 6) |
| Cambios JCI 8th Edition (2024+) | Medio — algunos ME modificados | Gap análisis adicional al cierre de JCI-1.0 si JCI publica 8th Edition antes |
| Disponibilidad personal clínico para UAT | Alto — 2h/semana acordadas con CMO | Bloqueo de agenda fija desde Sprint 0 |
| Migraciones BD a Supabase prod sin downtime | Alto — pacientes activos | Migraciones aplicadas en ventana de bajo tráfico + rollback testeado |

---

## Estimación de esfuerzo total

| Componente | SP | Esfuerzo (semanas equipo 4 devs) |
|---|---|---|
| Sprint 0 deuda técnica | ~30 | 2 |
| JCI-1.0 (críticas) | ~514 | 12 |
| JCI-2.0 (completitud) | ~249 | 12 |
| JCI-3.0 (deseables + encuesta) | ~63 + 42 (Mock+correcciones) | 12 + 4 hipercuidado |
| **Total** | **~898 SP** | **40 semanas (~9 meses + 1 mes hipercuidado)** |

**Costo estimado** (solo desarrollo, excluyendo consultor JCI y tasas JCO):
- 4 devs × 10 meses × estimación interna = costo @PO valida
- Consultor JCI Mock Surveys: USD 30-50K (3 mocks)
- Tasas JCO (aplicación + encuesta + post-acreditación): USD 50-80K
- **Total externo estimado**: USD 80-130K

---

## Próximo paso

@Orq solicita priorización al Sponsor (CEO) y CMO:

1. ¿Aprueba el plan integral con fecha objetivo 2027-02-28?
2. ¿Aprueba inversión externa USD 80-130K + costo desarrollo interno?
3. ¿Cuál es la primera épica a arrancar en JCI-1.S1 (recomendación @PO por WSJF: E-05 IPSG)?

Una vez priorizada, @Orq arranca Fase 4 (Construcción) con la primera épica.
