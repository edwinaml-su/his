"use client";

/**
 * CC-0011 WS-C — Botón de acción de catálogo que se deshabilita para filas
 * globales (organizationId=null, seed AVT-*) con tooltip explicativo.
 *
 * Nota Radix: un <button disabled> no dispara eventos de puntero/foco, así que
 * el TooltipTrigger no vería hover/focus si envolviera el botón directamente.
 * Se envuelve en un <span tabIndex=0> para que el tooltip siga siendo accesible
 * por teclado y mouse aun con el botón real deshabilitado.
 */
import * as React from "react";
import { Button, type ButtonProps } from "@his/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@his/ui/components/tooltip";

interface GlobalLockButtonProps extends ButtonProps {
  /** true = fila del catálogo global (solo lectura para el tenant). */
  isGlobal: boolean;
}

export function GlobalLockButton({ isGlobal, disabled, children, ...props }: GlobalLockButtonProps) {
  if (!isGlobal) {
    return (
      <Button disabled={disabled} {...props}>
        {children}
      </Button>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-block">
          <Button disabled {...props}>
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>Catálogo global — solo lectura</TooltipContent>
    </Tooltip>
  );
}
