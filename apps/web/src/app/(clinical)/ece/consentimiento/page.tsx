"use client";

/**
 * ECE — Listado de consentimientos informados por episodio.
 * Stream 18 / Acuerdo n.° 1616 MINSAL 2024.
 * Documentos INMUTABLES post-firma.
 */
import * as React from "react";
import Link from "next/link";
import { FileSignature, Lock } from "lucide-react";
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
import { Badge } from "@his/ui/components/badge";
import { trpc } from "@/lib/trpc/react";

// Estado del documento en el workflow
const ESTADO_LABEL: Record<string, string> = {
  borrador: "Borrador",
  pendiente_firma_paciente: "Pend. firma paciente",
  pendiente_firma_mc: "Pend. firma MC",
  firmado: "Firmado",
  revocado: "Revocado",
};

const ESTADO_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  borrador: "outline",
  pendiente_firma_paciente: "secondary",
  pendiente_firma_mc: "secondary",
  firmado: "default",
  revocado: "destructive",
};

const TIPO_LABEL: Record<string, string> = {
  HOSPITALIZACION: "Hospitalización",
  QUIRURGICO: "Quirúrgico",
  ANESTESICO: "Anestésico",
};

const dateFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default function ConsentimientoListPage() {
  const [episodioId, setEpisodioId] = React.useState("");
  const [search, setSearch] = React.useState("");

  const query = trpc.workflowInstance.list.useQuery(
    {
      // tipoDocumentoId filtrado por categoria consentimiento — el backend
      // acepta filtro opcional; sin episodioId trae todos visibles al tenant.
      episodioId: episodioId.trim() || undefined,
      limit: 50,
    },
    { enabled: true },
  );

  // Filtro local por texto (tipo o paciente)
  const rows = React.useMemo(() => {
    const data = query.data?.items ?? [];
    if (!search.trim()) return data;
    const lc = search.toLowerCase();
    return data.filter(
      (r) =>
        String(r.tipo_nombre ?? "").toLowerCase().includes(lc) ||
        String(r.tipo_codigo ?? "").toLowerCase().includes(lc),
    );
  }, [query.data, search]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <FileSignature className="h-6 w-6" aria-hidden />
            Consentimientos informados
          </h1>
          <p className="text-sm text-muted-foreground">
            ECE — Documentos inmutables post-firma (Acuerdo n.° 1616 MINSAL).
          </p>
        </div>
        <Button asChild>
          <Link href="/ece/consentimiento/nuevo">Nuevo consentimiento</Link>
        </Button>
      </div>

      {/* Banner inmutabilidad */}
      <div className="flex items-center gap-2 rounded-md border border-amber-400/50 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-300">
        <Lock className="h-4 w-4 shrink-0" aria-hidden />
        <span>
          Los consentimientos firmados son <strong>inmutables</strong>. Una vez completada
          la doble firma (MC + paciente) el documento queda sellado criptográficamente.
        </span>
      </div>

      {/* Filtros */}
      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="filter-episodio">Episodio (UUID)</Label>
              <Input
                id="filter-episodio"
                placeholder="xxxxxxxx-xxxx-..."
                value={episodioId}
                onChange={(e) => setEpisodioId(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filter-search">Buscar tipo</Label>
              <Input
                id="filter-search"
                placeholder="hospitalización, quirúrgico…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabla */}
      <Card>
        <CardHeader>
          <CardTitle>Documentos</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading && (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          )}
          {query.error && (
            <p role="alert" className="text-sm text-destructive">
              {query.error.message}
            </p>
          )}
          {!query.isLoading && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Sin consentimientos para los filtros aplicados.
            </p>
          )}
          {rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Episodio</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Creado</TableHead>
                  <TableHead>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const estado = r.estado_codigo ?? "borrador";
                  const tipoLabel =
                    TIPO_LABEL[r.tipo_codigo ?? ""] ?? r.tipo_nombre ?? r.tipo_codigo ?? "—";
                  return (
                    <TableRow key={r.id}>
                      <TableCell>{tipoLabel}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.episodio_id ? r.episodio_id.slice(0, 8) + "…" : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={ESTADO_VARIANT[estado] ?? "outline"}>
                          {ESTADO_LABEL[estado] ?? estado}
                        </Badge>
                      </TableCell>
                      <TableCell className="tabular-nums text-xs">
                        {r.creado_en ? dateFmt.format(new Date(r.creado_en)) : "—"}
                      </TableCell>
                      <TableCell>
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/ece/consentimiento/${r.id}`}>Ver</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
