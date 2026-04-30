#!/usr/bin/env bash
# =============================================================================
# HIS Multipaís - reset DESTRUCTIVO de la BD local
# Borra el volumen de Postgres, recrea el contenedor y aplica migraciones.
# NO se puede usar contra DATABASE_URL que apunte a Supabase / staging / prod.
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

red()    { printf '\033[1;31m%s\033[0m\n' "$*"; }
yellow() { printf '\033[1;33m%s\033[0m\n' "$*"; }
green()  { printf '\033[1;32m%s\033[0m\n' "$*"; }

# Cargar .env.local si existe (sin exportar todo, solo DATABASE_URL)
if [[ -f ".env.local" ]]; then
  # shellcheck disable=SC2046
  export $(grep -E '^DATABASE_URL=' .env.local | head -n1)
fi

# Guard rail: solo permitir contra localhost / 127.0.0.1
DB_URL="${DATABASE_URL:-}"
if [[ -z "${DB_URL}" ]]; then
  red "DATABASE_URL no definido. Revisá .env.local."
  exit 1
fi

if ! echo "${DB_URL}" | grep -Eq '@(localhost|127\.0\.0\.1|postgres):'; then
  red "ABORTADO: DATABASE_URL no apunta a localhost/127.0.0.1/postgres-container."
  red "Este script SOLO puede correr contra la BD de desarrollo local."
  red "URL detectada: ${DB_URL}"
  exit 2
fi

red "===================================================="
red "  PELIGRO — db-reset.sh"
red "===================================================="
yellow "Esto va a:"
yellow "  1. Detener y borrar el volumen 'postgres-data' (data perdida)"
yellow "  2. Recrear el contenedor postgres limpio"
yellow "  3. Aplicar migraciones desde cero"
yellow "  4. Re-sembrar datos (npm run db:seed)"
echo

read -r -p "Escribí 'reset' para confirmar: " confirmation
if [[ "${confirmation}" != "reset" ]]; then
  yellow "Cancelado."
  exit 0
fi

green "[1/4] Bajando stack y borrando volumen..."
docker compose down -v

green "[2/4] Recreando Postgres..."
docker compose up -d postgres
# esperar healthy
for i in {1..30}; do
  if docker compose exec -T postgres pg_isready -U his >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

green "[3/4] Aplicando migraciones..."
npm run db:migrate

green "[4/4] Sembrando datos..."
npm run db:seed || yellow "Seed falló o no implementado — continuar manualmente."

green "Reset completo."
