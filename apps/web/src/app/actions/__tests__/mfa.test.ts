/**
 * R4.5 — regresión del P0 de review: `verifyMfa()` (apps/web/src/app/actions/mfa.ts)
 * llama a `markMfaSession()`, que hasta este fix invocaba `readMfaPolicy()` SIN
 * el switch de organización (tercer call site, el único que quedó env-only).
 *
 * Escenario exacto que causaba el bug: `Organization.mfaStaffRequired = true`
 * pero `MFA_REQUIRED_ROLE_CODES` vacío (el estado real de prod hoy, ver
 * mfa-session.ts). Sin el fix, `readMfaPolicy()` resolvía `{mode: "off"}`
 * (ignora el switch de org) → el TOTP se verificaba con éxito pero la cookie
 * de sesión MFA nunca se emitía → el layout volvía a redirigir a `/mfa` →
 * loop infinito, bloqueo total del staff de esa organización.
 *
 * Réplica del algoritmo TOTP/AES-GCM de `mfa.ts` en este archivo: las
 * funciones de cripto son privadas (el módulo es `"use server"`, solo puede
 * exportar server actions async), así que para probar `verifyMfa()` de punta
 * a punta con un código real hace falta generar un secretHash/token válidos
 * con el MISMO formato — documentado en los comentarios de `mfa.ts` §1 y §3
 * (AES-256-GCM, key = SHA-256(AUTH_SECRET); TOTP RFC 6238, HMAC-SHA1).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash, createHmac, createCipheriv, randomBytes } from "node:crypto";

const mockCookieGet = vi.fn();
const mockCookieSet = vi.fn();
const mockGetTenantContext = vi.fn();
const mockFindFirstCredential = vi.fn();
const mockFindUniqueUser = vi.fn();
const mockUserUpdate = vi.fn();
const mockCredentialUpdate = vi.fn();
const mockTransaction = vi.fn((ops: unknown[]) => Promise.all(ops));
const mockSupabaseGetUser = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mockCookieGet, set: mockCookieSet }),
}));

vi.mock("@his/database", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockFindUniqueUser(...args),
      update: (...args: unknown[]) => mockUserUpdate(...args),
    },
    userCredential: {
      findFirst: (...args: unknown[]) => mockFindFirstCredential(...args),
      update: (...args: unknown[]) => mockCredentialUpdate(...args),
    },
    $transaction: (ops: unknown[]) => mockTransaction(ops),
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: () => mockSupabaseGetUser() },
  }),
}));

vi.mock("@/lib/auth/session", () => ({
  getTenantContext: () => mockGetTenantContext(),
}));

const USER_ID = "22222222-2222-4222-8222-222222222222";
const ORG_ID = "33333333-3333-4333-8333-333333333333";
const EMAIL = "mc@his.test";
const AUTH_SECRET = "a".repeat(40);
const MFA_SESSION_SECRET = "s".repeat(40);

// --- Réplica exacta del cifrado de mfa.ts §1 (AES-256-GCM) ------------------
const ENC_VERSION = 1;
function getEncryptionKey(): Buffer {
  return createHash("sha256").update(AUTH_SECRET, "utf8").digest();
}
function encryptCredential(plaintext: { secret: string; codes: string[] }): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const json = JSON.stringify(plaintext);
  const ct = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: ENC_VERSION,
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    ct: ct.toString("hex"),
    createdAt: new Date().toISOString(),
  });
}

// --- Réplica exacta del TOTP de mfa.ts §3 (RFC 6238, HMAC-SHA1) -------------
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Decode(input: string): Buffer {
  const cleaned = input.replace(/=+$/g, "").toUpperCase().replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(ch);
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
  return (bin % 10 ** 6).toString().padStart(6, "0");
}

const TOTP_SECRET_BASE32 = "JBSWY3DPEHPK3PXP"; // secreto de prueba estándar (RFC 6238 fixture)

function currentValidToken(): string {
  const counter = Math.floor(Date.now() / 1000 / 30);
  return generateTotp(TOTP_SECRET_BASE32, counter);
}

const BASE_TENANT = {
  userId: USER_ID,
  organizationId: ORG_ID,
  establishmentId: undefined,
  countryId: "cc",
  roleCodes: ["PHYSICIAN"],
  assignedServiceUnitIds: [],
  assignedServiceUnitCodes: [],
  isCrossServiceRole: false,
};

describe("verifyMfa — R4.5 switch de organización (regresión P0)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
    vi.stubEnv("MFA_SESSION_SECRET", MFA_SESSION_SECRET);
    // Estado real de prod: el CSV de roles por env está vacío.
    vi.stubEnv("MFA_REQUIRED_ROLE_CODES", "");

    mockSupabaseGetUser.mockResolvedValue({ data: { user: { email: EMAIL } } });
    mockFindUniqueUser.mockResolvedValue({
      id: USER_ID,
      email: EMAIL,
      fullName: "Dr. Test",
      mfaEnabled: false,
    });
    mockFindFirstCredential.mockResolvedValue({
      id: "cred-1",
      secretHash: encryptCredential({ secret: TOTP_SECRET_BASE32, codes: [] }),
    });
    mockUserUpdate.mockResolvedValue({});
    mockCredentialUpdate.mockResolvedValue({});
    mockCookieGet.mockReturnValue(undefined);
  });

  it("flag de organización ON + CSV vacío + TOTP correcto ⇒ verifica OK y EMITE la cookie de sesión MFA", async () => {
    mockGetTenantContext.mockResolvedValue({ ...BASE_TENANT, mfaStaffRequired: true });

    const { verifyMfa } = await import("../mfa");
    const result = await verifyMfa({ token: currentValidToken() });

    expect(result.ok).toBe(true);
    // La aserción que hubiera fallado antes del fix: sin resolver el tenant,
    // readMfaPolicy() caía a "off" y `cookieStore.set` NUNCA se llamaba.
    expect(mockCookieSet).toHaveBeenCalledTimes(1);
    const [cookieName, cookieValue, cookieOpts] = mockCookieSet.mock.calls[0]!;
    expect(cookieName).toBe("his.mfa");
    expect(cookieValue).toEqual(expect.any(String));
    expect(cookieOpts).toMatchObject({ httpOnly: true, path: "/" });
  });

  it("flag de organización OFF + CSV vacío ⇒ verifica OK pero NO emite cookie (comportamiento previo intacto)", async () => {
    mockGetTenantContext.mockResolvedValue({ ...BASE_TENANT, mfaStaffRequired: false });

    const { verifyMfa } = await import("../mfa");
    const result = await verifyMfa({ token: currentValidToken() });

    expect(result.ok).toBe(true);
    expect(mockCookieSet).not.toHaveBeenCalled();
  });

  it("sin tenant resuelto (getTenantContext → null) ⇒ no rompe el login y NO emite cookie", async () => {
    mockGetTenantContext.mockResolvedValue(null);

    const { verifyMfa } = await import("../mfa");
    const result = await verifyMfa({ token: currentValidToken() });

    expect(result.ok).toBe(true);
    expect(mockCookieSet).not.toHaveBeenCalled();
  });
});
