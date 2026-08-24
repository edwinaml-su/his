# 44 — Plan de remediación por sprints (backlog priorizado)

| Campo | Valor |
|---|---|
| Fecha | 2026-08-21 |
| Autor | @Orq (SDLC autónomo) |
| Insumos | Assessment Code Castle SD-AVANTE-12082026 · verificación directa del repo y de la BD de producción el 2026-08-21 |
| Estado | Propuesta — pendiente de aprobación de Edwin |

## 1. De dónde sale este backlog

Tres fuentes, todas verificadas contra el código y la BD reales el 2026-08-21 (no contra lo que afirman los documentos):

1. **Matriz de riesgos R01–R10** del assessment externo de Code Castle.
2. **Observaciones de dominio** del mismo assessment que no entraron en la matriz.
3. **Deuda propia ya conocida** registrada en `CLAUDE.md`, `docs/runbooks/` y los CC 0001–0021.

Lo ya cerrado no vuelve a entrar: **R01, R04 y R07** quedaron resueltos en el PR #547 (merge 2026-08-20) y así se verificó.

## 2. Criterio de priorización

En este orden, y con este peso:

1. **Riesgo clínico directo** — puede dañar a un paciente o falsear su expediente.
2. **Riesgo de aislamiento de datos** — un tenant puede ver datos de otro.
3. **Capacidad de verificar** — sin esto no se puede *demostrar* que lo demás quedó bien.
4. **Deuda estructural** — encarece cada sprint siguiente mientras siga abierta.
5. **Preparación de go-live** — necesario para producción, pero no bloquea el desarrollo.

**La consecuencia más importante de este criterio:** R08 (E2E permisivos) figura como «Alta» en el assessment, pero funcionalmente es un **habilitador**. Sin E2E determinístico no se puede certificar ningún circuito clínico — ni siquiera los tres riesgos que ya damos por cerrados. Por eso su bloqueador raíz sube a Sprint 0 en vez de esperar al final.

## 3. Backlog priorizado

