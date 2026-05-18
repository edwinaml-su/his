"use client";

/**
 * ICD10Picker — Componente autocomplete reutilizable de selección CIE-10.
 *
 * Uso:
 *   <ICD10Picker
 *     value={codigo}
 *     onChange={(codigo, descripcion) => setDiagnostico({ codigo, descripcion })}
 *     label="Diagnóstico principal"
 *     placeholder="Buscar por código o descripción…"
 *     required
 *   />
 *
 * Accesibilidad: WCAG 2.2 AA.
 *   - combobox role, aria-expanded, aria-controls, aria-autocomplete
 *   - Teclado: ↑↓ navega lista, Enter selecciona, Escape cierra
 *   - aria-live region anuncia resultados
 */

import * as React from "react";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Badge } from "@his/ui/components/badge";
import { trpc } from "@/lib/trpc/react";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface Icd10Item {
  codigo: string;
  descripcion: string;
  capitulo?: string | null;
  grupo?: string | null;
}

export interface ICD10PickerProps {
  /** Código seleccionado actualmente (controlado). */
  value?: string;
  /** Callback al seleccionar un código. */
  onChange: (item: Icd10Item | null) => void;
  label?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  /** ID HTML para asociar label externo vía aria-labelledby. */
  id?: string;
  /** Muestra advertencias de combinación cuando se recibe. */
  warnings?: string[];
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function ICD10Picker({
  value,
  onChange,
  label = "Código CIE-10",
  placeholder = "Buscar por código o descripción…",
  required = false,
  disabled = false,
  id = "icd10-picker",
  warnings = [],
}: ICD10PickerProps) {
  const [query, setQuery] = React.useState(value ?? "");
  const [open, setOpen] = React.useState(false);
  const [highlighted, setHighlighted] = React.useState(0);
  const listRef = React.useRef<HTMLUListElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const { data, isLoading } = trpc.icd10.search.useQuery(
    { q: query, limit: 10 },
    {
      enabled: query.length >= 2 && open,
      staleTime: 60_000,
    },
  );

  const items: Icd10Item[] = data?.items ?? [];

  // Sincronizar query con value externo cuando cambia desde fuera
  React.useEffect(() => {
    if (value !== undefined && value !== query) {
      setQuery(value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function handleSelect(item: Icd10Item) {
    setQuery(item.codigo);
    setOpen(false);
    onChange(item);
  }

  function handleClear() {
    setQuery("");
    setOpen(false);
    onChange(null);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || items.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[highlighted];
      if (item) handleSelect(item);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const listId = `${id}-listbox`;

  return (
    <div className="relative w-full">
      {label && (
        <Label htmlFor={id} className="mb-1 block text-sm font-medium">
          {label}
          {required && (
            <span className="ml-1 text-destructive" aria-hidden="true">
              *
            </span>
          )}
        </Label>
      )}

      <div className="relative">
        <Input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-required={required}
          autoComplete="off"
          disabled={disabled}
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlighted(0);
            setOpen(e.target.value.length >= 2);
          }}
          onFocus={() => {
            if (query.length >= 2) setOpen(true);
          }}
          onBlur={() => {
            // Delay para permitir click en la lista
            setTimeout(() => setOpen(false), 150);
          }}
          onKeyDown={handleKeyDown}
          className={warnings.length > 0 ? "border-amber-400 focus-visible:ring-amber-400" : ""}
        />

        {/* Botón limpiar */}
        {query && !disabled && (
          <button
            type="button"
            aria-label="Limpiar selección CIE-10"
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            ×
          </button>
        )}
      </div>

      {/* Lista de sugerencias */}
      {open && (
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          aria-label="Resultados CIE-10"
          className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-popover shadow-md"
        >
          {isLoading && (
            <li className="px-3 py-2 text-sm text-muted-foreground" aria-live="polite">
              Buscando…
            </li>
          )}

          {!isLoading && items.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground" aria-live="polite">
              Sin resultados para &ldquo;{query}&rdquo;
            </li>
          )}

          {items.map((item, idx) => (
            <li
              key={item.codigo}
              role="option"
              aria-selected={highlighted === idx}
              className={`flex cursor-pointer items-start gap-2 px-3 py-2 text-sm ${
                highlighted === idx
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/50"
              }`}
              onMouseDown={() => handleSelect(item)}
              onMouseEnter={() => setHighlighted(idx)}
            >
              <Badge variant="outline" className="shrink-0 font-mono text-xs">
                {item.codigo}
              </Badge>
              <span className="line-clamp-2">{item.descripcion}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Anuncio accesible del número de resultados */}
      <div aria-live="assertive" className="sr-only">
        {open && !isLoading && `${items.length} resultado${items.length !== 1 ? "s" : ""} CIE-10`}
      </div>

      {/* Advertencias de combinación */}
      {warnings.length > 0 && (
        <div
          role="alert"
          aria-live="polite"
          className="mt-1 space-y-1"
        >
          {warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-600">
              ⚠ {w}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
