#!/usr/bin/env node
// Recordatorio post-edición sobre archivos calientes de conflicto.
//
// PostToolUse sobre Edit/Write/MultiEdit: si el archivo tocado es
// packages/contracts/src/events/payloads.ts (discriminated union — punto
// caliente de merges auto-resueltos rotos, ver CLAUDE.md §Gotchas), emite el
// recordatorio por stderr con exit 2 para que llegue al agente. No bloquea
// (la edición ya ocurrió) — solo asegura que la regla de merges secuenciales
// esté presente en el contexto.
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

let filePath = "";
try {
  filePath = JSON.parse(payload)?.tool_input?.file_path ?? "";
} catch {
  process.exit(0);
}

if (/payloads\.ts$/.test(filePath) && /contracts[\\/]/.test(filePath)) {
  console.error(
    "warn-payloads: tocaste packages/contracts/src/events/payloads.ts (punto caliente de conflictos). " +
      "Reglas: (1) mergear el PR que lo toque SECUENCIALMENTE respecto a cualquier otro PR abierto que también lo toque; " +
      "(2) tras cualquier merge que lo involucre, correr `npm -w @his/contracts run typecheck` — los auto-merges han dejado z.object sin cerrar (TS1005).",
  );
  process.exit(2);
}

process.exit(0);
