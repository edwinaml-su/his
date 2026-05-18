"use client";

/**
 * ECE — Lista de Actos Quirúrgicos.
 * NTEC §3.13 / Acuerdo n.° 1616 MINSAL 2024.
 * Documentos HISTÓRICOS — inmutables post-firma.
 */
import * as React from "react";
import Link from "next/link";
import { Scissors, Lock } from "lucide-react";
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

const ESTADO_LABEL: Record<string, string> = {
  borrador: "Borrador",
  firmado: "Firmado",
  validado: "Validado",
  anulado: "Anulado",
};

const ESTADO_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  borrador: "outline",
  firmado: "secondary",
  validado: "default",
  anulado: "destructive",
};

const dateFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default function ActoQxListPage() {
  const [episodioId, setEpisodioId] = React.useState("");
  const [estadoFilter, setEstadoFilter] = React.useState("");

  const query = trpc.eceActoQx.list.useQuery(
    {
      episodioId: episodioId.trim() || undefined,
      estado: (estadoFilter.trim() as "borrador" | "firmado" | "validado" | "anulado") || undefined,
      limit: 50,
    },
    { enabled: true },
  );

  const rows = query.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Scissors className="h-6 w-6" aria-hidden />
            Actos quirúrgicos
          </h1>
          <p className="text-sm text-muted-foreground">
            ECE §3.13 — Registros inmutables post-firma (Acuerdo n.° 1616 MINSAL).
          </p>
        </div>
        <Button asChild>
          <Link href="/ece/quirofano/acto-quirurgico/nueva">Nuevo acto quirúrgico</Link>
        </Button>
      </div>

      <div className="flex items-center gap-2 rounded-md border border-amber-400/50 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-300">
        <Lock className="h-4 w-4 shrink-0" aria-hidden />
        <span>
          Los actos quirúrgicos firmados son <strong>inmutables</strong>. La firma del cirujano
          sella criptográficamente el documento (NTEC §3.13).
        </span>
      </div>

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
              <Label htmlFor="filter-estado">Estado</Label>
              <Input
                id="filter-estado"
                placeholder="borrador, firmado, validado..."
                value={estadoFilter}
                onChange={(e) => setEstadoFilter(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

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
              Sin actos quirúrgicos para los filtros aplicados.
            </p>
          )}
          {rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Episodio</TableHead>
                  <TableHead>Procedimiento</TableHead>
                  <TableHead>Cirujano</TableHead>
                  <TableHead>Inicio</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const estado = r.estado_codigo ?? "borrador";
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">
                        {r.episodio_id ? r.episodio_id.slice(0, 8) + "…" : "—"}
                      </TableCell>
                      <TableCell className="max-w-xs truncate">
                        {r.procedimiento_realizado ?? "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.cirujano_id ? r.cirujano_id.slice(0, 8) + "…" : "—"}
                      </TableCell>
                      <TableCell className="tabular-nums text-xs">
                        {r.hora_inicio ? dateFmt.format(new Date(r.hora_inicio)) : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={ESTADO_VARIANT[estado] ?? "outline"}>
                          {ESTADO_LABEL[estado] ?? estado}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/ece/quirofano/acto-quirurgico/${r.id}`}>Ver</Link>
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
