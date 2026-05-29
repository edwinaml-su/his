# 41 — Runbook Backup & Disaster Recovery (DR)

**Proyecto:** HIS Multipaís — Inversiones Avante
**Autor:** @SRE — Site Reliability Engineer
**Versión:** 1.0 — 2026-05-29
**Estado:** Operativo. Complementa `docs/15_production_runbook.md §6` y `docs/17_hipercuidado_runbook.md §6`.

> **Alcance:** BD Postgres 15 en Supabase Pro (región `sa-east-1`, ref `ejacvsgbewcerxtjtwto`). Schemas `public` + `ece` + `audit`. ~231 modelos Prisma. Audit hash chain inmutable (retención 10 años per TDR §6.3).

---

## Sección 1 — Backups Supabase (managed)

### 1.1 Backups automáticos diarios

Supabase Pro incluye backups diarios gestionados por la plataforma:

| Atributo | Valor |
|---|---|
| Frecuencia | 1 vez por día (horario UTC, aprox. 04:00) |
| Retención | 7 días en plan Pro (14-28 días en Enterprise) |
| Formato | Snapshot lógico completo de la BD |
| Acceso | Dashboard → Database → Backups |
| Almacenamiento | AWS S3, misma región (`sa-east-1`) |
| Cifrado at rest | AES-256 (administrado por AWS KMS) |
| Cifrado en tránsito | TLS 1.2+ |

**Verificación:**
```
Dashboard Supabase → Database → Backups
→ Última fila debe tener timestamp < 25 h
→ Estado: "Completed"
```

**Restaurar desde backup diario:**
1. Dashboard → Database → Backups → seleccionar fecha.
2. Clic en "Restore" — Supabase crea nuevo proyecto con los datos restaurados.
3. Actualizar `DATABASE_URL` / `DIRECT_URL` en Vercel apuntando al nuevo proyecto.
4. Tiempo estimado: 30–90 min según tamaño de BD.

> **Nota:** los backups diarios NO incluyen los schemas `auth` y `storage` que son gestionados internamente por Supabase. Los datos de autenticación (usuarios, sesiones) se excluyen del dump manual también.

### 1.2 Point-in-Time Recovery (PITR)

Plan Pro incluye PITR. Características:

| Atributo | Valor |
|---|---|
| Cobertura temporal | 7 días retroactivos desde el momento actual |
| Granularidad | ~1 segundo (WAL streaming) |
| Activación | Dashboard → Database → Backups → "Point in time recovery" |
| RPO efectivo | < 5 minutos (limitado por frecuencia de WAL flush) |

**Restaurar con PITR:**
1. Dashboard → Database → Backups → "Point in time recovery".
2. Seleccionar timestamp exacto (usar T-2min del incidente para margen).
3. Confirmar → Supabase restaura en el mismo proyecto (destructivo) o nuevo proyecto.
4. Tiempo estimado: 15–60 min según tamaño WAL.

> **Advertencia:** PITR en el mismo proyecto es destructivo — los datos escritos entre el timestamp elegido y el momento de restore se pierden permanentemente. Siempre documentar el gap.

### 1.3 Backups lógicos vía pg_dump (manuales)

Complementan los backups Supabase en tres escenarios:

- Pre-deploy crítico (migración destructiva).
- Mensual (retention externa, control propio del dump).
- DR drill trimestral.

Comando canónico (ver `scripts/backup-pg-dump.sh` para wrapper completo):

```bash
pg_dump \
  --format=custom \       # formato comprimido restaurable con pg_restore
  --compress=9 \          # compresión máxima (reduce ~70-80% vs plain)
  --no-owner \            # portable entre clusters distintos
  --no-acl \              # no incluir GRANTs (se re-aplican post-restore)
  --exclude-schema=auth \           # Supabase managed — no restaurar
  --exclude-schema=storage \        # Supabase managed — no restaurar
  --exclude-schema=graphql \        # extensión Supabase managed
  --exclude-schema=graphql_public \ # ídem
  --exclude-schema=realtime \       # ídem
  --exclude-schema=supabase_functions \ # ídem
  --exclude-schema=vault \          # ídem
  "$DATABASE_URL" > "his-$(date +%Y%m%d-%H%M%S).dump"
```

