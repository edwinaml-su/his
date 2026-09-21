# Triage estático E2E — R4.4 (2026-09-21)

**@Dev** — Plan de remediación 2026-09, Bloque 2 (R4.4). Sin stack Docker
disponible en esta sesión (worktree aislado, sin GoTrue/Postgres efímero) —
todo lo de abajo es **triage estático**: lectura de specs + comparación
contra el App Router real + un `tsc --noEmit` puntual del árbol `e2e/`
(scratch, no forma parte de CI — `e2e/` sigue fuera de `npm run typecheck`,
ver gotcha de `vitest.config.ts` include estrecho en `CLAUDE.md` para el
paralelo con tests que nunca corren). Ningún fix de este documento se
verificó contra un browser real; son correcciones mecánicas de alta
confianza (ruta inexistente confirmada por ausencia de `page.tsx`, o API de
Playwright usada incorrectamente), no verificación funcional.

Construye sobre tres documentos previos — **no los duplica**:

- `docs/qa/e2e-auditoria-rutas-2026-08-26.md` — mapa completo rutas reales vs
  `page.goto()`, 24 destinos rotos, 11 con candidato mecánico (Lote 2).
- `docs/qa/e2e-inventario-triage-2026-08-29.md` — primera corrida completa
  post-fix de infraestructura: 176 failed / 198 passed / 101 skipped, con
  olas de remediación propuestas (Ola 0 mecánica ya cerrada, Ola ECE ~55
  fallos pendiente de lectura spec-por-spec).
- `docs/runbooks/e2e-gotrue-auth.md` — estado del stack de auth E2E.

Este documento es una continuación de la **Ola ECE** pendiente de
`e2e-inventario-triage-2026-08-29.md`, acotada a los fixes que se pueden
justificar sin correr el browser (drift de ruta con candidato inequívoco,
bugs de API de Playwright). Todo lo que "huele" a decisión de producto o
requiere leer el DOM real se deja documentado, no adivinado.

---

## Veredicto por spec (batch de esta sesión)

