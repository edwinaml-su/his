"use client";

import * as React from "react";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { useEvolucionDraft } from "../_hooks/useEvolucionDraft";

const IcoPlus = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="h-4 w-4">
    <path d="M12 5v14M5 12h14" />
  </svg>
);
const IcoEdit = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
    <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
);
const IcoDel = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
  </svg>
);

interface Props {
  onAgregar: () => void;
  onEditar: (id: string) => void;
}

export function PlanSection({ onAgregar, onEditar }: Props) {
  const { draft, dispatch } = useEvolucionDraft();
  const { plan } = draft;

  function handleDelete(id: string) {
    if (!window.confirm("¿Eliminar esta indicación del plan?")) return;
    dispatch({ type: "DELETE_PLAN", id });
  }

  return (
    <Card className="border-l-4 border-slate-300 dark:border-slate-600">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-700 text-xs font-bold text-white dark:bg-slate-600">P</span>
              <CardTitle className="text-sm font-bold uppercase tracking-wide">Plan</CardTitle>
              <Badge variant="secondary" className="text-xs">{plan.length}</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Indicaciones, conducta, seguimiento, interconsultas. Agrega una a una.
            </p>
          </div>
          <Button type="button" variant="default" size="sm" onClick={onAgregar} className="shrink-0">
            <IcoPlus />
            Agregar al plan
          </Button>
        </div>
      </CardHeader>

      <CardContent className="px-0 pb-0">
        {plan.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-7 text-sm text-muted-foreground">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5 text-muted-foreground/50">
              <path d="M9 11l3 3 7-8M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8" />
            </svg>
            {'Aún no hay indicaciones. Use "Agregar al plan".'}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {plan.map((it, i) => (
              <div key={it.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-muted/40 text-xs font-bold tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1 text-sm text-foreground">{it.texto}</div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => onEditar(it.id)}
                    title="Editar"
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <IcoEdit />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(it.id)}
                    title="Eliminar"
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
                  >
                    <IcoDel />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
