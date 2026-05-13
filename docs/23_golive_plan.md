# Plan de Go-Live — HIS Avante Wave 1

**Owner:** @PO (lead) + @SRE + @QAF
**Versión:** 1.0 · 2026-05-13
**Estado:** Diseño (NO ejecutable hasta cierre de Bloque 1)
**Bloqueante operativo:** Bloque 1 manual de Edwin (credenciales rotadas, vercel env, branch protection)
**Hospital piloto candidato:** Complejo Avante El Salvador (sede principal). Justificación operativa al final.

> Este plan complementa `docs/18_golive_checklist.md`. La checklist es la
> herramienta de verificación tick-by-tick durante el cutover; este documento
> es la planeación estratégica que la antecede y acompaña.

---

## 1. Objetivos del Go-Live

1. Habilitar producción del HIS Wave 1 en hospital piloto sin interrupción de servicio asistencial > 2 h.
2. Lograr adopción por el 100% del personal clínico del piloto a más tardar T+7d.
3. Mantener disponibilidad ≥ 99.5% durante los primeros 30 días (SLO MVP).
4. Cierre del periodo de hipercuidado con KPIs verdes y < 0.5 tickets/usuario/día.

## 2. Alcance del Wave 1

### 2.1 Incluido en este Go-Live

| Sección | Módulo | Estado |
|---|---|---|
| §1-§9 | Plataforma base, MPI, ADT, RBAC/ABAC, audit, encounter, triage, admission | Productivo |
| §10 | Atención ambulatoria (CPOE outpatient, schedule, slot, appointment, medical leave) | Productivo |
| §11 | Hospitalización (inpatient admission/vitals/kardex/care plan) | Productivo |
| §12 | Emergencias (Manchester triage, dashboard, flowcharts) | Productivo |
| §13 | Cirugía (timeout, surgical safety checklist) | Productivo |
| §14 | EHR Notes (SOAP, addendum hash-chain, CIE-10) | Productivo |
| §15 | Pharmacy (CPOE, validación 4-eyes, eMAR, libro DNM) | Productivo |
| §16 | eMAR (5R, doble verificación, idempotencia) | Productivo |
| §17 | LIS (orden, especimen, validación 4-eyes, valores críticos) | Productivo |
| §18 | RIS/PACS skeleton (imaging order/study) | Productivo |
| §19 | Inventario (stock, reposición) | Productivo |
| §20 | Servicios y equipos | Productivo |
| §21 | Respiratorio (vent settings, weaning) | Productivo |
| §22 | Nutrición (dietary order, balance) | Productivo |
| §25 | Insurance (eligibility, authorization, claim) | Productivo |

### 2.2 Excluido / Diferido a Wave 2

- §23 DTE Hacienda (ADR 0006 en diseño)
- §24 Multi-ledger Accounting (ADR 0007 en diseño)
- §26 BI/Reporting semantic layer (plan en `docs/25_bi_plan.md`)
- Pyxis/DERS, mezclas IV, farmacovigilancia
- Integración HL7 FHIR full (Wave 1 sólo stubs y projections)
- Telemedicina sincrónica

## 3. Pre-requisitos antes de T-7d

### 3.1 Técnicos (DevOps / SRE)

| ID | Item | Owner | Estado actual |
|---|---|---|---|
| PR-1 | Rotación de 5 credenciales (DATABASE_URL, SUPABASE_*, NEXTAUTH_SECRET, AUDIT_HASH_SECRET, TSA_PROVIDER_KEY) | Edwin | Pendiente (Bloque 1) |
| PR-2 | Branch protection en `main`: required reviews=1, status checks=ci/all | Edwin | Pendiente (Bloque 1) |
| PR-3 | Vercel env `production` poblado con todas las variables del manifiesto | Edwin | Pendiente (Bloque 1) |
| PR-4 | Backup completo prod + restore validado en sandbox | @SRE | Programado T-10d |
| PR-5 | PITR Supabase con drill (restore < 4h) | @SRE | Programado T-10d |
| PR-6 | Pen-test reciente (≤ 90 días) sin findings críticos abiertos | @AE | Programado T-21d |
| PR-7 | DPIA firmada (Data Protection Impact Assessment) | @AE | Programado T-14d |

### 3.2 Operativos (Clinical Lead / PO)

| ID | Item | Owner | Estado actual |
|---|---|---|---|
| PR-8 | Designación de super-usuarios (≥ 1 por turno y servicio) | Clinical Lead | Programado T-21d |
| PR-9 | Plan de contingencia en papel impreso y firmado por jefes de servicio | @PO | Programado T-7d |
| PR-10 | Stakeholders notificados con T-7d/T-1d/T+0 (comms plan §5) | @PO | Cont. desde T-30d |
| PR-11 | Ensayo simulacro completo (dry-run) ejecutado con retros incorporadas | Todos | Programado T-3d |

### 3.3 Compliance

| ID | Item | Owner | Estado actual |
|---|---|---|---|
| PR-12 | RLS y ABAC validados (`docs/12_rls_validation.md`) | @DBA | Cerrado G0 |
| PR-13 | Acuerdos de tratamiento con aseguradoras vigentes | Legal Avante | Programado T-21d |
| PR-14 | Capacitación en privacidad / HABEAS DATA archivada | RRHH | Programado T-14d |

