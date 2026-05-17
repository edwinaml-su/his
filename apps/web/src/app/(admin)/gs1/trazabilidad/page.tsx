"use client";

/**
 * GS1 Logística — Trazabilidad EPCIS.
 *
 * Nota sobre schema: ece.epcis_event tiene schema legacy (movimientos de equipo).
 * No hay GTIN/lote/GSRN de paciente. Las búsquedas disponibles son:
 *   - Por GLN (ubicación): busca en gln_destino y gln_origen
 *   - Por Equipo (UUID): historia completa del activo
 *   - Origen→Destino: trazabilidad entre dos GLN
 *
 * @QA — E2E targets: buscar por GLN válido devuelve timeline; sin resultados muestra estado vacío.
 */
import * as React from "react";
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

type SearchMode = "gln" | "equipment" | "origin";

const SEARCH_MODES: { value: SearchMode; label: string }[] = [
  { value: "gln", label: "Por GLN (ubicación)" },
  { value: "equipment", label: "Por Equipo (UUID)" },
  { value: "origin", label: "Origen → Destino" },
];

interface EventRow {
  id: string;
  equipment_id: string;
  gln_destino: string;
  gln_origen: string | null;
  registrado_por: string | null;
  registrado_en: Date | string;
  notas: string | null;
}

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleString("es-SV", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export default function TrazabilidadPage() {
  const [mode, setMode] = React.useState<SearchMode>("gln");
  const [gln, setGln] = React.useState("");
  const [equipmentId, setEquipmentId] = React.useState("");
  const [glnOrigen, setGlnOrigen] = React.useState("");
  const [glnDestino, setGlnDestino] = React.useState("");
  const [fechaDesde, setFechaDesde] = React.useState("");
  const [fechaHasta, setFechaHasta] = React.useState("");

  // Un único estado "submitted" para disparar queries on-demand (no auto-fetch).
  const [submitted, setSubmitted] = React.useState(false);

  const commonDateRange = {
    fechaDesde: fechaDesde ? new Date(fechaDesde) : undefined,
    fechaHasta: fechaHasta ? new Date(fechaHasta) : undefined,
  };

  const glnQuery = trpc.epcisQuery.queryByGln.useQuery(
    { gln, ...commonDateRange },
    {
      enabled: submitted && mode === "gln" && gln.trim().length > 0,
      retry: false,
    },
  );

  const equipmentQuery = trpc.epcisQuery.queryByEquipment.useQuery(
    { equipmentId, ...commonDateRange },
    {
      enabled:
        submitted &&
        mode === "equipment" &&
        /^[0-9a-f-]{36}$/i.test(equipmentId),
      retry: false,
    },
  );

  const originQuery = trpc.epcisQuery.queryByOrigin.useQuery(
    {
      glnOrigen: glnOrigen || undefined,
      glnDestino: glnDestino || undefined,
      ...commonDateRange,
    },
    {
      enabled:
        submitted &&
        mode === "origin" &&
        (glnOrigen.trim().length > 0 || glnDestino.trim().length > 0),
      retry: false,
    },
  );

  const activeQuery =
    mode === "gln" ? glnQuery : mode === "equipment" ? equipmentQuery : originQuery;

  const rows: EventRow[] = (activeQuery.data ?? []) as EventRow[];

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
  }

  function handleReset() {
    setSubmitted(false);
    setGln("");
    setEquipmentId("");
    setGlnOrigen("");
    setGlnDestino("");
    setFechaDesde("");
    setFechaHasta("");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Trazabilidad GS1</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Consulta eventos EPCIS de movimientos de equipos entre ubicaciones GLN.
        </p>
      </div>

      {/* Formulario de búsqueda */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Parámetros de búsqueda</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {/* Modo */}
              <div className="space-y-1.5">
                <Label htmlFor="mode">Tipo de búsqueda</Label>
                <Select
                  value={mode}
                  onValueChange={(v) => {
                    setMode(v as SearchMode);
                    setSubmitted(false);
                  }}
                >
                  <SelectTrigger id="mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SEARCH_MODES.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Inputs condicionales por modo */}
              {mode === "gln" && (
                <div className="space-y-1.5">
                  <Label htmlFor="gln">GLN (ubicación)</Label>
                  <Input
                    id="gln"
                    value={gln}
                    onChange={(e) => setGln(e.target.value)}
                    placeholder="ej. 7891234567890"
                    maxLength={13}
                  />
                </div>
              )}

              {mode === "equipment" && (
                <div className="space-y-1.5 lg:col-span-2">
                  <Label htmlFor="equipmentId">UUID del equipo</Label>
                  <Input
                    id="equipmentId"
                    value={equipmentId}
                    onChange={(e) => setEquipmentId(e.target.value)}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    className="font-mono text-sm"
                  />
                </div>
              )}

              {mode === "origin" && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="glnOrigen">GLN origen</Label>
                    <Input
                      id="glnOrigen"
                      value={glnOrigen}
                      onChange={(e) => setGlnOrigen(e.target.value)}
                      placeholder="GLN origen"
                      maxLength={13}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="glnDestino">GLN destino</Label>
                    <Input
                      id="glnDestino"
                      value={glnDestino}
                      onChange={(e) => setGlnDestino(e.target.value)}
                      placeholder="GLN destino"
                      maxLength={13}
                    />
                  </div>
                </>
              )}

              {/* Rango de fechas */}
              <div className="space-y-1.5">
                <Label htmlFor="fechaDesde">Desde</Label>
                <Input
                  id="fechaDesde"
                  type="datetime-local"
                  value={fechaDesde}
                  onChange={(e) => setFechaDesde(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fechaHasta">Hasta</Label>
                <Input
                  id="fechaHasta"
                  type="datetime-local"
                  value={fechaHasta}
                  onChange={(e) => setFechaHasta(e.target.value)}
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button type="submit" disabled={activeQuery.isFetching}>
                {activeQuery.isFetching ? "Buscando…" : "Buscar"}
              </Button>
              <Button type="button" variant="outline" onClick={handleReset}>
                Limpiar
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Resultados */}
      {submitted && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Eventos encontrados
              {rows.length > 0 && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({rows.length})
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activeQuery.isError && (
              <p className="text-sm text-destructive">
                Error al consultar: {activeQuery.error.message}
              </p>
            )}

            {activeQuery.isFetching && (
              <p className="text-sm text-muted-foreground">Cargando…</p>
            )}

            {!activeQuery.isFetching && !activeQuery.isError && rows.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No se encontraron eventos con los parámetros indicados.
              </p>
            )}

            {rows.length > 0 && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha registro</TableHead>
                      <TableHead>Equipo (UUID)</TableHead>
                      <TableHead>GLN origen</TableHead>
                      <TableHead>GLN destino</TableHead>
                      <TableHead>Notas</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="whitespace-nowrap text-sm">
                          {formatDate(row.registrado_en)}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {row.equipment_id}
                        </TableCell>
                        <TableCell className="text-sm">
                          {row.gln_origen ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm">{row.gln_destino}</TableCell>
                        <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                          {row.notas ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
