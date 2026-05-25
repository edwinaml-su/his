"use client";

/**
 * Reporte 1 — Estado de Resultados por Centro de Costo.
 *
 * Muestra ingresos, costo directo, costo indirecto (preview ad-hoc de prorrateo)
 * y margen por centro de costo para el periodo seleccionado.
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
  fmtPct,
  ExportBar,
  downloadCsv,
  SkeletonRows,
  EmptyState,
} from "../_shared";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trpcAny = trpc as any;

type Row = {
  code: string;
  name: string;
  tipo: string;
  ingresos: number;
  costoDirecto: number;
  costoIndirecto: number;
  margen: number;
  margenPct: number;
};

export default function EstadoResultadosPage() {
  const { desde, hasta, setDesde, setHasta } = useDateRange();
  const [search, setSearch] = React.useState({ fechaDesde: desde, fechaHasta: hasta });

  const query = trpcAny.financeReports.estadoResultadosPorCentro.useQuery(search);
  const rows: Row[] = query.data ?? [];

  const totales = React.useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          ingresos: acc.ingresos + r.ingresos,
          costoDirecto: acc.costoDirecto + r.costoDirecto,
          costoIndirecto: acc.costoIndirecto + r.costoIndirecto,
          margen: acc.margen + r.margen,
        }),
        { ingresos: 0, costoDirecto: 0, costoIndirecto: 0, margen: 0 },
      ),
    [rows],
  );

  function handleCsv() {
    downloadCsv(
      `estado-resultados-${search.fechaDesde}-${search.fechaHasta}.csv`,
      ["Código", "Centro de Costo", "Tipo", "Ingresos", "Costo Directo", "Costo Indirecto", "Margen", "Margen %"],
      rows.map((r) => [
        r.code,
        r.name,
        r.tipo,
        fmtCurrency(r.ingresos),
        fmtCurrency(r.costoDirecto),
        fmtCurrency(r.costoIndirecto),
        fmtCurrency(r.margen),
        fmtPct(r.margenPct),
      ]),
    );
  }

  async function handlePdf() {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(14);
    doc.text(`Estado de Resultados por Centro de Costo — ${search.fechaDesde} / ${search.fechaHasta}`, 14, 18);
    doc.setFontSize(9);
    let y = 30;
    doc.text(["Código", "Centro", "Tipo", "Ingresos", "C.Directo", "C.Indirecto", "Margen", "Margen%"].join("  |  "), 14, y);
    y += 6;
    for (const r of rows) {
      if (y > 185) { doc.addPage(); y = 18; }
      doc.text(
        [r.code, r.name.slice(0, 22), r.tipo, fmtCurrency(r.ingresos), fmtCurrency(r.costoDirecto), fmtCurrency(r.costoIndirecto), fmtCurrency(r.margen), fmtPct(r.margenPct)].join("  |  "),
        14,
        y,
      );
      y += 6;
    }
    doc.save(`estado-resultados-${search.fechaDesde}.pdf`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Estado de Resultados por Centro de Costo</h1>
          <p className="text-sm text-muted-foreground">
            Ingresos, costos y margen por centro. costoIndirecto es preview ad-hoc de prorrateo.
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
            { label: "Ingresos totales", value: fmtCurrency(totales.ingresos) },
            { label: "Costo directo", value: fmtCurrency(totales.costoDirecto) },
            { label: "Costo indirecto", value: fmtCurrency(totales.costoIndirecto) },
            { label: "Margen neto", value: fmtCurrency(totales.margen) },
          ].map((m) => (
            <Card key={m.label} className="text-center">
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">{m.label}</p>
                <p className="font-mono text-lg font-bold">${m.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Centro de Costo</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="text-right">Ingresos</TableHead>
              <TableHead className="text-right">C. Directo</TableHead>
              <TableHead className="text-right">C. Indirecto</TableHead>
              <TableHead className="text-right">Margen</TableHead>
              <TableHead className="text-right">Margen %</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isLoading ? (
              <SkeletonRows cols={8} />
            ) : rows.length === 0 ? (
              <EmptyState />
            ) : (
              rows.map((r) => (
                <TableRow key={r.code}>
                  <TableCell className="font-mono text-xs">{r.code}</TableCell>
                  <TableCell className="text-sm">{r.name}</TableCell>
                  <TableCell className="text-xs capitalize">{r.tipo}</TableCell>
                  <TableCell className="text-right font-mono text-sm">${fmtCurrency(r.ingresos)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">${fmtCurrency(r.costoDirecto)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">${fmtCurrency(r.costoIndirecto)}</TableCell>
                  <TableCell className={`text-right font-mono text-sm ${r.margen < 0 ? "text-destructive" : ""}`}>
                    ${fmtCurrency(r.margen)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">{fmtPct(r.margenPct)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
