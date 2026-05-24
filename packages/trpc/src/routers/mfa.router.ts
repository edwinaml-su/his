/**
 * US-2.2 — Router tRPC de MFA TOTP.
 *
 * Procedures:
 *   - enroll  : genera secret base32 + 10 backup codes, cifra y persiste un
 *               `UserCredential` TOTP. Devuelve secret + otpauth URI + codes
 *               EN CLARO una sola vez.
 *   - verify  : valida un código (6 dígitos TOTP o 8 dígitos backup). Marca
 *               `User.mfaEnabled = true` si era el primer verify post-enrol.
 *   - status  : `{ enabled, method, lastVerifiedAt }`.
 *
 * IMPORTANTE: la implementación pesada (TOTP RFC 6238 inline, AES-256-GCM,
 * base32) vive aquí en el router para que sea reutilizable desde clientes
 * tRPC futuros (mobile). Los Server Actions de
 * `apps/web/src/app/actions/mfa.ts` mantienen una copia paralela porque la
 * página `/mfa` corre antes de que el usuario tenga sesión "completa" y no
 * podemos meterla por `protectedProcedure`. Si el algoritmo cambia, hay que
 * actualizar AMBOS lugares.
 *
 * Patrón inspirado en `break-glass.router.ts`:
 *   - Schemas Zod replicados localmente (no usamos el barrel de contracts;
 *     `tsconfig` de @his/trpc fija `rootDir: src`).
 *   - Manejo defensivo, mensajes en es-SV.
 *
 * NO se registra en `_app.ts` desde aquí — lo hace @Orq.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

// =============================================================================
// Constantes (espejo de `@his/contracts/schemas/mfa`).
// Si divergen, prevalece contracts (single source of truth para clientes UI).
// =============================================================================

const TOTP_DIGITS = 6;
const TOTP_STEP_SECONDS = 30;
const TOTP_WINDOW = 1; // ±1 step => 90s tolerance
const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_LENGTH = 8;
const TOTP_SECRET_LENGTH = 32;
const ISSUER = "Avante HIS";

const ENC_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

const RE_TOTP_TOKEN = /^[0-9]{6}$/;
const RE_BACKUP_CODE = /^[0-9]{8}$/;

const totpVerifyInput = z.object({
  token: z
    .string()
    .trim()
    .refine((v) => RE_TOTP_TOKEN.test(v) || RE_BACKUP_CODE.test(v), {
      message: "Código inválido. Debe tener 6 u 8 dígitos.",
    }),
});

const totpEnrollInput = z.object({}).strict();

// =============================================================================
// Cifrado AES-256-GCM con key derivada de AUTH_SECRET (SHA-256).
// Formato: { v, iv, tag, ct, createdAt } JSON-stringified en `secretHash`.
// =============================================================================

type StoredCredential = {
  v: number;
  iv: string;
  tag: string;
  ct: string;
  createdAt: string;
};

type Plaintext = { secret: string; codes: string[] };

function getEncryptionKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "AUTH_SECRET no configurado correctamente.",
    });
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

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
    throw new Error(`Versión desconocida: v${blob.v}`);
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
// Base32 (RFC 4648) — sin padding.
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
// TOTP RFC 6238 — HMAC-SHA1 con counter big-endian uint64.
// =============================================================================

function generateTotp(secretBase32: string, counter: number): string {
  const key = base32Decode(secretBase32);
  const buf = Buffer.alloc(8);
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

/**
 * Verifica un token TOTP y devuelve el step que hizo match (para registro anti-replay),
 * o null si el token es inválido.
 * El step es floor(epoch_s / STEP_SECONDS) — identifica unívocamente el slot de 30 s.
 */
function verifyTotp(secretBase32: string, token: string): { matched: true; step: bigint } | { matched: false } {
  if (!RE_TOTP_TOKEN.test(token)) return { matched: false };
  const counter = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS);
  const tokenBuf = Buffer.from(token, "utf8");
  for (let w = -TOTP_WINDOW; w <= TOTP_WINDOW; w++) {
    const step = counter + w;
    const candidate = generateTotp(secretBase32, step);
    const candBuf = Buffer.from(candidate, "utf8");
    if (candBuf.length === tokenBuf.length && timingSafeEqual(candBuf, tokenBuf)) {
      return { matched: true, step: BigInt(step) };
    }
  }
  return { matched: false };
}

function generateBackupCodes(): string[] {
  const codes: string[] = [];
  const max = 10 ** BACKUP_CODE_LENGTH;
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    const n = randomBytes(4).readUInt32BE(0) % max;
    codes.push(n.toString().padStart(BACKUP_CODE_LENGTH, "0"));
  }
  return codes;
}

