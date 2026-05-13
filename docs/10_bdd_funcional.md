# 10 — BDD Funcional del HIS Multipaís

**Proyecto:** HIS Multipaís — Inversiones Avante
**Autor:** @QAF — Quality Analyst (BDD)
**Versión:** 1.0 — 2026-04-30
**Referencia:** `TDR_HIS_Multipais.md`, `docs/05_backlog.md`, `tests/features/`

---

## 1. Filosofía BDD aplicada al HIS

### 1.1 Por qué BDD en un sistema clínico

Un HIS no es software de consumo: cada interacción tiene consecuencias clínicas, legales y financieras. Necesitamos un lenguaje común entre **PO**, **arquitectos**, **médicos**, **enfermeras**, **admisión**, **TI** y **auditores** para:

1. Eliminar ambigüedades antes de codificar (DoR del backlog exige criterios verificables).
2. Convertir las reglas de negocio (DUI, Manchester, RBAC, audit trail) en **contratos ejecutables**.
3. Servir como **documentación viva** que jamás se desincroniza del producto.
4. Habilitar **regresión continua** en un dominio donde un bug puede costar vidas.

### 1.2 Lenguaje ubicuo — diccionario base

| Término dominio (en feature) | Definición | TDR |
|------------------------------|------------|-----|
| `Encounter`                  | Episodio asistencial (emergencia, programada, hospitalización, ambulatorio) | §8 |
| `Patient` / `MRN`            | Paciente identificado en MPI con Master Record Number único | §8.1 |
| `HospitalAccount`            | Cuenta hospitalaria asociada al Encounter (cierre administrativo) | §8.5, §23 |
| `Triage Manchester`          | Sistema de clasificación de urgencias por 5 niveles | §9 |
| `Flujograma`                 | Presentación clínica (52 estándar Manchester) | §9 |
| `Discriminador`              | Criterio que asigna nivel dentro del flujograma | §9 |
| `Break-the-Glass`            | Acceso clínico excepcional fuera del ABAC normal | §6 |
| `Audit Chain`                | Cadena hash inmutable del audit_log | §6.5 |
| `RLS`                        | Row Level Security — aislamiento por organización | §5, §6 |
| `Outbox`                     | Patrón de eventos de dominio publicados de forma transaccional | §4 |
| `Pack SV`                    | Localización fiscal/regulatoria de El Salvador | §27 |
| `JVPM`                       | Junta de Vigilancia de la Profesión Médica (validación de firmas) | §27 |
| `LWBS`                       | Left Without Being Seen — paciente abandona triage | §9 |
| `Bundle hour-1`              | Paquete de medidas de sepsis en la primera hora | §9, §12 |

Este diccionario se mantiene en sincronía con `docs/01_arquitectura_empresarial.md` y se referencia desde los `.feature` mediante terminología consistente.

### 1.3 Scenarios como contratos

Cada `Scenario` representa un **contrato verificable** con tres partes:

- **`Dado`**: estado inicial verificable (datos, roles, configuración).
- **`Cuando`**: acción del usuario o sistema (un solo evento por escenario, idealmente).
- **`Entonces`**: efectos observables (estado, eventos publicados, audit log, UI).

Los `Esquema del escenario + Ejemplos` se usan para **matrices de equivalencia** (DUI válidos/inválidos, niveles Manchester, transiciones de estado).

### 1.4 Principios de careful-coding aplicados

- **No inventar reglas.** Si una regla no está en TDR/backlog/decisión clínica, se marca `# TODO refinar con super-usuario`.
- **No duplicar escenarios.** Un mismo flujo se cubre **una vez**, en el feature más representativo.
- **No mezclar perspectivas.** Tests técnicos (perf, infra, RLS interno) son responsabilidad de `@QA`. Los `.feature` describen **lo que el usuario ve y vive**.
- **Pasos declarativos.** "Cuando guardo el paciente" en lugar de "Cuando hago clic en `#btn-save`".

---

## 2. Cobertura del MVP

> Backlog: 67 user stories de E1–E9 (excluyendo Sprint 0 técnico) + 7 stories de Sprint 0 = **74 stories**.

### 2.1 Cobertura BDD

| Épica | Stories totales | Stories con feature/scenario explícito | Cobertura | Comentario |
|-------|-----------------|----------------------------------------|-----------|------------|
| E0    | 7               | 0 (delegado a @QA)                     | n/a       | Tests técnicos: lint, build, CI |
| E1    | 8               | 7                                      | 88%       | US-1.4 multi-libro: solo cimiento, sin UX MVP |
| E2    | 11              | 9                                      | 82%       | US-2.5 SSO Should y US-2.11 cifrado en infra |
| E3    | 10              | 7                                      | 70%       | US-3.1, US-3.5, US-3.6 implícitos; US-3.10 Could |
| E4    | 8               | 8                                      | 100%      | Todos cubiertos con profundidad |
| E5    | 10              | 9                                      | 90%       | US-5.9 biometría @wip |
| E6    | 10              | 10                                     | 100%      | Profundidad alta en triage-adulto y códigos |
| E7    | 6               | 5                                      | 83%       | US-7.4 MINSAL TODO refinar |
| E8    | 6               | 0 (delegado a @SRE/@QA)                | n/a       | SLOs, observabilidad |
| E9    | 4               | 0 (delegado a @PO/@Orq)                | n/a       | Capacitación |
| **Total funcional (E1-E7)** | **63** | **55** | **87%**   | Núcleo MVP cubierto |

