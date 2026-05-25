"use client";

/**
 * Reporte 3 — Costo por Paciente Egresado y por Estancia.
 *
 * Paginado: 50 egresos por página.
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
import { Button } from "@his/ui/components/button";
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

const LIMIT = 50;

type Row = {
  encounterId: string;
  patientId: string;
  mrn: string | null;
  admissionType: string | null;
  admittedAt: string | null;
  dischargedAt: string | null;
  diasEstancia: number;
  totalCosto: number;
};

export default function CostoPacientePage() {
  const { desde, hasta, setDesde, setHasta } = useDateRange();
  const [search, setSearch] = React.useState({ fechaDesde: desde, fechaHasta: hasta });
  const [offset, setOffset] = React.useState(0);

  const query = trpcAny.financeReports.costoPorPaciente.useQuery({
    ...search,
    limit: LIMIT,
    offset,
  });
  const rows: Row[] = query.data ?? [];

  const totales = React.useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          totalCosto: acc.totalCosto + r.totalCosto,
          diasEstancia: acc.diasEstancia + r.diasEstancia,
        }),
        { totalCosto: 0, diasEstancia: 0 },
      ),
    [rows],
  );

  const costoPorDia = totales.diasEstancia > 0 ? totales.totalCosto / totales.diasEstancia : 0;

  function handleCsv() {
    downloadCsv(
      `costo-paciente-${search.fechaDesde}-${search.fechaHasta}.csv`,
      ["MRN", "Tipo Ingreso", "Fecha Ingreso", "Fecha Egreso", "Días Estancia", "Costo Total", "Costo/Día"],
      rows.map((r) => [
        r.mrn ?? "",
        r.admissionType ?? "",
        r.admittedAt ? new Date(r.admittedAt).toLocaleDateString("es-SV") : "",
        r.dischargedAt ? new Date(r.dischargedAt).toLocaleDateString("es-SV") : "",
        String(r.diasEstancia),
        fmtCurrency(r.totalCosto),
        fmtCurrency(r.diasEstancia > 0 ? r.totalCosto / r.diasEstancia : 0),
      ]),
    );
  }

  async function handlePdf() {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(14);
    doc.text(`Costo por Paciente Egresado — ${search.fechaDesde} / ${search.fechaHasta}`, 14, 18);
    doc.setFontSize(9);
    let y = 30;
    doc.text(["MRN", "Tipo", "Egreso", "Días", "Costo Total", "Costo/Día"].join("  |  "), 14, y);
    y += 6;
    for (const r of rows) {
      if (y > 185) { doc.addPage(); y = 18; }
      doc.text(
        [
          r.mrn ?? "",
          r.admissionType ?? "",
          r.dischargedAt ? new Date(r.dischargedAt).toLocaleDateString("es-SV") : "",
          String(r.diasEstancia),
          fmtCurrency(r.totalCosto),
          fmtCurrency(r.diasEstancia > 0 ? r.totalCosto / r.diasEstancia : 0),
        ].join("  |  "),
        14,
        y,
      );
      y += 6;
    }
    doc.save(`costo-paciente-${search.fechaDesde}.pdf`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Costo por Paciente Egresado</h1>
          <p className="text-sm text-muted-foreground">
            Costo total y por día de estancia para egresos del periodo.
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
            onSearch={() => { setOffset(0); setSearch({ fechaDesde: desde, fechaHasta: hasta }); }}
            loading={query.isLoading}
          />
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[
            { label: "Egresos en página", value: String(rows.length) },
            { label: "Total días estancia", value: String(totales.diasEstancia) },
            { label: "Costo por día (promedio)", value: `$${fmtCurrency(costoPorDia)}` },
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
              <TableHead>MRN</TableHead>
              <TableHead>Tipo Ingreso</TableHead>
              <TableHead>Fecha Ingreso</TableHead>
              <TableHead>Fecha Egreso</TableHead>
              <TableHead className="text-right">Días</TableHead>
              <TableHead className="text-right">Costo Total</TableHead>
              <TableHead className="text-right">Costo/Día</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isLoading ? (
              <SkeletonRows cols={7} />
            ) : rows.length === 0 ? (
              <EmptyState message="Sin egresos con facturación en el periodo seleccionado." />
            ) : (
              rows.map((r) => (
                <TableRow key={r.encounterId}>
                  <TableCell className="font-mono text-xs">{r.mrn ?? "—"}</TableCell>
                  <TableCell className="text-xs capitalize">{r.admissionType ?? "—"}</TableCell>
                  <TableCell className="text-sm">
                    {r.admittedAt ? new Date(r.admittedAt).toLocaleDateString("es-SV") : "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.dischargedAt ? new Date(r.dischargedAt).toLocaleDateString("es-SV") : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">{r.diasEstancia}</TableCell>
                  <TableCell className="text-right font-mono text-sm">${fmtCurrency(r.totalCosto)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    ${fmtCurrency(r.diasEstancia > 0 ? r.totalCosto / r.diasEstancia : 0)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {rows.length === LIMIT || offset > 0 ? (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>
            Anterior
          </Button>
          <Button variant="outline" size="sm" disabled={rows.length < LIMIT} onClick={() => setOffset(offset + LIMIT)}>
            Siguiente
          </Button>
        </div>
      ) : null}
    </div>
  );
}
