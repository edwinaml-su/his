# Auditoría de destinos de navegación E2E vs. rutas reales — 2026-08-26

**@QA/@Orq** — Inversiones Avante. Auditoría estática previa al inventario
completo de la suite Playwright: mapa de todas las rutas servibles del App
Router contrastado contra cada destino de `page.goto()` de los 81 specs.
Motivación: el triage del run 32743465580 (`docs/qa/e2e-triage-2026-08-24.md`)
reveló specs que navegaban a páginas inexistentes; antes de gastar ~30 min de
CI en el inventario, se midió el tamaño total del problema.

## Conteo ejecutivo

| Métrica | Valor |
|---|---|
| Rutas de página reales | 294 (+18 API routes) |
| **Destinos rotos únicos** | **24** |
| Call-sites de navegación rotos | 32 (25 con impacto real en CI, 7 fallbacks muertos) |
| Specs afectados | 15 |
| Tests en specs afectados (blast radius) | 102 |
| Tests que ejecutan una navegación 404 | ~30 |
| Con ruta real candidata inequívoca (fix mecánico) | 11 |
| Sin candidato → decisión de producto | 13 |

**La hipótesis "prefijo de route group" NO es la causa dominante**: solo 3 de
24 son de esa clase. El resto: rutas de módulo inventadas o renombradas
(`/ece/mar` → el MAR real es `/emar`; `/ece/cirugia/*` → el módulo es
`quirofano`; `/outpatient/appointments/*`; `/ece/pacientes` → `/patients`),
typos de género (`nueva` vs `nuevo`), y **listados que nunca se construyeron**
(`/encounters`, `/admission/new`, `/triage/pending`) — estos últimos son deuda
de producto, no de test.

## Hallazgos del mapa que evitan falsos positivos

- `next.config.mjs:159-174` define redirects permanentes `/ece/triaje[/*]` →
  `/triage`: los specs que van ahí NO están rotos.
- `src/middleware.ts` no hace rewrites de path — no hay aliasing que rescate
  rutas inexistentes.
- Directorios que parecen rutas pero no tienen `page.tsx`:
  `(clinical)/encounters/` (solo `[id]/...`), `(clinical)/admission/[id]/`
  (solo `confirm/` y `timeline/`), `(clinical)/triage/[id]/` (solo
  `discriminators/`, `flowchart/`, `vitals/`), `(clinical)/ece/icd10-picker/`
  (solo el componente), `(admin)/firma-electronica/` (solo `setup/`).

## Bloque A — ya diagnosticados (estado al 2026-08-26)

