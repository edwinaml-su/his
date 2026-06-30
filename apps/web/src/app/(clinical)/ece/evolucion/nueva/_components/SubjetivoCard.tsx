"use client";

import * as React from "react";
import { Button } from "@his/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { useEvolucionDraft } from "../_hooks/useEvolucionDraft";
import { SECCION, SECCION_ACCENT } from "../_lib/avante-palette";
import { SecEmptyBox } from "./SecEmptyBox";

interface Props {
  onAbrir: () => void;
}

export function SubjetivoCard({ onAbrir }: Props) {
  const { draft } = useEvolucionDraft();
  const texto = draft.subjetivo;

  return (
    <Card className={`overflow-hidden ${SECCION.subjetivo.card}`}>
      <CardHeader className={`border-b border-border pb-3 ${SECCION.subjetivo.head}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className={`flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold text-white ${SECCION.subjetivo.badge}`}>S</span>
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
          <SecEmptyBox cue="subjetivo" color={SECCION_ACCENT.subjetivo} onClick={onAbrir} />
        )}
      </CardContent>
    </Card>
  );
}
