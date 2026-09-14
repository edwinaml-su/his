#!/usr/bin/env node
// Guarda anti re-aplicación de SQLs ya aplicados a prod.
//
// PreToolUse sobre mcp__*__apply_migration: si el `name` de la migración
// empieza con un número que corresponde a un archivo
// packages/database/sql/<num>_*.sql marcado "NO re-aplicar", bloquea (exit 2).
//
// Los archivos aplicados llevan el texto literal "NO re-aplicar" en su
// cabecera (convención del repo desde SQL 169).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

let payload = "";
try {
  payload = await new Promise((res) => {
    let d = "";
    process.stdin.on("data", (c) => (d += c));
    process.stdin.on("end", () => res(d));
  });
} catch {
  process.exit(0);
}

let name = "";
let cwd = process.cwd();
try {
  const j = JSON.parse(payload);
  name = j?.tool_input?.name ?? "";
  cwd = j?.cwd ?? cwd;
} catch {
  process.exit(0);
}

const num = name.match(/^(\d{2,4})/)?.[1];
if (!num) process.exit(0); // sin número — no hay archivo que comparar

const sqlDir = join(cwd, "packages", "database", "sql");
let files = [];
try {
  files = readdirSync(sqlDir).filter((f) => f.startsWith(`${num}_`) || f.startsWith(`${num}a_`) || f.startsWith(`${num}b_`));
} catch {
  process.exit(0);
}

for (const f of files) {
  try {
    const head = readFileSync(join(sqlDir, f), "utf8").slice(0, 2000);
    if (/NO re-?aplicar/i.test(head)) {
      console.error(
        `guard-sql-reapply: ${f} está marcado "APLICADO a prod — NO re-aplicar". ` +
          `Si esta migración es NUEVA, usá el siguiente número libre de packages/database/sql/. ` +
          `Si de verdad hay que re-ejecutar algo, hacelo como una migración nueva con otro número.`,
      );
      process.exit(2);
    }
  } catch {
    /* archivo ilegible — no bloquear */
  }
}

process.exit(0);
