"use server";

/**
 * US-2.2 — MFA TOTP Server Actions.
 *
 * Implementa el lado servidor del MFA TOTP obligatorio para roles ADMIN /
 * PHYSICIAN:
 *
 *   - `enrollMfa()`           — genera secret + QR URI + 10 backup codes,
 *                               crea/reemplaza el `UserCredential` TOTP
 *                               cifrado con AES-256-GCM. NO marca aún
 *                               `mfaEnabled = true`: eso lo hace `verifyMfa`
 *                               cuando el usuario confirma el primer código.
 *   - `verifyMfa({token})`    — valida TOTP (ventana ±1, 90s tolerance) o
 *                               consume backup code. Si era la verificación
 *                               de "primer enrolamiento", flippea
 *                               `User.mfaEnabled = true`.
 *   - `disableMfa()`          — borra el credential TOTP y limpia el flag.
 *                               Pensado para flujos admin / Sprint 2.
 *   - `getMfaStatus()`        — devuelve `{enabled, method, lastVerifiedAt}`.
 *
 * Stack:
 *   - TOTP RFC 6238 implementado inline (sin dependencias). HMAC-SHA1 vía
 *     `node:crypto`. ~50 líneas — el algoritmo es tan estable como la URL
 *     de YouTube.
 *   - Cifrado AES-256-GCM con key derivada de `process.env.AUTH_SECRET` por
 *     SHA-256. NUNCA almacenamos el secret en claro: `secretHash` guarda un
 *     blob JSON con `{ iv, tag, ciphertext, codes }`.
 *
 * Por qué Server Actions y no tRPC para el flow crítico:
 *   - La página `/mfa` se renderiza ANTES de que el usuario tenga sesión
 *     "completa" (passó password pero le falta TOTP). El router tRPC usa
 *     `protectedProcedure` que asume usuario auth + tenant; aquí queremos
 *     algo más laxo. Las acciones también se exponen vía router para que
 *     consumidores tRPC (mobile futuro) puedan usarlas.
 *
 * Patrón: copiado de `app/actions/login-policy.ts`.
 */

import { createHash, createHmac, randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from "node:crypto";
import { prisma } from "@his/database";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// -----------------------------------------------------------------------------
// Constantes/tipos espejo de `@his/contracts/schemas/mfa`. NO importamos del
// paquete contracts directamente porque su `package.json` solo expone
// `./schemas` (barrel), y `schemas/index.ts` está congelado en Sprint 1 y no
// re-exporta `mfa.ts` (otro equipo modificará el barrel). Misma estrategia
// que `break-glass.ts` server action (ver header de ese archivo).
// Si divergen, prevalece el contracts (single source of truth para clientes UI).
// -----------------------------------------------------------------------------

const TOTP_DIGITS = 6;
const TOTP_STEP_SECONDS = 30;
const TOTP_WINDOW = 1; // ±1 step => 90s tolerance
const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_LENGTH = 8;
const TOTP_SECRET_LENGTH = 32;

type TotpEnrollResult = {
  secret: string;
  otpauthUri: string;
  backupCodes: string[];
};

type TotpStatusResult = {
  enabled: boolean;
  method: "TOTP" | "NONE";
  lastVerifiedAt: string | null;
};

type TotpVerifyResult = {
  ok: boolean;
  usedBackupCode?: boolean;
  remainingBackupCodes?: number;
};

// =============================================================================
// 1) Cifrado AES-256-GCM
// =============================================================================
//
// El secret TOTP y los backup codes se cifran con una key derivada del
// `AUTH_SECRET`. NO almacenamos el secret en claro NUNCA.
//
// Formato del blob almacenado en `UserCredential.secretHash` (string JSON):
//   {
//     "v": 1,                  // versión del esquema, para rotación futura
//     "iv": "<hex 12 bytes>",
//     "tag": "<hex 16 bytes>",
//     "ct": "<hex>",           // ciphertext del JSON {secret, codes}
//     "createdAt": "<iso>"
//   }
//
// Donde el plaintext cifrado es:
//   { "secret": "<base32>", "codes": ["12345678", ...] }
//
// TODO(Sprint 2): rotación de key. Versión `v` permite leer blobs viejos
// y re-cifrar con la nueva key sin perder credenciales.

const ENC_VERSION = 1;
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12;  // GCM standard
const TAG_BYTES = 16;

function getEncryptionKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    // Fail-fast: si AUTH_SECRET no está, no podemos garantizar
    // confidencialidad. Mejor romper el enrolamiento que crear credenciales
    // con cifrado débil.
    throw new Error(
      "AUTH_SECRET no configurado o demasiado corto (≥ 32 chars requeridos).",
    );
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

type StoredCredential = {
  v: number;
  iv: string;
  tag: string;
  ct: string;
  createdAt: string;
};

type Plaintext = {
  secret: string; // base32
  codes: string[]; // backup codes en texto plano
};

function encryptCredential(plaintext: Plaintext): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const json = JSON.stringify(plaintext);
  const ct = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const blob: StoredCredential = {
    v: ENC_VERSION,
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    ct: ct.toString("hex"),
    createdAt: new Date().toISOString(),
  };
  return JSON.stringify(blob);
}

