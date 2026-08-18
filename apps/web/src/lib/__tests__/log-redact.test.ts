/**
 * A09:2025 — redacción de identificadores en logs.
 */
import { describe, it, expect } from "vitest";
import { redactPhi } from "../log-redact";
import { isPublicTrpcPath } from "../auth/trpc-public";

describe("redactPhi", () => {
  it("redacta uuid, DUI, NIT, email y correlativos largos", () => {
    const raw =
      "paciente 3f1c9d4e-2b7a-4c1e-9f3b-1d2e3f4a5b6c DUI 04567891-2 " +
      "NIT 0614-123456-102-3 correo ana.perez@avante.com expediente 2229000003";
    const out = redactPhi(raw);
    expect(out).not.toMatch(/3f1c9d4e/);
    expect(out).not.toContain("04567891-2");
    expect(out).not.toContain("0614-123456-102-3");
    expect(out).not.toContain("ana.perez@avante.com");
    expect(out).not.toContain("2229000003");
    expect(out).toContain("<id>");
    expect(out).toContain("<dui>");
    expect(out).toContain("<nit>");
    expect(out).toContain("<email>");
  });

  it("es idempotente y no toca texto sin identificadores", () => {
    expect(redactPhi("orden no encontrada")).toBe("orden no encontrada");
    expect(redactPhi(redactPhi("id 3f1c9d4e-2b7a-4c1e-9f3b-1d2e3f4a5b6c"))).toBe("id <id>");
  });
});

describe("isPublicTrpcPath", () => {
  it("acepta procedures públicos sueltos", () => {
    expect(isPublicTrpcPath("/api/trpc/locale.currentLocale")).toBe(true);
    expect(isPublicTrpcPath("/api/trpc/portal.requestLogin")).toBe(true);
    expect(isPublicTrpcPath("/api/trpc/firma.requestRecovery")).toBe(true);
  });

  it("acepta un batch donde TODOS los procedures son públicos", () => {
    expect(isPublicTrpcPath("/api/trpc/locale.currentLocale,currency.list")).toBe(true);
  });

  it("rechaza un batch que esconde un procedure protegido detrás de uno público", () => {
    expect(isPublicTrpcPath("/api/trpc/locale.currentLocale,patient.list")).toBe(false);
    expect(isPublicTrpcPath("/api/trpc/currency.list,workflowInbox.miBandeja")).toBe(false);
  });

  it("rechaza procedures protegidos y rutas que no son tRPC", () => {
    expect(isPublicTrpcPath("/api/trpc/patient.list")).toBe(false);
    expect(isPublicTrpcPath("/api/trpc/firma.sign")).toBe(false);
    expect(isPublicTrpcPath("/api/trpc/")).toBe(false);
    expect(isPublicTrpcPath("/dashboard")).toBe(false);
  });

  it("no se deja engañar por URI malformada", () => {
    expect(isPublicTrpcPath("/api/trpc/locale.x,%E0%A4%A")).toBe(false);
  });
});