### 2.2 Estadísticas de los `.feature`

| Métrica                                | Valor |
|----------------------------------------|-------|
| Feature files totales                  | 24    |
| Scenarios + Scenario Outlines          | ~165  |
| Ejemplos (filas en Outlines)           | ~85   |
| Tags `@critical`                       | 14 features |
| Tags `@a11y`                           | 3 features (registro paciente, login, tablero) |
| Comentarios `# TODO refinar`           | 6     |

### 2.3 Historias NO cubiertas con BDD funcional (y por qué)

| US | Razón |
|----|------|
| US-0.x (Sprint 0) | Calidad técnica del proyecto: lint, build, CI/CD. No tienen flujo de usuario. Cubiertos por @QA + @SRE. |
| US-2.5 (SSO SAML/OIDC) | Marcado **Should** en MoSCoW, pospuesto post-S2. Se añadirá feature al planificarse. |
| US-2.11 (Cifrado en reposo + TLS) | No funcional. Validación a nivel de infraestructura. |
| US-3.10 (Motor de reglas) | **Could** — fuera del MVP. |
| US-5.9 (Biometría) | **Should** opcional. Marcado `@wip` en mapa cobertura. |
| US-7.4 (Códigos MINSAL) | Esquema disponible, falta input de super-usuario regulatorio. `# TODO refinar`. |
| US-8.x (Observabilidad) | SLOs, dashboards Grafana, backups. Ámbito @SRE. |
| US-9.x (Onboarding go-live) | Plan operativo, no test funcional. Ámbito @PO + @Orq. |

---

## 3. Pendientes para fases posteriores

### 3.1 Fase 2 — Ambulatorio y agenda (post-MVP)

- Agenda médica con conflictos y reasignación.
- Consulta externa con SOAP.
- Receta médica electrónica (interacciones, dosis).
- Telemedicina (síncrona y asíncrona).

### 3.2 Fase 3 — Hospitalización avanzada

- Plan de cuidados de enfermería estructurado.
- eMAR (Electronic Medication Administration Record).
- Bundles UCI: VAP, CLABSI, CAUTI, sepsis hour-1 con scoring continuo.
- Quirófanos (programación, conteo de gasas, marcaje quirúrgico).

### 3.3 Fase 4 — Diagnóstico

- LIS (Laboratorio): solicitud, captura, interpretación, alerta de pánico.
- RIS/PACS (Imágenes): solicitud, worklist, informe estructurado, integración DICOM.
- Patología.

### 3.4 Fase 5 — Financiero y fiscal SV

- Cuentas hospitalarias detalladas, copago, deducible.
- Convenios y aseguradoras (autorizaciones).
- DTE (Documento Tributario Electrónico) con DGII SV.
- Multi-libro contable activo (fiscal, IFRS, gerencial, presupuestal).

### 3.5 Fase 6 — Farmacia y almacén

- Recepción de medicamentos por lote y vencimiento.
- Despacho con doble validación.
- Estupefacientes con cadena de custodia.
- Reposición Kanban / punto de pedido.

### 3.6 Fase 7 — Portal del paciente y BI

- Portal P9 (paciente): histórico de visitas, recetas, citas.
- BI con cubos pre-construidos, dashboards self-service.
- Forecasting de demanda y ocupación.

---

## 4. Buenas prácticas para nuevas features

### 4.1 Checklist de creación de un `.feature` nuevo

- [ ] Comentario de cabecera con: épica, US, TDR §, persona, valor de negocio.
- [ ] `# language: es` en la primera línea.
- [ ] `Antecedentes:` con preconditions verdaderamente comunes.
- [ ] 3–8 scenarios cubriendo: golden path + edge cases + error cases.
- [ ] Al menos un `Esquema del escenario` si hay matriz de inputs.
- [ ] Tags al menos: dominio (`@mpi`, `@adt`...), criticidad (`@critical`/`@regression`/`@smoke`), idioma (`@es-SV`).
- [ ] Pasos declarativos, no imperativos.
- [ ] No duplica escenarios cubiertos en otro feature.
- [ ] Mapa de cobertura en `tests/features/README.md` actualizado.
- [ ] Si hay ambigüedad: comentario `# TODO refinar`, no inventar.

### 4.2 Anti-patterns a evitar

- **El "feature de UI"**: pasos como `cuando hago clic en (#xpath)`. Reescribir en lenguaje de negocio.
- **El "scenario gigante"**: 30 pasos `Y…Y…Y…`. Dividir en escenarios más pequeños.
- **Antecedentes con datos irrelevantes**: solo lo que TODOS los scenarios usen.
- **Duplicación de matrices**: si DUI ya tiene matriz en `validacion-dui.feature`, no la repitas en `registro-paciente-sv.feature`; ahí basta validar el flujo de captura.
- **Test técnico disfrazado de BDD**: si el resultado es "el endpoint responde 200", probablemente sea un test de integración técnico (@QA), no un BDD funcional.

