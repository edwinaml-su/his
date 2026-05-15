/**
 * Tests del adapter ResendProvider (Beta.15 — US.B15.2.2).
 *
 * Estrategia: inyectar `fetchImpl` mockeado con `vi.fn()` para controlar
 * status code, body y errores de red. NO se usa `vi.spyOn(globalThis.fetch)`
 * para evitar leakage entre tests.
 */
import { describe, it, expect, vi } from "vitest";
import {
  PermanentProviderError,
  TransientProviderError,
  type EmailSendInput,
} from "@his/contracts";
import { ResendProvider } from "../resend";

const baseInput: EmailSendInput = {
  to: "user@example.com",
  from: "no-reply@avante.example",
  subject: "Alerta crítica",
  html: "<p>hola</p>",
  text: "hola",
};

function makeResponse(status: number, body: unknown): Response {
  const isJson = typeof body === "object" && body !== null;
  return new Response(isJson ? JSON.stringify(body) : String(body), {
    status,
    headers: isJson
      ? { "Content-Type": "application/json" }
      : { "Content-Type": "text/plain" },
  });
}

describe("ResendProvider — construcción", () => {
  it("rechaza apiKey vacía", () => {
    expect(() => new ResendProvider({ apiKey: "" })).toThrow(/apiKey requerida/);
  });

  it("expone providerName = 'resend'", () => {
    const p = new ResendProvider({ apiKey: "re_test" });
    expect(p.providerName).toBe("resend");
  });
});

describe("ResendProvider.send — éxito", () => {
  it("resuelve { providerMessageId, status: 'SENT' } cuando 200 con id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(200, { id: "res_abc123" }),
    );
    const p = new ResendProvider({
      apiKey: "re_test",
      baseUrl: "https://api.test.local",
      fetchImpl: fetchImpl as typeof fetch,
    });

    const out = await p.send(baseInput);

    expect(out).toEqual({ providerMessageId: "res_abc123", status: "SENT" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("envía body con from/to/subject/html/text y header Authorization Bearer", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(200, { id: "res_xyz" }),
    );
    const p = new ResendProvider({
      apiKey: "re_secret_42",
      baseUrl: "https://api.test.local",
      fetchImpl: fetchImpl as typeof fetch,
    });

    await p.send(baseInput);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.test.local/emails");
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_secret_42");
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      from: "no-reply@avante.example",
      to: ["user@example.com"],
      subject: "Alerta crítica",
      html: "<p>hola</p>",
      text: "hola",
    });
  });

  it("serializa tags como array { name, value } cuando se proveen", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(200, { id: "res_tag" }),
    );
    const p = new ResendProvider({
      apiKey: "re_test",
      baseUrl: "https://api.test.local",
      fetchImpl: fetchImpl as typeof fetch,
    });

    await p.send({
      ...baseInput,
      tags: { eventType: "vital.critical", severity: "CRITICAL" },
    });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.tags).toEqual([
      { name: "eventType", value: "vital.critical" },
      { name: "severity", value: "CRITICAL" },
    ]);
  });

  it("usa endpoint default https://api.resend.com cuando baseUrl no se pasa", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(200, { id: "res_default" }),
    );
    const p = new ResendProvider({
      apiKey: "re_test",
      fetchImpl: fetchImpl as typeof fetch,
    });

    await p.send(baseInput);

    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
  });
});

describe("ResendProvider.send — errores", () => {
  it("lanza PermanentProviderError si 200 viene sin id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(200, {}));
    const p = new ResendProvider({
      apiKey: "re_test",
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(p.send(baseInput)).rejects.toBeInstanceOf(PermanentProviderError);
    await expect(p.send(baseInput)).rejects.toThrow(/sin id en respuesta/);
  });

  it("lanza TransientProviderError con status en mensaje cuando 500", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(500, "gateway down"),
    );
    const p = new ResendProvider({
      apiKey: "re_test",
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(p.send(baseInput)).rejects.toBeInstanceOf(TransientProviderError);
    await expect(p.send(baseInput)).rejects.toThrow(/Resend 500/);
  });

  it("lanza TransientProviderError cuando 503", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(503, "unavailable"),
    );
    const p = new ResendProvider({
      apiKey: "re_test",
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(p.send(baseInput)).rejects.toBeInstanceOf(TransientProviderError);
  });

  it("lanza PermanentProviderError cuando 400", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(400, "invalid email"),
    );
    const p = new ResendProvider({
      apiKey: "re_test",
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(p.send(baseInput)).rejects.toBeInstanceOf(PermanentProviderError);
    await expect(p.send(baseInput)).rejects.toThrow(/Resend 400/);
  });

  it("lanza PermanentProviderError cuando 401 (auth)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(401, "unauthorized"),
    );
    const p = new ResendProvider({
      apiKey: "re_test",
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(p.send(baseInput)).rejects.toBeInstanceOf(PermanentProviderError);
  });

  it("lanza TransientProviderError cuando fetch throws (red caída)", async () => {
    const networkErr = new TypeError("fetch failed: ECONNREFUSED");
    const fetchImpl = vi.fn().mockRejectedValue(networkErr);
    const p = new ResendProvider({
      apiKey: "re_test",
      fetchImpl: fetchImpl as typeof fetch,
    });

    const err = (await p.send(baseInput).catch((e: unknown) => e)) as TransientProviderError;
    expect(err).toBeInstanceOf(TransientProviderError);
    expect(err.message).toMatch(/network error/);
    expect(err.cause).toBe(networkErr);
  });

  it("trunca body de error a 200 chars en el mensaje", async () => {
    const longBody = "x".repeat(500);
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(422, longBody));
    const p = new ResendProvider({
      apiKey: "re_test",
      fetchImpl: fetchImpl as typeof fetch,
    });

    const err = (await p.send(baseInput).catch((e: unknown) => e)) as Error;
    // "Resend 422: " (12 chars) + 200 chars body = 212 chars
    expect(err).toBeInstanceOf(PermanentProviderError);
    expect(err.message.length).toBeLessThanOrEqual(212);
  });
});
