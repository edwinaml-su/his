# 34 — Roadmap de Producto HIS Multipaís Avante

> **Versión**: 1.0 — 2026-05-24
> **Autor**: @PO — Chief Product Officer
> **Alcance**: visualización consolidada del estado actual + plan de ejecución hacia acreditación JCI 2027-02.
> **Audiencia**: Sponsor (CEO), CMO, Steering Committee, equipos @Orq/@AE/@AS/@QA/@SRE/@Dev.
> **Referencias rectoras**: `docs/06_roadmap.md` (timeline original), `docs/33_fase_jci_planning.md` (planning maestro), `docs/33a_jci_releases_y_roadmap.md` (releases JCI), `docs/32_gap_jci_assessment.md` (gap análisis), `docs/33d_matriz_trazabilidad_proyecto.md` (trazabilidad).

---

## 1. Resumen ejecutivo

Al **2026-05-24** el HIS Multipaís Avante cierra **24 días intensivos** de construcción (2026-04-30 → 2026-05-24) que entregaron la **plataforma asistencial NTEC SV completa**: MVP base (Wave 1-3), Fase 2 con 14 módulos clínicos (Wave 6-8), 15 betas de hardening, ola de audit-remediation con 50 hallazgos P0 cerrados, motor de workflow ECE data-driven (Fases 1-6), y arranque de Fase JCI con planning aprobado (PR #220) e inicio de IPSG (PR #221). La cobertura natural del estándar JCI 7th Edition es **~70-75%** gracias a la convergencia con NTEC y al motor ECE. La fase entrante (**Sprint 0 deuda técnica + 3 releases JCI-1.0/2.0/3.0 a lo largo de 9 meses + 1 mes hipercuidado**) se orienta a cerrar las 4 brechas críticas (PCI, PFE, QPS, SQE) y habilitar la **encuesta JCI oficial programada para 2027-02-09 → 02-13** con acreditación estimada **2027-03-30**. Quedan deudas tácticas no asignadas (HC-001/002, HF-URPA-01, HF-10 ALTER, router RECT, 5 hallazgos Stream J P0, re-audits A-J y audit Stream K en curso en Ola 1) que deben priorizarse para no contaminar la velocidad de los sprints JCI.

---

## 2. Dónde estamos hoy (estado de entregables)

| # | Hito / Ola | PRs / Sprints | Outcome | Estado |
|---|---|---|---|---|
| 1 | **Wave 1-3 MVP base** | PRs #1-#100 (Sprint 3 cierre 2026-05-07) | Multi-entidad + AuthN + RLS + MPI + ADT + Triage Manchester + 9 routers cableados + audit hash chain + 5 E2E reescritos + 31 FK indexes | ✅ |
| 2 | **Wave 6 Fase 2 (integración)** | PR #6 (2026-05-12) | Integra 5 team branches con skeletons §10/§14/§15/§17; primera lección de coverage threshold | ✅ |
| 3 | **Wave 7 Fase 2** | PR #7 (2026-05-12) | Skeletons §11/§12/§13/§16/§18 con tests desde commit 1; CI verde a la primera | ✅ |
| 4 | **Wave 8 Fase 2 (cierre MVP)** | PR #8 (2026-05-12) | Skeletons §19/§20/§21/§22/§25 — **Fase 2 MVP CERRADA con 14 módulos cubiertos** | ✅ |
| 5 | **Fase 5+6 cierre Go-Live** | PRs #9-#20 (2026-05-13) | Schema/RLS/audit a Supabase + Vercel build fix + 6 PRs Fase 6 docs; estado "Listo Go-Live" declarado | ✅ |
| 6 | **Beta hardening 1-13** | PRs #21-#42 (2026-05-13) | Telemetría, alertas, EWS, SLAs, accesibilidad, perf; CLAUDE.md creado | ✅ |
| 7 | **Beta hardening 14-15** | PRs ~#43-#100 | Insurance + Equipment + Beta.15 alerts/notifications EWS-driven (outbox) | ✅ |
| 8 | **F2-S7 GS1 Bedside** | PRs hasta #125 (2026-05-18) | 15 streams paralelos, BCMA 5R + GSRN pulsera + Drug.allergyExcipients ALTER | ✅ |
| 9 | **Fase 2 completa (7 sprints)** | PRs #134, #139, #149 (2026-05-18) | F2-S14 GS1 modos especiales + F2-S15 Cumplimiento + F2-S16 Workflow Designer; ~1005 SP / 580 US | ✅ |
| 10 | **Audit + Remediation S0-S8** | PRs #160-#210 (2026-05-19) | 10 streams auditados (A-J, 271 hallazgos, 52 P0) + 9 sprints S0-S8 con **50 P0 cerrados** | ✅ |
| 11 | **Workflow Designer Fases 1-6** | PRs #211-#218 | Motor ECE data-driven: editor visual, versionado, simulador, plantillas, BPMN export | ✅ |
| 12 | **Fase JCI Planning** | PR #220 | Gap assessment 7th Edition (`docs/32_*`), planning maestro (`docs/33_*`), 20 épicas / 807 SP / 3 releases | ✅ |
| 13 | **Fase 4 IPSG arranque** | PR #221 | Schema `ipsg.*` + skeletons routers IPSG.1/2/3/6 + UI base + compliance fixtures | ✅ |

**Volumen acumulado estimado**: ~221 PRs mergeados, ~1700 SP, ~580 US, ~34 módulos cubiertos (30 NTEC + 4 JCI iniciados), 19+ rutas tRPC, ~3343 líneas de `schema.prisma` y >35 archivos SQL en `packages/database/sql/`.

---

## 3. Sprint 0 + Roadmap JCI (próximos 9 meses)

Tomado y resumido desde `docs/33a_jci_releases_y_roadmap.md`. Fechas calendarizadas suponen aprobación Go/No-Go del Sponsor al **2026-05-31** y arranque inmediato.

| Sprint / Release | Ventana | SP | Foco | Outcome esperado | Gate |
|---|---|---|---|---|---|
| **Sprint 0 — Deuda técnica** | 2026-06-09 → 06-22 (2 sem) | ~30 | Elevar coverage 72% → ≥80%, job `compliance.yml`, 7 test users JCI, fixtures base, fix 42 errores TS preexistentes | Typecheck verde + coverage ≥80% + compliance job pasante | G0 JCI |
| **JCI-1.0 — Brechas críticas** | 2026-06-23 → 2026-08-31 (3 meses, S1-S6) | ~514 | PCI vigilancia (E-01/14), PFE educación (E-02), SQE credentialing (E-04), IPSG.1-6 (E-05), MMU trazabilidad (E-07), QPS riesgo (E-09), evaluación inicial (E-11), cirugía segura refuerzo (E-16), derechos paciente (E-06) | PCI 95%, PFE 90%, SQE 90%, IPSG 100%, MMU 95%, PFR 95%; **Mock Survey parcial 2026-09-15** | G3-G5 JCI |
| **JCI-2.0 — Completitud** | 2026-09-01 → 2026-11-30 (3 meses, S4-S9) | ~227 | Dashboard QPS completo (E-03), continuidad asistencial (E-08), higiene de manos digital (E-10), equipamiento (E-12), capacitación (E-13), lab cierre de loop (E-17), comunicación resultados (E-18) | QPS 90%, COP completo, SQE.3/8, FMS.8 parcial, IPSG.2; **Mock Survey completo 2026-12-15** | G6-G7 JCI |
| **JCI-3.0 — Deseables + Encuesta oficial** | 2026-12-01 → 2027-02-28 (3 meses + 4 sem hipercuidado, S6-S10) | ~66 | Gestión documental (E-15), preparación emergencias (E-19), satisfacción paciente (E-20); Mock Survey final 3-day simulation S8; correcciones S9; **encuesta JCI oficial S10** | Todos capítulos ≥85%; **Encuesta JCI 2027-02-09 → 02-13**; acreditación notificada 2027-03-30 | G8 JCI (acreditación) |

**Total**: ~898 SP / 40 semanas / 4 devs / ~9 meses + 1 mes hipercuidado. Costo externo estimado USD 80-130K (consultor JCI Mock Surveys USD 30-50K + tasas JCO USD 50-80K). Costo interno desarrollo: validar con @PO.

---

## 4. Deuda y riesgos no asignados (backlog táctico pre-Sprint 0)

Hallazgos detectados en auditorías Stream A-J (cierre 2026-05-19), audits funcionales y carry-overs Fase 2 que NO entran automáticamente en Sprint 0 ni en JCI-1.0 y requieren decisión explícita del @PO sobre dónde alojarlos.

| ID | Origen | Severidad | Descripción | Impacto si se difiere | Sugerencia @PO |
|---|---|---|---|---|---|
| **HC-001** | Audit Stream B clínico | P0 | Historia clínica ambulatoria — **sin UI ni router** pese a estar declarada en TDR §11 y mapeada AOP.1 | Bloquea consulta externa NTEC + JCI AOP.1; brecha de cobertura clínica ambulatoria | Incluir en Sprint 0 (split UI/router) o stream paralelo JCI-1.S1 |
| **HC-002** | Audit Stream B clínico | P0 | Validaciones cruzadas HC ambulatoria ausentes | Idem HC-001; sin UI no aplica | Incluir junto a HC-001 |
| **HF-URPA-01** | Audit Stream E quirófano | P0 | `darAlta` en URPA actualmente ejecutable por rol `NURSE`; debe requerir rol `ANESTESIOLOGIST` + criterios Aldrete | Riesgo clínico de alta prematura post-anestesia; brecha ASC.5 | Hotfix pre-Sprint 0 (rol guard + criterios) |
| **HF-10 ALTER eventos** | Audit Stream F obstetricia | P1 | ALTER de columnas `events_eventotipo` en `ece.sala_expulsion` pendiente de aplicar en Supabase prod | Sin evento outbox del flujo expulsión no se sincronizan tableros QPS futuros | Aplicar via `mcp__supabase__apply_migration` en ventana baja, agregar a `db-migrate.yml` |
| **RECT router/UI** | Audit Stream G NTEC | P1 | Rectificación de expediente (NTEC §25, MOI.12) — schema existe, **router y UI no implementados** (drift Fase 1) | Sin rectificación no se atiende artículo 25 NTEC ni MOI.12 JCI; auditores observan | Incluir en JCI-1.S2 (cross-cutting MOI) o backlog Beta.16 |
| **Stream J HJ-04** | Audit Stream J admin/seguridad | P0 | Bitácora acceso PHI — campo `motivoAcceso` opcional cuando debe ser obligatorio | Brecha MOI.2 / Art. 47 NTEC; bitácora incompleta | Resolver pre Sprint 0 (validación Zod + migración) |
| **Stream J HJ-06** | Audit Stream J | P0 | Break-glass — falta workflow de revisión post-uso por compliance | Riesgo de abuso silencioso del bypass RLS | Resolver pre Sprint 0 (job nightly + alerta) |
| **Stream J HJ-20** | Audit Stream J | P0 | Rotación de claves PIN argon2id sin política de expiración | Brecha SQE.3 / NIST 800-63B; PIN eternos | Resolver pre Sprint 0 (política + cron rotación) |
| **Stream J HJ-30** | Audit Stream J | P0 | TOTP MFA — sin rate-limit en verificación | Riesgo brute-force; brecha JCI MOI.2 | Resolver pre Sprint 0 (middleware) |
| **Stream J HJ-31** | Audit Stream J | P0 | Sesiones — sin auto-logout configurable por org | Brecha NTEC + best practice HIPAA | Resolver pre Sprint 0 (config + UI admin) |
| **Re-audits A-J** | Ola 1 (en curso) | Operacional | Re-validar streams A-J post-remediation (50 P0 cerrados) — verificar no regresión | Si hay regresión silenciosa, Sprint 0 arranca con deuda oculta | En curso branch `chore/ola1-re-audits-y-docs`; entregable antes 2026-06-09 |
| **Stream K audit** | Ola 1 (en curso) | Operacional | Audit nuevo stream K (módulos no cubiertos en A-J: workflow designer + ECE bridge) | Sin auditar, calidad workflow ECE no verificada formalmente | Ola 1 — entregable antes 2026-06-09 |

**Estimación deuda no asignada**: ~25-35 SP (~5-7 P0 + 2 P1 + 2 operacionales). **Cabe en Sprint 0** si se priorizan los 5 hallazgos Stream J P0 + HF-URPA-01 + HC-001/002 split (skeleton). HF-10 ALTER puede aplicarse independiente fuera de sprint.

---

## 5. Cobertura JCI proyectada (gráfico ASCII)

Cobertura porcentual por capítulo JCI 7th Edition, antes y después de cada release. Fuentes: `docs/32_gap_jci_assessment.md` (baseline) + `docs/33a_jci_releases_y_roadmap.md` (outcomes).

```
Capítulo  | Pre-S0   | Post JCI-1.0 | Post JCI-2.0 | Post JCI-3.0
----------+----------+--------------+--------------+----------------
IPSG      | #######  |    ########  |    ########  |    #########   (~83%->100%->100%->100%)
ACC       | #######  |    #######   |    #########  |    #########   (~85%->85%->95%->95%)
PFR       | #######  |    ########  |    ########  |    #########   (~80%->95%->95%->95%)
AOP       | #######  |    ########  |    ########  |    #########   (~85%->90%->95%->95%)
COP       | #######  |    ########  |    #########  |    #########   (~80%->90%->95%->95%)
ASC       | ########  |    ########  |    ########  |    #########   (~90%->90%->95%->95%)
MMU       | #######  |    #########  |    #########  |    #########   (~85%->95%->95%->95%)
PFE       | #         |    ########  |    ########  |    #########   (~10%->90%->90%->95%)
QPS       | ###      |    ######    |    #########  |    #########   (~40%->60%->90%->95%)
PCI       | #         |    #########  |    #########  |    #########   ( ~5%->95%->95%->95%)
GLD       | ######   |    ######    |    #######   |    ########    (~60%->60%->75%->85%)
SQE       | ###      |    #########  |    #########  |    #########   (~35%->90%->95%->95%)
MOI       | #########  |    #########  |    #########  |    #########   (~95%->95%->95%->95%)
FMS       | n/a      |    n/a       |    ######    |    ########    (no software ->parcial->85%)
MPE       | n/a      |    n/a       |    n/a       |    n/a         (no aplica)
HRP       | n/a      |    n/a       |    n/a       |    n/a         (no aplica)

Leyenda: cada # ≈ 10% cobertura. Capítulos n/a no se evalúan.
Objetivo acreditación: TODOS los capítulos aplicables ≥85% al cierre JCI-3.0.
```

**Brechas críticas que cierran**: PCI (5%→95%), PFE (10%→90%), QPS (40%→90%), SQE (35%→90%). Estas 4 son las que justifican la inversión y el cronograma de 9 meses.

---

## 6. Hitos clave (timeline maestro)

| Hito | Fecha | Responsable | Dependencias / Gate |
|---|---|---|---|
| **Aprobación Go/No-Go Sponsor** | 2026-05-31 | CEO | Lectura de `docs/33_fase_jci_planning.md` + decisión sobre USD 80-130K externos |
| **RFP consultor JCI certificado** | 2026-06-01 → 06-14 | CMO + Compras | Lista corta: DNV / JCO directo / Joint Commission Resources |
| **Contratación consultor JCI** | 2026-06-15 | CMO | RFP cerrado; contrato firmado pre-Sprint 0 |
| **Sprint 0 deuda técnica arranca** | 2026-06-09 | @QA + @Dev | Aprobación Sponsor; backlog deuda alojado |
| **Sprint 0 cierra (G0 JCI)** | 2026-06-22 | @QA | Coverage ≥80% + compliance job verde + 42 TS errors fix |
| **JCI-1.S1 arranca** | 2026-06-23 | @Orq | Sprint 0 cerrado; primera épica E-05 IPSG por WSJF |
| **Firma convenio JCO** | Pre 2026-12-01 | CEO + JCO | Pago tasa aplicación; carta intención |
| **JCI-1.0 cierra (G5 JCI)** | 2026-08-31 | @Orq | 514 SP entregados; PCI/PFE/SQE/IPSG ≥90% |
| **Mock Survey parcial** | 2026-09-15 | Consultor JCI | JCI-1.0 cerrado; auditor externo verifica capítulos PCI/PFE/SQE/IPSG/MMU |
| **JCI-2.S4 arranca** | 2026-09-01 | @Orq | Solapamiento con Mock parcial (2 semanas paralelas) |
| **JCI-2.0 cierra (G7 JCI)** | 2026-11-30 | @Orq | 227 SP entregados; QPS dashboard + COP + SQE.3/8 + FMS.8 |
| **Mock Survey completo** | 2026-12-15 | Consultor JCI | TODOS capítulos Must cerrados; decisión Go/No-Go encuesta oficial |
| **JCI-3.S6 arranca** | 2026-12-01 | @Orq | Deseables E-15/19/20 |
| **Mock Survey final (3-day simulation)** | 2027-01-19 | Consultor JCI | Simula encuesta oficial completa |
| **Encuesta JCI oficial** | **2027-02-09 → 02-13** | **JCO evaluadores** | Aplicación firmada + Mock final aprobado + plan correctivo |
| **Hipercuidado + acciones correctivas** | 2027-02-16 → 02-28 | @Orq + @SRE | Findings encuesta resueltos antes notificación oficial |
| **Acreditación notificada** | **2027-03-30 (estimado)** | JCO | Resultado encuesta + corrección; **acreditación 3 años con re-survey** |

---

## 7. Recomendación de prioridad inmediata (orden de ejecución)

Como @PO, ante 12 deudas no asignadas + Sprint 0 + arranque Fase JCI, recomiendo la siguiente secuencia **antes del 2026-06-23 (inicio JCI-1.S1)**:

1. **(BLOQUEANTE — semana 22-23 mayo)** Cerrar Ola 1 en curso: re-audits A-J + audit Stream K en branch `chore/ola1-re-audits-y-docs`. Sin esto, Sprint 0 arranca con deuda oculta y métrica de calidad sesgada.

2. **(P0 seguridad — pre Sprint 0)** Resolver los 5 hallazgos Stream J P0 (HJ-04/06/20/30/31). Son brechas de bitácora PHI, break-glass, rotación PIN, MFA rate-limit y auto-logout — riesgo regulatorio NTEC y JCI MOI.2 si se difieren. Estimación 8-10 SP. Cabe en una iteración de 1 semana del equipo de seguridad.

3. **(P0 clínico — pre Sprint 0 hotfix)** HF-URPA-01 — rol guard `ANESTESIOLOGIST` + criterios Aldrete en `darAlta` URPA. Riesgo clínico real (alta post-anestesia prematura). Estimación 3 SP. Hotfix 1-2 días @Dev.

4. **(Sprint 0 — 2 semanas 2026-06-09 → 06-22)** Ejecutar el Sprint 0 declarado en `docs/33a_jci_releases_y_roadmap.md`: coverage ≥80%, compliance job, fixtures JCI, 7 test users, fix 42 TS errors. **Adicionalmente** alojar HC-001/002 (skeleton router + UI mínima) para no llegar a JCI-1.S1 con un módulo TDR §11 sin estructura.

5. **(JCI-1.S1 — 2026-06-23)** Arrancar con épica **E-05 IPSG.1-6** (89 SP) por WSJF: ya hay base en PR #221, ROI alto en seguridad paciente, cobertura cruzada IPSG.2/3/5/6 que impacta auditores. Paralelizar con E-01 PCI (vigilancia básica) y E-04 SQE (credentialing).

6. **(JCI-1.S2 — 2026-07-07)** Incluir **RECT router/UI** dentro del cross-cutting MOI ya planificado (épica E-15 mueve parcialmente a JCI-1 desde JCI-3, o se hace mini-épica MOI bridge). Resuelve drift Fase 1 sin abrir release adicional.

**Decisión que pido al Sponsor / @Orq**: aprobar items 1-3 como pre-requisitos del Sprint 0 (deuda táctica) y respaldar la priorización WSJF de IPSG como primera épica JCI. Si el presupuesto consultor JCI no se aprueba en 2026-05-31, el cronograma se desplaza ≥4 semanas (RFP requiere mínimo 2 sem + onboarding 2 sem) y la encuesta oficial 2027-02 deja de ser viable.

---

## 8. Referencias

| Doc | Contenido | Uso |
|---|---|---|
| `docs/06_roadmap.md` | Roadmap original 20-22 meses Fase 0-7 | Contexto histórico; este doc 34 lo supera para horizonte JCI |
| `docs/13_g0_closure_log.md` | Cierre G0 Sprint 0 inicial; gaps RLS+FK | Lecciones pagadas |
| `docs/26_trazabilidad_matrix.md` | Matriz trazabilidad Fase 2 | Base para `33d` |
| `docs/27_coverage_baseline.md` | Baseline coverage 72% | Punto de partida Sprint 0 deuda |
| `docs/31_flujos_operativos_consolidado.md` | Flujos NTEC consolidados | Insumo workflow designer + ECE |
| `docs/32_gap_jci_assessment.md` | Gap assessment JCI 7th Edition (16 capítulos) | Fuente de cobertura % de §5 de este doc |
| `docs/33_fase_jci_planning.md` | Planning maestro Fase JCI (governance + decisión Go) | Padre operativo de este doc |
| `docs/33a_jci_releases_y_roadmap.md` | 3 releases JCI-1.0/2.0/3.0 con SP y fechas | Fuente de §3 y §6 de este doc |
| `docs/33b_jci_backlog.md` | 20 épicas + ~100 US Gherkin | Detalle backlog JCI |
| `docs/33c_matriz_trazabilidad_jci.md` | JCI standard → US → test case → estado | Base para auditoría JCI |
| `docs/33d_matriz_trazabilidad_proyecto.md` | Matriz consolidada TDR + NTEC + JCI + US + tests | Vista 360° del proyecto |
| `docs/audit/2026-05-19_*.md` (10 streams) | Auditorías Stream A-J (271 hallazgos / 52 P0) | Fuente §4 deuda no asignada |
| `docs/audit/2026-05-19_consolidacion_top15_p0_p1.md` | Top 15 P0+P1 consolidados | Priorización inicial Ola 1 |
| `docs/audit/2026-05-24_re-audit_stream_a.md` | Re-audit Stream A en curso (Ola 1) | Verificación remediation S0-S8 |
| `TDR_HIS_Multipais.md` | Términos de Referencia (1923 líneas / 30 módulos) | Fuente regulatoria base |
| `CLAUDE.md` | Guía operativa codebase + reglas "adecuar legacy no duplicar" | Restricción de diseño JCI sobre legacy |

---

> **Próxima revisión**: 2026-06-09 (arranque Sprint 0) — actualizar §2 con items 11-13 cerrados, §4 con deuda resuelta, §7 con priorización ejecutada. Mantenedor: @PO. Aprobador final del documento: @Orq + Sponsor.
