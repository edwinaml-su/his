# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Idioma del proyecto: **español (es-SV)**. La mayoría de comentarios, docs, commits y PRs van en español. Identificadores de código en inglés.

---

## Stack y comandos esenciales

Turborepo + npm workspaces. **Node 24.x** (`engines` lo fija exacto, no es un mínimo), npm ≥ 10 (`packageManager: npm@11.9.0`). Stack: **Next.js 16 App Router + React 19** + tRPC v11 + Prisma 5 + Postgres 15 (Supabase) + Tailwind/Shadcn.

Versiones instaladas (verificado 2026-08-18 — si tocás una, actualizá esta tabla en el mismo PR):

| Pieza | Versión | Nota |
|---|---|---|
| Node / npm | 24.x / 11.9.0 | Alineado en `engines`, `ci.yml`, `Dockerfile` y K8s. Next 16 exige ≥ 20.9 |
| Next.js | 16.3.1 | Migrado desde 14 en #534 (2026-08-17). `headers()` es **async** |
| React / React DOM | 19.2.8 | Pineado exacto vía `overrides` en la raíz |
| TypeScript | 5.9.3 | Declarado `^5.6.3`; Dependabot ignora el mayor a 6 |
| Turborepo | 2.9.16 | |
| tRPC | 11.17.0 | El `package.json` aún declara `^11.0.0-rc.660`, pero resuelve a estable |
| Prisma / @prisma/client | 5.22.0 | `prisma generate` obligatorio en `installCommand` de Vercel |
| Postgres | 15 (Supabase) | 227 SQL numerados en `packages/database/sql/` — ver §Motor de workflow |
| Tailwind | 3.4.19 | + Shadcn en `@his/ui` |
| Zod | 3.25.76 | Base de `@his/contracts` |
| Supabase JS / SSR | 2.108 / 0.5.2 | Auth vía `signInWithPassword`, no credenciales locales |
| Vitest | 2.1.9 | Dependabot ignora el mayor a 4 |
| Playwright | 1.60 | `workers: 1`, BD compartida |
| Sentry | 10.70 | Requiere `SENTRY_DSN` para activarse |

**Cuidado con los bumps mayores:** `.github/dependabot.yml` ignora `semver-major` global y `semver-minor` en 13 librerías 0.x, por historia pagada (Next 14→16, TS 5→6, Vitest 2→4, Prisma 5→7, tiptap-markdown 0.8→0.9). Si un bump rompe CI: revertir y cerrar el PR de Dependabot, no arreglar el breaking en caliente.

```bash
# raíz (turbo orquesta los workspaces)
npm run dev                # next dev + watchers (puerto 3000)
npm run build              # build de todos los workspaces
npm run typecheck          # tsc --noEmit en cascada
npm run lint               # next lint + eslint por package
npm run test               # vitest en todos los workspaces (CI gate)
npm run test:coverage      # ⚠️ aggregate con thresholds (ver abajo)
npm run test:e2e           # Playwright (serial: 1 worker, shared DB)
npm run format             # prettier write

# base de datos
npm run db:generate        # prisma generate (corre en postinstall también)
npm run db:migrate         # prisma migrate dev — solo en dev local
npm run db:seed            # carga catálogos base (SLV, monedas, Manchester)
npm run db:studio          # prisma studio
```

**Un solo test / archivo:**
```bash
npx vitest run packages/contracts/src/validators/__tests__/dui.test.ts
npx vitest run -t "validateDUI"          # por nombre
npx playwright test e2e/triage-manchester.spec.ts --headed
```

**Workspace específico:** `npm run -w @his/web test`, `npm run -w @his/database generate`, `npm run -w @his/trpc test`, etc.

---

## Layout monorepo

```
apps/web/                  # Next.js App Router. Rutas en grupos: (admin) / (auth) / (clinical)
packages/
  database/                # schema.prisma (4NF) + sql/ (RLS + hardening + workflow seed) + seeds
  contracts/               # Zod schemas (ECE+GS1 re-exportados), validadores SV (DUI/NIT/NIE), eventos
  trpc/                    # 152 routers (102 raíz + 50 en routers/ece/), trpc.ts, rls-context.ts ⚠ §RLS
  infrastructure/          # observability (slo-checks), firma/argon2, motor de fórmulas clínicas, adaptadores externos
  ui/                      # design system Shadcn/Tailwind compartido ⚠ sin script `test`: sus tests NO corren en CI
  bi/                      # capa analítica (dashboards/KPIs)
  test-utils/              # fixtures (DUI válidos, pacientes, encounters), mock-session
  config/eslint/           # config compartida
tests/features/            # Gherkin (.feature) — BDD de @QAF, no ejecutables, son spec
docs/                      # docs numerados + flujos/ (30 fichas NTEC) + adr/ + blueprints/ + runbooks/ + uat/ + CC/
infra/                     # k8s/ (base + overlays), k6/ (perf), observability/, docker/, terraform/ (placeholder)
scripts/                   # diagnose-supabase-env.mjs, db-reset, setup, golive-checklist, gotrue-test-* (E2E)
```

