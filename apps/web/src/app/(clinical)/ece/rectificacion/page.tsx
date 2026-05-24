"use client";

/**
 * ECE — Rectificaciones de documentos firmados (NTEC Art. 42).
 *
 * Lista transversal de rectificaciones del episodio activo.
 * El episodioId se recibe por query param (?episodioId=<uuid>).
 *
 * Solo procede rectificar documentos en estado firmado/validado/cerrado.
 * El documento original NO se modifica — la rectificación es el registro corrector.
 */
import * as React from "react";
import Link from "next/link";
import { FilePenLine } from "lucide-react";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
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

type EstadoRect = "PENDIENTE" | "APROBADA" | "RECHAZADA" | "FIRMADA";

const ESTADO_MAP: Record<
  EstadoRect,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  PENDIENTE: { label: "Pendiente", variant: "secondary" },
  APROBADA: { label: "Aprobada", variant: "default" },
  RECHAZADA: { label: "Rechazada", variant: "destructive" },
  FIRMADA: { label: "Firmada", variant: "outline" },
};

const dateFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "medium",
  timeStyle: "short",
});

function EstadoBadge({ estado }: { estado: EstadoRect }) {
  const { label, variant } = ESTADO_MAP[estado] ?? { label: estado, variant: "outline" };
  return <Badge variant={variant}>{label}</Badge>;
}

export default function EceRectificacionPage({
  searchParams,
}: {
  searchParams: { episodioId?: string; documentoInstanciaId?: string };
}) {
  const episodioId = searchParams.episodioId ?? "";
  const instanciaId = searchParams.documentoInstanciaId ?? "";

  // Acepta filtrar por episodio (vista transversal) o por instancia específica
  const input = instanciaId
    ? { documentoInstanciaId: instanciaId }
    : episodioId
      ? { episodioId }
      : null;

  const query = trpc.eceRectificacion.list.useQuery(
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    input!,
    { enabled: input !== null },
  );

  const nuevoHref =
    episodioId
      ? `/ece/rectificacion/nuevo?episodioId=${episodioId}`
      : instanciaId
        ? `/ece/rectificacion/nuevo?documentoInstanciaId=${instanciaId}`
        : "/ece/rectificacion/nuevo";

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <FilePenLine className="h-6 w-6" />
            Rectificaciones ECE
          </h1>
          <p className="text-sm text-muted-foreground">
            Correcciones trazables de documentos firmados (NTEC Art. 42). El documento
            original no se modifica.
          </p>
        </div>
        {input !== null && (
          <Button asChild>
            <Link href={nuevoHref}>Nueva rectificacion</Link>
          </Button>
        )}
      </div>

      {input === null && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              Para ver las rectificaciones de un episodio, accede desde la vista del
              episodio o agrega el parametro{" "}
              <code className="rounded bg-muted px-1 font-mono">?episodioId=</code> en la
              URL.
            </p>
          </CardContent>
        </Card>
      )}

      {input !== null && (
        <Card>
          <CardHeader>
            <CardTitle>Rectificaciones del episodio</CardTitle>
          </CardHeader>
          <CardContent>
            {query.isLoading && (
              <p className="text-sm text-muted-foreground">Cargando...</p>
            )}
            {query.error && (
              <p role="alert" className="text-sm text-destructive">
                {query.error.message}
              </p>
            )}
            {query.data && query.data.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No hay rectificaciones para este episodio.
              </p>
            )}
            {query.data && query.data.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campo</TableHead>
                    <TableHead>Valor anterior</TableHead>
                    <TableHead>Valor propuesto</TableHead>
                    <TableHead>Motivo</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Solicitado por</TableHead>
                    <TableHead>Fecha</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.data.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.campo}</TableCell>
                      <TableCell className="max-w-[10rem] truncate text-sm">
                        {r.valor_anterior ?? "—"}
                      </TableCell>
                      <TableCell className="max-w-[10rem] truncate text-sm">
                        {r.valor_propuesto ?? "—"}
                      </TableCell>
                      <TableCell className="max-w-[14rem] truncate text-sm">
                        {r.motivo}
                      </TableCell>
                      <TableCell>
                        <EstadoBadge estado={r.estado as EstadoRect} />
                      </TableCell>
                      <TableCell className="text-sm">
                        {r.solicitante_nombre ?? r.solicitante_id.slice(0, 8)}
                      </TableCell>
                      <TableCell className="tabular-nums text-sm">
                        {r.created_at ? dateFmt.format(new Date(r.created_at)) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
