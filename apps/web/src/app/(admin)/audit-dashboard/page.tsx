"use client";

/**
 * F2-S15 Stream D — Dashboard Auditoría Accesos ECE.
 * US.F2.7.16 — Vista para DIR: top usuarios, outliers, accesos sensibles.
 */
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Badge } from "@his/ui/components/badge";
import { trpc } from "@/lib/trpc/react";

function ExportCsvButton({
  base64,
  filename,
}: {
  base64: string;
  filename: string;
}) {
  const handleDownload = () => {
    const blob = new Blob([Buffer.from(base64, "base64")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Button variant="outline" size="sm" onClick={handleDownload}>
      Exportar CSV
    </Button>
  );
}

export default function AuditDashboardPage() {
  const [desde, setDesde] = React.useState("");
  const [hasta, setHasta] = React.useState("");
  const [filter, setFilter] = React.useState<{ desde?: string; hasta?: string }>({});

  const stats = trpc.auditOutlier.dashboardStats.useQuery(filter);
  const topUsers = trpc.auditOutlier.topUsers.useQuery({ limit: 10 });
  const outliers = trpc.auditOutlier.listOutliers.useQuery({
    ...filter,
    limit: 50,
    offset: 0,
  });
  const sensitive = trpc.auditOutlier.sensitiveAccess.useQuery({
    ...filter,
    limit: 20,
    offset: 0,
  });

  const scanMut = trpc.auditOutlier.scanAndFlag.useMutation({
    onSuccess: () => {
      void stats.refetch();
      void outliers.refetch();
    },
  });

  const applyFilter = () => {
    setFilter({
      desde: desde || undefined,
      hasta: hasta || undefined,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard Auditoría Accesos</h1>
          <p className="text-sm text-muted-foreground">
            US.F2.7.16 — Monitoreo de accesos al ECE para Dirección.
          </p>
        </div>
        <Button
          variant="destructive"
          size="sm"
          disabled={scanMut.isPending}
          onClick={() =>
            scanMut.mutate({
              desde: filter.desde,
              hasta: filter.hasta,
            })
          }
        >
          {scanMut.isPending ? "Escaneando..." : "Escanear Outliers"}
        </Button>
      </div>

      {/* Filtros de fecha */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="desde">Desde</Label>
              <Input
                id="desde"
                type="datetime-local"
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="hasta">Hasta</Label>
              <Input
                id="hasta"
                type="datetime-local"
                value={hasta}
                onChange={(e) => setHasta(e.target.value)}
              />
            </div>
            <Button onClick={applyFilter}>Aplicar filtro</Button>
            <Button
              variant="ghost"
              onClick={() => {
                setDesde("");
                setHasta("");
                setFilter({});
              }}
            >
              Limpiar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Accesos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">
              {stats.isLoading ? "..." : (stats.data?.totalAccesos ?? 0).toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Outliers Detectados
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-amber-500">
              {stats.isLoading ? "..." : (stats.data?.totalOutliers ?? 0).toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Accesos Sensibles
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-red-500">
              {sensitive.isLoading ? "..." : (sensitive.data?.total ?? 0).toLocaleString()}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Top 10 usuarios */}
      <Card>
        <CardHeader>
          <CardTitle>Top 10 Usuarios por Accesos (último mes)</CardTitle>
        </CardHeader>
        <CardContent>
          {topUsers.isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando...</p>
          ) : topUsers.data?.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin datos en el período.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-4">#</th>
                  <th className="pb-2 pr-4">Usuario ID</th>
                  <th className="pb-2">Accesos</th>
                </tr>
              </thead>
              <tbody>
                {topUsers.data?.map((u, i) => (
                  <tr key={u.authUserId} className="border-b last:border-0">
                    <td className="py-1.5 pr-4 text-muted-foreground">{i + 1}</td>
                    <td className="py-1.5 pr-4 font-mono text-xs">{u.authUserId}</td>
                    <td className="py-1.5 font-semibold">{u.accesos}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Outliers recientes */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Accesos Outlier</CardTitle>
          <Badge variant="secondary">{outliers.data?.total ?? 0} total</Badge>
        </CardHeader>
        <CardContent>
          {outliers.isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando...</p>
          ) : outliers.data?.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay outliers en el período.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-3">Fecha/Hora</th>
                  <th className="pb-2 pr-3">Usuario ID</th>
                  <th className="pb-2 pr-3">Acción</th>
                  <th className="pb-2 pr-3">IP</th>
                  <th className="pb-2">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {outliers.data?.items.map((item) => (
                  <tr key={item.id} className="border-b last:border-0">
                    <td className="py-1.5 pr-3 text-xs">
                      {new Date(item.ocurridoEn).toLocaleString("es-SV")}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-xs">
                      {item.authUserId ?? item.personalId ?? "—"}
                    </td>
                    <td className="py-1.5 pr-3">
                      <Badge variant="outline">{item.accion}</Badge>
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-xs">{item.ipOrigen ?? "—"}</td>
                    <td className="py-1.5 text-xs text-amber-600">{item.motivoOutlier ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Accesos sensibles */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Accesos a Expedientes Sensibles (VIP / Salud Mental / HIV)</CardTitle>
          <Badge variant="destructive">{sensitive.data?.total ?? 0}</Badge>
        </CardHeader>
        <CardContent>
          {sensitive.isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando...</p>
          ) : sensitive.data?.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin accesos sensibles en el período.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-3">Fecha/Hora</th>
                  <th className="pb-2 pr-3">Usuario ID</th>
                  <th className="pb-2 pr-3">Acción</th>
                  <th className="pb-2">Recurso</th>
                </tr>
              </thead>
              <tbody>
                {sensitive.data?.items.map((item) => (
                  <tr key={item.id} className="border-b last:border-0">
                    <td className="py-1.5 pr-3 text-xs">
                      {new Date(item.ocurridoEn).toLocaleString("es-SV")}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-xs">
                      {item.authUserId ?? item.personalId ?? "—"}
                    </td>
                    <td className="py-1.5 pr-3">
                      <Badge variant="outline">{item.accion}</Badge>
                    </td>
                    <td className="py-1.5 font-mono text-xs">{item.recursoId ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
