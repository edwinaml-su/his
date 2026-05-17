// @ts-nocheck — UI shape mismatch / dep faltante; refinar en F2-S3.
"use client";

/**
 * §ECE Motor de Workflow — Diagrama de estados (US.F2.3, visualización básica).
 *
 * Consume:
 *   - trpc.workflow.tipoDoc.get   → metadata del workflow
 *   - trpc.workflow.estado.list   → estados del workflow
 *   - trpc.workflow.transicion.list → transiciones entre estados
 *
 * Todos los routers anteriores son del Stream 13/30 y aún no están registrados en _app.ts.
 * Se usa `(trpc as any)` hasta que el Stream 13 registre `workflow` en _app.ts; en ese
 * momento el cast se elimina y TypeScript validará los tipos automáticamente.
 *
 * Renderizado: mermaid v10+ (loadMermaid dinámico). La lib NO está en deps todavía —
 * agregar en apps/web/package.json: "mermaid": "^10.9.0"
 * y en la raíz: npm install (turbo propagará al workspace web).
 *
 * Descarga PNG: canvas 2D desde el SVG vía Blob URL.
 * Descarga SVG: blob directo del markup generado por mermaid.render().
 */

import * as React from "react";
import { useParams } from "next/navigation";
import { Button } from "@his/ui/components/button";
import { Skeleton } from "@his/ui/components/skeleton";
import { trpc } from "@/lib/trpc/react";

// ---------------------------------------------------------------------------
// Tipos — espejo de los outputs de los routers de Stream 13
// ---------------------------------------------------------------------------
type Estado = {
  id: string;
  codigo: string;
  nombre: string;
  esFinal: boolean;
  esInicial: boolean;
};

type Transicion = {
  id: string;
  estadoOrigenId: string;
  estadoDestinoId: string;
  evento: string;
};

type TipoDoc = {
  id: string;
  codigo: string;
  nombre: string;
};

// ---------------------------------------------------------------------------
// Helper: genera el texto Mermaid stateDiagram-v2
// ---------------------------------------------------------------------------
function buildMermaidDefinition(estados: Estado[], transiciones: Transicion[]): string {
  const lines: string[] = ["stateDiagram-v2"];

  // Estado inicial canónico de Mermaid
  const inicial = estados.find((e) => e.esInicial);
  if (inicial) {
    lines.push(`    [*] --> ${sanitizeId(inicial.codigo)}`);
  }

  // Declaraciones de estado con alias nombre legible
  for (const estado of estados) {
    const sid = sanitizeId(estado.codigo);
    lines.push(`    ${sid} : ${estado.nombre}`);
  }

  // Transiciones
  const estadoPorId = new Map(estados.map((e) => [e.id, e]));
  for (const t of transiciones) {
    const origen = estadoPorId.get(t.estadoOrigenId);
    const destino = estadoPorId.get(t.estadoDestinoId);
    if (!origen || !destino) continue;
    const evento = t.evento.replace(/"/g, "'");
    lines.push(
      `    ${sanitizeId(origen.codigo)} --> ${sanitizeId(destino.codigo)} : ${evento}`,
    );
  }

  // Flecha hacia [*] desde estados finales
  const finales = estados.filter((e) => e.esFinal);
  for (const f of finales) {
    lines.push(`    ${sanitizeId(f.codigo)} --> [*]`);
  }

  return lines.join("\n");
}

/** Mermaid IDs no pueden tener espacios ni guiones iniciales. */
function sanitizeId(codigo: string): string {
  return codigo.replace(/[^a-zA-Z0-9_]/g, "_");
}

// ---------------------------------------------------------------------------
// Hook: carga mermaid dinámicamente para evitar SSR y reducir bundle inicial
// ---------------------------------------------------------------------------
function useMermaid() {
  const [ready, setReady] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    import("mermaid")
      .then((mod) => {
        mod.default.initialize({
          startOnLoad: false,
          theme: "base",
          themeVariables: {
            primaryColor: "#e8f0fe",
            primaryBorderColor: "#4a6cf7",
            lineColor: "#555",
          },
        });
        setReady(true);
      })
      .catch(() => {
        setError(
          // DEPENDENCIA FALTANTE: agregar en apps/web/package.json → "mermaid": "^10.9.0"
          'La librería "mermaid" no está instalada. ' +
            "Ejecuta: npm install mermaid -w apps/web",
        );
      });
  }, []);

  return { ready, error };
}

