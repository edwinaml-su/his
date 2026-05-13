# 21 — Database Operations (Supabase Postgres)

**Proyecto:** HIS Multipaís — Inversiones Avante
**Autor:** @DBA — Data Architect
**Versión:** 1.0 — 2026-05-13 (Fase 6 — Stream C)
**Alcance:** operación de la BD productiva (Supabase Postgres, region `sa-east-1`) para MVP.

> **Nota:** topología y env vars viven en `docs/15_production_runbook.md`. Este doc se concentra en BD: backup/restore, advisors, índices, hardening y SQL 24.

---

## 1. Estado actual de la BD productiva

- **Tablas**: 96 (47 catálogo + 49 transaccionales) — Phase 0/1/2 completas.
- **RLS**: habilitada en 100% de las tablas tenant-scoped (verificada vía `mcp__supabase__get_advisors security`).
- **Audit triggers**: 48 tablas Phase 2 wired por SQL 22 + 34 tablas Phase 0/1 vía SQL 02.
- **Hash chain**: activa (SQL 05) — `audit.fn_verify_chain()` retorna 0 filas rotas en última verificación.
- **Advisor security**: 0 CRITICAL; 19 WARN (16 functions search_path + 2 extensions in public + 1 auth HIBP).
- **Backups**: PITR auto-daily de Supabase Pro plan, retención 7 días; export manual mensual recomendado.

---

## 2. Estrategia de Backup

### 2.1 Backups automáticos (Supabase Pro)

| Tipo                   | Cadencia | Retención | Restore RTO | RPO     |
|------------------------|----------|-----------|-------------|---------|
| Snapshot diario        | 24 h     | 7 días    | ≤ 30 min    | ≤ 24 h  |
| PITR (WAL continuous)  | Continuo | 7 días    | ≤ 1 h       | ≤ 5 min |

Acceso: Supabase Dashboard → Database → Backups → Restore (botón "Restore from a backup").

### 2.2 Export manual mensual (procedimiento)

Para retención larga (cumplimiento normativo SV — 10 años de expediente clínico) **además** del backup Supabase:

1. Generar dump completo:
   ```bash
   pg_dump "postgresql://postgres:<pwd>@<host>:5432/postgres?sslmode=require" \
     --format=custom \
     --no-owner --no-privileges \
     --exclude-schema=auth --exclude-schema=storage \
     --exclude-schema=realtime --exclude-schema=supabase_functions \
     -f "his-prod-$(date +%Y%m%d).dump"
   ```

2. Cifrar con AES-256 (clave en bóveda offline):
   ```bash
   openssl enc -aes-256-cbc -salt -pbkdf2 -in his-prod-YYYYMMDD.dump \
     -out his-prod-YYYYMMDD.dump.enc -pass file:./vault-key.txt
   ```

3. Subir a almacenamiento frío (Backblaze B2 / S3 Glacier Deep Archive) etiquetado:
   - bucket: `avante-his-cold-backups`
   - path: `monthly/YYYY/YYYYMMDD/his-prod.dump.enc`
   - tagging: `retention=10y`, `class=phi-encrypted`.

4. Registrar hash SHA-256 en `docs/security/backup-manifest.md`:
   ```
   2026-05-13  his-prod-20260513.dump.enc  SHA256:<hash>  21.4GB  @dba
   ```

Cadencia mensual; responsable rotativo SRE / DBA.

### 2.3 Verificación de restores (cadencia trimestral)

Cada 3 meses, restaurar el último dump en proyecto `staging-restore-test` y validar:

- [ ] `SELECT count(*) FROM "Patient"` coincide con producción ± 0 (a la fecha del dump).
- [ ] `SELECT count(*) FROM audit."AuditLog"` coincide.
- [ ] `SELECT * FROM audit.fn_verify_chain()` retorna 0 filas.
- [ ] Smoke test de aplicación (Vercel preview + DB restaurada): login + admisión + triage funcionan.