function decryptCredential(stored: string): Plaintext {
  const blob = JSON.parse(stored) as StoredCredential;
  if (blob.v !== ENC_VERSION) {
    throw new Error(`Versión de credential desconocida: v${blob.v}`);
  }
  const key = getEncryptionKey();
  const iv = Buffer.from(blob.iv, "hex");
  const tag = Buffer.from(blob.tag, "hex");
  const ct = Buffer.from(blob.ct, "hex");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("Credential blob corrupto.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(pt.toString("utf8")) as Plaintext;
}

// =============================================================================
// 2) Base32 (RFC 4648, sin padding) — usado por TOTP
// =============================================================================

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i]!;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return out;
}

function base32Decode(input: string): Buffer {
  const cleaned = input.replace(/=+$/g, "").toUpperCase().replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error("Base32 inválido");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// =============================================================================
// 3) TOTP RFC 6238 (HMAC-SHA1)
// =============================================================================
//
// Algoritmo:
//   counter   = floor(unixtime / step)
//   hmac      = HMAC-SHA1(key=secret_bytes, msg=counter_be64)
//   offset    = hmac[19] & 0x0F
//   binCode   = (hmac[offset] & 0x7F) << 24
//             | (hmac[offset+1] & 0xFF) << 16
//             | (hmac[offset+2] & 0xFF) << 8
//             | (hmac[offset+3] & 0xFF)
//   token     = (binCode mod 10^digits) padLeft '0' a `digits`
//
// Verificación: probar `counter` actual y ±window steps para tolerar drift.

function generateTotp(secretBase32: string, counter: number): string {
  const key = base32Decode(secretBase32);
  const buf = Buffer.alloc(8);
  // big-endian uint64; counter fits in 32 bits hasta el año ~6053, OK.
  buf.writeUInt32BE(Math.floor(counter / 0x1_0000_0000), 0);
  buf.writeUInt32BE(counter & 0xffffffff, 4);
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const bin =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  const mod = bin % 10 ** TOTP_DIGITS;
  return mod.toString().padStart(TOTP_DIGITS, "0");
}

function verifyTotp(secretBase32: string, token: string): boolean {
  if (!/^[0-9]{6}$/.test(token)) return false;
  const counter = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS);
  const tokenBuf = Buffer.from(token, "utf8");
  for (let w = -TOTP_WINDOW; w <= TOTP_WINDOW; w++) {
    const candidate = generateTotp(secretBase32, counter + w);
    const candBuf = Buffer.from(candidate, "utf8");
    if (candBuf.length === tokenBuf.length && timingSafeEqual(candBuf, tokenBuf)) {
      return true;
    }
  }
  return false;
}

// =============================================================================
// 4) Backup codes
// =============================================================================

function generateBackupCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    // 8 dígitos: rango [10^(L-1), 10^L). Uso `randomBytes` para entropía cripto.
    const max = 10 ** BACKUP_CODE_LENGTH;
    // Tomamos 4 bytes (32 bits) y hacemos mod — sesgo despreciable para 10^8.
    const n = randomBytes(4).readUInt32BE(0) % max;
    codes.push(n.toString().padStart(BACKUP_CODE_LENGTH, "0"));
  }
  return codes;
}

