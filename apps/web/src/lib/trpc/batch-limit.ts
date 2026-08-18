/**
 * Tope de procedures por batch tRPC — OWASP A06:2025 (hallazgo H1, remediación
 * 2026-08-17).
 *
 * `httpBatchLink` empaqueta N procedures en un solo POST HTTP. Sin tope, un
 * batch de cientos/miles de mutations evade el rate limit por-request: 1 hit
 * HTTP deja de ser 1 operación real (ver `rate-limit-global.ts`, que ahora
 * cuenta hits por procedure del batch, no por request).
 *
 * El máximo real observado en el código (`grep -c 'trpc\..*\.useQuery'` por
 * archivo, 2026-08-17) es 7 llamadas simultáneas en una misma pantalla. 20 da
 * margen amplio para pantallas futuras sin abrir la puerta a que un batch se
 * use como vector de evasión del límite.
 *
 * Compartido entre cliente (`react.tsx`, tope real del link — evita que el
 * navegador arme batches gigantes) y servidor (`app/api/trpc/[trpc]/route.ts`,
 * validación — nunca confiar solo en el límite del cliente).
 */
export const TRPC_MAX_BATCH_SIZE = 20;
