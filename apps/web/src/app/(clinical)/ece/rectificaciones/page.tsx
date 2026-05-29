"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@his/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { Badge } from "@his/ui/components/badge";
import { trpc } from "@/lib/trpc/react";

type EstadoRectificacion = "PENDIENTE" | "APROBADA" | "RECHAZADA" | "FIRMADA";

/**
 * ECE — Mis rectificaciones pendientes (PHYSICIAN/NURSE).
 * Filtra por documentoInstanciaId desde query param.
 *
 * HG-17: usa useSearchParams() en lugar de prop searchParams para evitar
 * el error de Next.js 14 sobre acceso a searchParams en Client Components
 * sin Suspense.
 */

const dateFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "medium",
  timeStyle: "short",
});

function EstadoBadge({ estado }: { estado: EstadoRectificacion }) {
  const map: Record<EstadoRectificacion, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    PENDIENTE: { label: "Pendiente", variant: "secondary" },
    APROBADA: { label: "Aprobada", variant: "default" },
    RECHAZADA: { label: "Rechazada", variant: "destructive" },
    FIRMADA: { label: "Firmada", variant: "outline" },
  };
  const { label, variant } = map[estado];
  return <Badge variant={variant}>{label}</Badge>;
}

export default function EceRectificacionesPage() {
  const searchParams = useSearchParams();
  const docId = searchParams.get("documentoInstanciaId") ?? "";

  const query = trpc.eceRectificacion.list.useQuery(
    { documentoInstanciaId: docId },
    { enabled: docId.length > 0 },
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Mis rectificaciones ECE</h1>
          <p className="text-sm text-muted-foreground">
            Solicitudes de rectificación sobre documentos firmados (NTEC Art. 41).
          </p>
        </div>
        {docId && (
          <Button asChild>
            <Link href={`/ece/rectificaciones/nueva?documentoInstanciaId=${docId}`}>
              Nueva solicitud
            </Link>
          </Button>
        )}
      </div>

      {!docId && (
        <p className="text-sm text-muted-foreground">
          Accede desde un documento firmado para ver sus rectificaciones.
        </p>
      )}

      {docId && (
        <Card>
          <CardHeader>
            <CardTitle>Rectificaciones</CardTitle>
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
            {query.data && query.data.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No hay rectificaciones para este documento.
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
                    <TableHead>Solicitado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.data.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.campo}</TableCell>
                      <TableCell className="max-w-[12rem] truncate text-sm">
                        {r.valor_anterior}
                      </TableCell>
                      <TableCell className="max-w-[12rem] truncate text-sm">
                        {r.valor_propuesto}
                      </TableCell>
                      <TableCell className="max-w-[16rem] truncate text-sm">
                        {r.motivo}
                      </TableCell>
                      <TableCell>
                        <EstadoBadge estado={r.estado} />
                      </TableCell>
                      <TableCell className="tabular-nums text-sm">
                        {r.created_at
                          ? dateFmt.format(new Date(r.created_at))
                          : "—"}
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
