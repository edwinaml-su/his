# Sprint Review — Fase 2 Sprint 4 (F2-S4)

**Proyecto:** HIS Multipaís — Inversiones Avante
**Fecha:** 2026-05-17
**Autores:** @QA (métricas de calidad + evidencia de testing), @PO (logros + valor), @Orq (consolidación)
**Sprint:** F2-S4 — ECE Hospitalario: admisión → estancia → alta médica (epicrisis DIR + ruta defunción)
**Rama base:** `feat/fase2-s1-gate` (último commit verificado: `6532a92`)

---

## 1. Resumen ejecutivo

El Sprint F2-S4 cierra el núcleo del ECE Hospitalario de HIS Avante completando el ciclo
admisión → estancia → alta médica con epicrisis certificada por DIR y ruta de defunción.
Los 9 streams paralelos entregaron:

- **Hoja de Ingreso y Apertura de Episodio Hospitalario** (UI completa, router, bridge).
- **Valoración Inicial de Enfermería** (nueva tabla `ece.valoracion_inicial_enfermeria` +
  SQL hardening `66_valoracion_inicial_enfermeria.sql`).
- **Mapa de Camas** (visualización en tiempo real, react-flow heredado de F2-S3).
- **Episodio Hospitalario con alta médica** (router complementario, orden de egreso,
  transición de estado `en_curso → egresado`).
- **Ruta de Defunción** (Certificado de Defunción + Acta de Entrega de Cuerpo, UI completa).
- **Epicrisis refinada** (refactor UI: secciones colapsables, CIE-10 codificación egreso, indicaciones,
  receta digital, citas post-egreso).
- **Bridge Admisión atómica** (`admitirDesdeOrden`: 5 INSERTs + 1 UPDATE en una transacción;
  ver ADR 0014).
- **Tests E2E hospitalarios** (3 nuevos specs: flujo hospitalario completo, defunción, mapa camas).
- **Seed demo hospitalario** (pacientes, episodios, camas, personal con datos realistas SLV).

---

## 2. Logros por stream

| Stream | Descripcion | Entregable principal | Estado |
|--------|-------------|---------------------|--------|
| HOSP-01 | Hoja de Ingreso + Apertura Episodio | UI `app/(clinical)/hospitalizacion/nuevo`, router `hojaIngresoRouter` | Listo |
| HOSP-02 | Valoración Inicial Enfermería | Nueva tabla `ece.valoracion_inicial_enfermeria`, `66_valoracion_inicial_enfermeria.sql` | Listo |
| HOSP-03 | Mapa de Camas | Componente `BedMap` (react-flow), router `camaRouter.listar` con estado en tiempo real | Listo |
| HOSP-04 | Episodio Hospitalario + Alta Médica | `episodioHospitalarioRouter.emitirEgreso`, transición `en_curso → egresado` | Listo |
| HOSP-05 | Ruta Defunción | UI `certificado-defuncion`, `acta-entrega-cuerpo`, router `defuncionRouter` | Listo |
| HOSP-06 | Epicrisis UI refinada | Refactor secciones colapsables, codificación CIE-10 egreso, receta digital, citas | Listo |
| HOSP-07 | Bridge Admisión atómica | `admitirDesdeOrden`: transacción única orden→episodio→hoja_ingreso→asignacion_cama→admision | Listo |
| HOSP-08 | Tests E2E hospitalarios | `e2e/fase2/flujo-hospitalario.spec.ts`, `defuncion.spec.ts`, `mapa-camas.spec.ts` | Listo |
| HOSP-09 | Seed demo hospitalario | `packages/database/scripts/seed-hospitalizacion-demo.mjs`, 10 camas, 3 episodios activos | Listo |
| DOC | ADR 0013 | `docs/adr/0013-ece-mapa-camas-reactflow.md` — decisión de renderizado client-side | Listo |
| DOC | ADR 0014 | `docs/adr/0014-ece-bridge-admision-atomicidad.md` — decisión transacción única bridge | Listo |

---

## 3. Metricas

| Metrica | Valor |
|---------|-------|
| Story Points entregados (estimado) | ~85 SP |
| PRs mergeados | 1 (squash de 10 commits) |
| Archivos SQL nuevos | 1 (`66_valoracion_inicial_enfermeria.sql`) |
| Tablas nuevas en schema ECE | 1 (`ece.valoracion_inicial_enfermeria`) |
| Endpoints tRPC nuevos | 8 (hojaIngreso ×3, episodioHospitalario ×2, defuncion ×2, bridge ×1) |
| Tablas afectadas por bridge atómico | 5 (orden_ingreso, episodio_atencion, hoja_ingreso, asignacion_cama, admision) |
| Specs E2E nuevas | 3 |
| Escenarios E2E cubiertos (nuevos) | 11 (7 happy path + 4 edge cases) |
| Documentos hospitalarios con UI completa | 5 (Hoja Ingreso, Valoración Inicial Enf, Episodio/Alta, Defunción, Epicrisis) |
| Cobertura unit routers nuevos | >= 80 % (threshold CI) |
| ADRs nuevos | 2 (0013, 0014) |
| Advisor security CRITICAL al cierre | 0 (target) |

### 3.1 Cobertura E2E por ruta critica

