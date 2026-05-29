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
import { Button } from "@his/ui/components/button";
import { Label } from "@his/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { DataCardList, type DataCardColumn } from "@his/ui/components/data-card-list";
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

const COLUMNS: DataCardColumn<IndicacionListRow>[] = [
  {
    id: "medico",
    header: "Médico prescriptor",
    primary: true,
    cell: (row) => (
      <span className="font-mono text-xs">{row.medico_prescriptor.slice(0, 8)}…</span>
    ),
  },
  {
    id: "estado",
    header: "Estado",
    cell: (row) => (
      <IndicacionEstadoBadge
        estadoRegistro={row.estado_registro as "borrador" | "firmado" | "validado"}
      />
    ),
  },
  {
    id: "vigencia",
    header: "Vigencia",
    cell: (row) => (
      <IndicacionEstadoBadge
        estadoRegistro={row.estado_registro as "borrador" | "firmado" | "validado"}
        vigencia={row.vigencia as Vigencia}
      />
    ),
  },
  {
    id: "fecha",
    header: "Fecha registro",
    hideOnMobile: true,
    cell: (row) => (
      <span className="tabular-nums text-sm">
        {new Date(row.registrado_en).toLocaleString("es-SV")}
      </span>
    ),
  },
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Indicaciones Médicas</h1>
          <p className="text-sm text-muted-foreground">
            Órdenes CPOE del episodio con trazabilidad de firma MC y
            administración de enfermería (NTEC Doc 6).
          </p>
        </div>
        <Button asChild className="w-full sm:w-auto">
          {/* Propagar episodioId al form para auto-llenarlo (fix UUID-en-blanco). */}
          <Link
            href={
              validUuid
                ? `/ece/indicaciones/nueva?episodioId=${episodioId.trim()}`
                : "/ece/indicaciones/nueva"
            }
          >
            Nueva indicación
          </Link>
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
          ) : (
            <DataCardList
              data={items as IndicacionListRow[]}
              getKey={(row) => row.id}
              columns={COLUMNS}
              actions={(row) => (
                <Button asChild size="sm" variant="outline" className="w-full sm:w-auto">
                  <Link href={`/ece/indicaciones/${row.id}`}>Ver</Link>
                </Button>
              )}
              emptyMessage="No hay indicaciones con estos filtros."
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
