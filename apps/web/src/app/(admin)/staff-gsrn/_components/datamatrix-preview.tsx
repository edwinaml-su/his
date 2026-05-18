"use client";

/**
 * DataMatrix badge preview.
 *
 * Renderiza el payload GS1 (AI 8018 + GSRN-18) como DataMatrix usando bwip-js.
 * Fallback textual si la lib no carga (error de runtime).
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
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [rendered, setRendered] = React.useState(false);
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const bwipjs = await import("bwip-js");
        if (!canvasRef.current || cancelled) return;

        bwipjs.toCanvas(canvasRef.current, {
          bcid: "datamatrix",
          text: gs1Payload,
          scale: 3,
          height: 10,
          includetext: false,
        });

        if (!cancelled) setRendered(true);
      } catch {
        if (!cancelled) setError(true);
      }
    }

    void render();
    return () => {
      cancelled = true;
    };
  }, [gs1Payload]);

  return (
    <Card className="w-fit">
      <CardContent className="flex flex-col items-center gap-3 p-4">
        <div
          className="relative flex h-32 w-32 items-center justify-center rounded border bg-white"
          aria-label={`DataMatrix badge para ${nombre ?? "profesional"}`}
        >
          <canvas
            ref={canvasRef}
            className={rendered ? "block" : "hidden"}
            role="img"
            aria-label="DataMatrix GS1"
          />
          {!rendered && !error && (
            <span className="text-xs text-muted-foreground">Generando...</span>
          )}
          {error && (
            <span className="text-center text-xs text-muted-foreground">
              Error generando
              <br />
              DataMatrix
            </span>
          )}
        </div>

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
