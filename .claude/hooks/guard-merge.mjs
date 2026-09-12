#!/usr/bin/env node
// Guarda anti stale-head-merge (6 incidentes: #606, #613, #617, #619, #631, #635).
//
// PreToolUse sobre Bash: si el comando es `gh pr merge <N>`, bloquea (exit 2)
// cuando:
//   a) algún required check del PR no está en verde, o
//   b) existe una rama local con el nombre del head del PR cuyo sha difiere
//      del head remoto (hay commits sin pushear o el PR está desactualizado).
//
// Entrada: JSON de Claude Code por stdin ({ tool_input: { command } }).
// exit 0 = permitir · exit 2 = bloquear (stderr va al agente como razón).
import { execSync } from "node:child_process";

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

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

let command = "";
try {
  command = JSON.parse(payload)?.tool_input?.command ?? "";
} catch {
  process.exit(0);
}

const m = command.match(/gh\s+pr\s+merge\s+(\d+)/);
if (!m) process.exit(0); // no es un merge — no opinar
const pr = m[1];

try {
  const info = JSON.parse(
    sh(`gh pr view ${pr} --json state,headRefOid,headRefName`),
  );
  if (info.state !== "OPEN") {
    console.error(`guard-merge: el PR #${pr} no está OPEN (${info.state}).`);
    process.exit(2);
  }

  // a) required checks en verde
  let checks = [];
  try {
    checks = JSON.parse(sh(`gh pr checks ${pr} --required --json name,bucket`));
  } catch {
    // gh pr checks sale con código != 0 cuando hay fails/pending — reintenta capturando stdout
    try {
      checks = JSON.parse(
        execSync(`gh pr checks ${pr} --required --json name,bucket`, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim() || "[]",
      );
    } catch {
      checks = [];
    }
  }
  const noVerdes = checks.filter((c) => c.bucket !== "pass");
  if (checks.length === 0 || noVerdes.length > 0) {
    console.error(
      `guard-merge: required checks del PR #${pr} no están todos en verde ` +
        `(${checks.length === 0 ? "sin checks reportados aún" : noVerdes.map((c) => `${c.name}=${c.bucket}`).join(", ")}). ` +
        `Esperá el CI antes de mergear.`,
    );
    process.exit(2);
  }

  // b) head remoto == rama local (si existe)
  let localSha = "";
  try {
    localSha = sh(`git rev-parse --verify --quiet "${info.headRefName}"`);
  } catch {
    /* la rama no existe localmente — nada que comparar */
  }
  if (localSha && localSha !== info.headRefOid) {
    console.error(
      `guard-merge: head del PR #${pr} (${info.headRefOid.slice(0, 7)}) ≠ rama local ` +
        `${info.headRefName} (${localSha.slice(0, 7)}). Hay commits sin pushear o el PR ` +
        `quedó atrás — sincronizá antes de mergear (así se perdieron commits 6 veces).`,
    );
    process.exit(2);
  }
} catch (e) {
  // Falla de red/gh: no bloquear el flujo por una guarda rota, pero avisar.
  console.error(`guard-merge: verificación no concluyente (${String(e).slice(0, 120)}) — merge permitido bajo tu criterio.`);
  process.exit(0);
}

process.exit(0);
