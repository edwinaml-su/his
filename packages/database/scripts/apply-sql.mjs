// Aplica archivos SQL DDL de packages/database/sql/ en orden.
// Lee DIRECT_URL del env. Uso: node --env-file=.env scripts/apply-sql.mjs [files...]
// Si no se pasan files, aplica los 5 por defecto.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const SQL_DIR = path.join(import.meta.dirname, '..', 'sql');
const DEFAULT_FILES = [
  '01_rls_policies.sql',
  '02_audit_triggers.sql',
  '03_validations_sv.sql',
  '04_rls_session_helpers.sql',
  '05_audit_hash_chain.sql',
];

const files = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_FILES;
const url = process.env.DIRECT_URL;
if (!url) { console.error('DIRECT_URL no definido'); process.exit(2); }

// Strip sslmode= from URL para que ssl: {} explícito de la línea de abajo gane
const cleanUrl = url.replace(/[?&]sslmode=[^&]*/g, '').replace('?&', '?').replace(/[?&]$/, '');
const client = new pg.Client({ connectionString: cleanUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log('connected to', url.split('@')[1].split('?')[0]);

for (const f of files) {
  const full = path.join(SQL_DIR, f);
  const sql = await readFile(full, 'utf8');
  process.stdout.write(`> ${f.padEnd(35)} (${sql.length}b) ... `);
  try {
    await client.query(sql);
    console.log('OK');
  } catch (e) {
    console.log(`FAIL: ${e.code || ''} ${e.message.split('\n')[0]}`);
    if (e.position) console.log(`  position=${e.position} hint=${e.hint || ''}`);
    process.exit(1);
  }
}
await client.end();
console.log('all applied');
