"use client";

/**
 * docs/48 Ola 4 (C4-4) — Libro de controlados (Ley Reguladora de Actividades
 * Relativas a las Drogas). Listado por rango de fechas de dispensaciones
 * `isControlled=true` + export CSV client-side.
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
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { trpc } from "@/lib/trpc/react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trpcAny = trpc as any;

interface LibroRow {
  id: string;
  dispensedAt: string;
  quantity: number;
  lote: string | null;
  expiryDate: string | null;
  genericName: string;
  brandName: string | null;
  paciente: string | null;
  mrn: string | null;
  dispensadoPor: string;
  testigo: string | null;
  justificacion: string | null;
}

function currentMonthRange(): { desde: string; hasta: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
  return { desde: `${year}-${month}-01`, hasta: `${year}-${month}-${String(lastDay).padStart(2, "0")}` };
}

function downloadCsv(filename: string, headers: string[], rows: string[][]): void {
  const lines = [
    headers.join(","),
    ...rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function LibroControladosPage() {
  const defaults = currentMonthRange();
  const [desde, setDesde] = React.useState(defaults.desde);
  const [hasta, setHasta] = React.useState(defaults.hasta);
  const [search, setSearch] = React.useState({ fechaDesde: defaults.desde, fechaHasta: defaults.hasta });

  const query = trpcAny.pharmacy.dispense.libroControlados.useQuery(search);
  const rows: LibroRow[] = query.data ?? [];

  function handleCsv() {
    downloadCsv(
      `libro-controlados-${search.fechaDesde}-${search.fechaHasta}.csv`,
      ["Fecha", "Fármaco", "Lote", "Vencimiento", "Cantidad", "Paciente", "MRN", "Dispensado por", "Testigo", "Justificación"],
      rows.map((r) => [
        new Date(r.dispensedAt).toLocaleString("es-SV"),
        r.brandName ? `${r.genericName} (${r.brandName})` : r.genericName,
        r.lote ?? "",
        r.expiryDate ? new Date(r.expiryDate).toLocaleDateString("es-SV") : "",
        String(r.quantity),
        r.paciente ?? "",
        r.mrn ?? "",
        r.dispensadoPor,
        r.testigo ?? "",
        r.justificacion ?? "",
      ]),
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Libro de Controlados</h1>
          <p className="text-sm text-muted-foreground">
            Dispensaciones de fármacos de control especial (Ley Reguladora de Actividades Relativas a las Drogas).
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleCsv}>
          Excel (CSV)
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Periodo</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label htmlFor="desde">Desde</Label>
              <Input id="desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="w-40" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="hasta">Hasta</Label>
              <Input id="hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="w-40" />
            </div>
            <Button
              onClick={() => setSearch({ fechaDesde: desde, fechaHasta: hasta })}
              variant="outline"
              disabled={query.isLoading}
            >
              {query.isLoading ? "Cargando…" : "Buscar"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Fármaco</TableHead>
              <TableHead>Lote</TableHead>
              <TableHead className="text-right">Cant.</TableHead>
              <TableHead>Paciente</TableHead>
              <TableHead>Dispensado por</TableHead>
              <TableHead>Testigo</TableHead>
              <TableHead>Justificación</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="p-6 text-center text-sm text-muted-foreground">
                  Cargando…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="p-6 text-center text-sm text-muted-foreground">
                  Sin dispensaciones de controlados en el periodo seleccionado.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-sm">{new Date(r.dispensedAt).toLocaleString("es-SV")}</TableCell>
                  <TableCell>{r.brandName ? `${r.genericName} (${r.brandName})` : r.genericName}</TableCell>
                  <TableCell className="font-mono text-xs">{r.lote ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{r.quantity}</TableCell>
                  <TableCell className="text-sm">
                    {r.paciente ?? "—"}
                    {r.mrn ? <span className="text-xs text-muted-foreground"> ({r.mrn})</span> : null}
                  </TableCell>
                  <TableCell className="text-sm">{r.dispensadoPor}</TableCell>
                  <TableCell className="text-sm">{r.testigo ?? "—"}</TableCell>
                  <TableCell className="max-w-xs truncate text-sm" title={r.justificacion ?? undefined}>
                    {r.justificacion ?? "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
