"use client";

/**
 * Rediseño lab 2026-09 — modal "Parámetros del examen" (mockup:
 * `#paramPickOverlay`, función `abrirParamPick`/`guardarParamPick`).
 *
 * Carga los parámetros (analitos) de una prueba vía `lis.test.parameters` y
 * permite marcar/desmarcar un subconjunto. Por defecto, si el llamador no
 * pasa `initialSelected`, todos vienen marcados (semántica "TODOS" del
 * mockup para una prueba recién agregada a la solicitud).
 */

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@his/ui/components/dialog";
import { trpc } from "@/lib/trpc/react";
import { MOCK_LAB_PALETTE as MOCK } from "../../../_lib/mock-palette";

interface ParametrosModalProps {
  testId: string;
  testName: string;
  seccion: string;
  tipoNombre: string;
  subtipoNombre: string;
  /** Selección previa del usuario. `undefined` = aún no personalizada (equivale a "todos"). */
  initialSelected: string[] | undefined;
  onSave: (parameterIds: string[]) => void;
  onClose: () => void;
}

export function ParametrosModal({
  testId,
  testName,
  seccion,
  tipoNombre,
  subtipoNombre,
  initialSelected,
  onSave,
  onClose,
}: ParametrosModalProps): React.ReactElement {
  const parametrosQ = trpc.lis.test.parameters.useQuery({ testId });
  const disponibles = React.useMemo(() => parametrosQ.data ?? [], [parametrosQ.data]);
  const [seleccion, setSeleccion] = React.useState<Set<string>>(new Set(initialSelected ?? []));
  const inicializado = React.useRef(initialSelected !== undefined);

  React.useEffect(() => {
    // Si el llamador no trae selección previa, por defecto se marcan TODOS
    // los parámetros una vez que la query resuelve (semántica del mockup).
    if (!inicializado.current && disponibles.length > 0) {
      setSeleccion(new Set(disponibles.map((p) => p.id)));
      inicializado.current = true;
    }
  }, [disponibles]);

  function toggle(id: string): void {
    setSeleccion((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function marcarTodos(v: boolean): void {
    setSeleccion(v ? new Set(disponibles.map((p) => p.id)) : new Set());
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[80vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Parámetros · {testName}</DialogTitle>
        </DialogHeader>
        <p className="text-xs" style={{ color: MOCK.inkSoft }}>
          Sección: <b>{seccion}</b> &nbsp;·&nbsp; Muestra: {tipoNombre} / {subtipoNombre} &nbsp;·&nbsp;
          seleccione los parámetros a procesar
        </p>

        {disponibles.length > 0 ? (
          <div className="mb-1.5 flex gap-2 text-sm">
            <button type="button" className="underline" style={{ color: MOCK.blue }} onClick={() => marcarTodos(true)}>
              Marcar todos
            </button>
            <span>·</span>
            <button type="button" className="underline" style={{ color: MOCK.blue }} onClick={() => marcarTodos(false)}>
              Desmarcar todos
            </button>
          </div>
        ) : null}

        {parametrosQ.isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando parámetros…</p>
        ) : disponibles.length === 0 ? (
          <p className="italic text-muted-foreground">
            Esta prueba no tiene parámetros definidos. Configúrelos en Mantenimiento de catálogos.
          </p>
        ) : (
          <div className="space-y-0.5">
            {disponibles.map((p) => (
              <label
                key={p.id}
                className="flex items-center gap-2 rounded px-1 py-1 text-sm"
                style={{ color: MOCK.inkSoft }}
              >
                <input
                  type="checkbox"
                  checked={seleccion.has(p.id)}
                  onChange={() => toggle(p.id)}
                  style={{ accentColor: MOCK.teal }}
                />
                <span>{p.name}</span>
              </label>
            ))}
          </div>
        )}

        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-4 py-2 text-sm font-medium"
            style={{ color: MOCK.teal, borderColor: MOCK.teal }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onSave([...seleccion])}
            className="rounded-md px-4 py-2 text-sm font-medium text-white"
            style={{ backgroundColor: MOCK.teal }}
          >
            Guardar parámetros
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
