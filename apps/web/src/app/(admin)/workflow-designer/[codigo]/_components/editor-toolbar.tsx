"use client";

/**
 * EditorToolbar — Barra superior del Workflow Designer.
 *
 * Acciones:
 *  - Auto-layout (US.F2.2.04): llama dagre y anima reposicionamiento.
 *  - Zoom fit: ajusta la vista al grafo completo.
 *  - Volver al listado.
 */

import * as React from "react";
import Link from "next/link";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";

interface EditorToolbarProps {
  tipoDocNombre: string;
  tipoDocCodigo: string;
  readOnly: boolean;
  onAutoLayout: () => void;
  onFitView: () => void;
}

export function EditorToolbar({
  tipoDocNombre,
  tipoDocCodigo,
  readOnly,
  onAutoLayout,
  onFitView,
}: EditorToolbarProps) {
  return (
    <div
      aria-label="Barra de herramientas del editor de workflow"
      className="flex items-center gap-3 border-b bg-background px-4 py-2"
    >
      {/* Breadcrumb / título */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Link
          href="/workflow-designer"
          className="text-xs text-muted-foreground hover:text-foreground underline shrink-0"
        >
          Workflow Designer
        </Link>
        <span className="text-xs text-muted-foreground">/</span>
        <span className="text-xs font-medium truncate">{tipoDocNombre}</span>
        <code className="text-xs text-muted-foreground font-mono hidden sm:inline">
          ({tipoDocCodigo})
        </code>
        {readOnly && (
          <Badge variant="outline" className="text-xs shrink-0">
            Solo lectura
          </Badge>
        )}
      </div>

      {/* Acciones */}
      <div className="flex items-center gap-2 shrink-0">
        <Button
          size="sm"
          variant="outline"
          onClick={onFitView}
          aria-label="Ajustar vista al grafo completo"
          data-testid="fit-view-btn"
        >
          Encuadrar
        </Button>

        {!readOnly && (
          <Button
            size="sm"
            variant="outline"
            onClick={onAutoLayout}
            aria-label="Aplicar auto-layout dagre"
            data-testid="auto-layout-btn"
          >
            Auto-layout
          </Button>
        )}

        <Button asChild size="sm" variant="outline">
          <Link href={`/workflow-designer/${tipoDocCodigo}/editar`}>
            Editar tabla
          </Link>
        </Button>
      </div>
    </div>
  );
}