---

## 5. Gobernanza

- **@QAF (autor)** mantiene la salud de los `.feature` y el mapa de cobertura.
- **@PO** valida que cada feature corresponde a una US del backlog y aporta valor.
- **@AS / @Dev** garantizan factibilidad técnica de los escenarios.
- **@QA** decide el runner de ejecución (Cucumber.js / playwright-bdd) y mantiene step definitions.
- **Super-usuarios clínicos / fiscales** revisan y firman los `# TODO refinar`.

---

## 6. Fase 2 — 14 módulos skeleton (entrega Stream B, 2026-05-12)

Entrega Wave 6/7/8 (PR #6, #7, #8). Cobertura BDD inicial: 1 `.feature` por
módulo con 2-3 scenarios (happy + edge). UI aún no implementada (deferida a
@Dev), por lo que la columna "UI covered" queda en TBD; la columna "Backend
covered" lista el procedure tRPC asociado a cada feature (ya con tests
unitarios y cross-tenant integration en `packages/trpc`).

| § | Módulo | Feature file | Scenarios | Backend covered (procedure tRPC) | UI covered |
|---|--------|--------------|-----------|----------------------------------|------------|
| 10 | Outpatient (Ambulatoria) | `tests/features/phase2/10-ambulatoria.feature` | 2 | `outpatient.appointment.{create,list,get}` | TBD |
| 11 | Inpatient (Hospitalización) | `tests/features/phase2/11-hospitalizacion.feature` | 2 | `inpatient.admission.{create,list}` | TBD |
| 12 | Emergency (Emergencia) | `tests/features/phase2/12-emergencia.feature` | 2 | `emergency.visit.{create,setDisposition}` | TBD |
| 13 | Surgery (Cirugía) | `tests/features/phase2/13-cirugia.feature` | 2 | `surgery.case.{create,timeOut,start}` | TBD |
| 14 | EHR Clinical Notes | `tests/features/phase2/14-historia-clinica.feature` | 3 | `ehr-notes.note.{create,sign,addendum}` | TBD |
| 15 | Pharmacy (Farmacia) | `tests/features/phase2/15-farmacia.feature` | 2 | `pharmacy.prescription.{create,sign}` | TBD |
| 16 | eMAR | `tests/features/phase2/16-emar.feature` | 3 | `medication-admin.record` | TBD |
| 17 | LIS (Laboratorio) | `tests/features/phase2/17-laboratorio.feature` | 2 | `lis.order.create`, `lis.result.validate` | TBD |
| 18 | RIS/PACS (Imagenología) | `tests/features/phase2/18-imagenologia.feature` | 2 | `imaging.order.{create,updateStatus}`, `imaging.report.sign` | TBD |
| 19 | Inventory (Inventario) | `tests/features/phase2/19-inventario.feature` | 2 | `inventory.movement.create`, `inventory.lot.create` | TBD |
| 20 | Services & Equipment | `tests/features/phase2/20-servicios-equipos.feature` | 2 | `services-equipment.equipment.create`, `services-equipment.pmSchedule.create` | TBD |
| 21 | Respiratory | `tests/features/phase2/21-respiratoria.feature` | 2 | `respiratory.order.{create,complete}`, `respiratory.ventilator.create` | TBD |
| 22 | Nutrition | `tests/features/phase2/22-nutricion.feature` | 2 | `nutrition.diet.create` | TBD |
| 25 | Insurance (Aseguradoras) | `tests/features/phase2/25-aseguradoras.feature` | 2 | `insurance.authorization.{create,approve,deny}` | TBD |

**Totales Phase 2:** 14 features, 30 scenarios.

### 6.1 Reglas de negocio pendientes (`@AE` por refinar)

| Módulo | Regla pendiente | Marca en feature |
|--------|-----------------|------------------|
| §12 Emergency | Umbral de tiempo para LWBS automático (tras X minutos sin atención). | `# @AE: regla pendiente — definir umbral de tiempo automático para LWBS` |

Resto de scenarios refleja únicamente comportamiento ya documentado en
`docs/03_blueprints_modulos.md` y los routers ya entregados. No se inventaron
reglas nuevas (principio /careful-coding).

### 6.2 Próximo paso

- @Dev entrega pages UI para los 14 módulos → Stream A Playwright reabre con E2E real.
- @QAF refina scenarios con super-usuarios clínicos (enfermería, farmacia, biomédica).
- @PO valida que cada feature mapea a una US del backlog Phase 2.

---

**Versión:** 1.1 — 2026-05-12 (Phase 2 skeleton coverage)
**Autor:** @QAF — Quality Analyst (BDD)
**Aprobaciones pendientes:** @PO (cobertura backlog Phase 2), @Orq (alineación), super-usuario clínico (TODOs Manchester + LWBS), super-usuario fiscal (TODOs NIT/MINSAL).
