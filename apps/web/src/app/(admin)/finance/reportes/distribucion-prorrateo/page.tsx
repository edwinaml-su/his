"use client";

/**
 * Reporte 2 — Distribución de Centros de Apoyo.
 *
 * Reglas de asignación de centros de apoyo hacia intermedios y productivos.
 * Si no hay reglas configuradas, muestra empty state con indicación.
 */
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Badge } from "@his/ui/components/badge";
import { trpc } from "@/lib/trpc/react";
import { ExportBar, downloadCsv } from "../_shared";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trpcAny = trpc as any;

type Target = { code: string; name: string; porcentaje: number };
type RuleGroup = {
  ruleId: string;
  ruleName: string;
  periodicidad: string;
  sourceCode: string;
  sourceName: string;
  baseDistribucion: string | null;
  targets: Target[];
};

export default function DistribucionProrrateoPage() {
  const query = trpcAny.financeReports.distribucionProrrateo.useQuery({});
  const grupos: RuleGroup[] = query.data ?? [];

  function handleCsv() {
    const rows: string[][] = [];
    for (const g of grupos) {
      for (const t of g.targets) {
        rows.push([g.ruleName, g.sourceCode, g.sourceName, g.periodicidad, g.baseDistribucion ?? "", t.code, t.name, String(t.porcentaje)]);
      }
    }
    downloadCsv("distribucion-prorrateo.csv", ["Regla", "Fuente Código", "Fuente Nombre", "Periodicidad", "Base Dist.", "Destino Código", "Destino Nombre", "Porcentaje %"], rows);
  }

  async function handlePdf() {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF();
    doc.setFontSize(14);
    doc.text("Distribución de Centros de Apoyo — Reglas de Prorrateo", 14, 18);
    doc.setFontSize(9);
    let y = 30;
    for (const g of grupos) {
      if (y > 270) { doc.addPage(); y = 18; }
      doc.setFontSize(11);
      doc.text(`${g.sourceCode} — ${g.sourceName} (${g.periodicidad})`, 14, y);
      y += 6;
      doc.setFontSize(9);
      for (const t of g.targets) {
        if (y > 270) { doc.addPage(); y = 18; }
        doc.text(`  → ${t.code} ${t.name}: ${t.porcentaje}%`, 14, y);
        y += 5;
      }
      y += 4;
    }
    doc.save("distribucion-prorrateo.pdf");
  }

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Distribución de Centros de Apoyo</h1>
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Distribución de Centros de Apoyo</h1>
          <p className="text-sm text-muted-foreground">
            Reglas de prorrateo configuradas para distribución de costos indirectos.
          </p>
        </div>
        <ExportBar onCsv={handleCsv} onPdf={handlePdf} />
      </div>

      {grupos.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No hay reglas de prorrateo configuradas. Configure centros de apoyo con base de
            distribución desde la sección de Centros de Costo.
          </CardContent>
        </Card>
      ) : (
        grupos.map((g) => (
          <Card key={g.ruleId}>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">{g.ruleName}</CardTitle>
                <Badge variant="secondary">{g.periodicidad}</Badge>
                {g.baseDistribucion ? (
                  <Badge variant="outline">{g.baseDistribucion}</Badge>
                ) : null}
              </div>
              <p className="text-sm text-muted-foreground">
                Fuente: <span className="font-mono">{g.sourceCode}</span> — {g.sourceName}
              </p>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {g.targets.map((t) => (
                  <div key={t.code} className="flex items-center justify-between rounded-md border px-3 py-2">
                    <div className="text-sm">
                      <span className="font-mono text-xs text-muted-foreground">{t.code}</span>{" "}
                      {t.name}
                    </div>
                    <span className="font-mono text-sm font-semibold">{t.porcentaje}%</span>
                  </div>
                ))}
                <p className="pt-1 text-right text-xs text-muted-foreground">
                  Total: {g.targets.reduce((s, t) => s + t.porcentaje, 0).toFixed(2)}%
                </p>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
