"use client";

import * as React from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Input }  from "@his/ui/components/input";
import { Label }  from "@his/ui/components/label";
import { Button } from "@his/ui/components/button";
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
import { Badge } from "@his/ui/components/badge";
import { trpc } from "@/lib/trpc/react";

// ---------------------------------------------------------------------------
// Tipos locales
// ---------------------------------------------------------------------------

type Filters = {
  pacienteId: string;
  personalId: string;
  desde: string;
  hasta: string;
  accion: string;
};

const ACCIONES = [
  "verify", "confirm", "view", "create",
  "update", "delete", "export", "print", "share",
] as const;

const PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildInput(f: Filters, offset: number) {
  return {
    pacienteId: f.pacienteId || undefined,
    personalId: f.personalId || undefined,
    desde:      f.desde     ? new Date(f.desde).toISOString()  : undefined,
    hasta:      f.hasta     ? new Date(f.hasta).toISOString()  : undefined,
    accion:     (f.accion && f.accion !== "_all"
                  ? f.accion as typeof ACCIONES[number]
                  : undefined),
    limit: PAGE_SIZE,
    offset,
  };
}

function downloadCsv(base64: string, rowCount: number) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `bitacora_ece_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function BitacoraEcePage() {
  const [filters, setFilters]       = React.useState<Filters>({
    pacienteId: "", personalId: "", desde: "", hasta: "", accion: "_all",
  });
  const [committed, setCommitted]   = React.useState<Filters>(filters);
  const [offset, setOffset]         = React.useState(0);
  const [exporting, setExporting]   = React.useState(false);

  const queryInput = buildInput(committed, offset);

  const { data, isLoading, isFetching } = trpc.bitacora.list.useQuery(
    queryInput,
    { keepPreviousData: true },
  );

  const exportCsvMutation = trpc.bitacora.exportCsv.useQuery(
    {
      pacienteId: committed.pacienteId || undefined,
      personalId: committed.personalId || undefined,
      desde:      committed.desde ? new Date(committed.desde).toISOString() : undefined,
      hasta:      committed.hasta ? new Date(committed.hasta).toISOString() : undefined,
      accion:     (committed.accion && committed.accion !== "_all"
                    ? committed.accion as typeof ACCIONES[number]
                    : undefined),
    },
    { enabled: exporting },
  );

  // Disparar descarga cuando llega la data de exportación.
  React.useEffect(() => {
    if (exporting && exportCsvMutation.data) {
      downloadCsv(exportCsvMutation.data.base64, exportCsvMutation.data.rowCount);
      setExporting(false);
    }
  }, [exporting, exportCsvMutation.data]);

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setCommitted(filters);
    setOffset(0);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Bitácora ECE</h1>
        <p className="text-sm text-muted-foreground">
          Registro de accesos al expediente clínico. NTEC Arts. 45-52.
        </p>
      </div>

      {/* Filtros */}
      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={handleSearch}
          >
            <div className="space-y-1.5">
              <Label htmlFor="pacienteId">ID Paciente (UUID)</Label>
              <Input
                id="pacienteId"
                placeholder="xxxxxxxx-..."
                className="w-64"
                value={filters.pacienteId}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, pacienteId: e.target.value }))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="personalId">ID Personal (UUID)</Label>
              <Input
                id="personalId"
                placeholder="xxxxxxxx-..."
                className="w-64"
                value={filters.personalId}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, personalId: e.target.value }))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="desde">Desde</Label>
              <Input
                id="desde"
                type="date"
                value={filters.desde}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, desde: e.target.value }))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="hasta">Hasta</Label>
              <Input
                id="hasta"
                type="date"
                value={filters.hasta}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, hasta: e.target.value }))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="accion">Acción</Label>
              <Select
                value={filters.accion}
                onValueChange={(v) => setFilters((f) => ({ ...f, accion: v }))}
              >
                <SelectTrigger id="accion" className="w-36">
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todas</SelectItem>
                  {ACCIONES.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2">
              <Button type="submit" disabled={isLoading}>
                Buscar
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={exporting || exportCsvMutation.isFetching}
                onClick={() => setExporting(true)}
              >
                {exporting && exportCsvMutation.isFetching
                  ? "Generando..."
                  : "Exportar CSV"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Tabla */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha/hora</TableHead>
                <TableHead>User ID</TableHead>
                <TableHead>Paciente ID</TableHead>
                <TableHead>Acción</TableHead>
                <TableHead>Resultado</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>Contexto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading || isFetching ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    Cargando...
                  </TableCell>
                </TableRow>
              ) : data?.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    Sin registros para los filtros seleccionados.
                  </TableCell>
                </TableRow>
              ) : (
                data?.items.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap text-xs">
                      {new Date(row.registradoEn).toLocaleString("es-SV")}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.userId.slice(0, 8)}…
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.pacienteId ? `${row.pacienteId.slice(0, 8)}…` : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{row.accion}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.exito ? "default" : "destructive"}>
                        {row.exito ? "OK" : "FALLO"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{row.ip ?? "—"}</TableCell>
                    <TableCell className="max-w-xs truncate text-xs">
                      {row.contexto ?? "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Paginación */}
      {data && data.total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {data.total} registros — página {currentPage} de {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={offset === 0}
              onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={offset + PAGE_SIZE >= data.total}
              onClick={() => setOffset((o) => o + PAGE_SIZE)}
            >
              Siguiente
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
