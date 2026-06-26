"use client";

/**
 * Textarea clínico (CC-0006 R5.1).
 *
 *   - Corrección ortográfica del navegador en español (spellCheck + lang="es").
 *   - Autocompletado de términos médicos (CIE-11) mientras se escribe: toma la
 *     palabra en curso (token bajo el cursor), consulta `buscarTerminos` del
 *     contexto (proxy a la WHO ICD API) y, al elegir, inserta el término.
 *
 * No importa tRPC directamente: recibe `buscarTerminos` del provider — que es
 * la única frontera tRPC de este árbol (los tests mockean el hook). Si el hook
 * no la provee (o la API no está configurada), degrada a textarea simple.
 */

import * as React from "react";
import { useEvolucionDraft, type TerminoMedico } from "../_hooks/useEvolucionDraft";

interface Props {
  id: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  rows?: number;
  /** Marca el borde como inválido (rojo). */
  invalid?: boolean;
  /** id del mensaje de error asociado (aria-describedby). */
  describedBy?: string;
}

/** Palabra en curso (token sin separadores) que termina en el cursor. */
function tokenEnCursor(text: string, caret: number): { token: string; start: number } {
  const upto = text.slice(0, caret);
  const m = upto.match(/[^\s,.;:/()\n]+$/);
  if (!m) return { token: "", start: caret };
  return { token: m[0], start: caret - m[0].length };
}

export const MedicalTextarea = React.forwardRef<HTMLTextAreaElement, Props>(
  function MedicalTextarea({ id, value, onChange, placeholder, rows = 4, invalid = false, describedBy }, ref) {
    const { buscarTerminos } = useEvolucionDraft();
    const taRef = React.useRef<HTMLTextAreaElement | null>(null);
    const [items, setItems] = React.useState<TerminoMedico[]>([]);
    const [open, setOpen] = React.useState(false);
    const [activeIdx, setActiveIdx] = React.useState(0);
    const reqIdRef = React.useRef(0);
    const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    function setRefs(node: HTMLTextAreaElement | null) {
      taRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
    }

    const fetchSugerencias = React.useCallback(
      (token: string) => {
        if (!buscarTerminos || token.length < 2) {
          setItems([]);
          setOpen(false);
          return;
        }
        const reqId = ++reqIdRef.current;
        void buscarTerminos(token).then((res) => {
          if (reqId !== reqIdRef.current) return; // descartar respuesta stale
          setItems(res);
          setActiveIdx(0);
          setOpen(res.length > 0);
        });
      },
      [buscarTerminos],
    );

    function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
      const next = e.target.value;
      const caret = e.target.selectionStart ?? next.length;
      onChange(next);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const { token } = tokenEnCursor(next, caret);
      debounceRef.current = setTimeout(() => fetchSugerencias(token), 250);
    }

    function insertar(term: TerminoMedico) {
      const ta = taRef.current;
      const caret = ta?.selectionStart ?? value.length;
      const { start } = tokenEnCursor(value, caret);
      const before = value.slice(0, start);
      const after = value.slice(caret);
      const next = `${before}${term.titulo} ${after}`;
      onChange(next);
      setOpen(false);
      setItems([]);
      const pos = before.length + term.titulo.length + 1;
      requestAnimationFrame(() => {
        if (ta) {
          ta.focus();
          ta.setSelectionRange(pos, pos);
        }
      });
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
      if (!open || items.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % items.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + items.length) % items.length);
      } else if (e.key === "Enter") {
        const it = items[activeIdx];
        if (it) {
          e.preventDefault();
          insertar(it);
        }
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }

    React.useEffect(
      () => () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
      },
      [],
    );

    const listId = `${id}-medterms`;

    return (
      <div className="relative">
        <textarea
          id={id}
          ref={setRefs}
          rows={rows}
          value={value}
          spellCheck
          lang="es"
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          placeholder={placeholder}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          aria-autocomplete="list"
          aria-controls={open ? listId : undefined}
          className={`flex w-full resize-y rounded-md border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
            invalid ? "border-destructive focus-visible:ring-destructive" : "border-input"
          }`}
        />
        {open && items.length > 0 && (
          <ul
            id={listId}
            role="listbox"
            aria-label="Sugerencias de términos médicos"
            className="absolute left-0 right-0 z-50 mt-1 max-h-56 overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          >
            {items.map((it, i) => (
              <li
                key={it.uri || it.codigo || `${it.titulo}-${i}`}
                role="option"
                aria-selected={i === activeIdx}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertar(it);
                }}
                onMouseEnter={() => setActiveIdx(i)}
                className={`flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 text-sm ${
                  i === activeIdx ? "bg-accent text-accent-foreground" : ""
                }`}
              >
                <span className="truncate">{it.titulo}</span>
                {it.codigo && (
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {it.codigo}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  },
);
