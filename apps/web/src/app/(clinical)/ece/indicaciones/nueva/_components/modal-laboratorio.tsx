"use client";

/**
 * CC-0026 Ola 2 — categoría "Exámenes de laboratorio" (ESP-MOCKUP-0026 §lab).
 *
 * Reutiliza `trpc.lis.test.listByArea({ area: "LABORATORIO" })` — el mismo
 * procedure que arma la lista de paneles/exámenes en
 * `apps/web/src/app/(clinical)/lis/orders/new/page.tsx` (CC-0013) — con
 * filtro client-side por texto, igual que esa pantalla. Esta captura NO crea
 * la `LabOrder` real (eso es integración LIS, fuera de alcance de esta ola
 * por directiva del REQ): solo arma `descripcion`/`detalle` del ítem de la
 * indicación con tipo=ESTUDIO, categoriaUI=LABORATORIO.
 */
import * as React from "react";
import { Label } from "@his/ui/components/label";
import { Input } from "@his/ui/components/input";
import { Textarea } from "@his/ui/components/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/react";

const PRIORIDADES = ["Rutina", "Urgente", "STAT"];
const TIPOS_MUESTRA = ["Sangre", "Orina", "Heces", "Esputo", "LCR", "Otro"];

interface ExamenItem {
  testId: string;
  nombre: string;
  seccion: string;
}

export interface ModalLaboratorioHandle {
  compose: () => { descripcion: string; detalle: Record<string, unknown> } | null;
}

export const ModalLaboratorio = React.forwardRef<ModalLaboratorioHandle, Record<never, never>>(
  function ModalLaboratorio(_props, ref) {
    const panelesQ = trpc.lis.test.listByArea.useQuery({ area: "LABORATORIO" });
    const panels = React.useMemo(() => panelesQ.data ?? [], [panelesQ.data]);
    const flatItems = React.useMemo<ExamenItem[]>(
      () =>
        panels.flatMap((p) => p.tests.map((t) => ({ testId: t.id, nombre: t.nombre, seccion: p.nombre }))),
      [panels],
    );

    const [busqueda, setBusqueda] = React.useState("");
    const [seleccionado, setSeleccionado] = React.useState<ExamenItem | null>(null);
    const [prioridad, setPrioridad] = React.useState(PRIORIDADES[0]!);
    const [muestra, setMuestra] = React.useState(TIPOS_MUESTRA[0]!);
    const [obs, setObs] = React.useState("");

    const visibles = React.useMemo(() => {
      const q = busqueda.trim().toUpperCase();
      if (q.length < 2) return [];
      return flatItems.filter((it) => it.nombre.toUpperCase().includes(q)).slice(0, 8);
    }, [busqueda, flatItems]);

    React.useImperativeHandle(ref, () => ({
      compose: () => {
        if (!seleccionado) return null;
        const parts = [seleccionado.nombre, prioridad, `muestra: ${muestra}`];
        if (obs.trim()) parts.push(`Obs: ${obs.trim()}`);
        return {
          descripcion: parts.join(" · "),
          detalle: {
            categoriaUI: "LABORATORIO",
            labTestId: seleccionado.testId,
            nombre: seleccionado.nombre,
            seccion: seleccionado.seccion,
            prioridad,
            tipoMuestra: muestra,
            observaciones: obs.trim() || undefined,
          },
        };
      },
    }));

    return (
      <div className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="lab-busca">Examen (catálogo laboratorio)</Label>
          <Input
            id="lab-busca"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar: hemograma, glucosa, creatinina… (2+ letras)"
          />
        </div>

        {busqueda.trim().length >= 2 && !seleccionado ? (
          <ul className="max-h-48 divide-y overflow-y-auto rounded-md border">
            {panelesQ.isLoading ? (
              <li className="p-2 text-xs text-muted-foreground">Cargando catálogo…</li>
            ) : visibles.length === 0 ? (
              <li className="p-2 text-xs text-muted-foreground">Sin coincidencias.</li>
            ) : (
              visibles.map((it) => (
                <li key={it.testId}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => {
                      setSeleccionado(it);
                      setBusqueda("");
                    }}
                  >
                    <span>{it.nombre}</span>
                    <span className="text-xs text-muted-foreground">{it.seccion}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        ) : null}

        {seleccionado ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-cyan-200 bg-cyan-50 p-3 text-sm">
            <div>
              <strong>{seleccionado.nombre}</strong>
              <div className="text-xs text-muted-foreground">{seleccionado.seccion}</div>
            </div>
            <button
              type="button"
              className="text-xs text-destructive"
              onClick={() => setSeleccionado(null)}
            >
              ✕ cambiar
            </button>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="lab-prio">Prioridad</Label>
            <Select value={prioridad} onValueChange={setPrioridad}>
              <SelectTrigger id="lab-prio">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORIDADES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="lab-muestra">Tipo de muestra</Label>
            <Select value={muestra} onValueChange={setMuestra}>
              <SelectTrigger id="lab-muestra">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS_MUESTRA.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="lab-obs">Observaciones</Label>
          <Textarea
            id="lab-obs"
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            placeholder="Ayuno, condiciones de toma de muestra…"
          />
        </div>
      </div>
    );
  },
);
