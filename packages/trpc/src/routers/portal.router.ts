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
 * K-19 (audit Stream K): `validateDUI` se importa desde `@his/contracts/validators`
 * (alias resuelto en vitest.config.ts línea 45). El inline previo causaba
 * drift silencioso con la implementación canónica.
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
import { validateDUI } from "@his/contracts/validators";
import { router, publicProcedure, portalProcedure } from "../trpc";
import { withPortalContext, applyPortalContext } from "../rls-context";
import { rateLimitOrThrow, normalizeIp } from "../middleware/rate-limit";

// K-12 (audit Stream K): umbral de fallos TOTP antes de lockout.
// Coherente con anti-brute-force típico (3-5 intentos / ventana de 15min).
const TOTP_FAIL_LOCKOUT_THRESHOLD = 5;
const TOTP_FAIL_LOCKOUT_DURATION_MS = 15 * 60_000;

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
  // K-03 (audit Stream K): NUNCA loguear el token raw — un atacante con acceso
  // a logs (Vercel/Datadog/Supabase) podría usarlo para hijacking durante el
  // TTL del enlace. Redactamos email también (PII). El integrador del provider
  // de email (US.B20.1.2 Resend) recibe el token directamente como parámetro.
  void email;
  void token;
  console.log(`[portal][magic-link] purpose=${purpose} delivered=<redacted>`);
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
        email: z.string().email().max(254),
        patientId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // K-04 (audit Stream K): rate-limit por IP + email para prevenir
      // enumeración de DUIs (combinado con anti-enumeration `{ sent: true }`).
      const ip = normalizeIp(ctx.ip);
      const emailKey = input.email.toLowerCase();
      rateLimitOrThrow({ key: `auth:register:ip=${ip}`, max: 10, windowMs: 60_000 });
      rateLimitOrThrow({ key: `auth:register:email=${emailKey}`, max: 3, windowMs: 5 * 60_000 });

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
    .input(z.object({ email: z.string().email().max(254) }))
    .mutation(async ({ ctx, input }) => {
      // K-04 (audit Stream K): rate-limit defense-in-depth.
      // Superposición IP + email: un atacante con muchas IPs sigue limitado
      // por target; un IP saturando emails distintos también.
      const ip = normalizeIp(ctx.ip);
      const emailKey = input.email.toLowerCase();
      rateLimitOrThrow({ key: `auth:request-login:ip=${ip}`, max: 10, windowMs: 60_000 });
      rateLimitOrThrow({ key: `auth:request-login:email=${emailKey}`, max: 5, windowMs: 5 * 60_000 });

      const account = await ctx.prisma.portalAccount.findUnique({
        where: { email: emailKey },
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
      // K-04 (audit Stream K): rate-limit por IP. Más laxo que requestLogin
      // porque el usuario legítimo puede reintentar tras MFA fail.
      rateLimitOrThrow({
        key: `auth:verify-login:ip=${normalizeIp(ctx.ip)}`,
        max: 20,
        windowMs: 60_000,
      });

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
              failedLoginAttempts: true,
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
          // K-12 (audit Stream K): incrementar contador de fallos en tx atómica.
          // Si supera umbral, set lockedUntil. Consumir el magic link también
          // (anti-replay: cada token solo se intenta una vez por código TOTP).
          const lockoutAt = new Date(Date.now() + TOTP_FAIL_LOCKOUT_DURATION_MS);
          await ctx.prisma.$transaction(async (tx) => {
            await tx.portalAccount.update({
              where: { id: acct.id },
              data: {
                failedLoginAttempts: { increment: 1 },
                // Activar lockout cuando el intento N alcance el umbral.
                // failedLoginAttempts ya tenía N-1, este UPDATE deja N.
                ...((acct as { failedLoginAttempts?: number }).failedLoginAttempts !== undefined &&
                ((acct as { failedLoginAttempts?: number }).failedLoginAttempts ?? 0) + 1 >=
                  TOTP_FAIL_LOCKOUT_THRESHOLD
                  ? { lockedUntil: lockoutAt }
                  : {}),
              },
            });
            await tx.portalMagicLink.update({
              where: { id: link.id },
              data: { consumedAt: new Date() },
            });
          });
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Código TOTP inválido." });
        }
      }

      // Consumir link + crear sesión (K-10: applyPortalContext dentro de tx
      // para que la policy `portal_session_insert` valide en BD que
      // accountId coincide con el GUC — defense-in-depth complementa
      // la validación JS).
      const sessionRaw = generateToken();
      const sessionHashed = hashToken(sessionRaw);
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

      await ctx.prisma.$transaction(async (tx) => {
        await applyPortalContext(tx as unknown as Pick<typeof ctx.prisma, "$executeRawUnsafe">, acct.id);
        await tx.portalMagicLink.update({
          where: { id: link.id },
          data: { consumedAt: new Date() },
        });
        await tx.portalSession.create({
          data: {
            accountId: acct.id,
            token: sessionHashed,
            expiresAt,
            ip: ctx.ip,
            userAgent: ctx.userAgent,
          },
        });
        await tx.portalAccount.update({
          where: { id: acct.id },
          data: { lastLoginAt: new Date(), lastLoginIp: ctx.ip ?? null, failedLoginAttempts: 0 },
        });
      });

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

// ─── Pagination input reutilizable ───────────────────────────────────────────

const paginationInput = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

// ─── Helper: resolución de patientId del portal account + guardian opcional ──

/**
 * Resuelve el patientId efectivo para queries HCE.
 *
 * Si `wardPatientId` está presente, valida que la relación
 * `GuardianRelationship` esté ACTIVE. Lanza FORBIDDEN si no.
 *
 * Defensa IDOR: el `patientId` base NUNCA se acepta del input —
 * siempre proviene de `ctx.portalAccount.patientId` (el JWT del portal).
 */
async function resolvePatientId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: { prisma: any; portalAccount: { id: string; patientId: string } },
  wardPatientId: string | undefined,
): Promise<string> {
  if (!wardPatientId) return ctx.portalAccount.patientId;

  const rel = await ctx.prisma.guardianRelationship.findFirst({
    where: {
      guardianAccountId: ctx.portalAccount.id,
      wardPatientId,
      status: "ACTIVE",
    },
    select: { wardPatientId: true },
  });

  if (!rel) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Relación de tutela no activa o no encontrada.",
    });
  }

  return rel.wardPatientId as string;
}

