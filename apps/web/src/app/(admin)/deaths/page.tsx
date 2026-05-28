"use client";

/**
 * US-5.6 — Listado de certificados de defunción (ECE).
 * Consume trpc.eceCertDef.list en lugar del router legacy deathCertificate.
 * URL /deaths mantenida — solo cambia la fuente de datos.
 */
import * as React from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Badge } from "@his/ui/components/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Button } from "@his/ui/components/button";
import { trpc } from "@/lib/trpc/react";

// Shape mínima del item devuelto por eceCertDef.list (espeja CertDefRow).
interface CertDefItem {
  id: string;
  fecha_hora_defuncion: Date;
  causa_principal_cie10: string;
  manera: string;
  lugar_defuncion: string;
  estado_workflow: string;
}

type EstadoWorkflow = "borrador" | "firmado" | "validado" | "certificado" | "anulado";

const ESTADO_LABEL: Record<EstadoWorkflow, string> = {
  borrador: "Borrador",
  firmado: "Firmado MC",
  validado: "Validado MC",
  certificado: "Certificado DIR",
  anulado: "Anulado",
};

const ESTADO_VARIANT: Record<
  EstadoWorkflow,
  "default" | "secondary" | "outline" | "destructive" | "success"
> = {
  borrador: "outline",
  firmado: "secondary",
  validado: "secondary",
  certificado: "success",
  anulado: "destructive",
};

type ManeraCie = "natural" | "violenta" | "accidental" | "suicidio" | "homicidio" | "indeterminada";

const MANERA_LABEL: Record<ManeraCie, string> = {
  natural: "Natural",
  violenta: "Violenta",
  accidental: "Accidental",
  suicidio: "Suicidio",
  homicidio: "Homicidio",
  indeterminada: "Indeterminada",
};

export default function DeathsListPage() {
  const [estado, setEstado] = React.useState<EstadoWorkflow | "">("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [page, setPage] = React.useState(1);

  const list = trpc.eceCertDef.list.useQuery({
    page,
    pageSize: 20,
    estado: estado || undefined,
    fechaDesde: from ? new Date(from) : undefined,
    fechaHasta: to ? new Date(to) : undefined,
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Certificados de defunción</h1>
        <p className="text-sm text-muted-foreground">
          Registro ECE (NTEC Art. 21). Acceso restringido a personal médico y administrativo.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="from">Desde</Label>
              <Input
                id="from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to">Hasta</Label>
              <Input
                id="to"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Estado workflow</Label>
              <Select
                value={estado || "all"}
                onValueChange={(v) =>
                  setEstado(v === "all" ? "" : (v as EstadoWorkflow))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  {/* Radix Select prohíbe value="" — centinela "all". */}
                  <SelectItem value="all">Todos</SelectItem>
                  {(Object.keys(ESTADO_LABEL) as EstadoWorkflow[]).map((e) => (
                    <SelectItem key={e} value={e}>
                      {ESTADO_LABEL[e]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEstado("");
                  setFrom("");
                  setTo("");
                  setPage(1);
                }}
              >
                Limpiar
              </Button>
              <Button asChild variant="default">
                <Link href="/deaths/nueva">Nuevo</Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Resultados {list.data ? `(${list.data.total})` : null}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {list.isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : list.error ? (
            <p className="text-sm text-destructive">{list.error.message}</p>
          ) : !list.data || list.data.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin certificados para los filtros seleccionados.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha defunción</TableHead>
                  <TableHead>Causa principal (CIE-10)</TableHead>
                  <TableHead>Manera</TableHead>
                  <TableHead>Lugar</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead aria-label="acciones" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(list.data.items as CertDefItem[]).map((c) => {
                  const estadoVal = c.estado_workflow as EstadoWorkflow;
                  const manera = c.manera as ManeraCie | null | undefined;
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="tabular-nums">
                        {new Date(c.fecha_hora_defuncion).toLocaleString("es-SV")}
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs">
                          {c.causa_principal_cie10}
                        </span>
                      </TableCell>
                      <TableCell>
                        {manera ? (
                          <span className="text-sm">{MANERA_LABEL[manera]}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="capitalize text-sm">
                        {c.lugar_defuncion}
                      </TableCell>
                      <TableCell>
                        <Badge variant={ESTADO_VARIANT[estadoVal]}>
                          {ESTADO_LABEL[estadoVal]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Link
                          className="text-sm text-primary underline"
                          href={`/deaths/${c.id}`}
                        >
                          Ver
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          {list.data && list.data.total > list.data.pageSize ? (
            <div className="mt-3 flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Anterior
              </Button>
              <span className="text-xs text-muted-foreground">
                Página {page}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page * list.data.pageSize >= list.data.total}
                onClick={() => setPage((p) => p + 1)}
              >
                Siguiente
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
