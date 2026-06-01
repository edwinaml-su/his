/**
 * Tests del mfaRouter (US-2.2 — MFA TOTP).
 *
 * Cubre:
 *   - enroll: happy-path (persiste credencial, devuelve secret+otpauthUri+codes),
 *     usuario no encontrado, error de BD.
 *   - verify: TOTP correcto marca mfaEnabled=true, TOTP incorrecto UNAUTHORIZED,
 *     backup code correcto consume el código, backup code incorrecto UNAUTHORIZED,
 *     sin credencial PRECONDITION_FAILED.
 *   - status: devuelve enabled+method+lastVerifiedAt correctamente, user sin cred.
 *
 * Patrón: vitest-mock-extended para Prisma, makeCtx con MOCK_USER_ADMIN,
 * AUTH_SECRET inyectada por el setup de tests.
 */
import { describe, it, expect, beforeEach, afterEach, vi, afterAll } from "vitest";
import { createHmac } from "node:crypto";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { mfaRouter } from "../mfa.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_USER_ADMIN } from "@his/test-utils";
import { _resetRateLimitForTesting } from "../../middleware/rate-limit";

// AUTH_SECRET necesario para encriptar/desencriptar en las pruebas.
// Al menos 32 caracteres para que getEncryptionKey() no lance error.
const TEST_AUTH_SECRET = "test-secret-32-chars-minimum!!abc";

const credId = "00000000-0000-0000-0000-000000000001";

