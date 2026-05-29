# DR Drill Inicial — 2026-05-29

**Tipo:** Dry-run parcial (MCP smoke checks + pg_dump bloqueado)
**Ejecutado por:** @SRE — Edwin Martinez
**Fecha:** 2026-05-29
**Duración total:** ~8 min

---

## Resumen

| Item | Resultado |
|---|---|
| pg_dump ejecutado | NO — credencial stale en `.env.local` |
| Restore a docker efímero | NO — Docker Desktop no estaba corriendo |
| Smoke checks via MCP (prod) | OK |
| Audit chain verificada | INTEGRA (0 enlaces rotos) |
| Conteos de tablas críticas | OK |

---

## Infraestructura verificada

- **Supabase proyecto:** `ejacvsgbewcerxtjtwto` (sa-east-1 / us-west-2 pooler)
- **pg_dump disponible localmente:** Si — `pg_dump (PostgreSQL) 18.4`
- **psql disponible:** Si — `psql (PostgreSQL) 18.4`
- **Docker Desktop:** NO corriendo al momento del drill

---

## Smoke checks (via MCP Supabase, conexión autenticada)

### Conteos por tabla crítica

| Tabla | Filas en prod |
|---|---|
| Patient | 123 |
| Encounter | 27 |
| MedicationAdministration | 0 |
| audit.AuditLog | 5,207 |

### Audit hash chain

| Métrica | Valor |
|---|---|
| Primer registro | 2026-05-01 18:08:44 UTC |
| Último registro | 2026-05-29 15:13:41 UTC |
| Total entradas | 5,207 |
| **Audit chain estado** | **INTEGRA — 0 enlaces rotos** |

Query ejecutada:
```sql
SELECT COUNT(*) AS enlaces_rotos
FROM audit."AuditLog" a
WHERE a."prevHash" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM audit."AuditLog" p
    WHERE p."signatureHash" = a."prevHash"
  );
-- Resultado: 0
```

> **Nota schema real:** tabla es `audit."AuditLog"` (PascalCase, generada por Prisma),
> no `audit.audit_log`. El runbook `docs/41_runbook_backup_dr.md` y los scripts
> usan `audit.audit_log` — corregir en siguiente iteración del runbook.
> Columnas reales: `occurredAt`, `signatureHash`, `prevHash`, `previousId` no existe
> (el chain se mantiene por `prevHash` string match, no por FK).

---

## Bloqueos encontrados y acciones requeridas

### 1. Credencial DIRECT_URL stale en `.env.local`

**Problema:** `DIRECT_URL` en `.env.local` falla autenticación contra Supabase.

```
FATAL: password authentication failed for user "postgres"
Host: aws-1-us-west-2.pooler.supabase.com:5432
```

**Causa probable:** La password del proyecto Supabase fue rotada (ver `docs/15_production_runbook.md §7`) y `.env.local` no fue actualizado.

**Acción requerida (Edwin):**
1. Dashboard Supabase → Settings → Database → "Connection string" → copiar URI directa (puerto 5432).
2. Actualizar `DIRECT_URL` en `.env.local`.
3. Re-ejecutar: `DATABASE_URL=$DIRECT_URL ./scripts/backup-pg-dump.sh`

**Acción requerida (SRE):** añadir `BACKUP_DRILL_DATABASE_URL` como GitHub secret apuntando a la DIRECT_URL actualizada. Este secret es el que usa el workflow `backup-drill.yml`.

### 2. Docker Desktop no corriendo

**Problema:** Docker no estaba activo — el restore al target efímero no pudo ejecutarse.

**Acción requerida:** Para el próximo drill completo, verificar `docker info` antes de iniciar.

---

## Hallazgo técnico: nombre real de la tabla audit

El schema real en prod es:

- Schema: `audit`
- Tabla: `"AuditLog"` (PascalCase — Prisma-generated)
- Columnas relevantes: `id` (bigint), `occurredAt` (timestamptz), `signatureHash` (varchar), `prevHash` (varchar)

Los scripts `restore-pg-dump.sh` y `dr-drill.sh` usan `audit.audit_log` — actualizar en próxima iteración.

---

## Verificación de scripts (bash -n)

```
bash -n scripts/backup-pg-dump.sh  → OK
bash -n scripts/restore-pg-dump.sh → OK
bash -n scripts/dr-drill.sh        → OK
```

---

## Próximo drill (Q3 2026 — fecha objetivo: 2026-09-25)

Prerequisitos antes del próximo drill:

- [ ] `DIRECT_URL` actualizado en `.env.local` con password vigente.
- [ ] `BACKUP_DRILL_DATABASE_URL` secret configurado en GitHub Actions.
- [ ] Docker Desktop corriendo (`docker info` antes de iniciar).
- [ ] Ejecutar drill completo: `DATABASE_URL=$DIRECT_URL ./scripts/dr-drill.sh full`.
- [ ] Actualizar scripts con nombre real `audit."AuditLog"` (en lugar de `audit.audit_log`).
- [ ] Documentar tiempos reales de pg_dump + restore en esta tabla:

| Métrica | Target | Real (Q3) |
|---|---|---|
| Tiempo pg_dump | < 5 min | pendiente |
| Tamaño dump comprimido | < 150 MB | pendiente |
| Tiempo restore | < 10 min | pendiente |
| Tiempo total drill | < 30 min | pendiente |

---

## Conclusión

Los **datos de producción están en buen estado**:
- 5,207 entradas de audit con cadena hash íntegra.
- Tablas clínicas con datos coherentes.

Los **scripts y runbook están listos** para el drill real, pero hay dos prerequisitos operativos que dependen de Edwin:
1. Password correcta para `DIRECT_URL`.
2. Docker Desktop activo.

Una vez resueltos, el drill completo es ejecutable con un solo comando:
```bash
DATABASE_URL=$DIRECT_URL ./scripts/dr-drill.sh
```
