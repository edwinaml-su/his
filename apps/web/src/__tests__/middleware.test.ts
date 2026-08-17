/**
 * Fail-closed del middleware raíz — OWASP A10:2025 (Mishandling of
 * Exceptional Conditions), fix c440473.
 *
 * Antes de este fix, cualquier excepción no atrapada dentro de
 * `middlewareCore` (típicamente "Invalid UTF-8 sequence" al parsear cookies
 * corruptas en el runtime Edge, ANTES de llegar al try/catch específico de
 * `updateSession`) degradaba a pass-through para TODA ruta — un fallo del
 * middleware dejaba pasar requests a rutas protegidas sin evaluar sesión
 * (fail-OPEN). Ahora el wrapper `middleware()` atrapa cualquier excepción y
 * decide fail-CLOSED: rutas protegidas → /login (o /portal/login si venía
 * del portal); rutas públicas siguen sirviéndose (no tiene sentido bloquear
 * /login o /_next/static por un fallo no relacionado con sesión).
 *
 * `updateSession` (@/lib/supabase/middleware) se mockea para forzar la
 * excepción en el camino no-portal. Para el camino portal (que no llama a
 * `updateSession`) se fuerza el error sobre `request.cookies.has`, simulando
 * el mismo tipo de fallo de parsing de cookies que describe el comentario
 * de producción.
 *
 * `vi.stubGlobal("Headers", ...)`: bajo el entorno `jsdom` del workspace,
 * `NextRequest` (edge runtime de Next) construye `request.headers` con SU
 * PROPIA clase `Headers` interna, distinta de `globalThis.Headers` que
 * jsdom expone — dos clases distintas con el mismo nombre. El branch
 * público del middleware llama `NextResponse.next({ request })`, que
 * verifica `request.headers instanceof Headers` (global) y revienta con
 * "request.headers must be an instance of Headers" por ese choque, ajeno
 * por completo a la lógica bajo prueba. Se alinea el global al de la
 * request real de prueba, únicamente en este archivo.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mockUpdateSession = vi.fn();

vi.mock("@/lib/supabase/middleware", () => ({
  updateSession: (...args: unknown[]) => mockUpdateSession(...args),
}));

import { middleware } from "../middleware";

function makeRequest(path: string): NextRequest {
  return new NextRequest(new URL(path, "https://his-avante.vercel.app"));
}

describe("middleware — fail-closed ante excepción no atrapada (OWASP A10:2025)", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockUpdateSession.mockReset();
    consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    // Ver nota de cabecera — alinea el `Headers` global con el que usa
    // internamente `NextRequest` bajo jsdom.
    const probe = makeRequest("/__diag__");
    vi.stubGlobal("Headers", probe.headers.constructor);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("ruta protegida (no portal) + excepción forzada en el core → redirect a /login con ?redirect=", async () => {
    mockUpdateSession.mockRejectedValue(new Error("Invalid UTF-8 sequence"));

    const res = await middleware(makeRequest("/dashboard"));

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("redirect")).toBe("/dashboard");
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("ruta del portal + excepción forzada en el core → redirect a /portal/login con ?redirect=", async () => {
    const req = makeRequest("/portal/inicio");
    // El branch /portal/* no llama a `updateSession`; se fuerza el mismo tipo
    // de fallo (parsing de cookies corruptas) directamente sobre `request.cookies`.
    req.cookies.has = () => {
      throw new Error("Invalid UTF-8 sequence");
    };

    const res = await middleware(req);

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/portal/login");
    expect(location.searchParams.get("redirect")).toBe("/portal/inicio");
  });

  it("ruta pública (no portal) + excepción forzada en el core → pass-through, sin redirect", async () => {
    mockUpdateSession.mockRejectedValue(new Error("Invalid UTF-8 sequence"));

    const res = await middleware(makeRequest("/login"));

    expect(res.headers.get("location")).toBeNull();
    expect(res.status).not.toBe(307);
    expect(res.status).not.toBe(308);
  });

  it("ruta pública del portal (/portal/login) + excepción forzada → pass-through, sin redirect", async () => {
    const req = makeRequest("/portal/login");
    req.cookies.has = () => {
      throw new Error("Invalid UTF-8 sequence");
    };

    const res = await middleware(req);

    expect(res.headers.get("location")).toBeNull();
    expect(res.status).not.toBe(307);
    expect(res.status).not.toBe(308);
  });
});
