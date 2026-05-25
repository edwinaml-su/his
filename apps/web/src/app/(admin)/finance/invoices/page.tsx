"use client";

/**
 * /finance/invoices — Listado de facturas.
 *
 * Filtros: status, rango de fechas, paginación.
 * Acciones: ver detalle, nueva factura.
 */
import * as React from "react";
import Link from "next/link";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { trpc } from "@/lib/trpc/react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trpcAny = trpc as any;

type InvoiceStatus = "DRAFT" | "ISSUED" | "PAID" | "PARTIALLY_PAID" | "VOIDED";

const STATUS_LABELS: Record<InvoiceStatus, string> = {
  DRAFT: "Borrador",
  ISSUED: "Emitida",
  PAID: "Pagada",
  PARTIALLY_PAID: "Pago parcial",
  VOIDED: "Anulada",
};

const STATUS_VARIANT: Record<
  InvoiceStatus,
  "secondary" | "success" | "warning" | "outline" | "critical"
> = {
  DRAFT: "secondary",
  ISSUED: "warning",
  PAID: "success",
  PARTIALLY_PAID: "warning",
  VOIDED: "critical",
};

const STATUSES: InvoiceStatus[] = [
  "DRAFT",
  "ISSUED",
  "PAID",
  "PARTIALLY_PAID",
  "VOIDED",
];

function fmt(n: string | number) {
  return Number(n).toLocaleString("es-SV", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function InvoicesPage() {
  const orgQuery = trpcAny.organization.current.useQuery();
  const org = orgQuery.data;

  const [status, setStatus] = React.useState<string>("");
  const [fechaDesde, setFechaDesde] = React.useState("");
  const [fechaHasta, setFechaHasta] = React.useState("");
  const [offset, setOffset] = React.useState(0);
  const LIMIT = 20;

  const query = trpcAny.invoice.list.useQuery(
    {
      ...(status ? { status } : {}),
      ...(fechaDesde ? { fechaDesde: new Date(fechaDesde).toISOString() } : {}),
      ...(fechaHasta ? { fechaHasta: new Date(fechaHasta + "T23:59:59").toISOString() } : {}),
      limit: LIMIT,
      offset,
    },
    { enabled: Boolean(org) },
  );

  const rows: {
    id: string;
    invoiceNumber: string;
    issuedAt: string;
    status: InvoiceStatus;
    totalAmount: string;
    paidAmount: string;
  }[] = query.data ?? [];

  function handleFilter() {
    setOffset(0);
    query.refetch?.();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Facturas</h1>
          <p className="text-sm text-muted-foreground">
            Gestión de facturación del establecimiento.
          </p>
        </div>
        <Button asChild>
          <Link href="/finance/invoices/nuevo">+ Nueva factura</Link>
        </Button>
      </div>

      {!org && !orgQuery.isLoading ? (
        <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          No hay organización activa. Selecciona una desde el menu superior.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label>Estado</Label>
              <Select
                value={status || "all"}
                onValueChange={(v) => setStatus(v === "all" ? "" : v)}
              >
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Desde</Label>
              <Input
                type="date"
                value={fechaDesde}
                onChange={(e) => setFechaDesde(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="space-y-1">
              <Label>Hasta</Label>
              <Input
                type="date"
                value={fechaHasta}
                onChange={(e) => setFechaHasta(e.target.value)}
                className="w-40"
              />
            </div>
            <Button onClick={handleFilter} variant="outline">
              Buscar
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>No. Factura</TableHead>
              <TableHead>Fecha emisión</TableHead>
              <TableHead className="w-36">Estado</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Pagado</TableHead>
              <TableHead className="w-24 text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                  Cargando…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                  Sin facturas para los filtros seleccionados.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">{row.invoiceNumber}</TableCell>
                  <TableCell className="text-sm">
                    {new Date(row.issuedAt).toLocaleDateString("es-SV")}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[row.status]}>
                      {STATUS_LABELS[row.status] ?? row.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    ${fmt(row.totalAmount)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    ${fmt(row.paidAmount)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/finance/invoices/${row.id}`}>Ver</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {rows.length === LIMIT || offset > 0 ? (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - LIMIT))}
          >
            Anterior
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={rows.length < LIMIT}
            onClick={() => setOffset(offset + LIMIT)}
          >
            Siguiente
          </Button>
        </div>
      ) : null}
    </div>
  );
}
