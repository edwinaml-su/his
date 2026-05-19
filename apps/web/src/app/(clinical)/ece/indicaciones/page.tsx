"use client";

/**
 * ECE — Indicaciones Médicas: lista paginada del episodio.
 *
 * Filtros: vigencia (ACTIVA | SUSPENDIDA | CANCELADA).
 * Usa trpc.eceIndicaciones.list (IND_MED, Sprint S2).
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
import {
  IndicacionEstadoBadge,
  type Vigencia,
} from "./_components/indicacion-estado-badge";

interface IndicacionListRow {
  id: string;
  medico_prescriptor: string;
  registrado_en: string | Date;
  estado_registro: string;
  vigencia: string;
}

const VIGENCIAS: Array<{ value: Vigencia | "TODAS"; label: string }> = [
  { value: "TODAS", label: "Todas" },
  { value: "ACTIVA", label: "Activa" },
  { value: "SUSPENDIDA", label: "Suspendida" },
  { value: "CANCELADA", label: "Cancelada" },
];

export default function IndicacionesListPage(): React.ReactElement {
  const [episodioId, setEpisodioId] = React.useState("");
  const [vigencia, setVigencia] = React.useState<Vigencia | "TODAS">("TODAS");

  const validUuid = /^[0-9a-f-]{36}$/i.test(episodioId.trim());

  const list = trpc.eceIndicaciones.list.useQuery(
    {
      episodioId: episodioId.trim(),
      vigencia: vigencia === "TODAS" ? undefined : vigencia,
      limit: 50,
    },
    { enabled: validUuid },
  );

  const items = list.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Indicaciones Médicas</h1>
          <p className="text-sm text-muted-foreground">
            Órdenes CPOE del episodio con trazabilidad de firma MC y
            administración de enfermería (NTEC Doc 6).
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
                placeholder="UUID del episodio activo"
                value={episodioId}
                onChange={(e) => setEpisodioId(e.target.value)}
                data-testid="input-episodio-id"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="filter-vigencia">Vigencia</Label>
              <Select
                value={vigencia}
                onValueChange={(v) => setVigencia(v as Vigencia | "TODAS")}
              >
                <SelectTrigger id="filter-vigencia">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VIGENCIAS.map((v) => (
                    <SelectItem key={v.value} value={v.value}>
                      {v.label}
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
          {!validUuid ? (
            <p className="text-sm text-muted-foreground">
              Ingrese el UUID del episodio para ver las indicaciones.
            </p>
          ) : list.isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay indicaciones con estos filtros.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Médico prescriptor</TableHead>
                  <TableHead>Fecha registro</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Vigencia</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(items as IndicacionListRow[]).map((ind) => (
                  <TableRow key={ind.id}>
                    <TableCell className="font-mono text-xs">
                      {ind.medico_prescriptor.slice(0, 8)}…
                    </TableCell>
                    <TableCell className="tabular-nums text-sm">
                      {new Date(ind.registrado_en).toLocaleString("es-SV")}
                    </TableCell>
                    <TableCell>
                      <IndicacionEstadoBadge
                        estadoRegistro={
                          ind.estado_registro as "borrador" | "firmado" | "validado"
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <IndicacionEstadoBadge
                        estadoRegistro={
                          ind.estado_registro as "borrador" | "firmado" | "validado"
                        }
                        vigencia={ind.vigencia as Vigencia}
                      />
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
