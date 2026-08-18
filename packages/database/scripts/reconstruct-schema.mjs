// Reconstruye el esquema Postgres desde cero aplicando packages/database/sql/*.sql
// en orden determinístico, contra una base de datos VACÍA y NO-productiva.
//
// Construido para cerrar el gap de "no existe ruta reproducible para recrear
// esta BD fuera de Supabase" (ver docs/runbooks/db-reconstruccion-baseline.md).
// Este script NUNCA debe apuntarse a la BD de Supabase de producción — tiene
// el mismo guard de docs/../scripts/apply-local-sql.sh y lo aplica también
// aquí porque este runner además ESCRIBE una tabla de control
// (`public._sql_baseline_applied`), algo que no queremos hacer en prod por
// fuera de un proceso deliberado.
//
// Uso:
//   DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/his_baseline_test" \
//     node packages/database/scripts/reconstruct-schema.mjs [opciones]
//
// Opciones:
//   --dry-run        No ejecuta nada, solo imprime el orden calculado.
//   --stop-after=N   Se detiene después de aplicar N archivos (para bisección).
//   --only=a.sql,b.sql   Aplica solo esos archivos (nombre exacto), en el
//                        orden que aparecen en el directorio (no en el que se
//                        pasan) — útil para reproducir un fallo puntual.
//   --continue-on-error  No aborta en el primer error; sigue con el resto y
//                        junta un reporte al final. Solo para diagnóstico —
//                        el comportamiento por defecto (parar en el primer
//                        error) es el correcto para una reconstrucción real.
//
// Salida: imprime cada archivo con su resultado (OK / SKIP ya aplicado /
// FAIL) y termina con exit code 0 si todo aplicó (o ya estaba aplicado),
// 1 si algo falló.

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import pg from 'pg';

const SQL_DIR = path.join(import.meta.dirname, '..', 'sql');
const CONTROL_TABLE = 'public._sql_baseline_applied';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const continueOnError = args.includes('--continue-on-error');
const stopAfterArg = args.find((a) => a.startsWith('--stop-after='));
const stopAfter = stopAfterArg ? Number(stopAfterArg.split('=')[1]) : Infinity;
const onlyArg = args.find((a) => a.startsWith('--only='));
const onlySet = onlyArg ? new Set(onlyArg.split('=')[1].split(',')) : null;

const url = process.env.DATABASE_URL || process.env.DIRECT_URL;
if (!url) {
  console.error('DATABASE_URL (o DIRECT_URL) no definido.');
  process.exit(2);
}

// Mismo guard que scripts/apply-local-sql.sh — nunca contra el proyecto real.
if (/ejacvsgbewcerxtjtwto|supabase\.co|complejoavante/i.test(url)) {
  console.error(
    'ABORTANDO: la URL parece apuntar al proyecto Supabase remoto/prod. ' +
      'Este script es SOLO para reconstrucción local/efímera.'
  );
  process.exit(1);
}