**Donde almacenar dumps:**
- Local temporal: `./backups/` (excluir de git via `.gitignore`).
- Largo plazo: S3 bucket privado cifrado (`aws s3 cp his-<ts>.dump s3://avante-his-backups/ --sse aws:kms`).
- GCS alternativo: `gsutil cp his-<ts>.dump gs://avante-his-backups/`.
- **NUNCA** subir a repositorios públicos — el dump contiene PII de pacientes (PHI).

**Validar contenido sin restaurar:**
```bash
pg_restore -l his-<ts>.dump | head -40
# Debe mostrar: public, ece, audit schemas + tablas conocidas
# Verificar que "Patient", "Encounter", "audit_log" aparezcan
```

**Tiempo estimado:** 3–8 min para BD actual (~500 MB estimado comprimido). Medir durante cada drill y actualizar `docs/drills/<fecha>_dr_drill.md`.

---

## Sección 2 — RTO / RPO Targets

### 2.1 Definiciones

| Sigla | Definición | Contexto HIS |
|---|---|---|
| **RTO** | Recovery Time Objective — tiempo máximo tolerable desde incidente hasta restauración de servicio | Desde detección hasta `/api/health → 200` |
| **RPO** | Recovery Point Objective — máxima pérdida de datos tolerable (ventana temporal) | Desde último backup bueno hasta incidente |

### 2.2 Targets por escenario

| Escenario | RTO | RPO | Mecanismo |
|---|---|---|---|
| Falla de app sin pérdida de datos | 15 min | 0 (no hay pérdida) | `vercel promote` |
| Corrupción parcial de datos | 2 h | < 5 min | PITR Supabase |
| Pérdida total de BD (provider outage) | 4 h | < 24 h | Restore desde backup diario o dump manual |
| Ransomware / exfiltración | 4 h | < 5 min (PITR) | PITR + rotate creds |
| Drop accidental de tabla | 30 min | < 5 min | PITR |

### 2.3 Mapeo a SLO de disponibilidad

El SLO de disponibilidad es **99.5% mensual** = máximo **3.65 h de downtime por mes**.

| Situación | Downtime esperado | Dentro de SLO |
|---|---|---|
| Rollback de app (vercel promote) | 10–15 min | Si |
| Restore PITR (BD efímero nuevo proyecto) | 30–90 min | Si |
| Restore backup diario completo | 90–240 min | Limite (4 h = SLO agotado del mes) |
| Failover manual a dump externo | 4–8 h | No — requiere maintenance window comunicada |

> Si el downtime por DR supera 3.65 h en el mes, el SLO se incumple. Comunicar proactivamente a PO + Clinical Lead con timeline realista.

---

## Sección 3 — Scenarios DR

Para cada escenario: **trigger → detección → decisión → ejecución → rollback → post-mortem**.

### Escenario 1: Full DB Loss (provider outage Supabase)

**Trigger:** Supabase reporta outage en `status.supabase.com` que afecta proyecto `ejacvsgbewcerxtjtwto`.

**Detección:**
- UptimeRobot alerta sobre `/api/health` no-200.
- Sentry: pico de errores de conexión BD.
- Dashboard Supabase muestra proyecto en estado de error.

**Decisión:** SRE on-call (no requiere quorum para maintenance mode; requiere PO + SRE Lead para restore).

**Ejecución:**
1. Activar `MAINTENANCE_MODE=true` en Vercel → redeploy.
2. Evaluar ETA de recuperación de Supabase (`status.supabase.com`).
3. Si ETA > 2 h: iniciar restore desde último dump manual en S3.
   ```bash
   # Crear nuevo proyecto Supabase (o usar proyecto DR pre-creado)
   # Obtener nueva DATABASE_URL del proyecto nuevo
   ./scripts/restore-pg-dump.sh s3://avante-his-backups/his-latest.dump "postgresql://..."
   ```
4. Actualizar `DATABASE_URL` y `DIRECT_URL` en Vercel (ambos apuntando al nuevo proyecto).
5. Desactivar `MAINTENANCE_MODE` + `vercel promote` al deploy compatible.
6. Verificar `/api/health` + smoke checks.

