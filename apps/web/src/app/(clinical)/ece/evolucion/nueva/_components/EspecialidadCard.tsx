"use client";

/**
 * Especialidad médica (CC-0006 R3) — va ANTES de "Problemas".
 *
 *   - Autocompletado contra el catálogo MedicalSpecialty vía `buscarEspecialidades`
 *     del provider (única frontera tRPC del árbol; los tests mockean el hook).
 *   - Permite texto libre: si el médico no elige del catálogo, se guarda
 *     `{ id: null, nombre }`. Al elegir una opción, `{ id, nombre }`.
 *   - Obligatoria para firmar (ver camposFaltantes). Sin corrección ortográfica
 *     (nombres propios del catálogo): spellCheck={false}.
 *
 * Degrada a input simple si `buscarEspecialidades` no está disponible.
 */

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Input } from "@his/ui/components/input";
import { useEvolucionDraft, type EspecialidadOpcion } from "../_hooks/useEvolucionDraft";
import { SECCION } from "../_lib/avante-palette";

export function EspecialidadCard() {
  const { draft, dispatch, buscarEspecialidades } = useEvolucionDraft();
  const nombre = draft.especialidad?.nombre ?? "";

  const [items, setItems] = React.useState<EspecialidadOpcion[]>([]);
  const [open, setOpen] = React.useState(false);
  const [activeIdx, setActiveIdx] = React.useState(0);
  const reqIdRef = React.useRef(0);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSugerencias = React.useCallback(
    (q: string) => {
      if (!buscarEspecialidades || q.trim().length < 2) {
        setItems([]);
        setOpen(false);
        return;
      }
      const reqId = ++reqIdRef.current;
      void buscarEspecialidades(q).then((res) => {
        if (reqId !== reqIdRef.current) return; // descartar respuesta stale
        setItems(res);
        setActiveIdx(0);
        setOpen(res.length > 0);
      });
    },
    [buscarEspecialidades],
  );

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    // Texto libre → id null (se sobreescribe si elige del catálogo).
    dispatch({ type: "SET_ESPECIALIDAD", especialidad: { id: null, nombre: next } });
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSugerencias(next), 250);
  }

  function elegir(op: EspecialidadOpcion) {
    dispatch({ type: "SET_ESPECIALIDAD", especialidad: { id: op.id, nombre: op.nombre } });
    setOpen(false);
    setItems([]);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
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
        elegir(it);
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

  const listId = "especialidad-opciones";
  const invalid = nombre.trim() === "";

  return (
    <Card className={SECCION.especialidad.card}>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <span className={`flex h-6 w-6 items-center justify-center rounded-md text-white ${SECCION.especialidad.badge}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
              <path d="M5 3v6a4 4 0 0 0 8 0V3" />
              <path d="M9 15v1a5 5 0 0 0 10 0v-2" />
              <circle cx="19" cy="12" r="2" />
            </svg>
          </span>
          <CardTitle className="text-sm font-bold uppercase tracking-wide">
            Especialidad médica<span className="ml-0.5 text-destructive">*</span>
          </CardTitle>
        </div>
        <p className="text-xs text-muted-foreground">
          Especialidad responsable de esta evolución. Obligatoria para firmar.
        </p>
      </CardHeader>
      <CardContent>
        <div className="relative">
          <Input
            id="especialidad"
            value={nombre}
            spellCheck={false}
            autoComplete="off"
            placeholder="Buscar especialidad (ej. Medicina Interna)"
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onBlur={() => window.setTimeout(() => setOpen(false), 120)}
            aria-invalid={invalid || undefined}
            aria-autocomplete="list"
            aria-controls={open ? listId : undefined}
            className={invalid ? "border-destructive focus-visible:ring-destructive" : undefined}
          />
          {open && items.length > 0 && (
            <ul
              id={listId}
              role="listbox"
              aria-label="Especialidades médicas"
              className="absolute left-0 right-0 z-50 mt-1 max-h-56 overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
            >
              {items.map((it, i) => (
                <li
                  key={it.id}
                  role="option"
                  aria-selected={i === activeIdx}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    elegir(it);
                  }}
                  onMouseEnter={() => setActiveIdx(i)}
                  className={`cursor-pointer rounded px-2 py-1.5 text-sm ${
                    i === activeIdx ? "bg-accent text-accent-foreground" : ""
                  }`}
                >
                  {it.nombre}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
