"use client";

/**
 * ECE — Listado de Documentos Clínicos Asociados (DOC_ASOC).
 * NTEC §15, §38 — archivos adjuntos al expediente clínico.
 */
import * as React from "react";
import Link from "next/link";
import { Paperclip } from "lucide-react";
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
  firmado:  "secondary",
  anulado:  "destructive",
};

const CATEGORIA_LABEL: Record<string, string> = {
  imagen_diagnostica:    "Imagen diagnóstica",
  laboratorio_externo:   "Lab. externo",
  referencia_externa:    "Referencia externa",
  consentimiento_externo:"Consent. externo",
  otro:                  "Otro",
};

const dateFmt = new Intl.DateTimeFormat("es-SV", { dateStyle: "medium", timeStyle: "short" });

export default function DocAsocListPage() {
  const [pacienteId, setPacienteId] = React.useState("");
  const [episodioId, setEpisodioId] = React.useState("");

  const query = trpc.eceDocAsoc.list.useQuery(
    {
      pacienteId: pacienteId.trim() || undefined,
      episodioId: episodioId.trim() || undefined,
      page: 1,
      pageSize: 50,
    },
    { enabled: true },
  );

  const rows = query.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Paperclip className="h-6 w-6" aria-hidden />
            Documentos Clínicos Asociados
          </h1>
          <p className="text-sm text-muted-foreground">
            NTEC §15, §38 — imágenes, PDFs y documentos externos adjuntos al expediente.
          </p>
        </div>
        <Button asChild>
          <Link href="/ece/documento-asociado/nuevo">Adjuntar documento</Link>
        </Button>
      </div>

      {/* Filtros */}
      <Card>
        <CardHeader><CardTitle>Filtros</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="filter-paciente">Paciente (UUID)</Label>
              <Input
                id="filter-paciente"
                placeholder="xxxxxxxx-xxxx-..."
                value={pacienteId}
                onChange={(e) => setPacienteId(e.target.value)}
              />
            </div>
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
            Documentos ({query.data?.total ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {query.error && (
            <p role="alert" className="text-sm text-destructive">{query.error.message}</p>
          )}
          {!query.isLoading && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">Sin documentos para los filtros aplicados.</p>
          )}
          {rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Título</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Adjuntado</TableHead>
                  <TableHead>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="max-w-[200px] truncate text-sm font-medium">
                      {r.titulo}
                    </TableCell>
                    <TableCell className="text-sm">
                      {CATEGORIA_LABEL[r.categoria] ?? r.categoria}
                    </TableCell>
                    <TableCell>
                      <Badge variant={ESTADO_VARIANT[r.estado_registro] ?? "outline"}>
                        {r.estado_registro}
                      </Badge>
                    </TableCell>
                    <TableCell className="tabular-nums text-xs">
                      {dateFmt.format(new Date(r.adjuntado_en))}
                    </TableCell>
                    <TableCell>
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/ece/documento-asociado/${r.id}`}>Ver / Firmar</Link>
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
