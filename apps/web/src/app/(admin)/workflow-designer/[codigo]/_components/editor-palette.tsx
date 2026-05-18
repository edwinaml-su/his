"use client";

/**
 * EditorPalette — Sidebar izquierdo del Workflow Designer.
 *
 * US.F2.2.02: muestra tipos de estado arrastrables al canvas.
 * El drag nativo de HTML5 inicia con setData("application/reactflow", tipo).
 * ReactFlow lo recibe en el onDrop del canvas.
 *
 * Restricción: solo un INICIAL por flujo (bloqueado visualmente cuando ya existe).
 */

import * as React from "react";

export type PaletteEstadoTipo =
  | "INICIAL"
  | "INTERMEDIO"
  | "FINAL_OK"
  | "FINAL_KO"
  | "ESPERANDO_FIRMA";

interface PaletteItem {
  tipo: PaletteEstadoTipo;
  label: string;
  description: string;
  color: string;
  borderColor: string;
}

const PALETTE_ITEMS: PaletteItem[] = [
  {
    tipo: "INICIAL",
    label: "Estado Inicial",
    description: "Punto de entrada del flujo. Solo puede existir uno.",
    color: "#dcfce7",
    borderColor: "#16a34a",
  },
  {
    tipo: "INTERMEDIO",
    label: "Estado Intermedio",
    description: "Estado de proceso dentro del flujo.",
    color: "#f3f4f6",
    borderColor: "#9ca3af",
  },
  {
    tipo: "FINAL_OK",
    label: "Estado Final (OK)",
    description: "Cierre exitoso del flujo clínico.",
    color: "#dbeafe",
    borderColor: "#2563eb",
  },
  {
    tipo: "FINAL_KO",
    label: "Estado Final (KO)",
    description: "Cierre por cancelación o falla.",
    color: "#fee2e2",
    borderColor: "#dc2626",
  },
  {
    tipo: "ESPERANDO_FIRMA",
    label: "Esperando Firma",
    description: "El flujo está pausado esperando firma electrónica.",
    color: "#fef9c3",
    borderColor: "#ca8a04",
  },
];

interface EditorPaletteProps {
  /** IDs de tipos que ya existen en el canvas y no pueden duplicarse (ej. INICIAL). */
  tiposPresentes: PaletteEstadoTipo[];
  readOnly?: boolean;
}

export function EditorPalette({ tiposPresentes, readOnly = false }: EditorPaletteProps) {
  const [search, setSearch] = React.useState("");

  const filtered = PALETTE_ITEMS.filter((item) =>
    item.label.toLowerCase().includes(search.toLowerCase()),
  );

  function onDragStart(
    event: React.DragEvent<HTMLDivElement>,
    tipo: PaletteEstadoTipo,
  ) {
    event.dataTransfer.setData("application/reactflow-tipo", tipo);
    event.dataTransfer.effectAllowed = "move";
  }

  return (
    <aside
      aria-label="Paleta de elementos del workflow"
      className="flex h-full w-52 flex-col gap-2 border-r bg-background p-3"
    >
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        Paleta
      </p>

      {/* Búsqueda */}
      <input
        type="search"
        placeholder="Buscar…"
        aria-label="Buscar elementos en la paleta"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full rounded border px-2 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      <div className="flex flex-col gap-2 overflow-y-auto" role="list">
        {filtered.length === 0 && (
          <p className="text-xs text-muted-foreground">Sin resultados.</p>
        )}
        {filtered.map((item) => {
          const blocked = item.tipo === "INICIAL" && tiposPresentes.includes("INICIAL");
          const draggable = !readOnly && !blocked;

          return (
            <div
              key={item.tipo}
              role="listitem"
              draggable={draggable}
              onDragStart={draggable ? (e) => onDragStart(e, item.tipo) : undefined}
              title={blocked ? "Un flujo solo puede tener un estado inicial" : item.description}
              aria-label={`${item.label}${blocked ? " — ya existe en el canvas" : ""}${readOnly ? " — solo lectura" : ""}`}
              aria-disabled={!draggable}
              style={{
                background: item.color,
                borderColor: item.borderColor,
                opacity: blocked || readOnly ? 0.45 : 1,
                cursor: draggable ? "grab" : "not-allowed",
              }}
              className="rounded border px-3 py-2 text-xs font-medium select-none transition-opacity"
            >
              <span className="block" style={{ color: item.borderColor }}>
                {item.label}
              </span>
              <span className="block text-[10px] text-muted-foreground mt-0.5 font-normal">
                {item.description}
              </span>
              {blocked && (
                <span className="block text-[10px] text-amber-600 mt-0.5">
                  Ya existe en el canvas
                </span>
              )}
            </div>
          );
        })}
      </div>

      {readOnly && (
        <p className="text-[10px] text-muted-foreground mt-auto">
          Modo solo lectura — sin controles de edición.
        </p>
      )}
    </aside>
  );
}
