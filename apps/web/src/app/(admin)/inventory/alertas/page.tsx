"use client";

/**
 * Inventory GS1 — Alertas de stock y caducidad (SQL 83).
 *
 * Lista alertas activas: stock_bajo | stock_critico | proximo_vencer | vencido.
 * Bulk actions: Generar orden de compra | Marcar resuelto (dismissal local).
 *
 * Accesible desde /inventory (sub-link "Alertas") y desde notificaciones.
 */
import * as React from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/react";
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
import { Badge } from "@his/ui/components/badge";
import { Checkbox } from "@his/ui/components/checkbox";
import type { AlertaTipo } from "@his/contracts";

// Variantes de badge por tipo de alerta
const BADGE_VARIANT: Record<AlertaTipo, "destructive" | "default" | "secondary" | "outline"> = {
  vencido: "destructive",
  stock_critico: "destructive",
  proximo_vencer: "default",
  stock_bajo: "secondary",
};

const BADGE_LABEL: Record<AlertaTipo, string> = {
  vencido: "Vencido",
  stock_critico: "Stock crítico",
  proximo_vencer: "Próximo a vencer",
  stock_bajo: "Stock bajo",
};

type AlertaItem = {
  tipo: AlertaTipo;
  gtinId: string;
  gtinCodigo: string;
  gtinDescripcion: string;
  ubicacionGln: string;
  glnDescripcion: string;
  stockActual: number;
  stockMinimo: number;
  stockCritico: number;
  reorderPoint: number;
  loteId?: string;
  loteNumero?: string;
  expiryDate?: Date;
  diasRestantes?: number;
};

function alertaKey(a: AlertaItem): string {
  return `${a.tipo}::${a.gtinId}::${a.ubicacionGln}::${a.loteId ?? ""}`;
}

