"use client";

/**
 * ECE — Estudios (Solicitudes y Resultados, Doc 18 NTEC).
 *
 * Lista split:
 *   - Izquierda: solicitudes pendientes (borrador / en_revision / firmado).
 *   - Derecha: solicitudes con resultado registrado (validado / con resultado).
 *
 * Filtro por episodioId (UUID).
 */
import * as React from "react";
import Link from "next/link";
import { FlaskConical } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
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
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { trpc } from "@/lib/trpc/react";

const ESTADO_LABEL: Record<string, string> = {
  borrador: "Borrador",
  en_revision: "En revisión",
  firmado: "Firmado",
  validado: "Validado",
  anulado: "Anulado",
};

const ESTADO_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  borrador: "outline",
  en_revision: "secondary",
  firmado: "default",
  validado: "default",
  anulado: "destructive",
};

const TIPO_LABEL: Record<string, string> = {
  laboratorio: "Laboratorio",
  imagenologia: "Imagenología",
  otro: "Otro",
};

const PRIORIDAD_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  rutina: "outline",
  urgente: "secondary",
  stat: "destructive",
};

const dateFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "short",
  timeStyle: "short",
});

interface SolicitudRow {
  id: string;
  tipo: string;
  /** JSONB: { examenes: string[], prioridad: string } */
  examenes: unknown;
  estado_codigo: string;
  episodio_id: string;
  fecha_hora: string | Date;
}

/** Estados considerados "pendientes" (sin resultado aún). */
const ESTADOS_PENDIENTES = new Set(["borrador", "en_revision", "firmado"]);

export default function EstudiosListPage() {
  const [episodioId, setEpisodioId] = React.useState("");

  const enabled = !episodioId.trim() || /^[0-9a-f-]{36}$/i.test(episodioId.trim());

  const query = trpc.eceSolicitudEstudio.list.useQuery(
    { episodioId: episodioId.trim() || undefined, limit: 50 },
    { enabled },
  );

  const allRows = (query.data?.items ?? []) as unknown as SolicitudRow[];

  const pendientes = allRows.filter((r) => ESTADOS_PENDIENTES.has(r.estado_codigo));
  const conResultado = allRows.filter((r) => !ESTADOS_PENDIENTES.has(r.estado_codigo));

  function renderTable(rows: SolicitudRow[], emptyMsg: string) {
    if (query.isLoading) {
      return <p className="text-sm text-muted-foreground">Cargando…</p>;
    }
    if (rows.length === 0) {
      return <p className="text-sm text-muted-foreground">{emptyMsg}</p>;
    }
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tipo</TableHead>
            <TableHead>Prioridad</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead>Fecha</TableHead>
            <TableHead>Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>{TIPO_LABEL[r.tipo] ?? r.tipo}</TableCell>
              <TableCell>
                {(() => {
                  const prioridad = (r.examenes as { prioridad?: string } | null)?.prioridad ?? "rutina";
                  return (
                    <Badge variant={PRIORIDAD_VARIANT[prioridad] ?? "outline"}>
                      {prioridad.toUpperCase()}
                    </Badge>
                  );
                })()}
              </TableCell>
              <TableCell>
                <Badge variant={ESTADO_VARIANT[r.estado_codigo] ?? "outline"}>
                  {ESTADO_LABEL[r.estado_codigo] ?? r.estado_codigo}
                </Badge>
              </TableCell>
              <TableCell className="tabular-nums text-xs">
                {r.fecha_hora ? dateFmt.format(new Date(r.fecha_hora)) : "—"}
              </TableCell>
              <TableCell>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/ece/estudios/${r.id}`}>Ver</Link>
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <FlaskConical className="h-6 w-6" aria-hidden />
            Estudios (Lab / Imágenes)
          </h1>
          <p className="text-sm text-muted-foreground">
            Solicitudes y resultados de estudios clínicos — ECE Doc 18 NTEC.
          </p>
        </div>
        <Button asChild>
          <Link href="/ece/estudios/nueva">Nueva solicitud</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-w-sm space-y-1.5">
            <Label htmlFor="filter-episodio">Episodio (UUID)</Label>
            <Input
              id="filter-episodio"
              placeholder="xxxxxxxx-xxxx-…"
              value={episodioId}
              onChange={(e) => setEpisodioId(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {query.error && (
        <p role="alert" className="text-sm text-destructive">
          {query.error.message}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Pendientes</CardTitle>
          </CardHeader>
          <CardContent>
            {renderTable(pendientes, "No hay solicitudes pendientes.")}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Con resultado</CardTitle>
          </CardHeader>
          <CardContent>
            {renderTable(conResultado, "No hay estudios con resultado.")}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
