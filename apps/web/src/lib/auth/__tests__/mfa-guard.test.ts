/**
 * `assertMfaOrRedirect` (apps/web/src/lib/auth/mfa-guard.ts) — OWASP A07:2025.
 *
 * Gate llamado desde los layouts `(clinical)`/`(admin)`. A diferencia de
 * `trpc.ts` (donde `MFA_POLICY_ENABLED` se congela al importar el módulo),
 * `readMfaPolicy()`/`isMfaSatisfied()` leen `process.env` en cada llamada —
 * no hace falta `vi.resetModules()`, basta `vi.stubEnv` por test.
 *
 * `next/headers` y `next/navigation` se mockean: fuera del request scope de
 * Next.js, `cookies()` lanza si no se mockea.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockCookieGet = vi.fn();
const mockRedirect = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mockCookieGet }),
}));

vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => mockRedirect(...args),
}));

import { assertMfaOrRedirect } from "../mfa-guard";
import { issueMfaCookie } from "../mfa-session";

const USER_ID = "22222222-2222-4222-8222-222222222222";
const SECRET = "s".repeat(32);

describe("assertMfaOrRedirect — OWASP A07:2025", () => {
  beforeEach(() => {
    mockCookieGet.mockReset();
    mockRedirect.mockReset();
    vi.unstubAllEnvs();
    vi.stubEnv("MFA_REQUIRED_ROLE_CODES", "");
    vi.stubEnv("MFA_SESSION_SECRET", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("política apagada (MFA_REQUIRED_ROLE_CODES vacía) → no redirige, ni siquiera lee la cookie", async () => {
    await assertMfaOrRedirect(USER_ID, ["PHYSICIAN"]);

    expect(mockRedirect).not.toHaveBeenCalled();
    expect(mockCookieGet).not.toHaveBeenCalled();
  });

  it("política prendida pero el rol del usuario no está en la lista → no redirige", async () => {
    vi.stubEnv("MFA_REQUIRED_ROLE_CODES", "DIR,ADMIN");
    vi.stubEnv("MFA_SESSION_SECRET", SECRET);

    await assertMfaOrRedirect(USER_ID, ["PHYSICIAN"]);

    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("política satisfecha (cookie firmada, vigente, del mismo usuario) → no redirige", async () => {
    vi.stubEnv("MFA_REQUIRED_ROLE_CODES", "ADMIN");
    vi.stubEnv("MFA_SESSION_SECRET", SECRET);
    mockCookieGet.mockReturnValue({ value: issueMfaCookie(USER_ID, SECRET) });

    await assertMfaOrRedirect(USER_ID, ["ADMIN"]);

    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("política no satisfecha (sin cookie) → redirige a /mfa", async () => {
    vi.stubEnv("MFA_REQUIRED_ROLE_CODES", "ADMIN");
    vi.stubEnv("MFA_SESSION_SECRET", SECRET);
    mockCookieGet.mockReturnValue(undefined);

    await assertMfaOrRedirect(USER_ID, ["ADMIN"]);

    expect(mockRedirect).toHaveBeenCalledWith("/mfa");
  });

  it("política no satisfecha (cookie de OTRO usuario) → redirige a /mfa", async () => {
    vi.stubEnv("MFA_REQUIRED_ROLE_CODES", "ADMIN");
    vi.stubEnv("MFA_SESSION_SECRET", SECRET);
    const otroUsuario = "33333333-3333-4333-8333-333333333333";
    mockCookieGet.mockReturnValue({ value: issueMfaCookie(otroUsuario, SECRET) });

    await assertMfaOrRedirect(USER_ID, ["ADMIN"]);

    expect(mockRedirect).toHaveBeenCalledWith("/mfa");
  });

  it("política mal configurada (roles exigidos pero sin MFA_SESSION_SECRET) → redirige a /mfa y loggea el error", async () => {
    vi.stubEnv("MFA_REQUIRED_ROLE_CODES", "ADMIN");
    vi.stubEnv("MFA_SESSION_SECRET", "");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await assertMfaOrRedirect(USER_ID, ["ADMIN"]);

    expect(mockRedirect).toHaveBeenCalledWith("/mfa");
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("mal configurada"));

    consoleSpy.mockRestore();
  });
});
