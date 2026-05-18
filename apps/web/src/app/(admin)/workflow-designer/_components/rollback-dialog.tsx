"use client";

/**
 * RollbackDialog — Confirmación de rollback a versión anterior.
 * US.F2.2.19
 */
import * as React from "react";
import { Button } from "@his/ui/components/button";

interface RollbackDialogProps {
  open: boolean;
  version: number;
  onClose: () => void;
  onConfirm: (motivo: string) => void;
  isPending: boolean;
}

export function RollbackDialog({
  open,
  version,
  onClose,
  onConfirm,
  isPending,
}: RollbackDialogProps) {
  const [motivo, setMotivo] = React.useState("");
  const [validationError, setValidationError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setMotivo("");
      setValidationError(null);
    }
  }, [open]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = motivo.trim();
    if (!trimmed) {
      setValidationError("El motivo es obligatorio para el rollback");
      return;
    }
    setValidationError(null);
    onConfirm(trimmed);
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="rollback-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="rollback-dialog"
    >
      <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-xl">
        <h2 id="rollback-dialog-title" className="mb-1 text-lg font-semibold">
          Restaurar versión v{version}
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Esto marcará la versión activa como HISTÓRICO y activará v{version} como nueva
          publicación. Esta acción quedará en el audit trail.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="rollback-motivo" className="block text-sm font-medium">
              Motivo del rollback <span aria-hidden="true">*</span>
            </label>
            <textarea
              id="rollback-motivo"
              required
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Describe por qué se revierte a esta versión…"
              aria-describedby={validationError ? "rollback-motivo-error" : undefined}
            />
            {validationError && (
              <p id="rollback-motivo-error" role="alert" className="mt-1 text-xs text-destructive">
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
            <Button type="submit" variant="destructive" disabled={isPending}>
              {isPending ? "Restaurando…" : "Confirmar rollback"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
