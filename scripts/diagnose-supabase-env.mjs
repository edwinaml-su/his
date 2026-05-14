#!/usr/bin/env node
/**
 * scripts/diagnose-supabase-env.mjs
 *
 * Diagnóstico de NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY.
 * Replica lo que hace el middleware de Next.js en runtime para detectar
 * causas de MIDDLEWARE_INVOCATION_FAILED antes de subir a Vercel.
 *
 * Uso:
 *   node scripts/diagnose-supabase-env.mjs                # lee .env.local
 *   node scripts/diagnose-supabase-env.mjs path/to/.env   # lee archivo custom
 *   NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... node scripts/diagnose-supabase-env.mjs
 *
 * Salida: PASS / WARN / FAIL por check + summary final + exit code != 0 si falla.
 *
 * Cero dependencias externas — solo Node.js 18+ (fetch nativo, atob).
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// -----------------------------------------------------------------------------
// Output helpers
// -----------------------------------------------------------------------------
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

const results = [];

function pass(check, detail = "") {
  results.push({ status: "PASS", check, detail });
  console.log(`  ${c.green}✔${c.reset}  ${check}${detail ? c.dim + "  · " + detail + c.reset : ""}`);
}

function warn(check, detail = "") {
  results.push({ status: "WARN", check, detail });
  console.log(`  ${c.yellow}⚠${c.reset}  ${check}${detail ? c.dim + "  · " + detail + c.reset : ""}`);
}

function fail(check, detail = "") {
  results.push({ status: "FAIL", check, detail });
  console.log(`  ${c.red}✘${c.reset}  ${check}${detail ? c.dim + "  · " + detail + c.reset : ""}`);
}

function section(title) {
  console.log("\n" + c.bold + c.cyan + title + c.reset);
}

// -----------------------------------------------------------------------------
// Env loading
// -----------------------------------------------------------------------------
function parseDotEnv(content) {
  const out = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // strip wrapping quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function loadEnv() {
  const arg = process.argv[2];
  let envPath = arg ? resolve(arg) : null;

  if (!envPath) {
    // Try .env.local en raíz, luego apps/web/.env.local
    for (const candidate of [".env.local", "apps/web/.env.local", ".env"]) {
      if (existsSync(candidate)) { envPath = resolve(candidate); break; }
    }
  }

  const fileEnv = envPath && existsSync(envPath)
    ? parseDotEnv(readFileSync(envPath, "utf8"))
    : {};

  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    fileEnv.NEXT_PUBLIC_SUPABASE_URL;
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    fileEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  return { url, anon, envPath };
}

// -----------------------------------------------------------------------------
// JWT decoding (no verification — solo extrae claims)
// -----------------------------------------------------------------------------
function base64UrlDecode(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64").toString("utf8");
}

function decodeJwt(token) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("not a JWT (need 3 segments)");
  return {
    header: JSON.parse(base64UrlDecode(parts[0])),
    payload: JSON.parse(base64UrlDecode(parts[1])),
  };
}

// -----------------------------------------------------------------------------
// Checks
// -----------------------------------------------------------------------------
async function main() {
  console.log(c.bold + "\nHIS — Diagnóstico de Supabase env vars" + c.reset);
  console.log(c.dim + "Replica el contrato del middleware Next.js (apps/web/src/lib/supabase/middleware.ts)" + c.reset);

  const { url, anon, envPath } = loadEnv();

  section("1. Origen de las env vars");
  if (envPath) console.log(`  ${c.dim}Archivo:${c.reset} ${envPath}`);
  else console.log(`  ${c.dim}Archivo:${c.reset} ${c.yellow}ninguno encontrado — usando process.env${c.reset}`);
  console.log(`  ${c.dim}URL:${c.reset}      ${url ? url : c.red + "<faltante>" + c.reset}`);
  console.log(`  ${c.dim}Anon key:${c.reset} ${anon ? c.dim + anon.slice(0, 12) + "…" + anon.slice(-8) + c.reset : c.red + "<faltante>" + c.reset}`);

  // ---- 2. Presencia ----
  section("2. Presencia y forma básica");
  if (!url) {
    fail("NEXT_PUBLIC_SUPABASE_URL está definida", "missing — el middleware crashea al pasar undefined a createServerClient");
  } else {
    pass("NEXT_PUBLIC_SUPABASE_URL está definida");
  }

  if (!anon) {
    fail("NEXT_PUBLIC_SUPABASE_ANON_KEY está definida", "missing — el middleware crashea");
  } else {
    pass("NEXT_PUBLIC_SUPABASE_ANON_KEY está definida");
  }

  if (!url || !anon) {
    summary();
    process.exit(1);
  }

  // ---- 3. URL format ----
  section("3. Formato del URL");
  let urlObj = null;
  try {
    urlObj = new URL(url);
    pass("URL es un URL válido");
  } catch {
    fail("URL es un URL válido", `no parsea: "${url}"`);
  }

  if (urlObj) {
    if (urlObj.protocol !== "https:") fail("URL usa https://", `protocol="${urlObj.protocol}"`);
    else pass("URL usa https://");

    if (!urlObj.host.endsWith(".supabase.co")) {
      warn("URL termina en .supabase.co", `host="${urlObj.host}" — válido si es self-hosted; sospechoso si esperás Supabase cloud`);
    } else {
      pass("URL termina en .supabase.co");
    }

    const projectRef = urlObj.host.split(".")[0];
    if (projectRef.length !== 20) {
      warn("Project ref tiene 20 chars (Supabase estándar)", `ref="${projectRef}" len=${projectRef.length}`);
    } else {
      pass(`Project ref detectado`, `${projectRef}`);
    }
  }

  // ---- 4. JWT shape ----
  section("4. Anon key — estructura JWT");
  let jwt = null;
  try {
    jwt = decodeJwt(anon);
    pass("Anon key decodificable como JWT (3 segmentos)");
  } catch (e) {
    fail("Anon key decodificable como JWT", e.message);
  }

  if (jwt) {
    const { header, payload } = jwt;
    if (header.alg) pass(`Algoritmo JWT`, `${header.alg}`);
    else warn("Algoritmo JWT no declarado");

    if (payload.role === "anon") {
      pass("Claim role=anon");
    } else if (payload.role) {
      fail("Claim role=anon", `role="${payload.role}" — ESTÁ ROTA: pegaste service_role u otro. Usa el "anon public" key, NO el service_role.`);
    } else {
      warn("Claim role ausente");
    }

    if (payload.ref) {
      const urlRef = urlObj ? urlObj.host.split(".")[0] : null;
      if (urlRef && payload.ref !== urlRef) {
        fail("Claim ref matchea con project ref del URL",
          `JWT ref="${payload.ref}" pero URL ref="${urlRef}" — JWT pertenece a OTRO proyecto`);
      } else {
        pass(`Claim ref matchea con URL`, `ref="${payload.ref}"`);
      }
    } else {
      warn("Claim ref ausente (no estándar)");
    }

    if (payload.iss) pass(`Claim iss`, payload.iss);

    if (typeof payload.exp === "number") {
      const now = Math.floor(Date.now() / 1000);
      const expDate = new Date(payload.exp * 1000).toISOString();
      const daysLeft = Math.floor((payload.exp - now) / 86400);
      if (payload.exp < now) {
        fail("JWT NO expirado", `exp=${expDate} — EXPIRÓ HACE ${-daysLeft} días. ROTAR YA.`);
      } else if (daysLeft < 30) {
        warn("JWT con > 30 días de validez", `expira en ${daysLeft} días (${expDate})`);
      } else {
        pass("JWT no expirado", `expira en ${daysLeft} días (${expDate})`);
      }
    }

    if (typeof payload.iat === "number") {
      const iatDate = new Date(payload.iat * 1000).toISOString();
      console.log(`  ${c.dim}iat (emitido):${c.reset} ${iatDate}`);
    }
  }

  // ---- 5. Round-trip al servidor ----
  section("5. Round-trip a Supabase Auth API");
  if (!urlObj) {
    warn("Skipped — URL inválido", "no se puede llamar el endpoint");
  } else {
    const healthUrl = `${urlObj.origin}/auth/v1/health`;
    try {
      const res = await fetch(healthUrl, {
        method: "GET",
        headers: {
          apikey: anon,
          Authorization: `Bearer ${anon}`,
        },
      });
      const text = await res.text().catch(() => "");

      if (res.status === 200) {
        pass(`GET /auth/v1/health 200 OK`, text ? text.slice(0, 80) : "");
      } else if (res.status === 401 || res.status === 403) {
        fail(`GET /auth/v1/health rechazado`, `HTTP ${res.status} — anon key inválida o rotada. Esto es exactamente lo que rompe el middleware.`);
      } else if (res.status === 404) {
        warn(`/auth/v1/health no existe`, `HTTP 404 — proyecto puede haber sido pausado/borrado. Probando otro endpoint…`);
        // Fallback: settings endpoint
        const settingsUrl = `${urlObj.origin}/auth/v1/settings`;
        const r2 = await fetch(settingsUrl, { headers: { apikey: anon } });
        if (r2.status === 200) pass(`GET /auth/v1/settings 200 OK (fallback)`);
        else fail(`GET /auth/v1/settings`, `HTTP ${r2.status}`);
      } else {
        warn(`GET /auth/v1/health HTTP ${res.status}`, text.slice(0, 120));
      }
    } catch (e) {
      fail("Fetch al Auth API", e.message);
    }
  }

  // ---- 6. Simulación createServerClient ----
  section("6. ¿Estas vars sobrevivirían al middleware?");
  // El middleware llama: createServerClient(url, anon, { cookies: ... })
  // Si url o anon son falsy, @supabase/ssr lanza 'supabaseUrl is required'.
  // Si son truthy pero JWT inválido, getUser() falla con AuthError. Vercel
  // reporta esto como MIDDLEWARE_INVOCATION_FAILED si la excepción escapa.
  if (url && anon) {
    pass("URL y anon ambos truthy → createServerClient NO crashea por undefined");
  } else {
    fail("Ambos truthy", "createServerClient lanza 'supabaseUrl is required' o equivalente");
  }

  // ---- 7. Resumen ----
  summary();

  const failed = results.filter((r) => r.status === "FAIL").length;
  process.exit(failed > 0 ? 1 : 0);
}

function summary() {
  section("Resumen");
  const passes = results.filter((r) => r.status === "PASS").length;
  const warns = results.filter((r) => r.status === "WARN").length;
  const fails = results.filter((r) => r.status === "FAIL").length;
  console.log(`  ${c.green}${passes} PASS${c.reset}   ${c.yellow}${warns} WARN${c.reset}   ${c.red}${fails} FAIL${c.reset}`);

  if (fails === 0 && warns === 0) {
    console.log(`\n  ${c.green}${c.bold}✔ Tus env vars locales son válidas.${c.reset}`);
    console.log(`  ${c.dim}Si Vercel sigue 500, copiá EXACTAMENTE estos valores al dashboard Vercel.${c.reset}`);
  } else if (fails === 0) {
    console.log(`\n  ${c.yellow}${c.bold}⚠ Vars válidas pero con warnings.${c.reset} Revisar antes de redeploy.`);
  } else {
    console.log(`\n  ${c.red}${c.bold}✘ Vars rotas.${c.reset} Corregí los FAIL antes de redeploy.`);
    console.log(`  ${c.dim}Próximo paso: ir a Supabase Dashboard → Settings → API y copiar el "anon public" actual.${c.reset}`);
  }
}

main().catch((e) => {
  console.error(c.red + "\nError no manejado: " + c.reset + (e?.stack || e));
  process.exit(2);
});
