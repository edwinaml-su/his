/**
 * Tests — cliente WHO ICD-11 (CIE-11).
 *
 * Se ejercita en modo self-host (WHO_ICD_API_BASE) para evitar el flujo OAuth
 * cloud; `fetch` se mockea. Cubre: detección de configuración, degradación por
 * query vacía, error por no configurado, mapeo/limit/stripHtml y error HTTP.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  buscarCie11,
  isWhoIcdConfigured,
  WhoIcdNotConfiguredError,
} from "../client";

const BASE = "http://localhost:8382";

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: ok ? "OK" : "Bad Gateway",
    json: async () => body,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  // Limpia cualquier credencial heredada del entorno real.
  vi.stubEnv("WHO_ICD_CLIENT_ID", "");
  vi.stubEnv("WHO_ICD_CLIENT_SECRET", "");
  vi.stubEnv("WHO_ICD_API_BASE", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("isWhoIcdConfigured", () => {
  it("false sin credenciales ni base", () => {
    expect(isWhoIcdConfigured()).toBe(false);
  });

  it("true con base self-host", () => {
    vi.stubEnv("WHO_ICD_API_BASE", BASE);
    expect(isWhoIcdConfigured()).toBe(true);
  });

  it("true con credenciales cloud", () => {
    vi.stubEnv("WHO_ICD_CLIENT_ID", "id");
    vi.stubEnv("WHO_ICD_CLIENT_SECRET", "secret");
    expect(isWhoIcdConfigured()).toBe(true);
  });
});

describe("buscarCie11", () => {
  it("retorna items:[] con query vacía sin llamar a la API", async () => {
    const fetchMock = mockFetchOnce({});
    const r = await buscarCie11("   ");
    expect(r.items).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lanza WhoIcdNotConfiguredError si no está configurado", async () => {
    await expect(buscarCie11("diabetes")).rejects.toBeInstanceOf(WhoIcdNotConfiguredError);
  });

  it("mapea destinationEntities a items (self-host, sin token)", async () => {
    vi.stubEnv("WHO_ICD_API_BASE", BASE);
    const fetchMock = mockFetchOnce({
      destinationEntities: [
        { id: "uri/1", title: "<em>Diabetes</em> mellitus", theCode: "5a11" },
        { id: "uri/2", title: "Sin código", theCode: "" },
        { id: "uri/3", title: "", theCode: "ZZ99" }, // título vacío → filtrado
      ],
    });

    const r = await buscarCie11("diabetes", { limit: 10 });

    // El item con título vacío se descarta; el resto se mapea.
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toEqual({ codigo: "5A11", titulo: "Diabetes mellitus", uri: "uri/1" });
    expect(r.items[1]).toMatchObject({ codigo: "", titulo: "Sin código" });

    // En self-host puro no se envía Authorization.
    const opts = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((opts.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("respeta el limit", async () => {
    vi.stubEnv("WHO_ICD_API_BASE", BASE);
    mockFetchOnce({
      destinationEntities: Array.from({ length: 5 }, (_, i) => ({
        id: `uri/${i}`,
        title: `Entidad ${i}`,
        theCode: `A0${i}`,
      })),
    });

    const r = await buscarCie11("x", { limit: 2 });
    expect(r.items).toHaveLength(2);
  });

  it("lanza Error si la API responde no-OK", async () => {
    vi.stubEnv("WHO_ICD_API_BASE", BASE);
    mockFetchOnce({}, false, 502);
    await expect(buscarCie11("diabetes")).rejects.toThrow(/502/);
  });
});
