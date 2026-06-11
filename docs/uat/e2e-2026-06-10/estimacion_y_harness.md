# Estimación de remediación + Harness de integración (drift ECE)

> Insumo para la propuesta de personalización/remediación. Acompaña a
> [`inventario_drift_ece.md`](inventario_drift_ece.md) (los ~28 routers rotos) y
> [`REMEDIACION-2026-06-10.md`](REMEDIACION-2026-06-10.md).

---

# Parte A — Estimación por router (esfuerzo de reescritura)

Cada router roto clasificado por naturaleza del drift. Calibración con quirófano
(1 router de 12 desajustes, read+write, ≈ una sesión profunda):

| Talla | Qué implica | dev-días (dev solo) |
|---|---|---|
| **S** | 1 columna/lookup mal (rename trivial) | ~0.5 |
| **M** | pocos valores/columnas o 1-2 procedimientos | ~1.5 |
| **L** | reescritura estructural multi-tabla (quirófano-class) | ~3 |

## A.1 — Routers ACTIVOS (cableados; hay que arreglarlos)

| Router | Talla | Razón |
|---|---|---|
| who-checklist | S | `usuario_id`→`his_user_id` (1 línea) |
| partograma | S | `usuario_id`→`his_user_id` (1 línea) |
| urpa-recovery | S | guard `acto_quirurgico.establecimiento_id`→vía episodio |
| gs1-medication | S | `recall_fecha`→`recall_iniciado_en` (1 col) |
| historia-clinica | M | remap `tipo_consulta` + `disposicion` a vocab del CHECK |
| atencion-emergencia | M | `disposicion` libre → enum válido |
| valoracion-inicial-enfermeria | M | resolver `personalId` en firmar/validar (2 procs) |
| resultado-estudio | M | rediseñar estados (pendiente_validacion/validado→vigente/rectificado) |
| solicitud-estudio | M | enum `tipo` (gabinete vs otro) |
| indicaciones-medicas | M | `indicacion_item.notas` (read roto) + firmar |
| registro-enfermeria | M | `findIndicacionItem` (tabla/cols fantasma) + `'pospuesto'` |
| certificacion | M | `documento_instancia.actualizado_en` + filtro `estado_registro='activo'` |
| bedside-ronda | M | `gs1_gln_beds` + cols `indicaciones_medicas` → remap a tablas reales |
| firma-electronica | M | `insertBitacora`/`history` → columnas reales de `bitacora_acceso` |
| epicrisis | M | INSERT omite NOT NULL `instancia_id` (instancia-first) |
| episodio-hospitalario | L | `eh.id` (PK es `episodio_id`) + `asignacion_cama` + epicrisis insert |
| bridge-admision | L | `hoja_ingreso.paciente_id` + episodio_hospitalario + auth_user_id + nombre paciente |
| atencion-rn | L | `paciente.his_patient_id` ×2 + NOT NULL + enum `sexo` + insert paciente |
| certificado-defuncion | L | ≥8 columnas inexistentes + cols `Patient` + NOT NULL |
| ece-rectificacion | L | tabla `rectificacion` distinta + `public.outbox` + `User.full_name` |
| bitacora | L | toda la tabla `bitacora_acceso` con columnas inexistentes |
| bedside | L | `epcis_events` (tabla fantasma) + estructura EPCIS |
| gs1-gln-hierarchy | L | router completo asume `gs1_gln.id`+`parent_id` (no existen) |

**Subtotal activos:** S×4 (2 d) + M×11 (16.5 d) + L×8 (24 d) = **~42.5 dev-días ≈ 2.0 dev-meses** (solo dev).

## A.2 — Routers LATENTES (consolidar/borrar, no reescribir)
`bridge-triage`, `episodio`, `retencion`, `gs1-catalogos(GLN)`, `bedside-hardstops` → borrar + redirect + dedupe ≈ **5 × 0.5 = 2.5 dev-días**.

## A.3 — Multiplicadores (los verdaderos sumideros, NO por-router)
| Ítem | dev-días | Nota |
|---|---|---|
| Harness de integración (build-out + 1 test/router activo) | ~16–20 | Ver Parte B. Automatiza la verificación → reduce carga de QA |
| Datos maestros (catálogos, personal, salas, servicios, camas) | ~5–10 | Varios módulos en 0 filas; bloquea UAT |
| E2E (Playwright) por módulo activo (~12-14) desde casi cero | ~20–35 | **El sumidero mayor**; hoy E2E Fase 2 ≈ 0 |
| QA: verificación continua | continuo | **El cuello de botella con 1 QA** |

