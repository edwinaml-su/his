"use client";

/**
 * F2-S15 Stream D — Matriz de Permisos RBAC.
 * US.F2.7.21 — Tabla pivot user × resource × action con export CSV.
 */
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Badge } from "@his/ui/components/badge";
import { trpc } from "@/lib/trpc/react";

export default function MatrizPermisosPage() {
  const [resource, setResource] = React.useState("");
  const [filter, setFilter] = React.useState<{ resource?: string }>({});

  const query = trpc.rbac.permissionMatrix.useQuery({
    resource: filter.resource,
    activeOnly: true,
  });

  // Exportar CSV de la matriz
  const exportCsv = () => {
    if (!query.data) return;
    const rows: string[] = [];
    rows.push(["Usuario", "Email", "Recurso", "Acción", "Efecto"].join(","));
    for (const u of query.data.users) {
      if (u.permissions.length === 0) {
        rows.push([`"${u.fullName}"`, `"${u.email}"`, "", "", ""].join(","));
      }
      for (const p of u.permissions) {
        rows.push(
          [
            `"${u.fullName}"`,
            `"${u.email}"`,
            `"${p.resource}"`,
            `"${p.action}"`,
            p.effect,
          ].join(","),
        );
      }
    }
    const csv = rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `matriz-permisos-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Pivota: lista de recursos únicos del resultado
  const allResources = React.useMemo(() => {
    if (!query.data) return [];
    const set = new Set<string>();
    for (const u of query.data.users) {
      for (const p of u.permissions) set.add(p.resource);
    }
    return Array.from(set).sort();
  }, [query.data]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Matriz de Permisos</h1>
          <p className="text-sm text-muted-foreground">
            US.F2.7.21 — Quién tiene qué permiso en la organización.
          </p>
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={!query.data}>
          Exportar CSV
        </Button>
      </div>

      {/* Filtro por recurso */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="resource">Filtrar por recurso</Label>
              <Input
                id="resource"
                value={resource}
                onChange={(e) => setResource(e.target.value)}
                placeholder="Ej: patient, encounter, ece.documento"
              />
            </div>
            <Button onClick={() => setFilter({ resource: resource || undefined })}>
              Filtrar
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setResource("");
                setFilter({});
              }}
            >
              Limpiar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Resumen */}
      {query.data && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{query.data.totalUsers} usuario(s) con permisos activos.</span>
          {allResources.length > 0 && (
            <span>{allResources.length} recurso(s) únicos.</span>
          )}
        </div>
      )}

      {/* Tabla pivot */}
      <Card>
        <CardHeader>
          <CardTitle>Vista por usuario</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando matriz...</p>
          ) : query.isError ? (
            <p className="text-sm text-red-600">{query.error.message}</p>
          ) : query.data?.users.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin usuarios con permisos activos.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4 min-w-[160px]">Usuario</th>
                    <th className="pb-2 pr-4 min-w-[200px]">Email</th>
                    <th className="pb-2">Permisos (recurso:acción)</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data?.users.map((u) => (
                    <tr key={u.userId} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium">{u.fullName}</td>
                      <td className="py-2 pr-4 text-xs text-muted-foreground">{u.email}</td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-1">
                          {u.permissions.length === 0 ? (
                            <span className="text-xs text-muted-foreground">Sin permisos</span>
                          ) : (
                            u.permissions.map((p) => (
                              <Badge
                                key={`${p.resource}:${p.action}`}
                                variant={p.effect === "ALLOW" ? "default" : "destructive"}
                                className="text-xs"
                              >
                                {p.resource}:{p.action}
                              </Badge>
                            ))
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
