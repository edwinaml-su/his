"use client";

/**
 * /admin/odoo-introspect — Lee el shape de `res.partner` en Odoo y muestra
 * la lista de campos con su tipo, label y si es required. Permite descargar
 * el JSON completo (fields + 3 samples) para diseñar el schema del Patient
 * en el HIS.
 *
 * READ-ONLY hacia Odoo — el endpoint NO modifica datos del ERP. La
 * directiva del proyecto es replicar la estructura, no sincronizar.
 *
 * Restringido a ADMIN / DIRECTOR (enforce en el endpoint).
 */
import * as React from "react";
import { Database, Download, RefreshCw, AlertCircle } from "lucide-react";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Badge } from "@his/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Alert, AlertDescription } from "@his/ui/components/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";

interface FieldMeta {
  string?: string;
  type?: string;
  required?: boolean;
  readonly?: boolean;
  help?: string;
  relation?: string;
  selection?: Array<[string, string]>;
  size?: number;
  store?: boolean;
}

interface IntrospectResponse {
  ok: true;
  version: { server_version: string; protocol_version: number };
  uid: number;
  db: string;
  url: string;
  model: string;
  fieldCount: number;
  fieldsByType: Record<string, number>;
  fields: Record<string, FieldMeta>;
  samples: Record<string, unknown>[];
  generatedAt: string;
  generatedBy: { id: string; email: string };
}

interface IntrospectError {
  ok: false;
  error: string;
}

type Result = IntrospectResponse | IntrospectError;

export default function OdooIntrospectPage() {
  const [data, setData] = React.useState<IntrospectResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [filter, setFilter] = React.useState("");

  const run = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch("/api/admin/odoo/introspect", {
        cache: "no-store",
      });
      const json = (await res.json()) as Result;
      if (!json.ok) {
        setError(json.error);
      } else {
        setData(json);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setLoading(false);
    }
  }, []);

  const downloadJson = React.useCallback(() => {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `odoo-res-partner-schema-${data.generatedAt.replace(/[:.]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data]);

  // Filtrado client-side sobre los nombres de campo.
  const filteredFields = React.useMemo(() => {
    if (!data) return [] as Array<[string, FieldMeta]>;
    const q = filter.trim().toLowerCase();
    const entries = Object.entries(data.fields);
    if (!q) return entries.sort(([a], [b]) => a.localeCompare(b));
    return entries
      .filter(
        ([name, meta]) =>
          name.toLowerCase().includes(q) ||
          (meta.string ?? "").toLowerCase().includes(q) ||
          (meta.type ?? "").toLowerCase().includes(q),
      )
      .sort(([a], [b]) => a.localeCompare(b));
  }, [data, filter]);

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Database className="h-6 w-6" aria-hidden />
          Introspección Odoo · res.partner
        </h1>
        <p className="text-sm text-muted-foreground">
          Lee el esquema del partner de Odoo (READ-ONLY) para diseñar la réplica
          de campos en el HIS. <strong>No escribe datos</strong> en Odoo.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Conexión Odoo</CardTitle>
          <CardDescription>
            Requiere env vars en Vercel:{" "}
            <code className="font-mono text-xs">ODOO_URL</code>,{" "}
            <code className="font-mono text-xs">ODOO_DB</code>,{" "}
            <code className="font-mono text-xs">ODOO_USER</code>,{" "}
            <code className="font-mono text-xs">ODOO_PASSWORD</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={run} disabled={loading}>
              <RefreshCw
                className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`}
                aria-hidden
              />
              {loading ? "Consultando…" : "Introspectar res.partner"}
            </Button>
            {data && (
              <Button onClick={downloadJson} variant="outline">
                <Download className="mr-2 h-4 w-4" aria-hidden />
                Descargar JSON ({Math.round(JSON.stringify(data).length / 1024)} KB)
              </Button>
            )}
          </div>

          {error && (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <div className="text-sm">
                  <p className="font-semibold">Falló la introspección</p>
                  <p className="mt-1 break-words text-xs">{error}</p>
                </div>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {data && (
        <>
          {/* Metadata del servidor */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Servidor</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
              <div>
                <span className="text-muted-foreground">URL:</span>{" "}
                <span className="font-mono text-xs">{data.url}</span>
              </div>
              <div>
                <span className="text-muted-foreground">DB:</span>{" "}
                <span className="font-mono text-xs">{data.db}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Versión:</span>{" "}
                <span className="font-mono text-xs">{data.version.server_version}</span>
              </div>
              <div>
                <span className="text-muted-foreground">UID:</span>{" "}
                <span className="font-mono text-xs">{data.uid}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Total campos:</span>{" "}
                <Badge variant="secondary">{data.fieldCount}</Badge>
              </div>
              <div className="flex flex-wrap gap-1">
                {Object.entries(data.fieldsByType)
                  .sort(([, a], [, b]) => b - a)
                  .map(([type, count]) => (
                    <Badge key={type} variant="outline" className="text-xs">
                      {type}: {count}
                    </Badge>
                  ))}
              </div>
            </CardContent>
          </Card>

          {/* Tabla de campos */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Campos ({filteredFields.length} de {data.fieldCount})
              </CardTitle>
              <CardDescription>
                Filtra por nombre, label o tipo. Click en la fila para ver detalles.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Input
                placeholder="Filtrar campos…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="mb-3 max-w-sm"
              />
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[200px]">Nombre</TableHead>
                      <TableHead className="w-[110px]">Tipo</TableHead>
                      <TableHead className="w-[80px]">Req.</TableHead>
                      <TableHead>Label</TableHead>
                      <TableHead>Relación / Opciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredFields.map(([name, meta]) => (
                      <TableRow key={name}>
                        <TableCell className="font-mono text-xs">{name}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {meta.type ?? "?"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {meta.required ? (
                            <Badge variant="destructive" className="text-xs">
                              sí
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">no</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {meta.string ?? <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-xs">
                          {meta.relation && (
                            <span className="font-mono">→ {meta.relation}</span>
                          )}
                          {meta.selection && (
                            <span className="text-muted-foreground">
                              {meta.selection
                                .slice(0, 3)
                                .map(([v]) => v)
                                .join(", ")}
                              {meta.selection.length > 3 ? "…" : ""}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Samples */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Muestras ({data.samples.length})</CardTitle>
              <CardDescription>
                3 partners reales para validar shape con datos vivos.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {data.samples.map((s, i) => (
                  <details key={i} className="rounded-md border bg-muted/30">
                    <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
                      Sample {i + 1} — id={String((s as { id?: unknown }).id ?? "?")} ·
                      name={String((s as { name?: unknown }).name ?? "—")}
                    </summary>
                    <pre className="overflow-x-auto px-3 pb-3 text-[10px] leading-tight">
                      {JSON.stringify(s, null, 2)}
                    </pre>
                  </details>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