// ─── HCE sub-router ───────────────────────────────────────────────────────────

/**
 * HCE consulta del portal — E.B20.2.
 *
 * Todos los procedures usan portalProcedure + withPortalContext.
 * El patientId se deriva del JWT (ctx.portalAccount.patientId) — nunca del input.
 * El guardian puede consultar wardPatientId si la relación GuardianRelationship está ACTIVE.
 *
 * Gap §5.2: showInPortal en LabResult NO implementado — todos los resultados
 * con validatedAt != null (estado VALIDATED/RELEASED en el flujo LIS) son visibles.
 * Pendiente decisión @DBA sobre campo `confidential` en LabResult.
 */

const guardianInput = z.object({
  wardPatientId: z.string().uuid().optional(),
});

const hceRouter = router({
  appointments: router({
    /**
     * US.B20.2.1 — citas del paciente (próximas + pasadas, paginadas).
     * Ordenadas descendente (más recientes primero) para el tab "pasadas";
     * el filtro de próximas se aplica con `upcoming=true`.
     */
    list: portalProcedure
      .input(guardianInput.merge(paginationInput).extend({ upcoming: z.boolean().optional() }))
      .query(async ({ ctx, input }) => {
        const patientId = await resolvePatientId(ctx, input.wardPatientId);

        return withPortalContext(ctx.prisma, ctx.portalAccount.id, async (tx) => {
          const now = new Date();
          const where = {
            patientId,
            deletedAt: null,
            ...(input.upcoming
              ? { scheduledAt: { gte: now } }
              : { scheduledAt: { lt: now } }),
            ...(input.cursor ? { id: { lt: input.cursor } } : {}),
          };

          return tx.outpatientAppointment.findMany({
            where,
            select: {
              id: true,
              scheduledAt: true,
              durationMinutes: true,
              status: true,
              reason: true,
              provider: { select: { fullName: true } },
            },
            orderBy: { scheduledAt: input.upcoming ? "asc" : "desc" },
            take: input.limit,
          });
        });
      }),

    /** US.B20.2.1 — próximas 5 citas del paciente. */
    upcoming: portalProcedure
      .input(guardianInput)
      .query(async ({ ctx, input }) => {
        const patientId = await resolvePatientId(ctx, input.wardPatientId);

        return withPortalContext(ctx.prisma, ctx.portalAccount.id, async (tx) => {
          return tx.outpatientAppointment.findMany({
            where: {
              patientId,
              deletedAt: null,
              scheduledAt: { gte: new Date() },
              status: { notIn: ["CANCELLED", "NO_SHOW"] },
            },
            select: {
              id: true,
              scheduledAt: true,
              durationMinutes: true,
              status: true,
              reason: true,
              provider: { select: { fullName: true } },
            },
            orderBy: { scheduledAt: "asc" },
            take: 5,
          });
        });
      }),
  }),

  labResults: router({
    /**
     * US.B20.2.2 — resultados de laboratorio del paciente.
     * Filtra: solo resultados con validatedAt != null (estado VALIDATED en flujo LIS).
     * La paginación usa cursor sobre id (UUID).
     *
     * Gap §5.2: campo `confidential` no existe en schema — no se filtra.
     */
    list: portalProcedure
      .input(guardianInput.merge(paginationInput))
      .query(async ({ ctx, input }) => {
        const patientId = await resolvePatientId(ctx, input.wardPatientId);

        return withPortalContext(ctx.prisma, ctx.portalAccount.id, async (tx) => {
          // Navegar: LabResult → LabOrderItem → LabOrder (tiene patientId)
          const results = await tx.labResult.findMany({
            where: {
              validatedAt: { not: null },
              orderItem: {
                order: { patientId },
              },
              ...(input.cursor ? { id: { lt: input.cursor } } : {}),
            },
            select: {
              id: true,
              flag: true,
              valueNumeric: true,
              valueText: true,
              valueUnit: true,
              validatedAt: true,
              resultedAt: true,
              orderItem: {
                select: {
                  test: { select: { name: true, code: true } },
                  order: { select: { orderedAt: true } },
                },
              },
            },
            orderBy: { resultedAt: "desc" },
            take: input.limit,
          });

          return results;
        });
      }),

    /** US.B20.2.2 — detalle de un resultado de lab individual. */
    get: portalProcedure
      .input(guardianInput.extend({ resultId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const patientId = await resolvePatientId(ctx, input.wardPatientId);

        return withPortalContext(ctx.prisma, ctx.portalAccount.id, async (tx) => {
          const result = await tx.labResult.findFirst({
            where: {
              id: input.resultId,
              validatedAt: { not: null },
              orderItem: { order: { patientId } },
            },
            select: {
              id: true,
              flag: true,
              valueNumeric: true,
              valueText: true,
              valueUnit: true,
              notes: true,
              validatedAt: true,
              resultedAt: true,
              orderItem: {
                select: {
                  // K-26 (audit Stream K): refRangeText permite que el paciente
                  // vea referencia para resultados cualitativos (cultivos,
                  // serológicos, etc.) que solo tienen rango textual ("Negativo").
                  test: {
                    select: {
                      id: true,
                      name: true,
                      code: true,
                      refRangeLow: true,
                      refRangeHigh: true,
                      refRangeText: true,
                      unit: true,
                    },
                  },
                  // K-17 (audit Stream K): NO devolver patientId al cliente.
                  // El procedure ya filtró el resultado por el paciente del
                  // session — exponer el UUID es superfluo y filtra el id
                  // interno al browser/network logs.
                  order: { select: { orderedAt: true } },
                },
              },
            },
          });

          if (!result) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Resultado no encontrado." });
          }

          // K-21 (audit Stream K): rangos estratificados por sex+age del paciente.
          // El catálogo `LabReferenceRange` ya existe (SQL 25); usar el rango
          // global del LabTest (refRangeLow/High planos) ignora variaciones
          // demográficas y puede mostrar alarmas falsas.
          let stratifiedRange: {
            minValue: number | null;
            maxValue: number | null;
            criticalLow: number | null;
            criticalHigh: number | null;
            sex: string;
            ageMinYears: number | null;
            ageMaxYears: number | null;
          } | null = null;
          if (result.orderItem.test.id) {
            const patient = await tx.patient.findUnique({
              where: { id: patientId },
              select: {
                birthDate: true,
                biologicalSex: { select: { code: true } },
              },
            });
            if (patient?.birthDate) {
              const ageYears = Math.floor(
                (Date.now() - patient.birthDate.getTime()) /
                  (365.25 * 24 * 60 * 60 * 1000),
              );
              // BiologicalSex.code es "M"/"F"/"I"/"U"; LabReferenceRange.sex
              // usa "MALE"/"FEMALE"/"BOTH". Mapeamos para la query.
              const sexToken =
                patient.biologicalSex.code === "M"
                  ? "MALE"
                  : patient.biologicalSex.code === "F"
                    ? "FEMALE"
                    : "BOTH";
              const range = await tx.labReferenceRange.findFirst({
                where: {
                  labTestId: result.orderItem.test.id,
                  active: true,
                  OR: [{ sex: sexToken }, { sex: "BOTH" }],
                  AND: [
                    { OR: [{ ageMinYears: null }, { ageMinYears: { lte: ageYears } }] },
                    { OR: [{ ageMaxYears: null }, { ageMaxYears: { gte: ageYears } }] },
                  ],
                },
                // Preferir rangos sex-específicos y con age-bracket más estrecho.
                orderBy: [{ sex: "asc" }, { ageMinYears: "desc" }],
                select: {
                  minValue: true,
                  maxValue: true,
                  criticalLow: true,
                  criticalHigh: true,
                  sex: true,
                  ageMinYears: true,
                  ageMaxYears: true,
                },
              });
              if (range) {
                stratifiedRange = {
                  minValue: range.minValue ? Number(range.minValue) : null,
                  maxValue: range.maxValue ? Number(range.maxValue) : null,
                  criticalLow: range.criticalLow ? Number(range.criticalLow) : null,
                  criticalHigh: range.criticalHigh ? Number(range.criticalHigh) : null,
                  sex: range.sex,
                  ageMinYears: range.ageMinYears,
                  ageMaxYears: range.ageMaxYears,
                };
              }
            }
          }

          return { ...result, stratifiedRange };
        });
      }),
  }),

  prescriptions: router({
    /**
     * US.B20.2.5 — recetas del paciente (con líneas + dispensaciones).
     * Muestra SIGNED y PARTIALLY_DISPENSED (activas/vigentes).
     */
    list: portalProcedure
      .input(guardianInput.merge(paginationInput))
      .query(async ({ ctx, input }) => {
        const patientId = await resolvePatientId(ctx, input.wardPatientId);

        return withPortalContext(ctx.prisma, ctx.portalAccount.id, async (tx) => {
          return tx.prescription.findMany({
            where: {
              patientId,
              status: { in: ["SIGNED", "PARTIALLY_DISPENSED"] },
              ...(input.cursor ? { id: { lt: input.cursor } } : {}),
            },
            select: {
              id: true,
              prescribedAt: true,
              status: true,
              signedAt: true,
              items: {
                select: {
                  id: true,
                  dosage: true,
                  route: true,
                  frequency: true,
                  durationDays: true,
                  prescribedQty: true,
                  administeredQty: true,
                  drug: { select: { genericName: true, brandName: true } },
                  dispenses: {
                    select: { dispensedAt: true, quantity: true },
                    orderBy: { dispensedAt: "desc" },
                    take: 5,
                  },
                },
              },
            },
            orderBy: { prescribedAt: "desc" },
            take: input.limit,
          });
        });
      }),
  }),

  vaccinations: router({
    /** US.B20.2.4 — historial de vacunación del paciente. */
    list: portalProcedure
      .input(guardianInput)
      .query(async ({ ctx, input }) => {
        const patientId = await resolvePatientId(ctx, input.wardPatientId);

        return withPortalContext(ctx.prisma, ctx.portalAccount.id, async (tx) => {
          // K-25 (audit Stream K): paginación dura para evitar payloads
          // ilimitados en pacientes con migración legacy (decenas de dosis).
          // 100 cubre PAI pediátrico completo (~20) + adultos crónicos.
          return tx.patientVaccination.findMany({
            where: { patientId },
            select: {
              id: true,
              doseNumber: true,
              administeredAt: true,
              lotNumber: true,
              anatomicalSite: true,
              vaccine: { select: { name: true, code: true, scheduleNote: true } },
            },
            orderBy: { administeredAt: "desc" },
            take: 100,
          });
        });
      }),
  }),
});

