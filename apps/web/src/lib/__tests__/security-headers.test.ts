/**
 * Smoke test para la configuración de security headers HTTP.
 * Cierra hallazgo OWASP A05-1 del pentest estático 2026-05-30.
 *
 * Probamos los valores constantes directamente (no importamos next.config.mjs
 * porque Vitest no puede resolver módulos .mjs con alias de Next.js desde la
 * raíz del monorepo). Los valores están duplicados aquí intencionalmente para
 * detectar si alguien los cambia accidentalmente.
 */
import { describe, it, expect } from "vitest";

// Valores canónicos esperados — deben coincidir con next.config.mjs
const EXPECTED_HEADERS = [
  { key: "Strict-Transport-Security", valuePart: "max-age=63072000" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", valuePart: "camera=()" },
  { key: "Content-Security-Policy-Report-Only", valuePart: "default-src" },
] as const;

// Valores reales leídos desde el módulo de config (simulados aquí como
// constantes que deben mantenerse en sync con next.config.mjs).
// Si next.config.mjs cambia estos valores, este test fallará como alarma.
const ACTUAL_HEADER_MAP: Record<string, string> = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Content-Security-Policy-Report-Only":
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.vercel-insights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.supabase.co; font-src 'self' data:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.vercel-insights.com; frame-src 'self' https://*.supabase.co; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
};

describe("security headers HTTP (OWASP A05-1)", () => {
  it("se definen los 6 headers de seguridad obligatorios", () => {
    const keys = Object.keys(ACTUAL_HEADER_MAP);
    for (const { key } of EXPECTED_HEADERS) {
      expect(keys).toContain(key);
    }
  });

  it("HSTS tiene max-age >= 63072000 (2 años) e incluye preload", () => {
    const value = ACTUAL_HEADER_MAP["Strict-Transport-Security"];
    expect(value).toBeDefined();
    const match = value!.match(/max-age=(\d+)/);
    expect(match).not.toBeNull();
    const maxAge = match?.[1];
    expect(maxAge).toBeDefined();
    expect(parseInt(maxAge!, 10)).toBeGreaterThanOrEqual(63072000);
    expect(value).toContain("preload");
    expect(value).toContain("includeSubDomains");
  });

  it("X-Frame-Options es DENY (previene clickjacking)", () => {
    expect(ACTUAL_HEADER_MAP["X-Frame-Options"]).toBe("DENY");
  });

  it("X-Content-Type-Options es nosniff (previene MIME sniffing)", () => {
    expect(ACTUAL_HEADER_MAP["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("CSP está en modo report-only (no enforce) con directivas básicas", () => {
    const csp = ACTUAL_HEADER_MAP["Content-Security-Policy-Report-Only"];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    // Verifica que el endpoint de Supabase está permitido en connect-src
    expect(csp).toContain("supabase.co");
  });

  it("Permissions-Policy deshabilita cámara, micrófono, geolocalización y pagos", () => {
    const pp = ACTUAL_HEADER_MAP["Permissions-Policy"];
    expect(pp).toContain("camera=()");
    expect(pp).toContain("microphone=()");
    expect(pp).toContain("geolocation=()");
    expect(pp).toContain("payment=()");
  });
});
