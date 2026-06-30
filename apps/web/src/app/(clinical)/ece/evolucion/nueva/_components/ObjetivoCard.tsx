"use client";

/**
 * §10 — Objetivo: tarjeta verde contenedora de sub-bloques: Signos vitales
 * (§10.1), Registro de objetivo (§10.2) y Antecedentes (§10.3).
 */

import * as React from "react";
import { Button } from "@his/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { useEvolucionDraft } from "../_hooks/useEvolucionDraft";
import { SECCION, SECCION_ACCENT } from "../_lib/avante-palette";
import { SignosSection } from "./SignosSection";
import { AntecedentesSection } from "./AntecedentesSection";
import { SubBloque } from "./SubBloque";
import { SecEmptyBox } from "./SecEmptyBox";

interface Props {
  onAbrirVitales: () => void;
  onAbrirObjetivo: () => void;
}

export function ObjetivoCard({ onAbrirVitales, onAbrirObjetivo }: Props) {
  const { draft } = useEvolucionDraft();
  const texto = draft.objetivo;

  return (
    <Card className={`overflow-hidden ${SECCION.objetivo.card}`}>
      <CardHeader className={`border-b border-border pb-3 ${SECCION.objetivo.head}`}>
        <div className="flex items-center gap-2">
          <span className={`flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold text-white ${SECCION.objetivo.badge}`}>O</span>
          <CardTitle className="text-sm font-bold uppercase tracking-wide">Objetivo</CardTitle>
        </div>
        <p className="text-xs text-muted-foreground">
          Signos vitales y hallazgos al examen físico.
        </p>
      </CardHeader>
      <CardContent className="space-y-5 pt-4">
        {/* §10.1 Signos vitales */}
        <SignosSection onAbrir={onAbrirVitales} />

        {/* §10.2 Registro de objetivo */}
        <SubBloque
          titulo="Registro de objetivo"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
              <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6z" />
              <path d="M14 3v6h6M8 13h8M8 17h6" />
            </svg>
          }
          pill="obligatorio"
          accion={
            texto ? (
              <Button type="button" variant="outline" size="sm" onClick={onAbrirObjetivo}>
                Editar
              </Button>
            ) : null
          }
        >
          {texto ? (
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
              {texto}
            </p>
          ) : (
            <SecEmptyBox cue="objetivo" color={SECCION_ACCENT.objetivo} onClick={onAbrirObjetivo} />
          )}
        </SubBloque>

        {/* §10.3 Antecedentes (colapsable, opcional) */}
        <AntecedentesSection />
      </CardContent>
    </Card>
  );
}
