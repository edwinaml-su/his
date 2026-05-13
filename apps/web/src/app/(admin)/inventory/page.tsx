"use client";

/**
 * §19 Inventory — Listado de items de stock (catálogo + tenant).
 */
import * as React from "react";
import Link from "next/link";
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

export default function InventoryPage() {
  const [search, setSearch] = React.useState("");
  const [category, setCategory] = React.useState("");

  const listInput = React.useMemo(() => {
    const input: Record<string, unknown> = { activeOnly: true };
    if (search.trim()) input.search = search.trim();
    if (category.trim()) input.category = category.trim();
    return input;
  }, [search, category]);

  const query = trpc.inventory.item.list.useQuery(listInput);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Inventario</h1>
          <p className="text-sm text-muted-foreground">
            Items de stock — catálogo global + tenant (§19).
          </p>
        </div>
        <Button asChild>
          <Link href="/inventory/new">Nuevo item</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="filter-search">Búsqueda</Label>
              <Input
                id="filter-search"
                placeholder="SKU o nombre"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filter-category">Categoría</Label>
              <Input
                id="filter-category"
                placeholder="MEDICAMENTO, INSUMO, REACTIVO…"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {query.error && (
            <p role="alert" className="text-sm text-destructive">
              {query.error.message}
            </p>
          )}
          {query.data && query.data.length === 0 && (
            <p className="text-sm text-muted-foreground">Sin items para los filtros.</p>
          )}
          {query.data && query.data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>UM</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead>Lote</TableHead>
                  <TableHead>Alcance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="font-mono">{i.sku}</TableCell>
                    <TableCell>{i.name}</TableCell>
                    <TableCell>{i.unitOfMeasure}</TableCell>
                    <TableCell>{i.category ?? "—"}</TableCell>
                    <TableCell>{i.trackLots ? "Sí" : "No"}</TableCell>
                    <TableCell>
                      {i.organizationId === null ? "Global" : "Tenant"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