export default function InventoryAlertasPage() {
  const [seleccionados, setSeleccionados] = React.useState<Set<string>>(new Set());
  const [resueltos, setResueltos] = React.useState<Set<string>>(new Set());

  const query = trpc.inventory.gs1.listAlertas.useQuery({ limit: 200 });

  const alertas: AlertaItem[] = React.useMemo(() => {
    if (!query.data) return [];
    return (query.data as AlertaItem[]).filter((a) => !resueltos.has(alertaKey(a)));
  }, [query.data, resueltos]);

  // Selección
  const toggleSeleccion = (key: string) => {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleTodos = () => {
    if (seleccionados.size === alertas.length) {
      setSeleccionados(new Set());
    } else {
      setSeleccionados(new Set(alertas.map(alertaKey)));
    }
  };

  // Bulk: marcar resuelto (dismissal local — en producción emitiría a outbox)
  const marcarResuelto = () => {
    setResueltos((prev) => {
      const next = new Set(prev);
      seleccionados.forEach((k) => next.add(k));
      return next;
    });
    setSeleccionados(new Set());
  };

  // Bulk: generar orden de compra (placeholder — abre modal o redirige)
  const generarOrden = () => {
    const gtins = alertas
      .filter((a) => seleccionados.has(alertaKey(a)))
      .map((a) => a.gtinCodigo)
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .join(", ");
    // TODO §30 Compras: conectar a purchase-order router cuando esté disponible
    alert(`Orden de compra para: ${gtins}`);
  };

  const haySeleccion = seleccionados.size > 0;
  const todosSeleccionados = alertas.length > 0 && seleccionados.size === alertas.length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/inventory" className="hover:underline">
              Inventario
            </Link>
            <span>/</span>
            <span>Alertas GS1</span>
          </div>
          <h1 className="text-2xl font-bold">Alertas de Inventario</h1>
          <p className="text-sm text-muted-foreground">
            Stock bajo/crítico y caducidades por GTIN+GLN (SQL 83).
          </p>
        </div>
        <Button variant="outline" onClick={() => query.refetch()}>
          Actualizar
        </Button>
      </div>

      {/* Resumen */}
      {alertas.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {(["vencido", "stock_critico", "proximo_vencer", "stock_bajo"] as AlertaTipo[]).map(
            (tipo) => {
              const count = alertas.filter((a) => a.tipo === tipo).length;
              if (count === 0) return null;
              return (
                <Badge key={tipo} variant={BADGE_VARIANT[tipo]}>
                  {BADGE_LABEL[tipo]}: {count}
                </Badge>
              );
            },
          )}
        </div>
      )}

      {/* Bulk actions */}
      {haySeleccion && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2">
          <span className="text-sm font-medium">{seleccionados.size} seleccionados</span>
          <Button size="sm" variant="outline" onClick={generarOrden}>
            Generar orden de compra
          </Button>
          <Button size="sm" variant="secondary" onClick={marcarResuelto}>
            Marcar resuelto
          </Button>
        </div>
      )}

      {/* Tabla */}
      <Card>
        <CardHeader>
          <CardTitle>
            {query.isLoading
              ? "Cargando alertas…"
              : alertas.length === 0
                ? "Sin alertas activas"
                : `${alertas.length} alerta${alertas.length !== 1 ? "s" : ""} activa${alertas.length !== 1 ? "s" : ""}`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {query.isError && (
            <p className="text-sm text-destructive">
              Error cargando alertas: {query.error.message}
            </p>
          )}

          {!query.isLoading && alertas.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={todosSeleccionados}
                      onCheckedChange={toggleTodos}
                      aria-label="Seleccionar todos"
                    />
                  </TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>GTIN</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead>GLN (Ubicación)</TableHead>
                  <TableHead className="text-right">Stock actual</TableHead>
                  <TableHead className="text-right">Mínimo</TableHead>
                  <TableHead>Lote / Vencimiento</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alertas.map((alerta) => {
                  const key = alertaKey(alerta);
                  return (
                    <TableRow key={key} className={seleccionados.has(key) ? "bg-muted/40" : ""}>
                      <TableCell>
                        <Checkbox
                          checked={seleccionados.has(key)}
                          onCheckedChange={() => toggleSeleccion(key)}
                          aria-label={`Seleccionar alerta ${alerta.gtinCodigo}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Badge variant={BADGE_VARIANT[alerta.tipo]}>
                          {BADGE_LABEL[alerta.tipo]}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{alerta.gtinCodigo}</TableCell>
                      <TableCell className="max-w-[200px] truncate" title={alerta.gtinDescripcion}>
                        {alerta.gtinDescripcion}
                      </TableCell>
                      <TableCell
                        className="max-w-[150px] truncate text-xs text-muted-foreground"
                        title={`${alerta.ubicacionGln} — ${alerta.glnDescripcion}`}
                      >
                        {alerta.ubicacionGln}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        <span
                          className={
                            alerta.stockActual <= alerta.stockCritico
                              ? "text-destructive"
                              : alerta.stockActual <= alerta.stockMinimo
                                ? "text-orange-600"
                                : ""
                          }
                        >
                          {alerta.stockActual}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {alerta.stockMinimo}
                      </TableCell>
                      <TableCell className="text-xs">
                        {alerta.loteNumero ? (
                          <span>
                            {alerta.loteNumero}
                            {alerta.expiryDate && (
                              <>
                                {" · "}
                                <span
                                  className={
                                    (alerta.diasRestantes ?? 0) < 0
                                      ? "font-medium text-destructive"
                                      : (alerta.diasRestantes ?? 0) <= 7
                                        ? "font-medium text-orange-600"
                                        : "text-muted-foreground"
                                  }
                                >
                                  {alerta.diasRestantes !== undefined && alerta.diasRestantes < 0
                                    ? `Vencido (${Math.abs(alerta.diasRestantes)}d)`
                                    : `${alerta.diasRestantes}d restantes`}
                                </span>
                              </>
                            )}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          {!query.isLoading && alertas.length === 0 && !query.isError && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Sin alertas activas. El inventario GS1 está dentro de los umbrales configurados.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
