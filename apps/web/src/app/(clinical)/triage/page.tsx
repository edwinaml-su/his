"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@his/ui/components/table";
import { Button } from "@his/ui/components/button";
import { TriageWidget } from "@his/ui/components/TriageWidget";
import { trpc } from "@/lib/trpc/react";

export default function TriagePage() {
  const queue = trpc.triage.listPending.useQuery();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Triage Manchester</h1>
      <Card>
        <CardHeader><CardTitle>Cola pendiente</CardTitle></CardHeader>
        <CardContent>
          {queue.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {queue.data && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Paciente</TableHead>
                  <TableHead>Encuentro</TableHead>
                  <TableHead>Llegada</TableHead>
                  <TableHead>Último triage</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {queue.data.map((enc) => {
                  const last = enc.triages[0];
                  return (
                    <TableRow key={enc.id}>
                      <TableCell>{enc.patient.firstName} {enc.patient.lastName}</TableCell>
                      <TableCell className="font-mono text-xs">{enc.encounterNumber}</TableCell>
                      <TableCell className="tabular-nums">
                        {new Date(enc.admittedAt).toLocaleTimeString("es-SV")}
                      </TableCell>
                      <TableCell>
                        {last ? (
                          <TriageWidget
                            color={last.assignedLevel.color}
                            levelName={last.assignedLevel.name}
                            startedAt={last.startedAt}
                            maxWaitMinutes={last.assignedLevel.maxWaitMinutes}
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">Sin evaluar</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button asChild size="sm">
                          <Link href={`/triage/new/${enc.id}`}>Evaluar</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
