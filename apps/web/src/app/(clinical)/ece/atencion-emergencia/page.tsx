"use client";

/**
 * ECE — Listado de atenciones de emergencia por episodio.
 * Workflow: borrador → en_revision → firmado → validado → anulado.
 * Rol MT firma y valida. Rol DIR anula.
 */
import * as React from "react";
import Link from "next/link";
import { Siren, ClipboardList } from "lucide-react";
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
  en_revision: "En revisión",
  firmado: "Firmado MT",
  validado: "Validado",
  anulado: "Anulado",
};

const ESTADO_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  borrador: "outline",
  en_revision: "secondary",
  firmado: "secondary",
  validado: "default",
  anulado: "destructive",
};

const dateFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default function AtencionEmergenciaListPage() {
  const [episodioId, setEpisodioId] = React.useState("");

  const query = trpc.eceAtencionEmergencia.list.useQuery(
    {
      episodioId: episodioId.trim() || undefined,
      page: 1,
      pageSize: 50,
    },
    { enabled: true },
  );

  const rows = query.data?.items ?? [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Siren className="h-6 w-6" aria-hidden />
            Atención de Emergencia
          </h1>
          <p className="text-sm text-muted-foreground">
            ECE — Registro clínico de atención en emergencias (NTEC Doc 5). Workflow MT: borrador
            → firmado → validado.
          </p>
        </div>
        <Button asChild>
          <Link href="/ece/atencion-emergencia/nueva">Nueva atención</Link>
        </Button>
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
          </div>
        </CardContent>
      </Card>

      {/* Tabla */}
      <Card>
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4" aria-hidden />
              Atenciones registradas
            </span>
          </CardTitle>
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
              Sin atenciones para los filtros aplicados.
            </p>
          )}
          {rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Episodio</TableHead>
                  <TableHead>Motivo consulta</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Registrado</TableHead>
                  <TableHead>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const estado = r.estado_documento ?? "borrador";
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">
                        {r.id.slice(0, 8)}…
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.episodio_id ? r.episodio_id.slice(0, 8) + "…" : "—"}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm">
                        {r.motivo_consulta}
                      </TableCell>
                      <TableCell>
                        <Badge variant={ESTADO_VARIANT[estado] ?? "outline"}>
                          {ESTADO_LABEL[estado] ?? estado}
                        </Badge>
                      </TableCell>
                      <TableCell className="tabular-nums text-xs">
                        {r.registrado_en
                          ? dateFmt.format(new Date(r.registrado_en))
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/ece/atencion-emergencia/${r.id}`}>Ver / Firmar</Link>
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
