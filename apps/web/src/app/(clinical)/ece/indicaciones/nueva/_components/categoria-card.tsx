"use client";

/**
 * CC-0026 Ola 2 — tarjeta de categoría del grid CPOE (ESP-MOCKUP-0026).
 * Cuadro de solo lectura (máx. `MAX_LINES` líneas visibles, salvo `freeBox`)
 * que abre el modal de captura al hacer click, igual que `renderCats()` del
 * mockup.
 */
import * as React from "react";
import { cn } from "@his/ui/lib/utils";
import { CATEGORIAS, MAX_LINES, type CategoriaKey, type EntradaCategoria } from "./cats-config";

export function CategoriaGrid({
  entradas,
  diariaPendientes,
  onAbrir,
  onQuitar,
}: {
  entradas: Record<CategoriaKey, EntradaCategoria[]>;
  /** Categorías obligatorias en Subsecuente/Indicación diaria (todas sin líneas). */
  diariaPendientes: boolean;
  onAbrir: (key: CategoriaKey) => void;
  onQuitar: (key: CategoriaKey, id: string) => void;
}) {
  return (
    // Una sola columna apilada — el mockup NO define grid para #cats
    // (.catcard es block + margin-bottom): el orden vertical mov → dieta →
    // cuidados → med → lab → gab → proc → inter es secuencia clínica, no
    // decoración (corrección UAT Edwin 2026-08-26).
    <div className="grid gap-3">
      {CATEGORIAS.map((cat) => {
        const lineas = entradas[cat.key] ?? [];
        const full = !cat.freeBox && lineas.length >= MAX_LINES;
        const pendienteDiaria = diariaPendientes && lineas.length === 0;
        return (
          <div
            key={cat.key}
            className={cn(
              "overflow-hidden rounded-xl border bg-card",
              pendienteDiaria && "outline outline-2 outline-offset-[-2px] outline-destructive",
            )}
            style={{ borderLeft: `4px solid ${cat.color}` }}
            title={pendienteDiaria ? "Acápite obligatorio en la indicación diaria" : undefined}
          >
            <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
              <span aria-hidden="true">{cat.icon}</span>
              <span className="text-sm font-semibold">{cat.label}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {cat.freeBox ? "" : `${lineas.length}/${MAX_LINES}${full ? " · completo" : " líneas"}`}
              </span>
              <button
                type="button"
                className={cn(
                  "rounded-md border px-3 py-1 text-xs font-semibold transition-colors",
                  full
                    ? "cursor-not-allowed border-muted text-muted-foreground"
                    : "border-blue-600 text-blue-600 hover:bg-blue-600 hover:text-white",
                )}
                disabled={full}
                onClick={() => onAbrir(cat.key)}
                data-testid={`btn-agregar-${cat.key}`}
                aria-label={`Agregar ${cat.label}`}
              >
                + Agregar
              </button>
            </div>
            <button
              type="button"
              className={cn(
                "block h-[92px] w-full overflow-y-auto px-3 py-2 text-left text-sm",
                full ? "cursor-default" : "cursor-pointer hover:bg-muted/30",
              )}
              onClick={() => !full && onAbrir(cat.key)}
              disabled={full}
              data-testid={`box-${cat.key}`}
            >
              {lineas.length === 0 ? (
                <span className="italic text-muted-foreground">
                  hacé clic para llenar con el formulario…
                </span>
              ) : (
                <ul className="space-y-1">
                  {lineas.map((l, idx) => (
                    <li key={l.id} className="flex items-start justify-between gap-2 whitespace-pre-line">
                      <span>{l.descripcion}</span>
                      <button
                        type="button"
                        className="shrink-0 text-xs text-destructive"
                        aria-label={`Quitar línea ${idx + 1} de ${cat.label}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onQuitar(cat.key, l.id);
                        }}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}
