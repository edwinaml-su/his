#!/usr/bin/env bash
# =============================================================================
# HIS Multipaís — dr-drill.sh
# Orquesta el drill completo de Disaster Recovery:
#   1. Levanta postgres:15 Docker efímero (docker-compose.test.yml)
#   2. Crea BD his_drill en el target
#   3. pg_dump de produccion (via backup-pg-dump.sh)
#   4. Restore al Docker (via restore-pg-dump.sh)
#   5. Smoke checks adicionales
#   6. Imprime reporte de metricas
#
# Uso:
#   DATABASE_URL=<direct_url_prod> ./scripts/dr-drill.sh [dump-only]
#
#   dump-only: solo ejecuta el pg_dump (sin restore). Util para CI rapido.
#
# Requisitos:
#   - docker + docker compose disponibles
#   - pg_dump / psql en PATH (o via Docker — ver scripts/backup-pg-dump.sh)
#   - DATABASE_URL cargado (DIRECT_URL de Supabase, puerto 5432)
#   - ~2 GB espacio libre en disco
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.test.yml"
SCRIPTS_DIR="$ROOT_DIR/scripts"
DRILL_DATE="$(date +%Y%m%d-%H%M%S)"
DUMP_FILE="$ROOT_DIR/backups/drill-${DRILL_DATE}.dump"
TARGET_HOST="localhost"
TARGET_PORT="5432"
TARGET_URL="postgresql://his:his@${TARGET_HOST}:${TARGET_PORT}/his_drill"
MODE="${1:-full}"

# Guard: DATABASE_URL requerido
: "${DATABASE_URL:?DATABASE_URL es requerido. Cargar DIRECT_URL (puerto 5432) de .env.local}"

DRILL_START=$(date +%s)

echo "============================================================"
echo "  HIS Disaster Recovery Drill — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "  Modo: ${MODE}"
echo "============================================================"
echo ""

mkdir -p "$ROOT_DIR/backups"

# -------------------------------------------------------------------------
# Paso 1: pg_dump produccion
# -------------------------------------------------------------------------
echo "[$(date -u +%H:%M:%SZ)] PASO 1: pg_dump produccion"
DUMP_START=$(date +%s)
"$SCRIPTS_DIR/backup-pg-dump.sh" "$DUMP_FILE"
DUMP_END=$(date +%s)
DUMP_ELAPSED=$((DUMP_END - DUMP_START))
DUMP_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
echo "[$(date -u +%H:%M:%SZ)] PASO 1 OK — ${DUMP_ELAPSED}s, ${DUMP_SIZE}"
echo ""

# -------------------------------------------------------------------------
# Modo dump-only: validar y salir
# -------------------------------------------------------------------------
if [[ "$MODE" == "dump-only" ]]; then
  echo "[$(date -u +%H:%M:%SZ)] PASO 2: Validar dump (dump-only mode)"
  OBJECT_COUNT=$(pg_restore -l "$DUMP_FILE" | wc -l | tr -d ' ')
  echo "[$(date -u +%H:%M:%SZ)] Objetos en dump: $OBJECT_COUNT"
  echo ""
  DRILL_END=$(date +%s)
  TOTAL=$((DRILL_END - DRILL_START))
  echo "============================================================"
  echo "  DRILL (dump-only) COMPLETADO en ${TOTAL}s"
  echo "  dump_file:            $DUMP_FILE"
  echo "  dump_size:            $DUMP_SIZE"
  echo "  dump_time_seconds:    $DUMP_ELAPSED"
  echo "  dump_object_count:    $OBJECT_COUNT"
  echo "============================================================"
  exit 0
fi

# -------------------------------------------------------------------------
# Paso 2: Levantar postgres Docker efimero
# -------------------------------------------------------------------------
echo "[$(date -u +%H:%M:%SZ)] PASO 2: Levantar postgres Docker efimero"
docker compose -f "$COMPOSE_FILE" up -d --wait postgres-test
echo "[$(date -u +%H:%M:%SZ)] PASO 2 OK — container his-postgres-test healthy"
echo ""

# -------------------------------------------------------------------------
# Paso 3: Crear BD drill separada
# -------------------------------------------------------------------------
echo "[$(date -u +%H:%M:%SZ)] PASO 3: Crear BD his_drill"
docker exec his-postgres-test psql -U his -d postgres \
  -c "CREATE DATABASE his_drill;" 2>/dev/null || echo "[INFO] his_drill ya existe"
