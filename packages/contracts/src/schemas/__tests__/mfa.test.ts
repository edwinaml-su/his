/**
 * Tests de schemas y helpers de `@his/contracts/schemas/mfa`.
 *
 * Cubre:
 *   - Constantes de política (valores esperados por la spec)
 *   - isMfaRequiredForRole (helper exportado)
 *   - totpEnrollInput / totpEnrollResult (parse válido e inválido)
 *   - totpVerifyInput (token 6/8 dígitos, rechazos)
 *   - totpVerifyResult / totpStatusResult
 *
 * No requiere BD ni crypto real — son tests de schema Zod puro.
 */
import { describe, it, expect } from "vitest";
import {
  MFA_REQUIRED_ROLES,
  TOTP_STEP_SECONDS,
  TOTP_WINDOW,
  TOTP_DIGITS,
  BACKUP_CODE_COUNT,
  BACKUP_CODE_LENGTH,
  TOTP_SECRET_LENGTH,
  isMfaRequiredForRole,
  totpEnrollInput,
  totpEnrollResult,
  totpVerifyInput,
  totpVerifyResult,
  totpStatusResult,
} from "../mfa";

// ---------------------------------------------------------------------------
// Constantes de política
// ---------------------------------------------------------------------------

describe("constantes de política MFA", () => {
  it("roles requeridos son ADMIN y PHYSICIAN", () => {
    expect(MFA_REQUIRED_ROLES).toContain("ADMIN");
    expect(MFA_REQUIRED_ROLES).toContain("PHYSICIAN");
    expect(MFA_REQUIRED_ROLES).toHaveLength(2);
  });

  it("step es 30 segundos (RFC 6238 default)", () => {
    expect(TOTP_STEP_SECONDS).toBe(30);
  });

  it("window de tolerancia es ±1", () => {
    expect(TOTP_WINDOW).toBe(1);
  });

  it("token TOTP tiene 6 dígitos", () => {
    expect(TOTP_DIGITS).toBe(6);
  });

  it("10 backup codes de 8 dígitos", () => {
    expect(BACKUP_CODE_COUNT).toBe(10);
    expect(BACKUP_CODE_LENGTH).toBe(8);
  });

  it("secret length es 32 caracteres base32", () => {
    expect(TOTP_SECRET_LENGTH).toBe(32);
  });
});

// ---------------------------------------------------------------------------
// isMfaRequiredForRole
// ---------------------------------------------------------------------------

