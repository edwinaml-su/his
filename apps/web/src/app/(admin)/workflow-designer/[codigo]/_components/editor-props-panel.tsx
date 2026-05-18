"use client";

/**
 * EditorPropsPanel — Sidebar derecho del Workflow Designer.
 *
 * US.F2.2.03: muestra propiedades del nodo o arista seleccionados.
 * - Nodo: codigo (read-only), nombre, tipo (INICIAL/INTERMEDIO/FINAL), descripción, color hex.
 * - Arista: origen, destino, label, tipo, rol requerido, validador.
 * - Edit inline + Save que llama mutaciones tRPC.
 *
 * El componente es controlado: el padre mantiene el elemento seleccionado.
 * Al guardar exitosamente llama onSaved() para que el padre re-fetche.
 */

import * as React from "react";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import { trpc } from "@/lib/trpc/react";

// ─── Tipos de datos que recibe el panel ───────────────────────────────────────

export interface EstadoNodeData {
  id: string;
  codigo: string;
  nombre: string;
  es_inicial: boolean;
  es_final: boolean;
  orden: number;
  descripcion?: string;
}

export interface TransicionEdgeData {
  id: string;
  accion: string;
  estado_origen_id: string;
  estado_destino_id: string;
  requiere_firma: boolean;
  rol_codigo?: string;
  rol_autoriza_id?: string;
  tipo?: string;
  validador?: string;
}

type PanelSelection =
  | { kind: "node"; data: EstadoNodeData }
  | { kind: "edge"; data: TransicionEdgeData }
  | null;

interface EditorPropsPanelProps {
  selection: PanelSelection;
  onClose: () => void;
  onSaved: () => void;
  readOnly?: boolean;
}

// ─── Panel de propiedades de nodo ─────────────────────────────────────────────

