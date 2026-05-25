import * as React from "react";
import { cn } from "../lib/utils";

/**
 * Tabla shadcn estándar con scroll horizontal automático.
 *
 * Padding responsivo: las celdas usan p-2 en mobile y sm:p-4 en ≥ 640px
 * para evitar que el contenido se corte y obligue al scroll cuando no
 * hace falta. Las páginas que tengan datos muy densos pueden override.
 */
export const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="relative w-full overflow-x-auto">
      <table ref={ref} className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  ),
);
Table.displayName = "Table";

export const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />
));
TableHeader.displayName = "TableHeader";

export const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
));
TableBody.displayName = "TableBody";

export const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      "border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
      className,
    )}
    {...props}
  />
));
TableRow.displayName = "TableRow";

export const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-10 px-2 text-left align-middle text-xs font-medium text-muted-foreground sm:h-12 sm:px-4 sm:text-sm [&:has([role=checkbox])]:pr-0",
      className,
    )}
    {...props}
  />
));
TableHead.displayName = "TableHead";

export const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      "px-2 py-2 align-middle text-xs sm:p-4 sm:text-sm [&:has([role=checkbox])]:pr-0",
      className,
    )}
    {...props}
  />
));
TableCell.displayName = "TableCell";

/**
 * `<TableContainer>` opcional para tablas con sticky header.
 * Útil en tablas largas (eMAR, kardex). Define `maxHeight` para activar
 * el header pegado al scroll vertical.
 */
export const TableContainer = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    /** Si se pasa, el wrapper limita la altura y el header queda sticky. */
    maxHeight?: string;
  }
>(({ className, maxHeight, style, ...props }, ref) => (
  <div
    ref={ref}
    style={maxHeight ? { ...style, maxHeight } : style}
    className={cn(
      "relative w-full overflow-auto rounded-md border",
      maxHeight ? "[&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10 [&_thead]:bg-background" : "",
      className,
    )}
    {...props}
  />
));
TableContainer.displayName = "TableContainer";
