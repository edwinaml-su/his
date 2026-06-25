"use client";

import * as React from "react";
import { Button } from "@his/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { useEvolucionDraft } from "../_hooks/useEvolucionDraft";

interface Props {
  onAbrir: () => void;
}

export function AnalisisCard({ onAbrir }: Props) {
  const { draft } = useEvolucionDraft();
  const texto = draft.analisis;

  return (
    <Card className="border-l-4 border-amber-300 dark:border-amber-700">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-500 text-xs font-bold text-white">A</span>
            <CardTitle className="text-sm font-bold uppercase tracking-wide">Evaluación / Análisis</CardTitle>
          </div>
          {texto && (
            <Button type="button" variant="outline" size="sm" onClick={onAbrir}>
              Editar
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Diagnóstico o impresión diagnóstica, evolución del cuadro.
        </p>
      </CardHeader>
      <CardContent>
        {texto ? (
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
            {texto}
          </p>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">Sin registrar.</span>
            <Button type="button" size="sm" onClick={onAbrir}>
              Llenar análisis
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
