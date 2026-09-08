"use client";

/**
 * Rediseño lab 2026-09 — modal de Parámetros de una prueba (mockup `#ppmOverlay`).
 * Lista + agregar (input + botón/Enter) + quitar. Duplicado → mensaje CONFLICT
 * del backend (`testParameter.add` → `rethrowUniqueConflict`).
 */
import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { trpc } from "@/lib/trpc/react";

interface LabParamModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  testId: string;
  testName: string;
}

export function LabParamModal({ open, onOpenChange, testId, testName }: LabParamModalProps) {
  const [newParam, setNewParam] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const utils = trpc.useUtils();

  const query = trpc.lis.testParameter.list.useQuery({ labTestId: testId }, { enabled: open });

  const addMutation = trpc.lis.testParameter.add.useMutation({
    onSuccess: () => {
      utils.lis.testParameter.list.invalidate({ labTestId: testId });
      utils.lis.catalog.cascada.invalidate();
      setNewParam("");
      setError(null);
    },
    onError: (err) => setError(err.message),
  });
  const removeMutation = trpc.lis.testParameter.remove.useMutation({
    onSuccess: () => {
      utils.lis.testParameter.list.invalidate({ labTestId: testId });
      utils.lis.catalog.cascada.invalidate();
    },
    onError: (err) => setError(err.message),
  });

  const handleAdd = () => {
    const v = newParam.trim();
    if (!v) return;
    addMutation.mutate({ labTestId: testId, name: v });
  };

  const rows = query.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto" data-testid="lab-param-modal">
        <DialogHeader>
          <DialogTitle>Parámetros · {testName}</DialogTitle>
          <DialogDescription>Configure los parámetros (analitos) de esta prueba.</DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Input
            value={newParam}
            onChange={(e) => setNewParam(e.target.value)}
            placeholder="Nuevo parámetro..."
            aria-label="Nuevo parámetro"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAdd();
              }
            }}
          />
          <Button type="button" onClick={handleAdd} disabled={addMutation.isPending}>
            Agregar
          </Button>
        </div>

        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <div className="divide-y rounded-md border">
          {rows.length === 0 ? (
            <p className="p-3 text-sm italic text-muted-foreground">
              Esta prueba no tiene parámetros. Agréguelos arriba.
            </p>
          ) : (
            rows.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>{p.name}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => removeMutation.mutate({ parameterId: p.id })}
                  disabled={removeMutation.isPending}
                >
                  Quitar
                </Button>
              </div>
            ))
          )}
        </div>

        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