// =============================================================================
// 5) otpauth URI builder (estándar Google Authenticator)
// =============================================================================

function buildOtpAuthUri(args: {
  secret: string;
  account: string; // típicamente el email
  issuer: string; // "Avante HIS"
}): string {
  const label = encodeURIComponent(`${args.issuer}:${args.account}`);
  const params = new URLSearchParams({
    secret: args.secret,
    issuer: args.issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// =============================================================================
// 6) Helpers de sesión
// =============================================================================

/**
 * Obtiene el userId del usuario autenticado en Supabase y lo cruza con el
 * `User` local. Retorna null si no hay sesión o el user local no existe
 * (ejemplo: justo se creó en Supabase pero aún no se sincronizó).
 */
async function getCurrentUser(): Promise<{
  id: string;
  email: string;
  fullName: string;
  mfaEnabled: boolean;
} | null> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;
  const local = await prisma.user.findUnique({
    where: { email: user.email.toLowerCase() },
    select: { id: true, email: true, fullName: true, mfaEnabled: true },
  });
  return local;
}

// =============================================================================
// 7) Server Actions exportadas
// =============================================================================

const ISSUER = "Avante HIS";

/**
 * `enrollMfa()` — Inicia o reinicia el enrolamiento TOTP del usuario actual.
 *
 * - Genera secret (32 chars base32 = 160 bits, igual que Google Authenticator).
 * - Genera 10 backup codes de 8 dígitos.
 * - Crea/reemplaza el `UserCredential` TOTP cifrado.
 * - NO setea `mfaEnabled = true` aún: ese flag se enciende cuando el usuario
 *   confirma con `verifyMfa` el primer código (DoD: "verificación durante
 *   login"). Esto evita dejar al usuario fuera si nunca completa el flujo.
 *
 * Devuelve secret + otpauth URI + backup codes EN CLARO. El cliente DEBE
 * mostrarlos UNA SOLA VEZ y no persistirlos en localStorage.
 */
export async function enrollMfa(): Promise<
  | { ok: true; data: TotpEnrollResult }
  | { ok: false; error: string }
> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Sesión requerida." };
  }

  // Genera secret de 20 bytes => 32 chars base32 sin padding (160 bits).
  // Si pidieran exactamente TOTP_SECRET_LENGTH chars, 20 bytes = 32 chars OK.
  const secretBytes = randomBytes(Math.ceil((TOTP_SECRET_LENGTH * 5) / 8));
  const secret = base32Encode(secretBytes).slice(0, TOTP_SECRET_LENGTH);
  const codes = generateBackupCodes();

  let stored: string;
  try {
    stored = encryptCredential({ secret, codes });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[mfa.enroll] cifrado falló:", err);
    return { ok: false, error: "No se pudo cifrar la credencial." };
  }

  // Reemplaza credenciales TOTP previas — un usuario solo tiene un secret
  // activo a la vez. Si reenrola, los backup codes anteriores se pierden.
  try {
    await prisma.$transaction([
      prisma.userCredential.deleteMany({
        where: { userId: user.id, method: "TOTP" },
      }),
      prisma.userCredential.create({
        data: {
          userId: user.id,
          method: "TOTP",
          secretHash: stored,
        },
      }),
    ]);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[mfa.enroll] persistencia falló:", err);
    return { ok: false, error: "No se pudo guardar el enrolamiento." };
  }

  const otpauthUri = buildOtpAuthUri({
    secret,
    account: user.email,
    issuer: ISSUER,
  });

  return {
    ok: true,
    data: { secret, otpauthUri, backupCodes: codes },
  };
}

/**
 * `verifyMfa({ token })` — Verifica un código TOTP o un backup code.
 *
 * - Si `token` tiene 6 dígitos: TOTP estándar con ventana ±1 step (90s).
 * - Si `token` tiene 8 dígitos: backup code; se consume (se elimina del set
 *   cifrado) y se reescribe el `UserCredential`.
 * - En ambos casos exitosos: si era el primer verify post-enrol, flippea
 *   `User.mfaEnabled = true`. Actualiza `validFrom` como "lastVerifiedAt"
 *   barato (no agregamos columna nueva — schema NO se toca).
 */