// --- Orden determinístico -------------------------------------------------
// Delegamos a `sort -V` (GNU coreutils, disponible en Git Bash/WSL/Linux/mac)
// en vez de reimplementar version-sort en JS: scripts/apply-local-sql.sh ya
// usa `ls *.sql | sort -V` como el orden "canónico" del proyecto, y un primer
// intento de reimplementarlo con `String.localeCompare(numeric:true)` dio un
// resultado DISTINTO para pares como 25_inpatient_hardening.sql vs
// 25_inpatient_hardening_v2.sql (localeCompare puso _v2 primero; sort -V, y
// el resto del repo, pone el archivo base primero). Con dos algoritmos de
// "orden natural" compitiendo, el corpus tendría dos órdenes canónicos
// distintos según qué herramienta lo aplique — eso es peor que el problema
// que este script intenta resolver. Requiere `sort` en PATH con soporte -V.
function sortVersion(names) {
  const out = execFileSync('sort', ['-V'], { input: names.join('\n'), encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}

async function listSqlFilesInOrder() {
  const entries = await readdir(SQL_DIR, { withFileTypes: true });
  const names = entries.filter((e) => e.isFile() && e.name.endsWith('.sql')).map((e) => e.name);
  const files = sortVersion(names);
  return onlySet ? files.filter((f) => onlySet.has(f)) : files;
}

async function ensureControlTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${CONTROL_TABLE} (
      filename    text PRIMARY KEY,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now(),
      duration_ms integer
    );
  `);
}

async function alreadyApplied(client, filename, checksum) {
  const { rows } = await client.query(
    `SELECT checksum FROM ${CONTROL_TABLE} WHERE filename = $1`,
    [filename]
  );
  if (rows.length === 0) return { applied: false, mismatch: false };
  return { applied: true, mismatch: rows[0].checksum !== checksum };
}

async function main() {
  const files = await listSqlFilesInOrder();
  console.log(`${files.length} archivo(s) SQL en orden calculado.`);

  if (dryRun) {
    files.forEach((f, i) => console.log(`  [${i + 1}] ${f}`));
    return;
  }

  const cleanUrl = url.replace(/[?&]sslmode=[^&]*/g, '');
  const client = new pg.Client({ connectionString: cleanUrl });
  await client.connect();
  console.log('conectado a', cleanUrl.split('@')[1]?.split('?')[0] ?? '(local)');

  await ensureControlTable(client);

  const results = [];
  let applied = 0;
  for (const filename of files) {
    if (applied >= stopAfter) break;
    const full = path.join(SQL_DIR, filename);
    const sql = await readFile(full, 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');

    const { applied: already, mismatch } = await alreadyApplied(client, filename, checksum);
    if (already && !mismatch) {
      console.log(`  SKIP  ${filename} (ya aplicado, checksum igual)`);
      results.push({ filename, status: 'skip' });
      continue;
    }
    if (already && mismatch) {
      console.log(
        `  WARN  ${filename} ya está marcado como aplicado pero el contenido cambió ` +
          `(checksum distinto) — se reaplica igual, revisar manualmente.`
      );
    }

    const start = Date.now();
    process.stdout.write(`  [${++applied}/${files.length}] ${filename} ... `);
    try {
      // No se envuelve en un BEGIN/COMMIT externo: 6 archivos del corpus ya
      // traen su propio BEGIN/COMMIT (transacciones anidadas no son válidas
      // en Postgres). Cada archivo corre como una sola query multi-statement
      // — Postgres la trata como transacción implícita si no hay BEGIN
      // explícito adentro.
      await client.query(sql);
      const duration_ms = Date.now() - start;
      await client.query(
        `INSERT INTO ${CONTROL_TABLE} (filename, checksum, duration_ms)
         VALUES ($1, $2, $3)
         ON CONFLICT (filename) DO UPDATE SET checksum = $2, applied_at = now(), duration_ms = $3`,
        [filename, checksum, duration_ms]
      );
      console.log(`OK (${duration_ms}ms)`);
      results.push({ filename, status: 'ok', duration_ms });
    } catch (e) {
      console.log('FALLÓ');
      console.log(`    code=${e.code ?? '?'} ${e.message.split('\n')[0]}`);
      if (e.position) console.log(`    position=${e.position} hint=${e.hint ?? ''}`);
      results.push({ filename, status: 'fail', error: e.message, code: e.code });
      if (!continueOnError) {
        await client.end();
        console.log(`\nDetenido en: ${filename}`);
        printSummary(results);
        process.exit(1);
      }
      // --continue-on-error: si el archivo fallido dejó la sesión en estado
      // "transacción abortada" (pasa cuando el archivo trae su propio BEGIN
      // sin ROLLBACK en su manejo de error), hay que limpiar antes de seguir
      // o el siguiente archivo falla con 25P02 sin relación con su propio SQL.
      try {
        await client.query('ROLLBACK');
      } catch {
        // no había transacción abierta — nada que hacer.
      }
    }
  }

  await client.end();
  printSummary(results);
  process.exit(results.some((r) => r.status === 'fail') ? 1 : 0);
}

function printSummary(results) {
  const ok = results.filter((r) => r.status === 'ok').length;
  const skip = results.filter((r) => r.status === 'skip').length;
  const fail = results.filter((r) => r.status === 'fail').length;
  console.log(`\nResumen: ${ok} aplicados, ${skip} ya aplicados (skip), ${fail} fallidos, ${results.length} evaluados.`);
  if (fail > 0) {
    console.log('Fallidos:');
    for (const r of results.filter((r) => r.status === 'fail')) {
      console.log(`  - ${r.filename}: ${r.code ?? ''} ${r.error.split('\n')[0]}`);
    }
  }
}

main().catch((e) => {
  console.error('Error inesperado:', e);
  process.exit(2);
});
