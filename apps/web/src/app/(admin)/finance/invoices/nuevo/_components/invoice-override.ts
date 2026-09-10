/**
 * docs/48 Ola 4b (H-17) — lógica pura del override de precio en
 * `/finance/invoices/nuevo`, extraída de `nueva-factura-shell.tsx` para
 * poder testearla sin depender de interacción con los `<Select>` de Radix
 * (documentado como no simulable en jsdom en este repo — ver
 * `__tests__/nueva-factura-shell.test.tsx`).
 *
 * `invoice.router.ts create` rechaza con PRECONDITION_FAILED (uno de los 2
 * mensajes de `PRECIO_ERROR_FRAGMENTS`) cuando el precio de una línea no se
 * pudo resolver o no coincide con el resuelto server-side, salvo que la
 * línea incluya `overridePrecio.justificacion` Y el usuario tenga rol
 * ADMIN/DIR (`ROLES_OVERRIDE_PRECIO` en invoice.router.ts — mismo trío aquí).
 */

/** Mismo trío que `ROLES_OVERRIDE_PRECIO` en `packages/trpc/src/routers/invoice.router.ts`. */
export const ROLES_OVERRIDE_PRECIO = ["ADMIN", "DIR"];

/** Fragmentos literales de los 2 mensajes PRECONDITION_FAILED que emite `invoice.create` por mismatch/no-resoluble. */
export const PRECIO_ERROR_FRAGMENTS = [
  "No se pudo resolver el precio",
  "no coincide con el resuelto",
];

/** true si `message` corresponde a un rechazo por precio (mismatch o no-resoluble) de `invoice.create`. */
export function esErrorDePrecio(message: string | undefined): boolean {
  if (!message) return false;
  return PRECIO_ERROR_FRAGMENTS.some((fragment) => message.includes(fragment));
}

/** true si alguno de `roleCodes` está habilitado para forzar `overridePrecio`. */
export function puedeOverridePrecio(roleCodes: readonly string[]): boolean {
  return roleCodes.some((r) => ROLES_OVERRIDE_PRECIO.includes(r));
}

/**
 * Adjunta `overridePrecio.justificacion` a TODAS las líneas cuando se provee
 * `justificacion`. El servidor rechaza el submit completo en la PRIMERA
 * línea que no coincide (loop secuencial en `invoice.router.ts create`), así
 * que el cliente no sabe de antemano cuál línea específica falló — adjuntar
 * a todas es inocuo: el servidor solo lee `overridePrecio` en las líneas
 * donde `unitPrice` no coincide con lo resuelto; en las que sí coinciden, lo
 * ignora.
 */
export function attachOverrideJustificacion<T extends object>(
  items: readonly T[],
  justificacion?: string,
): Array<T | (T & { overridePrecio: { justificacion: string } })> {
  if (!justificacion) return [...items];
  return items.map((it) => ({ ...it, overridePrecio: { justificacion } }));
}
