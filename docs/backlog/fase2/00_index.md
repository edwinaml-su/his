# Backlog Fase 2 — Workflows + ECE + GS1

> **Propietario:** @Orq (orquestador) · **Fecha:** 2026-05-16 · **Estado:** Listo para refinamiento Sprint Planning
> **Marco regulatorio:** Acuerdo MINSAL n.° 1616 (NTEC) · Ley SNIS · Procesos ISSS · GS1 Healthcare Standards
> **Generado por:** 10 streams paralelos (1 @AE + 1 @AS + 7 @PO + 1 @DBA) bajo orquestación @Orq

---

## 1. Resumen ejecutivo

La Fase 2 del HIS Multipaís de Inversiones Avante habilita la **digitalización conforme a NTEC** del expediente clínico (19+ documentos) + el **motor de workflows data-driven** (estados/transiciones/roles configurables sin redeploy) + la **trazabilidad logística y clínica GS1** end-to-end (procesos A-F, 5 correctos en bedside).

**Métricas consolidadas del backlog:**

| Indicador | Valor |
|---|---:|
| Total documentos | 10 archivos (~12,500 líneas) |
| Épicas funcionales (E.F2.1 — E.F2.7) | 7 |
| User Stories totales | **277** |
| Story Points totales | **1,532+ SP** (61 SP backend @DBA aparte) |
| Sprints estimados (a 25 SP/sprint, 4 squads) | **~16 sprints** = 8 meses calendario |
| Documentos ECE cubiertos | **34/34** (15 ambulatorios + 29 hospitalarios + 0 huecos) |
| Procesos GS1 cubiertos | **6/6** (A inbound, B transfers, C unidosis, D dispensación, E bedside, F inversa) |
| Artículos NTEC citados | **26 artículos distintos** |

---

## 2. Mapa de entregables

| # | Stream | Agente | Archivo | Líneas | US | SP |
|---|---|---|---|---:|---:|---:|
| 01 | Impacto + Normativa | **@AE** | [01_ae_impacto_normativo.md](./01_ae_impacto_normativo.md) | 344 | — | — |
| 02 | Arquitectura técnica | **@AS** | [02_as_arquitectura.md](./02_as_arquitectura.md) | 819 | — | — |
| 03 | E.F2.1 Motor Workflow | **@PO** | [03_epic_workflow_engine.md](./03_epic_workflow_engine.md) | 560 | 20 | 122 |
| 04 | E.F2.2 Workflow Designer | **@PO** | [04_epic_workflow_designer.md](./04_epic_workflow_designer.md) | 1,119 | 20 | 100 |
| 05 | E.F2.3 ECE Ambulatorio | **@PO** | [05_epic_ece_ambulatorio.md](./05_epic_ece_ambulatorio.md) | 2,147 | 50 | 230 |
| 06 | E.F2.4 ECE Hospitalario | **@PO** | [06_epic_ece_hospitalario.md](./06_epic_ece_hospitalario.md) | 1,913 | 34 | 193 |
| 07 | E.F2.5 GS1 Logística (A-B-C-F) | **@PO** | [07_epic_gs1_logistica.md](./07_epic_gs1_logistica.md) | 600 | 47 | 319 |
| 08 | E.F2.6 GS1 Bedside (D-E) | **@PO** | [08_epic_gs1_bedside.md](./08_epic_gs1_bedside.md) | 2,044 | 58 | 336 |
| 09 | E.F2.7 Cumplimiento + Firma + RBAC | **@PO** | [09_epic_cumplimiento.md](./09_epic_cumplimiento.md) | 1,913 | 48 | 171 |
| 10 | DBA Schema + Integración | **@DBA** | [10_dba_schema_integracion.md](./10_dba_schema_integracion.md) | 1,069 | — | 61 |
| _insumos_ | Fuentes originales | — | [`_insumos/`](./_insumos/) | 13 archivos | — | — |

---

## 3. Decisiones arquitectónicas adoptadas (ADRs propuestos por @AS)