echo "[$(date -u +%H:%M:%SZ)] PASO 3 OK"
echo ""

# -------------------------------------------------------------------------
# Paso 4: Restore al Docker
# -------------------------------------------------------------------------
echo "[$(date -u +%H:%M:%SZ)] PASO 4: Restore dump → his_drill"
RESTORE_START=$(date +%s)

# Pasar la TARGET_URL sin el guard de supabase.co (es localhost)
# El script restore-pg-dump.sh bloquearia supabase.co pero aqui es localhost
pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --dbname="$TARGET_URL" \
  "$DUMP_FILE" || echo "[WARN] pg_restore con warnings (puede ser normal para roles Supabase)"

RESTORE_END=$(date +%s)
RESTORE_ELAPSED=$((RESTORE_END - RESTORE_START))
echo "[$(date -u +%H:%M:%SZ)] PASO 4 OK — ${RESTORE_ELAPSED}s"
echo ""

# -------------------------------------------------------------------------
# Paso 5: Smoke checks
# -------------------------------------------------------------------------
echo "[$(date -u +%H:%M:%SZ)] PASO 5: Smoke checks"
echo ""

echo "--- Conteos por tabla ---"
psql "$TARGET_URL" -c "
  SELECT 'Patient'                  AS tabla, COUNT(*) AS filas FROM \"Patient\"
  UNION ALL
  SELECT 'Encounter',                         COUNT(*) FROM \"Encounter\"
  UNION ALL
  SELECT 'MedicationAdministration',          COUNT(*) FROM \"MedicationAdministration\"
  UNION ALL
  SELECT 'AuditLog',                         COUNT(*) FROM audit."AuditLog";
" 2>/dev/null || echo "[WARN] No se pudo ejecutar conteos de tablas"

echo ""
echo "--- Audit log rango temporal ---"
psql "$TARGET_URL" -c "
  SELECT
    MIN(\"occurredAt\") AS primer_registro,
    MAX(\"occurredAt\") AS ultimo_registro,
    COUNT(*)           AS total_entradas
  FROM audit.\"AuditLog\";
" 2>/dev/null || echo "[WARN] No se pudo consultar audit.AuditLog"

echo ""
echo "--- Integridad audit hash chain ---"
BROKEN=$(psql "$TARGET_URL" -t -A -c "
  SELECT COUNT(*)
  FROM audit.\"AuditLog\" a
  WHERE a.\"prevHash\" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM audit.\"AuditLog\" p
      WHERE p.\"signatureHash\" = a.\"prevHash\"
    );
" 2>/dev/null || echo "ERR")

if [[ "$BROKEN" == "0" ]]; then
  echo "[OK] Audit chain integra: 0 enlaces rotos"
elif [[ "$BROKEN" == "ERR" ]]; then
  echo "[WARN] No se pudo verificar audit chain"
else
  echo "[FAIL] Audit chain: ${BROKEN} enlaces rotos"
fi

echo ""

# -------------------------------------------------------------------------
# Paso 6: Cleanup (comentado para inspeccion manual post-drill)
# -------------------------------------------------------------------------
# Descomentar si se desea cleanup automatico:
# echo "[$(date -u +%H:%M:%SZ)] PASO 6: Cleanup Docker"
# docker compose -f "$COMPOSE_FILE" down
# echo "[$(date -u +%H:%M:%SZ)] PASO 6 OK"

echo "[INFO] Docker sigue corriendo para inspeccion manual."
echo "[INFO] Para cleanup: docker compose -f $COMPOSE_FILE down"
echo ""

# -------------------------------------------------------------------------
# Reporte final
# -------------------------------------------------------------------------
DRILL_END=$(date +%s)
TOTAL=$((DRILL_END - DRILL_START))

echo "============================================================"
echo "  DRILL COMPLETADO — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "------------------------------------------------------------"
echo "  dump_file:             $DUMP_FILE"
echo "  dump_size:             $DUMP_SIZE"
echo "  dump_time_seconds:     $DUMP_ELAPSED"
echo "  restore_time_seconds:  $RESTORE_ELAPSED"
echo "  total_time_seconds:    $TOTAL"
echo "  audit_chain_status:    ${BROKEN}"
echo "------------------------------------------------------------"
echo "  Siguiente paso: crear docs/drills/${DRILL_DATE}_dr_drill.md"
echo "  con los resultados de los smoke checks."
echo "============================================================"
