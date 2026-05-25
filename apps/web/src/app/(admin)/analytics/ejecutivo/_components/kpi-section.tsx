"use client";

/**
 * KpiSection — sección colapsable por categoría. Permite al usuario contraer
 * las categorías que no le interesan para enfoque visual.
 */
import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@his/ui/lib/utils";

interface KpiSectionProps {
  id: string;
  titulo: string;
  count: number;
  /** Default abierto/cerrado. Por defecto: abierto (true). */
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function KpiSection({ id, titulo, count, defaultOpen = true, children }: KpiSectionProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <section
      id={id}
      className="rounded-md border bg-card print:break-inside-avoid-page"
      aria-labelledby={`${id}-title`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={`${id}-content`}
        className="flex w-full items-center justify-between gap-2 rounded-t-md px-4 py-3 text-left transition-colors hover:bg-muted/50"
      >
        <h2 id={`${id}-title`} className="text-base font-semibold leading-tight">
          {titulo}
        </h2>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded bg-muted px-1.5 py-0.5 tabular-nums">{count} KPI</span>
          {open ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
        </div>
      </button>
      <div
        id={`${id}-content`}
        className={cn(
          "grid gap-3 px-4 pb-4 print:!block print:!visible",
          open ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" : "hidden",
        )}
      >
        {children}
      </div>
    </section>
  );
}