| ADR | Decisión | Owner |
|---|---|---|
| **ADR-F2-01** | Schema `ece` separado (NO mezcla con `public.*`) — preserva MPI Patient + cumple NUI/CUN NTEC | @AS + @DBA |
| **ADR-F2-02** | Motor workflow 100% data-driven (no BPMN nativo) — cambio = `UPDATE`, sin deploy | @AS |
| **ADR-F2-03** | GS1 DataMatrix decoder client-side (`@zxing/browser` + Web Worker) — validación 5 correctos siempre server-side | @AS |
| **ADR-F2-04** | Firma electrónica simple PIN + SHA-256 + salt + cache 15 min (no PKI) | @AS |
| **ADR-F2-05** | EPCIS event sourcing en `ece.epcis_event` con WHAT/WHERE/WHEN/WHY/WHO | @AS |
| **ADR-F2-06** | Designer visual con React Flow + dagre auto-layout | @AS |
| **ADR-F2-07** | Estrategia migración data MVP → ECE: ACL `ece.paciente.public_patient_id` nullable | @AS + @DBA |

**@DBA recomienda Opción B** de integración: reuso de `public.Patient/Encounter/User`, schema `ece.*` solo para documentos NTEC. **14 conflictos** identificados, **3 críticos** documentados en `10_dba_schema_integracion.md`.

---

## 4. Wave planning sugerida (16 sprints estimados)

| Sprint | Foco | Épicas | SP aprox |
|---|---|---|---:|
| **F2-S1** (gate) | Schema `ece` + RLS + motor workflow base + firma electrónica | E.F2.1 (Must) + E.F2.7 §1 + DBA | 90 |
| **F2-S2** | Motor workflow completo + ECE Ficha Identificación | E.F2.1 (rest) + E.F2.3 §1 | 95 |
| **F2-S3** | ECE Historia Clínica + Signos Vitales + Triaje | E.F2.3 §2-4 | 100 |
| **F2-S4** | ECE Atención Emergencia + Indicaciones + Kardex | E.F2.3 §5-7 | 100 |
| **F2-S5** | ECE Evolución + RRI + Consentimiento + ISSS Incapacidad | E.F2.3 §8-11 + E.F2.7 §2 | 100 |
| **F2-S6** | ECE Hospitalario: ingreso + admisión + valoración enf | E.F2.4 §1-5 | 95 |
| **F2-S7** | ECE Hospitalario: evolución + interconsulta + estudios | E.F2.4 §6-10 | 100 |
| **F2-S8** | Ruta quirúrgica completa (preop + checklist + descripción + URPA) | E.F2.4 §11-16 | 100 |
| **F2-S9** | Ruta obstétrica + RN + defunción + epicrisis | E.F2.4 §18-24 | 95 |
| **F2-S10** | Catálogos GS1 + Proceso A Inbound | E.F2.5 §1-2 | 95 |
| **F2-S11** | GS1 Procesos B (transfers) + C (unidosis) + F (inversa) | E.F2.5 §3-5 | 100 |
| **F2-S12** | GS1 Proceso D Dispensación farmacia | E.F2.6 §2 | 95 |
| **F2-S13** | GS1 Proceso E Bedside + 5 correctos + farmacovigilancia | E.F2.6 §3 | 100 |
| **F2-S14** | GS1 Modos especiales (rondas/STAT/offline) + EPCIS | E.F2.6 §4-6 | 95 |
| **F2-S15** | Cumplimiento: bitácora + RBAC + certificación DIR + ARCO | E.F2.7 §3-5, §11 | 95 |
| **F2-S16** | Workflow Designer UI + cierre + UAT + go-live | E.F2.2 + DoD bridge | 100 |

---

## 5. Riesgos top consolidados

| # | Riesgo | Exposición | Owner mitigación |
|---|---|---|---|
| R-01 | Sin firma electrónica simple operativa, todo acto clínico en HIS carece de validez legal (NTEC). | **20/25** crítico | @AS + @Dev Sprint F2-S1 |
| R-02 | Drift de NUI/CUN entre `public.Patient` y `ece.paciente`. | 16/25 alto | @DBA Opción B |
| R-03 | Series temporales (partograma, anestesia, URPA) >1000 registros por episodio en JSONB. | 12/25 medio | @DBA + @Dev plan partición |
| R-04 | Adopción operativa bedside scanning — resistencia enfermería. | 12/25 medio | @PO + @QAF UAT temprano |
| R-05 | Recall GS1 falso positivo bloquea operación. | 9/25 medio-bajo | @SRE runbook |
| R-06 | Cache 15 min firma electrónica abre ventana suplantación si robo de sesión. | 8/25 bajo | @AS + @SRE 2FA opcional |
| R-07 | Versionado de workflows rompe instancias en curso. | 9/25 medio | @AS snapshot inmutable por instancia |

