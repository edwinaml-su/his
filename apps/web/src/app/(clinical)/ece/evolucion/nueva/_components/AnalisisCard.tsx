"use client";

import * as React from "react";
import { Button } from "@his/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { useEvolucionDraft } from "../_hooks/useEvolucionDraft";
import { SECCION, SECCION_ACCENT } from "../_lib/avante-palette";
import { SecEmptyBox } from "./SecEmptyBox";
import { ReqPill } from "./SubBloque";

interface Props {
  onAbrir: () => void;
}

export function AnalisisCard({ onAbrir }: Props) {
  const { draft } = useEvolucionDraft();
  const texto = draft.analisis;

  return (
    <Card className={`overflow-hidden ${SECCION.analisis.card}`}>
      <CardHeader className={`border-b border-border pb-3 ${SECCION.analisis.head}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className={`flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold text-white ${SECCION.analisis.badge}`}>A</span>
            <CardTitle className="text-sm font-bold uppercase tracking-wide">Evaluación / Análisis</CardTitle>
            <ReqPill />
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
          <SecEmptyBox cue="análisis" color={SECCION_ACCENT.analisis} onClick={onAbrir} />
        )}
      </CardContent>
    </Card>
  );
}
