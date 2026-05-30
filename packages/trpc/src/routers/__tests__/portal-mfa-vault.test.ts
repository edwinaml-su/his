// @ts-nocheck
/**
 * Tests: migración MFA secret a Supabase Vault (BD-P0-6, Sprint 4).
 *
 * Cubre:
 *   - enableMfa escribe a Vault ($executeRaw set_portal_mfa_secret_vault),
 *     NO escribe mfaSecret en claro.
 *   - verifyMfa lee desde Vault (path feliz).
 *   - verifyMfa retorna PRECONDITION_FAILED si Vault retorna null Y mfaSecret es null.
 *   - verifyMfa fallback: si Vault retorna null, usa decryptSecret(mfaSecret) legado.
 *   - verifyLogin path Vault con TOTP correcto.
 *   - verifyLogin retorna INTERNAL_SERVER_ERROR si Vault null + mfaSecret null.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import { portalRouter } from "../portal.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { createHash, createCipheriv, createHmac, randomBytes } from "node:crypto";

const PA = "00000000-0000-0000-0000-000000000pa2";
const PT = "00000000-0000-0000-0000-000000000pt3";
const EM = "vault@test.com";

const pc = (prisma) =>
  makeCtx({ prisma, user: null, tenant: null, portalAccount: { id: PA, patientId: PT, email: EM } });
const pub = (prisma) =>
  makeCtx({ prisma, user: null, tenant: null });

// Genera secret TOTP en claro (base32) y su código válido en t=now.
function makeValidTotp(secretBase32: string): string {
  const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const b32d = (s: string): Buffer => {
    const c = s.toUpperCase().replace(/=+$/, "");
    let b = 0, v = 0;
    const o: number[] = [];
    for (const ch of c) {
      const idx = B32.indexOf(ch);
      if (idx === -1) continue;
      v = (v << 5) | idx;
      b += 5;
      if (b >= 8) { o.push((v >>> (b - 8)) & 0xff); b -= 8; }
    }
    return Buffer.from(o);
  };
  const key = b32d(secretBase32);
  const ctr = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(ctr / 0x1_0000_0000), 0);
  buf.writeUInt32BE(ctr & 0xffffffff, 4);
  const h = createHmac("sha1", key).update(buf).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin =
    ((h[off] & 0x7f) << 24) | ((h[off + 1] & 0xff) << 16) |
    ((h[off + 2] & 0xff) << 8) | (h[off + 3] & 0xff);
  return (bin % 1_000_000).toString().padStart(6, "0");
}

// Genera un mfaSecret cifrado con app-layer (legado) para tests de fallback.
function makeAppLayerSecret(secretBase32: string): string {
  const key = createHash("sha256").update(`portal-mfa:test-secret-minimum-32-chars-xxxx`).digest();
  const iv = randomBytes(12);
  const ci = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([ci.update(secretBase32, "utf8"), ci.final()]);
  return JSON.stringify({
    v: 1,
    iv: iv.toString("hex"),
    tag: ci.getAuthTag().toString("hex"),
    ct: ct.toString("hex"),
  });
}

// ─── enableMfa ───────────────────────────────────────────────────────────────

describe("portal.account.enableMfa — Vault path (BD-P0-6)", () => {
  let prisma;
  beforeEach(() => {
    prisma = mockDeep();
    process.env.AUTH_SECRET = "test-secret-minimum-32-chars-xxxx";
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  it("llama $executeRaw con set_portal_mfa_secret_vault", async () => {
    prisma.portalAccount.findUnique.mockResolvedValue({ id: PA, email: EM, mfaEnabled: false });
    // $executeRaw retorna bigint/number (se ignora el valor en el router).
    prisma.$executeRaw.mockResolvedValue(1n);
    prisma.portalAccount.update.mockResolvedValue({});

    const r = await portalRouter.createCaller(pc(prisma)).account.enableMfa({});

    expect(r.secretForManualEntry).toHaveLength(32);
    expect(r.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    // Vault write DEBE haberse llamado.
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    // El update de Prisma no debe incluir mfaSecret (no escribe en claro).
    const updateCall = prisma.portalAccount.update.mock.calls[0]?.[0];
    expect(updateCall?.data).not.toHaveProperty("mfaSecret");
    expect(updateCall?.data).toMatchObject({ mfaEnabled: false });
  });

  it("retorna secretForManualEntry como base32 de 32 chars", async () => {
    prisma.portalAccount.findUnique.mockResolvedValue({ id: PA, email: EM, mfaEnabled: false });
    prisma.$executeRaw.mockResolvedValue(1n);
    prisma.portalAccount.update.mockResolvedValue({});

    const r = await portalRouter.createCaller(pc(prisma)).account.enableMfa({});
    // 20 bytes → 32 chars base32.
    expect(r.secretForManualEntry).toMatch(/^[A-Z2-7]{32}$/);
  });

  it("NOT_FOUND si cuenta no existe", async () => {
    prisma.portalAccount.findUnique.mockResolvedValue(null);
    await expect(
      portalRouter.createCaller(pc(prisma)).account.enableMfa({}),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // No debe llamar $executeRaw si no existe la cuenta.
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
});

// ─── verifyMfa ───────────────────────────────────────────────────────────────

describe("portal.account.verifyMfa — Vault path (BD-P0-6)", () => {
  let prisma;
  const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PX";

  beforeEach(() => {
    prisma = mockDeep();
    process.env.AUTH_SECRET = "test-secret-minimum-32-chars-xxxx";
  });

  it("happy path: lee desde Vault y habilita MFA", async () => {
    // Vault retorna el secret en claro.
    prisma.$queryRaw.mockResolvedValue([{ get_portal_mfa_secret: SECRET }]);
    prisma.portalAccount.update.mockResolvedValue({});
    const code = makeValidTotp(SECRET);

    const r = await portalRouter.createCaller(pc(prisma)).account.verifyMfa({ code });

    expect(r).toEqual({ enabled: true });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    // NO debe leer mfaSecret (findUnique no debe llamarse).
    expect(prisma.portalAccount.findUnique).not.toHaveBeenCalled();
  });

  it("PRECONDITION_FAILED si Vault retorna null y mfaSecret también null", async () => {
    // Vault retorna null → no hay Vault secret.
    prisma.$queryRaw.mockResolvedValue([{ get_portal_mfa_secret: null }]);
    // Fallback: account sin mfaSecret tampoco.
    prisma.portalAccount.findUnique.mockResolvedValue({ id: PA, mfaSecret: null });

    await expect(
      portalRouter.createCaller(pc(prisma)).account.verifyMfa({ code: "123456" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("fallback app-layer: Vault null → usa decryptSecret(mfaSecret)", async () => {
    // Vault retorna null.
    prisma.$queryRaw.mockResolvedValue([{ get_portal_mfa_secret: null }]);
    // Fallback: account con mfaSecret cifrado (app-layer legado).
    const enc = makeAppLayerSecret(SECRET);
    prisma.portalAccount.findUnique.mockResolvedValue({ id: PA, mfaSecret: enc });
    prisma.portalAccount.update.mockResolvedValue({});
    const code = makeValidTotp(SECRET);

    const r = await portalRouter.createCaller(pc(prisma)).account.verifyMfa({ code });
    expect(r).toEqual({ enabled: true });
  });

  it("UNAUTHORIZED con código TOTP incorrecto (Vault path)", async () => {
    prisma.$queryRaw.mockResolvedValue([{ get_portal_mfa_secret: SECRET }]);

    await expect(
      portalRouter.createCaller(pc(prisma)).account.verifyMfa({ code: "000000" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

// ─── verifyLogin MFA branch ───────────────────────────────────────────────────

describe("portal.auth.verifyLogin — MFA Vault path (BD-P0-6)", () => {
  let prisma;
  const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PX";
  const PA_ID = "00000000-0000-0000-0000-000000000pa2";

  const baseLink = {
    id: "link1",
    accountId: PA_ID,
    purpose: "LOGIN",
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
  };

  beforeEach(() => {
    prisma = mockDeep();
    process.env.AUTH_SECRET = "test-secret-minimum-32-chars-xxxx";
  });

  it("happy path MFA via Vault: totpCode correcto crea sesión", async () => {
    prisma.portalMagicLink.findUnique.mockResolvedValue({
      ...baseLink,
      account: {
        id: PA_ID,
        patientId: PT,
        email: EM,
        status: "ACTIVE",
        mfaEnabled: true,
        mfaSecret: null,       // Vault path → mfaSecret en claro es null.
        lockedUntil: null,
        failedLoginAttempts: 0,
      },
    });
    // Vault retorna secret en claro.
    prisma.$queryRaw.mockResolvedValue([{ get_portal_mfa_secret: SECRET }]);
    // tx mock
    prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
    prisma.$executeRawUnsafe.mockResolvedValue(undefined);
    prisma.portalMagicLink.update.mockResolvedValue({});
    prisma.portalSession.create.mockResolvedValue({});
    prisma.portalAccount.update.mockResolvedValue({});

    const code = makeValidTotp(SECRET);
    const r = await portalRouter.createCaller(pub(prisma)).auth.verifyLogin({
      token: "t",
      totpCode: code,
    });

    expect(r).toHaveProperty("token");
    expect(r).toHaveProperty("expiresAt");
  });

  it("INTERNAL_SERVER_ERROR si Vault null + mfaSecret null (MFA inconsistente)", async () => {
    prisma.portalMagicLink.findUnique.mockResolvedValue({
      ...baseLink,
      account: {
        id: PA_ID,
        patientId: PT,
        email: EM,
        status: "ACTIVE",
        mfaEnabled: true,
        mfaSecret: null,
        lockedUntil: null,
        failedLoginAttempts: 0,
      },
    });
    // Vault también null → inconsistencia.
    prisma.$queryRaw.mockResolvedValue([{ get_portal_mfa_secret: null }]);

    await expect(
      portalRouter.createCaller(pub(prisma)).auth.verifyLogin({
        token: "t",
        totpCode: "123456",
      }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});
