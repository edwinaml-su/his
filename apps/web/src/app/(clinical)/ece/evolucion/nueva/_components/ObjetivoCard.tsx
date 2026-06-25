"use client";

import * as React from "react";
import { Button } from "@his/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { useEvolucionDraft } from "../_hooks/useEvolucionDraft";

interface Props {
  onAbrir: () => void;
}

export function ObjetivoCard({ onAbrir }: Props) {
  const { draft } = useEvolucionDraft();
  const texto = draft.objetivo;

  return (
    <Card className="border-l-4 border-teal-300 dark:border-teal-700">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-teal-600 text-xs font-bold text-white">O</span>
            <CardTitle className="text-sm font-bold uppercase tracking-wide">Objetivo</CardTitle>
          </div>
          {texto && (
            <Button type="button" variant="outline" size="sm" onClick={onAbrir}>
              Editar
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Hallazgos al examen físico, resultados recientes.
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
              Llenar objetivo
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
