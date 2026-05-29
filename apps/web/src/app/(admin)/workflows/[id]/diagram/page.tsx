"use client";

/**
 * Workflow Diagram (legacy stub).
 *
 * Esta ruta originalmente usaba `mermaid` para renderizar el grafo de estados.
 * El Workflow Designer en `/workflow-designer/[codigo]` ya provee un grafo SVG
 * nativo + editor completo, por lo que esta página solo enlaza ahí.
 */

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@his/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";

export default function WorkflowDiagramRedirect() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Diagrama de workflow</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Esta vista fue movida al Workflow Designer, que incluye grafo de
            estados, editor de transiciones y matriz de roles funcionales.
          </p>
          {/* HG-21: `id` es el UUID de la instancia, no el código del tipo de documento.
              El Workflow Designer indexa por código (ej. HOJA_ING, TRIAJE).
              Redirigimos a la lista para que el usuario elija el tipo correcto. */}
          <div className="flex gap-2">
            <Button asChild>
              <Link href="/workflow-designer">Ver Workflow Designer</Link>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground font-mono">Instancia: {id}</p>
        </CardContent>
      </Card>
    </div>
  );
}
