/**
 * Tests del contrato `EmailProvider` (Beta.15).
 *
 * Solo cubrimos las clases de error — la interface es estructural y se valida
 * vía typecheck. El poller (US.B15.1.3 — pendiente) usará el `name` para
 * decidir retry vs FAILED, por eso es importante preservar la identidad
 * exacta de la clase.
 */
import { describe, it, expect } from "vitest";
import {
  TransientProviderError,
  PermanentProviderError,
} from "../provider";

describe("TransientProviderError", () => {
  it("preserva message y name", () => {
    const err = new TransientProviderError("Resend 503: gateway down");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(TransientProviderError);
    expect(err.name).toBe("TransientProviderError");
    expect(err.message).toBe("Resend 503: gateway down");
  });

  it("preserva cause cuando se pasa", () => {
    const original = new TypeError("fetch failed");
    const err = new TransientProviderError("network down", original);
    expect(err.cause).toBe(original);
  });

  it("permite cause undefined", () => {
    const err = new TransientProviderError("timeout");
    expect(err.cause).toBeUndefined();
  });
});

describe("PermanentProviderError", () => {
  it("preserva message y name", () => {
    const err = new PermanentProviderError("Resend 400: invalid email");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(PermanentProviderError);
    expect(err.name).toBe("PermanentProviderError");
    expect(err.message).toBe("Resend 400: invalid email");
  });

  it("preserva cause cuando se pasa", () => {
    const original = { code: "EAUTH" };
    const err = new PermanentProviderError("auth invalid", original);
    expect(err.cause).toBe(original);
  });

  it("es distinguible de TransientProviderError por name", () => {
    const transient = new TransientProviderError("x");
    const permanent = new PermanentProviderError("y");
    expect(transient.name).not.toBe(permanent.name);
    expect(transient).not.toBeInstanceOf(PermanentProviderError);
    expect(permanent).not.toBeInstanceOf(TransientProviderError);
  });
});