| Spec | Veredicto | Detalle |
|---|---|---|
| `comite-minuta.spec.ts` | **corregida** | `page.getByLabelText(...)` no existe en la API de Playwright (`TypeError` en runtime, confirmado por `tsc` — el método correcto es `getByLabel`). Un `.or()` lo evalúa de inmediato, no perezosamente: el test crasheaba siempre que corría, no solo cuando el fallback se necesitaba. |
| `a11y.spec.ts` | **corregida** | `/triage/pending` nunca existió como página (confirmado en `e2e-auditoria-rutas-2026-08-26.md`, Bloque B #1-2, "sin candidato" en esa fecha). `triage-manchester.spec.ts` (2026-08-28, posterior) ya documenta y usa el reemplazo real: `/triage`. Corregidas las 2 apariciones (lista de páginas del loop + test dedicado "Triage Manchester — colores"). |
| `ece/ece-flujo-hospitalario-completo.spec.ts` | **corregida (parcial)** | Ver detalle abajo — 2 rutas + 1 bug de `selectOption`. Quedan 2 ítems sin tocar (ver tabla de drift pendiente). |
| `ece/ece-flujo-hospitalario-defuncion.spec.ts` | **corregida (parcial)** | Mismo patrón que la anterior (comparten estructura del flujo de alta) — 2 rutas + 2 bugs de `selectOption`. |
| `ece/ece-flujo-obstetrico-completo.spec.ts` | **corregida (parcial)** | Solo los 5 bugs de `selectOption`. Las rutas `/ece/obstetricia/${id}/*` (partograma, nacimiento, alumbramiento, atencion-rn) NO se tocaron — ver drift pendiente. |
| `ece/ece-flujo-quirurgico-completo.spec.ts` | **corregida (parcial)** | Solo 1 bug de `selectOption`. Las rutas `/ece/cirugia/${id}/*` NO se tocaron — ver drift pendiente. |
| Resto de la suite (~75 specs) | **no revisada en este batch** | Fuera del tope acordado (~10 specs mecánicos). Candidatas para la próxima tanda: ver `e2e-inventario-triage-2026-08-29.md` §"Ola ECE" y §"Ola clínico/transversal". |

**6 archivos tocados** (dentro del "máx ~10 specs" acordado). El resto de la
Ola ECE (~55 fallos según el inventario del 2026-08-29) sigue pendiente de
lectura profunda — no es trabajo mecánico, es alineamiento producto↔spec.

---

## 1. Bug transversal: `selectOption({ label: RegExp })`

Playwright's `Locator.selectOption()` solo acepta `{ label: string }` — un
`RegExp` no lanza en tiempo de escritura si el archivo nunca pasa por
`tsc` (que es el caso: `e2e/` no está en ningún `include` de
`npm run typecheck`), pero en runtime el objeto se serializa a texto y
**nunca matchea ninguna `<option>` real**, así que la selección
silenciosamente no ocurre (o revienta con "option not found" según la
versión de Playwright). Confirmado corriendo un `tsc --noEmit` puntual
contra `e2e/**/*.ts` con el mismo `tsconfig.base.json` del resto del repo:
9 ocurrencias en 4 archivos, todas `TS2345: Type 'RegExp' is not assignable
to type 'string'`.

**Fix:** nuevo helper `apps/web/e2e/_helpers/ui.ts` (`selectOptionMatching`)
que busca la `<option>` cuyo texto visible matchea el regex y selecciona por
su `value` real — mismo contrato defensivo que ya usaban los call sites
(`if (...) { await select... } else { fallback combobox }`). Cableado en:

- `ece-flujo-hospitalario-completo.spec.ts` (1 ocurrencia)
- `ece-flujo-hospitalario-defuncion.spec.ts` (2 ocurrencias)
- `ece-flujo-obstetrico-completo.spec.ts` (5 ocurrencias)
- `ece-flujo-quirurgico-completo.spec.ts` (1 ocurrencia)

---

## 2. Rutas corregidas (candidato inequívoco)

| Spec:línea (antes del fix) | Ruta usada | Causa | Reemplazo aplicado |
|---|---|---|---|
| `a11y.spec.ts:18,52` | `/triage/pending` | página inexistente | `/triage` (confirmado por `triage-manchester.spec.ts`) |
| `ece-flujo-hospitalario-completo.spec.ts:362` | `` `/ece/alta/${episodioId}` `` | módulo inventado | `` `/ece/episodio-hospitalario/${episodioId}/alta` `` — es el wizard de alta real (3 pasos), confirmado leyendo `apps/web/src/app/(clinical)/ece/episodio-hospitalario/[id]/alta/page.tsx` (mismo copy "motivo de alta" que el spec busca) |
| `ece-flujo-hospitalario-completo.spec.ts:449` | `` `/ece/episodios/${episodioId}` `` | plural inventado | `` `/ece/episodio-hospitalario/${episodioId}` `` (singular, es la página de detalle real) |
| `ece-flujo-hospitalario-defuncion.spec.ts:210` | `` `/ece/alta/${episodioId}` `` | ídem | `` `/ece/episodio-hospitalario/${episodioId}/alta` `` |
| `ece-flujo-hospitalario-defuncion.spec.ts:340` | `` `/ece/episodios/${episodioId}` `` | ídem | `` `/ece/episodio-hospitalario/${episodioId}` `` |

Verificado por existencia real de `page.tsx` en el árbol de
`apps/web/src/app/(clinical)/ece/episodio-hospitalario/`, no por ejecución.

---

## 3. Drift confirmado, SIN fix en este batch (huele a producto o falta candidato inequívoco)

Estos NO se tocaron a propósito — inventar una ruta/selector sin evidencia
fuerte de cuál es el reemplazo correcto es peor que dejar el fallo visible
(mismo argumento que ya usa `route-probe.ts`: un fallo honesto es mejor que
un skip silencioso). Todos usan ya `probeRoute()`, que falla el test
explícitamente si la ruta da 404/5xx — no hace falta ninguna acción
adicional para que esto "aparezca" en la próxima corrida real.

| Spec | Ruta/selector | Por qué no se tocó |
|---|---|---|
| `ece-flujo-hospitalario-completo.spec.ts:389` (post-fix) | `` `/ece/alta/${episodioId}/epicrisis` `` | El wizard real de alta es **una sola página** con 3 pasos manejados en estado de cliente (`episodio-hospitalario/[id]/alta/page.tsx`), no una sub-ruta `/epicrisis`. El test #10 asume navegación directa a un paso — el fix correcto es reescribir el test para navegar a `/ece/episodio-hospitalario/${id}/alta` y avanzar los pasos por UI (click "Continuar" ×2), no un rename de URL. Requiere leer el wizard completo — Ola ECE. |
| `ece-flujo-hospitalario-completo.spec.ts:407` (post-fix) | `` `/ece/validacion/${episodioId}` `` | Sin candidato claro — no existe ningún directorio `validacion/` bajo `(clinical)/ece/`. Podría ser un paso dentro de otra página (certificación, epicrisis) en vez de una ruta propia. Backlog @PO/@QA, mismo criterio que `docs/qa/e2e-auditoria-rutas-2026-08-26.md` Bloque B. |
| `ece-flujo-ambulatorio-completo.spec.ts:441` | `` `/ece/episodio/${episodioId}` `` (test de cleanup, tag "demo-e2e") | El propósito ("marcar episodio con tag demo-e2e" vía una UI de etiquetas) no tiene equivalente conocido en el árbol de rutas — puede que la funcionalidad de tags de episodio no exista todavía. Decisión de producto, no typo. |
| `ece-flujo-ambulatorio-completo.spec.ts:314` | `` `/ece/administracion/${episodioId}` `` | Sin directorio `administracion/` bajo `(clinical)/ece/`. Mismo criterio. |
| `ece-flujo-obstetrico-completo.spec.ts` (5 call sites) | `` `/ece/obstetricia/${id}` ``, `.../partograma`, `.../nacimiento`, `.../alumbramiento`, `.../atencion-rn` | El árbol real es `(clinical)/ece/obstetricia/{expulsion,partograma}/[id o episodioId]` — nombres y anidamiento NO coinciden 1:1 con lo que asume el spec (`nacimiento`, `alumbramiento`, `atencion-rn` no existen como directorios). Mapear cada paso del parto a la ruta real requiere leer el módulo de obstetricia completo — Ola ECE, no mecánico. |
| `ece-flujo-quirurgico-completo.spec.ts` (7 call sites) | `` `/ece/cirugia/${cirugiaId}/*` `` (consentimiento, preop, anestesia, acto-quirurgico, urpa, who-checklist) | El módulo real es `(clinical)/ece/quirofano/{acto-quirurgico,consentimiento-qx,preop,programacion,who-check}` — estructura de nombres distinta (`consentimiento-qx` no `consentimiento`, sin `anestesia`/`urpa` como directorios propios bajo quirofano). Ya señalado parcialmente en `e2e-auditoria-rutas-2026-08-26.md` (línea 70, solo para el entry point `/ece/cirugia/programar`) — el resto de sub-rutas del flujo no se auditó ahí tampoco. Requiere leer el módulo quirófano completo. |
| `a11y.spec.ts:19` y `fase2/firma-workflow-gate.spec.ts:178,283` | `/encounters` (listado, sin id) | Ya documentado como "listado nunca construido, sin candidato" en `e2e-auditoria-rutas-2026-08-26.md` Bloque B #3,6-7. Sigue sin existir un listado bare de encounters — es deuda de producto, no de test. |
| `fase2/ece-rls-enforcement.spec.ts:78,241` | `/ece/pacientes` | Documentado "sin candidato" pese a que `/patients` existe — la auditoría previa nota correctamente que este test verifica RLS cross-tenant sobre el modelo `ece.paciente`, que es conceptualmente distinto de `public.Patient`/`/patients`. Sustituir la URL cambiaría qué se está probando, no solo el selector. No tocado. |

---

## 4. Qué NO se investigó en este batch

- **Las ~55 rutas/aserciones de la "Ola ECE"** listadas en
  `e2e-inventario-triage-2026-08-29.md` (signos-vitales, maternidad,
  hoja-ingreso, bitácora, historia-clínica, camas-mapa,
  consentimiento-epicrisis, valoración, enfermería, indicaciones, evolución,
  epicrisis, estudios, RRI, periodo-expulsivo, RLS cross-tenant) — cada una
  necesita lectura del componente real contra lo que el spec asume, no es
  candidato a fix mecánico sin esa lectura.
- **La "Ola clínico/transversal"** (who-checklist, patient-mpi/identification,
  bed-map, deaths, portal-arco, pin-lockout, audit, admission-discharge,
  scope-nivel-a/b) — no se tocó, fuera del tope de esta tanda.
- **Ejecución real contra un stack levantado** — sigue bloqueada por
  `docs/runbooks/e2e-gotrue-auth.md` (Docker Desktop roto en máquinas
  previas) y por no tener Docker en este worktree. Todo lo de este documento
  es responsabilidad de quien corra la próxima suite real: verificar que
  estos 6 fixes efectivamente pasan y no solo "dejaron de tener el bug
  obvio".

## 5. Regla operativa para la próxima persona

Antes de tocar más specs de la Ola ECE: leer el `page.tsx` real del módulo
ANTES de adivinar la URL (patrón usado en este documento — `find` sobre
`apps/web/src/app/(clinical)/ece/<módulo>` y comparar contra lo que el spec
asume). Un `tsc --noEmit` puntual contra `e2e/**/*.ts` con
`tsconfig.base.json` (sin publicarlo como script de CI — `e2e/` sigue
deliberadamente fuera del gate de typecheck) es gratis y encuentra bugs de
API de Playwright (como el de `selectOption`/`getByLabelText` de este
documento) sin necesitar el stack levantado.
