"use client";

/**
 * Sección de Problemas: árbol raíz/hijos, selección múltiple para agrupar,
 * barra de selección, acciones editar/eliminar/desagrupar.
 */

import * as React from "react";
import { Button } from "@his/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { useEvolucionDraft } from "../_hooks/useEvolucionDraft";
import { type EvolucionProblema } from "../_lib/types";
import { SECCION } from "../_lib/avante-palette";
import { ReqPill } from "./SubBloque";

// Iconos inline (no importamos lucide para no sumar dep)
const IcoPlus = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="h-4 w-4">
    <path d="M12 5v14M5 12h14" />
  </svg>
);
const IcoEdit = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
    <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
);
const IcoDel = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
  </svg>
);
const IcoFolder = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
    <path d="M4 5h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
  </svg>
);
const IcoUngroup = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
    <path d="M4 5h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
    <path d="M9 13h6" />
  </svg>
);
const IcoLayers = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
    <path d="m12 3 9 5-9 5-9-5 9-5zM3 13l9 5 9-5" />
  </svg>
);
const IcoCheck = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="h-3 w-3">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

interface Props {
  onAgregarProblema: () => void;
  onEditarProblema: (id: string) => void;
  onAgrupar: (ids: string[]) => void;
}

export function ProblemasSection({ onAgregarProblema, onEditarProblema, onAgrupar }: Props) {
  const { draft, dispatch } = useEvolucionDraft();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  const { problemas } = draft;
  const raices = problemas.filter((p) => p.parentId === null);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  function handleAgrupar() {
    if (selected.size < 2) return;
    onAgrupar([...selected]);
    clearSelection();
  }

  function handleDeleteProblema(p: EvolucionProblema) {
    const hijos = problemas.filter((x) => x.parentId === p.id);
    const msg =
      hijos.length > 0
        ? `¿Eliminar el Diagnóstico Sindrómico "${p.texto}"? Sus ${hijos.length} sub-problema(s) pasarán a la lista principal.`
        : `¿Eliminar el problema "${p.texto}"?`;
    if (!window.confirm(msg)) return;
    dispatch({ type: "DELETE_PROBLEMA", id: p.id });
    setSelected((prev) => { const n = new Set(prev); n.delete(p.id); return n; });
  }

  function handleUngroup(p: EvolucionProblema) {
    const hijos = problemas.filter((x) => x.parentId === p.id);
    if (!window.confirm(`¿Desagrupar este Diagnóstico Sindrómico? Sus ${hijos.length} sub-problema(s) pasarán a la lista principal.`)) return;
    dispatch({ type: "UNGROUP_PROBLEMA", parentId: p.id });
  }

  // Esc: limpiar selección
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && selected.size > 0) clearSelection();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  return (
    <Card className={`overflow-hidden ${SECCION.problemas.card}`}>
      <CardHeader className={`border-b border-border pb-3 ${SECCION.problemas.head}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className={`flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold text-white ${SECCION.problemas.badge}`}>P</span>
              <CardTitle className="text-sm font-bold uppercase tracking-wide">Problemas</CardTitle>
              <span className="ml-0.5 rounded-full bg-[#3b82f6] px-[9px] py-0.5 text-[11px] font-bold tabular-nums text-white">
                {problemas.length}
              </span>
              <ReqPill />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Lista de problemas. Marca dos o más para agruparlos bajo un Diagnóstico Sindrómico (opcional).
            </p>
          </div>
          <Button type="button" size="sm" onClick={onAgregarProblema} className="shrink-0 bg-[#3b82f6] text-white hover:bg-[#3b82f6]/90">
            <IcoPlus />
            Agregar problema
          </Button>
        </div>
      </CardHeader>

      <CardContent className="px-0 pb-0">
        {/* Barra de selección */}
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-blue-200 bg-blue-50 px-4 py-2 dark:border-blue-800 dark:bg-blue-950/30">
            <span className="text-sm">
              <strong>{selected.size}</strong> seleccionado{selected.size > 1 ? "s" : ""}
            </span>
            <div className="flex-1" />
            {selected.size < 2 && (
              <span className="text-xs text-muted-foreground">Selecciona 2 o más para agrupar</span>
            )}
            <Button
              type="button"
              size="sm"
              variant="default"
              disabled={selected.size < 2}
              onClick={handleAgrupar}
              className="bg-[#3b82f6] text-white hover:bg-[#3b82f6]/90"
            >
              <IcoLayers />
              Agrupar como Diagnóstico Sindrómico
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={clearSelection}>
              Limpiar
            </Button>
          </div>
        )}

        {/* Lista */}
        {problemas.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-7 text-sm text-muted-foreground">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5 text-muted-foreground/50">
              <path d="M9 11l3 3 7-8M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8" />
            </svg>
            {'Aún no hay problemas. Use "Agregar problema".'}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {raices.map((padre, pidx) => {
              const hijos = problemas.filter((p) => p.parentId === padre.id);
              const esPadre = hijos.length > 0;
              const numPadre = pidx + 1;

              return (
                <React.Fragment key={padre.id}>
                  {/* Fila padre */}
                  <div
                    className={`flex items-center gap-3 px-4 py-3 transition-colors ${
                      esPadre
                        ? "bg-blue-50 dark:bg-blue-950/30"
                        : selected.has(padre.id)
                          ? "bg-blue-100 dark:bg-blue-900/40"
                          : "hover:bg-muted/50"
                    }`}
                  >
                    {/* Checkbox (solo para raíces sin hijos y para hijos) */}
                    {!esPadre ? (
                      <button
                        type="button"
                        onClick={() => toggleSelect(padre.id)}
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors ${
                          selected.has(padre.id)
                            ? "border-blue-500 bg-blue-500 text-white"
                            : "border-border bg-background hover:border-blue-400"
                        }`}
                        aria-label={selected.has(padre.id) ? "Deseleccionar" : "Seleccionar para agrupar"}
                      >
                        {selected.has(padre.id) && <IcoCheck />}
                      </button>
                    ) : (
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-blue-500 text-white">
                        <IcoFolder />
                      </span>
                    )}

                    {/* Número / ícono */}
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-xs font-bold ${
                        esPadre
                          ? "border-blue-500 bg-blue-500 text-white"
                          : "border-blue-200 bg-blue-50 text-blue-600 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
                      }`}
                    >
                      {esPadre ? <IcoFolder /> : String(numPadre)}
                    </span>

                    {/* Texto */}
                    <div className="min-w-0 flex-1 font-medium text-foreground">
                      {padre.texto}
                      {esPadre && (
                        <span className="ml-2 inline-block rounded-full border border-blue-200 bg-background px-2 py-0.5 text-[10px] font-bold text-blue-500">
                          Diagnóstico Sindrómico · {hijos.length}
                        </span>
                      )}
                    </div>

                    {/* Acciones */}
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => onEditarProblema(padre.id)}
                        title="Editar"
                        aria-label="Editar"
                        className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <IcoEdit />
                      </button>
                      {esPadre && (
                        <button
                          type="button"
                          onClick={() => handleUngroup(padre)}
                          title="Desagrupar"
                          aria-label="Desagrupar"
                          className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          <IcoUngroup />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDeleteProblema(padre)}
                        title="Eliminar"
                        aria-label="Eliminar"
                        className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
                      >
                        <IcoDel />
                      </button>
                    </div>
                  </div>

                  {/* Hijos */}
                  {hijos.map((hijo, hidx) => (
                    <div
                      key={hijo.id}
                      className={`relative flex items-center gap-3 py-3 pl-12 pr-4 transition-colors ${
                        selected.has(hijo.id)
                          ? "bg-blue-100 dark:bg-blue-900/40"
                          : "hover:bg-muted/50"
                      }`}
                    >
                      {/* Línea vertical del árbol */}
                      <span className="pointer-events-none absolute left-7 top-0 h-full w-0.5 bg-blue-200 dark:bg-blue-800" />
                      {/* Línea horizontal */}
                      <span className="pointer-events-none absolute left-7 top-1/2 h-0.5 w-3 bg-blue-200 dark:bg-blue-800" />

                      {/* Checkbox hijo */}
                      <button
                        type="button"
                        onClick={() => toggleSelect(hijo.id)}
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors ${
                          selected.has(hijo.id)
                            ? "border-blue-500 bg-blue-500 text-white"
                            : "border-border bg-background hover:border-blue-400"
                        }`}
                        aria-label={selected.has(hijo.id) ? "Deseleccionar" : "Seleccionar para agrupar"}
                      >
                        {selected.has(hijo.id) && <IcoCheck />}
                      </button>

                      {/* Número hijo */}
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-[11px] font-bold text-muted-foreground">
                        {numPadre}.{hidx + 1}
                      </span>

                      <div className="min-w-0 flex-1 text-foreground">{hijo.texto}</div>

                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={() => onEditarProblema(hijo.id)}
                          title="Editar"
                          aria-label="Editar"
                          className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          <IcoEdit />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteProblema(hijo)}
                          title="Eliminar"
                          aria-label="Eliminar"
                          className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
                        >
                          <IcoDel />
                        </button>
                      </div>
                    </div>
                  ))}
                </React.Fragment>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