## 4. Timeline diario T-7d a T+1

### T-7d (sábado, una semana antes)

- 08:00 — Reunión de pre-go-live con jefes de servicio (presencial El Salvador).
- 10:00 — @SRE ejecuta backup completo + restore validado en sandbox.
- 12:00 — @QAF inicia última iteración de pruebas de regresión Phase 2.
- 14:00 — @PO emite primer comunicado a stakeholders externos (aseguradoras, MINSAL, ISSS).
- 16:00 — Distribución de plan de contingencia en papel a cada estación.
- Cierre: reporte de estado T-7d publicado en `#golive-his`.

### T-5d (lunes)

- Capacitación intensiva últimos rezagados (LMS + presencial).
- @SRE valida monitores Better Uptime, Sentry, Vercel Analytics en stage.
- @QAF firma reporte de pruebas exploratorias (3 días intensivos).

### T-3d (miércoles)

- 08:00 — Dry-run completo del cutover en stage con cronometraje.
- 14:00 — Retro del dry-run; ajustes al runbook (`docs/24_cutover_runbook.md`).
- 18:00 — Reporte LMS preliminar: ≥ 90% personal certificado.

### T-1d (viernes víspera)

- 09:00 — Code freeze formal declarado y comunicado.
- 11:00 — @SRE ejecuta checklist automatizado completo (`scripts/golive-checklist.sh`).
- 14:00 — Reporte final de capacitación firmado por RRHH.
- 16:00 — Confirmación de personal SRE/Dev/Clinical on-site.
- 17:00 — War room reservado (sala física El Salvador + Zoom puente).
- 20:00 — Llamada con stakeholders críticos: Q&A y números de emergencia.

### T+0 (sábado del go-live)

| Hora | Actividad | Owner |
|---|---|---|
| 01:30 | Personal on-site reunido en sala de servidores y war room | Todos |
| 02:00 | `MAINTENANCE_MODE=true` activado; banner mostrado | @SRE |
| 02:05 | Backup final pre-cutover etiquetado `pre-golive-final` | @SRE |
| 02:15 | Migración de datos legacy (idempotente, dry-run T-3d) | @DBA |
| 02:45 | Validación de conteos vs origen (pacientes, episodios, usuarios) | @DBA + @QAF |
| 03:00 | Promoción del deploy: `vercel promote <id> --prod` | @SRE |
| 03:10 | DNS warm-up + cache purge CDN | @SRE |
| 03:20 | Re-ejecución `scripts/golive-checklist.sh` — todo verde | @SRE |
| 03:30 | Smoke test guiado (Playwright + manual clínica) | @QA + @QAF |
| 03:45 | `MAINTENANCE_MODE=false`; sistema abierto a usuarios | @SRE |
| 03:50 | Comunicación de apertura a stakeholders y servicios | @PO |
| 04:00 | Cierre de ventana; war room queda en hipercuidado activo | Todos |

### T+1d (domingo)

- 08:00 — Healthcheck completo (G-OBS `docs/18_golive_checklist.md`).
- 12:00 — Reporte KPIs día 1 a Avante directiva.
- 14:00 — Triage de tickets recibidos; categorización y priorización.
- 20:00 — Backup post-go-live verificado; resumen de incidentes a stakeholders.

## 5. Comms Plan

### 5.1 Audiencias y canales

| Audiencia | Canal primario | Canal secundario | Cadencia |
|---|---|---|---|
| Directiva Avante (CEO, CMO, COO, CIO) | Email ejecutivo | WhatsApp directiva | T-30, T-14, T-7, T-1, T+0, T+1, semanal x4 |
| Jefe de servicio piloto El Salvador | Reunión presencial | WhatsApp | Semanal desde T-30; diario T-7 a T+7 |
| Médicos pilotos (n≈45) | Sesión informativa + LMS | Email + WhatsApp | T-21 kickoff; T-7 recordatorio; T+0 apertura |
| Enfermería piloto (n≈80) | Sesión informativa + LMS | Email + boletín físico | T-21 kickoff; T-7 recordatorio; T+0 apertura |
| Admisión piloto (n≈12) | Sesión informativa + LMS | Email | T-21 kickoff; T-7 recordatorio; T+0 apertura |
| MINSAL / ISSS | Carta oficial + email | Reunión presencial | T-30 notificación formal; T-7 confirmación |
| Aseguradoras | Email oficial | Llamada gerente cuenta | T-30 notificación; T-7 confirmación |
| Pacientes (vía consultorios) | Cartelera + WhatsApp consultorios | Pantallas auditorio | T-14 cartelera; T+0 banner sistema |

### 5.2 Plantillas (referencia)

Las plantillas viven en `docs/comms-templates/` (a crear en T-30d). Cada plantilla incluye:

- Subject / asunto
- Cuerpo en español neutro
- CTA (si aplica)
- Firma institucional