Los 9 workspaces (`apps/web` + los 8 `packages/*`) deben estar espejados en el stage `deps` del `Dockerfile`: `npm ci` con workspaces exige que cada `package.json` del lockfile esté presente.

**Sin carpeta `prisma/migrations`.** El flujo es **schema.prisma + SQL files numerados en `packages/database/sql/`** aplicados vía Supabase SQL Editor / MCP. Es deliberado. No corras `prisma migrate dev` contra el proyecto Supabase de producción.

---

## Contrato RLS — léase antes de tocar routers Prisma

Multi-tenancy se aplica por **Row Level Security** en Postgres (`organization_id` + `auth.jwt`). El rol original de Supabase (`postgres.<ref>`) tiene **BYPASSRLS**. Es decir: si haces `prisma.patient.findMany()` directo desde un router, **RLS no aplica** y el filtro tenant vive solo en JS.

Por eso existe `withTenantContext` en `packages/trpc/src/rls-context.ts`:

```ts
import { withTenantContext } from "@his/trpc/src/rls-context";

const patient = await withTenantContext(prisma, ctx.tenant, async (tx) => {
  return tx.patient.findFirst({ where: { id } });
});
```

- Hace `SET LOCAL` de `app.current_user_id` / `app.current_org_id` / `app.is_break_glass`.
- **Demota a rol `authenticated`** (`SET LOCAL ROLE authenticated`) → ahí sí aplica RLS.
- Solo funciona **dentro de una transacción** (`SET LOCAL` es scoped). Fuera de tx es no-op silencioso.
- Opt-out: `withTenantContext(..., { demoteRole: false })` para seeders/admin.

**No bypass este contrato.** Si un router nuevo lee/escribe data tenant-scoped y no usa `withTenantContext`, eso es un hallazgo de seguridad — el filtro `where: { organizationId: ctx.tenant.organizationId }` es defensa débil y se ha bypaseado en el pasado.

### Procedures tRPC disponibles (`packages/trpc/src/trpc.ts`)
- `publicProcedure` — sin sesión.
- `protectedProcedure` — requiere `ctx.user`.
- `tenantProcedure` — requiere `ctx.tenant` (org seleccionada).
- `requireRole(["PHYSICIAN", "NURSE"])` — wrapper sobre `tenantProcedure`.

Contexto se arma en `apps/web/src/lib/trpc/` (server side) leyendo cookies `his.org` / `his.estab` + Supabase auth.

---

## Motor de workflow ECE (data-driven)

El catálogo de documentos clínicos NTEC vive en BD, no en código. Las 4 tablas + 2 funciones que componen el motor:

- **`ece.tipo_documento`** — 31 tipos sembrados; columnas clave: `codigo` (PK semántica), `depende_de` (text[] de códigos prerequisito), `inmutable` (bool), `modalidad` (ambulatorio/hospitalario/ambos), `tabla_datos` (tabla física de payload), `descripcion_markdown` (renderizada por workflow-designer WYSIWYG).
- **`ece.flujo_estado`** — estados por tipo (`borrador`/`en_revision`/`firmado`/`validado`/`anulado` estándar; algunos tipos como URPA tienen modelo propio).
- **`ece.flujo_transicion`** — acciones permitidas entre estados con `rol_autoriza_id` + `requiere_firma`.
- **`ece.documento_instancia`** — instancias reales por episodio/paciente.
- **`ece.tipo_documento_establecimiento`** — overrides DIR por establecimiento (`obligatorio_override`, `depende_de_override`, `activo_override`).
- **`ece.fn_depende_de_efectivo(tipo_id, estab_id)`** — STABLE; resuelve override sobre global.
- **`ece.fn_assert_dependencias_firmadas`** — trigger BEFORE INSERT en `documento_instancia`; bloquea creación si deps no firmadas (override por GUC `app.skip_dependencias_enforcement='true'` para seeders).

**Capa TS paralela:** `packages/trpc/src/ece/dependencias-enforcement.ts` — helper `assertDependenciasFirmadas()` lanza `TRPCError code='PRECONDITION_FAILED'` con `cause.dependenciasFaltantes`. Cableada en `workflow-instance.router.create`. Estados aceptados como "firmado": `firmado`, `validado`, `certificado`, o cualquier `es_final=true`.

**UI**: `/admin/workflow-designer` (lista + grafo + editor WYSIWYG TipTap), `/admin/workflow-overrides` (DIR), wizard "próximos documentos" en `/ece/episodio-hospitalario/[id]`.

**Fuentes de verdad**: `docs/31_flujos_operativos_consolidado.md` (índice) + `docs/flujos/{CODIGO}.md` (30 fichas con metadata + dependencias + roles + eventos por documento NTEC).

---

## Audit hash chain (TDR §6.3, SQL `02_audit_triggers.sql` + `05_audit_hash_chain.sql`)

Toda escritura a tablas auditadas dispara un trigger que inserta en `audit.audit_log` con:
- `prev_hash` ← último hash de la cadena por tabla
- `payload_hash` ← SHA-256 del payload JSON
- `chain_hash` ← SHA-256(prev_hash || payload_hash)

