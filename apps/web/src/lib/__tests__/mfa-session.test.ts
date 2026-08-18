/**
 * A07:2025 — marca de sesión MFA firmada y política de enforcement.
 */
import { describe, it, expect } from "vitest";
import {
  MFA_TTL_SECONDS,
  issueMfaCookie,
  isMfaSatisfied,
  mfaRequiredForRoles,
  readMfaPolicy,
  verifyMfaCookie,
} from "../auth/mfa-session";

const SECRET = "x".repeat(48);
const USER = "3f1c9d4e-2b7a-4c1e-9f3b-1d2e3f4a5b6c";

describe("readMfaPolicy", () => {
  it("apagada por defecto (sin variables)", () => {
    expect(readMfaPolicy({} as unknown as NodeJS.ProcessEnv).mode).toBe("off");
  });

  it("enforced con roles + secreto", () => {
    const policy = readMfaPolicy({
      MFA_REQUIRED_ROLE_CODES: "dir, arch ,ADMIN",
      MFA_SESSION_SECRET: SECRET,
    } as unknown as NodeJS.ProcessEnv);
    expect(policy).toMatchObject({ mode: "enforced", roleCodes: ["DIR", "ARCH", "ADMIN"] });
  });

  it("misconfigured si hay roles pero el secreto falta o es débil", () => {
    expect(
      readMfaPolicy({ MFA_REQUIRED_ROLE_CODES: "DIR" } as unknown as NodeJS.ProcessEnv).mode,
    ).toBe("misconfigured");
    expect(
      readMfaPolicy({
        MFA_REQUIRED_ROLE_CODES: "DIR",
        MFA_SESSION_SECRET: "corto",
      } as unknown as NodeJS.ProcessEnv).mode,
    ).toBe("misconfigured");
  });
});

describe("mfaRequiredForRoles", () => {
  const enforced = { mode: "enforced" as const, roleCodes: ["DIR"], secret: SECRET };

  it("sólo exige a los roles listados", () => {
    expect(mfaRequiredForRoles(["NURSE"], enforced)).toBe(false);
    expect(mfaRequiredForRoles(["nurse", "dir"], enforced)).toBe(true);
  });

  it("con política apagada nunca exige", () => {
    expect(mfaRequiredForRoles(["DIR"], { mode: "off" })).toBe(false);
  });

  it("mal configurada exige siempre (fail-closed)", () => {
    expect(mfaRequiredForRoles(["NURSE"], { mode: "misconfigured" as const, reason: "x" })).toBe(true);
  });
});

describe("cookie firmada", () => {
  it("verifica la cookie que acaba de emitir", () => {
    const cookie = issueMfaCookie(USER, SECRET);
    expect(verifyMfaCookie(cookie, USER, SECRET)).toBe(true);
  });

  it("rechaza firma alterada", () => {
    const cookie = issueMfaCookie(USER, SECRET);
    const tampered = cookie.slice(0, -1) + (cookie.endsWith("a") ? "b" : "a");
    expect(verifyMfaCookie(tampered, USER, SECRET)).toBe(false);
  });

  it("rechaza cookie forjada sin conocer el secreto", () => {
    expect(verifyMfaCookie(`${USER}.${Date.now()}.deadbeef`, USER, SECRET)).toBe(false);
  });

  it("rechaza la cookie de otro usuario", () => {
    const cookie = issueMfaCookie("otro-user", SECRET);
    expect(verifyMfaCookie(cookie, USER, SECRET)).toBe(false);
  });

  it("rechaza cookie expirada y cookie emitida en el futuro", () => {
    const now = Date.now();
    const vieja = issueMfaCookie(USER, SECRET, now - (MFA_TTL_SECONDS + 60) * 1000);
    expect(verifyMfaCookie(vieja, USER, SECRET, now)).toBe(false);

    const futura = issueMfaCookie(USER, SECRET, now + 10 * 60_000);
    expect(verifyMfaCookie(futura, USER, SECRET, now)).toBe(false);
  });

  it("rechaza formato inválido o ausente", () => {
    expect(verifyMfaCookie(undefined, USER, SECRET)).toBe(false);
    expect(verifyMfaCookie("basura", USER, SECRET)).toBe(false);
    expect(verifyMfaCookie(`${USER}.no-numero.abc`, USER, SECRET)).toBe(false);
  });
});

describe("isMfaSatisfied", () => {
  const policy = { mode: "enforced" as const, roleCodes: ["DIR"], secret: SECRET };

  it("pasa a los roles no cubiertos aunque no tengan cookie", () => {
    expect(
      isMfaSatisfied({ userId: USER, roleCodes: ["NURSE"], cookie: undefined, policy }),
    ).toBe(true);
  });

  it("bloquea al rol cubierto sin cookie y lo deja pasar con cookie válida", () => {
    expect(
      isMfaSatisfied({ userId: USER, roleCodes: ["DIR"], cookie: undefined, policy }),
    ).toBe(false);
    expect(
      isMfaSatisfied({
        userId: USER,
        roleCodes: ["DIR"],
        cookie: issueMfaCookie(USER, SECRET),
        policy,
      }),
    ).toBe(true);
  });

  it("con política apagada siempre pasa", () => {
    expect(
      isMfaSatisfied({
        userId: USER,
        roleCodes: ["DIR"],
        cookie: undefined,
        policy: { mode: "off" as const },
      }),
    ).toBe(true);
  });
});
