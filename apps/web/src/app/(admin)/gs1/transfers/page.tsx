"use client";

/**
 * GS1 Logística — Lista de Transferencias (Proceso B).
 *
 * Muestra pendientes y en_transito. Botón para crear nueva.
 */

import * as React from "react";
import Link from "next/link";
import { Truck, Plus, PackageSearch } from "lucide-react";
import { Button } from "@his/ui/components/button";
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
import { Badge } from "@his/ui/components/badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@his/ui/components/tabs";
import { trpc } from "@/lib/trpc/react";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

type TransferenciaRow = {
  id: string;
  origen_gln: string;
  destino_gln: string;
  sscc_pallet: string | null;
  productos: unknown;
  fecha_envio: Date | null;
  fecha_recepcion: Date | null;
  estado: string;
  registrado_por: string;
  verificado_por: string | null;
  motivo_rechazo: string | null;
  created_at: Date;
  updated_at: Date;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function estadoBadge(estado: string) {
  const map: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    programado:  "outline",
    en_transito: "secondary",
    recibido:    "default",
    rechazado:   "destructive",
  };
  return (
    <Badge variant={map[estado] ?? "outline"}>
      {estado.replace("_", " ")}
    </Badge>
  );
}

function cantidadProductos(productos: unknown): number {
  if (!Array.isArray(productos)) return 0;
  return productos.reduce((sum: number, p: unknown) => {
    if (p && typeof p === "object" && "cantidad" in p) {
      return sum + Number((p as { cantidad: number }).cantidad ?? 0);
    }
    return sum;
  }, 0);
}

function fmtDate(d: Date | null | string): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-SV", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

// ---------------------------------------------------------------------------
// Componente de tabla compartida
// ---------------------------------------------------------------------------

function TransferenciaTable({
  rows,
  isLoading,
  mostrarDestino,
}: {
  rows: TransferenciaRow[];
  isLoading: boolean;
  mostrarDestino?: boolean;
}) {
  return (
    <div
      role="region"
      aria-label="Lista de transferencias"
      className="overflow-x-auto"
    >
      <Table aria-describedby="transfers-table-desc">
        <caption id="transfers-table-desc" className="sr-only">
          Transferencias de inventario GS1 entre depósitos.
        </caption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Origen GLN</TableHead>
            <TableHead scope="col">Destino GLN</TableHead>
            {mostrarDestino && <TableHead scope="col">SSCC Pallet</TableHead>}
            <TableHead scope="col">Unidades</TableHead>
            <TableHead scope="col">Fecha envío</TableHead>
            <TableHead scope="col">Estado</TableHead>
            <TableHead scope="col">
              <span className="sr-only">Acciones</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                <span aria-live="polite">Cargando transferencias...</span>
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="py-10 text-center">
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <PackageSearch className="h-8 w-8" aria-hidden="true" />
                  <p className="text-sm">Sin transferencias en este estado.</p>
                </div>
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-mono text-xs">{row.origen_gln}</TableCell>
                <TableCell className="font-mono text-xs">{row.destino_gln}</TableCell>
                {mostrarDestino && (
                  <TableCell className="font-mono text-xs">
                    {row.sscc_pallet ?? "—"}
                  </TableCell>
                )}
                <TableCell className="tabular-nums">
                  {cantidadProductos(row.productos)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs">
                  {fmtDate(row.fecha_envio)}
                </TableCell>
                <TableCell>{estadoBadge(row.estado)}</TableCell>
                <TableCell>
                  <Button asChild variant="outline" size="sm">
                    <Link
                      href={`/gs1/transfers/${row.id}`}
                      aria-label={`Ver detalle de transferencia ${row.id.slice(0, 8)}`}
                    >
                      Ver
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Gs1TransfersPage() {
  const pendientes = trpc.gs1ProcesoB.listPendientes.useQuery({});
  const enTransito = trpc.gs1ProcesoB.listEnTransito.useQuery({});

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Truck className="h-6 w-6 text-primary" aria-hidden="true" />
          <div>
            <h1 className="text-2xl font-bold">Transfers GS1</h1>
            <p className="text-sm text-muted-foreground">
              Transferencias de inventario entre depósitos (Proceso B).
            </p>
          </div>
        </div>
        <Button asChild>
          <Link href="/gs1/transfers/nueva">
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            Nueva transferencia
          </Link>
        </Button>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Pendientes</p>
            <p className="text-2xl font-bold tabular-nums" aria-live="polite">
              {pendientes.isLoading ? "…" : (pendientes.data?.length ?? 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">En tránsito</p>
            <p className="text-2xl font-bold tabular-nums text-amber-600" aria-live="polite">
              {enTransito.isLoading ? "…" : (enTransito.data?.length ?? 0)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="en_transito">
        <TabsList aria-label="Filtro por estado de transferencia">
          <TabsTrigger value="en_transito">En tránsito</TabsTrigger>
          <TabsTrigger value="pendientes">Programadas</TabsTrigger>
        </TabsList>

        <TabsContent value="en_transito">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">En tránsito</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <TransferenciaTable
                rows={(enTransito.data ?? []) as TransferenciaRow[]}
                isLoading={enTransito.isLoading}
                mostrarDestino
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pendientes">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Programadas (por enviar)</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <TransferenciaTable
                rows={(pendientes.data ?? []) as TransferenciaRow[]}
                isLoading={pendientes.isLoading}
                mostrarDestino={false}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
