# Inventario de componentes huérfanos — 2026-08-26

**@Orq** — Inversiones Avante. Barrido completo (no muestreo) de componentes
React exportados que nadie importa, disparado porque el triage E2E del
2026-08-24 destapó dos casos sin buscarlos (`OfflineBanner`, `ICD10Picker`).
Resultado: **no eran casos aislados — son 25**, 12 de ellos de seguridad del
paciente. Funcionalidad con user story cerrada, código completo, y sin punto
de montaje: «Merged ≠ Done» en su forma más literal.

## Cobertura y método

- `apps/web/src`: 557 `.tsx` → 219 candidatos evaluados (excluidos
  `page/layout/error/loading/not-found/template/default`, tests, stories).
- `packages/ui/src`: 36 componentes (100 %).
- Búsqueda de importadores en `apps/web/src`, `packages/*/src`,
  `apps/web/e2e`, `tests/` (paths relativos, alias y barrels). Tres pases:
  sin importador / solo tests / cascada. Cross-check por nombre de componente.
- `apps/web/src` no tiene ningún barrel → la categoría "solo re-exportado" es
  vacía en la app.
- Límite conocido: imports con path construido dinámicamente en runtime no se
  detectan (mitigado por el cross-check por nombre).

## Conteo

| Categoría | Cantidad |
|---|---|
| **Huérfanos reales en `apps/web/src`** | **25** |
| — sin referencia alguna | 19 |
| — importados solo por tests unitarios | 4 |
| — cascada (solo los importa otro huérfano) | 2 |
| Design system sin consumidores (posible API pública) | 1 (`avatar.tsx`) |
| Reparto por impacto | Tier 1: 12 · Tier 2: 10 · Tier 3: 1 (+2 duplicaciones asociadas) |

## Tier 1 — Seguridad del paciente / continuidad operativa (12)

| Componente(s) | Archivo(s) | US | Consecuencia clínica |
|---|---|---|---|
| `OfflineBanner` + `SyncQueueModal` | `(clinical)/bedside/_components/offline-banner.tsx`, `sync-queue-modal.tsx` | F2.6.48-49 | Enfermería administra medicación (BCMA) sin señal de pérdida de conexión ni de cola pendiente. `bedside/page.tsx` solo importa `BedsideQueueClient`; el `administration-wizard.tsx` no contiene ninguna referencia a `offline`. E2E: `bedside-offline.spec.ts` espera un `role="status"` que nunca se monta. |
| `StatActivationDialog` + `StatBanner` | `(clinical)/bedside/_components/stat-*.tsx` | F2.6.47 | Los hard-stops PACIENTE_NO_COINCIDE / MEDICAMENTO_NO_COINCIDE / FUERA_DE_VENTANA no pueden degradarse a warning en urgencia; no hay indicador de modo excepcional. E2E: `bedside-stat.spec.ts:83` lo admite en comentario. |
| `BarcodeScanner` + `HidScannerInput` | `components/scanner/*.tsx` | F2.6.42-45 | Captura por cámara (datamatrix GS1, code128 GSRN, pdf417 DUI) y pistola HID sin punto de montaje. El JSDoc de `hid-scanner-input` describe un montaje en el layout bedside que no existe. |
| `SubstitutionModal` | `(clinical)/pharmacy/_components/substitution-modal.tsx` | F2.6.11 | La sustitución genérico/comercial que bloquea el despacho hasta decisión médica no existe en UI. E2E: `pharmacy-substitution.spec.ts`. |
| `ICD10Picker` | `(clinical)/ece/icd10-picker/icd10-picker.tsx` | F2.7.33-35 | Sin `page.tsx` ni importadores. Incluye el hard-stop de firma de epicrisis sin CIE-10 (caso ICD-05). |
| `BreakGlassButton` + `BreakGlassModal` | `components/break-glass-*.tsx` | US-2.7 | El backend de break-glass existe pero **no hay puerta de entrada en la UI**: en emergencia ningún clínico puede invocar el acceso excepcional. Sin E2E. |
| `ApgarDisplay` | `components/apgar-display.tsx` | — | Su JSDoc lo declara "reusable en epicrisis, resumen RN, historial" — no está en ninguna. Solo lo importa un test unitario. |
| `SurgeryCaseCard` | `components/surgery/surgery-case-card.tsx` | — | Tarjeta del listado quirúrgico del día, sin listado que la consuma. |
| `Gs1Scanner` | `components/gs1-scanner.tsx` | — | Ver duplicación abajo. |
| `PatientConsents` | `(clinical)/patients/[id]/consents.tsx` | US-2.9 | Su JSDoc: "TODO Sprint 2: integrar al Tabs principal del paciente". Nunca se integró. |

## Tier 2 — Administración (10)

**Workflow Designer: 8 componentes desconectados** — el módulo está mayormente
hueco respecto de sus US: `PublishDialog` (F2.2.06), `ValidationPanel`
(F2.2.05), `VersionDiff` (F2.2.07), `SimulatorDialog` (F2.2.08),
`ExportButtons` (F2.2.11), `EditorPalette` (F2.2.02), `EditorPropsPanel`
(F2.2.03), `EditorToolbar` (F2.2.04). Los tres `editor-*` solo los importa su
test unitario. E2E que asertan sobre esa UI: `workflow-designer-editor.spec.ts:93-98`,
`workflow-publish-rollback.spec.ts:47-56`, `a11y-workflow-designer.spec.ts`.

Además: `OrgSwitcherClient` (`components/org-switcher-client.tsx` — sin él no
hay UI para cambiar de organización) y `PasswordStrengthMeter`
(`components/password-strength-meter.tsx`, US-2.10).

## Tier 3 — Cosmético (1)

