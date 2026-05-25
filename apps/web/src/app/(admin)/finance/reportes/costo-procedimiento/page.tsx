"use client";

/**
 * Reporte 4 — Costo por Procedimiento Quirúrgico y por Estudio Diagnóstico.
 *
 * Agrupado por ServiceUnit. Sin ServiceUnit se agrupa como "Sin unidad de servicio".
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
  serviceUnitId: string | null;
  serviceUnitName: string;
  qty: number;
  costoPromedio: number;
  costoTotal: number;
};

export default function CostoProcedimientoPage() {
  const { desde, hasta, setDesde, setHasta } = useDateRange();
  const [search, setSearch] = React.useState({ fechaDesde: desde, fechaHasta: hasta });

  const query = trpcAny.financeReports.costoPorProcedimiento.useQuery(search);
  const rows: Row[] = query.data ?? [];

  const totalGeneral = rows.reduce((s, r) => s + r.costoTotal, 0);
  const totalItems = rows.reduce((s, r) => s + r.qty, 0);

  function handleCsv() {
    downloadCsv(
      `costo-procedimiento-${search.fechaDesde}-${search.fechaHasta}.csv`,
      ["Unidad de Servicio", "Cantidad", "Costo Promedio", "Costo Total"],
      rows.map((r) => [r.serviceUnitName, String(r.qty), fmtCurrency(r.costoPromedio), fmtCurrency(r.costoTotal)]),
    );
  }

  async function handlePdf() {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF();
    doc.setFontSize(14);
    doc.text(`Costo por Procedimiento — ${search.fechaDesde} / ${search.fechaHasta}`, 14, 18);
    doc.setFontSize(9);
    let y = 30;
    doc.text(["Unidad de Servicio", "Cant.", "C.Promedio", "C.Total"].join("  |  "), 14, y);
    y += 6;
    for (const r of rows) {
      if (y > 270) { doc.addPage(); y = 18; }
      doc.text([r.serviceUnitName.slice(0, 30), String(r.qty), fmtCurrency(r.costoPromedio), fmtCurrency(r.costoTotal)].join("  |  "), 14, y);
      y += 6;
    }
    doc.save(`costo-procedimiento-${search.fechaDesde}.pdf`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Costo por Procedimiento</h1>
          <p className="text-sm text-muted-foreground">
            Agrupado por unidad de servicio. Incluye quirúrgicos y estudios diagnósticos.
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
        <div className="grid grid-cols-2 gap-3">
          <Card className="text-center">
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Total procedimientos</p>
              <p className="font-mono text-lg font-bold">{totalItems}</p>
            </CardContent>
          </Card>
          <Card className="text-center">
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Costo total periodo</p>
              <p className="font-mono text-lg font-bold">${fmtCurrency(totalGeneral)}</p>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Unidad de Servicio</TableHead>
              <TableHead className="text-right">Cantidad</TableHead>
              <TableHead className="text-right">Costo Promedio</TableHead>
              <TableHead className="text-right">Costo Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isLoading ? (
              <SkeletonRows cols={4} />
            ) : rows.length === 0 ? (
              <EmptyState />
            ) : (
              rows.map((r, idx) => (
                <TableRow key={r.serviceUnitId ?? idx}>
                  <TableCell className="text-sm">{r.serviceUnitName}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{r.qty}</TableCell>
                  <TableCell className="text-right font-mono text-sm">${fmtCurrency(r.costoPromedio)}</TableCell>
                  <TableCell className="text-right font-mono text-sm font-semibold">${fmtCurrency(r.costoTotal)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
