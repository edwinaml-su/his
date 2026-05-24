# Épica JCI-E-05 — IPSG.1-6 Metas Internacionales de Seguridad

> **Estado**: ARRANCADA — Sprint JCI-1.S1 inicia con esta épica.
> **Sprint**: JCI-1.S1 → S2 → S3 (3 sprints, 6 semanas)
> **SP totales**: 89 | **WSJF**: 9.5 (top de prioridad)
> **MoSCoW**: Must (no negociable para acreditación)

---

## Resumen

Las 6 IPSG (International Patient Safety Goals) son el primer capítulo evaluado por el surveyor JCI. Fallar UNA sola IPSG = fallar el capítulo completo. Por eso esta épica es la primera del programa.

**Cobertura HIS actual**: 5/6 cubiertos a nivel infraestructura (con gaps de profundidad). IPSG.5 (infecciones) es ❌ — se delega a épica E-01 (PCI). Esta épica se enfoca en consolidar IPSG.1, IPSG.2, IPSG.3, IPSG.4, IPSG.6 + agregar lo que falte.

---

## US incluidas en la épica E-05

### IPSG.1 — Identificación del paciente

| US | Título | SP | Sprint |
|---|---|---|---|
| US.JCI.5.1 | Validación 2 identificadores en BCMA | 3 | S1 |
| US.JCI.5.2 | Validación 2 identificadores en transfusión | 3 | S1 |
| US.JCI.5.3 | Validación 2 identificadores en toma muestra lab (bedside) | 5 | S1 |
| US.JCI.5.4 | Wristband con GSRN obligatorio al admitir | 3 | S1 |

### IPSG.2 — Comunicación efectiva

| US | Título | SP | Sprint |
|---|---|---|---|
| US.JCI.5.5 | Workflow read-back órdenes verbales (médico ordena, enfermera repite, médico confirma) | 8 | S2 |
| US.JCI.5.6 | Lista codificada de abreviaciones prohibidas + validación pre-firma | 5 | S2 |
| US.JCI.5.7 | Notificación resultados críticos con SLA <60min + read-back digital | 8 | S2 |
| US.JCI.5.8 | Template SBAR estructurado en handoff entre turnos REG_ENF | 5 | S2 |

### IPSG.3 — Medicamentos alto riesgo

| US | Título | SP | Sprint |
|---|---|---|---|
| US.JCI.5.9 | Lista high-alert medications codificada (catálogo `Drug.isHighAlert`) | 5 | S2 |
| US.JCI.5.10 | LASA alerts en BCMA (look-alike sound-alike) | 5 | S2 |
| US.JCI.5.11 | Workflow double-check independiente (insulina/heparina/opioides) | 8 | S2 |
| US.JCI.5.12 | Bloqueo administración fuera de rango dosis máxima pediátrica | 5 | S3 |

### IPSG.4 — Cirugía segura (refuerzo del existente)

| US | Título | SP | Sprint |
|---|---|---|---|
| US.JCI.5.13 | WHO Checklist obligatorio (no se puede saltar) — enforcement SQL trigger | 3 | S3 |

### IPSG.6 — Caídas

| US | Título | SP | Sprint |
|---|---|---|---|
| US.JCI.5.14 | Re-evaluación Morse con SLA cada turno (compliance test) | 5 | S3 |
| US.JCI.5.15 | Protocolo intervenciones por nivel de riesgo (UI guideline) | 5 | S3 |
| US.JCI.5.16 | Formulario estructurado reporte de caídas (no texto libre) | 5 | S3 |
| US.JCI.5.17 | Indicador caídas /1000 días-cama en QPS dashboard (handoff a E-03) | 3 | S3 |

**Total E-05**: 89 SP en 17 US distribuidas en 3 sprints (S1=14, S2=44, S3=31).

---

## Sprint JCI-1.S1 — IPSG.1 + setup compliance (14 SP, 2 semanas)

**Fecha**: 2026-06-23 → 2026-07-06

### Entregables S1

1. **Compliance suite bootstrap** (este PR — ya en `feat/jci-e05-ipsg-foundations`)
   - `.github/workflows/compliance.yml` job pasante
   - `packages/trpc/src/compliance/__tests__/suite-bootstrap.test.ts`
   - `packages/trpc/src/compliance/README.md`
2. **US.JCI.5.1**: Validación 2-IDs en BCMA — agregar verificación que `MedicationAdministration` no se persiste sin GSRN + DUI/MRN cruzados
3. **US.JCI.5.2**: Validación 2-IDs en transfusión — agregar al crossmatch
4. **US.JCI.5.3**: Validación 2-IDs en toma muestra lab — agregar al flujo bedside lab
5. **US.JCI.5.4**: Wristband GSRN obligatorio — bloqueo SQL `Encounter` sin GSRN no permite IND_MED

### Criterios de aceptación S1

- [ ] `compliance.yml` corre en cada PR JCI y pasa con suite vacía (bootstrap)
- [ ] Compliance test `ipsg1-patient-id.test.ts` verifica los 4 escenarios de 2-ID
- [ ] BD trigger bloquea INSERT a `MedicationAdministration` sin verificación de identidad
- [ ] Update doc `33c_matriz_trazabilidad_jci.md` con estado de US.JCI.5.1-4

### DoD S1
DoD base + D-JCI-1 + D-JCI-3 + D-JCI-5 (mínimos de Fase JCI)

---

## Sprint JCI-1.S2 — IPSG.2 + IPSG.3 (44 SP, 2 semanas)

**Fecha**: 2026-07-07 → 2026-07-20