`ViewTransitionProvider` + `useViewTransition` (`components/view-transition.tsx`).

## Design system (`packages/ui/src`)

- `avatar.tsx`: 0 referencias en el repo — posible API pública no adoptada,
  no necesariamente defecto.
- Falso positivo aclarado: `states/empty-state.tsx` y `states/error-state.tsx`
  SÍ se consumen vía `states.tsx`.
- Barrel muerto por resolución de módulos: `ui/src/components/states/index.ts`
  es inalcanzable (el mapa `exports` resuelve a `states.tsx`).

## Dos patrones sistémicos

**A. Suites E2E que verifican UI que no existe.** Siete specs asertan sobre
componentes nunca montados: `bedside-offline`, `bedside-stat`, `icd10-cierre`,
`pharmacy-substitution`, `workflow-designer-editor`,
`workflow-publish-rollback`, `a11y-workflow-designer`. O pasan en verde por
selectores permisivos (`.or()`, `first()`, ramas condicionales) o fallan con
diagnóstico equivocado. Sumado a los dos `probeRoute` de la auditoría de rutas
(`docs/qa/e2e-auditoria-rutas-2026-08-26.md`), son **tres mecanismos por los
que la suite reporta cobertura inexistente**.

**B. Reimplementación local en vez de import.** `Gs1Scanner` tiene 2 copias
inline (`(admin)/equipment/[id]/page.tsx:18`,
`(admin)/gs1/transfers/nueva/page.tsx:65`) — parseo de AIs de trazabilidad de
medicamentos con lógica potencialmente divergente entre copias.
`ValidationPanel` ídem en `workflow-designer/[codigo]/page.tsx:79`.

## Decisión pendiente (@PO + Edwin)

Cablear vs. eliminar, por grupo y no por componente. Con 12 en Tier 1 la
respuesta difícilmente sea "eliminar" en bloque; cada cableado es un mini-PR
con su spec E2E des-mentido como criterio de aceptación.

## Remediación — 2026-08-28

Decisión tomada (Edwin): cablear Tier 1 completo + OrgSwitcher/PasswordStrength
de Tier 2, eliminar Tier 3, dedupe de las copias inline. El editor del
Workflow Designer (8 componentes Tier 2) quedó **diferido a decisión aparte**.
Ejecutado en 7 PRs paralelos:

| Componente(s) | PR | Resultado |
|---|---|---|
| `OfflineBanner` + `SyncQueueModal` | #584 | Montados en `bedside/page.tsx` (banner `role="status"`; el modal se abre desde el banner) |
| `StatActivationDialog` + `StatBanner` | #584 | Montados en `administration-wizard.tsx`. ⚠ Solo UI: `bedside.router.ts` no degrada hard-stops server-side (follow-up en curso) |
| `BarcodeScanner` + `HidScannerInput` | #584 | Cámara como toggle por paso del wizard; HID en layout anidado nuevo de bedside (el montaje que describía su JSDoc) |
| `SubstitutionModal` | #581 | Montado en `/pharmacy/dispense/[orderId]`; bloquea validación del ítem hasta autorización médica. ⚠ Destapó routers de dispensación duplicados sin stock-check (follow-up en curso) |
| `ICD10Picker` | #583 | Montado como sección "Diagnóstico CIE-10 de cierre" en `/ece/epicrisis/[id]`. NO obsoleto frente a CIE-11: catálogos coexisten a propósito (CIE-11 = historia clínica; CIE-10 NTEC = cierre epicrisis) |
| `BreakGlassButton` + `BreakGlassModal` | #582 | Montados en `patient-shell-bar.tsx` cuando `patient.get` falla. Follow-up: RBAC intra-org por paciente |
| `ApgarDisplay` | #583 | **NO montado**: exige 5 subpuntajes 0-2 y ningún capturador del repo persiste más que totales 0-10. Gap de datos documentado en el PR con opciones |
| `SurgeryCaseCard` | #579 | Montada en el listado quirúrgico (reemplaza tabla inline; datos 1:1 con el router) |
| `Gs1Scanner` (dedupe) | #585 | Las 2 "copias" NO eran copias (no parsean AIs — una era stub muerto, otra listener HID crudo). Sí había duplicación real no listada: el scanner HID de `gs1/transfers/nueva` clonado en `gs1/transfers/[id]` → extraído a `hid-scan-input.tsx` |
| `PatientConsents` | #579 | Integrado como tab en `patients/[id]` (cierra el TODO Sprint 2 de su JSDoc) |
| Workflow Designer (8) | — | **Diferido** — decisión @PO pendiente |
| `OrgSwitcherClient` | #580, eliminado en fix/password-policy-y-limpieza | **NO montado — premisa del inventario incorrecta**: `OrgRoleSwitcher` ya cubre el caso, montado en los topbars admin y clínico. Componente eliminado (0 imports fuera de sí mismo) |
| `PasswordStrengthMeter` | #580, submit endurecido en fix/password-policy-y-limpieza | Montado en `/recover/reset` y en el reset admin de usuarios, con la política real de `@his/contracts`. Gap cerrado: el submit (cliente y `userAdmin.resetPassword` en servidor) ahora valida con `validatePassword()` completa, símbolo incluido |
| `ViewTransitionProvider` | #585 | Eliminado (0 consumidores confirmado) |
| `ValidationPanel` (dedupe) | #585 | Copia inline (superset) consolidada en el canónico de `_components/` y migrado el consumidor — cierra huérfano y duplicado a la vez |

Specs E2E des-mentidos en estos PRs: `bedside-stat`, `pharmacy-substitution`,
`icd10-cierre` (reescrito: apuntaba al wizard sin picker). `bedside-offline`
ya era estricto. Los de workflow-designer siguen mintiendo hasta que se decida
ese grupo.