export async function verifyMfa(args: {
  token: string;
}): Promise<TotpVerifyResult & { error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sesión requerida." };

  const token = args.token.trim();
  if (!/^[0-9]{6}$/.test(token) && !/^[0-9]{8}$/.test(token)) {
    return { ok: false, error: "Formato de código inválido." };
  }

  const cred = await prisma.userCredential.findFirst({
    where: { userId: user.id, method: "TOTP" },
    orderBy: { createdAt: "desc" },
    select: { id: true, secretHash: true },
  });
  if (!cred) {
    return { ok: false, error: "MFA no enrolado." };
  }

  let plaintext: Plaintext;
  try {
    plaintext = decryptCredential(cred.secretHash);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[mfa.verify] descifrado falló:", err);
    return { ok: false, error: "No se pudo leer la credencial." };
  }

  // Caso 1: TOTP de 6 dígitos
  if (token.length === 6) {
    const ok = verifyTotp(plaintext.secret, token);
    if (!ok) return { ok: false, error: "Código incorrecto o expirado." };

    // Marca como verificado: enciende mfaEnabled si era el primer verify.
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { mfaEnabled: true },
      }),
      // `validFrom` lo usamos como "lastVerifiedAt" — no podemos añadir
      // columna nueva (schema lock). Es semánticamente parecido: "vigente
      // a partir de la última verificación correcta".
      prisma.userCredential.update({
        where: { id: cred.id },
        data: { validFrom: new Date() },
      }),
    ]);
    return { ok: true, usedBackupCode: false };
  }

  // Caso 2: backup code de 8 dígitos
  // Comparación constant-time contra el set cifrado.
  const tokenBuf = Buffer.from(token, "utf8");
  let matchIndex = -1;
  for (let i = 0; i < plaintext.codes.length; i++) {
    const candBuf = Buffer.from(plaintext.codes[i]!, "utf8");
    if (
      candBuf.length === tokenBuf.length &&
      timingSafeEqual(candBuf, tokenBuf)
    ) {
      matchIndex = i;
      break;
    }
  }
  if (matchIndex < 0) {
    return { ok: false, error: "Código de respaldo inválido o ya usado." };
  }

  // Consumimos el backup code.
  const remaining = plaintext.codes.filter((_, i) => i !== matchIndex);
  const newStored = encryptCredential({ secret: plaintext.secret, codes: remaining });

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { mfaEnabled: true },
    }),
    prisma.userCredential.update({
      where: { id: cred.id },
      data: { secretHash: newStored, validFrom: new Date() },
    }),
  ]);

  return {
    ok: true,
    usedBackupCode: true,
    remainingBackupCodes: remaining.length,
  };
}

/**
 * `disableMfa()` — Borra credencial TOTP y limpia flag.
 *
 * UX: solo lo dispara el usuario desde su dashboard de cuenta tras confirmar
 * con password (Sprint 2 endurece). En MVP confiamos en sesión vigente.
 */
export async function disableMfa(): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sesión requerida." };

  try {
    await prisma.$transaction([
      prisma.userCredential.deleteMany({
        where: { userId: user.id, method: "TOTP" },
      }),
      prisma.user.update({
        where: { id: user.id },
        data: { mfaEnabled: false },
      }),
    ]);
    return { ok: true };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[mfa.disable] error:", err);
    return { ok: false, error: "No se pudo deshabilitar MFA." };
  }
}

/**
 * `getMfaStatus()` — Estado actual de MFA del usuario en sesión.
 * Lo usa el dashboard de cuenta y la página `/mfa` para decidir si redirigir
 * a `/mfa/enroll` cuando el rol exige MFA pero no está enrolado.
 */
export async function getMfaStatus(): Promise<TotpStatusResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { enabled: false, method: "NONE", lastVerifiedAt: null };
  }

  const cred = await prisma.userCredential.findFirst({
    where: { userId: user.id, method: "TOTP" },
    orderBy: { createdAt: "desc" },
    select: { validFrom: true },
  });

  return {
    enabled: user.mfaEnabled,
    method: cred ? "TOTP" : "NONE",
    lastVerifiedAt: cred?.validFrom ? cred.validFrom.toISOString() : null,
  };
}
