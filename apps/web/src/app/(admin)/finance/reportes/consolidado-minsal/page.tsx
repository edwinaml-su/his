"use client";

/**
 * Reporte 7 — Consolidado MINSAL por Tipo de Centro.
 *
 * Agrega ingresos, costos, facturas y egresos agrupados por tipo
 * (productivo / intermedio / apoyo) para reporte regulatorio MINSAL.
 */
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Badge } from "@his/ui/components/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { trpc } from "@/lib/trpc/react";
import {
  DateRangePicker,
  useDateRange,
  fmtCurrency,
  ExportBar,
  downloadCsv,
  SkeletonRows,
  EmptyState,
} from "../_shared";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trpcAny = trpc as any;

type Row = {
  tipo: string;
  numCentros: number;
  ingresosTotal: number;
  costosDirectosTotal: number;
  numFacturas: number;
  numEgresos: number;
};

const TIPO_LABEL: Record<string, string> = {
  productivo: "Productivo",
  intermedio: "Intermedio",
  apoyo: "Apoyo",
};

const TIPO_BADGE: Record<string, "default" | "secondary" | "outline"> = {
  productivo: "default",
  intermedio: "secondary",
  apoyo: "outline",
};

export default function ConsolidadoMinsalPage() {
  const { desde, hasta, setDesde, setHasta } = useDateRange();
  const [search, setSearch] = React.useState({ fechaDesde: desde, fechaHasta: hasta });

  const query = trpcAny.financeReports.consolidadoMinsal.useQuery(search);
  const rows: Row[] = query.data ?? [];

  const totales = React.useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          ingresosTotal: acc.ingresosTotal + r.ingresosTotal,
          costosDirectosTotal: acc.costosDirectosTotal + r.costosDirectosTotal,
          numFacturas: acc.numFacturas + r.numFacturas,
          numEgresos: acc.numEgresos + r.numEgresos,
          numCentros: acc.numCentros + r.numCentros,
        }),
        { ingresosTotal: 0, costosDirectosTotal: 0, numFacturas: 0, numEgresos: 0, numCentros: 0 },
      ),
    [rows],
  );

  function handleCsv() {
    downloadCsv(
      `consolidado-minsal-${search.fechaDesde}-${search.fechaHasta}.csv`,
      ["Tipo Centro", "N° Centros", "Ingresos Total", "Costos Directos", "N° Facturas", "N° Egresos"],
      rows.map((r) => [
        TIPO_LABEL[r.tipo] ?? r.tipo,
        String(r.numCentros),
        fmtCurrency(r.ingresosTotal),
        fmtCurrency(r.costosDirectosTotal),
        String(r.numFacturas),
        String(r.numEgresos),
      ]),
    );
  }

  async function handlePdf() {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(14);
    doc.text(`Consolidado MINSAL — ${search.fechaDesde} / ${search.fechaHasta}`, 14, 18);
    doc.setFontSize(10);
    let y = 30;
    doc.text(["Tipo", "Centros", "Ingresos", "Costos", "Facturas", "Egresos"].join("  |  "), 14, y);
    y += 8;
    for (const r of rows) {
      doc.text(
        [
          TIPO_LABEL[r.tipo] ?? r.tipo,
          String(r.numCentros),
          fmtCurrency(r.ingresosTotal),
          fmtCurrency(r.costosDirectosTotal),
          String(r.numFacturas),
          String(r.numEgresos),
        ].join("  |  "),
        14,
        y,
      );
      y += 8;
    }
    // Totales
    y += 4;
    doc.setFontSize(10);
    doc.text(
      ["TOTAL", String(totales.numCentros), fmtCurrency(totales.ingresosTotal), fmtCurrency(totales.costosDirectosTotal), String(totales.numFacturas), String(totales.numEgresos)].join("  |  "),
      14,
      y,
    );
    doc.save(`consolidado-minsal-${search.fechaDesde}.pdf`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Consolidado MINSAL</h1>
          <p className="text-sm text-muted-foreground">
            Informe regulatorio consolidado por tipo de centro de costo para reporte MINSAL.
          </p>
        </div>
        <ExportBar onCsv={handleCsv} onPdf={handlePdf} />
      </div>

      <Card>
        <CardHeader><CardTitle>Periodo</CardTitle></CardHeader>
        <CardContent>
          <DateRangePicker
            desde={desde}
            hasta={hasta}
            onDesdeChange={setDesde}
            onHastaChange={setHasta}
            onSearch={() => setSearch({ fechaDesde: desde, fechaHasta: hasta })}
            loading={query.isLoading}
          />
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Ingresos totales", value: `$${fmtCurrency(totales.ingresosTotal)}` },
            { label: "Costos directos", value: `$${fmtCurrency(totales.costosDirectosTotal)}` },
            { label: "Total facturas", value: String(totales.numFacturas) },
            { label: "Total egresos", value: String(totales.numEgresos) },
          ].map((m) => (
            <Card key={m.label} className="text-center">
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">{m.label}</p>
                <p className="font-mono text-lg font-bold">{m.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tipo de Centro</TableHead>
              <TableHead className="text-right">N° Centros</TableHead>
              <TableHead className="text-right">Ingresos Total</TableHead>
              <TableHead className="text-right">Costos Directos</TableHead>
              <TableHead className="text-right">N° Facturas</TableHead>
              <TableHead className="text-right">N° Egresos</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isLoading ? (
              <SkeletonRows cols={6} />
            ) : rows.length === 0 ? (
              <EmptyState />
            ) : (
              <>
                {rows.map((r) => (
                  <TableRow key={r.tipo}>
                    <TableCell>
                      <Badge variant={TIPO_BADGE[r.tipo] ?? "outline"}>
                        {TIPO_LABEL[r.tipo] ?? r.tipo}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{r.numCentros}</TableCell>
                    <TableCell className="text-right font-mono text-sm">${fmtCurrency(r.ingresosTotal)}</TableCell>
                    <TableCell className="text-right font-mono text-sm">${fmtCurrency(r.costosDirectosTotal)}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{r.numFacturas}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{r.numEgresos}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 font-semibold">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right font-mono">{totales.numCentros}</TableCell>
                  <TableCell className="text-right font-mono">${fmtCurrency(totales.ingresosTotal)}</TableCell>
                  <TableCell className="text-right font-mono">${fmtCurrency(totales.costosDirectosTotal)}</TableCell>
                  <TableCell className="text-right font-mono">{totales.numFacturas}</TableCell>
                  <TableCell className="text-right font-mono">{totales.numEgresos}</TableCell>
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