**Rollback:** si el restore falla, mantener `MAINTENANCE_MODE` y esperar recuperación de Supabase.

**Post-mortem:** documentar gap de datos (entre último dump y momento del outage), notificar Clinical Lead sobre registros que necesiten re-ingreso.

### Escenario 2: Partial Corruption (audit hash chain rota)

**Trigger:** job de verificación nocturno o `scripts/golive-checklist.sh --only=audit` reporta `FAIL: audit chain con N enlaces rotos`.

**Detección:**
```sql
SELECT COUNT(*) FROM audit.audit_log a
LEFT JOIN audit.audit_log p ON p.id = a.previous_id
WHERE a.previous_id IS NOT NULL
  AND a.previous_hash IS DISTINCT FROM p.row_hash;
-- Si COUNT > 0: cadena rota
```

**Decisión:** P1 inmediato. SRE on-call notifica SRE Lead + PO + Clinical Lead.

**Ejecución:**
1. Identificar timestamp de la primera entrada corrupta.
2. Determinar causa: ¿UPDATE/DELETE directo en `audit_log`? ¿Bug en trigger? ¿Restore parcial?
3. Si causa es lógica (no datos maliciosos): corregir trigger y re-verificar.
4. Si hay sospecha de manipulación maliciosa: PITR al timestamp T-1 de la corrupción.
   ```
   Dashboard → Database → Backups → PITR → timestamp exacto
   ```
5. Post-restore: ejecutar query de verificación → debe retornar 0 filas.
6. Re-aplicar cambios legítimos ocurridos después del PITR (identificar desde logs de app/Sentry).

**Rollback:** no hay — el PITR es el mecanismo de rollback.

**Post-mortem:** determinar si hay obligación regulatoria de reportar la corrupción (ver TDR §6.3).

### Escenario 3: Accidental DROP TABLE / TRUNCATE

**Trigger:** error 500 masivo + query fallando con `relation "X" does not exist` o tabla vacía inesperada.

**Detección:** Sentry error `P2021: The table `X` does not exist in the current database.` + `console.error` en logs Vercel.

**Decisión:** SRE on-call. Tiempo crítico — actuar en < 5 min.

**Ejecución:**
1. `MAINTENANCE_MODE=true` inmediato para frenar escrituras.
2. Identificar timestamp del DROP (Supabase logs o Sentry).
3. PITR a T-2min del DROP:
   ```
   Dashboard → PITR → [timestamp T-2min del incidente]
   ```
4. Verificar que la tabla exista y tenga datos correctos post-restore.
5. `MAINTENANCE_MODE=false`.

**Rollback:** si PITR no cubre el timestamp (> 7 días), usar último dump manual.

**Post-mortem:** ¿Quién ejecutó el DROP? ¿Cómo? Revisar permisos de BD — ningún rol de app debería poder hacer DROP TABLE. Solo `service_role` y `postgres.<ref>` tienen ese poder.

### Escenario 4: Ransomware / Data Exfiltración

**Trigger:** datos cifrados o anómalos en BD, o alerta de exfiltración en logs de red/Supabase.

**Detección:** Clinical Lead reporta datos ilegibles; Supabase logs muestran queries masivos de SELECT *.

**Decisión:** P1. Requiere PO + SRE Lead + Clinical Lead (2/3 quorum). Notificar Legal + Compliance.

**Ejecución:**
1. `MAINTENANCE_MODE=true` inmediato.
2. **Revocar TODAS las credenciales** (ver `docs/15_production_runbook.md §7`):
   - `SUPABASE_SERVICE_ROLE_KEY` → Supabase Dashboard → Reset.
   - `DATABASE_URL` password → Reset.
   - `AUTH_SECRET` → regenerar.
   - Invalidar todas las sesiones activas (Supabase → Auth → Users → Sign out all).
3. PITR al timestamp anterior a la detección de actividad anómala.
4. Verificar que datos restaurados no contengan el artefacto del ataque.
5. Re-crear credenciales en Vercel.
6. Investigación forense ANTES de re-activar (preservar evidencia).
7. Re-activar con `MAINTENANCE_MODE=false` solo tras clearance de Legal.

