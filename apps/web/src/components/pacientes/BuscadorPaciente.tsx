"use client";

import * as React from "react";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { trpc } from "@/lib/trpc/react";

export interface PacienteSeleccion {
  id: string;
  nombre: string;
  mrn: string | null;
  documento?: string | null;
}

interface Props {
  onSelect: (p: PacienteSeleccion) => void;
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

export function BuscadorPaciente({ onSelect, disabled, id = "buscar-paciente" }: Props) {
  const [term, setTerm] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const dterm = useDebounced(term, 300);

  const buscarQ = trpc.patient.search.useQuery(
    { query: dterm.trim(), limit: 10 },
    { enabled: dterm.trim().length >= 2, staleTime: 60_000 },
  );

  const items = buscarQ.data ?? [];
  const open = dterm.trim().length >= 2 && (items.length > 0 || buscarQ.isFetching);

  const listboxId = React.useId();
  const optionId = (i: number) => `${listboxId}-opt-${i}`;

  // Resetear activeIndex cuando cambian los resultados o el término.
  React.useEffect(() => { setActiveIndex(-1); }, [buscarQ.data, dterm]);

  function handleSelect(item: (typeof items)[number]) {
    const primaryDoc = item.identifiers[0]?.value ?? null;
    const nombreCompleto = [item.lastName, item.secondLastName, item.firstName]
      .filter(Boolean)
      .join(" ");
    onSelect({
      id: item.id,
      nombre: nombreCompleto,
      mrn: item.mrn ?? null,
      documento: primaryDoc,
    });
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
      <Label htmlFor={id}>Buscar paciente (nombre, MRN o documento)</Label>
      <div className="relative">
        <Input
          id={id}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          placeholder="Escriba ≥2 caracteres…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          autoComplete="off"
        />
        {open && (
          <ul
            role="listbox"
            id={listboxId}
            aria-label="Resultados de pacientes"
            className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover shadow-md"
          >
            {items.map((item, i) => {
              const nombreCompleto = [item.lastName, item.secondLastName, item.firstName]
                .filter(Boolean)
                .join(" ");
              const meta = [item.mrn, item.identifiers[0]?.value].filter(Boolean).join(" · ");
              return (
                <li
                  key={item.id}
                  role="option"
                  id={optionId(i)}
                  aria-selected={i === activeIndex}
                  className={`flex cursor-pointer flex-col gap-0.5 px-3 py-2 text-sm hover:bg-accent${i === activeIndex ? " bg-accent" : ""}`}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setActiveIndex(i)}
                >
                  <span>{nombreCompleto}</span>
                  {meta && (
                    <span className="font-mono text-xs text-muted-foreground">{meta}</span>
                  )}
                </li>
              );
            })}
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
    </div>
  );
}