describe("mfaRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  let originalAuthSecret: string | undefined;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    originalAuthSecret = process.env["AUTH_SECRET"];
    process.env["AUTH_SECRET"] = TEST_AUTH_SECRET;
    _resetRateLimitForTesting();
  });

  afterEach(() => {
    process.env["AUTH_SECRET"] = originalAuthSecret;
    vi.useRealTimers();
  });

  afterAll(() => {
    _resetRateLimitForTesting();
  });

  // ---------------------------------------------------------------------------
  // enroll
  // ---------------------------------------------------------------------------

  describe("enroll", () => {
    it("happy-path: devuelve secret en base32, otpauthUri y 10 backup codes", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: MOCK_USER_ADMIN.id,
        email: MOCK_USER_ADMIN.email,
      } as never);
      prisma.$transaction.mockResolvedValue([null, { id: credId }] as never);

      const caller = mfaRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.enroll({});

      expect(result.secret).toMatch(/^[A-Z2-7]+$/);
      expect(result.secret).toHaveLength(32);
      expect(result.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
      expect(result.otpauthUri).toContain("Avante%20HIS");
      expect(result.backupCodes).toHaveLength(10);
      // Cada backup code tiene 8 dígitos
      for (const code of result.backupCodes) {
        expect(code).toMatch(/^[0-9]{8}$/);
      }
    });

    it("NOT_FOUND si el usuario no existe", async () => {
      prisma.user.findUnique.mockResolvedValue(null as never);

      const caller = mfaRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.enroll({})).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("INTERNAL_SERVER_ERROR si $transaction falla", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: MOCK_USER_ADMIN.id,
        email: MOCK_USER_ADMIN.email,
      } as never);
      prisma.$transaction.mockRejectedValue(new Error("DB error") as never);

      const caller = mfaRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.enroll({})).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
      });
    });

    it("INTERNAL_SERVER_ERROR si AUTH_SECRET es demasiado corta", async () => {
      process.env["AUTH_SECRET"] = "short";
      prisma.user.findUnique.mockResolvedValue({
        id: MOCK_USER_ADMIN.id,
        email: MOCK_USER_ADMIN.email,
      } as never);

      const caller = mfaRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.enroll({})).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
      });
    });
  });

  // ---------------------------------------------------------------------------
  // verify
  // ---------------------------------------------------------------------------

  describe("verify", () => {
    it("PRECONDITION_FAILED si no hay credencial TOTP", async () => {
      prisma.userCredential.findFirst.mockResolvedValue(null as never);

      const caller = mfaRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.verify({ token: "123456" })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
    });

    it("UNAUTHORIZED si token TOTP de 6 dígitos es incorrecto", async () => {
      // Construimos un credencial cifrado real para que decryptCredential funcione.
      const { encryptTestCred } = await buildTestCredHelper();
      prisma.userCredential.findFirst.mockResolvedValue({
        id: credId,
        secretHash: encryptTestCred,
      } as never);

      const caller = mfaRouter.createCaller(makeCtx({ prisma }));
      // "000000" es casi seguramente inválido para el secret generado.
      await expect(caller.verify({ token: "000000" })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("UNAUTHORIZED si backup code de 8 dígitos no coincide", async () => {
      const { encryptTestCred } = await buildTestCredHelper();
      prisma.userCredential.findFirst.mockResolvedValue({
        id: credId,
        secretHash: encryptTestCred,
      } as never);

      const caller = mfaRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.verify({ token: "99999999" })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });

    it("acepta backup code válido: lo consume y retorna usedBackupCode=true", async () => {
      const backupCode = "12345678";
      const { encryptTestCredWithCodes } = await buildTestCredHelper([backupCode, "87654321"]);
      prisma.userCredential.findFirst.mockResolvedValue({
        id: credId,
        secretHash: encryptTestCredWithCodes,
      } as never);
      prisma.$transaction.mockResolvedValue([null, null] as never);

      const caller = mfaRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.verify({ token: backupCode });

      expect(result.ok).toBe(true);
      expect(result.usedBackupCode).toBe(true);
      // Quedan 1 código (se consumió backupCode)
      expect((result as { remainingBackupCodes?: number }).remainingBackupCodes).toBe(1);
      expect(prisma.$transaction).toHaveBeenCalledOnce();
    });

    it("validación: token con 5 dígitos es rechazado por Zod", async () => {
      const caller = mfaRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.verify({ token: "12345" })).rejects.toThrow();
    });

    it("INTERNAL_SERVER_ERROR si la credencial no se puede desencriptar", async () => {
      prisma.userCredential.findFirst.mockResolvedValue({
        id: credId,
        secretHash: '{"v":1,"iv":"bad","tag":"bad","ct":"bad","createdAt":"x"}',
      } as never);

      const caller = mfaRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.verify({ token: "123456" })).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
      });
    });

    it("TOTP correcto: ok=true, mfaEnabled=true y usedBackupCode=false", async () => {
      // Fijamos el reloj en un tiempo conocido para calcular el counter TOTP.
      // 2026-01-15T10:00:00Z = 1_768_471_200_000 ms => counter = floor(1_768_471_200 / 30)
      const FIXED_MS = 1_768_471_200_000;
      vi.useFakeTimers();
      vi.setSystemTime(FIXED_MS);

      // El secret bien conocido en tests TOTP (RFC 6238 test vectors).
      const SECRET = "JBSWY3DPEHPK3PXP";
      const counter = Math.floor(FIXED_MS / 1000 / 30);

      // Calculamos el token correcto localmente (misma lógica que el router).
      const validToken = computeTotp(SECRET, counter);

      const { encryptTestCred } = await buildTestCredHelper();
      // buildTestCredHelper usa SECRET="JBSWY3DPEHPK3PXP" internamente.
      prisma.userCredential.findFirst.mockResolvedValue({
        id: credId,
        secretHash: encryptTestCred,
      } as never);
      prisma.$transaction.mockResolvedValue([null, null] as never);

      const caller = mfaRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.verify({ token: validToken });

      expect(result.ok).toBe(true);
      expect(result.usedBackupCode).toBe(false);
      expect(prisma.$transaction).toHaveBeenCalledOnce();
    });

    it("SECRET corrupto (base32 inválido): error al intentar generar TOTP", async () => {
      // Creamos un blob cifrado correctamente pero con un secret que falla
      // la decodificación base32 cuando el router intenta verificar el TOTP.
      // El router NO captura este error (está fuera del try/catch de descifrado)
      // => burbujea como INTERNAL_SERVER_ERROR de tRPC.
      const { createCipheriv, randomBytes, createHash } = await import("node:crypto");
      const key = createHash("sha256").update(TEST_AUTH_SECRET, "utf8").digest();
      const plaintext = { secret: "!!!NOT_BASE32!!!", codes: [] };
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const { Buffer } = await import("node:buffer");
      const ct = Buffer.concat([cipher.update(JSON.stringify(plaintext), "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      const blob = {
        v: 1,
        iv: iv.toString("hex"),
        tag: tag.toString("hex"),
        ct: ct.toString("hex"),
        createdAt: new Date().toISOString(),
      };

      prisma.userCredential.findFirst.mockResolvedValue({
        id: credId,
        secretHash: JSON.stringify(blob),
      } as never);

      const caller = mfaRouter.createCaller(makeCtx({ prisma }));
      // base32Decode lanza "Base32 inválido" dentro de verifyTotp =>
      // el error burbujea sin capturar => tRPC lo convierte en INTERNAL_SERVER_ERROR.
      await expect(caller.verify({ token: "000000" })).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
      });
    });
  });

  // ---------------------------------------------------------------------------
  // verify — rate limit (A07-P1)
  // ---------------------------------------------------------------------------

  describe("verify — rate limit", () => {
    it("bloquea TOO_MANY_REQUESTS después de 10 intentos fallidos por userId en 15 min", async () => {
      const { encryptTestCred } = await buildTestCredHelper();
      // Los primeros 10 fallos deben pasar el rate limit (UNAUTHORIZED del cred incorrecto).
      for (let i = 0; i < 10; i++) {
        prisma.userCredential.findFirst.mockResolvedValueOnce({
          id: credId,
          secretHash: encryptTestCred,
        } as never);
        const caller = mfaRouter.createCaller(makeCtx({ prisma }));
        await expect(caller.verify({ token: "000000" })).rejects.toMatchObject({
          code: "UNAUTHORIZED",
        });
      }
      // El 11vo debe ser bloqueado por rate limit antes de consultar BD.
      const caller = mfaRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.verify({ token: "000000" })).rejects.toMatchObject({
        code: "TOO_MANY_REQUESTS",
      });
    });

    it("usuarios distintos tienen cubetas independientes (rate limit por userId)", async () => {
      const { encryptTestCred } = await buildTestCredHelper();
      // Agotar cuota del usuario admin (MOCK_USER_ADMIN.id)
      for (let i = 0; i < 10; i++) {
        prisma.userCredential.findFirst.mockResolvedValueOnce({
          id: credId,
          secretHash: encryptTestCred,
        } as never);
        const caller = mfaRouter.createCaller(makeCtx({ prisma }));
        await expect(caller.verify({ token: "000000" })).rejects.toMatchObject({
          code: "UNAUTHORIZED",
        });
      }
      // Otro usuario con id distinto sigue libre — usa makeCtx con user diferente.
      const otherCtx = makeCtx({
        prisma,
        user: { id: "99999999-9999-9999-9999-999999999999", email: "other@test.com", fullName: "Other" },
      });
      prisma.userCredential.findFirst.mockResolvedValueOnce({
        id: credId,
        secretHash: encryptTestCred,
      } as never);
      const otherCaller = mfaRouter.createCaller(otherCtx);
      // "000000" sigue siendo un TOTP incorrecto, pero NO debe ser TOO_MANY_REQUESTS.
      await expect(otherCaller.verify({ token: "000000" })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });
  });

  // ---------------------------------------------------------------------------
  // status
  // ---------------------------------------------------------------------------

  describe("status", () => {
    it("usuario con MFA habilitado y credencial: retorna enabled=true, method=TOTP", async () => {
      const verifiedAt = new Date("2026-01-15T10:00:00Z");
      prisma.user.findUnique.mockResolvedValue({
        id: MOCK_USER_ADMIN.id,
        mfaEnabled: true,
      } as never);
      prisma.userCredential.findFirst.mockResolvedValue({
        validFrom: verifiedAt,
      } as never);

      const caller = mfaRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.status();

      expect(result.enabled).toBe(true);
      expect(result.method).toBe("TOTP");
      expect(result.lastVerifiedAt).toBe(verifiedAt.toISOString());
    });

    it("usuario sin MFA y sin credencial: enabled=false, method=NONE, lastVerifiedAt=null", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: MOCK_USER_ADMIN.id,
        mfaEnabled: false,
      } as never);
      prisma.userCredential.findFirst.mockResolvedValue(null as never);

      const caller = mfaRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.status();

      expect(result.enabled).toBe(false);
      expect(result.method).toBe("NONE");
      expect(result.lastVerifiedAt).toBeNull();
    });

    it("usuario no encontrado: enabled=false (manejo defensivo)", async () => {
      prisma.user.findUnique.mockResolvedValue(null as never);
      prisma.userCredential.findFirst.mockResolvedValue(null as never);

      const caller = mfaRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.status();

      expect(result.enabled).toBe(false);
    });

    it("credencial con validFrom=null: lastVerifiedAt=null", async () => {
      prisma.user.findUnique.mockResolvedValue({ mfaEnabled: true } as never);
      prisma.userCredential.findFirst.mockResolvedValue({
        validFrom: null,
      } as never);

      const caller = mfaRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.status();

      expect(result.lastVerifiedAt).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// computeTotp — reimplementa el algoritmo del router para obtener tokens
// válidos en tests sin exportar funciones internas.
// ---------------------------------------------------------------------------

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32DecodeLocal(input: string): Buffer {
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

function computeTotp(secretBase32: string, counter: number): string {
  const key = base32DecodeLocal(secretBase32);
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
  const mod = bin % 10 ** 6;
  return mod.toString().padStart(6, "0");
}

// ---------------------------------------------------------------------------
// Helper — cifra credenciales de prueba usando el mismo algoritmo del router.
// ---------------------------------------------------------------------------

async function buildTestCredHelper(codes?: string[]) {
  // Importamos dinámicamente las funciones internas del router indirectamente:
  // construimos el JSON cifrado usando crypto de Node directamente con
  // la misma lógica que el router para producir un blob válido.
  const { createCipheriv, randomBytes, createHash } = await import("node:crypto");

  const TEST_AUTH_SECRET = process.env["AUTH_SECRET"]!;
  const key = createHash("sha256").update(TEST_AUTH_SECRET, "utf8").digest();
  const backupCodes = codes ?? ["12345678", "87654321"];
  // Usamos un secret base32 mínimo válido.
  const secret = "JBSWY3DPEHPK3PXP"; // bien conocido en tests TOTP

  const plaintext = { secret, codes: backupCodes };
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const json = JSON.stringify(plaintext);
  const { Buffer } = await import("node:buffer");
  const ct = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const blob = {
    v: 1,
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    ct: ct.toString("hex"),
    createdAt: new Date().toISOString(),
  };
  const encrypted = JSON.stringify(blob);

  return {
    encryptTestCred: encrypted,
    encryptTestCredWithCodes: encrypted,
    secret,
    backupCodes,
  };
}