function buildOtpAuthUri(args: { secret: string; account: string; issuer: string }): string {
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
// Router
// =============================================================================

export const mfaRouter = router({
  /**
   * Enrola TOTP — genera secret + 10 backup codes y los persiste cifrados.
   * Devuelve secret + otpauthUri + backup codes EN CLARO. UI debe mostrarlos
   * UNA SOLA VEZ. NO marca `mfaEnabled = true` aún (lo hace `verify`).
   */
  enroll: protectedProcedure
    .input(totpEnrollInput)
    .mutation(async ({ ctx }) => {
      const userRow = await ctx.prisma.user.findUnique({
        where: { id: ctx.user.id },
        select: { id: true, email: true },
      });
      if (!userRow) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Usuario no encontrado." });
      }

      const secretBytes = randomBytes(Math.ceil((TOTP_SECRET_LENGTH * 5) / 8));
      const secret = base32Encode(secretBytes).slice(0, TOTP_SECRET_LENGTH);
      const codes = generateBackupCodes();
      const stored = encryptCredential({ secret, codes });

      try {
        await ctx.prisma.$transaction([
          ctx.prisma.userCredential.deleteMany({
            where: { userId: userRow.id, method: "TOTP" },
          }),
          ctx.prisma.userCredential.create({
            data: {
              userId: userRow.id,
              method: "TOTP",
              secretHash: stored,
            },
          }),
        ]);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[mfa.enroll] error:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "No se pudo guardar el enrolamiento.",
        });
      }

      return {
        secret,
        otpauthUri: buildOtpAuthUri({
          secret,
          account: userRow.email,
          issuer: ISSUER,
        }),
        backupCodes: codes,
      };
    }),

  /**
   * Verifica un código TOTP (6 dígitos) o un backup code (8 dígitos).
   * - TOTP: ventana ±1 step (~90s).
   * - Backup: consume el código del set cifrado.
   * Si el verify es correcto, marca `mfaEnabled = true` (idempotente).
   */
  verify: protectedProcedure
    .input(totpVerifyInput)
    .mutation(async ({ ctx, input }) => {
      const cred = await ctx.prisma.userCredential.findFirst({
        where: { userId: ctx.user.id, method: "TOTP" },
        orderBy: { createdAt: "desc" },
        select: { id: true, secretHash: true, lastUsedTotpStep: true },
      });
      if (!cred) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "MFA no enrolado." });
      }

      let plaintext: Plaintext;
      try {
        plaintext = decryptCredential(cred.secretHash);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[mfa.verify] descifrado falló:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "No se pudo leer la credencial.",
        });
      }

      const token = input.token;

      if (token.length === TOTP_DIGITS) {
        const result = verifyTotp(plaintext.secret, token);
        if (!result.matched) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Código incorrecto o expirado.",
          });
        }
        // Prevención de replay (HJ-20): rechazar si este step ya fue usado.
        if (cred.lastUsedTotpStep !== null && cred.lastUsedTotpStep === result.step) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Código ya utilizado. Espere el siguiente código TOTP.",
          });
        }
        await ctx.prisma.$transaction([
          ctx.prisma.user.update({
            where: { id: ctx.user.id },
            data: { mfaEnabled: true },
          }),
          ctx.prisma.userCredential.update({
            where: { id: cred.id },
            data: {
              validFrom: new Date(),
              lastUsedTotpStep: result.step,
              lastUsedTotpAt: new Date(),
            },
          }),
        ]);
        return { ok: true as const, usedBackupCode: false as const };
      }

      // Backup code
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
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Código de respaldo inválido o ya usado.",
        });
      }

      const remaining = plaintext.codes.filter((_, i) => i !== matchIndex);
      const newStored = encryptCredential({
        secret: plaintext.secret,
        codes: remaining,
      });

      await ctx.prisma.$transaction([
        ctx.prisma.user.update({
          where: { id: ctx.user.id },
          data: { mfaEnabled: true },
        }),
        ctx.prisma.userCredential.update({
          where: { id: cred.id },
          data: { secretHash: newStored, validFrom: new Date() },
        }),
      ]);

      return {
        ok: true as const,
        usedBackupCode: true as const,
        remainingBackupCodes: remaining.length,
      };
    }),

  /**
   * Estado del MFA del usuario actual. La UI del dashboard la usa para
   * decidir si pintar "Activar MFA" o "Reenrolar".
   */
  status: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.prisma.user.findUnique({
      where: { id: ctx.user.id },
      select: { mfaEnabled: true },
    });
    const cred = await ctx.prisma.userCredential.findFirst({
      where: { userId: ctx.user.id, method: "TOTP" },
      orderBy: { createdAt: "desc" },
      select: { validFrom: true },
    });
    return {
      enabled: user?.mfaEnabled ?? false,
      method: cred ? ("TOTP" as const) : ("NONE" as const),
      lastVerifiedAt: cred?.validFrom ? cred.validFrom.toISOString() : null,
    };
  }),
});