| Spec | Ruta | Estado |
|---|---|---|
| `audit-dashboard.spec.ts:17` | `/audit-dashboard` | corregido (PR #568) |
| `audit-trail.spec.ts:29` | `/audit` | corregido (PR #568) |
| `comite-minuta.spec.ts:26-27` | `/ece/comite`, `/ece/calidad-documental` | corregido (PR #568) |
| `auth.spec.ts:40` | `/signup` | corregido (PR #568) |
| `pin-lockout.spec.ts:19` | `/admin/firma-electronica` | ROTO → candidato `/firma-electronica/setup` (sesión aparte en curso) |
| `icd10-cierre.spec.ts:26` | `/admin/ece/icd10-picker` | ROTO pero la constante nunca se usa en un `goto` — código muerto, 0 impacto CI |

## Bloque B — rotos nuevos con impacto real

| # | Spec:línea | Ruta usada | Causa | Candidato |
|---|---|---|---|---|
| 1-2 | `a11y.spec.ts:18,52` | `/triage/pending` | página inexistente | sin candidato |
| 3 | `a11y.spec.ts:19` | `/encounters` | listado nunca construido | sin candidato |
| 4 | `a11y.spec.ts:20` | `/admission/new` | `admission/[id]` sin `page.tsx`; `new` cae como `[id]` | sin candidato |
| 5 | `dod/a11y-baseline.spec.ts:24` | `/admin` | prefijo de route group | `/dashboard` |
| 6-7 | `fase2/firma-workflow-gate.spec.ts:173,278` | `/encounters` | listado nunca construido | sin candidato |
| 8-9 | `fase2/ece-rls-enforcement.spec.ts:91,254` | `/ece/pacientes` | página inexistente | sin candidato (el listado real es `/patients`) |
| 10 | `ece/ece-flujo-hospitalario-completo.spec.ts:99` | `/ece/orden-ingreso/nueva` | typo de género (carpeta `nuevo/`) | `/ece/orden-ingreso/nuevo` |
| 11 | `ece/ece-flujo-hospitalario-completo.spec.ts:185` | `/ece/valoracion-enfermeria/nueva` | nombre incompleto | `/ece/valoracion-inicial-enfermeria/nueva` |
| 12 | `ece/ece-flujo-hospitalario-completo.spec.ts:336` | `/ece/mar` | el MAR vive fuera de `/ece` | `/emar` |
| 13 | `ece/ece-flujo-hospitalario-defuncion.spec.ts:80` | `/ece/orden-ingreso/nueva` | typo de género | `/ece/orden-ingreso/nuevo` |
| 14 | `ece/ece-flujo-hospitalario-defuncion.spec.ts:150` | `/ece/valoracion-enfermeria/nueva` | nombre incompleto | `/ece/valoracion-inicial-enfermeria/nueva` |
| 15 | `ece/ece-flujo-obstetrico-completo.spec.ts:102` | `/ece/obstetricia/admision` | página inexistente | sin candidato |
| 16 | `ece/ece-flujo-quirurgico-completo.spec.ts:113` | `/ece/cirugia/programar` | módulo real es `quirofano` | `/ece/quirofano/programacion/nueva` (alta confianza, verificar) |
| 17 | `integration/cross-sprint.spec.ts:492` | `/emar/administrar` | página inexistente | ambiguo (`/emar` o `/emar/new`) |
| 18-20 | `outpatient/double-booking-prevention.spec.ts:30` | `/outpatient/appointments/new` + 2 fallbacks | módulo `appointments` no existe | `/outpatient/new` |
| 21-22 | `outpatient/double-booking-prevention.spec.ts:178-179` | `/outpatient/appointments`, `/appointments` | ídem | `/outpatient` |

## Bloque C — fallbacks muertos (sin impacto: el 1er candidato del array existe)

- `emergency/disposition-state-machine.spec.ts:31` — `/atención-emergencia`,
  `/atencion-emergencia` (nunca alcanzados; `/emergency` existe).
- `inventory/fefo-pick.spec.ts:39` — `/farmacia`, `/fase2/pharmacy`,
  `/pharmacy/picking` (nunca alcanzados; `/pharmacy` existe).
- `ece/ece-rls-cross-tenant.spec.ts:155` — `/ece/pacientes`,
  `/ece/lista-pacientes` (404 pero el loop cae a `/patients`).

## Hallazgo transversal: dos `probeRoute` homónimos con semántica opuesta

- **Variante A (`status < 500` → true):** `ece/ece-flujo-hospitalario-completo:50`,
  `-defuncion:33`, `-obstetrico:46`, `-quirurgico:40`,
  `ece-mapa-camas-asignacion:29`. Un 404 pasa la sonda y el test continúa
  contra la página de error → fallos fantasma en aserciones posteriores, sin
  pista de la causa real.
- **Variante B (`if (status === 404) return`):** `ece-flujo-ambulatorio:65`,
  `ece-rls-cross-tenant:82`, `ece-roles-permisos:45`,
  `integration/cross-sprint:45`, `fase2/ece-rls-enforcement:64`. El test se
  auto-skipea en silencio y **reporta verde** → cobertura que figura como
  existente y no existe. La clase más peligrosa — mismo patrón que el `@smoke`
  muerto 10 runs seguidos (2026-08-18).

**Remediación (Lote 2):** helper compartido único en `e2e/_helpers` que FALLA
con mensaje explícito (`ruta inexistente: X`) ante 404, migrando los 10
call-sites.

## Reparto del trabajo

1. **11 fixes mecánicos** (Bloque B con candidato) — Lote 2 @QA.
2. **13 sin candidato** — backlog @PO: decidir si `/encounters`,
   `/triage/pending`, `/admission/new`, `/ece/obstetricia/admision` etc. deben
   existir como páginas o los specs deben reescribirse contra las rutas reales.
3. `pin-lockout` e `icd10-cierre` — excluidos del Lote 2: hay una sesión
   aparte trabajándolos (task spawn 2026-08-26).
