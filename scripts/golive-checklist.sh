#!/usr/bin/env bash
# golive-checklist.sh — Verifica criterios técnicos críticos para Go-Live HIS Avante.
# Equipo: Uniform — E9 Onboarding y Go-Live (US-9.3).
# Uso:
#   ./scripts/golive-checklist.sh                  # ejecuta todos los items
#   ./scripts/golive-checklist.sh --only=api,db    # solo grupos especificados
#   ./scripts/golive-checklist.sh --quiet          # solo errores
#
# Exit codes:
#   0 → todos los items críticos en verde.
#   1 → al menos un item crítico falló.
#   2 → error de configuración (faltan envs requeridas para ejecutar el check).

set -uo pipefail

# -----------------------------------------------------------------------------
# Config y colores
# -----------------------------------------------------------------------------
GREEN="\033[0;32m"
RED="\033[0;31m"
YELLOW="\033[0;33m"
CYAN="\033[0;36m"
BOLD="\033[1m"
RESET="\033[0m"

if [[ ! -t 1 ]]; then
  GREEN=""; RED=""; YELLOW=""; CYAN=""; BOLD=""; RESET=""
fi

QUIET=0
ONLY=""
for arg in "$@"; do
  case "$arg" in
    --quiet) QUIET=1 ;;
    --only=*) ONLY="${arg#--only=}" ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
  esac
done

PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0
CRITICAL_FAIL=0

log_pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  [[ $QUIET -eq 0 ]] && printf "  ${GREEN}OK${RESET}    %s\n" "$1"
}
log_fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  CRITICAL_FAIL=1
  printf "  ${RED}FAIL${RESET}  %s ${RED}(%s)${RESET}\n" "$1" "${2:-critico}"
}
log_warn() {
  WARN_COUNT=$((WARN_COUNT + 1))
  [[ $QUIET -eq 0 ]] && printf "  ${YELLOW}WARN${RESET}  %s ${YELLOW}(%s)${RESET}\n" "$1" "${2:-no critico}"
}

section() {
  if [[ -n "$ONLY" && ",$ONLY," != *",$1,"* ]]; then
    SKIP_SECTION=1
    return
  fi
  SKIP_SECTION=0
  [[ $QUIET -eq 0 ]] && printf "\n${BOLD}${CYAN}== %s ==${RESET}\n" "$2"
}

is_skipped() { [[ ${SKIP_SECTION:-0} -eq 1 ]]; }

# -----------------------------------------------------------------------------
# Variables esperadas (configurables vía env)
# -----------------------------------------------------------------------------
APP_BASE_URL="${APP_BASE_URL:-https://his.avante.local}"
HEALTH_PATH="${HEALTH_PATH:-/api/health}"
REQUIRED_ENV_VARS=(
  "DATABASE_URL"
  "DIRECT_URL"
  "NEXTAUTH_SECRET"
  "NEXTAUTH_URL"
  "SUPABASE_URL"
  "SUPABASE_SERVICE_ROLE_KEY"
  "AUDIT_HASH_SECRET"
)
DEPLOY_HOOK_STATUS_URL="${VERCEL_DEPLOY_STATUS_URL:-}"
DB_PING_TIMEOUT_MS="${DB_PING_TIMEOUT_MS:-1000}"

# -----------------------------------------------------------------------------
# 1. API health
# -----------------------------------------------------------------------------
section "api" "API health"
if ! is_skipped; then
  if ! command -v curl >/dev/null 2>&1; then
    log_fail "curl no instalado" "config"
  else
    URL="${APP_BASE_URL%/}${HEALTH_PATH}"
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 10 "$URL" || echo "000")
    if [[ "$HTTP_CODE" == "200" ]]; then
      log_pass "GET ${URL} → 200"
    else
      log_fail "GET ${URL} → ${HTTP_CODE}" "critico"
    fi
  fi
fi

# -----------------------------------------------------------------------------
# 2. Variables de entorno críticas
# -----------------------------------------------------------------------------
section "env" "Variables de entorno criticas"
if ! is_skipped; then
  for var in "${REQUIRED_ENV_VARS[@]}"; do
    if [[ -n "${!var:-}" ]]; then
      log_pass "${var} presente"
    else
      log_fail "${var} ausente" "critico"
    fi
  done
fi

# -----------------------------------------------------------------------------
# 3. Vercel: ultimo deploy READY
# -----------------------------------------------------------------------------
section "deploy" "Vercel deploy status"
if ! is_skipped; then
  if [[ -z "$DEPLOY_HOOK_STATUS_URL" ]]; then
    log_warn "VERCEL_DEPLOY_STATUS_URL no configurada; saltando check programatico" "skip"
  else
    DEPLOY_JSON=$(curl -s -m 10 "$DEPLOY_HOOK_STATUS_URL" || echo "")
    if [[ -z "$DEPLOY_JSON" ]]; then
      log_fail "No se pudo consultar Vercel deploy status" "critico"
    else
      if echo "$DEPLOY_JSON" | grep -q '"state":"READY"'; then
        log_pass "Vercel: ultimo deploy en estado READY"
      else
        STATE=$(echo "$DEPLOY_JSON" | grep -o '"state":"[^"]*"' | head -n1 || echo "desconocido")
        log_fail "Vercel deploy no READY (${STATE})" "critico"
      fi
    fi
  fi
