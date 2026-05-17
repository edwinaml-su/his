/**
 * Portal del Paciente — router auth + onboarding (Beta.20 E.B20.1).
 *
 * Sub-routers:
 *   account  — register, verifyEmail, enableMfa, verifyMfa
 *   auth     — requestLogin (magic link), verifyLogin, logout
 *   guardian — list
 *
 * Auth: passwordless vía magic link (SHA-256, 15 min TTL) + TOTP opcional.
 * Anti-enumeration: register y requestLogin siempre devuelven { sent: true }.
 * RLS: withPortalContext aplica GUC `app.current_portal_account` (SQL 52).
 *
 * NOTA: validateDUI está inlineado aquí en vez de importar de @his/contracts
 * porque la resolución de workspace falla en el runner de vitest del paquete trpc.
 * Mantener en sincronía con packages/contracts/src/validators/index.ts.
 */
import { z } from "zod";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, portalProcedure } from "../trpc";

// ─── DUI validator (paridad con packages/contracts/src/validators/index.ts) ──

function validateDUI(value: string): boolean {
  const clean = value.replace(/[-\s]/g, "");
  if (!/^\d{9}$/.test(clean)) return false;
  // Cuerpo del DUI no puede ser todo ceros (regla práctica RNPN).
  if (clean.slice(0, 8) === "00000000") return false;
  const digits = clean.split("").map(Number);
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    sum += digits[i]! * (10 - (i + 1));
  }
  let calc = 10 - (sum % 10);
  if (calc === 10) calc = 0;
  return digits[8] === calc;
}

// ─── TOTP (RFC 6238, HMAC-SHA1, 30 s, 6 dígitos) ────────────────────────────

