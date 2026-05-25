"use client";

/**
 * /finance/price-lists — Lista de tarifarios de servicios.
 * Wave 11 — Sprint UI Finance.
 */
import * as React from "react";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { trpc } from "@/lib/trpc/react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trpcAny = trpc as any;

type PriceListRow = {
  id: string;
  name: string;
  currencyId: string;
  validFrom: string;
  validTo: string | null;
  active: boolean;
  notes: string | null;
  itemCount: number;
};

function fmt(d: string | Date) {
  return new Date(d).toLocaleDateString("es-SV");
}

export default function PriceListsPage() {
  const [activeFilter, setActiveFilter] = React.useState("activos");

  const query = trpcAny.servicePriceList.list.useQuery(
    activeFilter === "activos"
      ? { active: true }
      : activeFilter === "inactivos"
        ? { active: false }
        : undefined,
  );

  const setListActive = trpcAny.servicePriceList.setListActive.useMutation({
    onSuccess: () => query.refetch(),
  });

  const rows = (query.data ?? []) as PriceListRow[];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <BookOpen className="h-6 w-6" />
            Tarifario de Servicios
          </h1>
          <p className="text-sm text-muted-foreground">
            Catálogo de precios de servicios clínicos. Los items activos se usan en el autocomplete
            de facturación.
          </p>
        </div>
        <Button asChild>
          <Link href="/finance/price-lists/nuevo">+ Nuevo tarifario</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Tarifarios</CardTitle>
            <div className="flex items-center gap-2">
              <Select value={activeFilter} onValueChange={setActiveFilter}>
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="activos">Solo activos</SelectItem>
                  <SelectItem value="inactivos">Solo inactivos</SelectItem>
                  <SelectItem value="todos">Todos</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">
                {query.isLoading ? "Cargando…" : `${rows.length} tarifario(s)`}
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {query.error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {(query.error as { message?: string })?.message ?? "Error al cargar tarifarios."}
            </p>
          ) : null}

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead className="w-28">Vigencia desde</TableHead>
                  <TableHead className="w-28">Vigencia hasta</TableHead>
                  <TableHead className="w-20 text-right">Items</TableHead>
                  <TableHead className="w-24">Estado</TableHead>
                  <TableHead className="w-40 text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && !query.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                      Sin tarifarios para los filtros seleccionados.
                    </TableCell>
                  </TableRow>
                ) : null}
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link
                        href={`/finance/price-lists/${row.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {row.name}
                      </Link>
                      {row.notes ? (
                        <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
                          {row.notes}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-sm">{fmt(row.validFrom)}</TableCell>
                    <TableCell className="text-sm">
                      {row.validTo ? fmt(row.validTo) : <span className="text-muted-foreground">Indefinido</span>}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {row.itemCount}
                    </TableCell>
                    <TableCell>
                      {row.active ? (
                        <Badge variant="success">Activo</Badge>
                      ) : (
                        <Badge variant="outline">Inactivo</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-2">
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/finance/price-lists/${row.id}`}>Ver</Link>
                        </Button>
                        {row.active ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={setListActive.isPending}
                            onClick={() => setListActive.mutate({ id: row.id, active: false })}
                          >
                            Desactivar
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={setListActive.isPending}
                            onClick={() => setListActive.mutate({ id: row.id, active: true })}
                          >
                            Activar
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
