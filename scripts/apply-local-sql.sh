#!/usr/bin/env bash
# scripts/apply-local-sql.sh — aplica packages/database/sql/*.sql en orden
# numérico contra una BD local (Postgres/Supabase local), para replicar el
# hardening/RLS/motor ECE que en prod se aplicó vía Supabase SQL Editor/MCP
# (CLAUDE.md: "Sin carpeta prisma/migrations" — es deliberado).
#
# CONSTRUIDO PARA REQ-HIS-PERF-001 (2026-08-17) — NO VERIFICADO EN VIVO
# contra el corpus completo (227 archivos) en esta sesión: ver
# docs/performance/REQ-HIS-PERF-001-resultados.md, sección "Entorno".
# Se espera que algunos archivos fallen (dependen de extensiones/schemas de
# Supabase real — vault, pgsodium, auth.* — que `supabase start` local SÍ
# provee, a diferencia del docker-compose Postgres-only de infra/docker/).
# El script PARA en el primer error (no sigue aplicando sobre un estado
# roto) e imprime el archivo exacto que falló.
#
# Uso:
#   DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
#     ./scripts/apply-local-sql.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SQL_DIR="${REPO_ROOT}/packages/database/sql"
DB_URL="${DATABASE_URL:?Definí DATABASE_URL (ej. la que imprime 'supabase status' como 'DB URL')}"

case "$DB_URL" in
  *ejacvsgbewcerxtjtwto* | *supabase.co* | *complejoavante*)
    echo "ABORTANDO: DATABASE_URL parece apuntar al proyecto Supabase remoto/prod. Este script es SOLO para BD local." >&2
    exit 1
    ;;
esac

mapfile -t FILES < <(cd "$SQL_DIR" && ls *.sql | sort -V)
echo "Aplicando ${#FILES[@]} archivos SQL contra: ${DB_URL%%@*}@***"

i=0
for f in "${FILES[@]}"; do
  i=$((i + 1))
  printf '[%3d/%3d] %s ... ' "$i" "${#FILES[@]}" "$f"
  if psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "${SQL_DIR}/${f}" > /tmp/apply-sql-last.log 2>&1; then
    echo "OK"
  else
    echo "FALLÓ"
    echo "--- Salida de psql (${f}) ---"
    cat /tmp/apply-sql-last.log
    echo "-----------------------------"
    echo "Detenido en archivo ${i}/${#FILES[@]}: ${f}. Revisar el error arriba antes de continuar."
    exit 1
  fi
done

echo "Los ${#FILES[@]} archivos SQL se aplicaron sin errores."