| # | Ítem | Origen | Sev. | Evidencia verificada (2026-08-21) | Gate de cierre |
|---|---|---|---|---|---|
| P0-1 | Seed de usuarios E2E contra GoTrue falla con `500 Database error checking email` | Deuda propia | Bloqueante | @smoke nunca ha corrido contra auth real; las 54 specs no certifican nada | @smoke verde en un PR, con las specs ejecutando de verdad |
| P0-0 | `authenticated` no puede escribir el audit log | Hallazgo 2026-08-22 | **Bloqueante de R02** | `has_table_privilege('authenticated','audit."AuditLog"','INSERT') = false`; única policy es `auditlog_tenant_select`. `emitDomainEvent` hace `tx.auditLog.create` dentro de la transacción, así que **toda ruta de escritura demotada revierte**. `public."DomainEvent"` tiene 0 filas | GRANT + policy de INSERT, o generalizar el patrón de `encounter-discharge.router.ts` (audit fuera de la tx demotada) |
| P0-2 | RLS no homogéneo entre routers | **R02** (Crítica, *parcial*) | Crítica | **38 de 153 routers** sin contexto RLS. (Corrección 2026-08-22: el conteo inicial de 57 incluía 19 falsos positivos que sí usan `withWorkflowContext`, un contexto ECE real con `SET LOCAL ROLE authenticated`.) No es «38 por migrar» sino **38 por triar**: varios deben conservar privilegio con justificación escrita — `break-glass.activate`, `audit.listOrgChanges`, `rbac`, `user-admin`, `user-service-unit` ya se resolvieron así con evidencia | Cada router con decisión tomada y justificada; 0 rutas PHI sin contexto ni justificación |
| P0-5 | El GUC de establecimiento ECE apunta a dos espacios de ids | Hallazgo 2026-08-22 | Crítica | `ece.paciente.establecimiento_id` → `public."Establishment"`; `ece.episodio_atencion`, `personal_salud`, `orden_ingreso`, `fall_event` → `ece.establecimiento`. Un solo `app.ece_establecimiento_id` no satisface ambos: con el id que manda la app, `ece.paciente` devuelve 127 filas y `episodio_atencion` **0** | Dominio de id unificado; los routers ECE demotados devuelven filas |
| P0-3 | Tablas `ece.*` sin RLS habilitado | R02 (extensión) | Crítica | 7 de 109: `epcis_event`, `epcis_event_equipment`, `catalogo_cpt`, `lasa_pair`, `pediatric_max_dose`, `workflow_estado_layout`, `workflow_plantilla` | RLS habilitado con policy tenant; los EPCIS primero (traen movimiento de paciente, ADR 0019) |
| P0-4 | Admisión se confirma aunque falle la creación en ECE | Dominio A | Crítica | `lib/ece-hooks.ts`: «Nunca lanzan — los errores se loguean y el caller continúa (non-fatal)» | Decisión explícita fail-fast u outbox compensatorio + test del camino de fallo |
| P1-1 | Identidad HIS↔ECE sin resolución canónica | **R03** (Alta) | Alta | 107 subqueries `his_user_id` dispersas en 48 archivos; no existe resolver en `packages/trpc/src/lib/` | Helper único + 0 subqueries ad-hoc |
| P1-2 | Modelos quirúrgicos paralelos | **R05** (Alta) | Alta | `surgery` (SurgeryCase) y `eceCirugiaPreop`/`eceRegistroAnestesico`/`eceUrpa` siguen ambos en `_app.ts` | Fuente de verdad declarada en un ADR + duplicado retirado o bridge explícito |
| P1-3 | E2E permisivos / tolerantes a rutas inexistentes | **R08** (Alta) | Alta | 17 de 54 specs con `test.skip`/`fixme` (37 ocurrencias); 9 con «tolerancia» explícita | Cada circuito crítico con 1 E2E feliz + 1 negativo hard-stop, sin skips condicionales |
| P1-4 | Tests de `@his/ui` invisibles para CI | Deuda propia | Alta | `packages/ui/package.json` no declara script `test`; `turbo run test` lo omite en silencio | Script `test` presente y sus tests contados en la corrida de CI |
| P1-5 | Divergencia schema Prisma ↔ SQL | **R09** (Alta) | Alta | 240 archivos SQL vs 249 modelos Prisma; el tarifario completo (4 tablas) es SQL-only | Política escrita + registro formal de tablas SQL-only con su justificación |
| P1-6 | Dataset farmacológico provisional | **R06** (Alta) | Alta | `pharmacy.router` carga `seed/drug-interactions.json` (estático, Wave 1) | Fuente farmacológica licenciada integrada, o riesgo aceptado y firmado por dirección médica |
| P2-1 | Catálogo sin precio estándar | Deuda propia (CC-0021) | Media | **1,440 de 1,440** filas de `LabTest` con `standardPrice` NULL; `categoryId` sin poblar | Precios cargados + estudios clasificados → «DrSV - IMAGENES» cotiza |
| P2-2 | `ece.gs1_gln` vacío | GS1 / ADR 0019 | Media | 0 filas en producción | GLN sembrados por establecimiento |
| P2-3 | Gobierno de producto | **R10** (Alta, *parcial*) | Media | 21 CCs formales en `docs/CC/` — el control de cambios existe; falta la capa de gobierno | Comité de cambios con cadencia y criterio de aceptación de CC |
| P2-4 | 10 PRs de Dependabot abiertos | Deuda propia | Baja | #507–#513, #535–#539 | Cada uno mergeado o cerrado con criterio explícito |
| P2-5 | Pentest externo no ejecutado | Deuda propia | Media | `docs/pentest/` sigue en evaluación de proveedor (candidatos A/B/C genéricos) | Proveedor contratado y engagement ejecutado |
| P2-6 | UAT clínico, capacitación y carga de catálogos | Go-live | Media | Pendiente desde el cierre de Fase 2 | Actas de UAT firmadas por usuario clínico |

## 4. Sprints

Sprints de 2 semanas. **Supuesto de capacidad:** el modelo actual (Edwin + agentes SDLC), no el equipo de 15–17 personas que propone Code Castle. Si se contrata ese equipo, los sprints 1–6 se paralelizan y el calendario se comprime a la mitad; el **orden** no cambia.

