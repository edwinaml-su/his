# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Idioma del proyecto: **español (es-SV)**. La mayoría de comentarios, docs, commits y PRs van en español. Identificadores de código en inglés.

---

## Stack y comandos esenciales

Turborepo + npm workspaces. Node ≥ 20, npm ≥ 10. Stack: Next.js 14 App Router + tRPC v11 + Prisma 5 + Postgres 15 (Supabase) + Tailwind/Shadcn.

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
  trpc/                    # ~120 routers (83 raíz + 38 en routers/ece/), trpc.ts, rls-context.ts ⚠ §RLS
  infrastructure/          # observability (slo-checks), firma/argon2, adaptadores externos
  ui/                      # design system Shadcn/Tailwind compartido
  test-utils/              # fixtures (DUI válidos, pacientes, encounters), mock-session
  config/eslint/           # config compartida
tests/features/            # Gherkin (.feature) — BDD de @QAF, no ejecutables, son spec
docs/                      # 33 docs numerados + flujos/ (30 fichas NTEC) + adr/ + blueprints/ + uat/
infra/terraform/           # placeholder (BI/data fase posterior)
scripts/                   # diagnose-supabase-env.mjs, db-reset, setup, golive-checklist
```

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
- Test users en `apps/web/e2e/_helpers`: `qa.admin@his.test`, `qa.triagist@his.test` (password `TestPass123!`). Se siembran desde `packages/database/scripts/seed-test-users.mjs`.
- Workflow `.github/workflows/e2e.yml` corre nightly + workflow_dispatch (no en cada PR).

---

## CI/CD

| workflow | trigger | qué hace |
|---|---|---|
| `ci.yml` | push/PR a `main`/`develop` | typecheck + lint + test (coverage) + build + a11y placeholder |
| `e2e.yml` | nightly + manual | Playwright contra Postgres efímero |
| `db-migrate.yml` | manual (`workflow_dispatch`) | `prisma migrate deploy` con env protection |
| `security.yml` | semanal + push a `main` | npm audit (high+) + gitleaks |

Deploy app: **Vercel** (`vercel.json`). `installCommand: "npm ci && npm run -w @his/database generate"` — sin el `prisma generate` el build falla porque el client tipado no existe.

---

## MCPs configurados (importante)

- **`mcp__supabase__*`** → proyecto HIS (`ejacvsgbewcerxtjtwto.supabase.co`). Configurado en `.mcp.json` con `SUPABASE_ACCESS_TOKEN` desde env. Usar SIEMPRE estos para operar la BD del proyecto.
- **`mcp__15671ac5-*`** (si aparece) → cuenta personal del usuario (otros proyectos). **NO usar para HIS.**

Para aplicar SQL hardening / RLS al proyecto Supabase remoto: `mcp__supabase__apply_migration` o `mcp__supabase__execute_sql`. Antes de cambios de schema, usa `list_tables` y `get_advisors` para entender estado actual.

---

## Framework de trabajo (mandatorio — directiva permanente)

**1. SDLC autónomo @Orq** — todo trabajo respeta el framework descrito en `C:\proyecto\knowledge\sdlc_system_prompt.md` (14 agentes, 6 fases, gates G0–G8). Roles: `@Orq` orquesta y NO escribe código; `@Dev` implementa; `@AE/@AS/@AT/@DA/@DBA` arquitectura; `@PO` backlog; `@UIUX` interfaz; `@QA/@QAF` calidad; `@SRE` ops; `@DA/@DE/@BIA/@BID` BI. Invoca al rol vía `Skill(<nombre>)` o `Agent(subagent_type=<nombre>)`. Solo `@Orq` declara "Project Completed" — y solo post-G8 con firmas de @AE/@QA/@QAF/@SRE.

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
- **Deuda preexistente typecheck:** al 2026-05-22 main tiene ~42 errores TS en pages UI (`deaths/`, `workflows/`, `atencion-emergencia/`, `defuncion/`, `epicrisis/`, `historia-clinica/`, `hoja-ingreso/`, `urpa/`) — drift entre routers ECE actuales y signatures viejas de UI. Pendiente de sprint dedicado. Si tu PR no toca esos archivos, los errores NO son tu responsabilidad.
- **tsconfig `rootDir`:** no agregar `rootDir: "src"` a tsconfig de un paquete que importe `@his/contracts` — genera TS6059 porque los archivos del paquete dep están fuera del rootDir. Si ya está, removerlo + agregar `declaration: false, declarationMap: false` (tsconfig de @his/trpc lo demuestra).

---

## Convenciones de commits / PRs

- Estilo conventional commits en español: `feat(beta15): ...`, `fix(db): ...`, `chore(mcp): ...`, `docs(beta15): ...`.
- Cada PR mergeado lleva firma Co-Authored-By cuando lo crea Claude.
- Trunk-based: PRs cortos contra `main`. Branch protection en `main` está bloqueada (requiere GitHub Pro en repos privados) — convivimos sin ella; la disciplina es manual + CI.

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
| `docs/31_flujos_operativos_consolidado.md` | Índice maestro de los 30 flujos NTEC (workflow-designer) |
| `docs/flujos/{CODIGO}.md` | Ficha por documento NTEC: metadata, dependencias, roles, eventos, drift |
| `docs/audit/2026-05-19_audit_stream_*.md` | Hallazgos audit A-J (271 totales, 52 P0); muchos ya remediados |
| `TDR_HIS_Multipais.md` | Términos de referencia (1923 líneas, 30 módulos) — fuente de verdad regulatoria |

**Regla:** este CLAUDE.md apunta y resume. No duplica. Si encuentras inconsistencia entre CLAUDE.md y los docs numerados, los docs ganan — y abre un PR para actualizar CLAUDE.md.
