#!/usr/bin/env bash
# =============================================================================
# HIS Multipaís — restore-pg-dump.sh
# Restaura un dump (formato custom) a una BD target.
#
# Uso:
#   ./scripts/restore-pg-dump.sh <dump_file> <target_db_url>
#
# Ejemplo (target local Docker del drill):
#   ./scripts/restore-pg-dump.sh ./backups/his-20260529.dump \
#     "postgresql://his:his@localhost:5432/his_drill"
#
# PRECAUCION:
#   - Nunca usar esta URL como target: DATABASE_URL de Supabase produccion.
#   - Usar solo targets locales (localhost/127.0.0.1) o proyectos Supabase de DR.
#   - El restore con --clean hace DROP de los objetos existentes en el target.
#
# Notas sobre errores esperados:
#   pg_restore puede retornar exit code != 0 por advertencias de roles
#   inexistentes (ej: "role supabase_admin does not exist"). Esto es normal
#   en un target local. Los datos se restauran correctamente — verificar con
#   los smoke checks al final del script.
# =============================================================================
set -euo pipefail

DUMP="${1:?Argumento 1 requerido: path al dump file}"
TARGET="${2:?Argumento 2 requerido: URL de BD target (postgresql://user:pass@host:port/db)}"

# Guard: dump file existe
if [[ ! -f "$DUMP" ]]; then
  echo "[ERROR] Dump file no encontrado: $DUMP"
  exit 1
fi

# Guard: no restaurar accidentalmente a prod (contiene supabase.co)
if echo "$TARGET" | grep -q 'supabase\.co'; then
  echo "[ERROR] TARGET_URL apunta a Supabase Cloud (supabase.co)."
  echo "[ERROR] Para DR real en Supabase, usar el dashboard de PITR o crear un nuevo proyecto."
  echo "[ERROR] Este script es para targets locales (Docker/localhost)."
  exit 3
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Restore inicio"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Fuente: $DUMP ($(du -h "$DUMP" | cut -f1))"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Target: $TARGET"
echo ""

START_TS=$(date +%s)

# pg_restore puede terminar con exit code != 0 por warnings de roles — los capturamos
# sin abortar el script (set -e no aplica aqui por el || true)
pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --dbname="$TARGET" \
  "$DUMP" || {
    echo "[WARN] pg_restore termino con exit code != 0."
    echo "[WARN] Esto puede ser normal (roles de Supabase no existen en target local)."
    echo "[WARN] Verificando datos con smoke checks..."
  }

END_TS=$(date +%s)
RESTORE_ELAPSED=$((END_TS - START_TS))

echo ""
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Restore completado en ${RESTORE_ELAPSED}s"
echo ""
echo "=== SMOKE CHECKS ==="
echo ""

# Conteos de tablas criticas
echo "--- Conteos por tabla ---"
psql "$TARGET" -c "
  SELECT 'Patient'                  AS tabla, COUNT(*) AS filas FROM \"Patient\"
  UNION ALL
  SELECT 'Encounter',                         COUNT(*) FROM \"Encounter\"
  UNION ALL
  SELECT 'MedicationAdministration',          COUNT(*) FROM \"MedicationAdministration\"
  UNION ALL
  SELECT 'AuditLog',                          COUNT(*) FROM audit."AuditLog";
" 2>/dev/null || echo "[WARN] No se pudo ejecutar conteos (tabla ausente o error de conexion)"

echo ""
echo "--- Sample paciente (3 filas, datos anonimizados) ---"
psql "$TARGET" -c "
  SELECT id, \"firstName\", \"lastName\", \"dateOfBirth\", \"organizationId\"
  FROM \"Patient\"
  ORDER BY \"createdAt\" DESC
  LIMIT 3;
" 2>/dev/null || echo "[WARN] No se pudo consultar Patient"

echo ""
echo "--- Audit log rango temporal ---"
psql "$TARGET" -c "
  SELECT
    MIN("occurredAt") AS primer_registro,
    MAX("occurredAt") AS ultimo_registro,
    COUNT(*)          AS total_entradas
  FROM audit."AuditLog";
" 2>/dev/null || echo "[WARN] No se pudo consultar audit.AuditLog"

echo ""
echo "--- Integridad audit hash chain ---"
BROKEN=$(psql "$TARGET" -t -A -c "
  SELECT COUNT(*)
  FROM audit.\"AuditLog\" a
  WHERE a.\"prevHash\" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM audit.\"AuditLog\" p
      WHERE p.\"signatureHash\" = a.\"prevHash\"
    );
" 2>/dev/null || echo "ERR")

if [[ "$BROKEN" == "ERR" ]]; then
  echo "[WARN] No se pudo verificar audit chain (tabla puede no existir en target local)"
elif [[ "$BROKEN" == "0" ]]; then
  echo "[OK] Audit chain integra: 0 enlaces rotos"
else
  echo "[FAIL] Audit chain: ${BROKEN} enlaces rotos — investigar antes de usar este restore"
fi

echo ""
echo "=== FIN SMOKE CHECKS ==="
echo ""
echo "# Metricas para docs/drills:"
echo "  restore_time_seconds=${RESTORE_ELAPSED}"
echo "  dump_file=${DUMP}"
echo "  target=${TARGET}"
