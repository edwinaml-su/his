"use client";

/**
 * ECE — Listado de consentimientos quirúrgicos (CONS_QX) por episodio.
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

const ESTADO_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  borrador: "outline",
  firmado: "default",
  validado: "default",
  revocado: "destructive",
};

const dateFmt = new Intl.DateTimeFormat("es-SV", { dateStyle: "medium", timeStyle: "short" });

export default function ConsentimientoQxListPage() {
  const [episodioId, setEpisodioId] = React.useState("");

  const query = trpc.eceConsentimiento.list.useQuery(
    { episodioId: episodioId.trim() || undefined, limit: 50 },
    { enabled: true },
  );

  // Filtrar solo CONS_QX del resultado
  const rows = React.useMemo(
    () => (query.data?.items ?? []).filter((r) => r.tipo === "quirurgico"),
    [query.data],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <FileSignature className="h-6 w-6" aria-hidden />
            Consentimientos quirúrgicos
          </h1>
          <p className="text-sm text-muted-foreground">
            CONS_QX — NTEC §4.12. Documentos inmutables post-firma.
          </p>
        </div>
        <Button asChild>
          <Link href="/ece/quirofano/consentimiento-qx/nuevo">Nuevo</Link>
        </Button>
      </div>

      <div className="flex items-center gap-2 rounded-md border border-amber-400/50 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-300">
        <Lock className="h-4 w-4 shrink-0" aria-hidden />
        <span>
          Los consentimientos firmados son <strong>inmutables</strong>. Doble firma requerida.
        </span>
      </div>

      <Card>
        <CardHeader><CardTitle>Filtros</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            <Label htmlFor="filter-episodio">Episodio (UUID)</Label>
            <Input
              id="filter-episodio"
              placeholder="xxxxxxxx-xxxx-..."
              value={episodioId}
              onChange={(e) => setEpisodioId(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Documentos</CardTitle></CardHeader>
        <CardContent>
          {query.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {query.error && (
            <p role="alert" className="text-sm text-destructive">{query.error.message}</p>
          )}
          {!query.isLoading && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">Sin consentimientos quirúrgicos.</p>
          )}
          {rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Episodio</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Fecha</TableHead>
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
                          {estado}
                        </Badge>
                      </TableCell>
                      <TableCell className="tabular-nums text-xs">
                        {r.fecha_hora ? dateFmt.format(new Date(r.fecha_hora)) : "—"}
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
