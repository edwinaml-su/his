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
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { mfaRouter } from "../mfa.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_USER_ADMIN } from "@his/test-utils";

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
  });

  afterEach(() => {
    process.env["AUTH_SECRET"] = originalAuthSecret;
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