### Entregables S2

1. **Read-back órdenes verbales**: nuevo router `verbalOrder.router.ts` con workflow:
   - Médico dicta orden → enfermera registra → enfermera lee de vuelta → médico confirma
   - Outbox event `clinical.verbal_order.confirmed`
   - Compliance test verifica que ninguna `IND_MED` con `originType='VERBAL'` se firma sin read-back
2. **Abreviaciones prohibidas**: lista codificada en `packages/contracts/src/clinical/forbidden-abbreviations.ts`
   - Validador Zod en notas clínicas, indicaciones
   - Sin enforcement bloqueante (warning) hasta acuerdo CMO
3. **Resultados críticos read-back**: extiende LIS auto-flag con notificación + read-back digital del receptor
4. **SBAR handoff**: template estructurado en REG_ENF cierre turno
5. **High-alert meds**: agregar campo `Drug.alertLevel` + flag `isLASA`
6. **LASA alerts UI**: en BCMA scan, si match parcial con otra droga → modal confirmación
7. **Double-check workflow**: medicamentos en lista controlled require 2 enfermeras

---

## Sprint JCI-1.S3 — IPSG.3 cont + IPSG.4 + IPSG.6 (31 SP, 2 semanas)

**Fecha**: 2026-07-21 → 2026-08-03

### Entregables S3

1. **Dosis máximas pediátricas**: tabla `pediatric_max_dose` + validación BCMA antes admin
2. **WHO Checklist enforcement**: trigger SQL impide cerrar `acto_quirurgico` sin las 3 pausas completas
3. **Morse SLA**: pg_cron job verifica que `VAL_INI_ENF` se re-evalúa cada turno; alerta si gap >12h
4. **Intervenciones caída UI**: componente `<FallRiskInterventions>` muestra protocolo según score
5. **Reporte estructurado caídas**: tabla `fall_event` + form en REG_ENF (no texto libre)
6. **Indicador QPS caídas**: matview `analytics.kpi_falls_per_1000_pd` (handoff a épica E-03)

---

## Test cases compliance asociados (a crear en S1-S3)

| Test | Standard | Sprint | US |
|---|---|---|---|
| `ipsg1-patient-id.test.ts` | IPSG.1 ME 1-4 | S1 | 5.1-5.4 |
| `ipsg2-verbal-order.test.ts` | IPSG.2 ME 1 | S2 | 5.5 |
| `ipsg2-abbreviations.test.ts` | IPSG.2 ME 3 | S2 | 5.6 |
| `ipsg2-critical-results.test.ts` | IPSG.2 ME 2 | S2 | 5.7 |
| `ipsg2-sbar-handoff.test.ts` | IPSG.2 ME 4 | S2 | 5.8 |
| `ipsg3-high-alert.test.ts` | IPSG.3 ME 1 | S2 | 5.9 |
| `ipsg3-lasa.test.ts` | IPSG.3 ME 2 | S2 | 5.10 |
| `ipsg3-double-check.test.ts` | IPSG.3 ME 4 | S2 | 5.11 |
| `ipsg3-pediatric-max.test.ts` | IPSG.3 ME 5 | S3 | 5.12 |
| `ipsg4-who-enforcement.test.ts` | IPSG.4 ME 3 | S3 | 5.13 |
| `ipsg6-morse-sla.test.ts` | IPSG.6 ME 2 | S3 | 5.14 |
| `ipsg6-fall-report.test.ts` | IPSG.6 ME 4 | S3 | 5.16 |

12 compliance tests al cierre de E-05.

---

## Riesgos identificados

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| Read-back workflow rechazado por médicos por overhead | Media | Implementar como opcional inicial + acordar adopción con CMO; obligatorio post-UAT |
| Lista LASA requiere mantenimiento manual del farmacéutico | Alta | Seed inicial con top 50 LASA + UI de gestión por rol `PHARMACIST` |
| Double-check duplica trabajo enfermería | Alta | Limitar a lista corta de meds (insulina/heparina/opioides) según consenso clínico |
| SLA Morse cada turno difícil de cumplir en alta carga | Media | Permitir grace period 4h en horarios picos documentado en política DIR |
| BD trigger WHO enforcement rompe flujo existente | Alta | Toggle por establecimiento (override Fase 6) + testing extenso pre-rollout |

---

## Handoffs a otras épicas

- **US.JCI.5.17** (indicador caídas QPS) → épica **E-03** (Dashboard QPS)
- **US.JCI.5.7** (resultados críticos read-back) puede beneficiar a épica **E-18** (Cierre loop comunicación)
- **US.JCI.5.13** (WHO enforcement) refuerza épica **E-16** (Cirugía segura)

---

## Próximo paso operativo

Una vez mergeado este PR (skeleton + compliance.yml + sprint plan):

1. **Sprint 0** corre en paralelo (deuda coverage 72%→80%) por equipo @Dev
2. **JCI-1.S1** arranca 2026-06-23 con las 4 US de IPSG.1
3. @PO refina backlog detallado de S2/S3 dos semanas antes
4. Steering Committee quincenal a partir de 2026-07-04

---

## Referencias

- `docs/33b_jci_backlog.md` § Detalle de épicas — descripción completa E-05
- `docs/33c_matriz_trazabilidad_jci.md` § IPSG — matriz IPSG.1-6 ME por ME
- `docs/33a_jci_releases_y_roadmap.md` § Release JCI-1.0 — contexto release
- JCI Hospital Accreditation Standards 7th Edition (2021) capítulo IPSG
