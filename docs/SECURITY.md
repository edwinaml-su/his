# Registro de Vulnerabilidades de Seguridad — HIS Multipaís

> Generado por @SRE · 2026-05-17. Actualizar en cada ciclo de `npm audit`.

---

## Estado actual (2026-05-17)

| Severity | Count |
|----------|-------|
| high | 4 |
| moderate | 7 |
| critical | 0 |

---

## Vulnerabilidades HIGH — sin fix disponible sin major upgrade

### 1. next — múltiples advisories

| Advisory | Título | CVSS | Rango afectado | Fix |
|----------|--------|------|----------------|-----|
| GHSA-h25m-26qc-wcjf | HTTP request deserialization DoS (insecure RSC) | 7.5 (High) | >=13.0.0 <15.0.8 | next@15.0.8+ |
| GHSA-c4j6-fc7j-m34r | SSRF via WebSocket upgrades | 8.6 (High) | >=13.4.13 <15.5.16 | next@15.5.16+ |
| GHSA-36qx-fr4f-26g5 | Middleware/Proxy bypass vía i18n (Pages Router) | 7.5 (High) | >=12.2.0 <15.5.16 | next@15.5.16+ |
| GHSA-9g9p-9gw9-jx7f | DoS Image Optimizer remotePatterns | 5.9 (Moderate) | >=10.0.0 <15.5.10 | next@15.5.10+ |
| GHSA-ggv3-7p47-pfv8 | HTTP request smuggling en rewrites | - | <15.5.16 | next@15.5.16+ |
| GHSA-wfc6-r584-vfw7 | Cache poisoning en RSC responses | 5.4 (Moderate) | >=14.2.0 <15.5.16 | next@15.5.16+ |

**Versión instalada:** `next@14.2.35` (última en rama 14, sin backport de fixes).

**Mitigación activa:**
- GHSA-h25m-26qc-wcjf (DoS RSC): mitigado si no se exponen RSC con input no sanitizado. HIS usa `withTenantContext` + Supabase auth en todas las rutas protegidas.
- GHSA-c4j6-fc7j-m34r (SSRF WebSocket): HIS no usa WebSocket upgrades vía proxy en producción. Deploy en Vercel (no self-hosted con proxy custom).
- GHSA-36qx-fr4f-26g5 (Middleware i18n bypass): HIS usa `middleware.ts` con Supabase auth — el bypass requiere rutas i18n específicas. Verificar que rutas sensibles no dependan solo de middleware para auth.

**Plan de migración:**
- Milestone: migración `next@14 → next@15` planificada para Fase 3 (post-MVP go-live).
- Responsable: @Dev + @SRE.
- Prerrequisito: auditar breaking changes App Router en next@15 changelog, especialmente `unstable_cache`, `cookies()`, `headers()` que son ahora async.
- Branch de migración propuesto: `feat/next15-upgrade`.

---

### 2. glob — GHSA-5j98-mcp5-4vw2

| Campo | Detalle |
|-------|---------|
| Advisory | GHSA-5j98-mcp5-4vw2 |
| Título | glob CLI: Command injection via -c/--cmd con shell:true |
| CVSS | 7.5 (High) |
| CWE | CWE-78 (OS Command Injection) |
| Rango afectado | >=10.2.0 <10.5.0 |
| Versión instalada | 10.3.10 (pinada exacta por `@next/eslint-plugin-next@14.2.35`) |
| Fix disponible | glob@10.5.0 (no-major) |

**Por qué no se puede parchear sin --force:**
`@next/eslint-plugin-next@14.2.35` tiene `"glob": "10.3.10"` como versión exacta pinada en su `package.json` publicado. El mecanismo `npm overrides` no puede substituir versiones exactas (no rangos) de paquetes publicados sin forzar, lo cual requeriría `--force` y podría romper compatibilidad de `@next/eslint-plugin-next`.

**Evaluación de riesgo real:**
- El vector de ataque es el **binario CLI** `glob --cmd <comando>` con input controlado por atacante.
- `@next/eslint-plugin-next` usa glob **como módulo programático** (import, no spawn de CLI) para encontrar archivos durante linting.
- El binario glob no se expone en ningún contexto de producción o CI con input externo.
- **Riesgo real: Bajo.** El advisory es técnicamente correcto pero el vector de ataque no aplica al uso específico de esta dependencia.

**Mitigación:**
- Fix disponible al hacer upgrade a `eslint-config-next@15+` (que lleva `@next/eslint-plugin-next@15+` con glob sin pinar).
- Se resolverá automáticamente en la migración `next@14 → next@15`.

---

## Vulnerabilidades MODERATE — sin fix sin major

| Paquete | Advisory | Fix disponible | Observación |
|---------|----------|----------------|-------------|
| `vitest` / `vite` / `vite-node` / `@vitest/*` | GHSA-4w7w-66w2-5vf9, GHSA-67mh-4wv8-2f99 | vitest@4.x (major) | Solo devDep. No aplica en producción. |
| `esbuild` | GHSA-67mh-4wv8-2f99 | via vitest@4.x | Bundler dev, no expuesto. |
| `postcss` | GHSA-qx2v-qp2m-jg93 | via next@15+ | XSS en stringify; mitigado por CSP en prod. |

---

## Historial de remediaciones

| Fecha | Paquete | Acción | Resultado |
|-------|---------|--------|-----------|
| 2026-05-17 | glob (override) | Intentado `"overrides": {"glob":"10.5.0"}` | Inefectivo: versión exacta pinada en dep transitiva |
| 2026-05-17 | todos | `npm audit fix` | No aplica: todos los fixes son major semver |

---

## Próximas acciones

1. **[P1 · Fase 3]** Migración `next@14 → next@15` — resuelve 3 highs + 3 moderates de next/postcss.
2. **[P2 · Fase 3]** Upgrade `vitest@2 → vitest@4` — resuelve 4 moderates de vitest/vite/esbuild.
3. **[P3 · automático]** glob high se resuelve como subproducto del upgrade de next (nuevo `@next/eslint-plugin-next` no pina glob exacto).