Documentar resultado en `docs/security/restore-drills.md`. Sin esta validación, el backup es solo "esperanza" — un restore fallido descubierto en incidente real es P1 inmediato.

---

## 3. Advisors Supabase — disciplina operativa

Ejecutar **antes de cada deploy a producción**:

```
mcp__supabase__get_advisors security    # WARN + ERROR si los hay
mcp__supabase__get_advisors performance # slow queries, missing indexes
```

### 3.1 Estado al 2026-05-13 (post SQL 23 + SQL 24)

| Lint                                     | Severidad | Cantidad | Acción                                       |
|------------------------------------------|-----------|----------|----------------------------------------------|
| `rls_disabled_in_public`                 | CRITICAL  | **0**    | OK — cerrado por SQL 23                      |
| `function_search_path_mutable`           | WARN      | **0** (post SQL 24) | Cerrado por SQL 24                |
| `extension_in_public`                    | WARN      | **0** (post SQL 24) | Cerrado por SQL 24 (citext, pg_trgm) |
| `auth_leaked_password_protection`        | WARN      | **1**    | Acción manual dashboard (ver §3.2)           |

### 3.2 Activar Have I Been Pwned (HIBP) en Supabase Auth

> **No se hace por SQL**. Acción manual ejecutada por @SRE:

1. Supabase Dashboard → Authentication → Settings.
2. Sección "Password Strength" → toggle **"Prevent use of leaked passwords"**.
3. Re-ejecutar `mcp__supabase__get_advisors security` → `auth_leaked_password_protection` debe desaparecer.

---

## 4. SQL 24 — Security hardening (qué aplica y por qué)

`packages/database/sql/24_security_hardening.sql` cierra los 18 WARN no-auth:

### 4.1 Functions search_path mutable

Postgres permite "function injection" si una función usa objetos sin calificar y el search_path es manipulado por el caller. Mitigación estándar:

```sql
ALTER FUNCTION public.X(...) SET search_path = '';
```

Con search_path vacío, cualquier identificador no calificado falla — la función está forzada a usar `schema.objeto` explícito. Las 16 funciones afectadas ya califican sus identificadores (auditado en SQL 24, comentarios in-line).

**Aplica a**: 13 funciones en `public.` (validate_dui/nit/nie, current_org/user/country_id, is_break_glass, user_has_org_access, fn_validate_patient_identifier, fn_require_break_glass_justification, fn_block_hard_delete_patient, set_tenant_context, clear_tenant_context) + 3 en `audit.` (fn_audit_log_immutable, fn_chain_stats, fn_verify_chain).

**No aplica a**: funciones que ya tienen search_path explícito en su CREATE (las del SQL 05 hash chain).

### 4.2 Extensions en public → schema `extensions`

Las extensions `citext` y `pg_trgm` están instaladas en `public` por defecto histórico. Mejor práctica Supabase: schema `extensions` dedicado.

`ALTER EXTENSION X SET SCHEMA extensions` preserva todos los objetos. **Como `citext` y `pg_trgm` no están en uso real** (ningún column del MVP los usa), el cambio es no-disruptivo.

Si una migración futura introduce uso (e.g. columna `citext`), Prisma o el SQL deberá calificar:
```sql
ALTER TABLE "Patient" ALTER COLUMN email TYPE extensions.citext;
```

---

## 5. Plan de aplicación SQL 24

> Solo Edwin ejecuta (`mcp__supabase__apply_migration` requiere autoría humana en este worktree). Esta sección documenta el plan.

### 5.1 Pre-checks (antes de apply)

```sql
-- Verificar funciones objetivo existen
SELECT proname, pronamespace::regnamespace AS schema, proconfig
  FROM pg_proc
 WHERE proname IN (
   'is_break_glass','validate_dui','validate_nit','validate_nie',
   'current_org_id','current_user_id','current_country_id',
   'user_has_org_access','fn_validate_patient_identifier',
   'fn_require_break_glass_justification','fn_block_hard_delete_patient',
   'set_tenant_context','clear_tenant_context',
   'fn_audit_log_immutable','fn_chain_stats','fn_verify_chain'
 );
-- Debe retornar 16 filas. proconfig NULL en todas inicialmente.
```

