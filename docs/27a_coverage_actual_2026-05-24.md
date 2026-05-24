# Coverage actual del proyecto — 2026-05-24

> **Auditor**: @QA — SDET
> **Insumo Sprint 0** de la Fase JCI (necesita global ≥80% para arrancar JCI-1).

## Resumen por workspace

| Workspace | Lines % (estimado) | Gap a 80% |
|---|---|---|
| `@his/contracts` | ~85% | Sobre threshold |
| `@his/infrastructure` | ~78% | -2pp |
| `@his/trpc` | ~70% | -10pp |
| `@his/web` (apps/web) | ~60% | -20pp |
| `@his/database` | excluded (scripts) | N/A |
| `@his/ui` | ~50% | -30pp |
| **Global agregado** | **~72%** | **-8pp** |

> Nota: porcentajes basados en `docs/27_coverage_baseline.md` + observaciones de los últimos sprints. Re-medir con `npx vitest run --coverage` post-merge Ola 1.

## Top 20 archivos con coverage bajo (prioridades Sprint 0)

### Routers tRPC sin tests dedicados
| Archivo | Coverage | Estrategia |
|---|---|---|
| `packages/trpc/src/routers/gs1-medication.router.ts` | <30% | Tests de filtros + markRecall + linkSubstitute |
| `packages/trpc/src/routers/cold-chain.router.ts` | <30% | Tests de lecturas + alertas |
| `packages/trpc/src/routers/staff-gsrn.router.ts` | <40% | Tests de generación GSRN + validación |
| `packages/trpc/src/routers/equipment.router.ts` | <40% | Tests CRUD + cold-chain link |
| `packages/trpc/src/routers/inventory.router.ts` | <40% | Tests FEFO + alerts |
| `packages/trpc/src/routers/ece/atencion-rn.router.ts` | <50% | Tests Apgar + screening |
| `packages/trpc/src/routers/ece/partograma.router.ts` | <50% | Tests curvas alerta/acción |
| `packages/trpc/src/routers/ece/who-checklist.router.ts` | <50% | Tests 3 pausas |
| `packages/trpc/src/routers/ece/sala-expulsion.router.ts` | <50% | Tests eventos JSONB |
| `packages/trpc/src/routers/ece/reanimacion-neonatal.router.ts` | <50% | Tests NRP pasos |

### Pages UI sin tests
| Archivo | Coverage | Estrategia |
|---|---|---|
| `apps/web/src/app/(admin)/equipment/[id]/cold-chain/page.tsx` | <20% | Excluir (página de visualización pura) |
| `apps/web/src/app/(clinical)/ece/partograma/page.tsx` | <20% | Test integración con MSW |
| `apps/web/src/app/(clinical)/ece/urpa/[id]/page.tsx` | <20% | Test snapshot + interacción |
| `apps/web/src/app/(admin)/workflows/[id]/page.tsx` | <30% | Test render + tabs |
| `apps/web/src/app/(clinical)/ece/who-check/page.tsx` | <30% | Test wizard 3 pausas |

### Utils / helpers sin tests
| Archivo | Coverage | Estrategia |
|---|---|---|
| `packages/trpc/src/workflow/transitions.ts` | <60% | Tests canTransition + executeTransition |
| `packages/trpc/src/ece/rls-context.ts` | <70% | Test smoke RLS demote |
| `packages/contracts/src/clinical/forbidden-abbreviations.ts` | N/A nuevo | Crear test al implementar (Fase JCI-1.S2) |
| `apps/web/src/components/gs1-scanner.tsx` | <40% | Test interacción + parsing |
| `apps/web/src/components/triage-timer.tsx` | <50% | Test cuenta regresiva + alerts |

## Estrategia recomendada Sprint 0

### Opción A — Tests reales (~15 SP)
- Agregar 1-2 tests unitarios o de integración por archivo del top 10 router
- Permite coverage real, no inflado

### Opción B — Exclude estratégico (~5 SP)
- Marcar pages UI sin lógica de negocio como `coverage.exclude` en `vitest.config.ts`
- Conservar tests reales para routers + utils
- Coverage llega a 80% más rápido

### Opción C — Híbrida (recomendada, ~10 SP)
- Tests reales para routers top 10 (~7 SP)
- Exclude para pages UI puras de visualización (~3 SP)
- Resultado: 80% coverage con tests significativos

## Estimación SP por strategy

| Strategy | SP | Tiempo (1 dev) | Coverage post |
|---|---|---|---|
| A — Solo tests reales | 15 | ~3 días | 80-82% |
| B — Solo excludes | 5 | ~1 día | 80% (frágil) |
| **C — Híbrida (recomendada)** | **10** | **~2 días** | **80-81% (estable)** |

## Acciones para Ola 2

1. Aplicar Strategy C
2. Re-medir con `npx vitest run --coverage --reporter=json`
3. Validar threshold global ≥80% antes de mergear Sprint 0
4. Documentar excludes con justificación en `vitest.config.ts` comments

## Referencias

- `vitest.config.ts` (raíz) — thresholds + excludes
- `docs/27_coverage_baseline.md` — baseline histórico
- `docs/33_fase_jci_planning.md` § Estrategia testing @QA — política JCI
