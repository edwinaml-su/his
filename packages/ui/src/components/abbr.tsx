"use client";

/**
 * <Abbr term="UUID" />
 *
 * Renderiza el `term` con un tooltip que muestra su significado en español
 * (siempre) y en inglés (si la abreviatura es originalmente inglesa).
 *
 * Uso típico:
 *
 *   <p>Filtra por <Abbr term="UUID" /> del usuario.</p>
 *   <Label>Proveedor <Abbr term="UUID" /></Label>
 *   <h1><Abbr term="HIS" /> Avante</h1>
 *
 * Si el término no está registrado en `abbreviations.ts`, se renderiza
 * como texto plano sin tooltip — failsafe para no romper UI.
 *
 * Accesibilidad:
 *   - Usa el tag HTML semántico `<abbr title="…">` como fallback (lectores
 *     de pantalla anuncian la expansión).
 *   - El tooltip Radix gestiona aria-describedby automáticamente.
 *   - El término se subraya punteado (estilo browser default de <abbr>) para
 *     indicar visualmente que es interactivo.
 */
import * as React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";
import { lookupAbbreviation } from "../lib/abbreviations";

export interface AbbrProps {
  /** Sigla a expandir (ej. "UUID", "DUI", "eMAR"). */
  term: string;
  /** Children opcional — si se omite, se usa `term` como display text. */
  children?: React.ReactNode;
  /** className extra para el span. */
  className?: string;
}

export function Abbr({ term, children, className }: AbbrProps) {
  const def = lookupAbbreviation(term);
  const display = children ?? term;

  if (!def) {
    // Failsafe: no hay definición → renderizar texto plano sin tooltip.
    return <span className={className}>{display}</span>;
  }

  const titleText = def.en ? `${def.es}\n\n(EN) ${def.en}` : def.es;

  return (
    <TooltipProvider delayDuration={150} skipDelayDuration={50}>
      <Tooltip>
        <TooltipTrigger asChild>
          <abbr
            title={titleText}
            className={
              className ??
              "cursor-help underline decoration-dotted decoration-muted-foreground/60 underline-offset-2"
            }
          >
            {display}
          </abbr>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          <p>{def.es}</p>
          {def.en && (
            <p className="mt-1 opacity-80">
              <span className="font-semibold">EN:</span> {def.en}
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