### 5.2 Apply (idempotente)

```sql
\i packages/database/sql/24_security_hardening.sql
```

O vía MCP:
```
mcp__supabase__apply_migration name="24_security_hardening"
  query="<contenido del archivo>"
```

### 5.3 Post-checks

```sql
-- 1) Funciones con search_path blindado
SELECT proname, proconfig FROM pg_proc
 WHERE proname IN (... mismas 16 ...);
-- proconfig debe incluir 'search_path=' (vacío)

-- 2) Extensions movidas
SELECT extname, n.nspname AS schema
  FROM pg_extension e
  JOIN pg_namespace n ON e.extnamespace = n.oid
 WHERE extname IN ('citext','pg_trgm');
-- schema debe ser 'extensions'

-- 3) Advisor security
SELECT * FROM <usar MCP get_advisors security>;
-- function_search_path_mutable y extension_in_public deben tener cantidad 0
```

### 5.4 Smoke aplicación post-apply

- [ ] `curl https://his-avante.vercel.app/api/health` → `{ status: "ok" }`.
- [ ] tRPC `auth.login` funciona (testa que las funciones JWT siguen resolviendo).
- [ ] Crear paciente con DUI inválido → falla con código 23514 (validate_dui sigue activa).
- [ ] Insert en cualquier tabla auditada → aparece nueva fila en `audit."AuditLog"` con hash encadenado.

### 5.5 Rollback (improbable)

SQL 24 no es destructivo; el rollback sería:
```sql
ALTER FUNCTION public.X(...) RESET search_path;
ALTER EXTENSION citext SET SCHEMA public;
ALTER EXTENSION pg_trgm SET SCHEMA public;
```

Solo necesario si una migración futura revelara dependencia oculta.

---

## 6. Operaciones recurrentes

### 6.1 Verificación de hash chain (cron diario recomendado)

```sql
SELECT * FROM audit.fn_verify_chain();
-- Debe retornar 0 filas. Cualquier resultado ≠ 0 → P1 inmediato (tamper).
```

Programar como GitHub Action diaria o Supabase Edge Function con alerta Sentry si returns > 0.

### 6.2 Estadísticas de audit (sanity check)

```sql
SELECT * FROM audit.fn_chain_stats();
-- total_rows | last_id | last_hash
```

Útil en dashboard interno para visualizar crecimiento.

### 6.3 Slow queries (advisor performance)

Cadencia mensual: `mcp__supabase__get_advisors performance` y aplicar índices recomendados via nuevo SQL N+1.

---

## 7. Referencias

- `packages/database/sql/01_rls_policies.sql` — RLS base + helpers JWT.
- `packages/database/sql/02_audit_triggers.sql` — triggers genéricos Phase 0/1.
- `packages/database/sql/05_audit_hash_chain.sql` — append-only chain.
- `packages/database/sql/22_audit_triggers_phase2.sql` — extensión Phase 2.
- `packages/database/sql/23_rls_catalog_gaps.sql` — RLS catálogos.
- `packages/database/sql/24_security_hardening.sql` — esta iteración.
- `docs/15_production_runbook.md` — runbook operación Vercel+Supabase+Sentry.
- `docs/14_fase2_compliance_review.md` v1.1 — compliance final Phase 2.

---

## 8. Firmas

- [x] **@DBA** — Data Architect — SQL 24 redactado y pre-aplicación validada — 2026-05-13.
- [ ] **@SRE** — aplicación a Supabase prod via MCP + activación HIBP en dashboard.
- [ ] **@AE** — verificación advisor post-apply (criterio firma Fase 6).