**Rollback:** no aplicable — el PITR + rotate creds es el mecanismo.

**Post-mortem:** obligatorio notificación a RNPN/MINSAL si hay brecha de datos de pacientes (regulación SV). Contar con asesoría legal.

### Escenario 5: Schema Migration Broke Production

**Trigger:** migración Prisma exitosa en CI pero causa errores 500 en prod por incompatibilidad de datos reales.

**Detección:** Sentry errores post-deploy; error rate > 1%; `/api/health` retorna checks de BD failing.

**Decisión:** SRE on-call (rollback de app primero; restore BD solo si migración fue destructiva).

**Ejecución — camino A (migración no destructiva, solo agregar columnas):**
1. `vercel promote <último deployment ID estable>` — rollback de app.
2. La columna nueva queda en BD pero la app vieja la ignora → aceptable.
3. Crear hotfix que corrija la migración; re-deployar.

**Ejecución — camino B (migración destructiva: DROP COLUMN, ALTER TYPE):**
1. `MAINTENANCE_MODE=true`.
2. `vercel promote <último deployment ID pre-migración>`.
3. PITR al timestamp anterior al inicio de la migración.
4. `MAINTENANCE_MODE=false` + verificar.
5. El PR de migración vuelve al backlog como fix requerido antes de re-intentar.

**Rollback:** el rollback es el paso 1-3 del camino B.

**Post-mortem:** ¿Por qué la migración no fue detectada en staging? ¿Hay datos reales en prod que no existen en el seed de test?

---

## Sección 4 — pg_dump Procedure

### 4.1 Pre-requisitos

```bash
# Verificar pg_dump disponible
pg_dump --version
# Debe ser: pg_dump (PostgreSQL) 15.x

# Si no está instalado: instalar postgres client tools
# Ubuntu/Debian:
sudo apt-get install -y postgresql-client-15
# macOS:
brew install postgresql@15
# Windows: instalar PostgreSQL 15 client desde postgresql.org/download

# Alternativa (sin instalación local): usar imagen Docker
docker run --rm postgres:15 pg_dump --version
```

### 4.2 Obtener DATABASE_URL

La `DATABASE_URL` para pg_dump debe ser la URL **directa** (puerto 5432), no la del pooler (puerto 6543):

```bash
# Formato directo Supabase:
# postgresql://postgres.<ref>:<password>@aws-0-sa-east-1.pooler.supabase.com:5432/postgres
# O la URL directa en:
# Dashboard → Settings → Database → Connection string → URI (direct connection)

# Cargar desde .env.local:
export DATABASE_URL=$(grep '^DIRECT_URL=' .env.local | cut -d= -f2-)
# O directamente:
export DATABASE_URL="postgresql://postgres.ejacvsgbewcerxtjtwto:<password>@aws-0-sa-east-1.pooler.supabase.com:5432/postgres"
```

> **Seguridad:** nunca pegar la URL con password en comandos que queden en `.bash_history`. Usar variables de entorno o `--dbname` con pgpass.

### 4.3 Ejecutar pg_dump

```bash
# Usando el wrapper (recomendado):
./scripts/backup-pg-dump.sh ./backups/his-manual-$(date +%Y%m%d).dump

# O directamente:
export OUTPUT="./backups/his-$(date +%Y%m%d-%H%M%S).dump"
mkdir -p ./backups

time pg_dump \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-acl \
  --exclude-schema=auth \
  --exclude-schema=storage \
  --exclude-schema=graphql \
  --exclude-schema=graphql_public \
  --exclude-schema=realtime \
  --exclude-schema=supabase_functions \
  --exclude-schema=vault \
  "$DATABASE_URL" > "$OUTPUT"

echo "Tamaño: $(du -h $OUTPUT | cut -f1)"
```

### 4.4 Validar el dump

```bash
# Listar contenido sin restaurar (rápido, ~1-2s):
pg_restore -l "$OUTPUT" | head -50

# Contar objetos por schema:
pg_restore -l "$OUTPUT" | awk '{print $2}' | sort | uniq -c | sort -rn | head -20

# Verificar tablas críticas presentes:
pg_restore -l "$OUTPUT" | grep -E 'TABLE (public|ece|audit)'
# Debe incluir: Patient, Encounter, MedicationAdministration, AuditLog, etc.

# Verificar que los schemas correctos están incluidos:
pg_restore -l "$OUTPUT" | grep '^[0-9]* SCHEMA' | awk '{print $3}'
# Debe mostrar: public, ece, audit (NO debe mostrar: auth, storage, realtime)
```

