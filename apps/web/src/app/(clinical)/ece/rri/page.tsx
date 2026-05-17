"use client";

/**
 * ECE — Listado RRI (Referencia / Retorno / Interconsulta).
 * NTEC Doc 10. Split: "Mías pendientes" (MC solicitante) / "Para responder" (IC).
 */
import * as React from "react";
import Link from "next/link";
import { ArrowLeftRight, Inbox, Send } from "lucide-react";
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
import { Badge } from "@his/ui/components/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@his/ui/components/tabs";
import { trpc } from "@/lib/trpc/react";

// ─── Mappings visuales ────────────────────────────────────────────────────────

const TIPO_LABEL: Record<string, string> = {
  referencia: "Referencia",
  retorno: "Retorno",
  interconsulta: "Interconsulta",
};

const URGENCIA_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  rutinaria: "outline",
  prioritaria: "secondary",
  urgente: "destructive",
};

const ESTADO_LABEL: Record<string, string> = {
  borrador: "Borrador",
  en_revision: "En revisión",
  firmado: "Firmado (pend. respuesta)",
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

const dateFmt = new Intl.DateTimeFormat("es-SV", { dateStyle: "medium", timeStyle: "short" });

// ─── Componente tabla ─────────────────────────────────────────────────────────

type RriItem = {
  id: string;
  tipo: string;
  urgencia: string;
  motivo: string;
  episodio_id: string;
  estado_codigo: string;
  fecha_solicitud: Date | string;
};

function RriTable({
  items,
  ctaLabel,
  ctaHref,
}: {
  items: RriItem[];
  ctaLabel: string;
  ctaHref: (id: string) => string;
}) {
  if (items.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Sin documentos para esta vista.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Tipo</TableHead>
          <TableHead>Urgencia</TableHead>
          <TableHead>Motivo</TableHead>
          <TableHead>Episodio</TableHead>
          <TableHead>Estado</TableHead>
          <TableHead>Fecha</TableHead>
          <TableHead>Accion</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((r) => (
          <TableRow key={r.id}>
            <TableCell>{TIPO_LABEL[r.tipo] ?? r.tipo}</TableCell>
            <TableCell>
              <Badge variant={URGENCIA_VARIANT[r.urgencia] ?? "outline"}>
                {r.urgencia}
              </Badge>
            </TableCell>
            <TableCell className="max-w-xs truncate text-sm">{r.motivo}</TableCell>
            <TableCell className="font-mono text-xs">
              {r.episodio_id.slice(0, 8)}…
            </TableCell>
            <TableCell>
              <Badge variant={ESTADO_VARIANT[r.estado_codigo] ?? "outline"}>
                {ESTADO_LABEL[r.estado_codigo] ?? r.estado_codigo}
              </Badge>
            </TableCell>
            <TableCell className="tabular-nums text-xs">
              {dateFmt.format(new Date(r.fecha_solicitud))}
            </TableCell>
            <TableCell>
              <Button asChild variant="outline" size="sm">
                <Link href={ctaHref(r.id)}>{ctaLabel}</Link>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function RriListPage() {
  // Mías pendientes: creadas por mí, estado en_revision o firmado (esperando IC)
  const miasQuery = trpc.eceRri.list.useQuery(
    { estado: "en_revision", limit: 50 },
    { enabled: true },
  );

  // Para responder: estado firmado (el IC debe responder)
  const responderQuery = trpc.eceRri.list.useQuery(
    { estado: "firmado", limit: 50 },
    { enabled: true },
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ArrowLeftRight className="h-6 w-6" aria-hidden />
            RRI — Referencia / Retorno / Interconsulta
          </h1>
          <p className="text-sm text-muted-foreground">
            NTEC Doc 10 — Flujo MC firma solicitud, IC firma respuesta.
          </p>
        </div>
        <Button asChild>
          <Link href="/ece/rri/nueva">Nueva solicitud</Link>
        </Button>
      </div>

      {/* Split de tabs */}
      <Tabs defaultValue="mias">
        <TabsList>
          <TabsTrigger value="mias">
            <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Mias pendientes
          </TabsTrigger>
          <TabsTrigger value="responder">
            <Inbox className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Para responder (IC)
          </TabsTrigger>
        </TabsList>

        <TabsContent value="mias">
          <Card>
            <CardHeader>
              <CardTitle>Solicitudes en revision</CardTitle>
            </CardHeader>
            <CardContent>
              {miasQuery.isLoading && (
                <p className="text-sm text-muted-foreground">Cargando…</p>
              )}
              {miasQuery.error && (
                <p role="alert" className="text-sm text-destructive">
                  {miasQuery.error.message}
                </p>
              )}
              {!miasQuery.isLoading && (
                <RriTable
                  items={miasQuery.data?.items ?? []}
                  ctaLabel="Ver / Firmar"
                  ctaHref={(id) => `/ece/rri/${id}`}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="responder">
          <Card>
            <CardHeader>
              <CardTitle>Solicitudes firmadas — pendientes de respuesta IC</CardTitle>
            </CardHeader>
            <CardContent>
              {responderQuery.isLoading && (
                <p className="text-sm text-muted-foreground">Cargando…</p>
              )}
              {responderQuery.error && (
                <p role="alert" className="text-sm text-destructive">
                  {responderQuery.error.message}
                </p>
              )}
              {!responderQuery.isLoading && (
                <RriTable
                  items={responderQuery.data?.items ?? []}
                  ctaLabel="Responder"
                  ctaHref={(id) => `/ece/rri/${id}/responder`}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