fi

# -----------------------------------------------------------------------------
# 4. Base de datos: conexion < N ms
# -----------------------------------------------------------------------------
section "db" "Conexion BD"
if ! is_skipped; then
  if [[ -z "${DATABASE_URL:-}" ]]; then
    log_fail "DATABASE_URL no definida" "critico"
  elif ! command -v psql >/dev/null 2>&1; then
    log_warn "psql no instalado; usando fallback Node" "skip"
    if command -v node >/dev/null 2>&1; then
      START_MS=$(node -e 'process.stdout.write(String(Date.now()))')
      if node -e "
        const { Client } = require('pg');
        const c = new Client({ connectionString: process.env.DATABASE_URL });
        c.connect().then(() => c.query('SELECT 1')).then(() => c.end()).catch(e => { console.error(e.message); process.exit(1); });
      " >/dev/null 2>&1; then
        END_MS=$(node -e 'process.stdout.write(String(Date.now()))')
        ELAPSED=$((END_MS - START_MS))
        if [[ $ELAPSED -lt $DB_PING_TIMEOUT_MS ]]; then
          log_pass "BD respondio en ${ELAPSED}ms (<${DB_PING_TIMEOUT_MS}ms)"
        else
          log_fail "BD respondio en ${ELAPSED}ms (>=${DB_PING_TIMEOUT_MS}ms)" "critico"
        fi
      else
        log_fail "BD no respondio (fallback Node)" "critico"
      fi
    else
      log_fail "Ni psql ni node disponibles para probar conexion" "config"
    fi
  else
    START_MS=$(date +%s%3N 2>/dev/null || python -c "import time;print(int(time.time()*1000))")
    if psql "$DATABASE_URL" -c "SELECT 1;" -t >/dev/null 2>&1; then
      END_MS=$(date +%s%3N 2>/dev/null || python -c "import time;print(int(time.time()*1000))")
      ELAPSED=$((END_MS - START_MS))
      if [[ $ELAPSED -lt $DB_PING_TIMEOUT_MS ]]; then
        log_pass "BD respondio en ${ELAPSED}ms (<${DB_PING_TIMEOUT_MS}ms)"
      else
        log_fail "BD respondio en ${ELAPSED}ms (>=${DB_PING_TIMEOUT_MS}ms)" "critico"
      fi
    else
      log_fail "psql no pudo ejecutar SELECT 1" "critico"
    fi
  fi
fi

# -----------------------------------------------------------------------------
# 5. Audit chain integrity
# -----------------------------------------------------------------------------
section "audit" "Audit log integrity (cadena hash)"
if ! is_skipped; then
  if [[ -z "${DATABASE_URL:-}" ]]; then
    log_fail "DATABASE_URL no definida; no se puede verificar audit chain" "critico"
  elif ! command -v psql >/dev/null 2>&1; then
    log_warn "psql no disponible; saltando audit chain check" "skip"
  else
    BROKEN=$(psql "$DATABASE_URL" -t -A -c "
      SELECT COUNT(*) FROM audit_log a
      LEFT JOIN audit_log p ON p.id = a.previous_id
      WHERE a.previous_id IS NOT NULL
        AND a.previous_hash IS DISTINCT FROM p.row_hash;
    " 2>/dev/null || echo "ERR")
    if [[ "$BROKEN" == "ERR" ]]; then
      log_fail "No se pudo consultar audit_log (verificar tabla / permisos)" "critico"
    elif [[ "$BROKEN" == "0" ]]; then
      log_pass "Audit chain integra (0 enlaces rotos)"
    else
      log_fail "Audit chain con ${BROKEN} enlaces rotos" "critico"
    fi
  fi
fi

# -----------------------------------------------------------------------------
# 6. Smoke endpoints criticos
# -----------------------------------------------------------------------------
section "smoke" "Smoke endpoints publicos"
if ! is_skipped; then
  CRITICAL_PATHS=(
    "/login"
    "/api/health"
  )
  for path in "${CRITICAL_PATHS[@]}"; do
    URL="${APP_BASE_URL%/}${path}"
    CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 10 "$URL" || echo "000")
    if [[ "$CODE" =~ ^(200|301|302|307|308)$ ]]; then
      log_pass "GET ${path} -> ${CODE}"
    else
      log_fail "GET ${path} -> ${CODE}" "critico"
    fi
  done
fi

# -----------------------------------------------------------------------------
# Resumen
# -----------------------------------------------------------------------------
printf "\n${BOLD}== Resumen ==${RESET}\n"
printf "  ${GREEN}OK${RESET}: %d   ${RED}FAIL${RESET}: %d   ${YELLOW}WARN${RESET}: %d\n" \
  "$PASS_COUNT" "$FAIL_COUNT" "$WARN_COUNT"

if [[ $CRITICAL_FAIL -ne 0 ]]; then
  printf "${RED}${BOLD}NO LISTO PARA GO-LIVE${RESET} - resolver fallos criticos.\n"
  exit 1
fi

printf "${GREEN}${BOLD}LISTO PARA GO-LIVE${RESET} (todos los criticos en verde).\n"
exit 0
