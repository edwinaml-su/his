"use client";

/**
 * ECE — Listado de epicrisis por episodio hospitalario.
 * Workflow MC → ESP → DIR. Documentos INMUTABLES post-certificación.
 */
import * as React from "react";
import Link from "next/link";
import { Lock, ClipboardList } from "lucide-react";
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

// Mapa de estados del workflow ECE epicrisis
const ESTADO_LABEL: Record<string, string> = {
  borrador: "Borrador",
  firmado_mc: "Firmado MC",
  validado_esp: "Validado ESP",
  certificado_dir: "Certificado DIR",
  revocado: "Revocado",
};

const ESTADO_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  borrador: "outline",
  firmado_mc: "secondary",
  validado_esp: "secondary",
  certificado_dir: "default",
  revocado: "destructive",
};

const dateFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default function EpicrisisListPage() {
  const [episodioId, setEpisodioId] = React.useState("");

  const query = trpc.workflowInstance.list.useQuery(
    {
      episodioId: episodioId.trim() || undefined,
      limit: 50,
    },
    { enabled: true },
  );

  // Router devuelve `{items, nextCursor}` paginated; aplanar a array.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = (query.data as any)?.items ?? [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ClipboardList className="h-6 w-6" aria-hidden />
            Epicrisis
          </h1>
          <p className="text-sm text-muted-foreground">
            ECE — Resumen de egreso hospitalario. Workflow MC → ESP → DIR.
          </p>
        </div>
        <Button asChild>
          <Link href="/ece/epicrisis/nueva">Nueva epicrisis</Link>
        </Button>
      </div>

      {/* Banner */}
      <div
        role="note"
        className="flex items-center gap-2 rounded-md border border-amber-400/50 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-300"
      >
        <Lock className="h-4 w-4 shrink-0" aria-hidden />
        <span>
          Las epicrisis certificadas son <strong>inmutables</strong>. La certificación requiere
          firma MC, validación ESP y certificación DIR.
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
              <Label htmlFor="filter-episodio">Episodio hospitalario (UUID)</Label>
              <Input
                id="filter-episodio"
                placeholder="xxxxxxxx-xxxx-..."
                value={episodioId}
                onChange={(e) => setEpisodioId(e.target.value)}
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
              Sin epicrisis para los filtros aplicados.
            </p>
          )}
          {rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Episodio</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Creado</TableHead>
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
                          <Link href={`/ece/epicrisis/${r.id}`}>Ver / Firmar</Link>
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