// ---------------------------------------------------------------------------
// Componente de diagrama (client-side render)
// ---------------------------------------------------------------------------
function WorkflowDiagram({
  definition,
  label,
}: {
  definition: string;
  label: string;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const svgRef = React.useRef<string>("");
  const { ready, error: mermaidError } = useMermaid();

  React.useEffect(() => {
    if (!ready || !containerRef.current) return;

    let cancelled = false;

    import("mermaid").then(async (mod) => {
      if (cancelled || !containerRef.current) return;
      try {
        const id = `wf-diagram-${Date.now()}`;
        const { svg } = await mod.default.render(id, definition);
        if (cancelled || !containerRef.current) return;
        svgRef.current = svg;
        containerRef.current.innerHTML = svg;

        // A11y: el SVG generado por mermaid no tiene role/aria por defecto
        const svgEl = containerRef.current.querySelector("svg");
        if (svgEl) {
          svgEl.setAttribute("role", "img");
          svgEl.setAttribute("aria-label", label);
        }
      } catch {
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML =
            '<p class="text-sm text-destructive">Error al renderizar el diagrama.</p>';
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [ready, definition, label]);

  if (mermaidError) {
    return (
      <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
        {mermaidError}
      </p>
    );
  }

  function downloadSvg() {
    if (!svgRef.current) return;
    const blob = new Blob([svgRef.current], { type: "image/svg+xml;charset=utf-8" });
    triggerDownload(URL.createObjectURL(blob), "workflow-diagrama.svg");
  }

  function downloadPng() {
    if (!svgRef.current || !containerRef.current) return;
    const svgEl = containerRef.current.querySelector("svg");
    if (!svgEl) return;

    const { width, height } = svgEl.getBoundingClientRect();
    const canvas = document.createElement("canvas");
    const scale = 2; // retina
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    const url = URL.createObjectURL(
      new Blob([svgRef.current], { type: "image/svg+xml;charset=utf-8" }),
    );
    img.onload = () => {
      ctx.scale(scale, scale);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      triggerDownload(canvas.toDataURL("image/png"), "workflow-diagrama.png");
    };
    img.src = url;
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={downloadSvg}>
          Descargar como SVG
        </Button>
        <Button variant="outline" size="sm" onClick={downloadPng}>
          Descargar como PNG
        </Button>
      </div>
      <div
        ref={containerRef}
        className="overflow-x-auto rounded-md border bg-white p-4 min-h-[200px]"
        aria-label={label}
      />
    </div>
  );
}

function triggerDownload(href: string, filename: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.click();
}

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------
export default function WorkflowDiagramPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  // Router `workflow` pendiente de registro en _app.ts (Stream 13).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wf = trpc as any;

  const tipoDocQuery = wf.workflow.tipoDoc.get.useQuery({ id });
  const estadosQuery = wf.workflow.estado.list.useQuery({ tipoDocId: id });
  const transicionesQuery = wf.workflow.transicion.list.useQuery({ tipoDocId: id });

  const isLoading =
    tipoDocQuery.isLoading || estadosQuery.isLoading || transicionesQuery.isLoading;
  const hasError = tipoDocQuery.error || estadosQuery.error || transicionesQuery.error;

  const tipoDoc: TipoDoc | undefined = tipoDocQuery.data;
  const estados: Estado[] = estadosQuery.data ?? [];
  const transiciones: Transicion[] = transicionesQuery.data ?? [];

  const mermaidDef =
    estados.length > 0 ? buildMermaidDefinition(estados, transiciones) : null;

  const diagramLabel = tipoDoc
    ? `Diagrama de estados del workflow ${tipoDoc.nombre} (${tipoDoc.codigo})`
    : "Diagrama de estados del workflow";

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div>
        {isLoading ? (
          <Skeleton className="h-7 w-64" />
        ) : (
          <h1 className="text-2xl font-bold">
            {tipoDoc ? `${tipoDoc.nombre} — Diagrama` : "Diagrama de workflow"}
          </h1>
        )}
        <p className="text-sm text-muted-foreground">
          Visualización stateDiagram-v2 generada desde los estados y transiciones
          configurados (US.F2.3).
        </p>
      </div>

      {/* Error */}
      {hasError && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          Error al cargar los datos del workflow. Intenta recargar la página.
        </p>
      )}

      {/* Carga */}
      {isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-48 w-full" />
        </div>
      )}

      {/* Sin estados */}
      {!isLoading && !hasError && estados.length === 0 && (
        <div className="rounded-md border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">
            Este workflow no tiene estados definidos. Define estados primero en la
            sección de configuración.
          </p>
        </div>
      )}

      {/* Diagrama */}
      {!isLoading && !hasError && mermaidDef && (
        <WorkflowDiagram definition={mermaidDef} label={diagramLabel} />
      )}
    </div>
  );
}