| Spec | Escenarios | Rutas cubiertas | Resultado esperado |
|------|-----------|----------------|--------------------|
| `flujo-hospitalario.spec.ts` | 5 | orden_ingreso → hoja_ingreso → valoracion_enf → alta | verde |
| `defuncion.spec.ts` | 3 | alta con fallecimiento → certificado_defuncion → acta_entrega | verde |
| `mapa-camas.spec.ts` | 3 | listar camas, filtrar por servicio, ocupar desde bridge | verde |

### 3.2 Patron bridge atomico — verificacion de integridad

El spec `flujo-hospitalario.spec.ts` incluye un escenario de falla de red simulada
(inyeccion de error en el quinto INSERT via mock de `prisma.$transaction`) que verifica
rollback total: ninguna de las 5 tablas queda con datos parciales. Esta prueba de regresion
protege el ADR 0014.

---

## 4. Retroactiva

### 4.1 Que funciono

1. **Paralelizacion efectiva de 9 streams.** El contrato de interfaz entre streams
   (tipos TypeScript de `admitirDesdeOrden` + schema SQL de la tabla nueva) se definió en
   el día 1, permitiendo que HOSP-07 y HOSP-08 avanzaran en paralelo sin bloquear a HOSP-01.

2. **Bridge atómico como single source of truth.** Centralizar los 5 INSERTs + 1 UPDATE
   en un solo endpoint eliminó la clase de bugs de estado parcial documentada en el backlog
   F2-S3. El ADR 0014 captura la decision para que no se revierta en sprints futuros.

3. **Mapa de Camas visual sobre react-flow (heredado F2-S3).** Reutilizar el grafo react-flow
   del motor de workflow ECE (introducido en F2-S3) para el mapa de camas redujo la curva
   de aprendizaje y el tiempo de implementacion de HOSP-03 a menos de un día.

4. **Nueva tabla con SQL hardening desde commit 1.** La tabla `ece.valoracion_inicial_enfermeria`
   incluye RLS policies, trigger de inmutabilidad y FK a `ece.episodio_atencion` en el mismo
   archivo SQL, sin deuda técnica posterior. Lección aprendida de Wave 6 (thresholds coverage).

### 4.2 Que mejorar

1. **Proceso de seed hospitalario requiere datos de personal ECE.** El seed demo en
   `seed-hospitalizacion-demo.mjs` asume que `ece.personal_salud` ya tiene registros.
   Si se corre en BD limpia falla silenciosamente por FK. Acción F2-S5: agregar precondicion
   explícita y un seed de personal ECE mínimo.

2. **Integraciones cross-stream no testeadas con datos reales.** El E2E de defuncion usa
   un episodio sembrado, no uno creado por el flujo completo (bridge → estancia → egreso
   con fallecimiento). Acción F2-S5: encadenar los specs para usar el episodio generado
   por el flujo hospitalario completo.

3. **Epicrisis UI refactor no cubre modo offline / contingencia.** El US.F2.4.33
   (Modo de Contingencia) quedó fuera de scope; la UI asume conectividad. Acción: documentar
   la limitación en el runbook y marcar US.F2.4.33 como carry-over prioritario en F2-S6.

4. **Mapa de camas sin filtro multi-servicio simultáneo.** El componente `BedMap` filtra
   por un servicio a la vez. Para supervisión de piso que necesita ver múltiples servicios
   se requiere extensión. Registrado como deuda técnica, no bloqueante para el gate.

---

## 5. Carry-over F2-S5

| Item | Tipo | Razon | Prioridad |
|------|------|-------|-----------|
| Ruta Quirúrgica completa (US.F2.4.11–16) | Feature | Preop checklist + nota operatoria + URPA fuera de scope F2-S4 | Alta |
| Ruta Obstétrica (US.F2.4.18–21) | Feature | Partograma + atención RN fuera de scope F2-S4 | Alta |
| Tests integración con seed real (cross-stream) | Testing | E2E de defuncion necesita episodio de flujo completo | Alta |
| Seed personal ECE con precondicion explícita | Script seed | Falla en BD limpia por FK a personal_salud | Media |
| Mapa de camas multi-servicio simultáneo | Feature | Supervisión de piso requiere vista agregada | Media |
| US.F2.4.33 Modo Contingencia | Feature | UI sin soporte offline | Baja |
| Integración censo diario (US.F2.4.26) | Feature | Liberación de cama no actualiza censo automaticamente en todos los paths | Media |

---

## 6. Proximos hitos

| Hito | ETA | Criterios |
|------|-----|-----------|
| Ruta Quirúrgica gate | F2-S5 | US.F2.4.11–16 mergeados + E2E verde |
| Ruta Obstétrica gate | F2-S5 | US.F2.4.18–21 mergeados + partograma series temporales |
| E2E cross-stream integrado | F2-S5 | Un spec que cubre bridge → estancia → egreso → defuncion |
| Apply `66_` en Supabase prod | F2-S5 | `ece.valoracion_inicial_enfermeria` en BD prod con advisors = 0 CRITICAL |
| Gate F2-S4 | F2-S5 inicio | ADRs 0013/0014 mergeados + SQL aplicado + 3 specs E2E verde + cobertura >= 80% |

---

## 7. Firmas

- [x] **@QA** — métricas de cobertura, 3 specs E2E, carry-over documentado — 2026-05-17.
- [ ] **@PO** — pendiente validación criterios de aceptación US.F2.4.1, 2, 5, 22, 23, 24.
- [ ] **@Orq** — pendiente consolidación en reporte ejecutivo Fase 2.