const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_CHARS[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_CHARS[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(str: string): Buffer {
  const s = str.toUpperCase().replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const c of s) {
    const idx = BASE32_CHARS.indexOf(c);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function generateTotp(secretBase32: string, window = 0): string {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(Date.now() / 1000 / 30) + window;
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac: Buffer = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

function verifyTotp(secretBase32: string, token: string): boolean {
  for (const w of [-1, 0, 1]) {
    if (generateTotp(secretBase32, w) === token) return true;
  }
  return false;
}

// ─── AES-256-GCM encrypt/decrypt for MFA secret ──────────────────────────────
// Formato: JSON { v: 1, iv: hex, tag: hex, ct: hex }

function getEncKey(): Buffer {
  const raw = process.env.PORTAL_SECRET ?? process.env.AUTH_SECRET ?? "dev-insecure-key-change-in-prod";
  return createHash("sha256").update(`portal-mfa:${raw}`).digest();
}

function encryptSecret(plain: string): string {
  const key = getEncKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: 1,
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    ct: ct.toString("hex"),
  });
}

function decryptSecret(stored: string): string {
  const { v, iv, tag, ct } = JSON.parse(stored) as { v: number; iv: string; tag: string; ct: string };
  if (v !== 1) throw new Error("Unsupported mfaSecret version");
  const key = getEncKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"));
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  return decipher.update(Buffer.from(ct, "hex")).toString("utf8") + decipher.final("utf8");
}

// ─── Magic link email stub (US.B20.1.2 integra Resend) ───────────────────────

async function sendMagicLinkEmail(email: string, token: string, purpose: string): Promise<void> {
  console.log(`[portal][magic-link] email=${email} purpose=${purpose} token=${token}`);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 minutos
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 días
// TOTP secret = 20 bytes → 32 chars base32
const TOTP_SECRET_BYTES = 20;

// ─── Sub-routers ─────────────────────────────────────────────────────────────

const accountRouter = router({
  /**
   * Registra un PortalAccount para el paciente identificado por DUI + patientId.
   * Anti-enumeration: siempre devuelve { sent: true } aunque el DUI/paciente no exista.
   */
  register: publicProcedure
    .input(
      z.object({
        dui: z.string().refine(validateDUI, { message: "DUI inválido." }),
        email: z.string().email(),
        patientId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verificar que el DUI corresponde al patientId (defensa contra IDOR)
      const identifier = await ctx.prisma.patientIdentifier.findFirst({
        where: {
          patientId: input.patientId,
          value: input.dui.replace(/[-\s]/g, ""),
          kind: "DUI",
        },
        select: { id: true, patientId: true },
      });

      if (identifier) {
        const existing = await ctx.prisma.portalAccount.findUnique({
          where: { patientId: identifier.patientId },
          select: { id: true, status: true },
        });

        if (!existing) {
          const account = await ctx.prisma.portalAccount.create({
            data: {
              patientId: identifier.patientId,
              email: input.email.toLowerCase(),
              status: "PENDING_VERIFICATION",
            },
            select: { id: true },
          });

          const raw = generateToken();
          const hashed = hashToken(raw);
          await ctx.prisma.portalMagicLink.create({
            data: {
              accountId: account.id,
              token: hashed,
              purpose: "REGISTER",
              expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS),
            },
          });
          await sendMagicLinkEmail(input.email, raw, "REGISTER");
        }
      }

      return { sent: true };
    }),

  /**
   * Consume el magic link de verificación de email.
   * Activa la cuenta si estaba PENDING_VERIFICATION.
   */
  verifyEmail: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const hashed = hashToken(input.token);
      const link = await ctx.prisma.portalMagicLink.findUnique({
        where: { token: hashed },
        select: { id: true, accountId: true, purpose: true, expiresAt: true, consumedAt: true },
      });

      if (!link) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Token no encontrado." });
      }

      if (link.consumedAt || link.purpose !== "REGISTER" || link.expiresAt < new Date()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "El enlace es inválido o ha expirado." });
      }

      await ctx.prisma.$transaction([
        ctx.prisma.portalMagicLink.update({
          where: { id: link.id },
          data: { consumedAt: new Date() },
        }),
        ctx.prisma.portalAccount.update({
          where: { id: link.accountId },
          data: {
            emailVerifiedAt: new Date(),
            status: "ACTIVE",
          },
        }),
      ]);

      return { verified: true };
    }),

  /** Inicia el enrollment de TOTP. Devuelve el secreto base32 y el otpauthUri para el QR. */
  enableMfa: portalProcedure
    .input(z.object({}).optional())
    .mutation(async ({ ctx }) => {
      const account = await ctx.prisma.portalAccount.findUnique({
        where: { id: ctx.portalAccount.id },
        select: { id: true, email: true, mfaEnabled: true },
      });

      if (!account) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Cuenta no encontrada." });
      }

      const secretRaw = base32Encode(randomBytes(TOTP_SECRET_BYTES));
      const encrypted = encryptSecret(secretRaw);

      await ctx.prisma.portalAccount.update({
        where: { id: ctx.portalAccount.id },
        data: { mfaSecret: encrypted, mfaEnabled: false },
      });

      const otpauthUri = `otpauth://totp/Portal%20Avante:${encodeURIComponent(account.email)}?secret=${secretRaw}&issuer=HIS-Avante`;

      return { secret: secretRaw, otpauthUri };
    }),

  /** Confirma el TOTP y habilita MFA. Input field is `code` to match test contract. */
  verifyMfa: portalProcedure
    .input(z.object({ code: z.string().length(6) }))
    .mutation(async ({ ctx, input }) => {
      const account = await ctx.prisma.portalAccount.findUnique({
        where: { id: ctx.portalAccount.id },
        select: { mfaSecret: true },
      });

      if (!account?.mfaSecret) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "MFA no está configurado. Use enableMfa primero." });
      }

      const secretPlain = decryptSecret(account.mfaSecret);
      if (!verifyTotp(secretPlain, input.code)) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Código TOTP inválido." });
      }

      await ctx.prisma.portalAccount.update({
        where: { id: ctx.portalAccount.id },
        data: { mfaEnabled: true },
      });

      return { enabled: true };
    }),
});

