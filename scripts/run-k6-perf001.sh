#!/usr/bin/env bash
# scripts/run-k6-perf001.sh — wrapper para la suite A-F de REQ-HIS-PERF-001.
#
# Distinta de scripts/run-k6.sh (suite 01-06 preexistente, pensada para
# correr contra staging/preview): esta suite SOLO corre contra localhost —
# el guard anti-producción (infra/k6/lib/guard.js) aborta si BASE_URL no
# es localhost, pero además este wrapper nunca deja pasar un BASE_URL vacío
# u otra cosa por descuido.
#
# Requiere Docker (imagen grafana/k6). Requiere que la app + Postgres local
# + Supabase local (`npx supabase start`) ya estén arriba — ver
# docs/performance/REQ-HIS-PERF-001-resultados.md, sección "Entorno".
#
# Uso:
#   ./scripts/run-k6-perf001.sh a-latencia-baseline
#   ./scripts/run-k6-perf001.sh c-estres
#   HARD_VU_CEILING=300 ./scripts/run-k6-perf001.sh c-estres
#
# Variables de entorno reconocidas (ver infra/k6/lib/config.js y
# infra/k6/config/*.js):
#   BASE_URL           default: http://localhost:3000 (DEBE ser localhost)
#   SUPABASE_URL        default: http://localhost:54321
#   SUPABASE_ANON_KEY   anon key del Supabase local (`supabase status`)
#   K6_USER_EMAIL       default: qa.physician@his.test
#   K6_USER_PASSWORD    default: TestPass123!
#   HARD_VU_CEILING     default: 1500 (techo fijado por Edwin 2026-08-17)
#   VUS_A, VUS_SOAK, SOAK_MINUTES — overrides puntuales, ver config/stages.js

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
K6_DIR="${REPO_ROOT}/infra/k6"
SCENARIO="${1:?Uso: run-k6-perf001.sh <a-latencia-baseline|b-concurrencia-carga|c-estres|d-spike|e-soak|f-resiliencia-dos>}"
SCRIPT="scenarios/${SCENARIO}.js"

if [ ! -f "${K6_DIR}/${SCRIPT}" ]; then
  echo "Scenario '${SCENARIO}' no encontrado en ${K6_DIR}/scenarios/."
  echo "Disponibles: a-latencia-baseline b-concurrencia-carga c-estres d-spike e-soak f-resiliencia-dos"
  exit 1
fi

BASE_URL="${BASE_URL:-http://localhost:3000}"
case "$BASE_URL" in
  http://localhost*|http://127.0.0.1*)
    ;;
  *)
    # Preview de Vercel explícitamente autorizado. La validación fuerte la hace
    # infra/k6/lib/guard.js: bloquea los dominios de PRODUCCIÓN de forma absoluta
    # (PERF_ALLOW_HOST no los habilita) y exige el token de bypass, sin el cual
    # Vercel devuelve su challenge y mediríamos el WAF en vez de la app.
    if [ -z "${PERF_ALLOW_HOST:-}" ] || [ -z "${VERCEL_BYPASS_TOKEN:-}" ]; then
      echo "ABORTANDO: BASE_URL='${BASE_URL}' no es localhost."
      echo "Para correr contra un preview de Vercel hacen falta AMBAS:"
      echo "  PERF_ALLOW_HOST=<host-del-preview>  VERCEL_BYPASS_TOKEN=<token>"
      exit 1
    fi
    ;;
esac

if ! command -v docker &>/dev/null; then
  echo "Error: Docker no encontrado."
  exit 1
fi

mkdir -p "${K6_DIR}/reports"
OUT_JSON="reports/${SCENARIO}-summary.json"

echo "Corriendo k6 (REQ-HIS-PERF-001): ${SCRIPT}"
echo "  BASE_URL: ${BASE_URL}"
echo "  Reporte:  infra/k6/${OUT_JSON}"
echo ""

docker run --rm -i \
  --network host \
  -e "BASE_URL=${BASE_URL}" \
  -e "SUPABASE_URL=${SUPABASE_URL:-http://localhost:54321}" \
  -e "SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY:-}" \
  -e "K6_USER_EMAIL=${K6_USER_EMAIL:-qa.physician@his.test}" \
  -e "K6_USER_PASSWORD=${K6_USER_PASSWORD:-TestPass123!}" \
  -e "HARD_VU_CEILING=${HARD_VU_CEILING:-1500}" \
  -e "SUPABASE_AUTH_REF=${SUPABASE_AUTH_REF:-}" \
  -e "PERF_ALLOW_HOST=${PERF_ALLOW_HOST:-}" \
  -e "VERCEL_BYPASS_TOKEN=${VERCEL_BYPASS_TOKEN:-}" \
  -e "VUS_A=${VUS_A:-}" \
  -e "VUS_SOAK=${VUS_SOAK:-}" \
  -e "SOAK_MINUTES=${SOAK_MINUTES:-}" \
  -v "${K6_DIR}:/scripts" \
  grafana/k6:latest \
  run --summary-export="/scripts/${OUT_JSON}" "/scripts/${SCRIPT}"

node "${K6_DIR}/reports/summarize.mjs" "${K6_DIR}/${OUT_JSON}"
