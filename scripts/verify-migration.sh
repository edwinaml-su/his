#!/usr/bin/env bash
# scripts/verify-migration.sh
#
# Arnés de verificación por etapa para la migración Next 14 → 15 → 16
# (React 18 → 19). Corre, EN ORDEN, los mismos gates que CI y reporta
# PASS/FAIL por bloque. Falla rápido: el primer bloque rojo aborta el resto
# y muestra las últimas líneas del log de ese bloque — no hace falta ir a
# buscar en la salida completa.
#
# Bloques: typecheck → lint → test → build → route-diff.
# route-diff compara la tabla de tipos de ruta (○ Static / ● SSG / ƒ Dynamic)
# del build actual contra docs/migracion/next15-route-table.baseline.txt.
# Ese archivo es la fuente de verdad de qué ruta es de qué tipo HOY — ver
# docs/migracion/next15-baseline.md para el contexto completo (por qué
# importa: incidente #440, docs/runbooks/csp.md).
#
# Uso:
#   scripts/verify-migration.sh                  # verifica contra el baseline
#   scripts/verify-migration.sh --update-baseline # acepta el resultado actual
#                                                   # como nuevo baseline (solo
#                                                   # tras revisar el diff a mano)
#
# No requiere base de datos (todos los bloques son typecheck/lint/vitest
# unitario/build — ninguno pega a Postgres). Idempotente: correr dos veces
# sin cambios de código da el mismo resultado.
#
# Pensado para Git Bash sobre Windows (equipo HIS). Requiere: bash, npm,
# grep/sed/awk GNU (los que trae Git Bash), mktemp.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

BASELINE_FILE="docs/migracion/next15-route-table.baseline.txt"
LOG_DIR="$(mktemp -d)"
trap 'rm -rf "$LOG_DIR"' EXIT

UPDATE_BASELINE=0
for arg in "$@"; do
  case "$arg" in
    --update-baseline) UPDATE_BASELINE=1 ;;
    *)
      echo "Argumento desconocido: $arg (uso: verify-migration.sh [--update-baseline])" >&2
      exit 2
      ;;
  esac
done

PASS_COUNT=0
FAIL_BLOCK=""

strip_ansi() {
  sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g'
}

# Ejecuta un bloque, mide duración, imprime PASS/FAIL. En FAIL muestra las
# últimas 40 líneas del log del bloque (suficiente para identificar el
# archivo/línea sin desplazarse por miles de líneas de turbo).
run_block() {
  local name="$1"
  shift
  local logfile="$LOG_DIR/$name.log"
  local start end dur
  printf '\n== %s ==\n' "$name"
  start=$(date +%s)
  if "$@" >"$logfile" 2>&1; then
    end=$(date +%s)
    dur=$((end - start))
    printf 'PASS  %-12s (%ss)\n' "$name" "$dur"
    PASS_COUNT=$((PASS_COUNT + 1))
    return 0
  else
    end=$(date +%s)
    dur=$((end - start))
    printf 'FAIL  %-12s (%ss)\n' "$name" "$dur"
    printf -- '--- últimas 40 líneas de %s ---\n' "$logfile"
    tail -n 40 "$logfile"
    FAIL_BLOCK="$name"
    return 1
  fi
}

echo "Verificación de migración Next — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Repo: $ROOT"
echo "Node: $(node --version 2>/dev/null || echo '?')  npm: $(npm --version 2>/dev/null || echo '?')"

run_block typecheck npm run typecheck ||
  { echo; echo "ABORT: bloque 'typecheck' falló. No se ejecutan los bloques siguientes."; exit 1; }

run_block lint npm run lint ||
  { echo; echo "ABORT: bloque 'lint' falló."; exit 1; }

run_block test npm run test ||
  { echo; echo "ABORT: bloque 'test' falló."; exit 1; }
