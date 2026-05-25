"use client";

/**
 * Componentes compartidos para páginas de reportes financieros.
 * Reutilizables por las 7 subrutas sin crear abstracción extra.
 */
import * as React from "react";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Button } from "@his/ui/components/button";

// ---------------------------------------------------------------------------
// DateRangePicker
// ---------------------------------------------------------------------------

function currentMonthRange(): { desde: string; hasta: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
  return {
    desde: `${year}-${month}-01`,
    hasta: `${year}-${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function useDateRange() {
  const defaults = currentMonthRange();
  const [desde, setDesde] = React.useState(defaults.desde);
  const [hasta, setHasta] = React.useState(defaults.hasta);
  return { desde, hasta, setDesde, setHasta };
}

interface DateRangePickerProps {
  desde: string;
  hasta: string;
  onDesdeChange: (v: string) => void;
  onHastaChange: (v: string) => void;
  onSearch: () => void;
  loading?: boolean;
}

export function DateRangePicker({
  desde,
  hasta,
  onDesdeChange,
  onHastaChange,
  onSearch,
  loading,
}: DateRangePickerProps) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="space-y-1">
        <Label htmlFor="desde">Desde</Label>
        <Input
          id="desde"
          type="date"
          value={desde}
          onChange={(e) => onDesdeChange(e.target.value)}
          className="w-40"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="hasta">Hasta</Label>
        <Input
          id="hasta"
          type="date"
          value={hasta}
          onChange={(e) => onHastaChange(e.target.value)}
          className="w-40"
        />
      </div>
      <Button onClick={onSearch} variant="outline" disabled={loading}>
        {loading ? "Cargando…" : "Buscar"}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

export function fmtCurrency(n: number): string {
  return n.toLocaleString("es-SV", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtPct(n: number): string {
  return n.toFixed(2) + "%";
}

// ---------------------------------------------------------------------------
// Export buttons
// ---------------------------------------------------------------------------

interface ExportBarProps {
  onCsv: () => void;
  onPdf: () => void;
}

export function ExportBar({ onCsv, onPdf }: ExportBarProps) {
  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={onCsv}>
        Excel (CSV)
      </Button>
      <Button variant="outline" size="sm" onClick={onPdf}>
        PDF
      </Button>
      <Button variant="outline" size="sm" onClick={() => window.print()}>
        Imprimir
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helper: CSV download
// ---------------------------------------------------------------------------

export function downloadCsv(filename: string, headers: string[], rows: string[][]): void {
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

// ---------------------------------------------------------------------------
// Loading skeleton row
// ---------------------------------------------------------------------------

export function SkeletonRows({ cols, rows = 5 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} className="border-b">
          {Array.from({ length: cols }).map((__, j) => (
            <td key={j} className="p-2">
              <div className="h-4 w-full animate-pulse rounded bg-muted" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

export function EmptyState({ message = "Sin datos para el periodo seleccionado." }: { message?: string }) {
  return (
    <tr>
      <td colSpan={99} className="p-6 text-center text-sm text-muted-foreground">
        {message}
      </td>
    </tr>
  );
}