Esto da **inmutabilidad criptográfica** (10 años retención). El router `auditIntegrityRouter` verifica la cadena. **Nunca** hagas UPDATE/DELETE a `audit_log` desde código de aplicación — el `service_role` puede pero la verificación de cadena detectará la ruptura.

---

## Validadores SV — paridad TS ↔ SQL

`validateDUI` / `validateNIT` / `validateNIE` viven en `packages/contracts/src/validators/index.ts` y **deben mantener paridad** con `packages/database/sql/03_validations_sv.sql`. Hay tests fixture-based en `packages/contracts/src/validators/__tests__/`. Si modificas el algoritmo de check digit en un lado, actualiza el otro.

---

## Vitest — thresholds y workspaces

`vitest.config.ts` raíz **agrega** los workspaces y aplica thresholds en `npm run test:coverage`:

| métrica | mínimo |
|---|---|
| lines | 80 |
| functions | 80 |
| branches | 75 |
| statements | 80 |

CI ejecuta `npx turbo run test -- --coverage`. El `--` es necesario o turbo intercepta `--coverage` y falla. **Lección Wave 6:** skeletons sin tests rompen el threshold global aun si no tienen lógica — agrega un test trivial o exclúyelos en `coverage.exclude`.

`passWithNoTests: false` — un workspace sin tests falla.

---

## E2E (Playwright)

- `fullyParallel: false`, `workers: 1` — los specs comparten BD efímera, no paralelizar.
- `locale: "es-SV"`, `timezoneId: "America/El_Salvador"` — fijos.
- Test users en `apps/web/e2e/_helpers`: `qa.admin@his.test`, `qa.triagist@his.test` (password `TestPass123!`). Se siembran desde `packages/database/scripts/seed-test-users.mjs` **contra un backend de auth**, no en la BD local: el login de la app usa `supabase.auth.signInWithPassword`, no `UserCredential`.
- **El stack de test levanta su propio Supabase Auth** (`docker-compose.test.yml`): Postgres + GoTrue + un gateway nginx. El gateway es obligatorio: GoTrue monta sus rutas en la raíz (`/admin/users`, `/token`), mientras que `supabase-js` siempre construye `${url}/auth/v1/...` — ese prefijo lo sirve Kong en Supabase real. Sin el gateway, todo da 404.
- `.github/workflows/e2e.yml` corre nightly + workflow_dispatch; `e2e-smoke.yml` corre el subconjunto `@smoke` en cada PR.
- ⚠️ **`@smoke` sigue rojo**: el stack levanta healthy pero el seed falla con `500 Database error checking email`, y las 77 specs nunca corrieron contra auth real (esperar fallos de producto acumulados). Detalle completo en `docs/runbooks/e2e-gotrue-auth.md`.

---

## CI/CD

12 workflows. Los marcados **[req]** son *required status checks* de `main` (ver §Convenciones):

| workflow | trigger | qué hace |
|---|---|---|
| `ci.yml` **[req]** | push/PR a `main`/`develop` | typecheck + lint + test (coverage) + build + a11y placeholder |
| `release-image.yml` **[req]** | push a `main`, tags `v*`, PR, manual | build imagen → GHCR (`ghcr.io/edwinaml-su/his-web`) + escaneo Trivy. arm64 solo en tags `v*`/manual (QEMU es lento) |
| `a11y.yml` **[req]** | push/PR + nightly | axe-core WCAG 2.1 AA sobre 5 páginas baseline |
| `e2e-smoke.yml` | PR a `main`/`develop` | Playwright `@smoke` contra stack efímero (Postgres + GoTrue + gateway nginx) |
| `e2e.yml` | nightly + manual | suite Playwright completa |
| `security.yml` | semanal + push que toque deps | `npm audit signatures` + audit high+ + SBOM CycloneDX + gitleaks |
| `security-alerts.yml` | cada 4 h + manual | OWASP A09: advisors Supabase CRITICAL + cadena de auditoría + rate limit |
| `compliance.yml` | nightly | suite JCI |
| `backup-drill.yml` | programado | simulacro de restore (DR) |
| `perf.yml` | nightly + manual | Lighthouse contra producción ⚠ consume credenciales de prod **sin `environment:` protegido** |
| `perf-k6.yml` | manual | carga k6; `base_url` es `required` sin default, a propósito |
| `db-migrate.yml` | manual | **inerte**: aborta fail-fast porque no existe `prisma/migrations` (ver abajo) |

**El contexto `secrets` NO es válido en `if:` de un step.** GitHub rechaza el archivo entero y el workflow falla en 0 s sin correr nada — `perf.yml`, `perf-k6.yml` y `security-alerts.yml` estuvieron así, inertes y sin que nadie lo notara, desde #534 hasta el 2026-08-18. Declará el secret en el `env:` del job y evaluá `if: env.X != ''`. Señal de diagnóstico: si `gh workflow list` muestra el **path del archivo** en vez del `name:`, GitHub no logra parsearlo.

Antes de afirmar que un workflow protege algo, comprobá que **haya corrido**: `gh run list --workflow=<archivo>`.

Deploy app: **Vercel** (`vercel.json`). `installCommand: "npm ci && npm run -w @his/database generate"` — sin el `prisma generate` el build falla porque el client tipado no existe.

