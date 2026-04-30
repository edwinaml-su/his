"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@his/ui/components/table";
import { Badge } from "@his/ui/components/badge";
import { trpc } from "@/lib/trpc/react";

const SUPPORTED = [
  "biologicalSex",
  "gender",
  "maritalStatus",
  "educationLevel",
  "occupation",
  "religion",
  "language",
  "ethnicity",
  "patientType",
  "patientCategory",
  "ageBand",
  "medicalSpecialty",
  "identifierType",
] as const;

type CatalogKey = (typeof SUPPORTED)[number];

/**
 * CRUD genérico (read en MVP). El alta/edición se delega a Sprint 2.
 * TODO(Sprint 2): Dialog para crear/editar registros + audit visible.
 */
export default function CatalogPage() {
  const params = useParams<{ catalog: string }>();
  const key = params.catalog as CatalogKey;

  if (!SUPPORTED.includes(key)) {
    return (
      <div className="space-y-2">
        <h1 className="text-xl font-bold">Catálogo no soportado</h1>
        <p className="text-sm text-muted-foreground">
          Catálogos disponibles: {SUPPORTED.join(", ")}.
        </p>
      </div>
    );
  }

  const query = trpc.catalog.list.useQuery({ catalog: key, activeOnly: false });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold capitalize">Catálogo: {key}</h1>
        <p className="text-sm text-muted-foreground">
          Listado parametrizable (TDR §7).
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Registros</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {query.error && (
            <p className="text-sm text-destructive">Error: {query.error.message}</p>
          )}
          {query.data && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.map((row: Record<string, unknown>) => (
                  <TableRow key={String(row.id)}>
                    <TableCell className="font-mono text-xs">
                      {String(row.code ?? row.isoCode ?? row.ciuoCode ?? "—")}
                    </TableCell>
                    <TableCell>{String(row.name ?? "—")}</TableCell>
                    <TableCell>
                      {row.active ? (
                        <Badge variant="success">Activo</Badge>
                      ) : (
                        <Badge variant="outline">Inactivo</Badge>
                      )}
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
