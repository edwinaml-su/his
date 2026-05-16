"use client";

/**
 * Formulario de cierre post-operatorio.
 * Captura nota post-op y llama a `surgery.case.complete` (POST_OP → COMPLETED).
 */
import * as React from "react";
import { Button } from "@his/ui/components/button";
import { Label } from "@his/ui/components/label";

interface Props {
  caseId: string;
  alreadyCompleted: boolean;
  existingNotes?: string | null;
  onComplete: (notes: string) => Promise<void>;
  isPending?: boolean;
}

export function PostOpForm({
  alreadyCompleted,
  existingNotes,
  onComplete,
  isPending = false,
}: Props) {
  const [notes, setNotes] = React.useState(existingNotes ?? "");
  const [error, setError] = React.useState<string | null>(null);

  if (alreadyCompleted) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium text-green-700">Caso completado.</p>
        {existingNotes && (
          <div className="rounded border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground mb-1">Nota post-op:</p>
            <p className="text-sm whitespace-pre-wrap">{existingNotes}</p>
          </div>
        )}
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await onComplete(notes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al completar el caso.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="postop-notes">Nota post-operatoria</Label>
        <textarea
          id="postop-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          placeholder="Descripción del post-operatorio, evolución, indicaciones…"
          disabled={isPending}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={isPending}>
        {isPending ? "Guardando…" : "Completar caso"}
      </Button>
    </form>
  );
}