### 4.5 Tiempos estimados

| BD Size | Dump time | Restore time | Dump file size |
|---|---|---|---|
| < 100 MB datos | 1-2 min | 2-4 min | ~20-40 MB comprimido |
| 100-500 MB | 3-5 min | 5-10 min | ~50-150 MB comprimido |
| > 500 MB | 5-15 min | 10-30 min | ~150-500 MB comprimido |

> Medir en cada drill y actualizar esta tabla con valores reales.

### 4.6 Almacenamiento del dump

```bash
# S3 (recomendado para retention largo plazo):
aws s3 cp "$OUTPUT" s3://avante-his-backups/dumps/ --sse aws:kms

# Verificar upload:
aws s3 ls s3://avante-his-backups/dumps/ --human-readable | tail -5

# Limpiar dumps locales > 7 días (después de confirmar S3):
find ./backups -name "*.dump" -mtime +7 -delete
```

---

## Sección 5 — Restore Procedure

### 5.1 Setup del target (Docker local para drill)

```bash
# Levantar postgres:15 efímero para el restore:
docker compose -f docker-compose.test.yml up -d --wait postgres-test
# Espera a que el healthcheck pase (hasta 50s)

# Crear BD separada para el drill (no contaminar his_e2e):
docker exec his-postgres-test psql -U his -d postgres -c "CREATE DATABASE his_drill;" 2>/dev/null || true

TARGET_URL="postgresql://his:his@localhost:5432/his_drill"
```

### 5.2 Ejecutar restore

```bash
# Usando el wrapper:
./scripts/restore-pg-dump.sh "$DUMP_FILE" "$TARGET_URL"

# O directamente:
time pg_restore \
  --clean \       # DROP IF EXISTS antes de re-crear
  --if-exists \   # no falla si no existe el objeto al hacer DROP
  --no-owner \    # no intentar cambiar ownership (roles no existen en target)
  --no-acl \      # no re-aplicar GRANTs (RLS se aplica por separado)
  --dbname="$TARGET_URL" \
  "$DUMP_FILE" || echo "WARN: pg_restore terminó con errores (puede ser normal para roles/grants/extensions)"
```

> El `pg_restore` retorna exit code != 0 cuando hay advertencias sobre roles inexistentes en el target (ej: `role "supabase_admin" does not exist`). Esto es **normal** en un target local — los datos se restauran correctamente. Verificar con smoke checks.

### 5.3 Verificar RLS y triggers

En un restore a BD local, las policies RLS se restauran pero el rol `authenticated` no existe. Para verificar que las políticas RLS están presentes en el dump:

```bash
psql "$TARGET_URL" -c "\dp public.\"Patient\"" | head -20
# Debe mostrar las policies de RLS (aunque no sean ejecutables sin el rol Supabase)

# Verificar triggers de audit:
psql "$TARGET_URL" -c "SELECT trigger_name, event_object_table FROM information_schema.triggers WHERE trigger_schema = 'public' LIMIT 20;"
```

### 5.4 Smoke checks post-restore

```bash
# Conteos de tablas críticas:
psql "$TARGET_URL" -c "
  SELECT 'Patient' AS tabla, COUNT(*) AS filas FROM \"Patient\"
  UNION ALL SELECT 'Encounter', COUNT(*) FROM \"Encounter\"
  UNION ALL SELECT 'MedicationAdministration', COUNT(*) FROM \"MedicationAdministration\"
  UNION ALL SELECT 'AuditLog', COUNT(*) FROM audit."AuditLog";
"

# Query de paciente sample (verificar datos legibles):
psql "$TARGET_URL" -c "
  SELECT id, \"firstName\", \"lastName\", \"dateOfBirth\", \"organizationId\"
  FROM \"Patient\"
  LIMIT 3;
"

# Audit chain — primer y último registro:
psql "$TARGET_URL" -c "
  SELECT
    MIN(\"occurredAt\") AS primer_registro,
    MAX(\"occurredAt\") AS ultimo_registro,
    COUNT(*)           AS total_entradas
  FROM audit.\"AuditLog\";
"

# Verificar integridad de la cadena (0 = íntegra):
psql "$TARGET_URL" -c "
  SELECT COUNT(*) AS enlaces_rotos
  FROM audit.\"AuditLog\" a
  WHERE a.\"prevHash\" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM audit.\"AuditLog\" p
      WHERE p.\"signatureHash\" = a.\"prevHash\"
    );
"
```

