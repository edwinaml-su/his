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
  const dterm = useDebounced(term, 300);

  const estadoQ = trpc.cie11.estado.useQuery(undefined, { staleTime: 300_000 });
  const buscarQ = trpc.cie11.buscar.useQuery(
    { q: dterm.trim(), limit: 10 },
    { enabled: dterm.trim().length >= 2, staleTime: 60_000 },
  );

  const items = buscarQ.data?.items ?? [];
  const configured = estadoQ.data?.configured ?? true;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Buscar diagnóstico CIE-11</Label>
      <div className="relative">
        <Input
          id={id}
          placeholder="Escriba ≥2 caracteres (ej. neumonía, diabetes)…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          disabled={disabled || !configured}
          autoComplete="off"
        />
        {dterm.trim().length >= 2 && (items.length > 0 || buscarQ.isFetching) && (
          <ul
            className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover shadow-md"
            aria-label="Resultados CIE-11"
          >
            {buscarQ.isFetching && (
              <li className="px-3 py-2 text-sm text-muted-foreground">Buscando…</li>
            )}
            {items.map((it) => (
              <li key={it.uri || it.codigo}>
                <button
                  type="button"
                  className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    onSelect({ codigo: it.codigo, titulo: it.titulo, uri: it.uri });
                    setTerm("");
                  }}
                >
                  {it.codigo && (
                    <span className="font-mono text-xs text-muted-foreground">{it.codigo}</span>
                  )}
                  <span>{it.titulo}</span>
                </button>
              </li>
            ))}
            {!buscarQ.isFetching && items.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted-foreground">Sin resultados.</li>
            )}
          </ul>
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
