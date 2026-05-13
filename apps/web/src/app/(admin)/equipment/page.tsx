"use client";

/**
 * §20 Services & Equipment — Listado de equipos biomédicos.
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/react";

type EquipmentStatus =
  | "OPERATIONAL"
  | "UNDER_MAINTENANCE"
  | "OUT_OF_SERVICE"
  | "RETIRED";

const STATUS_OPTIONS: { value: EquipmentStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "Todos" },
  { value: "OPERATIONAL", label: "Operacional" },
  { value: "UNDER_MAINTENANCE", label: "En mantenimiento" },
  { value: "OUT_OF_SERVICE", label: "Fuera de servicio" },
  { value: "RETIRED", label: "Dado de baja" },
];

export default function EquipmentPage() {
  const [status, setStatus] = React.useState<EquipmentStatus | "ALL">("ALL");
  const [search, setSearch] = React.useState("");

  const listInput = React.useMemo(() => {
    const input: Record<string, unknown> = { activeOnly: true };
    if (status !== "ALL") input.status = status;
    if (search.trim()) input.search = search.trim();
    return input;
  }, [status, search]);

  const query = trpc.servicesEquipment.equipment.list.useQuery(listInput);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Equipos biomédicos</h1>
          <p className="text-sm text-muted-foreground">
            Activos fijos biomédicos + PM + calibración (§20).
          </p>
        </div>
        <Button asChild>
          <Link href="/equipment/new">Nuevo equipo</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="filter-status">Estado</Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as EquipmentStatus | "ALL")}
              >
                <SelectTrigger id="filter-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filter-search">Búsqueda</Label>
              <Input
                id="filter-search"
                placeholder="Etiqueta, nombre o serie"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Equipos</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {query.error && (
            <p role="alert" className="text-sm text-destructive">
              {query.error.message}
            </p>
          )}
          {query.data && query.data.length === 0 && (
            <p className="text-sm text-muted-foreground">Sin equipos para los filtros.</p>
          )}
          {query.data && query.data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Etiqueta</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Fabricante</TableHead>
                  <TableHead>Modelo</TableHead>
                  <TableHead>Ubicación</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-mono">{e.assetTag}</TableCell>
                    <TableCell>{e.name}</TableCell>
                    <TableCell>{e.manufacturer ?? "—"}</TableCell>
                    <TableCell>{e.model ?? "—"}</TableCell>
                    <TableCell>{e.location ?? "—"}</TableCell>
                    <TableCell>{e.status}</TableCell>
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
