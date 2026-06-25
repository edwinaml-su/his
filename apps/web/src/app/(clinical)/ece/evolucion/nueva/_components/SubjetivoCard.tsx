"use client";

import * as React from "react";
import { Button } from "@his/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { useEvolucionDraft } from "../_hooks/useEvolucionDraft";

interface Props {
  onAbrir: () => void;
}

export function SubjetivoCard({ onAbrir }: Props) {
  const { draft } = useEvolucionDraft();
  const texto = draft.subjetivo;

  return (
    <Card className="border-l-4 border-indigo-300 dark:border-indigo-700">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-500 text-xs font-bold text-white">S</span>
            <CardTitle className="text-sm font-bold uppercase tracking-wide">Subjetivo</CardTitle>
          </div>
          {texto && (
            <Button type="button" variant="outline" size="sm" onClick={onAbrir}>
              Editar
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Relato del paciente: motivo de consulta, síntomas, evolución.
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
              Llenar subjetivo
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
