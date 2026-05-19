/**
 * Stream 18 — Router tRPC: Firma Electrónica Simple (ECE).
 *
 * Norma técnica: Arts. 4.17, 23 lit. a.4, 44, 45, 52 — Acuerdo n.° 1616
 * (MINSAL, 2024).  Implementa el ciclo de vida del PIN de firma para el
 * personal de salud registrado en `ece.personal_salud`.
 *
 * Procedures:
 *   firma.setup           — crea PIN inicial (protectedProcedure).
 *   firma.verify          — valida PIN, devuelve firmaId + timestamp (protectedProcedure).
 *   firma.confirm         — valida PIN + emite firma con contexto de auditoría (protectedProcedure).
 *   firma.requestRecovery — genera token de recuperación y lo envía por email (publicProcedure).
 *   firma.completeRecovery — completa recuperación con MFA + nuevo PIN (publicProcedure).
 *
 * Estrategia de hashing:
 *   argon2id (mismo algoritmo que `@his/infrastructure/src/firma/pin-hasher.ts`).
 *   Se inlinea aquí para no introducir dependencia circular entre @his/trpc y
 *   @his/infrastructure; si se consolida, prevalece la lógica de pin-hasher.
 *   PREREQUISITO: agregar `"argon2": "^0.41.1"` a packages/trpc/package.json.
 *
 * Tablas raw SQL (fuera de Prisma schema — aplicar 57_ece_02_seguridad.sql +
 * los archivos de sesión/bitácora pendientes):
 *   ece.firma_electronica    — credencial de firma.
 *   ece.firma_session_cache  — caché de sesión 15 min (firmaId + userId + expiresAt).
 *   ece.bitacora_acceso      — registro de intentos verify/confirm.
 *
 * El trigger `trg_lockout_firma` en BD gestiona `locked_until` al actualizar
 * `failed_attempts`; la app solo incrementa el contador — no calcula lockout.
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
import { protectedProcedure, publicProcedure, router } from "../trpc";
// argon2 must be in packages/trpc/package.json: "argon2": "^0.41.1"
import argon2 from "argon2";

// =============================================================================
// Constantes
// =============================================================================

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 4096,
  timeCost: 3,
  parallelism: 1,
} as const;

const LOCKOUT_MAX_ATTEMPTS = 5;
const SESSION_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutos
const RECOVERY_TOKEN_BYTES = 32;
// PIN: mínimo 6 dígitos numéricos, máximo 8.
const PIN_REGEX = /^\d{6,8}$/;

// =============================================================================
// Schemas Zod
// =============================================================================

const pinSchema = z
  .string()
  .trim()
  .refine((v) => PIN_REGEX.test(v), {
    message: "El PIN debe tener entre 6 y 8 dígitos numéricos.",
  });

const setupInput = z.object({
  pin: pinSchema,
  confirmPin: pinSchema,
}).refine((d) => d.pin === d.confirmPin, {
  message: "Los PINs no coinciden.",
  path: ["confirmPin"],
});

const verifyInput = z.object({
  pin: pinSchema,
  context: z.string().max(500).optional(),
});

const confirmInput = z.object({
  pin: pinSchema,
  resource: z.string().min(1).max(200),
  action: z.string().min(1).max(100),
});

const requestRecoveryInput = z.object({
  email: z.string().email(),
});

const completeRecoveryInput = z.object({
  token: z.string().length(RECOVERY_TOKEN_BYTES * 2), // hex string
  mfaCode: z.string().min(6).max(8),
  newPin: pinSchema,
  confirmPin: pinSchema,
}).refine((d) => d.newPin === d.confirmPin, {
  message: "Los PINs no coinciden.",
  path: ["confirmPin"],
});

// =============================================================================
// Tipos locales para filas raw SQL
// =============================================================================

type FirmaRow = {
  id: string;
  personal_id: string;
  pin_hash: string;
  salt_extra: string;
  failed_attempts: number;
  locked_until: Date | null;
  revoked_at: Date | null;
};

type PersonalRow = {
  id: string;
};

type SessionCacheRow = {
  firma_id: string;
  user_id: string;
  expires_at: Date;
};

// =============================================================================
// Helpers criptográficos (espejo de @his/infrastructure/src/firma/pin-hasher.ts)
// =============================================================================

async function hashPin(pin: string, saltHex?: string): Promise<{ hash: string; salt: string }> {
  const saltBuffer = saltHex ? Buffer.from(saltHex, "hex") : randomBytes(16);
  const hash = await argon2.hash(pin, { ...ARGON2_OPTIONS, salt: saltBuffer });
  return { hash, salt: saltBuffer.toString("hex") };
}

async function verifyPin(pin: string, storedHash: string): Promise<boolean> {
  return argon2.verify(storedHash, pin);
}

function generateRecoveryToken(): string {
  return randomBytes(RECOVERY_TOKEN_BYTES).toString("hex");
}

function hashRecoveryToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

// =============================================================================
// Helpers MFA — espejo de mfa.router.ts (funciones privadas, sin export).
// AES-256-GCM con key derivada de AUTH_SECRET (SHA-256).
// Formato secretHash: { v, iv, tag, ct, createdAt } JSON-stringified.
// TOTP RFC 6238 — HMAC-SHA1 con window ±1 step (90s tolerancia).
// =============================================================================

const MFA_IV_BYTES = 12;
const MFA_TAG_BYTES = 16;
const MFA_ENC_VERSION = 1;
const TOTP_DIGITS = 6;
const TOTP_STEP_SECONDS = 30;
const TOTP_WINDOW = 1;
const RE_TOTP_TOKEN = /^[0-9]{6}$/;
const RE_BACKUP_CODE = /^[0-9]{8}$/;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

type MfaStoredCredential = { v: number; iv: string; tag: string; ct: string; createdAt: string };
type MfaPlaintext = { secret: string; codes: string[] };

function getMfaEncryptionKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "AUTH_SECRET no configurado correctamente.",
    });
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

function decryptMfaCredential(stored: string): MfaPlaintext {
  const blob = JSON.parse(stored) as MfaStoredCredential;
  if (blob.v !== MFA_ENC_VERSION) throw new Error(`Versión MFA desconocida: v${blob.v}`);
  const key = getMfaEncryptionKey();
  const iv = Buffer.from(blob.iv, "hex");
  const tag = Buffer.from(blob.tag, "hex");
  const ct = Buffer.from(blob.ct, "hex");
  if (iv.length !== MFA_IV_BYTES || tag.length !== MFA_TAG_BYTES) {
    throw new Error("Credential MFA corrupta.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(pt.toString("utf8")) as MfaPlaintext;
}

/** Encripta plaintext MFA — expuesto para tests internos únicamente. */
export function _encryptMfaCredentialForTest(plain: MfaPlaintext): string {
  const key = getMfaEncryptionKey();
  const iv = randomBytes(MFA_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const json = JSON.stringify(plain);
  const ct = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const blob: MfaStoredCredential = {
    v: MFA_ENC_VERSION,
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    ct: ct.toString("hex"),
    createdAt: new Date().toISOString(),
  };
  return JSON.stringify(blob);
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

function verifyTotpCode(secretBase32: string, token: string): boolean {
  if (!RE_TOTP_TOKEN.test(token)) return false;
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

function verifyBackupCode(codes: string[], token: string): boolean {
  if (!RE_BACKUP_CODE.test(token)) return false;
  const tokenBuf = Buffer.from(token, "utf8");
  for (const code of codes) {
    const codeBuf = Buffer.from(code, "utf8");
    if (codeBuf.length === tokenBuf.length && timingSafeEqual(codeBuf, tokenBuf)) {
      return true;
    }
  }
  return false;
}

// =============================================================================
// Helpers de BD raw
// =============================================================================

/**
 * Busca el personal_salud vinculado al usuario HIS.
 * La FK `his_user_id` en ece.personal_salud referencia public."User".id.
 */
async function findPersonal(
  prisma: { $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown> },
  userId: string,
): Promise<PersonalRow | null> {
  const rows = await (prisma.$queryRaw as (
    query: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<PersonalRow[]>)`
    SELECT id
    FROM ece.personal_salud
    WHERE his_user_id = ${userId}::uuid
      AND activo = true
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function findFirma(
  prisma: { $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown> },
  personalId: string,
): Promise<FirmaRow | null> {
  const rows = await (prisma.$queryRaw as (
    query: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<FirmaRow[]>)`
    SELECT id, personal_id, pin_hash, salt_extra,
           failed_attempts, locked_until, revoked_at
    FROM ece.firma_electronica
    WHERE personal_id = ${personalId}::uuid
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function incrementFailedAttempts(
  prisma: { $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown> },
  firmaId: string,
): Promise<void> {
  // El trigger trg_lockout_firma gestiona locked_until cuando failed_attempts >= 5.
  await (prisma.$executeRaw as (
    query: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<number>)`
    UPDATE ece.firma_electronica
    SET failed_attempts = failed_attempts + 1
    WHERE id = ${firmaId}::uuid
  `;
}

async function resetFailedAttempts(
  prisma: { $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown> },
  firmaId: string,
): Promise<void> {
  // El trigger libera locked_until cuando failed_attempts vuelve a 0.
  await (prisma.$executeRaw as (
    query: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<number>)`
    UPDATE ece.firma_electronica
    SET failed_attempts = 0
    WHERE id = ${firmaId}::uuid
  `;
}

async function insertSessionCache(
  prisma: { $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown> },
  firmaId: string,
  userId: string,
): Promise<void> {
  const expiresAt = new Date(Date.now() + SESSION_CACHE_TTL_MS);
  await (prisma.$executeRaw as (
    query: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<number>)`
    INSERT INTO ece.firma_session_cache (firma_id, user_id, expires_at)
    VALUES (${firmaId}::uuid, ${userId}::uuid, ${expiresAt}::timestamptz)
    ON CONFLICT (firma_id) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          expires_at = EXCLUDED.expires_at
  `;
}

async function insertBitacora(
  prisma: { $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown> },
  opts: {
    firmaId: string;
    userId: string;
    accion: string;
    exito: boolean;
    contexto?: string;
    ip?: string;
  },
): Promise<void> {
  const contexto = opts.contexto ?? null;
  const ip = opts.ip ?? null;
  await (prisma.$executeRaw as (
    query: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<number>)`
    INSERT INTO ece.bitacora_acceso
      (firma_id, user_id, accion, exito, contexto, ip, registrado_en)
    VALUES
      (${opts.firmaId}::uuid, ${opts.userId}::uuid,
       ${opts.accion}, ${opts.exito},
       ${contexto}, ${ip}, now())
  `;
}

// =============================================================================
// Verificación central de PIN con lockout y auditoría
// =============================================================================

type PinCheckResult = { firmaId: string; verifiedAt: string };

/**
 * Valida el PIN contra la firma del usuario.
 * Incrementa failed_attempts si falla; resetea y rellena session cache si ok.
 * Registra siempre en ece.bitacora_acceso.
 * Lanza TRPCError en cualquier fallo.
 */
async function checkPin(
  prisma: {
    $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
    $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
  },
  opts: {
    userId: string;
    pin: string;
    accion: string;
    contexto?: string;
    ip?: string;
  },
): Promise<PinCheckResult> {
  const personal = await findPersonal(prisma, opts.userId);
  if (!personal) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No se encontró un profesional de salud asociado a su cuenta.",
    });
  }

  const firma = await findFirma(prisma, personal.id);
  if (!firma) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Firma electrónica no configurada. Use firma.setup para crearla.",
    });
  }

  if (firma.revoked_at !== null) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "La firma electrónica ha sido revocada. Contacte al administrador.",
    });
  }

  if (firma.locked_until !== null && firma.locked_until > new Date()) {
    const minutosRestantes = Math.ceil(
      (firma.locked_until.getTime() - Date.now()) / 60_000,
    );
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Firma bloqueada por demasiados intentos fallidos. Inténtelo en ${minutosRestantes} min.`,
    });
  }

  let valid = false;
  try {
    valid = await verifyPin(opts.pin, firma.pin_hash);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[firma.checkPin] error en verificación argon2:", err);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Error interno al verificar la firma.",
    });
  }

  if (!valid) {
    const remaining = LOCKOUT_MAX_ATTEMPTS - (firma.failed_attempts + 1);
    await incrementFailedAttempts(prisma, firma.id);
    // Auditar intento fallido best-effort (no bloquear el error al usuario).
    insertBitacora(prisma, {
      firmaId: firma.id,
      userId: opts.userId,
      accion: opts.accion,
      exito: false,
      contexto: opts.contexto,
      ip: opts.ip,
    }).catch((e) => console.error("[firma.bitacora] error:", e));

    throw new TRPCError({
      code: "UNAUTHORIZED",
      message:
        remaining > 0
          ? `PIN incorrecto. Intentos restantes antes del bloqueo: ${remaining}.`
          : "PIN incorrecto. La firma quedará bloqueada en el siguiente intento fallido.",
    });
  }

  const verifiedAt = new Date();

  // PIN correcto: resetear contador + caché de sesión + auditoría.
  await Promise.all([
    resetFailedAttempts(prisma, firma.id),
    insertSessionCache(prisma, firma.id, opts.userId),
    insertBitacora(prisma, {
      firmaId: firma.id,
      userId: opts.userId,
      accion: opts.accion,
      exito: true,
      contexto: opts.contexto,
      ip: opts.ip,
    }),
  ]);

  return { firmaId: firma.id, verifiedAt: verifiedAt.toISOString() };
}

// =============================================================================
// Router
// =============================================================================

export const firmaElectronicaRouter = router({
  /**
   * Crea el PIN inicial del personal de salud.
   * Requiere que `ece.personal_salud` ya tenga un registro con his_user_id = ctx.user.id.
   * Falla con CONFLICT si ya existe una firma activa.
   */
  setup: protectedProcedure
    .input(setupInput)
    .mutation(async ({ ctx, input }) => {
      const personal = await findPersonal(ctx.prisma, ctx.user.id);
      if (!personal) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No se encontró un profesional de salud asociado a su cuenta.",
        });
      }

      // Verificar que no exista ya una firma activa (revocada sí puede ser reemplazada).
      const existing = await findFirma(ctx.prisma, personal.id);
      if (existing && existing.revoked_at === null) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Ya existe una firma electrónica activa. Use firma.requestRecovery para cambiar el PIN.",
        });
      }

      const { hash, salt } = await hashPin(input.pin);

      try {
        await (ctx.prisma.$executeRaw as (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<number>)`
          INSERT INTO ece.firma_electronica
            (personal_id, pin_hash, salt_extra, last_rotated_at, failed_attempts, created_at)
          VALUES
            (${personal.id}::uuid, ${hash}, ${salt}, now(), 0, now())
          ON CONFLICT (personal_id) DO UPDATE
            SET pin_hash        = EXCLUDED.pin_hash,
                salt_extra      = EXCLUDED.salt_extra,
                last_rotated_at = now(),
                failed_attempts = 0,
                locked_until    = NULL,
                revoked_at      = NULL
        `;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[firma.setup] error al insertar:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "No se pudo crear la firma electrónica.",
        });
      }

      return { ok: true as const };
    }),

  /**
   * Valida el PIN del usuario.
   * Devuelve firmaId + timestamp para que el cliente pueda encadenar con confirm.
   * Registra en ece.bitacora_acceso y rellena ece.firma_session_cache (15 min).
   */
  verify: protectedProcedure
    .input(verifyInput)
    .mutation(async ({ ctx, input }) => {
      return checkPin(ctx.prisma, {
        userId: ctx.user.id,
        pin: input.pin,
        accion: "verify",
        contexto: input.context,
        ip: ctx.ip,
      });
    }),

  /**
   * Valida el PIN y emite una firma con contexto de recurso + acción.
   * Registra en ece.bitacora_acceso con el par recurso/acción firmado.
   */
  confirm: protectedProcedure
    .input(confirmInput)
    .mutation(async ({ ctx, input }) => {
      const contexto = `${input.resource}::${input.action}`;
      return checkPin(ctx.prisma, {
        userId: ctx.user.id,
        pin: input.pin,
        accion: "confirm",
        contexto,
        ip: ctx.ip,
      });
    }),

  /**
   * Solicita recuperación de PIN vía email.
   * Genera un token one-time de 32 bytes; almacena SOLO el hash SHA-256 en BD.
   * El token en claro se envía por email (implementación de email: @SRE / notificaciones).
   *
   * publicProcedure: el usuario no tiene sesión activa si olvidó el PIN.
   * Respuesta siempre OK para no revelar si el email existe (timing-safe).
   */
  requestRecovery: publicProcedure
    .input(requestRecoveryInput)
    .mutation(async ({ ctx, input }) => {
      const tokenPlain = generateRecoveryToken();
      const tokenHash = hashRecoveryToken(tokenPlain);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

      // Buscar el personal por email del usuario HIS asociado.
      const rows = await (ctx.prisma.$queryRaw as (
        query: TemplateStringsArray,
        ...values: unknown[]
      ) => Promise<Array<{ firma_id: string }>>)`
        SELECT fe.id AS firma_id
        FROM ece.firma_electronica fe
        JOIN ece.personal_salud ps ON ps.id = fe.personal_id
        JOIN public."User" u ON u.id = ps.his_user_id
        WHERE lower(u.email) = lower(${input.email})
          AND ps.activo = true
          AND fe.revoked_at IS NULL
        LIMIT 1
      `;

      const firmaId = rows[0]?.firma_id ?? null;

      if (firmaId) {
        // Persistir token hash (columna recovery_token_hash pendiente de migración SQL).
        await (ctx.prisma.$executeRaw as (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<number>)`
          UPDATE ece.firma_electronica
          SET recovery_token_hash = ${tokenHash},
              recovery_expires_at = ${expiresAt}::timestamptz
          WHERE id = ${firmaId}::uuid
        `;

        // TODO: delegar envío de email al dispatcher de notificaciones (@SRE / Beta.16).
        // notificationsDispatcher.sendFirmaRecovery({ email: input.email, token: tokenPlain });
        // eslint-disable-next-line no-console
        console.info(`[firma.requestRecovery] token generado para firmaId=${firmaId} (email no enviado en dev)`);
      }

      // Respuesta idéntica para email existente e inexistente.
      return {
        ok: true as const,
        message: "Si el correo está registrado, recibirá instrucciones de recuperación.",
      };
    }),

  /**
   * Completa la recuperación: valida token + MFA + establece nuevo PIN.
   *
   * publicProcedure: flujo pre-sesión.
   * MFA: se verifica que ctx contenga un OTP TOTP válido (o backup code).
   * La verificación de MFA se delega al mfaRouter.verify — aquí validamos
   * que el token de recovery sea válido y no expirado.
   */
  completeRecovery: publicProcedure
    .input(completeRecoveryInput)
    .mutation(async ({ ctx, input }) => {
      const tokenHash = hashRecoveryToken(input.token);

      const rows = await (ctx.prisma.$queryRaw as (
        query: TemplateStringsArray,
        ...values: unknown[]
      ) => Promise<Array<{ id: string; recovery_expires_at: Date }>>)`
        SELECT id, recovery_expires_at
        FROM ece.firma_electronica
        WHERE recovery_token_hash = ${tokenHash}
          AND recovery_expires_at > now()
          AND revoked_at IS NULL
        LIMIT 1
      `;

      const firmaRow = rows[0] ?? null;
      if (!firmaRow) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Token de recuperación inválido o expirado.",
        });
      }

      // Verificación MFA: el mfaCode debe ser un TOTP o backup code válido.
      // Aquí hacemos la verificación directamente via UserCredential para no
      // crear dependencia circular con mfaRouter (mismo proceso que mfa.verify).
      const firmaId = firmaRow.id;

      // Obtener el userId a partir de la firma.
      const userRows = await (ctx.prisma.$queryRaw as (
        query: TemplateStringsArray,
        ...values: unknown[]
      ) => Promise<Array<{ his_user_id: string | null }>>)`
        SELECT ps.his_user_id
        FROM ece.firma_electronica fe
        JOIN ece.personal_salud ps ON ps.id = fe.personal_id
        WHERE fe.id = ${firmaId}::uuid
        LIMIT 1
      `;

      const hisUserId = userRows[0]?.his_user_id ?? null;
      if (!hisUserId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "El profesional no tiene cuenta HIS vinculada.",
        });
      }

      // Validar MFA: buscar credencial TOTP y verificar código.
      const cred = await ctx.prisma.userCredential.findFirst({
        where: { userId: hisUserId, method: "TOTP" },
        orderBy: { createdAt: "desc" },
        select: { secretHash: true },
      });

      if (!cred) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "MFA no configurado. No es posible completar la recuperación.",
        });
      }

      // Descifrar credencial MFA y verificar el código provisto (TOTP o backup code).
      let mfaPlaintext: MfaPlaintext;
      try {
        mfaPlaintext = decryptMfaCredential(cred.secretHash);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[firma.completeRecovery] descifrado MFA falló:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "No se pudo leer la credencial MFA.",
        });
      }

      const mfaCode = input.mfaCode;

      if (mfaCode.length === 6) {
        if (!verifyTotpCode(mfaPlaintext.secret, mfaCode)) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Código MFA inválido o expirado.",
          });
        }
      } else if (mfaCode.length === 8) {
        if (!verifyBackupCode(mfaPlaintext.codes, mfaCode)) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Código de respaldo MFA inválido o ya utilizado.",
          });
        }
      } else {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Código MFA inválido. Debe tener 6 (TOTP) u 8 (respaldo) dígitos.",
        });
      }

      // Establecer nuevo PIN y limpiar token de recuperación.
      const { hash, salt } = await hashPin(input.newPin);

      try {
        await (ctx.prisma.$executeRaw as (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<number>)`
          UPDATE ece.firma_electronica
          SET pin_hash             = ${hash},
              salt_extra           = ${salt},
              last_rotated_at      = now(),
              failed_attempts      = 0,
              locked_until         = NULL,
              recovery_token_hash  = NULL,
              recovery_expires_at  = NULL
          WHERE id = ${firmaId}::uuid
        `;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[firma.completeRecovery] error al actualizar PIN:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "No se pudo actualizar el PIN.",
        });
      }

      return { ok: true as const, message: "PIN de firma actualizado correctamente." };
    }),
});