## A.4 — Total Frente C
| Bloque | dev-meses |
|---|---|
| Reescrituras (activos) + consolidación (latentes) | ~2.1 |
| Harness de integración | ~1.0 |
| Datos maestros | ~0.5 |
| E2E | ~1.5 |
| **Total Frente C (dev)** | **~5.0 (rango 4–6)** + QA dedicado |

> **Conclusión para la propuesta:** Frente C ≈ **4–6 dev-meses de dev + QA dedicado**.
> Sumado a Frente A (nav configurable, ~2–4 dev-meses) y Frente B (bugs abierto,
> no acotado), **supera con holgura los 12 dev-meses** de 4 devs × 3 meses. Con el
> equipo dado, hay que **fasear** (priorizar) o **ampliar equipo/plazo**.
>
> **Faseo sugerido (mayor blast radius primero):** (1) workspace de hospitalización
> (`episodio-hospitalario`+`indicaciones`+`registro-enfermeria`+`solicitud-estudio`)
> + `firma`/`bitacora` (transversales) + el harness; (2) resto de documentos
> clínicos; (3) maternidad/quirófano/bedside/GS1; (4) consolidar los 5 latentes.

---

# Parte B — Harness de integración (prototipo funcional)

## B.1 — Qué resuelve
Los tests unitarios mockean `$queryRaw`/`$executeRaw` → **no ven** el drift entre el
SQL del router y el DDL vivo. Por eso ~28 routers están rotos y pasan CI + typecheck
(el SQL en template strings no se tipa). El harness corre el **router real** contra
una **BD real** y atrapa esa clase entera.

## B.2 — Artefactos (prototipo, ya en verde)
- `packages/trpc/src/__tests__/integration/rollback-harness.ts` — helper:
  - `withRollback(prisma, fn)` corre `fn` en UNA transacción que **siempre hace rollback** → nada persiste (seguro contra BD compartida; sin contaminar audit-log/outbox de hash-chain).
  - Proxy: el `withWorkflowContext` del router corre **inline** sobre la misma tx (sin anidar); intercepta `SET LOCAL ROLE authenticated` para correr como BYPASSRLS (aísla **drift** de **RLS**); stubea `domainEvent`/`auditLog` (escrituras Prisma tipadas, no son la clase de drift).
- `packages/trpc/src/routers/ece/__tests__/integration/bridge-cirugia.integration.test.ts` — ejemplo:
  - ✅ `programarCirugia` + `cancelarPrograma` ejecutan contra el DDL real (rollback).
  - ✅ **Demo de detección**: un INSERT con `estado_registro='borrador'` (el bug clásico) lanza **CHECK 23514** → prueba que el harness atrapa la clase exacta.

## B.3 — Prueba ejecutada (2026-06-11)
```
✓ programarCirugia + cancelarPrograma ejecutan contra el DDL real (rollback)  6409ms
✓ DETECTA drift: el bug clásico (estado_registro='borrador') lanza CHECK 23514  616ms
Test Files  1 passed | Tests 2 passed
```
+ verificado: **0 filas persistidas** (rollback limpio) · **typecheck verde** · sin `INTEGRATION_DB` el test **se salta** (no afecta CI/unit normal).

## B.4 — Cómo correrlo
```bash
# carga DIRECT_URL del .env y activa el job de integración
set -a; source .env; set +a
INTEGRATION_DB=1 npx vitest run --root packages/trpc \
  src/routers/ece/__tests__/integration/bridge-cirugia.integration.test.ts
```
Gating: `describe.skipIf(!hasIntegrationDb())` — corre solo con `INTEGRATION_DB=1` + `DATABASE_URL/DIRECT_URL`.

## B.5 — Diseño para CI (producción del harness)
1. Job separado `test:integration` (NO en el gate unitario de cada PR; nightly + on-demand, como `e2e.yml`).
2. **BD efímera** (Postgres service container) sembrada desde `packages/database/sql/*` (mismo DDL que prod) → sin tocar prod; commit+teardown en vez de rollback.
3. 1 test de integración por router con SQL crudo (≈60). Plantilla = el de bridge-cirugia.
4. Falla el job si cualquier router no cuadra con el DDL → **el drift no vuelve a colarse**.

## B.6 — Limitaciones (honestidad)
- El prototipo corre contra la BD remota como `postgres` (BYPASSRLS) con rollback: valida **esquema**, no **RLS** (eso lo cubren los rls-isolation tests). En CI debe usar BD efímera.
- Stubea el outbox (`domainEvent`/`auditLog`): son escrituras Prisma **tipadas**, fuera de la clase de drift que cazamos; si se quisiera cubrir, se quita el stub contra la BD efímera.
- El timeout de tx interactiva de Prisma (default 5s) se sube a 30s (flujos remotos con muchos round-trips).