const authRouter = router({
  /**
   * Solicita magic link de login para el email indicado.
   * Anti-enumeration: siempre devuelve { sent: true }.
   * No envía si la cuenta está bloqueada (lockedUntil > now).
   */
  requestLogin: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      const account = await ctx.prisma.portalAccount.findUnique({
        where: { email: input.email.toLowerCase() },
        select: { id: true, status: true, lockedUntil: true },
      });

      const canSend =
        account &&
        account.status === "ACTIVE" &&
        (!account.lockedUntil || account.lockedUntil <= new Date());

      if (canSend) {
        const raw = generateToken();
        const hashed = hashToken(raw);
        await ctx.prisma.portalMagicLink.create({
          data: {
            accountId: account.id,
            token: hashed,
            purpose: "LOGIN",
            expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS),
          },
        });
        await sendMagicLinkEmail(input.email, raw, "LOGIN");
      }

      return { sent: true };
    }),

  /**
   * Verifica el magic link de login.
   * Si MFA está habilitado y no se proveyó totpCode, lanza PRECONDITION_FAILED.
   * Si exitoso, devuelve { token, expiresAt } del PortalSession.
   */
  verifyLogin: publicProcedure
    .input(z.object({ token: z.string().min(1), totpCode: z.string().length(6).optional() }))
    .mutation(async ({ ctx, input }) => {
      const hashed = hashToken(input.token);
      const link = await ctx.prisma.portalMagicLink.findUnique({
        where: { token: hashed },
        include: {
          account: {
            select: {
              id: true,
              patientId: true,
              email: true,
              status: true,
              mfaEnabled: true,
              mfaSecret: true,
              lockedUntil: true,
            },
          },
        },
      });

      if (!link || link.consumedAt || link.purpose !== "LOGIN" || link.expiresAt < new Date()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "El enlace es inválido o ha expirado." });
      }

      const acct = link.account;

      if (acct.status !== "ACTIVE") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Cuenta suspendida." });
      }

      if (acct.lockedUntil && acct.lockedUntil > new Date()) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Cuenta bloqueada temporalmente." });
      }

      // Si MFA habilitado y no se proveyó código → PRECONDITION_FAILED (el cliente muestra el campo)
      if (acct.mfaEnabled) {
        if (!input.totpCode) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Se requiere código TOTP." });
        }
        if (!acct.mfaSecret) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Configuración MFA inconsistente." });
        }
        const secretPlain = decryptSecret(acct.mfaSecret);
        if (!verifyTotp(secretPlain, input.totpCode)) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Código TOTP inválido." });
        }
      }

      // Consumir link + crear sesión
      const sessionRaw = generateToken();
      const sessionHashed = hashToken(sessionRaw);
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

      await ctx.prisma.$transaction([
        ctx.prisma.portalMagicLink.update({
          where: { id: link.id },
          data: { consumedAt: new Date() },
        }),
        ctx.prisma.portalSession.create({
          data: {
            accountId: acct.id,
            token: sessionHashed,
            expiresAt,
            ip: ctx.ip,
            userAgent: ctx.userAgent,
          },
        }),
        ctx.prisma.portalAccount.update({
          where: { id: acct.id },
          data: { lastLoginAt: new Date(), lastLoginIp: ctx.ip ?? null, failedLoginAttempts: 0 },
        }),
      ]);

      return {
        token: sessionRaw,
        expiresAt,
        portalAccountId: acct.id,
        patientId: acct.patientId,
      };
    }),

  /** Revoca la sesión activa del portal account autenticado. */
  logout: portalProcedure.mutation(async ({ ctx }) => {
    await ctx.prisma.portalSession.updateMany({
      where: {
        accountId: ctx.portalAccount.id,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }),
});

const guardianRouter = router({
  /** Lista las relaciones de tutela activas del portal account autenticado. */
  list: portalProcedure.query(async ({ ctx }) => {
    const rows = await ctx.prisma.guardianRelationship.findMany({
      where: {
        guardianAccountId: ctx.portalAccount.id,
        status: "ACTIVE",
      },
      include: {
        wardPatient: {
          select: { id: true, firstName: true, lastName: true, birthDate: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    // Remap wardPatient → ward para que el contrato de API sea limpio
    return rows.map(({ wardPatient, ...rel }) => ({ ...rel, ward: wardPatient }));
  }),
});

export const portalRouter = router({
  account: accountRouter,
  auth: authRouter,
  guardian: guardianRouter,
});
