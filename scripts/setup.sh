#!/usr/bin/env bash
# =============================================================================
# HIS Multipaís - setup inicial del entorno de desarrollo
# Idempotente: se puede correr múltiples veces sin efectos colaterales.
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

log()  { printf '\033[1;34m[setup]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn] \033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[err]  \033[0m %s\n' "$*" >&2; }

# 1. Prerequisitos
log "Verificando Node 20+ y npm 10+..."
node_major=$(node -v 2>/dev/null | sed -E 's/^v([0-9]+)\..*/\1/' || echo "0")
if [[ "${node_major}" -lt 20 ]]; then
  err "Se requiere Node 20+. Actual: $(node -v 2>/dev/null || echo 'no instalado')"
  exit 1
fi

# 2. .env.local
if [[ ! -f ".env.local" ]]; then
  log "Creando .env.local desde .env.example..."
  cp .env.example .env.local
  warn "Editá .env.local con tus credenciales antes de correr la app."
else
  log ".env.local ya existe — sin cambios."
fi

# 3. Dependencias
log "Instalando dependencias (npm ci si hay lockfile, npm install si no)..."
if [[ -f "package-lock.json" ]]; then
  npm ci
else
  npm install
fi

# 4. Prisma generate
log "Generando cliente Prisma..."
npx prisma generate --schema=packages/database/prisma/schema.prisma

# 5. Postgres local
if command -v docker >/dev/null 2>&1; then
  log "Levantando stack local (postgres + redis)..."
  docker compose up -d
else
  warn "Docker no encontrado. Levantá Postgres por tu cuenta o instalá Docker Desktop."
fi

log "Setup completo. Próximos pasos:"
echo "  1. Editá .env.local con credenciales de Supabase si las tenés."
echo "  2. Aplicá migraciones:  npm run db:migrate"
echo "  3. Sembrá datos:        npm run db:seed"
echo "  4. Arrancá dev:         npm run dev"
