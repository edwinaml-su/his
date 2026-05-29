#!/usr/bin/env bash
# scripts/run-k6.sh — wrapper para correr escenarios k6 de HIS de forma local.
#
# Requiere Docker. Usa la imagen oficial grafana/k6:latest.
# Las credenciales se leen de variables de entorno — nunca hardcodear.
#
# Uso:
#   ./scripts/run-k6.sh smoke
#   ./scripts/run-k6.sh triage
#   BASE_URL=http://localhost:3000 ./scripts/run-k6.sh bed-map
#   VUS=20 DURATION=5m ./scripts/run-k6.sh triage
#
# Variables de entorno reconocidas:
#   BASE_URL          URL de la app (default: http://localhost:3000)
#   SUPABASE_URL      URL de Supabase (default: http://localhost:54321)
#   SUPABASE_ANON_KEY Anon key de Supabase
#   K6_USER_EMAIL     Email del usuario de prueba
#   K6_USER_PASSWORD  Password del usuario de prueba
#   VUS               Virtual users (sobreescribe el default del script)
#   DURATION          Duración (ej. 30s, 1m, 2m)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
K6_DIR="${REPO_ROOT}/infra/k6"
SCENARIO="${1:-smoke}"

# Mapear nombre de scenario a archivo
case "$SCENARIO" in
  smoke)   SCRIPT="scenarios/01-smoke.js" ;;
  auth)    SCRIPT="scenarios/02-auth-baseline.js" ;;
  triage)  SCRIPT="scenarios/03-triage-queue.js" ;;
  bed-map) SCRIPT="scenarios/04-bed-map-read.js" ;;
  bcma)    SCRIPT="scenarios/05-bcma-validate.js" ;;
  portal)  SCRIPT="scenarios/06-portal-paciente.js" ;;
  *)
    echo "Scenario '${SCENARIO}' no reconocido. Disponibles:"
    echo "  smoke | auth | triage | bed-map | bcma | portal"
    exit 1
    ;;
esac

if ! command -v docker &>/dev/null; then
  echo "Error: Docker no encontrado. Instala Docker Desktop antes de correr k6 local."
  exit 1
fi

echo "Corriendo k6: ${SCRIPT}"
echo "  BASE_URL:  ${BASE_URL:-http://localhost:3000}"
echo "  VUS:       ${VUS:-default del script}"
echo "  DURATION:  ${DURATION:-default del script}"
echo ""

docker run --rm -i \
  --network host \
  -e "BASE_URL=${BASE_URL:-http://localhost:3000}" \
  -e "SUPABASE_URL=${SUPABASE_URL:-http://localhost:54321}" \
  -e "SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY:-}" \
  -e "K6_USER_EMAIL=${K6_USER_EMAIL:-}" \
  -e "K6_USER_PASSWORD=${K6_USER_PASSWORD:-}" \
  -e "VUS=${VUS:-}" \
  -e "DURATION=${DURATION:-}" \
  -v "${K6_DIR}:/scripts:ro" \
  grafana/k6:latest \
  run "/scripts/${SCRIPT}"
