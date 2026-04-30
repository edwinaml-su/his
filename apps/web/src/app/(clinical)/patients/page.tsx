"use client";

import * as React from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { PatientSearchBar } from "@his/ui/components/PatientSearchBar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@his/ui/components/table";
import { trpc } from "@/lib/trpc/react";

/**
 * Buscador MPI (TDR §8.1). Búsqueda por nombre/MRN/identificador con debounce.
 */
export default function PatientsPage() {
  const [query, setQuery] = React.useState("");
  const search = trpc.patient.search.useQuery(
    { query, limit: 20 },
    { enabled: query.length >= 2 },
  );

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Pacientes</h1>
          <p className="text-sm text-muted-foreground">Master Patient Index</p>
        </div>
        <Button asChild>
          <Link href="/patients/new">Nuevo paciente</Link>
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Búsqueda</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <PatientSearchBar onSearch={setQuery} />
          {search.isLoading && query.length >= 2 && (
            <p className="text-sm text-muted-foreground">Buscando…</p>
          )}
          {search.data && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>MRN</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Apellido</TableHead>
                  <TableHead>Fecha nac.</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {search.data.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.mrn}</TableCell>
                    <TableCell>{p.firstName}</TableCell>
                    <TableCell>{p.lastName}</TableCell>
                    <TableCell className="tabular-nums">
                      {p.birthDate ? new Date(p.birthDate).toLocaleDateString("es-SV") : "—"}
                    </TableCell>
                    <TableCell>
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/patients/${p.id}`}>Ver</Link>
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
