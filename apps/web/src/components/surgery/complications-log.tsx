"use client";

/**
 * Log de complicaciones intra-operatorias (append-only durante la cirugía).
 *
 * No existe tabla separada en el schema para complicaciones; se almacenan
 * como notas en `intraopNotes` (campo texto). Esta UI permite agregar entradas
 * que se concatenan en ese campo. Si se diseña tabla separada en el futuro,
 * solo cambia el hook — el contrato visual permanece.
 */
import * as React from "react";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";

export interface ComplicationEntry {
  /** Timestamp local del registro. */
  recordedAt: string;
  text: string;
}

/**
 * Parsea el campo `intraopNotes` para extraer entradas de complicaciones
 * separadas por línea con formato "[HH:MM:SS] texto".
 */
export function parseComplicationsFromNotes(notes: string | null | undefined): ComplicationEntry[] {
  if (!notes) return [];
  return notes
    .split("\n")
    .filter((line) => line.startsWith("["))
    .map((line) => {
      const match = /^\[(.+?)\] (.+)$/.exec(line);
      return match
        ? { recordedAt: match[1]!, text: match[2]! }
        : null;
    })
    .filter((e): e is ComplicationEntry => e !== null);
}

/**
 * Serializa una entrada nueva al formato de línea para intraopNotes.
 */
export function serializeComplicationEntry(text: string): string {
  const ts = new Intl.DateTimeFormat("es-SV", { timeStyle: "medium" }).format(new Date());
  return `[${ts}] ${text.trim()}`;
}

interface Props {
  entries: ComplicationEntry[];
  readOnly?: boolean;
  onAdd?: (entry: string) => Promise<void>;
  isPending?: boolean;
}

export function ComplicationsLog({ entries, readOnly = false, onAdd, isPending = false }: Props) {
  const [text, setText] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setError(null);
    try {
      await onAdd?.(text.trim());
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al registrar complicación.");
    }
  }

  return (
    <div className="space-y-3">
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin complicaciones registradas.</p>
      ) : (
        <ol aria-label="Complicaciones registradas" className="space-y-1.5">
          {entries.map((entry, i) => (
            <li
              key={i}
              className="flex items-start gap-2 rounded border border-warning/30 bg-warning/5 px-3 py-2"
            >
              <span className="text-xs tabular-nums text-muted-foreground mt-0.5 shrink-0">
                {entry.recordedAt}
              </span>
              <span className="text-sm">{entry.text}</span>
            </li>
          ))}
        </ol>
      )}

      {!readOnly && (
        <form onSubmit={handleAdd} className="flex items-end gap-2" noValidate>
          <div className="flex-1 space-y-1">
            <Label htmlFor="complication-text">Agregar complicación</Label>
            <Input
              id="complication-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Describe la complicación…"
              disabled={isPending}
              aria-describedby={error ? "comp-error" : undefined}
            />
          </div>
          <Button
            type="submit"
            variant="destructive"
            disabled={!text.trim() || isPending}
            aria-label="Registrar complicación"
          >
            {isPending ? "Registrando…" : "Agregar"}
          </Button>
        </form>
      )}

      {error && (
        <p id="comp-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
