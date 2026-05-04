# G0 Closure Log — Sprint 0 cleanup

> **Sprint 0** — cierre de Gate **G0** del SDLC (Foundation → Phase 1 ready).
> **Sesión:** 2026-05-03 → 2026-05-04 (worktree `claude/infallible-black-f8cb40`).
> **Plan ejecutado:** `~/.claude/plans/recuerdas-donde-nos-quedamos-optimized-meerkat.md`
> **Estado:** **substantial — pendiente smoke manual + branch protection del usuario.**

---

## Contexto previo

Al cierre de la sesión Sprint 0 + 1 + 2 (commits hasta `ba8ad61` en main) el repo tenía 132 archivos / ~20.100 LOC entregados pero **EV-DoD = 0 %**: nada compilado, ni tipo-verificado, ni desplegado contra una base real. Memoria 2026-04-30 lo anotaba explícitamente. La meta de este ejercicio fue convertir EV-físico → EV-DoD.

---

## Lo que se hizo, fase por fase

### Fase 1 — Dependencias + Prisma generate ✅
- `npm install --workspaces --include-workspace-root` — 677 packages, 47 s, exit 0.
- `prisma generate` no se disparó solo desde `postinstall` con `--workspaces`; se invocó explícito vía `npm run db:generate`. Cliente generado en `node_modules/@prisma/client`.

### Fase 2 — Typecheck + lint verde ✅
Surfaceó **6 gaps de Sprint 0 setup** (no de Sprint 1/2) que la sesión foundational nunca había validado:

| # | Gap | Fix |
|---|---|---|
| 1 | `packages/config/*` faltaba en `workspaces[]` raíz → `@his/eslint-config` no resolvía | Añadido al patrón |
| 2 | `@his/ui` sin `.eslintrc.cjs` | Creado extendiendo `@his/eslint-config` |
| 3 | `@his/web` extendía `next/core-web-vitals` directo, sin `@typescript-eslint` | Extiende `@his/eslint-config/next` |
| 4 | `@his/ui/tsconfig.json` incluía `tailwind.config.ts` fuera de `rootDir: src` | Removido del `include` |
| 5 | `@his/ui` script `type-check` (kebab-case) — turbo busca `typecheck` | Renombrado |
| 6 | 8 instancias de `"` sin escapar en JSX (`react/no-unescaped-entities`) en exchange-rates / ledger | `&quot;` |

Resultado: `npm run typecheck` y `npm run lint` verdes en **7/7** workspaces. Commit `c66fd67`.

### Fase 3 — Provisión Supabase + .env.local ✅

Hubo dos confusiones de cuenta antes de llegar al proyecto correcto:
1. PAT inicial era de otra cuenta Supabase (proyectos `mantto`, `drweb`, `FollowupGantt` — no HIS).
2. Project ref correcto: **`ejacvsgbewcerxtjtwto`** (us-west-2), distinto al `bpiugqsjnlwqfhbnkirh` inicialmente compartido.

