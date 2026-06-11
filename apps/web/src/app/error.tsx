"use client";

import { ErrorFallback } from "@/components/error-fallback";

/**
 * Error boundary del segmento raíz. Captura los throws de los layouts hijos
 * — incluidos `(clinical)/layout.tsx` y `(admin)/layout.tsx`, que llaman
 * `getCurrentUser`/`getTenantContext` (Prisma). Es el boundary que atrapa el
 * P0 INC-2026-06-10-001: un `error.tsx` por grupo NO captura el throw del
 * layout de su mismo nivel, así que la red de seguridad real vive aquí.
 * Renderiza dentro del root layout (`<html><body>`), no lo reemplaza.
 */
export default function RootError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback {...props} scope="la aplicación" />;
}