# Con test en verde, muestra el desglose por workspace (Test Files/Tests) para
# que quede visible el conteo exacto, igual que en el baseline documentado.
echo "--- resumen por workspace ---"
strip_ansi <"$LOG_DIR/test.log" | grep -E '^@his/[a-z-]+:test: .*(Test Files|      Tests )' || true

run_block build npm run build ||
  { echo; echo "ABORT: bloque 'build' falló."; exit 1; }

# --- route-diff: compara tipo de ruta (○/●/ƒ) contra el baseline ---
echo
echo "== route-diff =="

BUILD_LOG="$LOG_DIR/build.log"
ROUTE_BLOCK="$LOG_DIR/route-block.txt"
CURRENT_TABLE="$LOG_DIR/routes-current.txt"

# Aísla el bloque de la tabla de rutas (entre "Route (app)" y "First Load JS
# shared by all") para no arrastrar basura de otras partes del log de build.
strip_ansi <"$BUILD_LOG" |
  awk '/Route \(app\)/{flag=1; next} /First Load JS shared by all/{flag=0} flag' \
    >"$ROUTE_BLOCK"

# Cada línea de ruta real termina en el símbolo ○/●/ƒ seguido del path
# ("/algo"). Las líneas de sub-paths de generateStaticParams (p.ej.
# "├   ├ /analytics/K-CLI-01") no llevan símbolo y quedan fuera solas.
# Usamos alternancia (no bracket-expression) para evitar problemas de
# locale/UTF-8 con clases de caracteres multibyte en sed.
grep -E '(○|●|ƒ) +/' "$ROUTE_BLOCK" |
  sed -E 's#.*(○|●|ƒ) +(/[^ ]*).*#\1 \2#' |
  sort >"$CURRENT_TABLE"

if [ ! -s "$CURRENT_TABLE" ]; then
  echo "FAIL  route-diff   (no se pudo extraer la tabla de rutas del log de build — ¿cambió el formato de output de 'next build'?)"
  exit 1
fi

if [ "$UPDATE_BASELINE" -eq 1 ]; then
  mkdir -p "$(dirname "$BASELINE_FILE")"
  cp "$CURRENT_TABLE" "$BASELINE_FILE"
  echo "BASELINE actualizado: $BASELINE_FILE ($(wc -l <"$BASELINE_FILE" | tr -d ' ') rutas). Revisa que el commit de este archivo quede junto al cambio que lo justifica."
  echo
  echo "RESULTADO: PASS — baseline de rutas actualizado ($PASS_COUNT/4 bloques previos verdes)."
  exit 0
fi

if [ ! -f "$BASELINE_FILE" ]; then
  echo "FAIL  route-diff   (no existe $BASELINE_FILE — corre primero: scripts/verify-migration.sh --update-baseline)"
  exit 1
fi

if diff -u "$BASELINE_FILE" "$CURRENT_TABLE" >"$LOG_DIR/route-diff.txt"; then
  echo "PASS  route-diff   (sin cambios de tipo de ruta vs baseline; $(wc -l <"$CURRENT_TABLE" | tr -d ' ') rutas)"
else
  echo "FAIL  route-diff   (cambios de tipo de ruta detectados vs baseline — línea con '-' es el tipo anterior, '+' el nuevo)"
  cat "$LOG_DIR/route-diff.txt"
  echo
  echo "Si CADA cambio de arriba es intencional (decidido, no accidental), revísalo línea por línea y luego corre:"
  echo "  scripts/verify-migration.sh --update-baseline"
  echo "para aceptarlo como nuevo baseline. Una ruta que pasó de ○ a ƒ (o viceversa) sin que nadie lo haya decidido"
  echo "es exactamente la clase de regresión silenciosa que este script existe para atrapar — no la aceptes sin entenderla."
  FAIL_BLOCK="route-diff"
fi

echo
if [ -n "$FAIL_BLOCK" ]; then
  echo "RESULTADO: FAIL en '$FAIL_BLOCK'."
  exit 1
else
  echo "RESULTADO: PASS — typecheck, lint, test, build y route-diff verdes."
  exit 0
fi
