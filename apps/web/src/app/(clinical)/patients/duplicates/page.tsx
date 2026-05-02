"use client";

/**
 * US-4.3 — Listado de candidatos a duplicado para un paciente pivote.
 *
 * Flujo: el usuario llega aquí desde la ficha del paciente (`?patientId=...`).
 * La pantalla llama `patient.findDuplicates` y muestra los top-N candidatos
 * con score color-coded. Click "Comparar" lleva al wizard de merge.
 */

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { trpc } from "@/lib/trpc/react";

function ScoreBadge({ score, klass }: { score: number; klass: string }) {
  const pct = `${Math.round(score * 100)}%`;
  if (klass === "DUPLICATE_PROBABLE") {
    return (
      <Badge className="bg-red-600 text-white hover:bg-red-700">
        {pct} · Duplicado probable
      </Badge>
    );
  }
  if (klass === "CANDIDATE") {
    return (
      <Badge className="bg-amber-500 text-white hover:bg-amber-600">
        {pct} · Candidato
      </Badge>
    );
  }
  return <Badge variant="outline">{pct}</Badge>;
}

export default function DuplicatesPage() {
  const sp = useSearchParams();
  const patientId = sp.get("patientId") ?? "";
  const enabled = patientId.length > 0;

  const dupes = trpc.patient.findDuplicates.useQuery(
    { patientId, threshold: 0.65, limit: 20 },
    { enabled },
  );
  const pivot = trpc.patient.get.useQuery({ id: patientId }, { enabled });

  if (!enabled) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Duplicados MPI</h1>
        <p className="text-sm text-muted-foreground">
          Falta el parámetro <code>patientId</code> en la URL.
        </p>
        <Button asChild variant="outline">
          <Link href="/patients">Ir al buscador</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Posibles duplicados</h1>
        {pivot.data ? (
          <p className="text-sm text-muted-foreground">
            Pivote: <strong>{pivot.data.lastName}, {pivot.data.firstName}</strong>{" "}
            <span className="font-mono text-xs">(MRN {pivot.data.mrn})</span>
          </p>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Candidatos detectados</CardTitle>
        </CardHeader>
        <CardContent>
          {dupes.isLoading ? (
            <p className="text-sm text-muted-foreground">Calculando coincidencias…</p>
          ) : dupes.error ? (
            <p className="text-sm text-destructive">{dupes.error.message}</p>
          ) : !dupes.data || dupes.data.candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin candidatos sobre el umbral 65%. El paciente parece único.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Score</TableHead>
                  <TableHead>MRN</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Fecha nac.</TableHead>
                  <TableHead className="text-right">Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dupes.data.candidates.map((row) => (
                  <TableRow key={row.patient.id}>
                    <TableCell>
                      <ScoreBadge score={row.score} klass={row.class} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{row.patient.mrn}</TableCell>
                    <TableCell>
                      {row.patient.lastName}
                      {row.patient.secondLastName ? ` ${row.patient.secondLastName}` : ""},{" "}
                      {row.patient.firstName}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {row.patient.birthDate
                        ? new Date(row.patient.birthDate).toLocaleDateString("es-SV")
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm">
                        <Link
                          href={`/patients/merge?from=${row.patient.id}&to=${dupes.data.pivotId}`}
                        >
                          Comparar
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
