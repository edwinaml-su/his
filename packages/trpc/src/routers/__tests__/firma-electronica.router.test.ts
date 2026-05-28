/**
 * Tests del firmaElectronicaRouter (Stream 18 — Firma Electrónica ECE).
 *
 * Cubre:
 *   - firma.setup: crea PIN, rechaza si ya existe firma activa.
 *   - firma.verify: PIN correcto devuelve firmaId+timestamp; PIN incorrecto UNAUTHORIZED;
 *     firma bloqueada TOO_MANY_REQUESTS; sin personal PRECONDITION_FAILED.
 *   - firma.confirm: mismo flujo que verify con contexto recurso::acción.
 *   - firma.requestRecovery: siempre devuelve ok (no revela si email existe).
 *   - firma.completeRecovery: token inválido UNAUTHORIZED; PIN actualizado en happy-path.
 *
 * Patrón: prisma mock con $queryRaw / $executeRaw stubbados,
 *   makeCtx con MOCK_USER_ADMIN, vitest-mock-extended para UserCredential.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { firmaElectronicaRouter } from "../firma-electronica.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_USER_ADMIN } from "@his/test-utils";
import { createHash, createCipheriv, randomBytes } from "node:crypto";

// Helper: genera un secretHash AES-256-GCM válido para tests usando AUTH_SECRET de prueba.
function makeTestSecretHash(payload: { secret: string; codes: string[] }): string {
  const key = createHash("sha256")
    .update(process.env.AUTH_SECRET ?? "test-auth-secret-32-chars-minimum!", "utf8")
    .digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const pt = JSON.stringify(payload);
  const ct = Buffer.concat([cipher.update(pt, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: 1,
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    ct: ct.toString("hex"),
    createdAt: new Date().toISOString(),
  });
}

// Mock argon2 para evitar bcrypt real en unit tests (demasiado lento + sin salt fijo).
vi.mock("@his/infrastructure", () => ({
  argon2: {
    argon2id: 2,
    hash: vi.fn().mockResolvedValue("$argon2id$test$hash"),
    verify: vi.fn().mockResolvedValue(true),
  },
}));

const PERSONAL_ID = "11111111-1111-1111-1111-111111111111";
const FIRMA_ID = "22222222-2222-2222-2222-222222222222";
const VALID_PIN = "123456";
const VALID_TOKEN = "a".repeat(64); // 32 bytes hex

function makeFirmaRow(overrides: Partial<{
  locked_until: Date | null;
  failed_attempts: number;
  revoked_at: Date | null;
}> = {}) {
  return {
    id: FIRMA_ID,
    personal_id: PERSONAL_ID,
    pin_hash: "$argon2id$test$hash",
    salt_extra: "aabbcc",
    failed_attempts: overrides.failed_attempts ?? 0,
    locked_until: overrides.locked_until ?? null,
    revoked_at: overrides.revoked_at ?? null,
  };
}

describe("firmaElectronicaRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(async () => {
    prisma = mockDeep<PrismaClient>();
    vi.clearAllMocks();
    // AUTH_SECRET requerida por getMfaEncryptionKey en el router.
    process.env.AUTH_SECRET = "test-auth-secret-32-chars-minimum!";
    // Re-establecer implementaciones por defecto después de clearAllMocks.
    const { argon2 } = await import("@his/infrastructure");
    vi.mocked(argon2.hash).mockResolvedValue("$argon2id$test$hash");
    vi.mocked(argon2.verify).mockResolvedValue(true);
  });

  // ---------------------------------------------------------------------------
  // firma.setup
  // ---------------------------------------------------------------------------
  describe("setup", () => {
    it("happy-path: crea la firma y devuelve ok:true", async () => {
      // personal_salud encontrado
      prisma.$queryRaw.mockResolvedValueOnce([{ id: PERSONAL_ID }]);
      // firma existente: ninguna
      prisma.$queryRaw.mockResolvedValueOnce([]);
      // INSERT firma
      prisma.$executeRaw.mockResolvedValueOnce(1);

      const caller = firmaElectronicaRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.setup({ pin: VALID_PIN, confirmPin: VALID_PIN });

      expect(result.ok).toBe(true);
      expect(prisma.$executeRaw).toHaveBeenCalledOnce();
    });

    it("rechaza si ya existe firma activa (CONFLICT)", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ id: PERSONAL_ID }]);
      prisma.$queryRaw.mockResolvedValueOnce([makeFirmaRow()]);

      const caller = firmaElectronicaRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.setup({ pin: VALID_PIN, confirmPin: VALID_PIN }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("rechaza si PINs no coinciden (BAD_REQUEST vía Zod)", async () => {
      const caller = firmaElectronicaRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.setup({ pin: VALID_PIN, confirmPin: "654321" }),
      ).rejects.toThrow();
    });

    it("rechaza si no hay personal asociado (PRECONDITION_FAILED)", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const caller = firmaElectronicaRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.setup({ pin: VALID_PIN, confirmPin: VALID_PIN }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });
  });

  // ---------------------------------------------------------------------------
  // firma.verify
  // ---------------------------------------------------------------------------
  describe("verify", () => {
    it("happy-path: PIN correcto devuelve firmaId y verifiedAt", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ id: PERSONAL_ID }]);
      prisma.$queryRaw.mockResolvedValueOnce([makeFirmaRow()]);
      prisma.$executeRaw.mockResolvedValue(1); // reset + cache + bitacora

      const caller = firmaElectronicaRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.verify({ pin: VALID_PIN });

      expect(result.firmaId).toBe(FIRMA_ID);
      expect(result.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("PIN incorrecto devuelve UNAUTHORIZED", async () => {
      const { argon2 } = await import("@his/infrastructure");
      vi.mocked(argon2.verify).mockResolvedValueOnce(false);

      prisma.$queryRaw.mockResolvedValueOnce([{ id: PERSONAL_ID }]);
      prisma.$queryRaw.mockResolvedValueOnce([makeFirmaRow()]);
      prisma.$executeRaw.mockResolvedValue(1);

      const caller = firmaElectronicaRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.verify({ pin: VALID_PIN })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });

    it("firma bloqueada devuelve TOO_MANY_REQUESTS", async () => {
      const futureDate = new Date(Date.now() + 5 * 60 * 1000);
      prisma.$queryRaw.mockResolvedValueOnce([{ id: PERSONAL_ID }]);
      prisma.$queryRaw.mockResolvedValueOnce([
        makeFirmaRow({ locked_until: futureDate }),
      ]);

      const caller = firmaElectronicaRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.verify({ pin: VALID_PIN })).rejects.toMatchObject({
        code: "TOO_MANY_REQUESTS",
      });
    });

    it("firma revocada devuelve FORBIDDEN", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ id: PERSONAL_ID }]);
      prisma.$queryRaw.mockResolvedValueOnce([
        makeFirmaRow({ revoked_at: new Date("2024-01-01") }),
      ]);

      const caller = firmaElectronicaRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.verify({ pin: VALID_PIN })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("sin firma configurada devuelve PRECONDITION_FAILED", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ id: PERSONAL_ID }]);
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const caller = firmaElectronicaRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.verify({ pin: VALID_PIN })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
    });
  });

  // ---------------------------------------------------------------------------
  // firma.confirm
  // ---------------------------------------------------------------------------
  describe("confirm", () => {
    it("happy-path: devuelve firmaId con contexto recurso::acción", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ id: PERSONAL_ID }]);
      prisma.$queryRaw.mockResolvedValueOnce([makeFirmaRow()]);
      prisma.$executeRaw.mockResolvedValue(1);

      const caller = firmaElectronicaRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.confirm({
        pin: VALID_PIN,
        resource: "historia_clinica",
        action: "firma_nota_evolucion",
      });

      expect(result.firmaId).toBe(FIRMA_ID);
    });
  });

  // ---------------------------------------------------------------------------
  // firma.requestRecovery
  // ---------------------------------------------------------------------------
  describe("requestRecovery", () => {
    it("devuelve ok:true aunque el email no exista (no revela existencia)", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]); // email no encontrado
      prisma.$executeRaw.mockResolvedValue(0);

      const caller = firmaElectronicaRouter.createCaller(
        makeCtx({ prisma, user: null }),
      );
      const result = await caller.requestRecovery({
        email: "noexiste@example.com",
      });

      expect(result.ok).toBe(true);
      expect(result.message).toContain("Si el correo");
    });

    it("devuelve ok:true y persiste token si el email existe", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ firma_id: FIRMA_ID }]);
      prisma.$executeRaw.mockResolvedValueOnce(1);

      const caller = firmaElectronicaRouter.createCaller(
        makeCtx({ prisma, user: null }),
      );
      const result = await caller.requestRecovery({
        email: MOCK_USER_ADMIN.email,
      });

      expect(result.ok).toBe(true);
      expect(prisma.$executeRaw).toHaveBeenCalledOnce();
    });
  });

  // ---------------------------------------------------------------------------
  // firma.completeRecovery
  // ---------------------------------------------------------------------------
  describe("completeRecovery", () => {
    it("token inválido devuelve UNAUTHORIZED", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]); // token no encontrado

      const caller = firmaElectronicaRouter.createCaller(
        makeCtx({ prisma, user: null }),
      );
      await expect(
        caller.completeRecovery({
          token: VALID_TOKEN,
          mfaCode: "123456",
          newPin: VALID_PIN,
          confirmPin: VALID_PIN,
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("happy-path: actualiza PIN y limpia token de recuperación", async () => {
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      // Credencial con backup code "12345678" para que MFA sea determinístico en tests.
      const testSecretHash = makeTestSecretHash({ secret: "JBSWY3DPEHPK3PXP", codes: ["12345678"] });

      // token encontrado
      prisma.$queryRaw.mockResolvedValueOnce([
        { id: FIRMA_ID, recovery_expires_at: expiresAt },
      ]);
      // his_user_id del personal
      prisma.$queryRaw.mockResolvedValueOnce([
        { his_user_id: MOCK_USER_ADMIN.id },
      ]);
      // UserCredential con secretHash encriptado correctamente
      prisma.userCredential.findFirst.mockResolvedValueOnce({
        id: "cred-id-1",
        secretHash: testSecretHash,
      } as never);
      // userCredential.update (consumir backup code)
      prisma.userCredential.update.mockResolvedValue({} as never);
      // UPDATE firma
      prisma.$executeRaw.mockResolvedValueOnce(1);

      const caller = firmaElectronicaRouter.createCaller(
        makeCtx({ prisma, user: null }),
      );
      const result = await caller.completeRecovery({
        token: VALID_TOKEN,
        mfaCode: "12345678",  // backup code — determinístico (no TOTP time-sensitive)
        newPin: VALID_PIN,
        confirmPin: VALID_PIN,
      });

      expect(result.ok).toBe(true);
      expect(prisma.$executeRaw).toHaveBeenCalledOnce();
    });

    it("rechaza código TOTP dummy '000000' cuando el secret no lo produce (HG-24 regresión)", async () => {
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      // Secret cuyo código TOTP actual NO es "000000" con probabilidad prácticamente 1.
      // JBSWY3DPEHPK3PXP (well-known test secret) — generar código real tomaría
      // conocer el timestamp exacto; usar un código inválido es suficiente para
      // verificar que el check no es dummy.
      const testSecretHash = makeTestSecretHash({ secret: "JBSWY3DPEHPK3PXP", codes: [] });

      prisma.$queryRaw.mockResolvedValueOnce([
        { id: FIRMA_ID, recovery_expires_at: expiresAt },
      ]);
      prisma.$queryRaw.mockResolvedValueOnce([
        { his_user_id: MOCK_USER_ADMIN.id },
      ]);
      prisma.userCredential.findFirst.mockResolvedValueOnce({
        id: "cred-id-1",
        secretHash: testSecretHash,
      } as never);

      const caller = firmaElectronicaRouter.createCaller(
        makeCtx({ prisma, user: null }),
      );
      // "000000" es el código canónico de un MFA dummy — el router DEBE rechazarlo.
      await expect(
        caller.completeRecovery({
          token: VALID_TOKEN,
          mfaCode: "000000",
          newPin: VALID_PIN,
          confirmPin: VALID_PIN,
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("sin MFA configurado devuelve PRECONDITION_FAILED", async () => {
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      prisma.$queryRaw.mockResolvedValueOnce([
        { id: FIRMA_ID, recovery_expires_at: expiresAt },
      ]);
      prisma.$queryRaw.mockResolvedValueOnce([
        { his_user_id: MOCK_USER_ADMIN.id },
      ]);
      prisma.userCredential.findFirst.mockResolvedValueOnce(null);

      const caller = firmaElectronicaRouter.createCaller(
        makeCtx({ prisma, user: null }),
      );
      await expect(
        caller.completeRecovery({
          token: VALID_TOKEN,
          mfaCode: "123456",
          newPin: VALID_PIN,
          confirmPin: VALID_PIN,
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });
  });
});