function NodePropsForm({
  data,
  onSaved,
  onClose,
  readOnly,
}: {
  data: EstadoNodeData;
  onSaved: () => void;
  onClose: () => void;
  readOnly: boolean;
}) {
  const [nombre, setNombre] = React.useState(data.nombre);
  const [descripcion, setDescripcion] = React.useState(data.descripcion ?? "");
  const [color, setColor] = React.useState("#f3f4f6");
  const [error, setError] = React.useState<string | null>(null);

  // Sync when selection changes
  React.useEffect(() => {
    setNombre(data.nombre);
    setDescripcion(data.descripcion ?? "");
    setError(null);
  }, [data.id, data.nombre, data.descripcion]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateMutation = (trpc as any).workflowEstado.estado.update.useMutation({
    onSuccess: () => {
      onSaved();
    },
    onError: (e: { message: string }) => setError(e.message),
  });

  function handleSave() {
    if (!nombre.trim()) {
      setError("El nombre no puede estar vacío.");
      return;
    }
    setError(null);
    updateMutation.mutate({ id: data.id, nombre: nombre.trim() });
  }

  const tipo = data.es_inicial ? "INICIAL" : data.es_final ? "FINAL" : "INTERMEDIO";

  return (
    <div className="flex flex-col gap-3 p-4 text-sm">
      <div>
        <label className="block text-xs font-medium text-muted-foreground">
          Código (solo lectura)
        </label>
        <code className="block mt-0.5 text-xs bg-muted rounded px-2 py-1">
          {data.codigo}
        </code>
      </div>

      <div>
        <label className="block text-xs font-medium">Tipo</label>
        <Badge variant="secondary" className="mt-0.5 text-xs">
          {tipo}
        </Badge>
      </div>

      <div>
        <label htmlFor="node-nombre" className="block text-xs font-medium">
          Nombre
        </label>
        {readOnly ? (
          <p className="mt-0.5 text-xs">{nombre}</p>
        ) : (
          <input
            id="node-nombre"
            type="text"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className="mt-0.5 w-full rounded border px-2 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        )}
      </div>

      <div>
        <label htmlFor="node-desc" className="block text-xs font-medium">
          Descripción
        </label>
        {readOnly ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{descripcion || "—"}</p>
        ) : (
          <textarea
            id="node-desc"
            rows={3}
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            className="mt-0.5 w-full rounded border px-2 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
            placeholder="Fundamento normativo, notas de implementación…"
          />
        )}
      </div>

      {!readOnly && (
        <div>
          <label htmlFor="node-color" className="block text-xs font-medium">
            Color
          </label>
          <div className="mt-0.5 flex items-center gap-2">
            <input
              id="node-color"
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-7 w-10 cursor-pointer rounded border"
              aria-label="Color del nodo en el canvas"
            />
            <span className="text-xs font-mono text-muted-foreground">{color}</span>
          </div>
        </div>
      )}

      <div>
        <label className="block text-xs font-medium">Orden</label>
        <p className="mt-0.5 text-xs text-muted-foreground">{data.orden}</p>
      </div>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      {!readOnly && (
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className="flex-1"
          >
            {updateMutation.isPending ? "Guardando…" : "Guardar"}
          </Button>
          <Button size="sm" variant="outline" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      )}

      {readOnly && (
        <Button size="sm" variant="outline" onClick={onClose} className="mt-1">
          Cerrar
        </Button>
      )}
    </div>
  );
}

// ─── Panel de propiedades de arista ──────────────────────────────────────────

function EdgePropsForm({
  data,
  onSaved,
  onClose,
  readOnly,
}: {
  data: TransicionEdgeData;
  onSaved: () => void;
  onClose: () => void;
  readOnly: boolean;
}) {
  const [requiereFirma, setRequiereFirma] = React.useState(data.requiere_firma);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setRequiereFirma(data.requiere_firma);
    setError(null);
  }, [data.id, data.requiere_firma]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateMutation = (trpc as any).workflowTransicion.update.useMutation({
    onSuccess: () => {
      onSaved();
    },
    onError: (e: { message: string }) => setError(e.message),
  });

  function handleSave() {
    setError(null);
    updateMutation.mutate({
      id: data.id,
      requiereFirma,
    });
  }

  return (
    <div className="flex flex-col gap-3 p-4 text-sm">
      <div>
        <label className="block text-xs font-medium text-muted-foreground">Acción</label>
        <code className="block mt-0.5 text-xs bg-muted rounded px-2 py-1">{data.accion}</code>
      </div>

      {data.rol_codigo && (
        <div>
          <label className="block text-xs font-medium">Rol requerido</label>
          <Badge variant="outline" className="mt-0.5 text-xs font-mono">
            {data.rol_codigo}
          </Badge>
        </div>
      )}

      <div>
        <label className="block text-xs font-medium">Tipo de transición</label>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {data.tipo ?? "MANUAL"}
        </p>
      </div>

      {data.validador && (
        <div>
          <label className="block text-xs font-medium">Validador (callback)</label>
          <code className="block mt-0.5 text-xs bg-muted rounded px-2 py-1">
            {data.validador}
          </code>
        </div>
      )}

      <div>
        <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
          <input
            type="checkbox"
            checked={requiereFirma}
            onChange={(e) => {
              if (!readOnly) setRequiereFirma(e.target.checked);
            }}
            disabled={readOnly}
            className="focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          Requiere firma electrónica
        </label>
      </div>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      {!readOnly && (
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className="flex-1"
          >
            {updateMutation.isPending ? "Guardando…" : "Guardar"}
          </Button>
          <Button size="sm" variant="outline" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      )}

      {readOnly && (
        <Button size="sm" variant="outline" onClick={onClose} className="mt-1">
          Cerrar
        </Button>
      )}
    </div>
  );
}

// ─── Panel wrapper ────────────────────────────────────────────────────────────

export function EditorPropsPanel({
  selection,
  onClose,
  onSaved,
  readOnly = false,
}: EditorPropsPanelProps) {
  if (!selection) return null;

  return (
    <aside
      aria-label="Panel de propiedades del elemento seleccionado"
      role="complementary"
      className="flex h-full w-64 flex-col border-l bg-background overflow-y-auto"
    >
      <div className="flex items-center justify-between border-b px-4 py-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {selection.kind === "node" ? "Estado" : "Transición"}
        </p>
        <button
          onClick={onClose}
          aria-label="Cerrar panel de propiedades"
          className="text-muted-foreground hover:text-foreground text-sm leading-none"
        >
          ✕
        </button>
      </div>

      {selection.kind === "node" ? (
        <NodePropsForm
          data={selection.data}
          onSaved={onSaved}
          onClose={onClose}
          readOnly={readOnly}
        />
      ) : (
        <EdgePropsForm
          data={selection.data}
          onSaved={onSaved}
          onClose={onClose}
          readOnly={readOnly}
        />
      )}
    </aside>
  );
}
