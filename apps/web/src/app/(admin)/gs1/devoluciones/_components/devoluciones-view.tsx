"use client";

/**
 * DevolucionesView — vista split de devoluciones GS1 (Proceso F).
 *
 * Pestañas:
 *   1. Solicitadas         (estado = 'solicitado')
 *   2. Pendiente recepción (estado = 'autorizado' | 'en_transito')
 *   3. Históricas          (estado = 'recibido'   | 'rechazado')
 *
 * Cada pestaña muestra su propia tabla con los campos relevantes.
 * Las acciones de autorizar / recepcionar se realizan desde la tabla.
 */
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
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
import type { EstadoDevolucion } from "@his/contracts";

// ---------------------------------------------------------------------------
// Helpers de presentación
// ---------------------------------------------------------------------------

const BADGE_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  solicitado: "secondary",
  autorizado: "default",
  en_transito: "outline",
  recibido: "default",
  rechazado: "destructive",
};

const MOTIVO_LABEL: Record<string, string> = {
  vencido: "Vencido",
  defectuoso: "Defectuoso",
  recall: "Recall",
  exceso: "Exceso",
  no_administrado: "No administrado",
};

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("es-SV", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Tabla genérica
// ---------------------------------------------------------------------------

type Row = {
  id: string;
  origen_gln: string;
  destino_gln: string;
  motivo: string;
  productos: unknown;
  fecha_devolucion: string;
  autorizado_por: string | null;
  estado: string;
  notas: string | null;
  created_at: string;
};

function DevolucionesTable({
  rows,
  isLoading,
  error,
  onAutorizar,
  onRecepcionar,
  showActions,
}: {
  rows: Row[];
  isLoading: boolean;
  error: string | null;
  onAutorizar?: (id: string) => void;
  onRecepcionar?: (id: string, conforme: boolean) => void;
  showActions?: "autorizar" | "recepcionar";
}) {
  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando…</p>;
  }
  if (error) {
    return <p role="alert" className="text-sm text-destructive">{error}</p>;
  }
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin registros.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Origen GLN</TableHead>
          <TableHead>Destino GLN</TableHead>
          <TableHead>Motivo</TableHead>
          <TableHead>Productos</TableHead>
          <TableHead>Fecha</TableHead>
          <TableHead>Estado</TableHead>
          {showActions && <TableHead>Acciones</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const productosArr = Array.isArray(row.productos) ? row.productos : [];
          return (
            <TableRow key={row.id}>
              <TableCell className="font-mono text-xs">{row.origen_gln}</TableCell>
              <TableCell className="font-mono text-xs">{row.destino_gln}</TableCell>
              <TableCell>{MOTIVO_LABEL[row.motivo] ?? row.motivo}</TableCell>
              <TableCell>{productosArr.length} ítem(s)</TableCell>
              <TableCell className="text-xs">{formatDate(row.fecha_devolucion)}</TableCell>
              <TableCell>
                <Badge variant={BADGE_VARIANT[row.estado] ?? "outline"}>
                  {row.estado}
                </Badge>
              </TableCell>
              {showActions === "autorizar" && (
                <TableCell>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => onAutorizar?.(row.id)}
                  >
                    Autorizar
                  </Button>
                </TableCell>
              )}
              {showActions === "recepcionar" && (
                <TableCell>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => onRecepcionar?.(row.id, true)}
                    >
                      Recibido
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => onRecepcionar?.(row.id, false)}
                    >
                      Rechazar
                    </Button>
                  </div>
                </TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

// ---------------------------------------------------------------------------
// Tabs wrapper
// ---------------------------------------------------------------------------

type Tab = "solicitadas" | "pendiente" | "historicas";

const ESTADO_POR_TAB: Record<Tab, EstadoDevolucion | undefined> = {
  solicitadas: "solicitado",
  pendiente: "autorizado",
  historicas: "recibido",
};

export function DevolucionesView() {
  const [activeTab, setActiveTab] = React.useState<Tab>("solicitadas");

  const estadoQuery = ESTADO_POR_TAB[activeTab];

  const query = trpc.gs1ProcesoF.listSolicitudesPendientes.useQuery({
    estado: estadoQuery,
    limit: 50,
  });

  const utils = trpc.useUtils();

  const autorizar = trpc.gs1ProcesoF.autorizarDevolucion.useMutation({
    onSuccess: () => utils.gs1ProcesoF.listSolicitudesPendientes.invalidate(),
  });

  const recepcionar = trpc.gs1ProcesoF.registrarRecepcionDevolucion.useMutation({
    onSuccess: () => utils.gs1ProcesoF.listSolicitudesPendientes.invalidate(),
  });

  const handleAutorizar = (id: string) => {
    autorizar.mutate({ devolucionId: id });
  };

  const handleRecepcionar = (id: string, conforme: boolean) => {
    recepcionar.mutate({ devolucionId: id, recibidoConforme: conforme });
  };

  const rows = (query.data?.items ?? []) as Row[];
  const errorMsg = query.error?.message ?? null;

  const TAB_LABELS: Record<Tab, string> = {
    solicitadas: "Solicitadas",
    pendiente: "Pendiente recepción",
    historicas: "Históricas",
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Devoluciones GS1</h1>
        <p className="text-sm text-muted-foreground">
          Proceso F — Logística inversa de inventario.
        </p>
      </div>

      {/* Pestañas */}
      <div className="flex gap-1 border-b">
        {(["solicitadas", "pendiente", "historicas"] as Tab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={[
              "px-4 py-2 text-sm font-medium transition-colors",
              activeTab === tab
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{TAB_LABELS[activeTab]}</CardTitle>
        </CardHeader>
        <CardContent>
          <DevolucionesTable
            rows={rows}
            isLoading={query.isLoading}
            error={errorMsg}
            showActions={
              activeTab === "solicitadas"
                ? "autorizar"
                : activeTab === "pendiente"
                  ? "recepcionar"
                  : undefined
            }
            onAutorizar={handleAutorizar}
            onRecepcionar={handleRecepcionar}
          />
        </CardContent>
      </Card>
    </div>
  );
}
