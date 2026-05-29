#!/usr/bin/env bash
# =============================================================================
# HIS Multipaís — backup-pg-dump.sh
# Wrapper pg_dump para Supabase HIS producción.
#
# Uso:
#   ./scripts/backup-pg-dump.sh [output_path]
#
# Requiere:
#   DATABASE_URL en entorno (usar DIRECT_URL — puerto 5432, no el pooler 6543).
#   pg_dump v15+. Si no está instalado localmente, usar via Docker:
#     docker run --rm -e PGPASSWORD=... postgres:15 pg_dump ...
#
# Excluye schemas gestionados por Supabase (auth, storage, realtime, etc.)
# para evitar conflictos al restaurar en un proyecto/cluster distinto.
#
# Salida: archivo .dump en formato custom (binario comprimido, restaurable
#         con pg_restore). No es un SQL plano — requiere pg_restore para restore.
# =============================================================================
set -euo pipefail

OUTPUT="${1:-./backups/his-$(date +%Y%m%d-%H%M%S).dump}"
mkdir -p "$(dirname "$OUTPUT")"

# Guard: DATABASE_URL requerido
: "${DATABASE_URL:?DATABASE_URL is required. Load from .env.local (use DIRECT_URL, port 5432).}"

# Guard: no apuntar accidentalmente al pooler (puerto 6543)
if echo "$DATABASE_URL" | grep -q ':6543'; then
  echo "[WARN] DATABASE_URL usa puerto 6543 (pooler). pg_dump requiere conexion directa (puerto 5432)."
  echo "[WARN] Usa DIRECT_URL en lugar de DATABASE_URL. Continuando de todos modos..."
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] pg_dump inicio"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Output: $OUTPUT"

START_TS=$(date +%s)

pg_dump \
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

END_TS=$(date +%s)
ELAPSED=$((END_TS - START_TS))
FILESIZE=$(du -h "$OUTPUT" | cut -f1)

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] pg_dump completado en ${ELAPSED}s"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Tamano: $FILESIZE"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Validar contenido: pg_restore -l $OUTPUT | head -30"
echo ""
echo "# Metricas para docs/drills:"
echo "  dump_time_seconds=${ELAPSED}"
echo "  dump_file_size=${FILESIZE}"
echo "  dump_file=${OUTPUT}"