### Sprint 0 — Desbloquear la verificación (1 semana)
Nada de lo que sigue se puede certificar mientras no haya E2E que corra de verdad.

- P0-1 seed GoTrue → @smoke verde.
- P1-4 script `test` en `@his/ui`.
- P2-4 barrido de los 10 PRs de Dependabot.
- Commitear el WIP de k6 (PERF-001) que hoy vive sin push en `fix/health-check-rls`.

**Gate:** CI ejecuta y reporta E2E reales; ningún workspace con tests invisibles.

### Sprints 1–2 — Aislamiento multi-tenant (R02 + R03)
El riesgo con mayor impacto regulatorio: un tenant viendo datos de otro es un incidente reportable.

- Sprint 1: inventario de los 57 routers clasificados por sensibilidad (PHI → admin → catálogo); migrar el lote PHI a `withTenantContext` con test de aislamiento por router. P0-3 RLS en `ece.epcis_event*`.
- Sprint 2: lotes admin y catálogo; RLS en las 5 tablas `ece.*` restantes.

**Gate:** 0 routers con PHI fuera de contexto RLS; advisor de Supabase sin `rls_enabled_no_policy` en tablas con datos clínicos.

### Sprint 3 — Integridad transaccional ADT↔ECE (P0-4)
- Decidir el contrato: ¿la admisión falla si ECE falla, o se compensa por outbox? Es una decisión de negocio, no técnica — requiere a Edwin.
- Implementar y probar el camino de fallo, que hoy no tiene test.

**Gate:** no existe estado donde una admisión confirmada carezca de episodio ECE sin alerta operativa.

### Sprint 4 — Identidad canónica (P1-1)
- `identity-resolver.ts`: mapeo único `User` ↔ `ece.personal_salud`.
- Migrar los 48 archivos; prohibir la subquery ad-hoc por lint o revisión.

**Gate:** 0 ocurrencias de `his_user_id` fuera del resolver.

### Sprint 5 — Consolidación quirúrgica (P1-2)
- ADR con la fuente de verdad (SurgeryCase vs `ece.*`).
- Consolidar o bridge explícito; retirar el camino muerto y redirigir la UI.

**Gate:** un solo router expuesto por operación quirúrgica.

### Sprint 6 — E2E determinísticos + circuito de farmacia (P1-3)
- Reescribir los 17 specs tolerantes.
- Implementar el *Definition of Done* de farmacia que exige Code Castle: prescribe → firma → farmacia valida lote/stock → dispensa → enfermería identifica → escanea → administra → eMAR → auditoría, con al menos un negativo hard-stop.

**Gate:** el circuito de farmacia demostrado end-to-end en CI, no por pantallas.

### Sprint 7 — Deuda estructural y datos (P1-5, P1-6, P2-1, P2-2)
- Política de drift Prisma↔SQL y registro formal.
- Decisión sobre la fuente farmacológica: licenciarla o aceptar el riesgo por escrito.
- Cargar precios de catálogo y clasificar estudios; sembrar `ece.gs1_gln`.

**Gate:** ningún módulo clínico dependiendo de datos declarados «provisionales».

### Sprint 8 — Preparación de producción (P2-3, P2-5, P2-6)
- Pentest externo, performance k6, UAT clínico, capacitación, gobierno de cambios.

**Gate:** Release Candidate con actas de UAT firmadas.

## 5. Lo que este plan NO resuelve

- **La estimación de madurez del 35–40%** de Code Castle no se validó ni se refutó aquí: medirla exige ejecución real de la plataforma con usuarios clínicos, que es justamente su Fase 0.
- **Funcionalidad nueva.** Este backlog es de remediación. Cada CC nuevo que entre (como CC-0021, que no cierra ningún riesgo del assessment) compite con estos sprints por la misma capacidad — que es precisamente lo que R10 señala como patrón a gobernar.
- **Decisiones de negocio** que bloquean sprints concretos: el contrato transaccional ADT↔ECE (Sprint 3), la fuente de verdad quirúrgica (Sprint 5), la compra de la fuente farmacológica y los precios del catálogo (Sprint 7).
