"use client";

/**
 * ProcesoGridTab — grid genérico de ocurrencias de un proceso clínico dentro de
 * una admisión. Una línea por registro (datos básicos); clic en la fila abre un
 * modal con el detalle completo de esa ocurrencia.
 *
 * Es presentacional: el padre pasa las filas (ya consultadas por episodio), la
 * definición de columnas y los campos del detalle. Reutilizado por las pestañas
 * Signos / Indicaciones / Enfermería / Triaje del detalle de episodio.
 */
import * as React from "react";
import { AlertTriangle } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";

export interface ProcesoColumn<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  className?: string;
}

export interface ProcesoDetailField<T> {
  label: string;
  render: (row: T) => React.ReactNode;
  /** Ocupa todo el ancho en el grid del modal (notas largas). */
  full?: boolean;
}

interface ProcesoGridTabProps<T extends { id: string }> {
  rows: T[];
  isLoading: boolean;
  error?: { message: string } | null;
  columns: ProcesoColumn<T>[];
  /** Título del modal de detalle. */
  detailTitle: string;
  detailFields: ProcesoDetailField<T>[];
  emptyLabel?: string;
}

export function ProcesoGridTab<T extends { id: string }>({
  rows,
  isLoading,
  error,
  columns,
  detailTitle,
  detailFields,
  emptyLabel = "Sin registros.",
}: ProcesoGridTabProps<T>) {
  const [selected, setSelected] = React.useState<T | null>(null);

  if (isLoading) {
    return <p className="p-4 text-sm text-muted-foreground">Cargando…</p>;
  }
  if (error) {
    return (
      <div
        role="alert"
        className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
      >
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        {error.message}
      </div>
    );
  }
  if (rows.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((c) => (
              <TableHead key={c.key} className={c.className}>
                {c.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.id}
              role="button"
              tabIndex={0}
              aria-label="Ver detalle del registro"
              onClick={() => setSelected(row)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelected(row);
                }
              }}
              className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {columns.map((c) => (
                <TableCell key={c.key} className={c.className}>
                  {c.render(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{detailTitle}</DialogTitle>
            <DialogDescription>Detalle del registro seleccionado.</DialogDescription>
          </DialogHeader>
          {selected && (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              {detailFields.map((f, i) => (
                <div
                  key={i}
                  className={f.full ? "space-y-0.5 sm:col-span-2" : "space-y-0.5"}
                >
                  <dt className="text-xs text-muted-foreground">{f.label}</dt>
                  <dd className="whitespace-pre-wrap break-words">
                    {f.render(selected) ?? "—"}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
