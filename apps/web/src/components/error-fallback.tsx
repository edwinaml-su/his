"use client";

import { useEffect } from "react";

/**
 * UI compartida de degradación elegante para los error boundaries de App Router.
 *
 * Contexto (INC-2026-06-10-001): ante un fallo transitorio del Server Component
 * (típicamente agotamiento del pool de Postgres en un pico de concurrencia), Next
 * renderizaba la página cruda "Application error". Este fallback muestra un
 * "Reintentar" amable. `reset()` re-renderiza el segmento — si el blip de BD ya
 * pasó, la sección vuelve a cargar sin recargar toda la página.
 */
export function ErrorFallback({
  error,
  reset,
  scope,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  scope: string;
}) {
  useEffect(() => {
    console.error(`Error en ${scope}:`, error);
  }, [error, scope]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <h2 className="text-xl font-semibold">Servicio temporalmente no disponible</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        No pudimos cargar esta sección. Suele ser un problema transitorio de
        conexión. Reintenta en unos segundos.
      </p>
      <button
        onClick={reset}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      >
        Reintentar
      </button>
      {error.digest ? (
        <p className="text-xs text-muted-foreground">Ref: {error.digest}</p>
      ) : null}
    </div>
  );
}
