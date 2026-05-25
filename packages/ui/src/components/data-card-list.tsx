/**
 * DataCardList — patrón "responsive table" para listas densas.
 *
 * En mobile (< sm) renderiza cada fila como Card vertical con label:valor.
 * En desktop (≥ sm) renderiza una <table> tradicional.
 *
 * Server Component compatible: no usa hooks ni event handlers. Las props
 * `getKey`, `columns[i].cell` y `actions` se evalúan en el servidor durante
 * el render y emiten HTML estático — no requieren cruzar la frontera client.
 * (Marcarlo `"use client"` rompe el build porque server pages le pasan funciones
 * que no se pueden serializar.)
 *
 * Uso:
 *   <DataCardList
 *     data={rows}
 *     getKey={(r) => r.id}
 *     columns={[
 *       { id: "medico", header: "Médico", cell: (r) => r.medico, primary: true },
 *       { id: "fecha",  header: "Fecha",  cell: (r) => fmt(r.date) },
 *     ]}
 *     actions={(r) => <Button onClick={...}>Ver</Button>}
 *     emptyMessage="Sin registros"
 *   />
 *
 * Una columna marcada `primary: true` se renderiza como título de la card
 * en mobile (sin label).
 */
import * as React from "react";
import { cn } from "../lib/utils";
import { Card, CardContent } from "./card";

export interface DataCardColumn<T> {
  id: string;
  header: React.ReactNode;
  /** Render del valor para esta fila. */
  cell: (row: T, index: number) => React.ReactNode;
  /** Si true, se usa como título de la card en mobile (no muestra el header). */
  primary?: boolean;
  /** Si true, oculta en mobile (solo desktop). */
  hideOnMobile?: boolean;
  /** Clase aplicada a `<th>` y `<td>` en modo tabla. */
  className?: string;
  /** Alineación de la celda. Defecto: left. */
  align?: "left" | "center" | "right";
}

export interface DataCardListProps<T> {
  data: ReadonlyArray<T>;
  getKey: (row: T, index: number) => React.Key;
  columns: DataCardColumn<T>[];
  /** Acciones opcionales por fila (botones). Aparecen al final de cada card / row. */
  actions?: (row: T, index: number) => React.ReactNode;
  /** Mensaje cuando data está vacía. */
  emptyMessage?: React.ReactNode;
  /** Clase del wrapper externo. */
  className?: string;
}

export function DataCardList<T>({
  data,
  getKey,
  columns,
  actions,
  emptyMessage = "Sin registros",
  className,
}: DataCardListProps<T>) {
  if (data.length === 0) {
    return (
      <p className="rounded-md border border-dashed bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className={cn("w-full", className)}>
      {/* Mobile (< sm): cards */}
      <ul className="space-y-2 sm:hidden" aria-label="Lista de registros">
        {data.map((row, idx) => {
          const primary = columns.find((c) => c.primary);
          const fields = columns.filter((c) => !c.primary && !c.hideOnMobile);
          return (
            <li key={getKey(row, idx)}>
              <Card>
                <CardContent className="p-3">
                  {primary && (
                    <div className="mb-2 text-sm font-medium leading-tight">
                      {primary.cell(row, idx)}
                    </div>
                  )}
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                    {fields.map((col) => (
                      <React.Fragment key={col.id}>
                        <dt className="text-muted-foreground">{col.header}</dt>
                        <dd className={cn(
                          "min-w-0 break-words",
                          col.align === "right" && "text-right",
                          col.align === "center" && "text-center",
                        )}>
                          {col.cell(row, idx)}
                        </dd>
                      </React.Fragment>
                    ))}
                  </dl>
                  {actions && (
                    <div className="mt-3 flex flex-wrap gap-2 border-t pt-2">
                      {actions(row, idx)}
                    </div>
                  )}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>

      {/* Desktop (≥ sm): tabla */}
      <div className="hidden w-full overflow-x-auto rounded-md border sm:block">
        <table className="w-full caption-bottom text-sm">
          <thead className="border-b bg-muted/30">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.id}
                  className={cn(
                    "h-10 px-3 align-middle text-xs font-medium text-muted-foreground sm:h-12 sm:px-4",
                    col.align === "right" && "text-right",
                    col.align === "center" && "text-center",
                    !col.align && "text-left",
                    col.className,
                  )}
                >
                  {col.header}
                </th>
              ))}
              {actions && <th className="h-12 w-1 px-4" aria-label="Acciones" />}
            </tr>
          </thead>
          <tbody>
            {data.map((row, idx) => (
              <tr key={getKey(row, idx)} className="border-b transition-colors hover:bg-muted/30">
                {columns.map((col) => (
                  <td
                    key={col.id}
                    className={cn(
                      "px-3 py-2 align-middle text-xs sm:p-3 sm:text-sm",
                      col.align === "right" && "text-right",
                      col.align === "center" && "text-center",
                      col.className,
                    )}
                  >
                    {col.cell(row, idx)}
                  </td>
                ))}
                {actions && (
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <div className="flex justify-end gap-2">{actions(row, idx)}</div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
