"use client";

/**
 * Reporte 5 — Consumo de Insumos y Medicamentos por Centro de Costo.
 *
 * Heurística: InvoiceItem con descripción que contiene medicament/insumo/fármaco/material.
 * Sin módulo Pharmacy formal en MVP. Se indica claramente en la UI.
 */
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
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
  centroId: string;
  code: string;
  name: string;
  tipo: string;
  totalItems: number;
  totalCosto: number;
};

export default function ConsumoInsumosPage() {
  const { desde, hasta, setDesde, setHasta } = useDateRange();
  const [search, setSearch] = React.useState({ fechaDesde: desde, fechaHasta: hasta });

  const query = trpcAny.financeReports.consumoInsumosPorCentro.useQuery(search);
  const rows: Row[] = query.data ?? [];

  const totalCosto = rows.reduce((s, r) => s + r.totalCosto, 0);
  const totalItems = rows.reduce((s, r) => s + r.totalItems, 0);

  function handleCsv() {
    downloadCsv(
      `consumo-insumos-${search.fechaDesde}-${search.fechaHasta}.csv`,
      ["Código", "Centro", "Tipo", "Ítems", "Costo Total"],
      rows.map((r) => [r.code, r.name, r.tipo, String(r.totalItems), fmtCurrency(r.totalCosto)]),
    );
  }

  async function handlePdf() {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF();
    doc.setFontSize(14);
    doc.text(`Consumo de Insumos — ${search.fechaDesde} / ${search.fechaHasta}`, 14, 18);
    doc.setFontSize(9);
    let y = 30;
    doc.text(["Código", "Centro", "Tipo", "Ítems", "Costo"].join("  |  "), 14, y);
    y += 6;
    for (const r of rows) {
      if (y > 270) { doc.addPage(); y = 18; }
      doc.text([r.code, r.name.slice(0, 25), r.tipo, String(r.totalItems), fmtCurrency(r.totalCosto)].join("  |  "), 14, y);
      y += 6;
    }
    doc.save(`consumo-insumos-${search.fechaDesde}.pdf`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Consumo de Insumos y Medicamentos</h1>
          <p className="text-sm text-muted-foreground">
            Por centro de costo. Identificación por heurística de descripción en ítems de factura.
          </p>
        </div>
        <ExportBar onCsv={handleCsv} onPdf={handlePdf} />
      </div>

      <div className="rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-muted-foreground">
        Nota: los datos se obtienen filtrando ítems de factura cuya descripción contiene
        palabras clave (medicamento, insumo, fármaco, material). Para trazabilidad GS1 completa,
        se requiere integración con el módulo de Farmacia.
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
        <div className="grid grid-cols-2 gap-3">
          <Card className="text-center">
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Total ítems identificados</p>
              <p className="font-mono text-lg font-bold">{totalItems}</p>
            </CardContent>
          </Card>
          <Card className="text-center">
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Costo total periodo</p>
              <p className="font-mono text-lg font-bold">${fmtCurrency(totalCosto)}</p>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Centro de Costo</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="text-right">Ítems</TableHead>
              <TableHead className="text-right">Costo Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isLoading ? (
              <SkeletonRows cols={5} />
            ) : rows.length === 0 ? (
              <EmptyState message="Sin consumo de insumos/medicamentos identificado en el periodo." />
            ) : (
              rows.map((r) => (
                <TableRow key={r.centroId}>
                  <TableCell className="font-mono text-xs">{r.code}</TableCell>
                  <TableCell className="text-sm">{r.name}</TableCell>
                  <TableCell className="text-xs capitalize">{r.tipo}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{r.totalItems}</TableCell>
                  <TableCell className="text-right font-mono text-sm">${fmtCurrency(r.totalCosto)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
