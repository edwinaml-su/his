"use client";

import { ErrorFallback } from "@/components/error-fallback";

/**
 * Error boundary del grupo clínico. Captura los throws de las PÁGINAS del grupo
 * (Server Components que consultan BD) preservando el shell del layout —
 * sidebar/topbar siguen visibles. Para el throw del propio layout clínico el
 * boundary que aplica es `app/error.tsx` (segmento padre).
 */
export default function ClinicalError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback {...props} scope="sección clínica" />;
}
