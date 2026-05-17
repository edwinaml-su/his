"use client";

/**
 * ECE — Indicaciones Médicas (TDR §ECE).
 *
 * Lista paginada de indicaciones del episodio activo.
 * Filtros: estado del workflow (BORRADOR | FIRMADA_MC | VALIDADA_ENF | ANULADA).
 * La query usa `trpc.eceIndicaciones.list` (router pendiente de merge).
 *
 * Mientras el AppRouter no exponga `eceIndicaciones`, se castea con
 * eslint-disable siguiendo el patrón de /pharmacy.
 */
import * as React from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { Button } from "@his/ui/components/button";
import { Label } from "@his/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/react";
import { IndicacionEstadoBadge, type IndicacionEstado } from "./_components/indicacion-estado-badge";

const ESTADOS: Array<{ value: IndicacionEstado | "TODOS"; label: string }> = [
  { value: "TODOS", label: "Todos" },
  { value: "BORRADOR", label: "Borrador" },
  { value: "FIRMADA_MC", label: "Firmada MC" },
  { value: "VALIDADA_ENF", label: "Validada Enfermería" },
  { value: "ANULADA", label: "Anulada" },
];

interface IndicacionListItem {
  id: string;
  creadoEn: string | Date;
  estado: IndicacionEstado;
  observaciones?: string | null;
  episodioId: string;
  medico: { id: string; firstName: string; lastName: string };
  _count: { items: number };
}

export default function IndicacionesListPage(): React.ReactElement {
  const [episodioId, setEpisodioId] = React.useState("");
  const [estado, setEstado] = React.useState<IndicacionEstado | "TODOS">("TODOS");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trpcAny = trpc as any;
  const list = trpcAny.eceIndicaciones?.list?.useQuery({
    episodioId: episodioId.trim() || undefined,
    estado: estado === "TODOS" ? undefined : estado,
  }) ?? { data: undefined, isLoading: false };

  const items = (list.data?.items ?? list.data ?? []) as IndicacionListItem[];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Indicaciones Médicas</h1>
          <p className="text-sm text-muted-foreground">
            Indicaciones del episodio activo con trazabilidad de firma MC y
            validación de enfermería (TDR §ECE).
          </p>
        </div>
        <Button asChild>
          <Link href="/ece/indicaciones/nueva">Nueva indicación</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="filter-episodio">Episodio</Label>
              <input
                id="filter-episodio"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="episodioId"
                value={episodioId}
                onChange={(e) => setEpisodioId(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="filter-estado">Estado</Label>
              <Select
                value={estado}
                onValueChange={(v) =>
                  setEstado(v as IndicacionEstado | "TODOS")
                }
              >
                <SelectTrigger id="filter-estado">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ESTADOS.map((e) => (
                    <SelectItem key={e.value} value={e.value}>
                      {e.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Indicaciones</CardTitle>
        </CardHeader>
        <CardContent>
          {list.isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay indicaciones con estos filtros.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Médico</TableHead>
                  <TableHead>Episodio</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right"># ítems</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((ind) => (
                  <TableRow key={ind.id}>
                    <TableCell>
                      {ind.medico.firstName} {ind.medico.lastName}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {ind.episodioId.slice(0, 8)}…
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {new Date(ind.creadoEn).toLocaleString("es-SV")}
                    </TableCell>
                    <TableCell>
                      <IndicacionEstadoBadge estado={ind.estado} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {ind._count.items}
                    </TableCell>
                    <TableCell>
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/ece/indicaciones/${ind.id}`}>Ver</Link>
                      </Button>
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
