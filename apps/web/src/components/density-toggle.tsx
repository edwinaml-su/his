"use client";

import * as React from "react";
import { Rows3, Rows4 } from "lucide-react";
import { Button } from "@his/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@his/ui/components/tooltip";
import { useDensity } from "@/lib/use-density";

/**
 * DensityToggle — alterna la densidad de la interfaz entre "cómoda" y "compacta".
 *
 * Usa el hook `useDensity` que persiste en localStorage y sincroniza
 * `data-density` en `<html>` para activar los tokens CSS de Tarea 1.
 *
 * Touch target mínimo 44×44px (min-h-11 min-w-11) — §3 restricción inviolable.
 */
export function DensityToggle() {
  const { density, setDensity, mounted } = useDensity();

  // SSR placeholder: tamaño igual al botón final para evitar layout shift.
  if (!mounted) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0 min-h-11 min-w-11"
        aria-label="Cambiar densidad de la interfaz"
        disabled
      >
        <Rows3 className="h-4 w-4 opacity-50" aria-hidden />
      </Button>
    );
  }

  const isCompact = density === "compact";

  function toggle() {
    setDensity(isCompact ? "comfortable" : "compact");
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          onClick={toggle}
          className="h-8 w-8 p-0 min-h-11 min-w-11"
          aria-label="Cambiar densidad de la interfaz"
          aria-pressed={isCompact}
        >
          {isCompact ? (
            <Rows4 className="h-4 w-4" aria-hidden />
          ) : (
            <Rows3 className="h-4 w-4" aria-hidden />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {isCompact ? "Densidad: compacta" : "Densidad: cómoda"}
      </TooltipContent>
    </Tooltip>
  );
}
