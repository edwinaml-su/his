"use client";

/**
 * US.F2.6.3 — GLN hospitalario jerárquico (almacén → farmacia → servicio → cama).
 *
 * Muestra el árbol completo de GLN del tenant con CTE recursiva.
 * Panel derecho muestra detalle del nodo seleccionado + botón para añadir hijo.
 */

import * as React from "react";
import { MapPin, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import { trpc } from "@/lib/trpc/react";
import { GlnTree, type GlnNode } from "./_components/gln-tree";
import { GlnForm } from "./_components/gln-form";

export default function GlnPage() {
  const [selected, setSelected] = React.useState<GlnNode | undefined>(undefined);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const { data: tree, isLoading, isError } = trpc.gs1GlnHierarchy.tree.useQuery(
    { rootId: undefined },
    { staleTime: 30_000 },
  );

  function handleAddRoot() {
    setSelected(undefined);
    setDialogOpen(true);
  }

  function handleAddChild() {
    setDialogOpen(true);
  }

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">GLN — Ubicaciones GS1</h1>
          <p className="text-sm text-muted-foreground">
            Jerarquía de ubicaciones físicas: almacén → farmacia → servicio → cama.
          </p>
        </div>
        <Button onClick={handleAddRoot} data-testid="btn-nuevo-gln-raiz">
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Nueva raíz GLN
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Árbol */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Árbol de ubicaciones</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading && (
              <p className="py-8 text-center text-sm text-muted-foreground" role="status">
                Cargando ubicaciones…
              </p>
            )}
            {isError && (
              <p className="py-8 text-center text-sm text-destructive" role="alert">
                Error al cargar el árbol GLN. Intente nuevamente.
              </p>
            )}
            {!isLoading && !isError && tree && (
              <GlnTree
                nodes={tree}
                onSelect={setSelected}
                selectedId={selected?.id}
              />
            )}
          </CardContent>
        </Card>

        {/* Panel de detalle */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Detalle</CardTitle>
          </CardHeader>
          <CardContent>
            {selected ? (
              <div className="space-y-4">
                <dl className="space-y-2 text-sm">
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Código GLN
                    </dt>
                    <dd className="mt-0.5 font-mono font-semibold" data-testid="detail-codigo">
                      {selected.codigo}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Descripción
                    </dt>
                    <dd className="mt-0.5" data-testid="detail-descripcion">
                      {selected.descripcion}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Tipo
                    </dt>
                    <dd className="mt-0.5">
                      <Badge variant="secondary">{selected.tipo}</Badge>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Nivel
                    </dt>
                    <dd className="mt-0.5">{selected.depth + 1}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Estado
                    </dt>
                    <dd className="mt-0.5">
                      {selected.activo ? (
                        <Badge variant="default">Activo</Badge>
                      ) : (
                        <Badge variant="destructive">Inactivo</Badge>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Sub-ubicaciones
                    </dt>
                    <dd className="mt-0.5">{selected.children.length}</dd>
                  </div>
                </dl>

                <Button
                  className="w-full"
                  variant="outline"
                  onClick={handleAddChild}
                  data-testid="btn-agregar-hijo"
                >
                  <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Agregar sub-ubicación
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <MapPin className="mb-2 h-8 w-8 text-muted-foreground" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">
                  Selecciona un nodo del árbol para ver su detalle.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Dialog alta GLN */}
      <GlnForm
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        parentGlnId={selected?.id}
        parentDescripcion={selected?.descripcion}
        onSuccess={() => setSelected(undefined)}
      />
    </div>
  );
}
