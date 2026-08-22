# 46 — Gobierno de producto y control de cambios

| Campo | Valor |
|---|---|
| Fecha | 2026-08-22 |
| Autor | @PO |
| Responde a | R10 del assessment externo Code Castle (SD-AVANTE-12082026) — «Cambios funcionales frecuentes durante desarrollo», severidad Alta, tratamiento propuesto «Change control + Product Governance» |
| Insumos | `docs/CC/` (21 CCs reales) · `docs/CC/INVENTARIO_CAMBIOS.md` · `docs/44_plan_remediacion_sprints.md` (ítem P2-3) · ADR 0021 (caso PROG_QX/ACT_QX) · CLAUDE.md §Framework de trabajo |
| Estado | Propuesto — pendiente de aprobación de Edwin |

## 0. Qué no es este documento

No reemplaza el control de cambios que ya existe y funciona (21 CCs disciplinados: REQ → rama → SQL → PR). Tampoco propone un comité de 15 personas — el equipo real es **Edwin + agentes SDLC**. Este documento agrega la única pieza que falta: **quién decide qué entra, con qué cadencia, contra qué criterio, y cómo se sabe si una recomendación se ejecutó.**

Dos casos motivan esto, verificados contra el repo:
- **CC-0021** (motor de reglas de precios, PR #549) se construyó completo el 2026-08-21, el mismo día en que `docs/44_plan_remediacion_sprints.md` registraba cuatro riesgos Críticos abiertos (R02/R04/R07 parcial + el hallazgo P0-0 de audit log). No cierra ninguno. No estuvo mal hacerlo — nadie tuvo que decidirlo explícitamente.
- **PROG_QX.md / ACT_QX.md** (2026-05-22) ya diagnosticaron la duplicación del modelo quirúrgico y ya recomendaban consolidar. Nadie le puso dueño ni fecha. Reapareció como **R05** del assessment externo tres meses después (resuelto recién en ADR 0021, 2026-08-22).

## 1. Cómo entra un cambio

El flujo real, formalizado. No se inventa burocracia nueva — se nombra la que ya opera y se cierra el único hueco (paso 2, que hoy no existe).

| # | Paso | Qué pasa hoy (verificado) | Quién decide | Qué se agrega |
|---|---|---|---|---|
| 1 | **Origen** | Mockup, norma NTEC/ISSS, o hallazgo de auditoría | — | — |
| 2 | **Admisión** | No existe como paso explícito — el CC se abre directo | **Edwin** (con recomendación de @PO) | Las 5 preguntas de §2, contestadas en el REQ mismo, antes de abrir rama |
| 3 | **REQ** | `docs/CC/NNNN/REQ-<DOM>-<NNN>-<slug>.md` (formato ya estable: Objetivo, entidades, reglas, decisiones) | Autor del REQ (Edwin o agente delegado) | Sección "Admisión" con las 5 respuestas de §2 |
| 4 | **Diseño/impacto** | @AE/@AS si toca RLS, multi-tenancy o arquitectura de dominio | @AE / @AS | Sin cambio — ya ocurre para CCs que lo requieren (ver ADR 0021) |
| 5 | **Rama + build** | `feat/cc-NNNN-slug`, `Skill(careful-coding)` obligatorio | @Dev | Sin cambio |
| 6 | **SQL numerado** | `packages/database/sql/NNN_*.sql`, aplicado vía MCP Supabase | @DBA / @Dev | Sin cambio |
| 7 | **PR** | Conventional commits en español, CI (typecheck/lint/test/build/axe) | @QA (DoD, §5) | Sin cambio |
| 8 | **Merge** | `main`, branch protection 3 checks requeridos | Edwin (o `--admin` si aplica) | Sin cambio |
| 9 | **Registro** | `docs/CC/INVENTARIO_CAMBIOS.md` §6 (tabla CC/Requerimiento/Entrega/Estado) | @PO | Sin cambio — ya se mantiene |

**Lo único nuevo es el paso 2.** Sin admisión explícita, un CC compite por la misma capacidad que el backlog de remediación sin que nadie lo haya decidido — que es exactamente el patrón que señala R10.

## 2. Criterio de admisión — 5 preguntas, 5 minutos

Se contestan en el REQ antes de crear la rama. No requieren comité: las responde quien propone el CC (Edwin o el agente delegado) y quedan escritas, no solo pensadas.

| # | Pregunta | Si la respuesta es "sí" / desfavorable |
|---|---|---|
| 1 | ¿Este CC **agrava** algún riesgo Crítico abierto en `docs/44_plan_remediacion_sprints.md` (P0)? | **Veto.** No se abre sin autorización explícita de Edwin, dejada por escrito en el REQ. |
| 2 | ¿Compite por la misma capacidad (Edwin + agentes) que un sprint de remediación en curso? | Se nombra **cuál** sprint se retrasa y por cuánto, en el REQ. No se decide en silencio. |
| 3 | ¿Toca un dominio ya marcado P0/P1 en `docs/44` (RLS multi-tenant, ECE, farmacia/eMAR, firma electrónica)? | Pasa por el mismo nivel de revisión que ese ítem (@AE/@DBA), no solo @Dev. |
| 4 | ¿Ya existe una ficha de flujo, ADR o auditoría que recomiende esto — o lo contrario? | Si hay una recomendación previa sin ejecutar, este CC decide explícitamente **ejecutarla o reemplazarla** — nunca la ignora en silencio (esto es lo que faltó en PROG_QX). |
| 5 | ¿Cuál es el costo de **no** hacerlo ahora frente a esperar el sprint que le toca en `docs/44`? | Si el costo de esperar es bajo, entra al backlog de remediación en su sprint — no como CC urgente fuera de orden. |

Un "no" en las 5 es admisión directa. Un "sí" en la 1 es veto salvo decisión explícita de Edwin. Las respuestas 2–5 son de juicio, no de bloqueo automático — el objetivo es que la decisión sea *visible*, no que sea lenta.

## 3. Cadencia de revisión

- **Por CC**: el cotejo contra `docs/44` ocurre en la admisión (paso 2), no se pospone a un ciclo.
- **De portafolio**: quincenal, alineada a los sprints de 2 semanas de `docs/44` §4. Al cierre de cada sprint, @PO compara qué CCs entraron contra qué gate se planeó cerrar.
- **Cuando divergen** (un CC desplazó un sprint de remediación): se anota explícitamente en `docs/44` §5 — sprint afectado, nueva fecha estimada, motivo. No se pierde silenciosamente, que es lo que le pasó a la recomendación de PROG_QX durante tres meses.
- Prerrequisito operativo: `docs/44_plan_remediacion_sprints.md` hoy vive en la rama `docs/plan-remediacion-sprints`, sin mergear a `main` — mientras no esté en `main`, este mecanismo de cadencia no tiene contra qué cotejar. Coordinación de merge queda con Edwin (fuera de mi alcance en esta tarea).

## 4. Trazabilidad de recomendaciones

El mecanismo que faltó en el caso PROG_QX: toda recomendación que sale de un ADR, una ficha de flujo o una auditoría necesita **dueño, fecha objetivo y un lugar donde se vea si se ejecutó**. No se propone un documento nuevo — un registro nuevo es, con el tiempo, otro documento muerto. Se extiende lo que ya existe:

1. **Header de ADR** (`docs/adr/NNNN-*.md`) ya trae un campo `Estado` (verificado: 0019, 0021 lo usan — Propuesto/Aceptado/etc.) y ya lista decisores. Se agregan dos campos obligatorios cuando el ADR incluye un plan de ejecución (como el "Plan de migración" de ADR 0021): **`Dueño`** y **`Fecha objetivo`**. Sin fecha, no hay forma de saber si una recomendación "Aceptada" quedó pendiente o se ejecutó.
2. **Fichas de flujo** (`docs/flujos/{CODIGO}.md`) que contengan una recomendación de consolidación o cambio (el caso de `PROG_QX.md`/`ACT_QX.md`) cierran con una tabla de una línea: `Recomendación | Dueño | Fecha objetivo | Estado`. Mismo formato que el punto 1, para que ambos se puedan barrer con el mismo grep.
3. **El índice único es `docs/44_plan_remediacion_sprints.md`** (o el documento vivo que lo suceda), no un registro aparte. Toda recomendación abierta de un ADR o ficha se vuelve un ítem P0/P1/P2 ahí — ya es el formato que usa (ver P1-2 = ADR 0021/R05). Un ADR marcado "Aceptado" con plan de ejecución que **no** tiene línea correspondiente en `docs/44` es, por definición, un hallazgo a levantar en la próxima revisión quincenal (§3) — no una omisión que se descubre tres meses después.
4. **Qué lo mantiene vivo**: se revisa en la misma cadencia de §3, no aparte. No es un documento adicional que alguien tenga que acordarse de abrir — es una pasada sobre índices que ya se consultan (el propio `docs/44`, los ADRs por su `Estado`).

## 5. Definición de Done a nivel producto

Dos definiciones de Done conviven hoy sin conciliar: la de CLAUDE.md (@QA) y la del assessment de Code Castle, más exigente para procesos críticos. Se concilian aquí — ninguna reemplaza a la otra, la de Code Castle **añade** una condición que CLAUDE.md no exigía de forma explícita.

| Fuente | Exige |
|---|---|
| **CLAUDE.md (@QA)** | Merged + tests verdes + coverage ≥80% + axe sin críticos/serios + lint + typecheck + entry en matriz de trazabilidad + review @QA |
| **Code Castle** | Frontend + backend + persistencia real + reglas de negocio + permisos + **aislamiento de datos** + auditoría cuando aplique + pruebas + integración con dependencias + documentación mínima + aceptación funcional. **Para proceso crítico, además: ≥1 E2E exitoso + ≥1 E2E negativo/hard-stop validado** (ejemplo del assessment: circuito de farmacia completo, prescribe→firma→valida lote/stock→dispensa→identifica→escanea→administra→eMAR→auditoría) |

**DoD unificado (este documento gobierna a partir de aquí):**

1. Todo lo de CLAUDE.md — no se relaja, sigue siendo la base de todo merge.
2. **Aislamiento de datos verificado explícitamente** (test de RLS/tenant) cuando el CC toca un dominio PHI o multi-tenant — ya implícito en `withTenantContext`, ahora exigido como ítem propio de la lista de Done, no asumido.
3. **Para procesos críticos** — hoy definidos como los dominios ya marcados P0/P1 en `docs/44` (ADT/admisión, RLS multi-tenant, farmacia/eMAR/BCMA, firma electrónica e inmutabilidad, quirúrgico) — se exige además **1 escenario E2E feliz + 1 escenario E2E negativo/hard-stop**, sin `test.skip`/`fixme` condicional. Este es el gap concreto que señala R08 del assessment y que `docs/44` ya trackea como P1-3/Sprint 6 — este documento lo fija como criterio de Done permanente, no solo como ítem de remediación puntual.
4. @QA/@QAF siguen siendo quienes firman el Done en el PR — este documento no mueve esa responsabilidad, solo agrega el punto 2 y 3 a su checklist para CCs que toquen dominio crítico.

---

**Trazabilidad de este documento**: responde a P2-3 de `docs/44_plan_remediacion_sprints.md` ("Gobierno de producto — Comité de cambios con cadencia y criterio de aceptación de CC"). Su propio gate de cierre: este documento existe y se usa en el próximo CC que se abra — verificable en el REQ del siguiente CC, que debe traer la sección "Admisión" de §2.
