# Inventario E2E completo — triage 2026-08-29

**@Orq/@QA** — Primer inventario que corre la suite completa de punta a punta
([run 33214724185](https://github.com/edwinaml-su/his/actions/runs/33214724185),
3.2 h, `max_failures=0`, rama `fix/e2e-full-bootstrap-rls` = main + bootstrap
RLS de #598). Intentos previos inválidos: timeout corto (#578 lo hizo
configurable), nightly con cancel-in-progress (#596), e infra rota — la BD
efímera no tenía `set_tenant_context()`/`ece.set_ece_context()` y ~50 routers
daban 500 (#597/#598). **Todo triage anterior a esta fecha está contaminado
por ese 500 y no debe usarse.**

## Números

| Resultado | Tests |
|---|---|
| Passed | 198 |
| **Failed** | **176** |
| Skipped (mayoría `test.skip` por falta de seed) | 101 |
| Did not run | 8 |
| Flaky | 1 |
| **Total** | 484 |

## Firmas de error (176 fallos)

| Firma | Conteo | Lectura |
|---|---|---|
| `expect(locator).toBeVisible()` | 81 | UI ausente o distinta a lo asertado — requiere lectura spec por spec |
| `TypeError: … reading 'email'` | 24 | **Un solo bug**: 3 specs llaman `login(page, "qa.admin@his.test", …)` pero la firma es `login(page, roleKey)` → lookup `undefined`. Corregido en este mismo PR |
| Timeouts de acción (click/focus/fill) | 37 | Elemento nunca aparece — pariente del toBeVisible |
| Aserciones de valor (`toBe`, `toHaveCount`, etc.) | ~10 | Producto o spec desactualizado |
| Rutas inexistentes (probeRoute honesto) | 4 | `/ece/signos-vitales/[id]` ×2, `/ece/pacientes` ×2 |
| Violaciones axe reales | ~9 | Notificaciones, Config. notificaciones, Admin dashboard, + a11y-wd |
| Bugs de spec (getByLabelText, strict ×3, malformed) | ~6 | Mecánicos |
| login no redirigió | 2 | Investigar (posible lockout residual) |

## Fallos por spec (top)

`fase2-contingencia` 8 · `fase2-retencion` 7 · `fase2-bedside-window-alert` 9
(los tres = bug de firma login, corregido acá) · `fase2-bedside-hard-stops` 12 ·
`gs1-lot` 6 · `ece-signos-vitales` 6 · `ece-maternidad-dashboard` 6 ·
`ece-hoja-ingreso` 6 · `ece-consentimiento-epicrisis` 6 · `who-checklist` 5 ·
`patient-mpi` 5 · `ece-bitacora-viewer` 5 · `staff-gsrn` 4 · `gs1-catalogos` 4 ·
`ece-historia-clinica` 4 · `ece-camas-mapa` 4 · `comite-minuta` 4 ·
`ece-episodio-hospitalario` 4 · resto en cola larga (ver artifact del run).

## Olas de remediación propuestas

1. **Ola 0 — mecánica (ESTE PR):** firma de `login()` en 3 specs → 24 tests.
   Candidatos a sumarse: `getByLabelText`, strict violations, malformed value.
2. **Ola fixtures (bloqueada por el seeder en curso, task_21adc470):**
   familia bedside (hard-stops 12 + kardex/flow/pharmacy/offline),
   `gs1-lot`/`gs1-catalogos`/`staff-gsrn` (datos escaneables),
   `workflow-publish-rollback` (necesita versiones publicadas en seed), y el
   grueso de los **101 skipped**. Re-medir tras cablear el seeder al workflow.
3. **Ola ECE (~55 fallos, la más grande):** lectura spec-por-spec de
   signos-vitales, maternidad, hoja-ingreso, bitacora, historia-clinica,
   camas-mapa, consentimiento-epicrisis, episodio, valoración, enfermería,
   indicaciones, evolución, epicrisis, estudios, defunción, emergencia, RRI,
   quirófano, periodo-expulsivo, RLS cross-tenant. Clasificar: bug de producto
   vs spec desactualizado vs fixture. Método de los huérfanos: mini-PRs con
   spec des-mentido como criterio.
4. **Ola a11y (9):** violaciones axe reales en Notificaciones/Config/Admin
   dashboard + workflow-designer.
5. **Ola clínico/transversal:** who-checklist, patient-mpi/identification,
   comite-minuta, bed-map, deaths, portal-arco, pin-lockout,
   triage-manchester, audit, admission-discharge, scope-nivel-a/b.
6. **Rutas probeRoute (4):** decidir crear ruta o mover el spec
   (ver `docs/qa/e2e-auditoria-rutas-2026-08-26.md`).

## Regla operativa

Para re-medir: `gh workflow run e2e.yml -f max_failures=0 -f timeout_minutes=330`
(con #598 mergeado; si no, `--ref` de esa rama). El nightly no interfiere
(#596). No comparar contra corridas previas al 2026-08-29.
