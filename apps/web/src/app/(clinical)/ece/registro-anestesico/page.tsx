"use client";

/**
 * ECE — Listado de Registros Anestésicos Intraoperatorios.
 *
 * Roles habilitados: ESP (anestesiólogo), PHYSICIAN, NURSE (solo lectura).
 */

import * as React from "react";
import Link from "next/link";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Label } from "@his/ui/components/label";
import { Input } from "@his/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { trpc } from "@/lib/trpc/react";
import type { EstadoRegistroAnest } from "@his/contracts";

const ESTADOS: { value: EstadoRegistroAnest | "todos"; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "borrador", label: "Borrador" },
  { value: "firmado", label: "Firmado" },
  { value: "anulado", label: "Anulado" },
];

const TIPO_LABEL: Record<string, string> = {
  general: "General",
  regional: "Regional",
  local: "Local",
  sedacion: "Sedación",
};

const dtFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "short",
  timeStyle: "short",
});

function EstadoBadge({ estado }: { estado: string }) {
  const map: Record<
    string,
    { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
  > = {
    borrador: { label: "Borrador", variant: "secondary" },
    firmado: { label: "Firmado", variant: "default" },
    anulado: { label: "Anulado", variant: "destructive" },
  };
  const cfg = map[estado] ?? { label: estado, variant: "outline" as const };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

export default function RegistroAnestesicoPage() {
  const [actoId, setActoId] = React.useState("");
  const [estado, setEstado] = React.useState<EstadoRegistroAnest | "todos">(
    "todos",
  );

  const query = trpc.eceRegistroAnestesico.list.useQuery({
    actoQuirurgicoId: actoId.trim() || undefined,
    estado: estado === "todos" ? undefined : estado,
    limit: 20,
  });

  const rows = query.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">
            Registro Anestésico Intraoperatorio
          </h1>
          <p className="text-sm text-muted-foreground">
            REG_ANEST — firmado por anestesiólogo (ESP).
          </p>
        </div>
        <Button asChild>
          <Link href="/ece/registro-anestesico/nuevo">Nuevo registro</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4">
          <div className="w-72 space-y-1.5">
            <Label htmlFor="filtro-acto">Acto quirúrgico (UUID)</Label>
            <Input
              id="filtro-acto"
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              value={actoId}
              onChange={(e) => setActoId(e.target.value)}
              className="font-mono text-sm"
            />
          </div>
          <div className="w-44 space-y-1.5">
            <Label htmlFor="filtro-estado">Estado</Label>
            <Select
              value={estado}
              onValueChange={(v) =>
                setEstado(v as EstadoRegistroAnest | "todos")
              }
            >
              <SelectTrigger id="filtro-estado">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ESTADOS.map((e) => (
                  <SelectItem key={e.value} value={e.value}>
                    {e.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Registros</CardTitle>
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
              Sin registros para los filtros actuales.
            </p>
          )}
          {rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha registro</TableHead>
                  <TableHead>Acto quirúrgico</TableHead>
                  <TableHead>ASA</TableHead>
                  <TableHead>Anestesia</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="sr-only">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="tabular-nums">
                      {dtFmt.format(new Date(r.registrado_en))}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.acto_quirurgico_id.slice(0, 8)}…
                    </TableCell>
                    <TableCell className="tabular-nums font-medium">
                      {r.asa}
                    </TableCell>
                    <TableCell>
                      {TIPO_LABEL[r.tipo_anestesia] ?? r.tipo_anestesia}
                    </TableCell>
                    <TableCell>
                      <EstadoBadge estado={r.estado_registro} />
                    </TableCell>
                    <TableCell>
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/ece/registro-anestesico/${r.id}`}>
                          Ver
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
