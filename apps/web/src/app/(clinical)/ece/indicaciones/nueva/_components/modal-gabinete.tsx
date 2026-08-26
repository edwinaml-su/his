"use client";

/**
 * CC-0026 Ola 2 — categoría "Exámenes de gabinete" (ESP-MOCKUP-0026 §gab).
 *
 * Reutiliza `trpc.imagingRequest.catalogoImagen.list` — el mismo catálogo
 * (LabTest + ImagingTestAttrs) que consume
 * `apps/web/src/app/(clinical)/imaging/_components/nueva-solicitud.tsx`
 * (CC-0016). `panelNombre` hace de "modalidad" (agrupador real del catálogo:
 * Rx/USG/TAC/etc. según cómo esté parametrizado el panel) — no se inventa un
 * segundo vocabulario de modalidad paralelo al catálogo real.
 *
 * No crea el `ImagingRequest` real (integración fuera de alcance de esta
 * ola, igual que laboratorio): solo arma `descripcion`/`detalle` con
 * tipo=ESTUDIO, categoriaUI=GABINETE.
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
import type { ImagingCatalogoItem } from "@his/contracts";

const PRIORIDADES = ["Rutina", "Urgente", "STAT"];

export interface ModalGabineteHandle {
  compose: () => { descripcion: string; detalle: Record<string, unknown> } | null;
}

export const ModalGabinete = React.forwardRef<ModalGabineteHandle, Record<never, never>>(
  function ModalGabinete(_props, ref) {
    const catalogoQ = trpc.imagingRequest.catalogoImagen.list.useQuery();
    const catalogo = React.useMemo(() => catalogoQ.data ?? [], [catalogoQ.data]);

    const [busqueda, setBusqueda] = React.useState("");
    const [seleccionado, setSeleccionado] = React.useState<ImagingCatalogoItem | null>(null);
    const [region, setRegion] = React.useState("");
    const [prioridad, setPrioridad] = React.useState(PRIORIDADES[0]!);
    const [obs, setObs] = React.useState("");

    const visibles = React.useMemo(() => {
      const q = busqueda.trim().toUpperCase();
      if (q.length < 2) return [];
      return catalogo
        .filter((i) => i.active && i.panelActive && i.name.toUpperCase().includes(q))
        .slice(0, 8);
    }, [busqueda, catalogo]);

    React.useImperativeHandle(ref, () => ({
      compose: () => {
        if (!seleccionado) return null;
        const parts = [seleccionado.name, `modalidad: ${seleccionado.panelNombre}`];
        if (region.trim()) parts.push(`región: ${region.trim()}`);
        parts.push(prioridad);
        if (obs.trim()) parts.push(`Obs: ${obs.trim()}`);
        return {
          descripcion: parts.join(" · "),
          detalle: {
            categoriaUI: "GABINETE",
            labTestId: seleccionado.labTestId,
            nombre: seleccionado.name,
            modalidad: seleccionado.panelNombre,
            regionAnatomica: region.trim() || undefined,
            prioridad,
            requiereContraste: seleccionado.requiereContraste,
            requiereAyuno: seleccionado.requiereAyuno,
            observaciones: obs.trim() || undefined,
          },
        };
      },
    }));

    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="gab-busca">Estudio</Label>
            <Input
              id="gab-busca"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar: Rx tórax, USG abdominal, TAC, ECG…"
            />
          </div>
          <div className="space-y-1">
            <Label>Modalidad</Label>
            <div className="flex h-9 items-center rounded-md border border-dashed px-3 text-sm text-muted-foreground">
              {seleccionado?.panelNombre ?? "se resuelve al elegir el estudio"}
            </div>
          </div>
        </div>

        {busqueda.trim().length >= 2 && !seleccionado ? (
          <ul className="max-h-48 divide-y overflow-y-auto rounded-md border">
            {catalogoQ.isLoading ? (
              <li className="p-2 text-xs text-muted-foreground">Cargando catálogo…</li>
            ) : visibles.length === 0 ? (
              <li className="p-2 text-xs text-muted-foreground">Sin coincidencias.</li>
            ) : (
              visibles.map((it) => (
                <li key={it.labTestId}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => {
                      setSeleccionado(it);
                      setBusqueda("");
                    }}
                  >
                    <span>{it.name}</span>
                    <span className="text-xs text-muted-foreground">{it.panelNombre}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        ) : null}

        {seleccionado ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-indigo-200 bg-indigo-50 p-3 text-sm">
            <div>
              <strong>{seleccionado.name}</strong>
              <div className="text-xs text-muted-foreground">{seleccionado.panelNombre}</div>
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
            <Label htmlFor="gab-region">Región anatómica</Label>
            <Input
              id="gab-region"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              placeholder="Ej. tórax PA, abdomen completo…"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="gab-prio">Prioridad</Label>
            <Select value={prioridad} onValueChange={setPrioridad}>
              <SelectTrigger id="gab-prio">
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
        </div>

        <div className="space-y-1">
          <Label htmlFor="gab-obs">Justificación clínica / observaciones</Label>
          <Textarea
            id="gab-obs"
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            placeholder="Diagnóstico presuntivo, hallazgos a descartar…"
          />
        </div>
      </div>
    );
  },
);