Mínimo: 8 plantillas (T-30 stakeholders externos, T-30 internos, T-7 internos, T-7 externos, T-1 internos, T+0 apertura, T+1 estado, T+7 cierre primera semana).

### 5.3 Escalamiento de incidentes

- Tier 1: super-usuario del servicio (responde < 5 min).
- Tier 2: equipo @SRE on-site / war room (responde < 15 min).
- Tier 3: comunicación a directiva si SEV1 / SEV2 confirmado > 30 min.

Detalle operativo en `docs/17_hipercuidado_runbook.md` §3.

## 6. Hospital piloto: justificación El Salvador

**Recomendación:** Complejo Avante El Salvador como primer sitio productivo.

### 6.1 Razones operativas

1. **Volumen manejable:** ~120 camas, ~45 médicos, ~80 enfermeras, ~12 admisionistas. Permite war room presencial sin saturar.
2. **Cercanía a equipo TI Avante:** decisor TI Edwin y stakeholder Clinical Lead operan desde San Salvador.
3. **Marco regulatorio uniforme:** un solo país, MINSAL + ISSS estándares ya cubiertos en SQL `03_validations_sv.sql`.
4. **Topología tenant simple:** una sola organización + 3-4 establecimientos del complejo.
5. **Cobertura de catálogos:** seed CIE-10, CUPS, ATC con énfasis SV completa.

### 6.2 Riesgos identificados

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Saturación del piloto con casos no contemplados | Media | Alto | Hipercuidado 14d intensivo |
| Resistencia al cambio de personal de noche | Alta | Medio | Tanda nocturna dedicada en F2 capacitación |
| Caída de conectividad región sa-east-1 | Baja | Alto | Failover documentado; modo papel listo |
| Rotación de personal post-capacitación | Media | Medio | Super-usuarios como mentores 30d |

### 6.3 Criterios para sumar segundo sitio

T+30d con KPIs verdes:

- Disponibilidad ≥ 99.5%
- Tickets críticos = 0
- Adopción ≥ 95% (medida por logins/día)
- Satisfacción usuario ≥ 4/5 en encuesta T+14d

Si se cumple → planificar Honduras o Guatemala en T+90d.

## 7. Plan de capacitación expandido (referencia)

Ver `docs/16_capacitacion_plan.md` actualizado v2 — cubre los 14 módulos Phase 2 nuevos con módulos específicos por rol:

- Roles ampliados: Pharmacist, Lab Technologist, Radiology Technologist, Inventory Clerk, Insurance Clerk.
- Por cada módulo Phase 2, screencast script de 3 min disponible en LMS.

## 8. Plan técnico de cutover (referencia)

Ver `docs/24_cutover_runbook.md` — detalla los comandos exactos, validaciones, rollback, métricas SLO.

## 9. Plan de hipercuidado post-Go-Live (referencia)

Ver `docs/17_hipercuidado_runbook.md` — cubre los 14 días siguientes con KPIs diarios y revisión semanal de retiro de hipercuidado.

## 10. Decisión Go/No-Go

### 10.1 Reglas

- Decisión por unanimidad de los 3 leads: @PO + Clinical Lead + @SRE Lead.
- Veto de cualquiera bloquea Go-Live; cita en T-1d 21:00.
- Si No-Go, replanificación a la siguiente ventana sábado (T+7).

### 10.2 Criterios para Go

1. Todos los items A.1 a A.4 del `docs/18_golive_checklist.md` en verde.
2. Capacitación ≥ 90% certificada.
3. Cero findings críticos pen-test abiertos.
4. Dry-run T-3d ejecutado sin incidentes mayores.
5. War room confirmado con personal completo.

### 10.3 Criterios para No-Go (cualquiera)

1. Pen-test con findings críticos no remediados.
2. Personal SRE/Dev/Clinical no disponible para war room.
3. Backup/PITR no validados.
4. Code freeze violado < 24h antes del cutover.
5. Sentry/Better Uptime no funcionales en stage.

## 11. Roles y responsabilidades (RACI extracto)

| Actividad | @PO | @SRE | @QAF | Clinical Lead |
|---|---|---|---|---|
| Aprobar Go/No-Go | A | R | C | R |
| Ejecutar cutover técnico | C | A/R | C | I |
| Validar smoke clínico | C | C | R | A |
| Comms stakeholders | A/R | C | I | C |
| Activar rollback | A | R | C | R |
| Cerrar hipercuidado | A | C | R | R |

A=Accountable, R=Responsible, C=Consulted, I=Informed.

## 12. Anexos y referencias

- `docs/18_golive_checklist.md` — checklist técnico-operativo
- `docs/24_cutover_runbook.md` — runbook técnico de cutover
- `docs/16_capacitacion_plan.md` — plan de capacitación v2
- `docs/17_hipercuidado_runbook.md` — runbook hipercuidado 14d
- `docs/15_production_runbook.md` — runbook producción general
- `docs/22_smoke_production.md` — suite smoke Playwright
- `docs/RELEASE_NOTES.md` — notas v0.2.0

---

**Fecha de próxima revisión:** T-14d antes de fecha de Go-Live definitiva (a confirmar por @PO y directiva Avante).