**Alternativa cloud-agnostic:** `Dockerfile` multi-stage (Node 24-alpine, non-root uid 1001, `tini`, standalone) + manifiestos en `infra/k8s/` (base + overlays staging/prod, HPA, PDB, las 3 probes). La app **es** portable; la base de datos **no** (ver `docs/runbooks/db-reconstruccion-fuera-de-supabase.md`: 77 de 227 SQL fallan sobre un Postgres limpio).

---

## MCPs configurados (importante)

- **`mcp__supabase__*`** → proyecto HIS (`ejacvsgbewcerxtjtwto.supabase.co`). Configurado en `.mcp.json` con `SUPABASE_ACCESS_TOKEN` desde env. Usar SIEMPRE estos para operar la BD del proyecto.
- **`mcp__15671ac5-*`** (si aparece) → cuenta personal del usuario (otros proyectos). **NO usar para HIS.**

Para aplicar SQL hardening / RLS al proyecto Supabase remoto: `mcp__supabase__apply_migration` o `mcp__supabase__execute_sql`. Antes de cambios de schema, usa `list_tables` y `get_advisors` para entender estado actual.

---

## Framework de trabajo (mandatorio — directiva permanente)

**1. SDLC autónomo @Orq** — todo trabajo respeta el framework descrito en `C:\proyecto\knowledge\sdlc_system_prompt.md` (14 agentes, 6 fases, gates G0–G8). Roles: `@Orq` orquesta y NO escribe código; `@Dev` implementa; `@AE/@AS/@AT/@DA/@DBA` arquitectura; `@PO` backlog; `@UIUX` interfaz; `@QA/@QAF` calidad; `@DrHIS` tester funcional clínico y de cumplimiento SV (ver `.claude/agents/drhis.md` + `docs/qa/drhis/`); `@SRE` ops; `@DA/@DE/@BIA/@BID` BI. Invoca al rol vía `Skill(<nombre>)` o `Agent(subagent_type=<nombre>)`. Solo `@Orq` declara "Project Completed" — y solo post-G8 con firmas de @AE/@QA/@QAF/@SRE.

**2. `careful-coding` obligatorio** — invoca `Skill(anthropic-skills:careful-coding)` al inicio de CUALQUIER tarea que toque código (escribir/editar/revisar/refactorizar). Al delegar a sub-agentes, incluye en el briefing: "sigue los principios de /careful-coding". Solo skipear en one-liners triviales o preguntas puramente conversacionales.

**3. Definition of Done (@QA):** merged + tests verdes + coverage ≥80% + axe sin críticos/serios + lint + typecheck + entry en matriz de trazabilidad + review @QA. **Merged ≠ Done.**

---

## Preferencias del usuario (Edwin) — no negociables

- **Respuestas terse.** Una línea cuando pide comandos. Long-form solo cuando hay tradeoffs irreversibles. Triggers: "dame una respuesta de una sola linea".
- **Cloud-first.** Nada local-only. Todo termina en GitHub (`edwinaml-su/his`). Nunca propongas "déjalo local por ahora".
- **NUNCA proponer PAT.** Para auth a git/GitHub usa SSH o `gh auth login --web`. Ya hubo PAT expuesto en chat — está prohibido.
- **Push-back welcome.** Si una directiva del TDR no cabe en el scope actual, dilo explícito con razón concreta + compromiso propuesto. Edwin acepta scope reductions cuando se justifican.
- **Git alias `git save`** existe localmente (`add -A && commit -m`). NO pushea automático — push es siempre explícito.

---

## Adecuar legacy vs duplicar (regla permanente)

Cuando una norma (NTEC / ISSS / TDR) introduce una funcionalidad que ya existe parcial en el HIS legacy, **EXTIENDE** el módulo legacy con lo que falta — NO crees una ruta paralela `/ece/<X>` que duplique el dominio.

**Antes de crear `apps/web/src/app/(clinical)/ece/<X>/`** o `apps/web/src/app/(admin)/ece/<X>/`:

