"use client";

/**
 * BuscadorCie11 — componente compartido de búsqueda CIE-11.
 *
 * Extraído de apps/web/src/app/(clinical)/ece/historia-clinica/nueva/page.tsx
 * para reutilizar en Orden de Ingreso (CC-0005) y cualquier formulario futuro.
 *
 * Props:
 *   onSelect — callback con { codigo, titulo, uri? } al seleccionar un ítem.
 *   disabled — deshabilita el input (p.ej. mientras se procesa el formulario).
 *   id       — id HTML para el input (para asociar con <Label>).
 */

import * as React from "react";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { trpc } from "@/lib/trpc/react";

export interface Cie11Selection {
  codigo: string;
  titulo: string;
  uri?: string;
}

interface Props {
  onSelect: (item: Cie11Selection) => void;
  disabled?: boolean;
  id?: string;
}

function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

export function BuscadorCie11({ onSelect, disabled, id = "cie11-buscar" }: Props) {
  const [term, setTerm] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const dterm = useDebounced(term, 300);

  const estadoQ = trpc.cie11.estado.useQuery(undefined, { staleTime: 300_000 });
  const buscarQ = trpc.cie11.buscar.useQuery(
    { q: dterm.trim(), limit: 10 },
    { enabled: dterm.trim().length >= 2, staleTime: 60_000 },
  );

  const items = buscarQ.data?.items ?? [];
  const configured = estadoQ.data?.configured ?? true;
  const open = dterm.trim().length >= 2 && (items.length > 0 || buscarQ.isFetching);

  const listboxId = React.useId();
  const optionId = (i: number) => `${listboxId}-opt-${i}`;

  // Resetear activeIndex cuando cambian los resultados o el término.
  // Usar buscarQ.data (referencia estable de react-query) en lugar de items derivado.
  React.useEffect(() => { setActiveIndex(-1); }, [buscarQ.data, dterm]);

  function handleSelect(it: typeof items[number]) {
    onSelect({ codigo: it.codigo, titulo: it.titulo, uri: it.uri });
    setTerm("");
    setActiveIndex(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (items.length > 0) setActiveIndex((prev) => Math.min(prev + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      if (activeIndex >= 0 && items[activeIndex]) {
        e.preventDefault();
        handleSelect(items[activeIndex]!);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setTerm("");
      setActiveIndex(-1);
    }
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Buscar diagnóstico CIE-11</Label>
      <div className="relative">
        <Input
          id={id}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          placeholder="Escriba ≥2 caracteres (ej. neumonía, diabetes)…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled || !configured}
          autoComplete="off"
        />
        {open && (
          <ul
            role="listbox"
            id={listboxId}
            aria-label="Resultados CIE-11"
            className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover shadow-md"
          >
            {items.map((it, i) => (
              <li
                key={it.uri || it.codigo}
                role="option"
                id={optionId(i)}
                aria-selected={i === activeIndex}
                className={`flex cursor-pointer items-start gap-2 px-3 py-2 text-sm hover:bg-accent${i === activeIndex ? " bg-accent" : ""}`}
                onClick={() => handleSelect(it)}
                onMouseEnter={() => setActiveIndex(i)}
              >
                {it.codigo && (
                  <span className="font-mono text-xs text-muted-foreground">{it.codigo}</span>
                )}
                <span>{it.titulo}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {dterm.trim().length >= 2 && buscarQ.isFetching && "Buscando…"}
        {dterm.trim().length >= 2 && !buscarQ.isFetching && items.length === 0 && "Sin resultados."}
        {open && items.length > 0 && (
          <span className="sr-only">{items.length} resultados</span>
        )}
      </div>
      {!configured && (
        <p className="text-xs text-muted-foreground">
          Catálogo CIE-11 en línea no configurado — ingrese el código y descripción manualmente.
        </p>
      )}
    </div>
  );
}
