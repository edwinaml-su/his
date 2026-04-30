"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { cn } from "../lib/utils";
import { Input } from "./input";

interface PatientSearchBarProps {
  defaultValue?: string;
  placeholder?: string;
  onSearch: (q: string) => void;
  /** Debounce en ms (default 300). */
  debounceMs?: number;
  className?: string;
}

/**
 * Barra de búsqueda con debounce para el MPI (TDR §8.1).
 * El consumidor recibe la query y resuelve los resultados.
 */
export function PatientSearchBar({
  defaultValue = "",
  placeholder = "Buscar por nombre, MRN o DUI…",
  onSearch,
  debounceMs = 300,
  className,
}: PatientSearchBarProps) {
  const [value, setValue] = React.useState(defaultValue);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onSearch(value.trim()), debounceMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, debounceMs, onSearch]);

  return (
    <div className={cn("relative w-full max-w-xl", className)}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label="Búsqueda de pacientes"
        className="pl-9"
      />
    </div>
  );
}
