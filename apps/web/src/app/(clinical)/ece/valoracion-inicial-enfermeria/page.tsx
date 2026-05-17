"use client";

/**
 * ECE — Listado de Valoraciones Iniciales de Enfermería.
 *
 * Muestra todas las valoraciones del episodio hospitalario activo con filtro
 * por estado (borrador / firmado / validado / anulado).
 *
 * Roles habilitados: NURSE.
 */

import * as React from "react";
import Link from "next/link";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Label } from "@his/ui/components/label";
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
import { Input } from "@his/ui/components/input";
import { trpc } from "@/lib/trpc/react";
import type { EstadoValoracion } from "@his/contracts";

const ESTADOS: { value: EstadoValoracion | "todos"; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "borrador", label: "Borrador" },
  { value: "firmado", label: "Firmado" },
  { value: "validado", label: "Validado" },
  { value: "anulado", label: "Anulado" },
];

const dtFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "short",
  timeStyle: "short",
});

function EstadoBadge({ estado }: { estado: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    borrador:  { label: "Borrador",  variant: "secondary" },
    firmado:   { label: "Firmado",   variant: "default" },
    validado:  { label: "Validado",  variant: "default" },
    anulado:   { label: "Anulado",   variant: "destructive" },
  };
  const cfg = map[estado] ?? { label: estado, variant: "outline" as const };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

export default function ValoracionInicialPage() {
  const [episodioId, setEpisodioId] = React.useState("");
  const [estado, setEstado] = React.useState<EstadoValoracion | "todos">("todos");

  const query = trpc.eceValoracionInicial.list.useQuery({
    episodioHospitalarioId: episodioId.trim() || undefined,
    estado: estado === "todos" ? undefined : estado,
    limit: 20,
  });

  const rows = query.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Valoración Inicial de Enfermería</h1>
          <p className="text-sm text-muted-foreground">
            Registro maestro al ingreso hospitalario (NTEC §4).
          </p>
        </div>
        <Button asChild>
          <Link href="/ece/valoracion-inicial-enfermeria/nueva">
            Nueva valoración
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4">
          <div className="w-72 space-y-1.5">
            <Label htmlFor="filtro-episodio">Episodio hospitalario (UUID)</Label>
            <Input
              id="filtro-episodio"
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              value={episodioId}
              onChange={(e) => setEpisodioId(e.target.value)}
              className="font-mono text-sm"
            />
          </div>
          <div className="w-44 space-y-1.5">
            <Label htmlFor="filtro-estado">Estado</Label>
            <Select
              value={estado}
              onValueChange={(v) => setEstado(v as EstadoValoracion | "todos")}
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
          <CardTitle>Valoraciones</CardTitle>
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
              Sin valoraciones registradas para los filtros actuales.
            </p>
          )}
          {rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha / Hora</TableHead>
                  <TableHead>Episodio</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Braden</TableHead>
                  <TableHead>Morse</TableHead>
                  <TableHead>Dolor</TableHead>
                  <TableHead className="sr-only">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="tabular-nums">
                      {dtFmt.format(new Date(v.fecha_hora))}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {v.episodio_hospitalario_id.slice(0, 8)}…
                    </TableCell>
                    <TableCell>
                      <EstadoBadge estado={v.estado_registro} />
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {v.escala_braden ?? "—"}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {v.escala_morse ?? "—"}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {v.escala_dolor ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/ece/valoracion-inicial-enfermeria/${v.id}`}>
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