Configuración final:
- `.env.local` (gitignored) con `DATABASE_URL`, `DIRECT_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `AUTH_SECRET` (random 32-bytes base64).
- `packages/database/.env` (gitignored) con `DATABASE_URL`/`DIRECT_URL` para que `npm run db:seed` funcione (lee `--env-file=.env`).
- `.mcp.json` apuntando a stdio + PAT (corregido a project_ref real). Commits `5b84378` + `cbeb3c3`.

Pendientes en `.env.local` (placeholders):
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — JWT `eyJ...` legacy del tab "Legacy API keys" del nuevo proyecto.
- `SUPABASE_SERVICE_ROLE_KEY` — JWT del mismo tab, marcado `service_role`.

### Fase 4 — Schema + 5 SQL DDL ✅

Inventario pre-fase reveló que la DB ya tenía aplicados desde una sesión anterior:
- 61 tablas (schema completo)
- 42 RLS policies (`01_rls_policies.sql`)
- Funciones `current_org_id`, `current_user_id`

Faltaban 4 DDLs. Aplicados ahora con `packages/database/scripts/apply-sql.mjs` (driver `pg` directo, SSL explícito porque pg-connection-string convierte `sslmode=require` → `verify-full` en pg v8+):

| Archivo | Aporta |
|---|---|
| `02_audit_triggers.sql` | `audit.fn_audit_row` (append-only) |
| `03_validations_sv.sql` | `validate_dui` / `validate_nit` / `validate_nie` + `trg_validate_patient_identifier` |
| `04_rls_session_helpers.sql` | `set_tenant_context` / `clear_tenant_context` (idempotente sobre RLS existente) |
| `05_audit_hash_chain.sql` | `fn_compute_chain_hash` / `fn_verify_chain` / `fn_chain_stats` |

Verificación post: 8 funciones DDL custom + 45 triggers no internos + 42 RLS policies preservadas. Commit `73d34a6`.

### Fase 5 — Seeds ✅

`npm run seed` y `npm run seed:sv-extra` corridos exitosamente. Idempotencia confirmada (re-run produce upserts, no duplicados). Estado final:

| Tabla | Filas | Origen |
|---|---|---|
| Country | 1 | seed (SLV) |
| GeoDivision | 57 | seed (14 deptos) + seed-sv-extra (43 municipios) |
| Currency | 3 | seed (USD, SVC, BTC) |
| Organization | 3 | seed (holding + 2 subsidiarias) |
| Establishment | 1 | seed (Hospital Avante Central) |
| ServiceUnit | 10 | seed |
| TriageLevel | 5 | seed (Manchester L1-L5) |
| Permission | 17 | seed |
| Role | 8 | seed |
| Holiday | 12 | seed-sv-extra (SV 2026) |
| User | 1 | preexistente (admin Edwin Martinez, 3 org-roles `Administrador`) |

### Fase 6 — Tests verde ✅

**271 tests pasando, 1 skipped** (de 39 trpc + 233 contracts).

Tres correcciones reales hechas para llegar ahí:

1. `catalog.router.test.ts` test 1 — asumía `activeOnly=true` por default, pero el schema Zod tiene `default(false)` (consistente con `catalog-table.tsx` que muestra inactivos por default en admin UI). Renombrado test y forzado `activeOnly: true` explícito.
2. `catalog.router.test.ts` test 2 — usaba `code: "MED"` para occupation, pero el schema requiere `ciuoCode` (CIUO-08). Schema también injecta `active: true` por default. Fix ambos.
3. `rls-isolation.test.ts` — tests 3 y 4 fallaban porque rol `postgres.<ref>` de Supabase tiene **BYPASSRLS**. Solución: `SET LOCAL ROLE authenticated` dentro de cada transacción. En runtime real (vía Supabase Auth/PostgREST) ese demote ocurre automático; con conexión Prisma directa hay que hacerlo explícito en tests. RLS policies validadas funcionando: aislamiento cross-org real, sin contexto deniega todo, break-glass permite cross-org. **4/4 RLS isolation tests verde.**

Adicional: `RUN_RLS_TESTS` agregado a `turbo.json:globalEnv` para que turbo lo propague a workspaces. Commit `03d9833`.

### Fase 7 — Build + dev smoke (parcial) ✅✋

- `npm run build` verde — 1 m 27 s, 27+ rutas built (admin, clinical, dashboard, login, MFA, etc.). Mix static/dynamic per Next conventions.
- `npm run dev` arranca sin errores. Verificación HTTP:
  - `/` → 307 (redirect a `/login`, esperado para no-auth)
  - `/login` → 200 (renderiza)
- **Smoke manual completo (login → paciente con DUI → admit → triage rojo) pendiente** porque requiere keys reales de Supabase Auth (anon JWT + service_role) y ejecución interactiva en navegador.

### Fase 8 — Branch protection en main 🟦 PENDIENTE

Acción del usuario en https://github.com/edwinaml-su/his/settings/branches:
- Require pull request before merging (1 approval)
- Require status checks: `ci`, `db-migrate`, `e2e`, `security` (los 4 workflows ya existen en `.github/workflows/`)
- Require branches up to date
- No force push, no delete

---

## Verificación criterios G0 (plan)

| Criterio | Estado |
|---|---|
| `npm install` sin errores | ✅ |
| `npm run typecheck` verde | ✅ 7/7 packages |
| `npm run lint` verde | ✅ 7/7 packages |
| `npm run build` verde | ✅ 1 m 27 s |
| `npm run test` ≥ 80 % en críticos | ✅ 271 passing, 1 skipped |
| `RUN_RLS_TESTS=1 npm run test` — `rls-isolation` verde | ✅ 4/4 |
| 3 E2E mínimos verdes (auth, admission, triage) | ❌ pendiente keys reales |
| Smoke manual: login → paciente DUI → admit → triage | ❌ pendiente Edwin |
| Supabase project provisionado, 5 SQL aplicados, seeds, primer admin | ✅ |
| Branch protection activa en `main` | ❌ pendiente Edwin (web UI) |
| Tag `v0.1.1-g0-closed` creado | ❌ pendiente smoke + protection |

**7 / 11** criterios cumplidos automáticamente. Los 4 restantes requieren acción manual del usuario.

---

## Lo que falta para tag `v0.1.1-g0-closed`

1. **Pegar 2 keys legacy** del proyecto Supabase HIS (`ejacvsgbewcerxtjtwto`):
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (JWT `eyJ...` con `role:anon`)
   - `SUPABASE_SERVICE_ROLE_KEY` (JWT `eyJ...` con `role:service_role`)
   Ubicación: Settings → API Keys → tab **Legacy API keys** del proyecto.

2. **Smoke manual** corriendo `npm run dev` y probando en navegador:
   - Login con credencial Supabase Auth de `emartinez@complejoavante.com`
   - Crear paciente nuevo con DUI válido (validador SV debe aceptar — verificado en BD que `validate_dui` está activo)
   - Admitir paciente a urgencias
   - Triage rojo (Manchester L1) → asignación cama

3. **3 E2E Playwright** pasando con keys reales:
   - `auth.spec.ts`
   - `admission.spec.ts`
   - `triage.spec.ts`

4. **Branch protection en main** (acción manual web UI GitHub).

5. **Tag y release** con resumen de lo hecho:
   ```cmd
   git tag -a v0.1.1-g0-closed -m "G0 closed — Sprint 0 cleanup completo, EV-DoD > 0"
   git push origin v0.1.1-g0-closed
   gh release create v0.1.1-g0-closed --title "v0.1.1 — G0 Closed" --notes-from-tag
   ```

---

## Higiene de credenciales pendiente (importante)

A lo largo de este cierre se compartieron en chat:
- 1 PAT de Supabase (`sbp_fce2710d...0550`) — rotar en https://supabase.com/dashboard/account/tokens
- 2 passwords (`Avante2026$`, `FollowupGantt2026$`, `2026his2026$`) — al menos la del HIS rotar

`.env.local` y `packages/database/.env` están gitignored y nunca llegaron al repo. El user-level env var `SUPABASE_ACCESS_TOKEN` (Windows registry HKCU\Environment) tiene el PAT viejo — actualizarlo cuando se genere uno nuevo.

---

## Backlog Sprint 3 surfaceado durante el cierre

- Hash chain de `audit.AuditLog` aún sin tests de carga concurrente (RELEASE_NOTES Sprint 2 ya lo flagea).
- Patient unmerge no reversiona FK transitivos (RELEASE_NOTES Sprint 2).
- Race condition en bed status (RELEASE_NOTES Sprint 2).
- Considerar mover `SET LOCAL ROLE authenticated` al runtime path en `applyTenantContext` para que Prisma queries de la app **también** respeten RLS (defensa en profundidad). Hoy la app filtra solo en aplicación.
- 3 archivos npm install warnings deprecation (eslint 8.57.1, glob, etc.) — actualizar cuando se desbloquee Next.js compatibility.
