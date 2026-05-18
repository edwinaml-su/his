"use client";

/**
 * PublishDialog — Diálogo de confirmación para publicar un workflow.
 * US.F2.2.06
 *
 * Muestra el campo "Motivo del cambio" (requerido) antes de publicar.
 * Bloqueado si el grafo tiene errores de validación.
 */
import * as React from "react";
import { Button } from "@his/ui/components/button";
import { Alert, AlertDescription } from "@his/ui/components/alert";

interface PublishDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (motivo: string) => void;
  isPending: boolean;
  errorCount: number;
}

export function PublishDialog({
  open,
  onClose,
  onConfirm,
  isPending,
  errorCount,
}: PublishDialogProps) {
  const [motivo, setMotivo] = React.useState("");
  const [validationError, setValidationError] = React.useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = motivo.trim();
    if (!trimmed) {
      setValidationError("El motivo del cambio es obligatorio");
      return;
    }
    setValidationError(null);
    onConfirm(trimmed);
  }

  // Reset al abrir
  React.useEffect(() => {
    if (open) {
      setMotivo("");
      setValidationError(null);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="publish-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="publish-dialog"
    >
      <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-xl">
        <h2 id="publish-dialog-title" className="mb-4 text-lg font-semibold">
          Publicar workflow
        </h2>

        {errorCount > 0 ? (
          <Alert variant="destructive">
            <AlertDescription>
              No se puede publicar: el grafo tiene {errorCount} error
              {errorCount !== 1 ? "es" : ""} de validación. Resuélvelos primero.
            </AlertDescription>
          </Alert>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="motivo-cambio" className="block text-sm font-medium">
                Motivo del cambio <span aria-hidden="true">*</span>
              </label>
              <textarea
                id="motivo-cambio"
                required
                rows={3}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Describe qué cambió y por qué…"
                aria-describedby={validationError ? "motivo-error" : undefined}
              />
              {validationError && (
                <p id="motivo-error" role="alert" className="mt-1 text-xs text-destructive">
                  {validationError}
                </p>
              )}
            </div>

            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={isPending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Publicando…" : "Confirmar publicación"}
              </Button>
            </div>
          </form>
        )}

        {errorCount > 0 && (
          <div className="mt-4 flex justify-end">
            <Button variant="outline" onClick={onClose}>
              Cerrar
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
