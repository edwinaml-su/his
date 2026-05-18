"use client";

/**
 * ECE — Lista de Verificación Preoperatoria (PREOP_CHECK).
 * NTEC Art. 28, Acuerdo n.° 1616 MINSAL 2024.
 */
import * as React from "react";
import Link from "next/link";
import { ClipboardList, Lock, Plus } from "lucide-react";
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
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { trpc } from "@/lib/trpc/react";

const ESTADO_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  borrador: "outline",
  firmado: "default",
};

const dateFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default function PreopChecklistPage() {
  const [episodioHospitalarioId, setEpisodioHospitalarioId] = React.useState("");
  const [query, setQuery] = React.useState("");

  const { data, isLoading, isError } = trpc.eceCirugiaPreop.list.useQuery(
    { episodioHospitalarioId: query, limit: 20 },
    { enabled: query.length === 36 },
  );

  function handleSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setQuery(episodioHospitalarioId.trim());
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-semibold">Preoperatorio — Lista de verificación</h1>
        </div>
        <Button asChild size="sm">
          <Link href="/ece/quirofano/preop/nueva">
            <Plus className="mr-1 h-4 w-4" />
            Nuevo checklist
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Buscar por episodio hospitalario</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSearch} className="flex items-end gap-3">
            <div className="flex-1">
              <Label htmlFor="episodioHospitalarioId" className="text-xs">
                UUID del episodio hospitalario
              </Label>
              <Input
                id="episodioHospitalarioId"
                value={episodioHospitalarioId}
                onChange={(e) => setEpisodioHospitalarioId(e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="mt-1 font-mono text-xs"
              />
            </div>
            <Button type="submit" variant="secondary" size="sm">
              Buscar
            </Button>
          </form>
        </CardContent>
      </Card>

      {isError && (
        <p className="text-sm text-destructive">
          Error al cargar los checklists. Verifique el UUID e intente de nuevo.
        </p>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Cargando...</p>}

      {data && (
        <Card>
          <CardContent className="pt-4">
            {data.items.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No hay checklists preoperatorios para este episodio.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Registrado</TableHead>
                    <TableHead>ASA</TableHead>
                    <TableHead>Ayuno (h)</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Firmado</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      {data.items.map((row: any) => (
                    <TableRow key={row.id}>
                      <TableCell className="text-xs">
                        {row.registrado_en
                          ? dateFmt.format(new Date(row.registrado_en))
                          : "—"}
                      </TableCell>
                      <TableCell>{row.riesgo_anestesico_asa ?? "—"}</TableCell>
                      <TableCell>{row.ayuno_horas ?? "—"}</TableCell>
                      <TableCell>
                        <Badge
                          variant={ESTADO_VARIANT[row.estado_codigo] ?? "outline"}
                        >
                          {row.estado_codigo}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {row.firmado_en ? (
                          <Lock className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/ece/quirofano/preop/${row.id}`}>Ver</Link>
                        </Button>
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
