"use client";

/**
 * /finance/allocation-rules/prorrateo — Ejecutar y visualizar prorrateo mensual.
 *
 * MVP: preview (no persiste). Exporta resultado a CSV cliente-side.
 */
import * as React from "react";
import Link from "next/link";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { trpc } from "@/lib/trpc/react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const t = trpc as any;

function isoStartOfMonth(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

function isoEndOfMonth(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).toISOString();
}

type Distribucion = {
  targetCostCenterId: string;
  targetCode: string;
  targetName: string;
  porcentaje: number;
  monto: number;
};

type ProrationResult = {
  ruleId: string;
  ruleName: string;
  sourceCostCenterCode: string;
  sourceCostCenterName: string;
  base: string;
  totalProrateado: number;
  distribuciones: Distribucion[];
};

function formatMoney(n: number): string {
  return n.toLocaleString("es-SV", { style: "currency", currency: "USD" });
}

function exportCsv(results: ProrationResult[], from: string, to: string) {
  const rows: string[] = [
    "Regla,Centro Origen,Centro Destino,Codigo Destino,%,Monto USD",
  ];
  for (const r of results) {
    for (const d of r.distribuciones) {
      rows.push(
        [
          `"${r.ruleName}"`,
          `"${r.sourceCostCenterCode} - ${r.sourceCostCenterName}"`,
          `"${d.targetCode} - ${d.targetName}"`,
          `"${d.targetCode}"`,
          d.porcentaje.toFixed(2),
          d.monto.toFixed(2),
        ].join(","),
      );
    }
  }
  const csv = rows.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `prorrateo_${from.slice(0, 10)}_${to.slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ProrrateoPage() {
  const [periodStart, setPeriodStart] = React.useState(isoStartOfMonth().slice(0, 10));
  const [periodEnd, setPeriodEnd] = React.useState(isoEndOfMonth().slice(0, 10));
  const [results, setResults] = React.useState<ProrationResult[] | null>(null);

  const orgQuery = trpc.organization.current.useQuery();
  const orgId = orgQuery.data?.id ?? "";

  const runProration = t.allocationRule.runProration.useMutation({
    onSuccess: (data: ProrationResult[]) => {
      setResults(data);
    },
  });

  function handleRun() {
    if (!orgId) return;
    setResults(null);
    runProration.mutate({
      periodStart: new Date(periodStart).toISOString(),
      periodEnd: new Date(periodEnd + "T23:59:59.999Z").toISOString(),
      organizationId: orgId,
    });
  }

  // Subtotales por centro destino en todos los results
  const subtotalesPorTarget = React.useMemo(() => {
    if (!results) return new Map<string, number>();
    const map = new Map<string, number>();
    for (const r of results) {
      for (const d of r.distribuciones) {
        map.set(d.targetCostCenterId, (map.get(d.targetCostCenterId) ?? 0) + d.monto);
      }
    }
    return map;
  }, [results]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button asChild variant="outline" size="sm">
          <Link href="/finance/allocation-rules">Volver</Link>
        </Button>
        <h1 className="text-2xl font-bold">Ejecutar Prorrateo</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Periodo de cálculo</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label htmlFor="periodStart">Fecha inicio</Label>
              <Input
                id="periodStart"
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                className="w-44"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="periodEnd">Fecha fin</Label>
              <Input
                id="periodEnd"
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                className="w-44"
              />
            </div>
            <Button
              onClick={handleRun}
              disabled={!orgId || runProration.isPending || !periodStart || !periodEnd}
            >
              {runProration.isPending ? "Calculando…" : "Calcular prorrateo"}
            </Button>
            {results && results.length > 0 ? (
              <Button
                variant="outline"
                onClick={() =>
                  exportCsv(results, periodStart, periodEnd)
                }
              >
                Exportar a CSV
              </Button>
            ) : null}
          </div>

          {!orgId && !orgQuery.isLoading ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Sin tenant activo. Selecciona una organización desde el switcher superior.
            </p>
          ) : null}

          {runProration.error ? (
            <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {(runProration.error as { message?: string })?.message ?? "Error al calcular."}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {results !== null ? (
        results.length === 0 ? (
          <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
            No hay reglas activas para esta organización o no se encontraron costos en el periodo.
          </p>
        ) : (
          <div className="space-y-4">
            {results.map((r) => (
              <Card key={r.ruleId}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-sm font-semibold">{r.ruleName}</CardTitle>
                      <p className="text-xs text-muted-foreground">
                        Origen:{" "}
                        <span className="font-mono">
                          {r.sourceCostCenterCode}
                        </span>{" "}
                        {r.sourceCostCenterName} — Base: {r.base.replace(/_/g, " ")}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Total prorateado</p>
                      <p className="text-lg font-bold">{formatMoney(r.totalProrateado)}</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Centro destino</TableHead>
                          <TableHead className="w-24 text-right">%</TableHead>
                          <TableHead className="w-36 text-right">Monto USD</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {r.distribuciones.map((d) => (
                          <TableRow key={d.targetCostCenterId}>
                            <TableCell>
                              <span className="font-mono text-xs">{d.targetCode}</span>{" "}
                              <span className="text-muted-foreground">{d.targetName}</span>
                            </TableCell>
                            <TableCell className="text-right">{d.porcentaje.toFixed(2)}%</TableCell>
                            <TableCell className="text-right font-medium">
                              {formatMoney(d.monto)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            ))}

            {/* Subtotales por destino */}
            {subtotalesPorTarget.size > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Subtotal recibido por centro destino
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Centro destino</TableHead>
                          <TableHead className="w-36 text-right">Total recibido</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {results
                          .flatMap((r) => r.distribuciones)
                          .reduce(
                            (acc, d) => {
                              const existing = acc.find(
                                (x) => x.id === d.targetCostCenterId,
                              );
                              if (existing) {
                                existing.monto += d.monto;
                              } else {
                                acc.push({
                                  id: d.targetCostCenterId,
                                  code: d.targetCode,
                                  name: d.targetName,
                                  monto: d.monto,
                                });
                              }
                              return acc;
                            },
                            [] as Array<{
                              id: string;
                              code: string;
                              name: string;
                              monto: number;
                            }>,
                          )
                          .sort((a, b) => b.monto - a.monto)
                          .map((row) => (
                            <TableRow key={row.id}>
                              <TableCell>
                                <span className="font-mono text-xs">{row.code}</span>{" "}
                                <span className="text-muted-foreground">{row.name}</span>
                              </TableCell>
                              <TableCell className="text-right font-semibold">
                                {formatMoney(row.monto)}
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>
        )
      ) : null}
    </div>
  );
}