### 5.5 Cleanup post-drill

```bash
# Parar el postgres efímero (datos se pierden por tmpfs):
docker compose -f docker-compose.test.yml down

# Archivar dump (no borrar — es evidencia del drill):
mkdir -p ./docs/drills/dumps
mv "$DUMP_FILE" ./docs/drills/dumps/
echo "Dump archivado: ./docs/drills/dumps/$(basename $DUMP_FILE)"
```

---

## Sección 6 — Drill Checklist (Quarterly)

Ejecutar cada 3 meses. Registrar resultado en `docs/drills/<YYYY-MM-DD>_dr_drill.md`.

**Fecha objetivo:** último viernes de cada trimestre (Mar, Jun, Sep, Dic).

### Pre-drill

- [ ] Notificar a PO y Clinical Lead: drill en ejecución (read-only sobre prod, sin impacto).
- [ ] Verificar que `pg_dump` / `psql` están disponibles (`pg_dump --version`).
- [ ] Verificar que Docker está corriendo (`docker info`).
- [ ] Cargar `DATABASE_URL` (DIRECT_URL, puerto 5432) en entorno de shell.
- [ ] Confirmar espacio en disco: `df -h .` → al menos 2 GB libres.

### Ejecución

- [ ] `pg_dump` ejecutado → dump file generado.
- [ ] Tamaño del dump registrado (MB comprimido).
- [ ] Tiempo de pg_dump registrado (segundos).
- [ ] `pg_restore -l` ejecutado → schemas `public`, `ece`, `audit` presentes, `auth`/`storage` ausentes.
- [ ] Docker postgres:15 efímero levantado y healthy.
- [ ] BD `his_drill` creada en el target.
- [ ] Restore ejecutado → completado (con o sin warnings de roles).
- [ ] Tiempo de restore registrado (segundos).

### Smoke checks

- [ ] Conteo `Patient` en drill == conteo en prod (o razonablemente cercano).
- [ ] Conteo `Encounter` coincide con prod.
- [ ] Conteo `MedicationAdministration` coincide con prod.
- [ ] Conteo `audit.audit_log` coincide con prod.
- [ ] Query SELECT de paciente sample retorna datos legibles (no nulos, no corruptos).
- [ ] Primer y último timestamp de `audit.audit_log` son coherentes.
- [ ] Verificación de cadena hash: `enlaces_rotos = 0`.

### Cierre

- [ ] Tiempo total del drill registrado (minutos desde inicio hasta verificación completa).
- [ ] Cualquier warning o error documentado con causa y conclusión.
- [ ] Reporte creado en `docs/drills/<YYYY-MM-DD>_dr_drill.md`.
- [ ] Docker cleanup ejecutado (`docker compose -f docker-compose.test.yml down`).
- [ ] Dump archivado o borrado según política de retención.
- [ ] Resultados comunicados a PO en siguiente daily stand-up.

---

## Referencias

- `docs/15_production_runbook.md §6` — Rollback con restore de BD.
- `docs/17_hipercuidado_runbook.md §6` — Plan de rollback post go-live.
- `scripts/backup-pg-dump.sh` — Wrapper pg_dump para producción.
- `scripts/restore-pg-dump.sh` — Wrapper pg_restore con smoke checks.
- `scripts/dr-drill.sh` — Orquestador del drill completo.
- `.github/workflows/backup-drill.yml` — Workflow CI manual para dump + drill.
- `TDR_HIS_Multipais.md §6.3` — Requerimientos de audit trail inmutable.
- `packages/database/sql/05_audit_hash_chain.sql` — Implementación SQL del hash chain.
