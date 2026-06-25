"use client";

/**
 * Tarjeta trigger del agrupador "Problemas".
 *
 * Cuando isCompleted=false: CTA "Completar problemas".
 * Cuando isCompleted=true : muestra preview truncado (S / O / signos) + botón Editar.
 */

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import type { ProblemasValue } from "./ProblemasModal";

// ─── Helper preview ──────────────────────────────────────────────────────────

function truncate(text: string, max = 80): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

/** Genera una línea de resumen de signos vitales ingresados (no vacíos). */
function signosResumen(signos: ProblemasValue["signos"]): string {
  const parts: string[] = [];
  if (signos.presionSistolica && signos.presionDiastolica) {
    parts.push(`TA ${signos.presionSistolica}/${signos.presionDiastolica}`);
  }
  if (signos.frecuenciaCardiaca) parts.push(`FC ${signos.frecuenciaCardiaca}`);
  if (signos.frecuenciaRespiratoria) parts.push(`FR ${signos.frecuenciaRespiratoria}`);
  if (signos.temperatura) parts.push(`T° ${signos.temperatura}`);
  if (signos.saturacionO2) parts.push(`SpO₂ ${signos.saturacionO2}%`);
  return parts.join(" · ");
}

// ─── Componente ──────────────────────────────────────────────────────────────

interface ProblemasCardProps {
  value: ProblemasValue;
  isCompleted: boolean;
  onEdit: () => void;
}

export function ProblemasCard({ value, isCompleted, onEdit }: ProblemasCardProps) {
  const signosLine = signosResumen(value.signos);

  return (
    <Card className="border-l-4 border-blue-300 dark:border-blue-700">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide">
            Problemas
          </CardTitle>
          {isCompleted && (
            <Badge variant="secondary" className="text-xs">Completado</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isCompleted ? (
          <div className="space-y-2">
            {value.subjetivo && (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">S:</span>{" "}
                {truncate(value.subjetivo)}
              </p>
            )}
            {value.objetivo && (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">O:</span>{" "}
                {truncate(value.objetivo)}
              </p>
            )}
            {signosLine && (
              <p className="text-xs text-muted-foreground">Signos: {signosLine}</p>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onEdit}
              aria-label="Editar problemas"
            >
              Editar
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Ingrese subjetivo (S), objetivo (O) y signos vitales.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onEdit}
              aria-label="Completar sección Problemas"
            >
              Completar problemas
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
