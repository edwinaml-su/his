/**
 * `getClientIp` (apps/web/src/lib/http/client-ip.ts) — OWASP A06:2025
 * (hallazgo H5, fix c440473).
 *
 * `x-forwarded-for` es controlable por el cliente (cada proxy AGREGA, no
 * sobreescribe): un atacante que manda `X-Forwarded-For: 1.2.3.4` puede
 * rotar ese valor en cada request para evadir el bucket de rate-limit por
 * IP. `x-vercel-forwarded-for`/`x-real-ip` sí son fijados por el edge de
 * Vercel y no pueden spoofearse — deben ganar siempre que estén presentes.
 */
import { describe, it, expect } from "vitest";
import { getClientIp } from "../client-ip";
import { normalizeIp } from "@his/trpc/middleware/rate-limit";

describe("getClientIp — precedencia de headers (H5)", () => {
  it("x-vercel-forwarded-for gana sobre x-real-ip y x-forwarded-for", () => {
    const headers = new Headers({
      "x-vercel-forwarded-for": "203.0.113.1",
      "x-real-ip": "203.0.113.2",
      "x-forwarded-for": "203.0.113.3",
    });
    expect(getClientIp(headers)).toBe("203.0.113.1");
  });

  it("sin x-vercel-forwarded-for, x-real-ip gana sobre x-forwarded-for", () => {
    const headers = new Headers({
      "x-real-ip": "203.0.113.2",
      "x-forwarded-for": "203.0.113.3",
    });
    expect(getClientIp(headers)).toBe("203.0.113.2");
  });

  it("x-forwarded-for es el ÚLTIMO fallback, solo si no hay ninguno de los otros dos", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.3" });
    expect(getClientIp(headers)).toBe("203.0.113.3");
  });

  it("sin ningún header → undefined", () => {
    expect(getClientIp(new Headers())).toBeUndefined();
  });

  it("un x-forwarded-for spoofeado con múltiples saltos NO elige el bucket cuando x-vercel-forwarded-for está presente", () => {
    // El atacante intenta anteponer su propia IP con varios saltos para
    // controlar `normalizeIp` (que toma el primer valor de la cadena). El
    // header autoritativo de Vercel debe ganar de todas formas.
    const headers = new Headers({
      "x-vercel-forwarded-for": "198.51.100.9",
      "x-forwarded-for": "1.2.3.4, 5.6.7.8, 198.51.100.9",
    });
    const ip = getClientIp(headers);
    expect(ip).toBe("198.51.100.9");
    expect(normalizeIp(ip)).toBe("198.51.100.9");
  });

  it("solo con x-forwarded-for de múltiples saltos (dev local, sin edge de Vercel), normalizeIp toma el primer salto — riesgo aceptado documentado, no producción", () => {
    const headers = new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" });
    const ip = getClientIp(headers);
    expect(ip).toBe("1.2.3.4, 10.0.0.1");
    expect(normalizeIp(ip)).toBe("1.2.3.4");
  });

  it("acepta ReadonlyHeaders de next/headers() (solo expone get, no set/append/delete)", () => {
    const readonlyLike = { get: (name: string) => (name === "x-real-ip" ? "203.0.113.5" : null) };
    expect(getClientIp(readonlyLike)).toBe("203.0.113.5");
  });
});
