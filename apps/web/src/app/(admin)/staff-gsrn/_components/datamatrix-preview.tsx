"use client";

/**
 * DataMatrix badge preview.
 *
 * Renderiza el payload GS1 (AI 8018 + GSRN-18) como DataMatrix
 * usando bwip-js vía CDN script o muestra el payload textual como
 * fallback (para entornos sin canvas/bwip-js cargado).
 *
 * Uso: <DatamatrixPreview gs1Payload="(8018)800000000000000000" nombre="Dr. García" rol="PHYSICIAN" />
 */

import * as React from "react";
import { Badge } from "@his/ui/components/badge";
import { Card, CardContent } from "@his/ui/components/card";

interface DatamatrixPreviewProps {
  gs1Payload: string;
  nombre: string | null;
  rol: string | null;
  gsrn: string;
}

export function DatamatrixPreview({
  gs1Payload,
  nombre,
  rol,
  gsrn,
}: DatamatrixPreviewProps) {
  return (
    <Card className="w-fit">
      <CardContent className="flex flex-col items-center gap-3 p-4">
        {/* Placeholder preview — DataMatrix renderiza server-side al imprimir */}
        <div
          className="relative flex h-32 w-32 items-center justify-center rounded border bg-white"
          aria-label={`DataMatrix badge para ${nombre ?? "profesional"}`}
        >
          <span className="text-center text-xs text-muted-foreground">
            DataMatrix
            <br />
            (se genera al imprimir)
          </span>
        </div>

        {/* Payload legible */}
        <div className="text-center">
          <p className="font-mono text-xs text-muted-foreground">{gs1Payload}</p>
          <p className="mt-1 text-sm font-semibold">{nombre ?? "—"}</p>
          {rol && (
            <Badge variant="outline" className="mt-1 text-xs">
              {rol}
            </Badge>
          )}
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            GSRN: {gsrn.match(/.{1,4}/g)?.join(" ")}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