1. Verifica si existe `apps/web/src/app/(clinical)/<X>/` o `apps/web/src/app/(admin)/<X>/`.
2. Si existe: diff funcional `legacy vs NTEC`. Identifica el GAP (qué requiere la norma y no está cubierto).
3. Inyecta el GAP al legacy (formularios extra, validaciones, integración con motor workflow ECE, persistencia bridge a `ece.<tabla>`).
4. Usa los bridges (`bridge-triage`, `bridge-encounter`, `bridge-patient` — PR #93) para sincronizar HIS↔ECE.

**Casos donde aplica** (módulos HIS con equivalente NTEC): triage, consents, deaths, patient registry, encounter, indications, lab orders, prescriptions, vital signs.

**Casos donde NO aplica** (documentos nuevos NTEC sin equivalente HIS): FICHA_IDENT, RRI, epicrisis formal, defunción CIE-10 estructurada, bitácora ECE, rectificación.

**Sidebar:** un solo item por dominio. El sufijo "ECE" solo para documentos formales NTEC sin equivalente legacy.

**Si descubres duplicación post-merge:** priorizar consolidar (refactor legacy + eliminar `/ece/*` duplicado + redirect 301 en `next.config.mjs` + dedupe sidebar). NO dejar como deuda.

**En prompts a sub-agentes:** incluir explícito "verifica si existe módulo legacy y refactorízalo; NO crees página nueva si el dominio ya está cubierto".

**Precedente positivo:** `/ece/triaje` fue eliminado en PR #101 — duplicaba `/triage` legacy que ya tenía Manchester implementado. Bridge `eceBridgeTriage` ya sincroniza con `ece.hoja_triaje`.

**Contra-ejemplo (NO duplicados, solo nombre similar — coexisten legítimamente):**
- `/consents` (admin) = consentimientos de **tratamiento de datos** (GDPR/LOPD: data-processing, mpi-cross-org, transfusion-research, telemedicine; 1 firma paciente; revocable).
- `/ece/consentimiento` (clinical) = consentimientos **médicos informados NTEC** (HOSPITALIZACION, QUIRURGICO; doble firma paciente+MC; inmutable post-firma Art. 40).

Antes de aplicar la regla, hacer diff funcional real — palabras compartidas no implican duplicación. Si los dominios son distintos (operador, propósito, lifecycle, normativa fuente), coexisten. Aclarar labels en sidebar para no confundir visualmente.

---

## Gotchas concretos (lecciones pagadas)

- **Vercel monorepo:** sin `prisma generate` en `installCommand` el build truena con tipos missing. Ya configurado en `vercel.json`.
- **Schema drift Prisma vs SQL:** los archivos `sql/25_*`, `26_*`, `27_v2`, `28_v2`, `30_*`, `32_v2` añadieron tablas/columnas (LabReferenceRange, LabReflexRule, BCMA en MedicationAdministration, etc.) **a la BD pero no necesariamente al `schema.prisma`**. Si modelas algo nuevo, sincronizar `schema.prisma` es responsabilidad del PR.
- **`ALTER TYPE ... ADD VALUE`** no puede co-existir con un `CREATE INDEX` que use el valor nuevo en la misma transacción — split en archivos separados (precedente: `30a_surgery_enum_post_op.sql` + `30b_surgery_hardening_v2.sql`).
- **Naming:** Prisma genera tablas en `PascalCase` con columnas `"camelCase"` (quoted). SQL hand-rolled debe respetar esas comillas o referenciará tablas inexistentes.
- **Postgres GUCs (`SET LOCAL`)** son no-op fuera de transacción. Si `withTenantContext` parece no aplicar RLS, verifica que la query esté dentro del callback (mismo `tx`).
- **Coverage threshold global** trumpa coverage por workspace — un módulo nuevo sin tests baja la métrica agregada. Agrega test trivial o márcalo en `exclude`.
- **dual gh accounts:** la cuenta git default puede ser personal; los push van a `edwinaml-su/his`. Verifica `git remote -v` antes de operaciones destructivas.
- **MCP Supabase** puede estar en read-only mode; cuando se necesite write, hay un PR pattern (`chore/mcp-write-mode`) que habilita `apply_migration` temporalmente.
- **Re-exports en `@his/contracts`:** los schemas nuevos en `packages/contracts/src/schemas/*.ts` deben agregarse a `packages/contracts/src/schemas/index.ts`. PR #217 reveló que faltaban 31 archivos ECE+GS1 re-exportados — bloqueaba CI typecheck por meses. Si creas un schema nuevo, añade su `export * from "./<archivo>";` en el mismo PR.
- **Deuda preexistente typecheck — CERRADA al 2026-05-26.** Los ~42 errores TS originales en pages UI (`deaths/`, `workflows/`, `atencion-emergencia/`, `defuncion/`, `epicrisis/`, `historia-clinica/`, `hoja-ingreso/`, `urpa/`) ya fueron cerrados por los merges incidentales de las olas S0-S8. Verificación 2026-05-26 con `npm run typecheck` desde raíz: **7/7 workspaces verdes**. Si ves errores TS al iniciar sesión, ejecuta `npm install && npm run -w @his/database generate` primero — un prisma client desactualizado o `@node-rs/argon2` no instalado produce decenas de falsos positivos (`costCenterId`/`bedId`/`drug`/`alertLevel` does not exist).
- **tsconfig `rootDir`:** no agregar `rootDir: "src"` a tsconfig de un paquete que importe `@his/contracts` — genera TS6059 porque los archivos del paquete dep están fuera del rootDir. Si ya está, removerlo + agregar `declaration: false, declarationMap: false` (tsconfig de @his/trpc lo demuestra).
- **Dependabot bumps mayores rompen build (lección Beta.22):** el config inicial sin `ignore` dejó que el bot auto-mergeara `next 14→16`, `typescript 5→6`, `vitest 2→4`, `@prisma/client 5→7`, `lighthouse 12→13` — todos breaking. `next 16` rompió por `headers()` async (`Promise<ReadonlyHeaders>`). **Además 0.x semver permite breaking en _minor_**: `tiptap-markdown 0.8→0.9` rompió `Markdown.configure()` (arrastra peer `@tiptap/core@3`). El `.github/dependabot.yml` ahora tiene `ignore: version-update:semver-major` global + `semver-minor` para 13 libs 0.x. Si un bump rompe CI, **revert + cerrar el PR Dependabot**, no intentes arreglar el breaking en caliente.
- **`@sentry/nextjs` (o cualquier dep nueva) requiere `npm install` para sincronizar `package-lock.json`** — un agente en worktree que solo edita `package.json` rompe `npm ci` en CI con `Missing: X from lock file`. Siempre corre `npm install` tras tocar dependencias.
- **Squash-merge puede descartar commits intermedios (lección Beta.21 #377):** un PR con N commits squasheado a veces conserva solo el primero si la estrategia colapsa mal — el mock tRPC de `app-shell.test.tsx` se perdió y reapareció como regresión CI semanas después. Para PRs con commits de fix de tests críticos, verifica el diff post-merge o usa `--rebase`.
- **`payloads.ts` discriminated union es punto caliente de conflicto:** múltiples PRs que agregan `eventType` al `domainEventPayloadSchema` colisionan en merge auto-resuelto, dejando `z.object` sin cerrar (TS1005/TS1136). Si dos features tocan `packages/contracts/src/events/payloads.ts`, mergea secuencial y verifica `npm -w @his/contracts run typecheck` post-merge.
- **Worktrees paralelos cruzan archivos untracked:** lanzar varios `Agent` con `isolation: worktree` aísla el git tree pero los archivos **untracked** (e.g. `instrumentation.ts`, nuevos tests) pueden bleed al working tree del padre y aparecer en el commit equivocado de otro agente (incidente Beta.22: rate-limit commiteó archivos del agente Vault). Si un agente reporta archivos ajenos staged, autorízale `git reset HEAD~1` + re-stage selectivo. Limpia worktrees huérfanos con `git worktree remove <path> -f -f` (doble `-f` para los locked por agente).
- **Playwright Smoke (@smoke) NO estaba flaky — estaba muerto (diagnóstico 2026-08-18).** Llevaba 10/10 runs cancelados por timeout de 20 min. Causa real: el **100 %** de las specs `@smoke` pasa por `login()`, que llama a `supabase.auth.signInWithPassword()`, y CI apuntaba a `e2e-dummy.supabase.co` (host inexistente) mientras `seed-test-users.mjs` **no se invocaba en ningún workflow**. Eran ~77 tests fallando en serie, sin una línea de output durante 16 min. En junio se había "arreglado" subiendo el timeout de 10 a 20 min sin diagnosticar el silencio — no repitas ese parche. Estado actual y próximos pasos: `docs/runbooks/e2e-gotrue-auth.md`.
- **nonce-based CSP NO sirve con páginas estáticas de Next (incidente Beta.22 #440, revertido):** un CSP `script-src 'nonce-{nonce}' 'strict-dynamic'` generado per-request en el middleware **bloquea los scripts inline de hidratación** en páginas prerendered/estáticas (ej. `/login`) — el HTML estático trae scripts sin el nonce per-request → mismatch → "The action has been blocked" → hidratación muerta. Next 14 solo auto-inyectaba el nonce en páginas **dinámicas** (comportamiento observado en el incidente; **no reverificado tras la migración a Next 16** — si vas a reintentarlo, confirmá primero cómo se comporta en 16). Para nonce CSP habría que forzar `dynamic = "force-dynamic"` en todas las páginas, lo cual mata el prerender. **El CSP seguro es el de #427: `script-src 'self' 'unsafe-inline'` estático en `next.config.mjs`** (HSTS + frame-ancestors + object-src none dan el grueso del valor). No reintentes nonce CSP sin resolver el render estático primero.
- **A11y Baseline (axe-core) verde NO valida hidratación bajo CSP:** axe inspecciona el **DOM renderizado por SSR** (que carga aunque el CSP bloquee los scripts cliente). En el incidente #440, A11y pasó verde mientras la app estaba **rota** (sin interactividad). Lección: cambios a CSP/middleware/auth **requieren UAT manual en browser real** (consola sin `Refused to execute inline script` + interactividad) antes de mergear a prod — el build verde + A11y verde dan falsa confianza.
- **El `Dockerfile` debe copiar TODO el árbol del stage `deps`, no solo `/repo/node_modules`:** npm puede anidar una dependencia en `packages/<x>/node_modules` en lugar de hoistearla (conflicto de versiones, alias `npm:`, entrada en `overrides`). Como `.dockerignore` excluye `**/node_modules`, esas carpetas no llegan por `COPY . .` tampoco → `Module not found` **solo dentro de Docker**, con el build fuera de Docker en verde. Lo destapó el alias `expr-eval` → `expr-eval-fork@3.0.3`. Por eso es `COPY --from=deps /repo ./`.
- **Un `vitest.config.ts` con `include` estrecho esconde tests sin avisar:** `@his/infrastructure` incluía solo `src/**/__tests__/**`, así que `engine.test.ts` y `prevent.test.ts` (24 golden clínicos tipo Cockcroft-Gault + AHA PREVENT) **nunca corrieron en CI** — el motor de dosis y scores se validaba a ciegas. Al agregar tests, verificá que aparezcan en la salida de la corrida, no solo que el workspace dé verde. `packages/ui` tiene hoy el mismo problema, agravado: no tiene script `test`, así que `turbo run test` lo omite en silencio.
- **Aliasar una dependencia con `npm:` es una salida válida cuando no hay parche:** `expr-eval@2.0.2` (prototype pollution CVSS 7.3 + CWE-94, sin versión corregida, sin mantenimiento desde 2022) se cerró con `"expr-eval": "npm:expr-eval-fork@3.0.3"` — el `import` no cambia. Pineado **exacto** a propósito: es un fork con bus factor de 1 en un motor de cálculo clínico, no queremos que un `npm install` arrastre un 3.x nuevo sin revisión.
- **Carpetas `_foo` en App Router son private folders (excluidas del routing):** `app/api/_sentry-check/route.ts` da 404 porque `_sentry-check` no se rutea. Si necesitas un endpoint, NO uses prefijo `_` en el segmento de ruta.

### Patrones de seguridad establecidos (Beta.21/22)

- **Vault para secrets de portal (BD P0-6):** `PortalAccount.mfaSecret` migró a Supabase Vault. Lee con `SELECT get_portal_mfa_secret(account_id)` (SECURITY DEFINER, `search_path` fijo), escribe con `set_portal_mfa_secret_vault(account_id, secret)`. El router usa `prisma.$queryRaw`/`$executeRaw` con fallback app-layer AES para cuentas pre-Vault. NUNCA leas `mfaSecret` en claro desde Prisma select.
- **`SET search_path` obligatorio en funciones nuevas:** TODA función SQL (trigger, helper, SECDEF) debe declarar `SET search_path = <schema>, public, pg_catalog`. El advisor Supabase marca `function_search_path_mutable` (WARN). SQL 155 (6 SECDEF críticas) + 162 (58 trigger/helper) ya las cerraron — no reintroduzcas funciones sin search_path.
- **`anon` no tiene DML (BD P0-1):** SQL 152 revocó INSERT/UPDATE/DELETE de `anon` en 9 tablas PHI+credenciales. El acceso tenant va por rol `authenticated` vía `withTenantContext`. No re-otorgues grants a `anon`.
- **Rate limit en endpoints auth (OWASP A07) — Postgres compartido (Sprint 5):** helper async `checkRateLimit`/`rateLimitOrThrow` en `packages/trpc/src/middleware/rate-limit.ts` con backend **Postgres** (tabla `RateLimitHit`, SQL 163) — reemplazó el in-memory por-proceso que en Vercel multi-pod no era límite global. Recibe `ctx.prisma` (corre fuera de `withTenantContext`, rol BYPASSRLS). Cableado en `firma.requestRecovery`, `mfa.verify`, `portal.register/requestLogin/verifyLogin`. Endpoints auth nuevos deben pasar por `await rateLimitOrThrow(ctx.prisma, { key, max, windowMs })`.
- **Reset de password admin — escribe a Supabase Auth (Sprint 5 #441):** `userAdmin.resetPassword` actualiza `auth.users.encrypted_password` vía `extensions.crypt(pwd, gen_salt('bf',10))` (bcrypt, lo que GoTrue verifica) — **NO** `UserCredential` (el login usa `supabase.auth.signInWithPassword`, no la tabla local). Para usuarios SSO (azure) crea la identidad `email` en `auth.identities` → login dual. Mapea HIS `User`→`auth.users` **por email** (los ids difieren). El write a `UserCredential` queda solo como rastro de auditoría. ⚠️ Lección: el reset NO debe escribir solo en `UserCredential` — eso daba "éxito" engañoso sin afectar el login (incidente amedina).

---

## Fidelidad de diseño (mockup) — reglas obligatorias

Cuando exista un mockup HTML/CSS entregado, es la **ÚNICA fuente de verdad visual**. Ninguna instrucción posterior en la conversación autoriza a ignorarlo, salvo pedido explícito de Edwin.

**Ubicaciones:**
- `design/mockup/` — mockup HTML/CSS entregado (páginas `.html` + `.css` + `assets/`). Referencia EXACTA de colores, tipografía, espaciados, bordes, sombras, estados hover/focus y layout.
- `docs/DESIGN-SPEC.md` — tokens extraídos del mockup, legibles por humanos (token ↔ valor ↔ origen en el mockup) + mapeo mockup→componentes + desviaciones aprobadas.
- Tokens materializados en `apps/web/tailwind.config.ts` (`theme.extend`) y `packages/ui/src/styles/globals.css` (variables CSS). Nombres **semánticos** (`brand-primary`, `surface`, `text-muted`), no descriptivos.

**Precedencia ante duda visual:** 1) mockup HTML/CSS → 2) `docs/DESIGN-SPEC.md` → 3) `tailwind.config.ts`. Si hay contradicción: DETENTE y pregunta — no decidas solo.

**Flujo obligatorio antes de maquetar una pantalla/componente:**
1. LEE el mockup con Read (el `.html` y su `.css`). No trabajes de memoria ni "aproximes".
2. Extrae valores exactos (hex/rgb, font, line-height, padding, gap, radius, shadow, breakpoints).
3. Compara contra tokens existentes: si existe → usa el token; si no → agrégalo con nombre semántico y documenta en `docs/DESIGN-SPEC.md` **en el mismo commit**.
4. Implementa usando exclusivamente tokens.
5. Verifica (abajo) antes de dar por terminado.

**Prohibiciones (modo estricto):**
- **No inventar/aproximar colores.** El valor EXACTO del mockup se registra como token y se usa por nombre (`bg-brand-primary`), nunca clases de la paleta genérica de Tailwind.
- **No re-estilizar arbitrariamente** tipografías, pesos, tamaños, espaciados, radios o sombras "porque se ve mejor". Toda desviación requiere aprobación explícita y se registra en la tabla de desviaciones del DESIGN-SPEC.
- **No cambiar layout**: ni reordenar secciones ni ocultar/añadir elementos. El DOM puede diferir (React), el render debe ser visualmente equivalente.
- **No magic values**: nada de `style={{color:'#333'}}` ni `text-[#333]` repetidos. Clases arbitrarias `[...]` solo para valores que aparecen UNA vez, comentados con su origen.
- **No librerías de UI nuevas** (MUI, Bootstrap, DaisyUI, etc.) ni fuentes nuevas sin aprobación. **Shadcn/`@his/ui` son la base permitida del proyecto** — los tokens del mockup se materializan sobre ese stack, no lo reemplazan.
- **Responsive y estados** (hover/focus/active/disabled, transiciones) se copian de las media queries y CSS del mockup. Si el mockup no define una vista o estado → preguntar / proponer derivado de tokens marcado "PENDIENTE DE APROBACIÓN".
- **Assets** (imágenes, íconos, logos) salen de `design/mockup/assets/` — no sustituir por "parecidos" de otra librería.

**Definición de "terminado" (fidelidad):** comparación lado a lado (app en `npm run dev` vs mockup en browser, screenshots con Playwright) + checklist (colores, tipografía, espaciados, bordes/radios/sombras, estados, responsive, cero valores hardcodeados) + reportar explícitamente toda desviación no replicable (valor mockup vs implementado). Nunca silenciarlas.

**Cambios de diseño:** si llega un mockup actualizado, primero `docs/DESIGN-SPEC.md` + tokens, después componentes. Nunca parchear componentes dejando tokens desactualizados.

---

## Convenciones de commits / PRs

- Estilo conventional commits en español: `feat(beta15): ...`, `fix(db): ...`, `chore(mcp): ...`, `docs(beta15): ...`.
- Cada PR mergeado lleva firma Co-Authored-By cuando lo crea Claude.
- Trunk-based: PRs cortos contra `main`. **Branch protection ACTIVA** (desde 2026-08-18) con 3 required status checks: `Build, Lint, Test, Typecheck` · `Build & push (GHCR)` · `axe-core WCAG 2.1 AA — 5 páginas baseline`. `enforce_admins: false` → `gh pr merge --admin` sigue disponible; `strict: false` → no exige rama al día con `main`. `Playwright Smoke (@smoke)` **no** es requerido a propósito (ver §E2E). Verificá el estado real con `gh api repos/edwinaml-su/his/branches/main/protection` antes de asumir que algo bloquea: entre 2026-06-30 y 2026-08-18 la protección existía pero `contexts` estaba **vacío**, o sea que se podía mergear con el CI en rojo.

---

## Documentación viva (consultar antes de inventar)

| Doc | Contenido |
|---|---|
| `docs/02_arquitectura_software.md` | Blueprint técnico, ADRs en `docs/adr/` |
| `docs/04_modelo_datos.md` | Modelo 4NF, diccionario, decisiones de schema |
| `docs/05_backlog.md` + `docs/backlog/` | User stories + criterios de aceptación |
| `docs/12_rls_validation.md` | Tests RLS, gaps documentados |
| `docs/13_g0_closure_log.md` | Cierre G0, lo que quedó pendiente |
| `docs/15_production_runbook.md` | Operación: incidentes, rollback |
| `docs/17_hipercuidado_runbook.md` | Hipercuidado post-deploy |
| `docs/blueprints/beta15_*.md` | Spec Beta.15 alerts/notifications (current) |
| `docs/DESIGN-SPEC.md` | Tokens de diseño del mockup (`design/mockup/`) + mapeo a componentes + desviaciones aprobadas |
| `docs/31_flujos_operativos_consolidado.md` | Índice maestro de los 30 flujos NTEC (workflow-designer) |
| `docs/flujos/{CODIGO}.md` | Ficha por documento NTEC: metadata, dependencias, roles, eventos, drift |
| `docs/audit/2026-05-19_audit_stream_*.md` | Hallazgos audit A-J (271 totales, 52 P0); muchos ya remediados |
| `TDR_HIS_Multipais.md` | Términos de referencia (1923 líneas, 30 módulos) — fuente de verdad regulatoria |

**Regla:** este CLAUDE.md apunta y resume. No duplica. Si encuentras inconsistencia entre CLAUDE.md y los docs numerados, los docs ganan — y abre un PR para actualizar CLAUDE.md.
