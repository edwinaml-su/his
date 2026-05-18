/**
 * ReadOnlyBanner — Banner azul informativo para usuarios sin rol editor.
 * US.F2.2.15: "Modo solo lectura — contacta DIR para cambios".
 */
"use client";

import { Alert, AlertDescription } from "@his/ui/components/alert";

export function ReadOnlyBanner() {
  return (
    <Alert
      role="status"
      aria-live="polite"
      className="border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-700 dark:bg-blue-900/20 dark:text-blue-200"
      data-testid="read-only-banner"
    >
      <AlertDescription>
        <strong>Modo solo lectura</strong> — contacta a la Dirección (DIR) o al Workflow Designer para realizar cambios en este flujo.
      </AlertDescription>
    </Alert>
  );
}