Ver detalle en `01_ae_impacto_normativo.md` §4.

---

## 6. Decisiones pendientes a stakeholder Avante (priorizadas)

1. **PIN longitud y rotación** — ¿6 dígitos rotación 90 días o 8 caracteres alfanuméricos sin rotación?
2. **Hardware bedside** — ¿pistola USB HID Zebra DS2278 (200 USD/u) o smartphone PWA con cámara (BYOD)?
3. **Licencia GS1 El Salvador** — ¿afiliación corporativa Inversiones Avante o por establecimiento?
4. **Comité Expediente Clínico** — composición exacta + cadencia (Art. 32 NTEC).
5. **Política retención por diagnóstico** — confirmar 10 años para casos forenses (vs 5 base) y mecanismo aprobación supresión.
6. **Schema integración Opción A/B/C** — confirmar Opción B recomendada por @DBA.
7. **Workflow Designer permisos** — ¿solo rol nuevo "Workflow Designer" o también DIR / @AS interno?

---

## 7. Cobertura — matriz documentos ECE

| Documento (NTEC §) | Épica | US clave | Estado |
|---|---|---|---|
| 3.1 Ficha Identificación | E.F2.3 | US.F2.3.1-6 | ✅ |
| 3.2 Historia Clínica | E.F2.3 + E.F2.4 | US.F2.3.12, 13, 15, 43 + US.F2.4.4 | ✅ |
| 3.3 Signos Vitales | E.F2.3 + E.F2.4 | US.F2.3.10-11 + US.F2.4.8 | ✅ |
| 3.4 Triaje | E.F2.3 | US.F2.3.9 | ✅ |
| 3.5 Atención Emergencia | E.F2.3 | US.F2.3.16-17 | ✅ |
| 3.6 Indicaciones Médicas | E.F2.3 + E.F2.4 | US.F2.3.18-19 + US.F2.4.6 | ✅ |
| 3.7 Enfermería + Kardex | E.F2.3 + E.F2.4 | US.F2.3.20-21 + US.F2.4.5, 8 | ✅ |
| 3.8 Evolución Médica | E.F2.3 + E.F2.4 | US.F2.3.13, 22 + US.F2.4.7 | ✅ |
| 3.9 Consentimiento Informado | E.F2.3 + E.F2.4 | US.F2.3.29 + US.F2.4.3, 12 | ✅ |
| 3.10 RRI | E.F2.3 + E.F2.4 | US.F2.3.26-28 + US.F2.4.9 | ✅ |
| 3.11 Orden Ingreso | E.F2.4 | US.F2.4.1 | ✅ |
| 3.12 Hoja Ingreso / Apertura Episodio | E.F2.4 | US.F2.4.2 | ✅ |
| 3.13 Acto Quirúrgico (4 sub-docs) | E.F2.4 | US.F2.4.11-16 | ✅ |
| 3.14 Documentos Obstétricos (4 sub-docs) | E.F2.4 | US.F2.4.18-21 | ✅ |
| 3.15 Epicrisis / Egreso | E.F2.4 | US.F2.4.23-24 | ✅ |
| 3.16 Certificado Defunción | E.F2.4 | US.F2.4.25 | ✅ |
| 3.17 Certificado Incapacidad ISSS | E.F2.3 | US.F2.3.32 | ✅ |
| 3.18 Apoyo Diagnóstico Lab/Gabinete | E.F2.3 + E.F2.4 | US.F2.3.23-25 + US.F2.4.10 | ✅ |
| Alta Ambulatoria + devolución exp. | E.F2.3 | US.F2.3.33-34, 39 | ✅ |
| Hoja Procedimiento Menor | E.F2.3 | US.F2.3.30-31 | ✅ |
| Hoja Observación Emergencia | E.F2.3 | US.F2.3.17 | ✅ |
| Acta Entrega Cuerpo + Morgue | E.F2.4 | US.F2.4.26 | ✅ |
| Censo Movimiento Diario | E.F2.4 | US.F2.4.27 | ✅ |
| Codificación CIE-10 Egreso | E.F2.4 + E.F2.7 | US.F2.4.28 + US.F2.7.30-32 | ✅ |
| Foliado + Archivo | E.F2.4 | US.F2.4.29 | ✅ |
| Certificación Copia (DIR) | E.F2.7 | US.F2.7.13-15 | ✅ |
| Rectificación trazable | E.F2.7 | US.F2.7.7-11 | ✅ |
| Bitácora accesos (Art. 55-56) | E.F2.7 | US.F2.7.16-20 | ✅ |
| Firma electrónica simple (Art. 23) | E.F2.7 | US.F2.7.1-6 | ✅ |

