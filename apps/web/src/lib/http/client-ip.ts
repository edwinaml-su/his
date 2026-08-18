/**
 * IP del cliente para rate-limiting — OWASP A06:2025 (hallazgo H5).
 *
 * `x-forwarded-for` NO es autoritativo: es un header de convención donde cada
 * proxy AGREGA (no sobreescribe) la IP que vio al final de la cadena. Si el
 * atacante manda `X-Forwarded-For: 1.2.3.4` en la request original, Vercel
 * antepone ese valor y el nuestro queda en `1.2.3.4, <ip-real-vista-por-Vercel>`
 * — `normalizeIp` toma el PRIMER valor (`split(",")[0]`), que sigue siendo el
 * del atacante. Rotando ese valor en cada request, el atacante evade el
 * bucket de 60/min por IP del rate limit pre-auth.
 *
 * Vercel sí garantiza un header que NO puede spoofearse: `x-vercel-forwarded-for`,
 * fijado por el edge network con la IP real de conexión (Vercel lo sobreescribe
 * si el cliente intenta mandarlo). Referencia: Vercel Edge Network headers docs.
 * `x-real-ip` es la misma garantía (single IP, mismo origen confiable).
 *
 * `x-forwarded-for` queda como ÚLTIMO fallback — solo para dev local / entornos
 * sin el edge de Vercel delante, donde ninguno de los dos headers anteriores
 * existe. En ese caso no hay garantía anti-spoof, pero tampoco hay exposición
 * real (no es producción).
 */
/**
 * Firma mínima en vez de `Headers` completo: acepta tanto `Request.headers`
 * (`Headers`) como el `ReadonlyHeaders` de `next/headers()` (que no expone
 * `set`/`append`/`delete` y por tanto no es asignable a `Headers`).
 */
interface ReadableHeaders {
  get(name: string): string | null;
}

export function getClientIp(headers: ReadableHeaders): string | undefined {
  return (
    headers.get("x-vercel-forwarded-for") ??
    headers.get("x-real-ip") ??
    headers.get("x-forwarded-for") ??
    undefined
  );
}
