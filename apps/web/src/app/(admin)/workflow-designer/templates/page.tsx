"use client";

/**
 * Biblioteca de plantillas de workflow (US.F2.2.09-10).
 *
 * Ruta: /admin/workflow-designer/templates
 *
 * - Lista plantillas con filtro por categoría (US.F2.2.10).
 * - Búsqueda full-text por nombre/descripción (US.F2.2.10).
 * - Click "Usar como base" copia la plantilla al workflow seleccionado (US.F2.2.09).
 * - Click "Ver preview" abre modal de solo lectura con el grafo (US.F2.2.09).
 *
 * Roles: DIR o WORKFLOW_DESIGNER (enforced en tRPC, UI muestra alert si falla).
 */

import * as React from "react";
import Link from "next/link";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Input } from "@his/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { Alert, AlertDescription, AlertTitle } from "@his/ui/components/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@his/ui/components/dialog";
import { trpc } from "@/lib/trpc/react";

// ── Categorías ────────────────────────────────────────────────────────────────

const CATEGORIAS = ["Ambulatorio", "Hospitalario", "Quirúrgico", "Maternidad", "Emergencia"] as const;
type Categoria = (typeof CATEGORIAS)[number];

const CATEGORIA_BADGE: Record<Categoria, "default" | "secondary" | "outline"> = {
  Ambulatorio: "secondary",
  Hospitalario: "default",
  Quirúrgico: "outline",
  Maternidad: "secondary",
  Emergencia: "default",
};

// ── Tipos ────────────────────────────────────────────────────────────────────

interface Plantilla {
  id: string;
  codigo: string;
  nombre: string;
  categoria: string;
  descripcion: string | null;
  estados_seed: unknown;
  transiciones_seed: unknown;
  es_sistema: boolean;
  activo: boolean;
}

// ── Preview modal ─────────────────────────────────────────────────────────────

