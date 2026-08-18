#!/usr/bin/env node
// Genera un JWT HS256 con la forma exacta que GoTrue espera en el header
// `apikey`/`Authorization` de sus endpoints (claims `role` + `iss` + `iat` +
// `exp`), firmado con el mismo GOTRUE_JWT_SECRET que consume el servicio
// `gotrue` de docker-compose.test.yml.
//
// Por qué un script y no un par de JWT hardcodeados: si GOTRUE_JWT_SECRET
// cambia (rotación, o alguien lo edita en docker-compose.test.yml), unos
// ANON_KEY/SERVICE_ROLE_KEY hardcodeados en un workflow quedarían firmados
// con un secreto viejo y GoTrue los rechazaría con 401 — un fallo silencioso
// y difícil de diagnosticar. Generándolos en el momento a partir de la MISMA
// env var quedan siempre sincronizados.
//
// Sin dependencias nuevas (nada de `jsonwebtoken`): HS256 son tres líneas de
// HMAC-SHA256 con node:crypto, ya disponible en cualquier runtime Node.
//
// Uso (ver .github/workflows/e2e-smoke.yml y e2e.yml):
//   GOTRUE_JWT_SECRET=xxx node scripts/gotrue-test-jwt.mjs anon
//   GOTRUE_JWT_SECRET=xxx node scripts/gotrue-test-jwt.mjs service_role
//
// ⚠️ Uso exclusivo del stack E2E efímero (docker-compose.test.yml). El
// secreto y los JWTs que produce NO son válidos contra el Supabase Auth real
// del proyecto — no reusar fuera de CI/desarrollo local del stack de test.
import { createHmac } from "node:crypto";

const role = process.argv[2];
if (role !== "anon" && role !== "service_role") {
  console.error("Uso: node scripts/gotrue-test-jwt.mjs <anon|service_role>");
  process.exit(1);
}

const secret = process.env.GOTRUE_JWT_SECRET;
if (!secret) {
  console.error("Falta GOTRUE_JWT_SECRET en el entorno.");
  process.exit(1);
}

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const header = { alg: "HS256", typ: "JWT" };
const nowSec = Math.floor(Date.now() / 1000);
const payload = {
  role,
  iss: "supabase-e2e-local",
  iat: nowSec,
  // 10 años: el stack es efímero (tmpfs, se destruye al bajar el compose al
  // final del job) — no hay rotación que gestionar ni riesgo de que expire
  // a mitad de una corrida de CI.
  exp: nowSec + 10 * 365 * 24 * 60 * 60,
};

const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
const signature = createHmac("sha256", secret)
  .update(unsigned)
  .digest("base64")
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=+$/, "");

process.stdout.write(`${unsigned}.${signature}\n`);
