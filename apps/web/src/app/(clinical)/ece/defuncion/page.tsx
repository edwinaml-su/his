"use client";

/**
 * ECE — Listado de Certificados de Defunción.
 * Workflow MC → MC (validación) → DIR. INMUTABLE post-firma (NTEC Art. 21).
 */
import * as React from "react";
import Link from "next/link";
import { Lock, Skull } from "lucide-react";
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
  firmado: "Firmado MC",
  validado: "Validado MC",
  certificado: "Certificado DIR",
  anulado: "Anulado",
};

const ESTADO_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  borrador: "outline",
  firmado: "secondary",
  validado: "secondary",
  certificado: "default",
  anulado: "destructive",
};

const dateFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default function DefuncionListPage() {
  const [fechaDesde, setFechaDesde] = React.useState("");
  const [causaCie10, setCausaCie10] = React.useState("");
  const [page, setPage] = React.useState(1);

  const query = trpc.eceCertDef.list.useQuery(
    {
      fechaDesde: fechaDesde ? new Date(fechaDesde) : undefined,
      causaPrincipalCie10: causaCie10.trim() || undefined,
      page,
      pageSize: 20,
    },
    { enabled: true },
  );

  const rows = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Skull className="h-6 w-6" aria-hidden />
            Certificados de Defunción
          </h1>
          <p className="text-sm text-muted-foreground">
            ECE — Certificado digital MINSAL. Workflow MC (firma + valida) → DIR (certifica).
          </p>
        </div>
        <Button asChild>
          <Link href="/ece/defuncion/nueva">Nuevo certificado</Link>
        </Button>
      </div>

      {/* Banner inmutabilidad */}
      <div
        role="note"
        className="flex items-center gap-2 rounded-md border border-amber-400/50 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-300"
      >
        <Lock className="h-4 w-4 shrink-0" aria-hidden />
        <span>
          <strong>DOCUMENTO INMUTABLE POST-FIRMA.</strong> Una vez firmado por el MC, el
          certificado no puede modificarse. La certificación DIR (Art. 21 NTEC) es obligatoria
          para copias formales.
        </span>
      </div>

      {/* Filtros */}
      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="filter-desde">Fecha desde</Label>
              <Input
                id="filter-desde"
                type="date"
                value={fechaDesde}
                onChange={(e) => { setFechaDesde(e.target.value); setPage(1); }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filter-cie10">Causa principal CIE-10</Label>
              <Input
                id="filter-cie10"
                placeholder="Ej. J18.9"
                value={causaCie10}
                onChange={(e) => { setCausaCie10(e.target.value); setPage(1); }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabla */}
      <Card>
        <CardHeader>
          <CardTitle>Registros ({total})</CardTitle>
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
              Sin certificados para los filtros aplicados.
            </p>
          )}
          {rows.length > 0 && (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Episodio</TableHead>
                    <TableHead>Fecha defunción</TableHead>
                    <TableHead>Causa principal (CIE-10)</TableHead>
                    <TableHead>Manera</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const estado = String(r.estado_workflow ?? "borrador");
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-xs">
                          {String(r.episodio_id).slice(0, 8)}…
                        </TableCell>
                        <TableCell className="tabular-nums text-xs">
                          {r.fecha_hora_defuncion
                            ? dateFmt.format(new Date(r.fecha_hora_defuncion))
                            : "—"}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {String(r.causa_principal_cie10 ?? "—")}
                        </TableCell>
                        <TableCell className="text-xs capitalize">
                          {String(r.manera ?? "—")}
                        </TableCell>
                        <TableCell>
                          <Badge variant={ESTADO_VARIANT[estado] ?? "outline"}>
                            {ESTADO_LABEL[estado] ?? estado}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button asChild variant="outline" size="sm">
                            <Link href={`/ece/defuncion/${r.id}`}>Ver</Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <div className="mt-3 flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={rows.length < 20}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Siguiente
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