function PreviewModal({
  plantilla,
  onClose,
}: {
  plantilla: Plantilla | null;
  onClose: () => void;
}) {
  if (!plantilla) return null;

  const estados = plantilla.estados_seed as Array<{
    codigo: string;
    nombre: string;
    es_inicial: boolean;
    es_final: boolean;
    orden: number;
  }>;

  const transiciones = plantilla.transiciones_seed as Array<{
    origen_codigo: string;
    destino_codigo: string;
    accion: string;
    rol_codigo: string;
    requiere_firma: boolean;
  }>;

  return (
    <Dialog open={!!plantilla} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl" aria-label={`Preview de plantilla: ${plantilla.nombre}`}>
        <DialogHeader>
          <DialogTitle>{plantilla.nombre}</DialogTitle>
          <DialogDescription>
            Vista previa de la plantilla — solo lectura.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          {plantilla.descripcion && (
            <p className="text-sm text-muted-foreground">{plantilla.descripcion}</p>
          )}

          {/* Estados */}
          <div>
            <h3 className="text-sm font-semibold mb-2">
              Estados ({estados.length})
            </h3>
            <div className="space-y-1">
              {estados.sort((a, b) => a.orden - b.orden).map((e) => (
                <div
                  key={e.codigo}
                  className={`flex items-center gap-2 rounded border px-3 py-1.5 text-sm ${
                    e.es_inicial
                      ? "border-green-300 bg-green-50"
                      : e.es_final
                      ? "border-blue-300 bg-blue-50"
                      : "border-border bg-muted/30"
                  }`}
                >
                  <span className="font-medium">{e.nombre}</span>
                  <code className="text-xs text-muted-foreground">{e.codigo}</code>
                  {e.es_inicial && <Badge className="text-xs bg-green-100 text-green-700 ml-auto">INICIAL</Badge>}
                  {e.es_final && <Badge className="text-xs bg-blue-100 text-blue-700 ml-auto">FINAL</Badge>}
                </div>
              ))}
            </div>
          </div>

          {/* Transiciones */}
          {transiciones.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-2">
                Transiciones ({transiciones.length})
              </h3>
              <div className="space-y-1">
                {transiciones.map((t, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded border border-border px-3 py-1.5 text-xs"
                  >
                    <span className="text-muted-foreground font-mono">{t.origen_codigo}</span>
                    <span className="text-muted-foreground">→</span>
                    <span className="font-medium">{t.accion}</span>
                    <span className="text-muted-foreground">→</span>
                    <span className="text-muted-foreground font-mono">{t.destino_codigo}</span>
                    <Badge variant="outline" className="text-xs ml-auto">{t.rol_codigo}</Badge>
                    {t.requiere_firma && <span className="text-muted-foreground text-xs">(firma)</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Página ────────────────────────────────────────────────────────────────────

export default function TemplatesPage() {
  const [q, setQ] = React.useState("");
  const [categoria, setCategoria] = React.useState<string>("todas");
  const [preview, setPreview] = React.useState<Plantilla | null>(null);

  // Debounce de búsqueda
  const [debouncedQ, setDebouncedQ] = React.useState("");
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: plantillas, isLoading, error } = (trpc as any).workflowPlantilla.list.useQuery({
    categoria: categoria !== "todas" ? categoria : undefined,
    q: debouncedQ || undefined,
    soloActivas: true,
  });

  const lista: Plantilla[] = plantillas ?? [];

  function limpiarFiltros() {
    setQ("");
    setCategoria("todas");
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Biblioteca de plantillas</h1>
          <p className="text-sm text-muted-foreground">
            Plantillas base para crear nuevos workflows clínicos. Requiere rol{" "}
            <code>WORKFLOW_DESIGNER</code> o <code>DIR</code>.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/workflow-designer">Ver todos los workflows</Link>
        </Button>
      </div>

      {/* Filtros (US.F2.2.10) */}
      <div className="flex flex-wrap gap-3 items-center">
        <Input
          placeholder="Buscar plantilla..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
          aria-label="Buscar plantilla por nombre o descripción"
          data-testid="templates-search-input"
        />
        <Select value={categoria} onValueChange={setCategoria}>
          <SelectTrigger className="w-48" aria-label="Filtrar por categoría" data-testid="templates-categoria-filter">
            <SelectValue placeholder="Categoría" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas las categorías</SelectItem>
            {CATEGORIAS.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(q || categoria !== "todas") && (
          <Button
            variant="ghost"
            size="sm"
            onClick={limpiarFiltros}
            aria-label="Limpiar filtros"
            data-testid="templates-clear-filters"
          >
            Limpiar filtros
          </Button>
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          {isLoading ? "Cargando..." : `${lista.length} resultado${lista.length !== 1 ? "s" : ""}`}
        </span>
      </div>

      {/* Error */}
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Error al cargar plantillas</AlertTitle>
          <AlertDescription>{String((error as { message?: string }).message ?? "Error desconocido")}</AlertDescription>
        </Alert>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-40 animate-pulse rounded-lg border bg-muted" aria-hidden="true" />
          ))}
        </div>
      )}

      {/* Sin resultados */}
      {!isLoading && lista.length === 0 && (
        <div
          className="rounded-lg border border-dashed p-8 text-center"
          data-testid="templates-empty-state"
        >
          <p className="text-sm text-muted-foreground">
            {q || categoria !== "todas"
              ? `Sin resultados para los filtros aplicados.`
              : "No hay plantillas disponibles."}
          </p>
          {(q || categoria !== "todas") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={limpiarFiltros}
              className="mt-2"
            >
              Limpiar búsqueda
            </Button>
          )}
        </div>
      )}

      {/* Grid de plantillas */}
      {!isLoading && lista.length > 0 && (
        <div
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
          aria-label="Plantillas de workflow"
          data-testid="templates-grid"
        >
          {lista.map((p: Plantilla) => (
            <Card key={p.id} className="flex flex-col" data-testid={`template-card-${p.codigo}`}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-sm font-semibold leading-tight">
                    {p.nombre}
                  </CardTitle>
                  <Badge
                    variant={CATEGORIA_BADGE[p.categoria as Categoria] ?? "outline"}
                    className="shrink-0 text-xs"
                  >
                    {p.categoria}
                  </Badge>
                </div>
                {p.descripcion && (
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                    {p.descripcion}
                  </p>
                )}
              </CardHeader>
              <CardContent className="flex flex-col gap-2 pt-0 mt-auto">
                <div className="flex items-center gap-1 flex-wrap">
                  {p.es_sistema && (
                    <Badge variant="secondary" className="text-xs">Sistema</Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {(p.estados_seed as unknown[]).length} estados
                  </span>
                  <span className="text-xs text-muted-foreground">·</span>
                  <span className="text-xs text-muted-foreground">
                    {(p.transiciones_seed as unknown[]).length} transiciones
                  </span>
                </div>
                <div className="flex gap-2 mt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPreview(p)}
                    aria-label={`Ver preview de ${p.nombre}`}
                    data-testid={`template-preview-${p.codigo}`}
                  >
                    Ver preview
                  </Button>
                  {/* "Usar como base" enlaza al editor con la plantilla pre-seleccionada */}
                  <Button
                    size="sm"
                    asChild
                    aria-label={`Usar ${p.nombre} como base`}
                    data-testid={`template-use-${p.codigo}`}
                  >
                    <Link href={`/workflow-designer?fromTemplate=${p.codigo}`}>
                      Usar como base
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Modal preview */}
      <PreviewModal plantilla={preview} onClose={() => setPreview(null)} />

      {/* Breadcrumb */}
      <p className="text-xs text-muted-foreground">
        <Link href="/workflow-designer" className="underline">
          Workflow Designer
        </Link>{" "}
        / Biblioteca de plantillas
      </p>
    </div>
  );
}
