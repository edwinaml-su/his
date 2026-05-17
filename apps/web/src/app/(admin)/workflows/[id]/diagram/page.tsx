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
          <div className="flex gap-2">
            <Button asChild>
              <Link href={`/workflow-designer/${id}`}>Abrir en Workflow Designer</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/workflow-designer">Ver todos los workflows</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