describe("isMfaRequiredForRole", () => {
  it("retorna true para ADMIN", () => {
    expect(isMfaRequiredForRole("ADMIN")).toBe(true);
  });

  it("retorna true para PHYSICIAN", () => {
    expect(isMfaRequiredForRole("PHYSICIAN")).toBe(true);
  });

  it("retorna false para NURSE", () => {
    expect(isMfaRequiredForRole("NURSE")).toBe(false);
  });

  it("retorna false para string vacío", () => {
    expect(isMfaRequiredForRole("")).toBe(false);
  });

  it("retorna false para rol desconocido", () => {
    expect(isMfaRequiredForRole("RECEPTIONIST")).toBe(false);
  });

  it("es case-sensitive: 'admin' minúsculas retorna false", () => {
    expect(isMfaRequiredForRole("admin")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// totpEnrollInput
// ---------------------------------------------------------------------------

describe("totpEnrollInput", () => {
  it("acepta objeto vacío (strict)", () => {
    expect(totpEnrollInput.safeParse({}).success).toBe(true);
  });

  it("rechaza propiedades extra (strict)", () => {
    expect(totpEnrollInput.safeParse({ extra: "field" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// totpEnrollResult
// ---------------------------------------------------------------------------

describe("totpEnrollResult", () => {
  const validSecret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PX"; // 32 chars base32
  const validCodes = Array.from({ length: 10 }, (_, i) =>
    String(i).padStart(8, "0")
  );

  it("acepta payload válido", () => {
    const r = totpEnrollResult.safeParse({
      secret: validSecret,
      otpauthUri: "otpauth://totp/Avante%20HIS:user@test.com?secret=X",
      backupCodes: validCodes,
    });
    expect(r.success).toBe(true);
  });

  it("rechaza secret con caracteres fuera de base32", () => {
    const r = totpEnrollResult.safeParse({
      secret: "INVALID!@#$SECRET!!!!!!!!!!!!!!!", // 32 chars pero con !
      otpauthUri: "otpauth://totp/test?secret=X",
      backupCodes: validCodes,
    });
    expect(r.success).toBe(false);
  });

  it("rechaza backupCodes con menos de 10 elementos", () => {
    const r = totpEnrollResult.safeParse({
      secret: validSecret,
      otpauthUri: "otpauth://totp/test?secret=X",
      backupCodes: validCodes.slice(0, 5),
    });
    expect(r.success).toBe(false);
  });

  it("rechaza backup code con longitud incorrecta", () => {
    const badCodes = Array.from({ length: 10 }, () => "1234"); // 4 dígitos
    const r = totpEnrollResult.safeParse({
      secret: validSecret,
      otpauthUri: "otpauth://totp/test?secret=X",
      backupCodes: badCodes,
    });
    expect(r.success).toBe(false);
  });

  it("acepta backup codes de exactamente 8 dígitos con ceros a la izquierda", () => {
    const codesWithLeadingZeros = Array.from({ length: 10 }, () => "00000001");
    const r = totpEnrollResult.safeParse({
      secret: validSecret,
      otpauthUri: "otpauth://totp/test?secret=X",
      backupCodes: codesWithLeadingZeros,
    });
    expect(r.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// totpVerifyInput
// ---------------------------------------------------------------------------

describe("totpVerifyInput", () => {
  it("acepta token de 6 dígitos", () => {
    expect(totpVerifyInput.safeParse({ token: "123456" }).success).toBe(true);
  });

  it("acepta token de 8 dígitos (backup code)", () => {
    expect(totpVerifyInput.safeParse({ token: "12345678" }).success).toBe(true);
  });

  it("acepta token con ceros a la izquierda", () => {
    expect(totpVerifyInput.safeParse({ token: "000000" }).success).toBe(true);
  });

  it("acepta userId UUID opcional presente", () => {
    const r = totpVerifyInput.safeParse({
      token: "123456",
      userId: "00000000-0000-0000-0000-000000000001",
    });
    expect(r.success).toBe(true);
  });

  it("acepta sin userId (opcional)", () => {
    expect(totpVerifyInput.safeParse({ token: "123456" }).success).toBe(true);
  });

  it("rechaza token de 5 dígitos", () => {
    const r = totpVerifyInput.safeParse({ token: "12345" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toContain("6 u 8 dígitos");
  });

  it("rechaza token de 7 dígitos", () => {
    expect(totpVerifyInput.safeParse({ token: "1234567" }).success).toBe(false);
  });

  it("rechaza token con letras", () => {
    expect(totpVerifyInput.safeParse({ token: "12345a" }).success).toBe(false);
  });

  it("trim: token con espacios es limpiado antes de validar", () => {
    // Zod .trim() lo aplica antes del refine — "  123456  " → "123456" OK
    const r = totpVerifyInput.safeParse({ token: "  123456  " });
    expect(r.success).toBe(true);
    expect(r.data?.token).toBe("123456");
  });

  it("rechaza userId con formato inválido (no UUID)", () => {
    const r = totpVerifyInput.safeParse({ token: "123456", userId: "not-a-uuid" });
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// totpVerifyResult
// ---------------------------------------------------------------------------

describe("totpVerifyResult", () => {
  it("acepta ok=true sin campos opcionales", () => {
    expect(totpVerifyResult.safeParse({ ok: true }).success).toBe(true);
  });

  it("acepta ok=true con usedBackupCode y remainingBackupCodes", () => {
    const r = totpVerifyResult.safeParse({
      ok: true,
      usedBackupCode: true,
      remainingBackupCodes: 9,
    });
    expect(r.success).toBe(true);
  });

  it("acepta ok=false", () => {
    expect(totpVerifyResult.safeParse({ ok: false }).success).toBe(true);
  });

  it("rechaza remainingBackupCodes negativo", () => {
    const r = totpVerifyResult.safeParse({
      ok: true,
      remainingBackupCodes: -1,
    });
    expect(r.success).toBe(false);
  });

  it("acepta remainingBackupCodes=0 (sin códigos restantes)", () => {
    const r = totpVerifyResult.safeParse({
      ok: true,
      usedBackupCode: true,
      remainingBackupCodes: 0,
    });
    expect(r.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// totpStatusResult
// ---------------------------------------------------------------------------

describe("totpStatusResult", () => {
  it("acepta estado habilitado con TOTP", () => {
    const r = totpStatusResult.safeParse({
      enabled: true,
      method: "TOTP",
      lastVerifiedAt: "2026-01-15T10:00:00.000Z",
    });
    expect(r.success).toBe(true);
  });

  it("acepta estado deshabilitado con NONE y lastVerifiedAt null", () => {
    const r = totpStatusResult.safeParse({
      enabled: false,
      method: "NONE",
      lastVerifiedAt: null,
    });
    expect(r.success).toBe(true);
  });

  it("rechaza method con valor fuera del enum", () => {
    const r = totpStatusResult.safeParse({
      enabled: false,
      method: "SMS",
      lastVerifiedAt: null,
    });
    expect(r.success).toBe(false);
  });

  it("rechaza lastVerifiedAt con formato no datetime", () => {
    const r = totpStatusResult.safeParse({
      enabled: true,
      method: "TOTP",
      lastVerifiedAt: "not-a-date",
    });
    expect(r.success).toBe(false);
  });
});