**Cobertura: 34/34 documentos = 100%**

---

## 8. Cobertura — matriz GS1

| Proceso GS1 (guía §) | Épica | US clave | Estado |
|---|---|---|---|
| §1.1 GTIN / GLN / GSRN / SSCC catálogos | E.F2.5 + E.F2.6 | US.F2.5.1-5 + US.F2.6.1-5 | ✅ |
| §1.2 DataMatrix decoder + FNC1 | E.F2.6 | US.F2.6.42-45 | ✅ |
| §2.1 Proceso A Inbound | E.F2.5 | US.F2.5.6-13 | ✅ |
| §2.2 Proceso B Transfers | E.F2.5 | US.F2.5.14-21 | ✅ |
| §2.3 Proceso C Unidosis | E.F2.5 | US.F2.5.22-28 | ✅ |
| §2.4 Proceso D Dispensación | E.F2.6 | US.F2.6.6-20 | ✅ |
| §2.5 Proceso E Bedside (5 correctos) | E.F2.6 | US.F2.6.21-41 | ✅ |
| §2.6 Proceso F Logística inversa | E.F2.5 | US.F2.5.29-38 | ✅ |
| §3 EPCIS WHAT/WHERE/WHEN/WHY/WHO | E.F2.5 + E.F2.6 | US.F2.5.39-42 + US.F2.6.53-58 | ✅ |
| §4.1 GTIN como índice global productos | E.F2.5 | US.F2.5.1 + ADR-F2-05 | ✅ |
| §4.2 DoD bedside (no manual + ValidationError) | E.F2.6 | US.F2.6.23 + 47 | ✅ |
| §4.3 QA recall + decodificación regex | E.F2.5 | US.F2.5.29-30 | ✅ |

**Cobertura: 12/12 controles GS1 = 100%**

---

## 9. Next steps (post-merge de este PR)

1. **Refinamiento Sprint Planning** — @PO + Squad Leads desglosan F2-S1 al detalle.
2. **Decisiones pendientes** — Stakeholder Avante resuelve los 7 puntos de §6.
3. **Sprint F2-S1 arranca con triple gate**: schema `ece` aplicado + firma electrónica simple + motor workflow base. Sin estos, Fase 2 no avanza.
4. **Wave SRE paralela** — provisionar entorno staging con `ece` + capacitación operadores GS1.
5. **Comité Expediente Clínico** (Art. 32 NTEC) — constituirlo formalmente antes de F2-S2.

---

## 10. Trazabilidad — fuentes consultadas

- `_insumos/analisis_workflows_ece.md` (657 líneas) — §0 Marco normativo, §A Proceso Ambulatorio, §B Proceso Hospitalario, §2 Matrices documentos/roles, §3 Diccionario de datos (3.1-3.19), §4 Grafo de dependencias, §5 Restricciones transversales.
- `_insumos/guia_trazabilidad_hospitalaria_gs1.md` (118 líneas) — §1 Identificadores, §2 Procesos A-F, §3 Meta-prompt EPCIS, §4 Guía implementación (MDM, DoD, QA).
- `_insumos/README.md` + 9 archivos SQL del schema `ece` propuesto + 1 ER Mermaid.
- `CLAUDE.md` raíz — convenciones HIS (Contrato RLS, Audit hash chain, patrones tRPC/Prisma).
- `packages/database/prisma/schema.prisma` — estado actual del MVP + Beta.1-21 mergeados.

---

— **@Orq** | Orquestador Transformación Digital | Inversiones Avante | 2026-05-16
