"use client";

import { ErrorFallback } from "@/components/error-fallback";

/**
 * Error boundary del grupo de administración. Captura los throws de las PÁGINAS
 * del grupo preservando el shell del layout. Para el throw del propio layout
 * admin el boundary que aplica es `app/error.tsx` (segmento padre).
 */
export default function AdminError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback {...props} scope="sección de administración" />;
}
