/**
 * Tests puros de la matriz §6 backlog Beta.15 (US.B15.3.4).
 *
 * Valida que `expandDefaultsForRole` produce la lista correcta de filas para
 * persistir en `RoleNotificationDefault`. NO requiere BD ni `PrismaClient`.
 */
import { describe, it, expect } from "vitest";
import {
  MATRIX,
  ROLE_CODES,
  expandDefaultsForRole,
  type Channel,
  type Severity,
  type RoleCode,
} from "../notifications-defaults-matrix";

/** Helper: lookup en el resultado de `expandDefaultsForRole`. */
function lookup(
  rows: ReturnType<typeof expandDefaultsForRole>,
  severity: Severity,
  channel: Channel,
): boolean {
  const row = rows.find((r) => r.severity === severity && r.channel === channel);
  if (!row) throw new Error(`No row for (${severity}, ${channel})`);
  return row.enabled;
}

describe("expandDefaultsForRole — shape", () => {
  it("devuelve siempre 6 filas (3 severities × 2 channels) por rol", () => {
    for (const code of ROLE_CODES) {
      const rows = expandDefaultsForRole(code);
      expect(rows).toHaveLength(6);
    }
  });

  it("cubre todas las combinaciones (severity, channel) exactamente una vez", () => {
    for (const code of ROLE_CODES) {
      const rows = expandDefaultsForRole(code);
      const keys = rows.map((r) => `${r.severity}:${r.channel}`).sort();
      expect(keys).toEqual([
        "CRITICAL:EMAIL",
        "CRITICAL:INBOX",
        "INFO:EMAIL",
        "INFO:INBOX",
        "WARNING:EMAIL",
        "WARNING:INBOX",
      ]);
    }
  });
});

describe("expandDefaultsForRole — matriz §6 backlog Beta.15", () => {
  it("PHYSICIAN: CRITICAL→{INBOX,EMAIL} WARNING→{INBOX,EMAIL} INFO→{INBOX}", () => {
    const r = expandDefaultsForRole("PHYSICIAN");
    expect(lookup(r, "CRITICAL", "INBOX")).toBe(true);
    expect(lookup(r, "CRITICAL", "EMAIL")).toBe(true);
    expect(lookup(r, "WARNING", "INBOX")).toBe(true);
    expect(lookup(r, "WARNING", "EMAIL")).toBe(true);
    expect(lookup(r, "INFO", "INBOX")).toBe(true);
    expect(lookup(r, "INFO", "EMAIL")).toBe(false);
  });

  it("NURSE: CRITICAL→{INBOX,EMAIL} WARNING→{INBOX} INFO→{INBOX}", () => {
    const r = expandDefaultsForRole("NURSE");
    expect(lookup(r, "CRITICAL", "INBOX")).toBe(true);
    expect(lookup(r, "CRITICAL", "EMAIL")).toBe(true);
    expect(lookup(r, "WARNING", "INBOX")).toBe(true);
    expect(lookup(r, "WARNING", "EMAIL")).toBe(false);
    expect(lookup(r, "INFO", "INBOX")).toBe(true);
    expect(lookup(r, "INFO", "EMAIL")).toBe(false);
  });

  it("PHARMACIST: CRITICAL→{INBOX,EMAIL} WARNING→{INBOX,EMAIL} INFO→{INBOX}", () => {
    const r = expandDefaultsForRole("PHARMACIST");
    expect(lookup(r, "CRITICAL", "INBOX")).toBe(true);
    expect(lookup(r, "CRITICAL", "EMAIL")).toBe(true);
    expect(lookup(r, "WARNING", "INBOX")).toBe(true);
    expect(lookup(r, "WARNING", "EMAIL")).toBe(true);
    expect(lookup(r, "INFO", "INBOX")).toBe(true);
    expect(lookup(r, "INFO", "EMAIL")).toBe(false);
  });

  it("ADMIN: CRITICAL→{INBOX,EMAIL} WARNING→{INBOX} INFO→{}", () => {
    const r = expandDefaultsForRole("ADMIN");
    expect(lookup(r, "CRITICAL", "INBOX")).toBe(true);
    expect(lookup(r, "CRITICAL", "EMAIL")).toBe(true);
    expect(lookup(r, "WARNING", "INBOX")).toBe(true);
    expect(lookup(r, "WARNING", "EMAIL")).toBe(false);
    expect(lookup(r, "INFO", "INBOX")).toBe(false);
    expect(lookup(r, "INFO", "EMAIL")).toBe(false);
  });

  it("CRITICAL siempre dispara INBOX para los 4 roles (regla dura §6)", () => {
    for (const code of ROLE_CODES) {
      expect(lookup(expandDefaultsForRole(code), "CRITICAL", "INBOX")).toBe(true);
    }
  });

  it("INFO nunca dispara EMAIL por defecto (regla dura §6)", () => {
    for (const code of ROLE_CODES) {
      expect(lookup(expandDefaultsForRole(code), "INFO", "EMAIL")).toBe(false);
    }
  });
});

describe("MATRIX — sanity de codes esperados", () => {
  it("contiene exactamente los 4 roles del backlog §6", () => {
    expect(Object.keys(MATRIX).sort()).toEqual<RoleCode[]>([
      "ADMIN",
      "NURSE",
      "PHARMACIST",
      "PHYSICIAN",
    ]);
  });
});
