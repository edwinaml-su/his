"use client";

/**
 * Sección de Signos vitales (CC-0006, ajuste Avante).
 *
 * Tarjeta-resumen ubicada ARRIBA de Objetivo. Muestra chips + alertas críticas;
 * la captura/edición vive en VitalesModal. Núcleo (TA, FC, FR, T°, SpO₂) es
 * obligatorio para firmar (ver puedeFirmar en _lib/types).
 */

import * as React from "react";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { useEvolucionDraft } from "../_hooks/useEvolucionDraft";
import { computeAlertasVitales } from "../../../../../../lib/evolucion/signos-vitales";
import { tieneSignos } from "../_lib/types";

interface Props {
  onAbrir: () => void;
}

export function SignosSection({ onAbrir }: Props) {
  const { draft } = useEvolucionDraft();
  const signos = draft.signos;
  const haySignos = tieneSignos(signos);

  const alertas = haySignos
    ? computeAlertasVitales({
        presionSistolica: signos.presionSistolica !== "" ? Number(signos.presionSistolica) : null,
        presionDiastolica: signos.presionDiastolica !== "" ? Number(signos.presionDiastolica) : null,
        frecuenciaCardiaca: signos.frecuenciaCardiaca !== "" ? Number(signos.frecuenciaCardiaca) : null,
        frecuenciaRespiratoria: signos.frecuenciaRespiratoria !== "" ? Number(signos.frecuenciaRespiratoria) : null,
        temperatura: signos.temperatura !== "" ? Number(signos.temperatura) : null,
        saturacionO2: signos.saturacionO2 !== "" ? Number(signos.saturacionO2) : null,
        dolorEva: signos.escalaDolor,
      })
    : [];

  return (
    <Card className="border-l-4 border-rose-300 dark:border-rose-700">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-rose-500 text-xs font-bold text-white">V</span>
            <CardTitle className="text-sm font-bold uppercase tracking-wide">Signos vitales</CardTitle>
          </div>
          {haySignos && (
            <Button type="button" variant="outline" size="sm" onClick={onAbrir}>
              Editar
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          TA, FC, FR, temperatura y SpO₂ son obligatorios para firmar.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {haySignos ? (
          <>
            <div className="flex flex-wrap gap-1.5">
              {signos.presionSistolica && signos.presionDiastolica && (
                <span className="rounded-md border bg-muted/40 px-2 py-0.5 text-xs font-medium">
                  TA {signos.presionSistolica}/{signos.presionDiastolica} mmHg
                </span>
              )}
              {signos.frecuenciaCardiaca && (
                <span className="rounded-md border bg-muted/40 px-2 py-0.5 text-xs font-medium">
                  FC {signos.frecuenciaCardiaca} lpm
                </span>
              )}
              {signos.frecuenciaRespiratoria && (
                <span className="rounded-md border bg-muted/40 px-2 py-0.5 text-xs font-medium">
                  FR {signos.frecuenciaRespiratoria} rpm
                </span>
              )}
              {signos.temperatura && (
                <span className="rounded-md border bg-muted/40 px-2 py-0.5 text-xs font-medium">
                  T° {signos.temperatura} °C
                </span>
              )}
              {signos.saturacionO2 && (
                <span className="rounded-md border bg-muted/40 px-2 py-0.5 text-xs font-medium">
                  SpO₂ {signos.saturacionO2}%
                </span>
              )}
              {signos.escalaDolor > 0 && (
                <span className="rounded-md border bg-muted/40 px-2 py-0.5 text-xs font-medium">
                  Dolor {signos.escalaDolor}/10
                </span>
              )}
            </div>
            {alertas.length > 0 && (
              <div className="flex flex-wrap gap-1" role="alert">
                {alertas.map((a) => (
                  <Badge key={a} variant="destructive" className="text-xs">
                    {a}
                  </Badge>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">Sin registrar.</span>
            <Button type="button" size="sm" onClick={onAbrir}>
              Registrar signos vitales
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