// ─── Expediente router (US.F2.7.43) ─────────────────────────────────────────

/**
 * US.F2.7.43 — Acceso del paciente a su expediente ECE vía portal.
 *
 * Retorna: episodios de atención, diagnósticos, documentos firmados.
 * Excluye: notas internas (clinicalNote.isInternal=true), drafts, notas confidenciales.
 * El patientId NUNCA se acepta del input — proviene del JWT del portal.
 */
const expedienteRouter = router({
  /** Resumen del expediente del paciente autenticado. */
  getMiExpediente: portalProcedure
    .input(z.object({ wardPatientId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const patientId = await resolvePatientId(ctx, input.wardPatientId);

      return withPortalContext(ctx.prisma, ctx.portalAccount.id, async (tx) => {
        const patient = await tx.patient.findFirst({
          where: { id: patientId },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            secondLastName: true,
            mrn: true,
            birthDate: true,
            biologicalSex: { select: { name: true } },
            identifiers: {
              where: { isPrimary: true },
              select: { kind: true, value: true },
              take: 1,
            },
          },
        });

        if (!patient) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Expediente no encontrado." });
        }

        // Episodios del paciente (admisiones)
        const encounters = await tx.encounter.findMany({
          where: { patientId },
          select: {
            id: true,
            admissionType: true,
            admittedAt: true,
            dischargedAt: true,
            dischargeType: true,
            encounterNumber: true,
          },
          orderBy: { admittedAt: "desc" },
          take: 20,
        });

        const encounterIds = encounters.map((e) => e.id);

        // Diagnósticos de los encuentros del paciente
        const diagnoses =
          encounterIds.length > 0
            ? await tx.encounterDiagnosis.findMany({
                where: { encounterId: { in: encounterIds } },
                select: {
                  id: true,
                  type: true,
                  diagnosedAt: true,
                  conceptId: true,
                  encounterId: true,
                },
                orderBy: { diagnosedAt: "desc" },
                take: 50,
              })
            : [];

        return { patient, encounters, diagnoses };
      });
    }),

  /** Notas clínicas firmadas visibles al paciente (solo con signedAt != null). */
  getMisDocumentosFirmados: portalProcedure
    .input(
      z.object({
        wardPatientId: z.string().uuid().optional(),
        encounterIds: z.array(z.string().uuid()).max(20).optional(),
        cursor: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(30).default(10),
      }),
    )
    .query(async ({ ctx, input }) => {
      const patientId = await resolvePatientId(ctx, input.wardPatientId);

      return withPortalContext(ctx.prisma, ctx.portalAccount.id, async (tx) => {
        // Primero resolver encounterIds del paciente si no se pasaron
        let eIds = input.encounterIds;
        if (!eIds) {
          const encs = await tx.encounter.findMany({
            where: { patientId },
            select: { id: true },
            take: 50,
          });
          eIds = encs.map((e) => e.id);
        } else {
          // Validar que TODOS los encounterIds pertenecen al paciente autenticado.
          // Si el count no coincide, alguno es de otro paciente → FORBIDDEN.
          const owned = await tx.encounter.count({
            where: { id: { in: eIds }, patientId },
          });
          if (owned !== eIds.length) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Uno o más encuentros no pertenecen al paciente autenticado.",
            });
          }
        }

        if (eIds.length === 0) return [];

        return tx.clinicalNote.findMany({
          where: {
            encounterId: { in: eIds },
            signedAt: { not: null }, // solo firmadas
            // K-05 (audit Stream K): respeta la gate explícita de visibilidad al portal.
            // El médico debe marcar `isPortalVisible: true` cuando completa la nota
            // y considera apropiado publicarla. Default false filtra notas
            // psiquiátricas / trabajo social / addenda internos.
            //
            // K-18 (audit Stream K): la gate `isPortalVisible` reemplaza el patrón
            // de whitelist por `noteType: { notIn: [...] }` propuesto en el audit.
            // Si en el futuro se requiere prohibir un tipo INCLUSO cuando el médico
            // marque la nota como visible, debe expresarse como CHECK constraint
            // en `ClinicalNote` (regla institucional, no de UI).
            isPortalVisible: true,
            ...(input.cursor ? { id: { lt: input.cursor } } : {}),
          },
          select: {
            id: true,
            noteType: true,
            signedAt: true,
            encounterId: true,
            // K-13 (audit Stream K): NO exponer authorId (UUID interno User) al paciente.
            // Permite enumeración de usuarios clínicos. La UI muestra nombre
            // del médico vía join cuando lo necesita.
            updatedAt: true,
          },
          orderBy: { signedAt: "desc" },
          take: input.limit,
        });
      });
    }),
});

export const portalRouter = router({
  account: accountRouter,
  auth: authRouter,
  guardian: guardianRouter,
  hce: hceRouter,
  expediente: expedienteRouter,
});
